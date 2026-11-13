import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { evaluateAccessPolicy, PERMISSION_ACTIONS, type AuthorizationContext, type PermissionAction, type RoleCode } from '@fisca/auth-rbac';
import { CPA_MANDATE_DELEGABLE_ROLES } from '@fisca/db-schema';
import type { SqlStatementParams, TenantSqlDriver } from '@fisca/shared-types';
import {
  CABINET,
  CABINET_2,
  CO_CLOUD,
  CO_E2EE,
  OWNER_ORG,
  U_AIDE,
  U_AUDITOR,
  U_CAB_OWNER,
  U_CHEF,
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
import { PostgresHarness, openSqliteBackend, type LedgerBackend } from './ledger-test-harness.ts';
import {
  CPA_MANDATE_LOOKUP_SQL,
  createSqlMandateResolver,
  createSqlRevokeGrantsPort,
  createSqlTenantKeyGrantReader,
  effectiveMandateRole,
  revokeCpaMandate,
  type MandateResolver,
  type RevokeGrantsPort,
} from './mandate-resolver.ts';

describe('effectiveMandateRole : le rôle effectif ne dépasse jamais le plus restrictif des deux', () => {
  const ORDER = ['EXPERT_COMPTABLE_OEC', 'CHEF_MISSION', 'AIDE_COMPTABLE'] as const;

  it('OEC > CHEF_MISSION > AIDE_COMPTABLE : le plus faible des deux gagne, dans les deux sens', () => {
    for (const [i, user] of ORDER.entries()) {
      for (const [j, cap] of ORDER.entries()) {
        expect(effectiveMandateRole(user, cap), `${user} / ${cap}`).toBe(ORDER[Math.max(i, j)]);
      }
    }
  });

  it('plafond plus faible que le rôle cabinet : CHEF_MISSION plafonné par AIDE_COMPTABLE devient AIDE_COMPTABLE ; inverse : AIDE_COMPTABLE reste AIDE_COMPTABLE sous plafond OEC', () => {
    expect(effectiveMandateRole('CHEF_MISSION', 'AIDE_COMPTABLE')).toBe('AIDE_COMPTABLE');
    expect(effectiveMandateRole('AIDE_COMPTABLE', 'EXPERT_COMPTABLE_OEC')).toBe('AIDE_COMPTABLE');
  });

  it("AUDITEUR_CAC_DGI (lecture seule, Doc_09 § 05) : OEC plafonné par l'auditeur devient auditeur ; l'auditeur n'est jamais élargi ; un rôle sans intersection est refusé", () => {
    expect(effectiveMandateRole('EXPERT_COMPTABLE_OEC', 'AUDITEUR_CAC_DGI')).toBe('AUDITEUR_CAC_DGI');
    expect(effectiveMandateRole('AUDITEUR_CAC_DGI', 'EXPERT_COMPTABLE_OEC')).toBe('AUDITEUR_CAC_DGI');
    expect(effectiveMandateRole('AUDITEUR_CAC_DGI', 'AUDITEUR_CAC_DGI')).toBe('AUDITEUR_CAC_DGI');
    // CHEF_MISSION et AIDE_COMPTABLE n'ont pas REVERSIBILITY_EXPORT_10Y : l'auditeur leur en donnerait une : refus.
    expect(effectiveMandateRole('CHEF_MISSION', 'AUDITEUR_CAC_DGI')).toBeNull();
    expect(effectiveMandateRole('AIDE_COMPTABLE', 'AUDITEUR_CAC_DGI')).toBeNull();
    expect(effectiveMandateRole('AUDITEUR_CAC_DGI', 'CHEF_MISSION')).toBeNull();
    expect(effectiveMandateRole('AUDITEUR_CAC_DGI', 'AIDE_COMPTABLE')).toBeNull();
  });

  it("refuse tout rôle non délégable (rôles de la PME, rôles techniques, valeur inconnue) côté cabinet comme côté plafond", () => {
    for (const bad of ['OWNER_GERANT', 'DAF_TRESORIER', 'CAISSIER_POS', 'AI_MCP_ACTOR', 'ERP_CONNECTOR_AGENT', 'ROOT', '']) {
      expect(effectiveMandateRole(bad, 'EXPERT_COMPTABLE_OEC'), bad).toBeNull();
      expect(effectiveMandateRole('EXPERT_COMPTABLE_OEC', bad), bad).toBeNull();
    }
  });

  it("preuve contre la matrice réelle de policy-engine : le rôle effectif est l'un des deux rôles, jamais plus haut que l'un ou l'autre, et ses permissions sont incluses dans celles des deux (sauf INVOICE_CREATE_DRAFT, voir ci-dessous)", () => {
    const allowed = (role: RoleCode): ReadonlySet<PermissionAction> => {
      const context: AuthorizationContext = {
        actorId: 'a',
        role,
        companyId: 'c',
        assignedCompanyIds: ['c'],
        orgPlanSegment: 'FIDUCIAIRE',
        activeHumanMembersCount: 5,
        subscriptionReadOnly: false,
        fiscalYearClosed: false,
        canAccessPayrollPii: true,
        mfaVerifiedAtEpochSec: 1000,
        nowEpochSec: 1000,
      };
      return new Set(PERMISSION_ACTIONS.filter((action) => evaluateAccessPolicy(action, context).allowed));
    };
    const RANK: Readonly<Record<string, number>> = { EXPERT_COMPTABLE_OEC: 3, CHEF_MISSION: 2, AIDE_COMPTABLE: 1, AUDITEUR_CAC_DGI: 0 };
    const outsideBoth = new Set<PermissionAction>();
    let checked = 0;
    for (const user of CPA_MANDATE_DELEGABLE_ROLES) {
      for (const cap of CPA_MANDATE_DELEGABLE_ROLES) {
        const effective = effectiveMandateRole(user, cap);
        if (effective === null) {
          // refus justifié : aucun des 4 rôles délégables n'a des permissions incluses dans celles du rôle cabinet ET du plafond
          const carriers = CPA_MANDATE_DELEGABLE_ROLES.filter((role) => [...allowed(role)].every((p) => allowed(user).has(p) && allowed(cap).has(p)));
          expect(carriers, `${user} / ${cap}`).toEqual([]);
          continue;
        }
        expect([user, cap], `${user} / ${cap}`).toContain(effective);
        expect(RANK[effective] ?? -1, `${user} / ${cap}`).toBeLessThanOrEqual(Math.min(RANK[user] ?? -1, RANK[cap] ?? -1));
        for (const permission of allowed(effective)) {
          if (!allowed(user).has(permission) || !allowed(cap).has(permission)) {
            outsideBoth.add(permission);
          }
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
    // La matrice n'est pas un treillis : AIDE_COMPTABLE porte INVOICE_CREATE_DRAFT, absent de CHEF_MISSION et de l'OEC. L'ordre
    // OEC > CHEF_MISSION > AIDE_COMPTABLE est celui du propriétaire ; cet écart (un brouillon de facture) est le seul toléré et ne
    // doit pas s'élargir : toute autre permission sortant de l'intersection fait échouer ce test.
    expect([...outsideBoth]).toEqual(['INVOICE_CREATE_DRAFT']);
  });
});

/** Pilote espion : enregistre toute instruction envoyée au plan de contrôle. */
function spy(driver: TenantSqlDriver): { readonly driver: TenantSqlDriver; readonly seen: SqlStatementParams[] } {
  const seen: SqlStatementParams[] = [];
  return {
    seen,
    driver: {
      tenantId: driver.tenantId,
      query: async <TRow>(stmt: SqlStatementParams): Promise<readonly TRow[]> => {
        seen.push(stmt);
        return driver.query<TRow>(stmt);
      },
      executeBatchAtomically: (statements) => driver.executeBatchAtomically(statements),
    },
  };
}

describe.each(['sqlite', 'postgres'] as const)('createSqlMandateResolver sur %s (plan de contrôle réel, migrations v1 à v5)', (engine) => {
  let backend: ControlPlaneBackend;
  let resolver: MandateResolver;
  let recorded: SqlStatementParams[];

  beforeAll(async () => {
    backend = await openControlPlaneBackend(engine);
  });

  afterAll(async () => {
    await backend.close();
  });

  beforeEach(async () => {
    await exec(backend.driver, 'DELETE FROM company_cpa_mandates');
    await exec(backend.driver, 'DELETE FROM subscriptions');
    await exec(backend.driver, 'DELETE FROM pricing_catalog');
    await exec(backend.driver, 'DELETE FROM organization_memberships');
    await exec(backend.driver, 'DELETE FROM tenant_databases');
    await exec(backend.driver, 'DELETE FROM users');
    await exec(backend.driver, 'DELETE FROM organizations');
    await seedCpaWorld(backend.driver);
    const spied = spy(backend.driver);
    recorded = spied.seen;
    resolver = createSqlMandateResolver(spied.driver);
  });

  it('mandat actif : rôle effectif, organisation propriétaire, plan, cabinet, drapeau paie et mode cryptographique', async () => {
    await seedMandate(backend.driver, { maxRole: 'EXPERT_COMPTABLE_OEC', payrollPii: 1 });
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: CO_CLOUD })).toEqual({
      organizationId: OWNER_ORG,
      role: 'EXPERT_COMPTABLE_OEC',
      planCode: 'PLAN_TEST',
      fiduciaryOrgId: CABINET,
      canAccessPayrollPii: true,
      cryptoMode: 'CLOUD_ASSISTED',
    });
  });

  it('can_access_payroll_pii = 0 donne canAccessPayrollPii false ; dossier E2EE donne cryptoMode ZERO_KNOWLEDGE_E2EE', async () => {
    await seedMandate(backend.driver, { companyId: CO_E2EE, payrollPii: 0 });
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: CO_E2EE })).toMatchObject({ canAccessPayrollPii: false, cryptoMode: 'ZERO_KNOWLEDGE_E2EE' });
  });

  it('absent, révoqué, autre dossier, utilisateur étranger au cabinet : null (aucune distinction possible)', async () => {
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: CO_CLOUD })).toBeNull();
    await seedMandate(backend.driver, { status: 'REVOKED' });
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: CO_CLOUD })).toBeNull();
    await exec(backend.driver, `DELETE FROM company_cpa_mandates`);
    await seedMandate(backend.driver, {});
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: CO_E2EE })).toBeNull();
    expect(await resolver.resolveMandate({ userId: U_STRANGER, companyId: CO_CLOUD })).toBeNull();
    expect(await resolver.resolveMandate({ userId: 'u-inconnu', companyId: CO_CLOUD })).toBeNull();
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: 'co-inconnu' })).toBeNull();
  });

  it("scoped_user_ids_json : NULL = tous les membres ; sinon l'utilisateur doit y figurer ; [] n'autorise personne ; JSON inexploitable refusé", async () => {
    await seedMandate(backend.driver, { scopedJson: '["u-chef"]' });
    expect(await resolver.resolveMandate({ userId: U_CHEF, companyId: CO_CLOUD })).toMatchObject({ role: 'CHEF_MISSION' });
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: CO_CLOUD })).toBeNull();
    await exec(backend.driver, `UPDATE company_cpa_mandates SET scoped_user_ids_json = '[]'`);
    expect(await resolver.resolveMandate({ userId: U_CHEF, companyId: CO_CLOUD })).toBeNull();
    await exec(backend.driver, `UPDATE company_cpa_mandates SET scoped_user_ids_json = NULL`);
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: CO_CLOUD })).not.toBeNull();
    // éléments non textuels : le CHECK n'inspecte pas les éléments, l'adaptateur échoue fermé
    await exec(backend.driver, `UPDATE company_cpa_mandates SET scoped_user_ids_json = '[1, null, {"a": 1}]'`);
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: CO_CLOUD })).toBeNull();
  });

  it('rôle plafonné : max_delegated_role plus faible que le rôle cabinet (CHEF devient AIDE) et inverse (AIDE reste AIDE sous plafond OEC)', async () => {
    await seedMandate(backend.driver, { maxRole: 'AIDE_COMPTABLE' });
    expect(await resolver.resolveMandate({ userId: U_CHEF, companyId: CO_CLOUD })).toMatchObject({ role: 'AIDE_COMPTABLE' });
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: CO_CLOUD })).toMatchObject({ role: 'AIDE_COMPTABLE' });
    await exec(backend.driver, `UPDATE company_cpa_mandates SET max_delegated_role = 'EXPERT_COMPTABLE_OEC'`);
    expect(await resolver.resolveMandate({ userId: U_AIDE, companyId: CO_CLOUD })).toMatchObject({ role: 'AIDE_COMPTABLE' });
    expect(await resolver.resolveMandate({ userId: U_CHEF, companyId: CO_CLOUD })).toMatchObject({ role: 'CHEF_MISSION' });
  });

  it("plafond AUDITEUR_CAC_DGI : l'OEC devient auditeur, CHEF_MISSION et AIDE_COMPTABLE sont refusés (jamais élargis) ; l'auditeur du cabinet reste auditeur", async () => {
    await seedMandate(backend.driver, { maxRole: 'AUDITEUR_CAC_DGI' });
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: CO_CLOUD })).toMatchObject({ role: 'AUDITEUR_CAC_DGI' });
    expect(await resolver.resolveMandate({ userId: U_AUDITOR, companyId: CO_CLOUD })).toMatchObject({ role: 'AUDITEUR_CAC_DGI' });
    expect(await resolver.resolveMandate({ userId: U_CHEF, companyId: CO_CLOUD })).toBeNull();
    expect(await resolver.resolveMandate({ userId: U_AIDE, companyId: CO_CLOUD })).toBeNull();
  });

  it("un rôle non délégable dans le cabinet (OWNER_GERANT du cabinet) n'ouvre aucun accès via le mandat", async () => {
    await seedMandate(backend.driver, {});
    expect(await resolver.resolveMandate({ userId: U_CAB_OWNER, companyId: CO_CLOUD })).toBeNull();
  });

  it("dossier sans abonnement : null (échec fermé, le plan ne peut pas être établi)", async () => {
    await seedMandate(backend.driver, {});
    await exec(backend.driver, 'DELETE FROM subscriptions');
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: CO_CLOUD })).toBeNull();
  });

  it("membre de deux cabinets mandatés : le rôle effectif le plus élevé l'emporte, départage déterministe", async () => {
    await seedMembership(backend.driver, CABINET_2, U_CHEF, 'EXPERT_COMPTABLE_OEC');
    await seedMandate(backend.driver, { mandateId: 'm-a', orgId: CABINET, maxRole: 'AIDE_COMPTABLE' });
    await seedMandate(backend.driver, { mandateId: 'm-b', orgId: CABINET_2, maxRole: 'CHEF_MISSION', payrollPii: 1 });
    expect(await resolver.resolveMandate({ userId: U_CHEF, companyId: CO_CLOUD })).toMatchObject({ role: 'CHEF_MISSION', fiduciaryOrgId: CABINET_2, canAccessPayrollPii: true });
  });

  it("l'instruction est exactement CPA_MANDATE_LOOKUP_SQL, paramétrée : aucune valeur d'entrée dans le texte SQL ; filtre status ACTIVE et revoked_at IS NULL", async () => {
    await seedMandate(backend.driver, {});
    const hostile = "x' OR '1'='1";
    expect(await resolver.resolveMandate({ userId: hostile, companyId: hostile })).toBeNull();
    await resolver.resolveMandate({ userId: U_OEC, companyId: CO_CLOUD });
    expect(recorded).toHaveLength(2);
    for (const stmt of recorded) {
      expect(stmt.sql).toBe(CPA_MANDATE_LOOKUP_SQL);
      expect(stmt.sql).not.toContain(hostile);
    }
    expect(recorded[0]?.params).toEqual([hostile, hostile]);
    expect(CPA_MANDATE_LOOKUP_SQL).toMatch(/company_id = \?/);
    expect(CPA_MANDATE_LOOKUP_SQL).toMatch(/status = 'ACTIVE'/);
    expect(CPA_MANDATE_LOOKUP_SQL).toMatch(/revoked_at IS NULL/);
    expect(CPA_MANDATE_LOOKUP_SQL).toMatch(/organization_memberships/);
  });

  it('panne du plan de contrôle : la promesse est rejetée (le routeur répond 503), jamais un accès', async () => {
    const failing = createSqlMandateResolver({
      tenantId: 'control-plane',
      query: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      executeBatchAtomically: async () => ({ totalChanges: 0 }),
    });
    await expect(failing.resolveMandate({ userId: U_OEC, companyId: CO_CLOUD })).rejects.toThrow('ECONNREFUSED');
  });
});

