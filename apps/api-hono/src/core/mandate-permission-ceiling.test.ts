/**
 * Décision 2 du pilote (T-S1B-11) : les permissions d'un accès par mandat sont l'INTERSECTION des permissions du rôle de
 * l'utilisateur dans le cabinet et de celles de `max_delegated_role`. Les ensembles de référence sont calculés ICI, par sondage
 * direct de `evaluateAccessPolicy` pour chaque rôle, indépendamment du code testé.
 */
import { describe, expect, it } from 'vitest';
import { evaluateAccessPolicy, PERMISSION_ACTIONS, type AuthorizationContext, type PermissionAction, type RoleCode } from '@fisca/auth-rbac';
import { CPA_MANDATE_DELEGABLE_ROLES } from '@fisca/db-schema';
import { LedgerError } from './immutable-cgnc-ledger-engine.ts';
import { assertPermissionWithinMandateCeiling } from './mandate-permission-ceiling.ts';
import { effectiveMandateRole, mandatePermissionCeiling } from './mandate-resolver.ts';

function probeContext(role: RoleCode): AuthorizationContext {
  return {
    actorId: 'probe',
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
}

function permissionsOf(role: RoleCode): ReadonlySet<PermissionAction> {
  return new Set(PERMISSION_ACTIONS.filter((action) => evaluateAccessPolicy(action, probeContext(role)).allowed));
}

/** Décision effective : plafond d'abord, puis la politique sur le rôle d'évaluation (contexte neutre). */
function effectivelyAllowed(action: PermissionAction, access: { readonly role: RoleCode; readonly permissionCeiling: ReadonlySet<PermissionAction> }): boolean {
  try {
    assertPermissionWithinMandateCeiling(action, access);
  } catch (error) {
    if (error instanceof LedgerError) return false;
    throw error;
  }
  return evaluateAccessPolicy(action, probeContext(access.role)).allowed;
}

describe('permissionCeiling : le cas exact du pilote', () => {
  const role = effectiveMandateRole('CHEF_MISSION', 'AIDE_COMPTABLE');
  const ceiling = mandatePermissionCeiling('CHEF_MISSION', 'AIDE_COMPTABLE');

  it('CHEF_MISSION plafonné à AIDE_COMPTABLE : INVOICE_CREATE_DRAFT REFUSÉ, LEDGER_VISA_CYCLE refusé, LEDGER_SAVE_DRAFT permis', () => {
    expect(role).toBe('AIDE_COMPTABLE');
    expect(ceiling).not.toBeNull();
    if (role === null || ceiling === null) return;
    const access = { role, permissionCeiling: ceiling };
    // la politique seule accorderait INVOICE_CREATE_DRAFT au rôle d'évaluation AIDE_COMPTABLE : seul le plafond le refuse
    expect(evaluateAccessPolicy('INVOICE_CREATE_DRAFT', probeContext(role)).allowed).toBe(true);
    expect(effectivelyAllowed('INVOICE_CREATE_DRAFT', access)).toBe(false);
    expect(effectivelyAllowed('LEDGER_VISA_CYCLE', access)).toBe(false);
    expect(effectivelyAllowed('LEDGER_SAVE_DRAFT', access)).toBe(true);
    expect(ceiling.has('INVOICE_CREATE_DRAFT')).toBe(false);
  });

  it('le refus du plafond porte le MÊME code que le refus RBAC (LEDGER_ACCESS_DENIED / RBAC_FORBIDDEN_FOR_<rôle>)', () => {
    if (role === null || ceiling === null) throw new Error('combinaison attendue délégable');
    let caught: unknown;
    try {
      assertPermissionWithinMandateCeiling('INVOICE_CREATE_DRAFT', { role, permissionCeiling: ceiling });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LedgerError);
    if (!(caught instanceof LedgerError)) return;
    expect(caught.code).toBe('LEDGER_ACCESS_DENIED');
    expect(caught.message).toContain('RBAC_FORBIDDEN_FOR_AIDE_COMPTABLE');
    expect(caught.denialCode).toBe('RBAC_FORBIDDEN_FOR_AIDE_COMPTABLE');
  });

  it('accès par appartenance directe : aucun plafond (null), rien n\'est refusé par ce contrôle', () => {
    for (const action of PERMISSION_ACTIONS) {
      expect(() => assertPermissionWithinMandateCeiling(action, { role: 'CHEF_MISSION', permissionCeiling: null })).not.toThrow();
      expect(() => assertPermissionWithinMandateCeiling(action, { role: 'CHEF_MISSION' })).not.toThrow();
    }
  });
});

describe('permissionCeiling : propriété sur tous les couples (rôle cabinet délégable x max_delegated_role) et toutes les PermissionAction', () => {
  it('permissions effectives = perms(utilisateur) ∩ perms(plafond), calculées indépendamment (⊆ ET égalité) ; couples refusés : null', () => {
    let granted = 0;
    let refused = 0;
    for (const user of CPA_MANDATE_DELEGABLE_ROLES) {
      for (const cap of CPA_MANDATE_DELEGABLE_ROLES) {
        const label = `${user} / ${cap}`;
        const role = effectiveMandateRole(user, cap);
        const ceiling = mandatePermissionCeiling(user, cap);
        if (role === null) {
          expect(ceiling, label).toBeNull();
          refused += 1;
          continue;
        }
        expect(ceiling, label).not.toBeNull();
        if (ceiling === null) continue;
        const userPerms = permissionsOf(user);
        const capPerms = permissionsOf(cap);
        const intersection = new Set([...userPerms].filter((p) => capPerms.has(p)));
        const effective = new Set(PERMISSION_ACTIONS.filter((action) => effectivelyAllowed(action, { role, permissionCeiling: ceiling })));
        for (const action of effective) {
          expect(userPerms.has(action) && capPerms.has(action), `${label} : ${action} hors intersection`).toBe(true);
        }
        expect([...effective].sort(), `${label} : égalité avec l'intersection`).toEqual([...intersection].sort());
        expect([...ceiling].sort(), `${label} : plafond = intersection`).toEqual([...intersection].sort());
        granted += 1;
      }
    }
    expect(granted).toBeGreaterThanOrEqual(10);
    expect(refused).toBe(CPA_MANDATE_DELEGABLE_ROLES.length ** 2 - granted);
  });

  it('couples refusés conservés : AUDITEUR_CAC_DGI x CHEF_MISSION / AIDE_COMPTABLE (dans les deux sens) et tout rôle non délégable donnent null', () => {
    for (const [user, cap] of [['CHEF_MISSION', 'AUDITEUR_CAC_DGI'], ['AIDE_COMPTABLE', 'AUDITEUR_CAC_DGI'], ['AUDITEUR_CAC_DGI', 'CHEF_MISSION'], ['AUDITEUR_CAC_DGI', 'AIDE_COMPTABLE']] as const) {
      expect(mandatePermissionCeiling(user, cap), `${user} / ${cap}`).toBeNull();
    }
    for (const bad of ['OWNER_GERANT', 'DAF_TRESORIER', 'CAISSIER_POS', 'AI_MCP_ACTOR', 'ERP_CONNECTOR_AGENT', 'ROOT', '']) {
      expect(mandatePermissionCeiling(bad, 'EXPERT_COMPTABLE_OEC'), bad).toBeNull();
      expect(mandatePermissionCeiling('EXPERT_COMPTABLE_OEC', bad), bad).toBeNull();
    }
  });
});
