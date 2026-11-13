import { describe, expect, it } from 'vitest';
import {
  PERMISSION_ACTIONS,
  ROLE_CODES,
  evaluateAccessPolicy,
  permissionsOfRole,
  type AuthorizationContext,
  type PermissionAction,
  type RoleCode,
} from '../src/index.ts';

const NOW = 1_800_000_000;

/** Contexte neutre satisfaisant l'ABAC/SoD : seule la matrice RBAC discrimine. */
function probeCtx(role: RoleCode, action: PermissionAction): AuthorizationContext {
  const technical = role === 'ERP_CONNECTOR_AGENT' || role === 'AI_MCP_ACTOR';
  return {
    actorId: 'user-actor',
    role,
    companyId: 'co-1',
    assignedCompanyIds: ['co-1'],
    orgPlanSegment: 'ENTERPRISE',
    activeHumanMembersCount: 5,
    subscriptionReadOnly: false,
    fiscalYearClosed: false,
    canAccessPayrollPii: true,
    mfaVerifiedAtEpochSec: NOW - 10,
    nowEpochSec: NOW,
    sodMakerActorId: 'someone-else',
    ...(technical ? { mcpScopes: ['mcp:draft'] } : {}),
    ...(action === 'PAYMENT_SIGN_PAIN001' ? { sodRibModifierActorId: 'rib-editor' } : {}),
  };
}

describe('permissionsOfRole', () => {
  for (const role of ROLE_CODES) {
    it(`${role} : ensemble exact des actions autorisées par evaluateAccessPolicy`, () => {
      const probed = new Set(
        PERMISSION_ACTIONS.filter((a) => evaluateAccessPolicy(a, probeCtx(role, a)).allowed),
      );
      expect(new Set(permissionsOfRole(role))).toEqual(probed);
      expect(permissionsOfRole(role).size).toBe(probed.size);
    });
  }

  it("OWNER_GERANT n'a pas LEDGER_VISA_CYCLE", () => {
    expect(permissionsOfRole('OWNER_GERANT').has('LEDGER_VISA_CYCLE')).toBe(false);
  });

  it('le résultat est isolé : muter la copie ne change pas un second appel', () => {
    const first = permissionsOfRole('CAISSIER_POS') as Set<PermissionAction>;
    const before = [...permissionsOfRole('CAISSIER_POS')].sort();
    try {
      first.add('LEDGER_POST_IMMUTABLE');
      first.delete('POS_ENCASH_TICKET');
      first.clear();
    } catch {
      // un ensemble gelé peut refuser la mutation : l'invariant reste vérifié ci-dessous
    }
    expect([...permissionsOfRole('CAISSIER_POS')].sort()).toEqual(before);
    expect(permissionsOfRole('CAISSIER_POS').has('LEDGER_POST_IMMUTABLE')).toBe(false);
  });
});
