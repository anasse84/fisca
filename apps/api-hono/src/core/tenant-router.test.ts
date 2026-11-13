import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { InfrastructureError, ProblemDetailsSchema, type ProblemDetails } from '@fisca/shared-types';
import { SchemaMigrationError } from '@fisca/db-schema';
import { createProblemErrorHandler } from './problem-details.ts';
import {
  COMPANY_ID_HEADER,
  createAccessTokenAuthenticator,
  createAuthenticationMiddleware,
  createTenantRouter,
  type PipelineEnv,
  type RoutePolicy,
  type TenantContext,
} from './tenant-router.ts';
import {
  COMPANY_A,
  COMPANY_B,
  T0_MS,
  USER_1,
  USER_2,
  createFakeMandates,
  createFakeMemberships,
  createFakeTenants,
  grantMandate,
  createTestJwt,
  grant,
  type TestJwt,
} from './pipeline-test-support.ts';

const NOW_SEC = Math.floor(T0_MS / 1000);
const HUMAN: RoutePolicy = { audience: 'HUMAN_API', tenantScope: 'COMPANY', featureKey: null, legalExport: false };
const MCP: RoutePolicy = { audience: 'AI_MCP', tenantScope: 'COMPANY', featureKey: null, legalExport: false };
const NO_TENANT: RoutePolicy = { audience: 'HUMAN_API', tenantScope: 'NONE', featureKey: null, legalExport: false };

let jwt: TestJwt;
beforeAll(async () => {
  jwt = await createTestJwt();
});

interface Harness {
  readonly app: Hono<PipelineEnv>;
  readonly memberships: ReturnType<typeof createFakeMemberships>;
  readonly mandates: ReturnType<typeof createFakeMandates>;
  readonly tenants: ReturnType<typeof createFakeTenants>;
  readonly seen: { tenant: TenantContext | undefined };
}

function harness(boundCompanyId: string | null = null, policyFor: (path: string) => RoutePolicy = () => HUMAN, withMandates = true): Harness {
  const memberships = createFakeMemberships();
  const mandates = createFakeMandates();
  grant(memberships, USER_1, COMPANY_A, 'CHEF_MISSION');
  const tenants = createFakeTenants([COMPANY_A, COMPANY_B]);
  const authenticator = createAccessTokenAuthenticator({ verify: (token) => jwt.verify(token, NOW_SEC) });
  const seen: { tenant: TenantContext | undefined } = { tenant: undefined };
  const app = new Hono<PipelineEnv>();
  app.onError(createProblemErrorHandler());
  app.use('*', createAuthenticationMiddleware({
    authenticator: boundCompanyId === null ? authenticator : {
      authenticate: async (input) => {
        const actor = await authenticator.authenticate(input);
        return actor === null ? null : { ...actor, boundCompanyId };
      },
    },
  }));
  app.use('*', createTenantRouter({ routePolicy: (request) => policyFor(request.path), memberships, ...(withMandates ? { mandates } : {}), tenants }));
  app.all('/api/x', (c) => {
    seen.tenant = c.get('tenant');
    return c.json({ ok: true });
  });
  app.all('/api/free', (c) => c.json({ tenant: c.get('tenant') === undefined }));
  return { app, memberships, mandates, tenants, seen };
}

