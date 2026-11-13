import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { ProblemDetailsSchema } from '@fisca/shared-types';
import { createProblemErrorHandler } from './problem-details.ts';
import {
  ENTITLEMENT_CACHE_MAX_TTL_SEC,
  ENTITLEMENT_CACHE_MIN_TTL_SEC,
  createEntitlementGuard,
  entitlementCacheKey,
  invalidateEntitlementCache,
  type EntitlementRows,
} from './entitlement-guard.ts';
import type { PipelineEnv, RoutePolicy } from './tenant-router.ts';
import { COMPANY_A, ORG_1, T0_MS, USER_1, activeRows, createFakeDriver, createFakeEntitlements, createFakeKv, createTestClock } from './pipeline-test-support.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const TTL_SEC = 120;

function setup(rows: EntitlementRows | null, policy: Partial<RoutePolicy> = {}, ttlSec: number = TTL_SEC) {
  const clock = createTestClock();
  const kv = createFakeKv(clock);
  const source = createFakeEntitlements(rows);
  const routePolicy: RoutePolicy = { audience: 'HUMAN_API', tenantScope: 'COMPANY', featureKey: 'feature_x', legalExport: false, ...policy };
  const app = new Hono<PipelineEnv>();
  app.onError(createProblemErrorHandler());
  app.use('*', async (c, next) => {
    c.set('tenant', Object.freeze({
      userId: USER_1, role: 'OWNER_GERANT', companyId: COMPANY_A, organizationId: ORG_1,
      accessKind: 'MEMBERSHIP', plan: 'PLAN_TEST', canAccessPayrollPii: true, tenantDb: createFakeDriver(COMPANY_A),
    }));
    c.set('routePolicy', routePolicy);
    await next();
  });
  app.use('*', createEntitlementGuard({ source, kv, nowMs: clock.nowMs, cacheTtlSec: ttlSec }));
  app.all('/r', (c) => c.json({ ok: true, plan: c.get('entitlements')?.planCode ?? null }));
  return { app, clock, kv, source };
}

const send = (app: Hono<PipelineEnv>, method: string) => app.request('/r', { method });

describe('EntitlementGuard : droits du plan', () => {
  it('accorde une fonctionnalité présente dans les lignes du plan', async () => {
    const { app } = setup(activeRows(['feature_x']));
    const response = await send(app, 'POST');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, plan: 'PLAN_TEST' });
  });

  it('refuse une fonctionnalité absente ou à bool_value faux (403 ENTITLEMENT_UPGRADE_REQUIRED)', async () => {
    for (const rows of [
      activeRows(['autre']),
      activeRows([], { entitlements: [{ featureKey: 'feature_x', boolValue: false, numericLimit: null }] }),
    ]) {
      const response = await send(setup(rows).app, 'GET');
      expect(response.status).toBe(403);
      expect(response.headers.get('content-type')).toBe('application/problem+json');
      expect(ProblemDetailsSchema.parse(await response.json())).toMatchObject({ errorCode: 'ENTITLEMENT_UPGRADE_REQUIRED' });
    }
  });

  it('ne code aucun plan ni seuil : une ligne modifiée change le verdict (après invalidation ou expiration)', async () => {
    const { app, source, kv, clock } = setup(activeRows(['feature_x'], { planCode: 'PLAN_QUELCONQUE' }));
    expect((await send(app, 'POST')).status).toBe(200);
    source.rows = activeRows([], { planCode: 'PLAN_QUELCONQUE' });
    expect((await send(app, 'POST')).status).toBe(200);
    await invalidateEntitlementCache(kv, ORG_1);
    expect((await send(app, 'POST')).status).toBe(403);
    source.rows = activeRows(['feature_x'], { planCode: 'PLAN_QUELCONQUE' });
    clock.advanceMs((TTL_SEC + 1) * 1000);
    expect((await send(app, 'POST')).status).toBe(200);
  });

  it("n'exige aucune fonctionnalité quand la route n'en déclare pas", async () => {
    const { app } = setup(activeRows([]), { featureKey: null });
    expect((await send(app, 'POST')).status).toBe(200);
  });
});

