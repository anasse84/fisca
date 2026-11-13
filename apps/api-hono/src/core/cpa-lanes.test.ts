import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { evaluateAccessPolicy, type AuthorizationContext } from '@fisca/auth-rbac';
import type { SqlStatementParams, TenantSqlDriver } from '@fisca/shared-types';
import {
  CABINET,
  CABINET_2,
  CO_CLOUD,
  CO_E2EE,
  OWNER_ORG,
  U_AIDE,
  U_CHEF,
  U_GRANTER,
  U_OEC,
  U_STRANGER,
  exec,
  openControlPlaneBackend,
  seedCpaWorld,
  seedKeyGrant,
  seedMandate,
  seedMembership,
  type ControlPlaneBackend,
} from './cpa-test-support.ts';
import { effectivePayrollPiiClearance } from './ledger-api.ts';
import { openSqliteBackend } from './ledger-test-harness.ts';
import {
  createSqlMandateResolver,
  createSqlRevokeGrantsPort,
  createSqlTenantKeyGrantReader,
  revokeCpaMandate,
  type RevokeGrantsPort,
  type TenantKeyGrantReader,
} from './mandate-resolver.ts';
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
import { T0_MS, createFakeMemberships, createTestJwt, grant, type TestJwt } from './pipeline-test-support.ts';

const NOW_SEC = Math.floor(T0_MS / 1000);
const HUMAN: RoutePolicy = { audience: 'HUMAN_API', tenantScope: 'COMPANY', featureKey: null, legalExport: false };
const REVOKED_AT = '2026-11-20T09:00:00Z';

let jwt: TestJwt;
beforeAll(async () => {
  jwt = await createTestJwt();
});

interface Rig {
  readonly control: ControlPlaneBackend;
  readonly tenantDbs: ReadonlyMap<string, TenantSqlDriver>;
  readonly memberships: ReturnType<typeof createFakeMemberships>;
  readonly log: string[];
  readonly opened: string[];
  readonly controlQueries: SqlStatementParams[];
  readonly seen: { tenant: TenantContext | undefined };
  readonly app: Hono<PipelineEnv>;
  readonly revokeGrants: RevokeGrantsPort;
  readonly provider: { getTenantDbUpToDate(companyId: string): Promise<TenantSqlDriver> };
  request(user: string, company: string): Promise<Response>;
}