async function bearer(userId: string = USER_1): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await jwt.issue(userId, NOW_SEC)}` };
}

async function problemOf(response: Response): Promise<ProblemDetails> {
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  return ProblemDetailsSchema.parse(await response.clone().json());
}

describe('TenantRouter : authentification', () => {
  it('refuse une requête sans JWT (401 problem+json)', async () => {
    const { app } = harness();
    const response = await app.request('/api/x', { headers: { [COMPANY_ID_HEADER]: COMPANY_A } });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect((await problemOf(response)).errorCode).toBe('AUTH_REQUIRED');
  });

  it('refuse un JWT invalide, falsifié, expiré ou un mfa_challenge_token', async () => {
    const { app, memberships, tenants } = harness();
    const good = await jwt.issue(USER_1, NOW_SEC);
    const expired = await jwt.issue(USER_1, NOW_SEC - 10_000);
    const [h, p, s] = good.split('.');
    const tampered = `${h}.${btoa(JSON.stringify({ sub: USER_2 })).replace(/=+$/, '')}.${s}`;
    for (const token of ['pas-un-jwt', tampered, expired, `${h}.${p}.AAAA`, 'fmc1.abcdef.012345', '']) {
      const response = await app.request('/api/x', { headers: { Authorization: `Bearer ${token}`, [COMPANY_ID_HEADER]: COMPANY_A } });
      expect(response.status, token).toBe(401);
    }
    const noBearer = await app.request('/api/x', { headers: { Authorization: `Basic ${good}`, [COMPANY_ID_HEADER]: COMPANY_A } });
    expect(noBearer.status).toBe(401);
    expect(memberships.calls).toHaveLength(0);
    expect(tenants.requested).toHaveLength(0);
  });

  it("n'a pas d'effet de bord sur un JWT valide : l'identité vient du jeton vérifié", async () => {
    const { app, seen } = harness();
    const response = await app.request('/api/x', { headers: { ...(await bearer()), [COMPANY_ID_HEADER]: COMPANY_A, 'X-User-Id': USER_2 } });
    expect(response.status).toBe(200);
    expect(seen.tenant?.userId).toBe(USER_1);
  });
});

describe('TenantRouter : sélection et résolution du dossier', () => {
  it('place dans le contexte un objet en lecture seule, base résolue côté serveur', async () => {
    const { app, seen, tenants } = harness();
    const response = await app.request('/api/x', { headers: { ...(await bearer()), [COMPANY_ID_HEADER]: COMPANY_A } });
    expect(response.status).toBe(200);
    expect(seen.tenant).toMatchObject({ userId: USER_1, role: 'CHEF_MISSION', companyId: COMPANY_A, plan: 'PLAN_TEST', organizationId: 'org-1' });
    expect(seen.tenant?.tenantDb).toBe(tenants.drivers.get(COMPANY_A));
    expect(tenants.requested).toEqual([COMPANY_A]);
    expect(Object.isFrozen(seen.tenant)).toBe(true);
    expect(() => {
      if (seen.tenant !== undefined) {
        Object.assign(seen.tenant, { companyId: COMPANY_B });
      }
    }).toThrow(TypeError);
  });

  it('un dossier non autorisé et un dossier inconnu donnent exactement la même réponse', async () => {
    const { app, tenants } = harness();
    const headers = await bearer();
    const forbidden = await app.request('/api/x', { headers: { ...headers, [COMPANY_ID_HEADER]: COMPANY_B } });
    const unknown = await app.request('/api/x', { headers: { ...headers, [COMPANY_ID_HEADER]: '018f3b5e-7c2a-7d3e-8a1b-0000000000ff' } });
    expect(forbidden.status).toBe(403);
    expect(unknown.status).toBe(403);
    const a = await forbidden.json();
    const b = await unknown.json();
    expect({ ...a, traceId: '', instance: '' }).toEqual({ ...b, traceId: '', instance: '' });
    expect(a).toMatchObject({ errorCode: 'ABAC_TENANT_OUT_OF_SCOPE' });
    expect(tenants.requested).toHaveLength(0);
  });

  it("refuse un en-tête falsifié : format invalide, absent, multiple ou chemin d'évasion", async () => {
    const { app, memberships } = harness();
    const headers = await bearer();
    for (const value of ['../etc', 'a b', 'x'.repeat(65), `${COMPANY_A}, ${COMPANY_B}`, "soc'; DROP TABLE x;--", 'control-plane', '']) {
      const response = await app.request('/api/x', { headers: { ...headers, [COMPANY_ID_HEADER]: value } });
      expect(response.status, value).toBe(400);
    }
    const missing = await app.request('/api/x', { headers });
    expect(missing.status).toBe(400);
    expect(memberships.calls).toHaveLength(0);
  });

  it('rejette un tenantId/companyId dans le corps JSON (tous niveaux) ou la requête', async () => {
    const { app, tenants } = harness();
    const headers = { ...(await bearer()), [COMPANY_ID_HEADER]: COMPANY_A, 'Content-Type': 'application/json' };
    const bodies = [
      { companyId: COMPANY_B },
      { tenantId: COMPANY_B },
      { company_id: COMPANY_B },
      { TENANT_ID: COMPANY_B },
      { data: { items: [{ nested: { companyId: COMPANY_A } }] } },
      { d1_database_uuid: 'abc' },
    ];
    for (const body of bodies) {
      const response = await app.request('/api/x', { method: 'POST', headers, body: JSON.stringify(body) });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json())).toMatchObject({ errorCode: 'TENANT_SELECTOR_FORBIDDEN' });
    }
    const query = await app.request(`/api/x?companyId=${COMPANY_B}`, { headers });
    expect(query.status).toBe(400);
    const invalidJson = await app.request('/api/x', { method: 'POST', headers, body: '{pas du json' });
    expect(invalidJson.status).toBe(400);
    expect(tenants.requested).toHaveLength(0);
    const fine = await app.request('/api/x', { method: 'POST', headers, body: JSON.stringify({ label: 'ok', companyName: 'Atlas' }) });
    expect(fine.status).toBe(200);
  });

  it("n'accepte jamais d'identifiant de base du client : seule la base issue de l'appartenance est servie", async () => {
    const { app, tenants } = harness();
    const response = await app.request('/api/x', {
      headers: { ...(await bearer()), [COMPANY_ID_HEADER]: COMPANY_A, 'X-Fisca-Database-Id': COMPANY_B },
    });
    expect(response.status).toBe(200);
    expect(tenants.requested).toEqual([COMPANY_A]);
  });

  it("n'utilise jamais l'en-tête pour une route IA/MCP : le dossier vient du jeton lié", async () => {
    const mcp = harness(COMPANY_A, () => MCP);
    const response = await mcp.app.request('/api/x', { headers: { ...(await bearer()), [COMPANY_ID_HEADER]: COMPANY_B } });
    expect(response.status).toBe(200);
    expect(mcp.seen.tenant?.companyId).toBe(COMPANY_A);
    expect(mcp.memberships.calls).toEqual([{ userId: USER_1, companyId: COMPANY_A }]);
    const unbound = harness(null, () => MCP);
    const refused = await unbound.app.request('/api/x', { headers: { ...(await bearer()), [COMPANY_ID_HEADER]: COMPANY_A } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ errorCode: 'ABAC_TENANT_OUT_OF_SCOPE' });
    expect(unbound.memberships.calls).toHaveLength(0);
  });

  it('une route hors périmètre dossier ne lit ni en-tête ni base', async () => {
    const { app, tenants, memberships } = harness(null, () => NO_TENANT);
    const response = await app.request('/api/free', { headers: { ...(await bearer()), [COMPANY_ID_HEADER]: COMPANY_B } });
    expect(await response.json()).toEqual({ tenant: true });
    expect(tenants.requested).toHaveLength(0);
    expect(memberships.calls).toHaveLength(0);
  });

  it("honore un mandat actif et refuse un mandat révoqué (port MandateResolver)", async () => {
    const { app, mandates, seen } = harness();
    grantMandate(mandates, USER_2, COMPANY_B, 'EXPERT_COMPTABLE_OEC', { organizationId: 'org-client' });
    const ok = await app.request('/api/x', { headers: { ...(await bearer(USER_2)), [COMPANY_ID_HEADER]: COMPANY_B } });
    expect(ok.status).toBe(200);
    expect(seen.tenant).toMatchObject({ accessKind: 'MANDATE', organizationId: 'org-client', role: 'EXPERT_COMPTABLE_OEC' });
    mandates.mandates.delete(`${USER_2}|${COMPANY_B}`);
    const revoked = await app.request('/api/x', { headers: { ...(await bearer(USER_2)), [COMPANY_ID_HEADER]: COMPANY_B } });
    expect(revoked.status).toBe(403);
  });

  it('échec fermé : sans résolveur de mandat, un accès cabinet est refusé (403 identique à un dossier inconnu)', async () => {
    const { app, mandates, tenants } = harness(null, () => HUMAN, false);
    grantMandate(mandates, USER_2, COMPANY_B);
    const response = await app.request('/api/x', { headers: { ...(await bearer(USER_2)), [COMPANY_ID_HEADER]: COMPANY_B } });
    expect(response.status).toBe(403);
    expect((await problemOf(response)).errorCode).toBe('ABAC_TENANT_OUT_OF_SCOPE');
    expect(tenants.requested).toHaveLength(0);
  });

  it('le résolveur d\'appartenances ne peut pas conférer un mandat : accessKind MANDATE est ignoré', async () => {
    const { app, memberships, mandates } = harness();
    grant(memberships, USER_2, COMPANY_B, 'EXPERT_COMPTABLE_OEC', { accessKind: 'MANDATE' });
    const response = await app.request('/api/x', { headers: { ...(await bearer(USER_2)), [COMPANY_ID_HEADER]: COMPANY_B } });
    expect(response.status).toBe(403);
    expect(mandates.calls).toEqual([{ userId: USER_2, companyId: COMPANY_B }]);
  });

  it("l'appartenance directe prévaut : le résolveur de mandat n'est pas interrogé", async () => {
    const { app, mandates, seen } = harness();
    const response = await app.request('/api/x', { headers: { ...(await bearer()), [COMPANY_ID_HEADER]: COMPANY_A } });
    expect(response.status).toBe(200);
    expect(seen.tenant?.accessKind).toBe('MEMBERSHIP');
    expect(mandates.calls).toHaveLength(0);
  });

  it('résolveur de mandat en panne : 503 sans détail', async () => {
    const { app, mandates } = harness();
    mandates.failing = true;
    const response = await app.request('/api/x', { headers: { ...(await bearer(USER_2)), [COMPANY_ID_HEADER]: COMPANY_B } });
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).not.toContain('tenant_key_grants');
  });

  it("refuse à la frontière HTTP un X-Fisca-Company-Id qui n'est pas un UUIDv7 (400, base jamais ouverte)", async () => {
    const { app, tenants, memberships } = harness();
    for (const bad of ['soc-alpha', '018f3b5e-7c2a-4d3e-8a1b-00000000a001', '018f3b5e7c2a7d3e8a1b00000000a001']) {
      const response = await app.request('/api/x', { headers: { ...(await bearer()), [COMPANY_ID_HEADER]: bad } });
      expect(response.status).toBe(400);
      expect((await problemOf(response)).errorCode).toBe('COMPANY_ID_INVALID');
    }
    expect(tenants.requested).toHaveLength(0);
    expect(memberships.calls).toHaveLength(0);
  });
});

describe('TenantRouter : échec fermé', () => {
  it('base indisponible : 503 problem+json sans détail', async () => {
    const { app, tenants } = harness();
    tenants.failWith = new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
    const response = await app.request('/api/x', { headers: { ...(await bearer()), [COMPANY_ID_HEADER]: COMPANY_A } });
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).not.toContain('10.0.0.5');
    expect(text).not.toContain('hunter2');
    expect(JSON.parse(text)).toMatchObject({ errorCode: 'TENANT_UNAVAILABLE' });
  });

  it('migration JIT en échec : 503 ; route introuvable côté infra : même refus que dossier inconnu', async () => {
    const { app, tenants } = harness();
    const headers = { ...(await bearer()), [COMPANY_ID_HEADER]: COMPANY_A };
    tenants.failWith = new SchemaMigrationError('SCHEMA_CHECKSUM_MISMATCH', 'v3 sha différent');
    expect((await app.request('/api/x', { headers })).status).toBe(503);
    tenants.failWith = new InfrastructureError('INFRA_TENANT_NOT_FOUND', 'aucune base');
    const response = await app.request('/api/x', { headers });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ errorCode: 'ABAC_TENANT_OUT_OF_SCOPE' });
  });

  it("résolveur d'appartenances en panne : 503, la base n'est pas ouverte", async () => {
    const { app, memberships, tenants } = harness();
    memberships.failing = true;
    const response = await app.request('/api/x', { headers: { ...(await bearer()), [COMPANY_ID_HEADER]: COMPANY_A } });
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).not.toContain('organization_memberships');
    expect(tenants.requested).toHaveLength(0);
  });
});