describe('EntitlementGuard : RESTRICTED_READ_ONLY et sanctuarisation légale', () => {
  const restricted = activeRows(['feature_x'], { subscriptionStatus: 'RESTRICTED_READ_ONLY' });

  it('refuse POST, PUT, PATCH et DELETE (403 ENTITLEMENT_READ_ONLY_MODE)', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await send(setup(restricted).app, method);
      expect(response.status, method).toBe(403);
      expect(await response.json()).toMatchObject({ errorCode: 'ENTITLEMENT_READ_ONLY_MODE' });
    }
  });

  it('admet les lectures (GET, HEAD) et la route marquée export décennal Art. 211 CGI, même en POST', async () => {
    expect((await send(setup(restricted).app, 'GET')).status).toBe(200);
    expect((await send(setup(restricted).app, 'HEAD')).status).toBe(200);
    expect((await send(setup(restricted, { legalExport: true, featureKey: 'absente' }).app, 'POST')).status).toBe(200);
    expect((await send(setup(restricted, { legalExport: true, featureKey: 'absente' }).app, 'GET')).status).toBe(200);
  });

  it('bloque aussi les appels IA/MCP en lecture seule (suspension des agents IA)', async () => {
    expect((await send(setup(restricted, { audience: 'AI_MCP' }).app, 'GET')).status).toBe(403);
  });

  it('PAST_DUE_GRACE_14D : ouvert tant que grace_ends_at (ligne lue) n’est pas dépassé, fermé ensuite', async () => {
    const graceEndsAt = new Date(T0_MS + 2 * DAY_MS).toISOString();
    const setRows = setup(activeRows(['feature_x'], { subscriptionStatus: 'PAST_DUE_GRACE_14D', graceEndsAt }));
    expect((await send(setRows.app, 'POST')).status).toBe(200);
    setRows.clock.advanceMs(2 * DAY_MS + 1000);
    const afterGrace = await send(setRows.app, 'POST');
    expect(afterGrace.status).toBe(403);
    expect(await afterGrace.json()).toMatchObject({ errorCode: 'ENTITLEMENT_READ_ONLY_MODE' });
    expect((await send(setRows.app, 'GET')).status).toBe(200);
  });

  it('PAST_DUE sans date de fin de grâce et CANCELED_WORM_PRESERVED : échec fermé sur les mutations', async () => {
    const noGrace = setup(activeRows(['feature_x'], { subscriptionStatus: 'PAST_DUE_GRACE_14D', graceEndsAt: null }));
    expect((await send(noGrace.app, 'POST')).status).toBe(403);
    const unreadable = setup(activeRows(['feature_x'], { subscriptionStatus: 'PAST_DUE_GRACE_14D', graceEndsAt: 'pas-une-date' }));
    expect((await send(unreadable.app, 'POST')).status).toBe(403);
    const canceled = setup(activeRows(['feature_x'], { subscriptionStatus: 'CANCELED_WORM_PRESERVED' }));
    expect((await send(canceled.app, 'POST')).status).toBe(403);
    expect((await send(canceled.app, 'GET')).status).toBe(200);
  });
});

describe('EntitlementGuard : cache KV FISCA_FAST_KV', () => {
  it('miss puis hit : la source n’est lue qu’une fois, écriture avec expirationTtl borné', async () => {
    const { app, source, kv } = setup(activeRows(['feature_x']));
    await send(app, 'GET');
    await send(app, 'GET');
    expect(source.loads).toBe(1);
    expect(kv.counters.puts).toBe(1);
    const entry = kv.store.get(entitlementCacheKey(ORG_1));
    expect(entry?.expiresAtMs).toBe(T0_MS + TTL_SEC * 1000);
  });

  it('expiré : relit la source après la durée de vie, même si le KV renvoie encore l’entrée', async () => {
    const { app, source, kv, clock } = setup(activeRows(['feature_x']));
    await send(app, 'GET');
    const cached = kv.store.get(entitlementCacheKey(ORG_1));
    clock.advanceMs((TTL_SEC + 5) * 1000);
    if (cached !== undefined) {
      kv.store.set(entitlementCacheKey(ORG_1), { value: cached.value, expiresAtMs: null });
    }
    await send(app, 'GET');
    expect(source.loads).toBe(2);
  });

  it("l'invalidation (webhook de réactivation) force la relecture", async () => {
    const { app, source, kv } = setup(activeRows(['feature_x'], { subscriptionStatus: 'RESTRICTED_READ_ONLY' }));
    expect((await send(app, 'POST')).status).toBe(403);
    source.rows = activeRows(['feature_x']);
    await invalidateEntitlementCache(kv, ORG_1);
    expect((await send(app, 'POST')).status).toBe(200);
    expect(kv.counters.deletes).toBe(1);
  });

  it('KV en panne en lecture ou écriture : la source reste la vérité, rien ne fuit', async () => {
    const { app, kv, source } = setup(activeRows(['feature_x']));
    kv.failGets = true;
    kv.failPuts = true;
    const response = await send(app, 'POST');
    expect(response.status).toBe(200);
    expect(source.loads).toBe(1);
  });

  it('entrée de cache corrompue ou falsifiée : traitée comme un miss', async () => {
    const { app, kv, source } = setup(activeRows(['feature_x']));
    for (const value of ['{pas du json', '{"v":1}', '{"v":1,"cachedAtMs":1,"snapshot":{"planCode":3}}', 'null']) {
      kv.store.set(entitlementCacheKey(ORG_1), { value, expiresAtMs: null });
      expect((await send(app, 'GET')).status).toBe(200);
    }
    expect(source.loads).toBe(4);
  });

  it('sans abonnement : 403 ENTITLEMENT_SUBSCRIPTION_MISSING, jamais mis en cache ; source en panne : 503', async () => {
    const missing = setup(null);
    const response = await send(missing.app, 'GET');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ errorCode: 'ENTITLEMENT_SUBSCRIPTION_MISSING' });
    expect(missing.kv.counters.puts).toBe(0);
    const broken = setup(activeRows(['feature_x']));
    broken.source.failing = true;
    const failed = await send(broken.app, 'GET');
    const text = await failed.text();
    expect(failed.status).toBe(503);
    expect(text).not.toContain('subscriptions');
  });

  it('refuse une durée de cache hors bornes', () => {
    const clock = createTestClock();
    const base = { source: createFakeEntitlements(null), kv: createFakeKv(clock), nowMs: clock.nowMs };
    expect(() => createEntitlementGuard({ ...base, cacheTtlSec: ENTITLEMENT_CACHE_MIN_TTL_SEC - 1 })).toThrow();
    expect(() => createEntitlementGuard({ ...base, cacheTtlSec: ENTITLEMENT_CACHE_MAX_TTL_SEC + 1 })).toThrow();
    expect(() => createEntitlementGuard({ ...base, cacheTtlSec: 90.5 })).toThrow();
    expect(() => createEntitlementGuard({ ...base, cacheTtlSec: ENTITLEMENT_CACHE_MIN_TTL_SEC })).not.toThrow();
  });
});