async function buildRig(options: { readonly withGrantReader?: boolean; readonly readerFails?: boolean } = {}): Promise<Rig> {
  const control = await openControlPlaneBackend('sqlite');
  await seedCpaWorld(control.driver);
  const cloud = (await openSqliteBackend()).driver;
  const e2ee = (await openSqliteBackend()).driver;
  const tenantDbs = new Map<string, TenantSqlDriver>([[CO_CLOUD, cloud], [CO_E2EE, e2ee]]);
  const log: string[] = [];
  const opened: string[] = [];
  const controlQueries: SqlStatementParams[] = [];
  const provider = {
    getTenantDbUpToDate: async (companyId: string): Promise<TenantSqlDriver> => {
      opened.push(companyId);
      log.push(`open:${companyId}`);
      const driver = tenantDbs.get(companyId);
      if (driver === undefined) {
        throw new Error('base inconnue');
      }
      return driver;
    },
  };
  const spiedControl: TenantSqlDriver = {
    tenantId: control.driver.tenantId,
    query: async <TRow>(stmt: SqlStatementParams): Promise<readonly TRow[]> => {
      controlQueries.push(stmt);
      log.push('control-query');
      return control.driver.query<TRow>(stmt);
    },
    executeBatchAtomically: (statements) => control.driver.executeBatchAtomically(statements),
  };
  const sqlReader = createSqlTenantKeyGrantReader();
  const keyGrants: TenantKeyGrantReader = {
    hasActiveGrant: async (query) => {
      log.push('read-grants');
      if (options.readerFails === true) {
        throw new Error('tenant_key_grants illisible (secret-sql)');
      }
      return sqlReader.hasActiveGrant(query);
    },
  };
  const memberships = createFakeMemberships();
  grant(memberships, U_GRANTER, CO_CLOUD, 'OWNER_GERANT', { organizationId: OWNER_ORG });
  grant(memberships, U_GRANTER, CO_E2EE, 'OWNER_GERANT', { organizationId: OWNER_ORG });
  const seen: { tenant: TenantContext | undefined } = { tenant: undefined };
  const authenticator = createAccessTokenAuthenticator({ verify: (token) => jwt.verify(token, NOW_SEC) });
  const app = new Hono<PipelineEnv>();
  app.onError(createProblemErrorHandler());
  app.use('*', createAuthenticationMiddleware({ authenticator }));
  app.use(
    '*',
    createTenantRouter({
      routePolicy: () => HUMAN,
      memberships,
      mandates: createSqlMandateResolver(spiedControl),
      tenants: provider,
      ...(options.withGrantReader === false ? {} : { keyGrants }),
    }),
  );
  app.all('/api/x', (c) => {
    seen.tenant = c.get('tenant');
    return c.json({ ok: true });
  });
  return {
    control,
    tenantDbs,
    memberships,
    log,
    opened,
    controlQueries,
    seen,
    app,
    revokeGrants: createSqlRevokeGrantsPort(provider),
    provider,
    request: async (user, company) =>
      app.request('/api/x', { headers: { Authorization: `Bearer ${await jwt.issue(user, NOW_SEC)}`, [COMPANY_ID_HEADER]: company } }),
  };
}

function tenantDbOf(rig: Rig, company: string): TenantSqlDriver {
  const driver = rig.tenantDbs.get(company);
  if (driver === undefined) {
    throw new Error(`base de test absente : ${company}`);
  }
  return driver;
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.clone().json();
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('problem+json attendu');
  }
  return { ...parsed, traceId: '', instance: '' };
}

