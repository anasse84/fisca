/** `TenantContext.activeCpaMandate` : renseigné selon la voie d'accès (mandat = true ; appartenance directe = présence d'un mandat actif ; inconnu = null). */
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { createProblemErrorHandler } from './problem-details.ts';
import type { CpaMandatePresence } from './mandate-resolver.ts';
import { COMPANY_ID_HEADER, createAccessTokenAuthenticator, createAuthenticationMiddleware, createTenantRouter, type PipelineEnv, type RoutePolicy, type TenantContext } from './tenant-router.ts';
import { COMPANY_A, COMPANY_B, T0_MS, USER_1, USER_2, createFakeMandates, createFakeMemberships, createFakeTenants, createTestJwt, grant, grantMandate, type TestJwt } from './pipeline-test-support.ts';

const NOW_SEC = Math.floor(T0_MS / 1000);
const HUMAN: RoutePolicy = { audience: 'HUMAN_API', tenantScope: 'COMPANY', featureKey: null, legalExport: false };

let jwt: TestJwt;
beforeAll(async () => {
  jwt = await createTestJwt();
});

function build(presence: CpaMandatePresence | undefined) {
  const memberships = createFakeMemberships();
  const mandates = createFakeMandates();
  grant(memberships, USER_1, COMPANY_A, 'OWNER_GERANT');
  const seen: { tenant: TenantContext | undefined } = { tenant: undefined };
  const app = new Hono<PipelineEnv>();
  app.onError(createProblemErrorHandler());
  app.use('*', createAuthenticationMiddleware({ authenticator: createAccessTokenAuthenticator({ verify: (token) => jwt.verify(token, NOW_SEC) }) }));
  app.use('*', createTenantRouter({ routePolicy: () => HUMAN, memberships, mandates, tenants: createFakeTenants([COMPANY_A, COMPANY_B]), ...(presence === undefined ? {} : { cpaMandatePresence: presence }) }));
  app.all('/api/x', (c) => {
    seen.tenant = c.get('tenant');
    return c.json({ ok: true });
  });
  return { app, mandates, seen };
}

async function call(app: Hono<PipelineEnv>, user: string, company: string): Promise<Response> {
  return app.request('/api/x', { headers: { Authorization: `Bearer ${await jwt.issue(user, NOW_SEC)}`, [COMPANY_ID_HEADER]: company } });
}

describe('TenantContext.activeCpaMandate', () => {
  it('appartenance directe sans mandat actif connu : false', async () => {
    const { app, seen } = build({ hasActiveMandate: async () => false });
    expect((await call(app, USER_1, COMPANY_A)).status).toBe(200);
    expect(seen.tenant).toMatchObject({ accessKind: 'MEMBERSHIP', activeCpaMandate: false });
  });

  it('appartenance directe MAIS dossier sous mandat cabinet actif : true', async () => {
    const { app, seen } = build({ hasActiveMandate: async (companyId) => companyId === COMPANY_A });
    expect((await call(app, USER_1, COMPANY_A)).status).toBe(200);
    expect(seen.tenant).toMatchObject({ accessKind: 'MEMBERSHIP', activeCpaMandate: true });
  });

  it('accès par mandat : true, sans interroger le port de présence', async () => {
    let asked = 0;
    const { app, mandates, seen } = build({ hasActiveMandate: async () => { asked += 1; return false; } });
    grantMandate(mandates, USER_2, COMPANY_B);
    expect((await call(app, USER_2, COMPANY_B)).status).toBe(200);
    expect(seen.tenant).toMatchObject({ accessKind: 'MANDATE', activeCpaMandate: true });
    expect(asked).toBe(0);
  });

  it('défaut sûr : sans port de présence, l\'information est inconnue (null)', async () => {
    const { app, seen } = build(undefined);
    expect((await call(app, USER_1, COMPANY_A)).status).toBe(200);
    expect(seen.tenant?.activeCpaMandate).toBeNull();
  });

  it('port de présence en panne : 503 sans détail, aucun contexte posé', async () => {
    const { app, seen } = build({ hasActiveMandate: async () => { throw new Error('company_cpa_mandates injoignable'); } });
    const response = await call(app, USER_1, COMPANY_A);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('company_cpa_mandates');
    expect(seen.tenant).toBeUndefined();
  });
});