describe.each(['sqlite', 'postgres'] as const)('révocation et enveloppes : requêtes des adaptateurs sur %s', (engine) => {
  let control: ControlPlaneBackend;
  let tenant: LedgerBackend;
  let harness: PostgresHarness | null = null;
  const revokedAt = '2026-11-20T09:00:00Z';

  beforeAll(async () => {
    control = await openControlPlaneBackend(engine);
    if (engine === 'postgres') {
      harness = new PostgresHarness();
      tenant = await harness.fresh();
    } else {
      tenant = await openSqliteBackend();
    }
  });

  afterAll(async () => {
    await harness?.close();
    await control.close();
  });

  beforeEach(async () => {
    for (const table of ['company_cpa_mandates', 'subscriptions', 'pricing_catalog', 'organization_memberships', 'tenant_databases', 'users', 'organizations']) {
      await exec(control.driver, `DELETE FROM ${table}`);
    }
    await exec(tenant.driver, 'DELETE FROM tenant_key_grants');
    await seedCpaWorld(control.driver);
    await seedMandate(control.driver, { mandateId: 'm-1', companyId: CO_E2EE });
  });

  it("lecteur d'enveloppes : cabinet ou acteur, non révoquée seulement, rôle EXTERNAL_CPA seulement", async () => {
    const reader = createSqlTenantKeyGrantReader();
    const query = { tenantDb: tenant.driver, companyId: CO_E2EE, userId: U_OEC, fiduciaryOrgId: CABINET };
    expect(await reader.hasActiveGrant(query)).toBe(false);
    await seedKeyGrant(tenant.driver, CABINET, { revokedAt });
    expect(await reader.hasActiveGrant(query)).toBe(false);
    await seedKeyGrant(tenant.driver, CABINET, { dekVersion: 2, grantId: 'g2' });
    expect(await reader.hasActiveGrant(query)).toBe(true);
    await exec(tenant.driver, 'DELETE FROM tenant_key_grants');
    await seedKeyGrant(tenant.driver, U_OEC);
    expect(await reader.hasActiveGrant(query)).toBe(true);
    expect(await reader.hasActiveGrant({ ...query, userId: U_CHEF })).toBe(false);
    await exec(tenant.driver, `UPDATE tenant_key_grants SET grantee_role = 'OWNER_ADMIN'`);
    expect(await reader.hasActiveGrant(query)).toBe(false);
  });

  it('revokeCpaMandate : mandat REVOKED + revoked_at, acteurs = cabinet et ses membres, enveloppes révoquées une seule fois', async () => {
    await seedKeyGrant(tenant.driver, CABINET);
    await seedKeyGrant(tenant.driver, U_OEC);
    await seedKeyGrant(tenant.driver, CABINET_2);
    const captured: { actorIds: readonly string[]; revokedAt: string }[] = [];
    const sql = createSqlRevokeGrantsPort({ getTenantDbUpToDate: async () => tenant.driver });
    const port: RevokeGrantsPort = {
      revokeCpaGrants: async (input) => {
        captured.push({ actorIds: input.actorIds, revokedAt: input.revokedAt });
        return sql.revokeCpaGrants(input);
      },
    };
    const result = await revokeCpaMandate({ controlPlane: control.driver, revokeGrants: port, nowIso: () => revokedAt }, { mandateId: 'm-1' });
    expect(result).toEqual({ mandateId: 'm-1', companyId: CO_E2EE, fiduciaryOrgId: CABINET, newlyRevoked: true, revokedAt, grantsRevoked: 2 });
    expect(captured).toEqual([{ actorIds: [CABINET, U_AIDE, U_AUDITOR, U_CAB_OWNER, U_CHEF, U_OEC], revokedAt }]);
    expect(await control.driver.query({ sql: 'SELECT status, revoked_at FROM company_cpa_mandates', params: [] })).toEqual([{ status: 'REVOKED', revoked_at: revokedAt }]);
    const grants = await tenant.driver.query<{ grantee_actor_id: string; revoked_at: string | null }>({ sql: 'SELECT grantee_actor_id, revoked_at FROM tenant_key_grants ORDER BY grantee_actor_id', params: [] });
    expect(grants).toEqual([
      { grantee_actor_id: CABINET, revoked_at: revokedAt },
      { grantee_actor_id: CABINET_2, revoked_at: null },
      { grantee_actor_id: U_OEC, revoked_at: revokedAt },
    ]);
    const again = await revokeCpaMandate({ controlPlane: control.driver, revokeGrants: port, nowIso: () => '2027-01-01T00:00:00Z' }, { mandateId: 'm-1' });
    expect(again).toMatchObject({ newlyRevoked: false, grantsRevoked: 0, revokedAt });
    // la voie B refuse après révocation, sur ce moteur
    const resolver = createSqlMandateResolver(control.driver);
    expect(await resolver.resolveMandate({ userId: U_OEC, companyId: CO_E2EE })).toBeNull();
  });
});