describe('TenantRouter : voies A, B et C (mandats de cabinet)', () => {
  let rig: Rig;
  beforeEach(async () => {
    rig = await buildRig();
  });

  it('voie B : mandat actif, membre actif du cabinet : autorisé avec le rôle effectif, accessKind MANDATE, organisation propriétaire et plan', async () => {
    await seedMandate(rig.control.driver, { maxRole: 'EXPERT_COMPTABLE_OEC' });
    const response = await rig.request(U_OEC, CO_CLOUD);
    expect(response.status).toBe(200);
    expect(rig.seen.tenant).toMatchObject({ userId: U_OEC, role: 'EXPERT_COMPTABLE_OEC', accessKind: 'MANDATE', organizationId: OWNER_ORG, plan: 'PLAN_TEST', companyId: CO_CLOUD });
    expect(rig.seen.tenant?.tenantDb).toBe(tenantDbOf(rig, CO_CLOUD));
    expect(rig.opened).toEqual([CO_CLOUD]);
  });

  it('mandat révoqué, absent, utilisateur hors cabinet, hors scoped_user_ids_json : 403 ABAC_TENANT_OUT_OF_SCOPE, TENANT_DB JAMAIS ouverte (espion : 0 appel)', async () => {
    const bodies: Record<string, unknown>[] = [];
    // absent
    let response = await rig.request(U_OEC, CO_CLOUD);
    bodies.push(await bodyOf(response));
    expect(response.status).toBe(403);
    // révoqué
    await seedMandate(rig.control.driver, { status: 'REVOKED' });
    response = await rig.request(U_OEC, CO_CLOUD);
    bodies.push(await bodyOf(response));
    expect(response.status).toBe(403);
    // utilisateur hors cabinet
    await exec(rig.control.driver, `UPDATE company_cpa_mandates SET status = 'ACTIVE', revoked_at = NULL`);
    response = await rig.request(U_STRANGER, CO_CLOUD);
    bodies.push(await bodyOf(response));
    expect(response.status).toBe(403);
    // hors scoped_user_ids_json
    await exec(rig.control.driver, `UPDATE company_cpa_mandates SET scoped_user_ids_json = '["${U_CHEF}"]'`);
    response = await rig.request(U_OEC, CO_CLOUD);
    bodies.push(await bodyOf(response));
    expect(response.status).toBe(403);
    // dossier inconnu
    response = await rig.request(U_OEC, 'co-inconnu');
    bodies.push(await bodyOf(response));
    expect(response.status).toBe(403);
    for (const body of bodies) {
      expect(body).toMatchObject({ errorCode: 'ABAC_TENANT_OUT_OF_SCOPE', status: 403 });
      expect(body).toEqual(bodies[0]);
    }
    expect(rig.opened).toEqual([]);
    expect(rig.log.filter((entry) => entry.startsWith('open:'))).toEqual([]);
  });

  it('scoped_user_ids_json : un utilisateur listé est autorisé, un autre membre du cabinet est refusé', async () => {
    await seedMandate(rig.control.driver, { scopedJson: `["${U_CHEF}"]` });
    expect((await rig.request(U_CHEF, CO_CLOUD)).status).toBe(200);
    expect((await rig.request(U_OEC, CO_CLOUD)).status).toBe(403);
    expect(rig.opened).toEqual([CO_CLOUD]);
  });

  it('rôle plafonné : CHEF_MISSION sous plafond AIDE_COMPTABLE devient AIDE_COMPTABLE ; AIDE_COMPTABLE sous plafond OEC reste AIDE_COMPTABLE', async () => {
    await seedMandate(rig.control.driver, { maxRole: 'AIDE_COMPTABLE' });
    expect((await rig.request(U_CHEF, CO_CLOUD)).status).toBe(200);
    expect(rig.seen.tenant?.role).toBe('AIDE_COMPTABLE');
    await exec(rig.control.driver, `UPDATE company_cpa_mandates SET max_delegated_role = 'EXPERT_COMPTABLE_OEC'`);
    expect((await rig.request(U_AIDE, CO_CLOUD)).status).toBe(200);
    expect(rig.seen.tenant?.role).toBe('AIDE_COMPTABLE');
    expect((await rig.request(U_CHEF, CO_CLOUD)).status).toBe(200);
    expect(rig.seen.tenant?.role).toBe('CHEF_MISSION');
  });

  it("un plafond AUDITEUR_CAC_DGI ne donne jamais plus à CHEF_MISSION ni AIDE_COMPTABLE : 403, base non ouverte", async () => {
    await seedMandate(rig.control.driver, { maxRole: 'AUDITEUR_CAC_DGI' });
    expect((await rig.request(U_CHEF, CO_CLOUD)).status).toBe(403);
    expect((await rig.request(U_AIDE, CO_CLOUD)).status).toBe(403);
    expect(rig.opened).toEqual([]);
    expect((await rig.request(U_OEC, CO_CLOUD)).status).toBe(200);
    expect(rig.seen.tenant?.role).toBe('AUDITEUR_CAC_DGI');
  });

  it("paie : canAccessPayrollPii du contexte = can_access_payroll_pii du mandat (false par défaut) ; la lecture 9421 reste refusée sans l'attribut du mandat, même si l'utilisateur a le sien", async () => {
    await seedMandate(rig.control.driver, { payrollPii: 0 });
    expect((await rig.request(U_OEC, CO_CLOUD)).status).toBe(200);
    const withoutMandateFlag = rig.seen.tenant;
    expect(withoutMandateFlag?.canAccessPayrollPii).toBe(false);
    expect(effectivePayrollPiiClearance(withoutMandateFlag?.canAccessPayrollPii ?? true, true)).toBe(false);
    await exec(rig.control.driver, 'UPDATE company_cpa_mandates SET can_access_payroll_pii = 1');
    expect((await rig.request(U_OEC, CO_CLOUD)).status).toBe(200);
    const withFlag = rig.seen.tenant;
    expect(withFlag?.canAccessPayrollPii).toBe(true);
    expect(effectivePayrollPiiClearance(withFlag?.canAccessPayrollPii ?? false, true)).toBe(true);
    expect(effectivePayrollPiiClearance(withFlag?.canAccessPayrollPii ?? false, false)).toBe(false);
    const context = (canAccessPayrollPii: boolean): AuthorizationContext => ({
      actorId: U_OEC,
      role: 'EXPERT_COMPTABLE_OEC',
      companyId: CO_CLOUD,
      assignedCompanyIds: [CO_CLOUD],
      orgPlanSegment: 'FIDUCIAIRE',
      activeHumanMembersCount: 5,
      subscriptionReadOnly: false,
      fiscalYearClosed: false,
      canAccessPayrollPii,
      nowEpochSec: NOW_SEC,
    });
    const denied = evaluateAccessPolicy('PAYROLL_9421_READ_EXPORT', context(effectivePayrollPiiClearance(false, true)));
    expect(denied).toMatchObject({ allowed: false, denialCode: 'ABAC_PAYROLL_PII_CLEARANCE_MISSING' });
    expect(evaluateAccessPolicy('PAYROLL_9421_READ_EXPORT', context(effectivePayrollPiiClearance(true, true))).allowed).toBe(true);
  });

  it("voie A prioritaire : un utilisateur à la fois membre direct et membre mandaté du cabinet reçoit son rôle direct ; aucune requête de mandat n'est émise", async () => {
    await seedMandate(rig.control.driver, { maxRole: 'EXPERT_COMPTABLE_OEC' });
    grant(rig.memberships, U_OEC, CO_CLOUD, 'AIDE_COMPTABLE', { organizationId: OWNER_ORG });
    const response = await rig.request(U_OEC, CO_CLOUD);
    expect(response.status).toBe(200);
    expect(rig.seen.tenant).toMatchObject({ role: 'AIDE_COMPTABLE', accessKind: 'MEMBERSHIP', organizationId: OWNER_ORG });
    expect(rig.controlQueries).toEqual([]);
  });

  it("voie A sur un dossier E2EE : l'appartenance directe reste autorisée sans enveloppe de cabinet (la voie C ne s'applique qu'à l'accès par mandat)", async () => {
    const response = await rig.request(U_GRANTER, CO_E2EE);
    expect(response.status).toBe(200);
    expect(rig.seen.tenant?.accessKind).toBe('MEMBERSHIP');
    expect(rig.log).not.toContain('read-grants');
  });

  it("voie C : dossier E2EE sans enveloppe : 403 identique ; la base a été ouverte AVANT la lecture des enveloppes ; aucun accès au contexte", async () => {
    await seedMandate(rig.control.driver, { companyId: CO_E2EE });
    rig.seen.tenant = undefined;
    const response = await rig.request(U_OEC, CO_E2EE);
    expect(response.status).toBe(403);
    const reference = await bodyOf(await rig.request(U_STRANGER, CO_CLOUD));
    expect(await bodyOf(response)).toEqual(reference);
    expect(rig.seen.tenant).toBeUndefined();
    const lane = rig.log.filter((entry) => entry === `open:${CO_E2EE}` || entry === 'read-grants');
    expect(lane.slice(0, 2)).toEqual([`open:${CO_E2EE}`, 'read-grants']);
  });

  it("voie C : enveloppe révoquée : 403 ; enveloppe active du cabinet ou de l'acteur : 200 ; enveloppe d'un autre cabinet ou d'un autre rôle : 403", async () => {
    await seedMandate(rig.control.driver, { companyId: CO_E2EE });
    const tenantDb = tenantDbOf(rig, CO_E2EE);
    await seedKeyGrant(tenantDb, CABINET, { revokedAt: '2026-11-14T08:00:00Z' });
    expect((await rig.request(U_OEC, CO_E2EE)).status).toBe(403);
    await seedKeyGrant(tenantDb, CABINET_2);
    expect((await rig.request(U_OEC, CO_E2EE)).status).toBe(403);
    await exec(tenantDb, `INSERT INTO tenant_key_grants (grant_id, grantee_role, grantee_actor_id, grantee_public_key_spki_b64, grantee_public_key_fingerprint_hex, dek_version, wrapped_dek_b64, wrapped_bidx_key_b64, created_at)
      VALUES ('g-owner', 'OWNER_ADMIN', '${CABINET}', 'spki', '${'b'.repeat(64)}', 1, 'v1:1:AAAA', 'v1:1:BBBB', '2026-11-13T10:00:00Z')`);
    expect((await rig.request(U_OEC, CO_E2EE)).status).toBe(403);
    await seedKeyGrant(tenantDb, CABINET, { dekVersion: 2, grantId: 'grant-cab-2' });
    const ok = await rig.request(U_OEC, CO_E2EE);
    expect(ok.status).toBe(200);
    expect(rig.seen.tenant).toMatchObject({ accessKind: 'MANDATE', companyId: CO_E2EE });
    await exec(tenantDb, 'DELETE FROM tenant_key_grants');
    await seedKeyGrant(tenantDb, U_CHEF);
    expect((await rig.request(U_CHEF, CO_E2EE)).status).toBe(200);
    expect((await rig.request(U_OEC, CO_E2EE)).status).toBe(403);
  });

  it("dossier CLOUD_ASSISTED : les enveloppes ne sont pas lues", async () => {
    await seedMandate(rig.control.driver, {});
    expect((await rig.request(U_OEC, CO_CLOUD)).status).toBe(200);
    expect(rig.log).not.toContain('read-grants');
  });
});

