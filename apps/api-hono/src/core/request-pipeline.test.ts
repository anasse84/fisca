import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { ProblemDetailsSchema } from '@fisca/shared-types';
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENT_REPLAY_HEADER, createInMemoryIdempotencyStore } from './idempotency.ts';
import { LedgerError } from './ledger-errors.ts';
import { createRequestPipeline, type RequestPipelineDeps } from './request-pipeline.ts';
import { COMPANY_ID_HEADER, createAccessTokenAuthenticator, type PipelineEnv, type RoutePolicy, type TenantContext } from './tenant-router.ts';
import {
  COMPANY_A,
  COMPANY_B,
  T0_MS,
  USER_1,
  activeRows,
  createFakeEntitlements,
  createFakeKv,
  createFakeMemberships,
  createFakeTenants,
  createTestClock,
  createTestJwt,
  grant,
  type TestJwt,
} from './pipeline-test-support.ts';

const NOW_SEC = Math.floor(T0_MS / 1000);
const KEY_1 = '018f3b5e-7c2a-7d3e-8a1b-0123456789ab';
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

const POLICIES: Readonly<Record<string, RoutePolicy>> = {
  '/api/v1/invoices': { audience: 'HUMAN_API', tenantScope: 'COMPANY', featureKey: 'xhub_b2b_clearance', legalExport: false },
  '/api/v1/ledger/entries': { audience: 'HUMAN_API', tenantScope: 'COMPANY', featureKey: null, legalExport: false },
  '/api/v1/reversibility/export-10y': { audience: 'HUMAN_API', tenantScope: 'COMPANY', featureKey: 'reversibility_export', legalExport: true },
  '/api/v1/mcp/draft': { audience: 'AI_MCP', tenantScope: 'COMPANY', featureKey: null, legalExport: false },
};
const DEFAULT_POLICY: RoutePolicy = { audience: 'HUMAN_API', tenantScope: 'COMPANY', featureKey: null, legalExport: false };

let jwt: TestJwt;
beforeAll(async () => {
  jwt = await createTestJwt();
});

function build(rows = activeRows(['xhub_b2b_clearance'])) {
  const clock = createTestClock();
  const kv = createFakeKv(clock);
  const source = createFakeEntitlements(rows);
  const memberships = createFakeMemberships();
  grant(memberships, USER_1, COMPANY_A, 'OWNER_GERANT');
  const tenants = createFakeTenants([COMPANY_A, COMPANY_B]);
  const store = createInMemoryIdempotencyStore();
  const reports: { traceId: string; errorName: string }[] = [];
  const seen: { tenant: TenantContext | undefined; handled: number } = { tenant: undefined, handled: 0 };
  let releaseGate: () => void = () => undefined;
  let signalReached: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve;
  });
  const deps: RequestPipelineDeps = {
    authenticator: createAccessTokenAuthenticator({ verify: (token) => jwt.verify(token, NOW_SEC) }),
    routePolicy: (request) => POLICIES[request.path] ?? DEFAULT_POLICY,
    memberships,
    tenants,
    entitlements: { source, kv, cacheTtlSec: 120 },
    idempotencyStore: store,
    nowMs: clock.nowMs,
    reportInternalError: (report) => reports.push(report),
  };
  const pipeline = createRequestPipeline(deps);
  const app = new Hono<PipelineEnv>();
  pipeline.applyTo(app, '/api/v1/*');
  app.all('/api/v1/*', async (c) => {
    if (c.req.path === '/api/v1/ledger/slow') {
      signalReached();
      await gate;
    }
    seen.tenant = c.get('tenant');
    seen.handled += 1;
    if (c.req.path === '/api/v1/boom') {
      throw new Error('SELECT * FROM secrets -- hunter2');
    }
    if (c.req.path === '/api/v1/ledger/typed') {
      throw new LedgerError('LEDGER_POSTED_IMMUTABLE', 'écriture 42 scellée');
    }
    return c.json({ handled: seen.handled, company: c.get('tenant')?.companyId ?? null }, c.req.method === 'POST' ? 201 : 200);
  });
  return { pipeline, app, clock, kv, source, memberships, tenants, store, reports, seen, releaseGate, reached };
}

async function call(app: Hono<PipelineEnv>, method: string, path: string, options: { company?: string | null; key?: string | null; body?: string; token?: string | null; traceparent?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = options.token === undefined ? await jwt.issue(USER_1, NOW_SEC) : options.token;
  if (token !== null) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options.company !== null) {
    headers[COMPANY_ID_HEADER] = options.company ?? COMPANY_A;
  }
  if (options.key !== null && method !== 'GET') {
    headers[IDEMPOTENCY_KEY_HEADER] = options.key ?? KEY_1;
  }
  if (options.traceparent !== undefined) {
    headers['traceparent'] = options.traceparent;
  }
  return app.request(path, { method, headers, ...(method === 'GET' ? {} : { body: options.body ?? '{"montant":100}' }) });
}

