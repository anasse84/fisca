/**
 * S1B point 4 : GET /api/v1/ledger/verify-chain n'est plus ouverte à tout membre. auth-rbac n'a aucune permission de lecture du
 * grand livre : règle de repli à échec fermé (`LEDGER_READ_PROOF_FALLBACK_ACTIONS`), plafond de mandat appliqué.
 */
import { describe, expect, it } from 'vitest';
import type { PermissionAction, RoleCode } from '@fisca/auth-rbac';
import { ProblemBodySchema } from '../../core/api-v1-schemas.ts';
import { COMPANY_A, USER_1, USER_2, USER_AIDE, USER_CHEF, USER_OEC, buildKit, grantMandate, type Kit } from './ledger-routes-test-kit.ts';
import { grant } from '../../core/pipeline-test-support.ts';

const VERIFY = '/api/v1/ledger/verify-chain?journalId=jr-cai';

async function denied(response: Response): Promise<string> {
  expect(response.status).toBe(403);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  return ProblemBodySchema.parse(await response.json()).errorCode;
}

function member(kit: Kit, userId: string, role: RoleCode): string {
  grant(kit.memberships, userId, COMPANY_A, role);
  return userId;
}

describe('verify-chain : repli RBAC à échec fermé', () => {
  it('membre sans lecture : CAISSIER_POS, COMMERCIAL, ACHATS, MAGASINIER refusés 403 LEDGER_ACCESS_DENIED', async () => {
    const kit = await buildKit();
    await kit.entryAt('POSTED');
    for (const [user, role] of [['user-caissier', 'CAISSIER_POS'], ['u-com', 'COMMERCIAL_FACTURATION'], ['u-ach', 'ACHATS_BUYER'], ['u-mag', 'MAGASINIER_BL']] as const) {
      expect(await denied(await kit.call('GET', VERIFY, { user: member(kit, user, role) }))).toBe('LEDGER_ACCESS_DENIED');
    }
  });

  it('identités techniques ERP_CONNECTOR_AGENT et AI_MCP_ACTOR : refusées (ERP porte pourtant LEDGER_SAVE_DRAFT)', async () => {
    const kit = await buildKit();
    for (const [user, role] of [['u-erp', 'ERP_CONNECTOR_AGENT'], ['u-ia', 'AI_MCP_ACTOR']] as const) {
      const response = await kit.call('GET', VERIFY, { user: member(kit, user, role) });
      expect(response.status).toBe(403);
    }
  });

  it('AUDITEUR_CAC_DGI et EXPERT_COMPTABLE_OEC autorisés (verdict complet) ; aide, chef et gérant aussi (action LEDGER_*)', async () => {
    const kit = await buildKit();
    await kit.entryAt('POSTED');
    for (const user of [member(kit, 'u-aud', 'AUDITEUR_CAC_DGI'), USER_OEC, USER_AIDE, USER_CHEF, USER_1]) {
      const response = await kit.call('GET', VERIFY, { user });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ journalId: 'jr-cai', valid: true, length: 1, brokenAtEntryId: null });
    }
  });

  it('refus avant lecture : aucune requête de chaîne pour un membre refusé (journal inconnu reste 403, pas 404)', async () => {
    const kit = await buildKit();
    const response = await kit.call('GET', '/api/v1/ledger/verify-chain?journalId=jr-inconnu', { user: 'user-caissier' });
    expect(await denied(response)).toBe('LEDGER_ACCESS_DENIED');
  });

  it('accès par mandat borné par le plafond : aucune action de repli = 403 ; plafond {REVERSIBILITY_EXPORT_10Y} = 200 ; plafond vide = 403', async () => {
    const kit = await buildKit();
    await kit.entryAt('POSTED');
    grantMandate(kit.mandates, USER_2, COMPANY_A, 'EXPERT_COMPTABLE_OEC', { permissionCeiling: new Set<PermissionAction>(['INVOICE_CREATE_DRAFT', 'PAYROLL_9421_READ_EXPORT']) });
    expect(await denied(await kit.call('GET', VERIFY, { user: USER_2 }))).toBe('LEDGER_ACCESS_DENIED');
    grantMandate(kit.mandates, USER_2, COMPANY_A, 'EXPERT_COMPTABLE_OEC', { permissionCeiling: new Set<PermissionAction>() });
    expect(await denied(await kit.call('GET', VERIFY, { user: USER_2 }))).toBe('LEDGER_ACCESS_DENIED');
    grantMandate(kit.mandates, USER_2, COMPANY_A, 'AUDITEUR_CAC_DGI', { permissionCeiling: new Set<PermissionAction>(['REVERSIBILITY_EXPORT_10Y']) });
    expect((await kit.call('GET', VERIFY, { user: USER_2 })).status).toBe(200);
  });
});