describe('TenantRouter : échec fermé de la voie C', () => {
  it('dossier E2EE sans lecteur d\'enveloppes configuré : refus par défaut (403)', async () => {
    const rig = await buildRig({ withGrantReader: false });
    await seedMandate(rig.control.driver, { companyId: CO_E2EE });
    await seedKeyGrant(tenantDbOf(rig, CO_E2EE), CABINET);
    const response = await rig.request(U_OEC, CO_E2EE);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ errorCode: 'ABAC_TENANT_OUT_OF_SCOPE' });
  });

  it("lecteur d'enveloppes en panne : 503 sans détail, jamais un accès", async () => {
    const rig = await buildRig({ readerFails: true });
    await seedMandate(rig.control.driver, { companyId: CO_E2EE });
    const response = await rig.request(U_OEC, CO_E2EE);
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).not.toContain('secret-sql');
    expect(text).not.toContain('tenant_key_grants');
  });
});

describe('revokeCpaMandate : procédure de bout en bout sur SQLite (plan de contrôle et base du dossier réels)', () => {
  let rig: Rig;
  const deps = (): { controlPlane: TenantSqlDriver; revokeGrants: RevokeGrantsPort; nowIso: () => string } => ({
    controlPlane: rig.control.driver,
    revokeGrants: rig.revokeGrants,
    nowIso: () => REVOKED_AT,
  });
  const grantRows = async (company: string): Promise<readonly { grantee_role: string; grantee_actor_id: string; revoked_at: string | null }[]> =>
    tenantDbOf(rig, company).query({ sql: 'SELECT grantee_role, grantee_actor_id, revoked_at FROM tenant_key_grants ORDER BY grantee_role, grantee_actor_id', params: [] });

  beforeEach(async () => {
    rig = await buildRig();
    await seedMandate(rig.control.driver, { mandateId: 'm-e2ee', companyId: CO_E2EE });
    const tenantDb = tenantDbOf(rig, CO_E2EE);
    await seedKeyGrant(tenantDb, CABINET);
    await seedKeyGrant(tenantDb, U_OEC);
    await seedKeyGrant(tenantDb, CABINET_2);
    await exec(tenantDb, `INSERT INTO tenant_key_grants (grant_id, grantee_role, grantee_actor_id, grantee_public_key_spki_b64, grantee_public_key_fingerprint_hex, dek_version, wrapped_dek_b64, wrapped_bidx_key_b64, created_at)
      VALUES ('g-owner', 'OWNER_ADMIN', '${U_GRANTER}', 'spki', '${'b'.repeat(64)}', 1, 'v1:1:AAAA', 'v1:1:BBBB', '2026-11-13T10:00:00Z')`);
  });

  it('avant révocation : voies B et C autorisent ; après : mandat REVOKED horodaté, enveloppes du cabinet et de ses membres révoquées, voie B refuse (base non ouverte), voie C refuserait aussi', async () => {
    expect((await rig.request(U_OEC, CO_E2EE)).status).toBe(200);

    const result = await revokeCpaMandate(deps(), { mandateId: 'm-e2ee' });
    // la propagation ouvre la base du dossier (port) ; on compte les ouvertures à partir de là
    const openedBefore = rig.opened.length;
    expect(result).toEqual({ mandateId: 'm-e2ee', companyId: CO_E2EE, fiduciaryOrgId: CABINET, newlyRevoked: true, revokedAt: REVOKED_AT, grantsRevoked: 2 });

    const mandate = await rig.control.driver.query({ sql: `SELECT status, revoked_at FROM company_cpa_mandates WHERE mandate_id = 'm-e2ee'`, params: [] });
    expect(mandate).toEqual([{ status: 'REVOKED', revoked_at: REVOKED_AT }]);
    expect(await grantRows(CO_E2EE)).toEqual([
      { grantee_role: 'EXTERNAL_CPA', grantee_actor_id: CABINET, revoked_at: REVOKED_AT },
      { grantee_role: 'EXTERNAL_CPA', grantee_actor_id: CABINET_2, revoked_at: null },
      { grantee_role: 'EXTERNAL_CPA', grantee_actor_id: U_OEC, revoked_at: REVOKED_AT },
      { grantee_role: 'OWNER_ADMIN', grantee_actor_id: U_GRANTER, revoked_at: null },
    ]);

    // voie B : refus, TENANT_DB non ouverte
    const refusedB = await rig.request(U_OEC, CO_E2EE);
    expect(refusedB.status).toBe(403);
    expect(rig.opened.length).toBe(openedBefore);
    expect(await bodyOf(refusedB)).toMatchObject({ errorCode: 'ABAC_TENANT_OUT_OF_SCOPE' });

    // voie C : même si le mandat était (à tort) réactivé, l'enveloppe révoquée refuse, après ouverture de la base
    await exec(rig.control.driver, `UPDATE company_cpa_mandates SET status = 'ACTIVE', revoked_at = NULL WHERE mandate_id = 'm-e2ee'`);
    const refusedC = await rig.request(U_OEC, CO_E2EE);
    expect(refusedC.status).toBe(403);
    expect(rig.opened.length).toBe(openedBefore + 1);
    expect(await bodyOf(refusedC)).toEqual(await bodyOf(refusedB));
  });

  it("idempotente : une seconde révocation ne réécrit ni revoked_at ni les enveloppes ; un mandat inconnu renvoie null", async () => {
    await revokeCpaMandate(deps(), { mandateId: 'm-e2ee' });
    const again = await revokeCpaMandate({ ...deps(), nowIso: () => '2027-01-01T00:00:00Z' }, { mandateId: 'm-e2ee' });
    expect(again).toEqual({ mandateId: 'm-e2ee', companyId: CO_E2EE, fiduciaryOrgId: CABINET, newlyRevoked: false, revokedAt: REVOKED_AT, grantsRevoked: 0 });
    expect((await grantRows(CO_E2EE)).filter((row) => row.revoked_at !== null).every((row) => row.revoked_at === REVOKED_AT)).toBe(true);
    expect(await revokeCpaMandate(deps(), { mandateId: 'inconnu' })).toBeNull();
  });

  it("panne du port d'enveloppes : le mandat est déjà REVOKED (la voie B refuse), l'erreur remonte, et un nouvel appel termine la propagation", async () => {
    const failing: RevokeGrantsPort = {
      revokeCpaGrants: async () => {
        throw new Error('base du dossier injoignable');
      },
    };
    await expect(revokeCpaMandate({ ...deps(), revokeGrants: failing }, { mandateId: 'm-e2ee' })).rejects.toThrow('injoignable');
    expect(await rig.control.driver.query({ sql: `SELECT status FROM company_cpa_mandates WHERE mandate_id = 'm-e2ee'`, params: [] })).toEqual([{ status: 'REVOKED' }]);
    expect((await rig.request(U_OEC, CO_E2EE)).status).toBe(403);
    expect((await grantRows(CO_E2EE)).filter((row) => row.revoked_at !== null)).toEqual([]);
    const retry = await revokeCpaMandate(deps(), { mandateId: 'm-e2ee' });
    expect(retry).toMatchObject({ newlyRevoked: false, grantsRevoked: 2, revokedAt: REVOKED_AT });
    expect((await grantRows(CO_E2EE)).filter((row) => row.revoked_at === REVOKED_AT)).toHaveLength(2);
  });

  it("un membre du cabinet révoqué qui appartient aussi à un autre cabinet encore mandaté sur le même dossier garde son enveloppe", async () => {
    await seedMembership(rig.control.driver, CABINET_2, U_CHEF, 'EXPERT_COMPTABLE_OEC');
    await seedMandate(rig.control.driver, { mandateId: 'm-cab2', companyId: CO_E2EE, orgId: CABINET_2 });
    await seedKeyGrant(tenantDbOf(rig, CO_E2EE), U_CHEF);
    const result = await revokeCpaMandate(deps(), { mandateId: 'm-e2ee' });
    expect(result?.grantsRevoked).toBe(2);
    const rows = await grantRows(CO_E2EE);
    expect(rows.find((row) => row.grantee_actor_id === U_CHEF)?.revoked_at).toBeNull();
    expect(rows.find((row) => row.grantee_actor_id === CABINET_2)?.revoked_at).toBeNull();
  });

  it("révoquer le mandat d'un dossier ne touche pas les enveloppes d'un autre dossier ni le mandat d'un autre cabinet", async () => {
    await seedMandate(rig.control.driver, { mandateId: 'm-cloud', companyId: CO_CLOUD });
    await seedKeyGrant(tenantDbOf(rig, CO_CLOUD), CABINET);
    await revokeCpaMandate(deps(), { mandateId: 'm-e2ee' });
    expect(await grantRows(CO_CLOUD)).toEqual([{ grantee_role: 'EXTERNAL_CPA', grantee_actor_id: CABINET, revoked_at: null }]);
    expect(await rig.control.driver.query({ sql: `SELECT status FROM company_cpa_mandates WHERE mandate_id = 'm-cloud'`, params: [] })).toEqual([{ status: 'ACTIVE' }]);
    expect((await rig.request(U_OEC, CO_CLOUD)).status).toBe(200);
  });

  it("refuse un horodatage hors format UTC du plan de contrôle sans rien écrire", async () => {
    await expect(revokeCpaMandate({ ...deps(), nowIso: () => '2026-11-20T09:00:00.000Z' }, { mandateId: 'm-e2ee' })).rejects.toThrow(/horodatage/i);
    expect(await rig.control.driver.query({ sql: `SELECT status FROM company_cpa_mandates WHERE mandate_id = 'm-e2ee'`, params: [] })).toEqual([{ status: 'ACTIVE' }]);
  });
});