describe('createRequestPipeline : composition et ordre', () => {
  it("expose les étapes dans l'ordre trace → authentification → TenantRouter → EntitlementGuard → Idempotency", () => {
    const { pipeline } = build();
    expect(pipeline.stages.map((stage) => stage.name)).toEqual(['trace', 'authentication', 'tenant-router', 'entitlement-guard', 'idempotency']);
    expect(pipeline.stages).toHaveLength(5);
    expect(typeof pipeline.onError).toBe('function');
  });

  it('chemin nominal : écriture authentifiée, dossier résolu, droit accordé, clé réservée puis rejeu', async () => {
    const { app, seen, tenants } = build();
    const first = await call(app, 'POST', '/api/v1/invoices');
    expect(first.status).toBe(201);
    expect(seen.tenant?.companyId).toBe(COMPANY_A);
    expect(seen.tenant?.tenantDb).toBe(tenants.drivers.get(COMPANY_A));
    const replay = await call(app, 'POST', '/api/v1/invoices');
    expect(replay.status).toBe(201);
    expect(replay.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe('true');
    expect(await replay.json()).toEqual(await first.json());
    expect(seen.handled).toBe(1);
  });

  it("sans JWT : 401 avant toute lecture de dossier, de droits ou de clé", async () => {
    const { app, memberships, source, store, seen } = build();
    const response = await call(app, 'POST', '/api/v1/invoices', { token: null, company: null, key: null });
    expect(response.status).toBe(401);
    expect(memberships.calls).toHaveLength(0);
    expect(source.loads).toBe(0);
    expect(store.snapshot()).toHaveLength(0);
    expect(seen.handled).toBe(0);
  });

  it("dossier non autorisé : 403 avant les droits et avant l'idempotence", async () => {
    const { app, source, store } = build();
    const response = await call(app, 'POST', '/api/v1/invoices', { company: COMPANY_B, key: null });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ errorCode: 'ABAC_TENANT_OUT_OF_SCOPE' });
    expect(source.loads).toBe(0);
    expect(store.snapshot()).toHaveLength(0);
  });

  it("droit refusé : 403 avant l'idempotence, même sans Idempotency-Key", async () => {
    const { app, store, seen } = build(activeRows([]));
    const response = await call(app, 'POST', '/api/v1/invoices', { key: null });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ errorCode: 'ENTITLEMENT_UPGRADE_REQUIRED' });
    expect(store.snapshot()).toHaveLength(0);
    expect(seen.handled).toBe(0);
  });

  it("clé manquante sur une écriture autorisée : 400 après les contrôles d'accès", async () => {
    const { app } = build();
    const response = await call(app, 'POST', '/api/v1/ledger/entries', { key: null });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('RESTRICTED_READ_ONLY : mutation refusée, lecture et export décennal admis', async () => {
    const { app, seen } = build(activeRows(['xhub_b2b_clearance'], { subscriptionStatus: 'RESTRICTED_READ_ONLY' }));
    expect((await call(app, 'POST', '/api/v1/ledger/entries')).status).toBe(403);
    expect((await call(app, 'GET', '/api/v1/ledger/entries')).status).toBe(200);
    const exportResponse = await call(app, 'POST', '/api/v1/reversibility/export-10y');
    expect(exportResponse.status).toBe(201);
    expect(seen.handled).toBe(2);
  });

  it('route IA/MCP : en-tête ignoré, jeton non lié au dossier → 403', async () => {
    const { app, seen } = build();
    const response = await call(app, 'POST', '/api/v1/mcp/draft', { company: COMPANY_A });
    expect(response.status).toBe(403);
    expect(seen.handled).toBe(0);
  });

  it('deux écritures simultanées avec la même clé : une seule exécution, l’autre 409', async () => {
    const { app, seen, releaseGate, reached } = build();
    const first = call(app, 'POST', '/api/v1/ledger/slow');
    await reached;
    const second = await call(app, 'POST', '/api/v1/ledger/slow');
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ errorCode: 'IDEMPOTENCY_REQUEST_IN_PROGRESS' });
    releaseGate();
    expect((await first).status).toBe(201);
    expect(seen.handled).toBe(1);
  });
});

describe('createRequestPipeline : erreurs sans fuite, traçabilité', () => {
  it('une exception inattendue de la route donne le 500 constant, avec le traceId de la requête', async () => {
    const { app, reports, store } = build();
    const response = await call(app, 'POST', '/api/v1/boom', { traceparent: `00-${TRACE}-00f067aa0ba902b7-01` });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('secrets');
    expect(ProblemDetailsSchema.parse(JSON.parse(text))).toMatchObject({ errorCode: 'INTERNAL_ERROR', traceId: TRACE });
    expect(reports).toEqual([{ traceId: TRACE, errorName: 'Error' }]);
    expect(store.snapshot()).toHaveLength(0);
  });

  it('une erreur typée du grand livre est traduite en statut et code stables', async () => {
    const { app } = build();
    const response = await call(app, 'POST', '/api/v1/ledger/typed');
    const text = await response.text();
    expect(response.status).toBe(409);
    expect(text).not.toContain('scellée');
    expect(JSON.parse(text)).toMatchObject({ errorCode: 'LEDGER_POSTED_IMMUTABLE' });
  });

  it('une route inconnue du préfixe protégé reste derrière l’authentification, puis donne un 404 problem+json', async () => {
    const { app } = build();
    const unauth = await app.request('/api/v1/inconnue', { headers: {} });
    expect(unauth.status).toBe(401);
    const trace = await unauth.json();
    expect(ProblemDetailsSchema.parse(trace).traceId).toHaveLength(32);
    const outside = await app.request('/hors-prefixe');
    expect(outside.status).toBe(404);
    expect(outside.headers.get('content-type')).toBe('application/problem+json');
  });

  it("génère un traceId quand le traceparent est invalide", async () => {
    const { app } = build();
    const response = await call(app, 'GET', '/api/v1/ledger/entries', { token: null, traceparent: 'invalide' });
    expect(ProblemDetailsSchema.parse(await response.json()).traceId).toMatch(/^[0-9a-f]{32}$/);
  });
});
