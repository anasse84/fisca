import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { createProblemErrorHandler } from '../core/problem-details.ts';
import {
  createAccessTokenAuthenticator, createAuthenticationMiddleware, createTenantRouter, type PipelineEnv, type RoutePolicy,
} from '../core/tenant-router.ts';
import {
  COMPANY_A, COMPANY_B, T0_MS, USER_1, USER_2, createFakeMemberships, createFakeTenants, createTestJwt, grant, type TestJwt,
} from '../core/pipeline-test-support.ts';

/** Tests adverses de l'auditeur, G1 tour 2 : intrusion inter-sociétés au niveau HTTP (TenantRouter, R2-C1). */
const NOW = Math.floor(T0_MS / 1000);
const HUMAN: RoutePolicy = { audience: 'HUMAN_API', tenantScope: 'COMPANY', featureKey: null, legalExport: false };
let jwt: TestJwt;
beforeAll(async () => { jwt = await createTestJwt(); });

function build() {
  const memberships = createFakeMemberships(); grant(memberships, USER_1, COMPANY_A, 'OWNER_GERANT');
  const seen: { company: string | undefined } = { company: undefined };
  const auth = createAccessTokenAuthenticator({ verify: (t) => jwt.verify(t, NOW) });
  const app = new Hono<PipelineEnv>(); app.onError(createProblemErrorHandler());
  app.use('*', createAuthenticationMiddleware({ authenticator: auth }));
  app.use('*', createTenantRouter({ routePolicy: () => HUMAN, memberships, tenants: createFakeTenants([COMPANY_A, COMPANY_B]) }));
  app.all('/api/x', (c) => { seen.company = c.get('tenant')?.companyId; return c.json({ ok: true }); });
  return { app, seen };
}
const headersOf = async (user: string, company?: string, extra: Record<string, string> = {}): Promise<Record<string, string>> => ({
  Authorization: `Bearer ${await jwt.issue(user, NOW)}`, ...(company === undefined ? {} : { 'X-Fisca-Company-Id': company }), ...extra,
});

describe('G1 adverse — intrusion inter-sociétés (HTTP)', () => {
  it('société autorisée : 200 et tenant résolu côté serveur', async () => {
    const { app, seen } = build();
    expect((await app.request('/api/x', { headers: await headersOf(USER_1, COMPANY_A) })).status).toBe(200);
    expect(seen.company).toBe(COMPANY_A);
  });
  it('autre société existante, société inconnue et autre utilisateur : même refus 403, même corps (aucun oracle d\'existence)', async () => {
    const { app } = build();
    const bodies: string[] = [];
    for (const [u, c] of [[USER_1, COMPANY_B], [USER_1, 'inconnue_zzz'], [USER_2, COMPANY_A]] as const) {
      const r = await app.request('/api/x', { headers: await headersOf(u, c) });
      expect(r.status, `${u} ${c}`).toBe(403);
      const j = (await r.json()) as Record<string, unknown>; delete j['traceId']; bodies.push(JSON.stringify(j));
    }
    expect(new Set(bodies).size, bodies.join('\n')).toBe(1);
  });
  it('sélecteurs interdits : corps JSON imbriqué, formulaire, requête ; jamais d\'accès à B', async () => {
    const { app, seen } = build();
    const h = await headersOf(USER_1, COMPANY_A, { 'Content-Type': 'application/json' });
    for (const body of [{ companyId: COMPANY_B }, { a: { b: [{ tenant_id: COMPANY_B }] } }, { 'Company-Id': COMPANY_B }, { databaseId: 'x' }]) {
      const r = await app.request('/api/x', { method: 'POST', headers: h, body: JSON.stringify(body) });
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await app.request('/api/x?tenantId=' + COMPANY_B, { headers: await headersOf(USER_1, COMPANY_A) })).status).toBe(400);
    const f = await app.request('/api/x', { method: 'POST', headers: await headersOf(USER_1, COMPANY_A, { 'Content-Type': 'application/x-www-form-urlencoded' }), body: `companyId=${COMPANY_B}` });
    expect(f.status).toBe(400);
    expect(seen.company).toBeUndefined();
  });
  it('en-tête malformé ou ambigu : jamais 200 vers B', async () => {
    const { app, seen } = build();
    for (const v of [`${COMPANY_A}, ${COMPANY_B}`, ` ${COMPANY_B}`, COMPANY_A.toUpperCase(), `${COMPANY_A}/../${COMPANY_B}`, '']) {
      seen.company = undefined;
      const r = await app.request('/api/x', { headers: await headersOf(USER_1, v) });
      expect(r.status === 200 ? seen.company : 'refusé', `en-tête « ${v} »`).not.toBe(COMPANY_B);
    }
  });
  it('jetons : mfa_challenge_token, alg=none, signature altérée, absent : 401', async () => {
    const { app } = build();
    const good = await jwt.issue(USER_1, NOW); const [h, p, s] = good.split('.');
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`;
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), sub: USER_2 })).toString('base64url')}.${s}`;
    for (const t of ['fmc1.eyJzdWIiOiJ1c2VyLTEifQ.AAAA', none, tampered]) {
      const r = await app.request('/api/x', { headers: { Authorization: `Bearer ${t}`, 'X-Fisca-Company-Id': COMPANY_A } });
      expect(r.status, t.slice(0, 20)).toBe(401);
    }
    expect((await app.request('/api/x', { headers: { 'X-Fisca-Company-Id': COMPANY_A } })).status).toBe(401);
  });
});
