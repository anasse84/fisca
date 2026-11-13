/** Règle de repli de lecture de preuve (verify-chain) : auth-rbac n'a aucune permission de lecture du grand livre. */
import { describe, expect, it } from 'vitest';
import { ROLE_CODES, TECHNICAL_ROLE_CODES, permissionsOfRole, type PermissionAction, type RoleCode } from '@fisca/auth-rbac';
import { LEDGER_READ_PROOF_FALLBACK_ACTIONS, canReadLedgerProof } from './ledger-read-proof.ts';

const EXPECTED_ALLOWED: ReadonlySet<RoleCode> = new Set<RoleCode>(['OWNER_GERANT', 'DAF_TRESORIER', 'AIDE_COMPTABLE', 'CHEF_MISSION', 'EXPERT_COMPTABLE_OEC', 'AUDITEUR_CAC_DGI']);

describe('LEDGER_READ_PROOF_FALLBACK_ACTIONS', () => {
  it('contient exactement les actions LEDGER_* de auth-rbac et REVERSIBILITY_EXPORT_10Y', () => {
    expect([...LEDGER_READ_PROOF_FALLBACK_ACTIONS].sort()).toEqual(['LEDGER_POST_IMMUTABLE', 'LEDGER_SAVE_DRAFT', 'LEDGER_VISA_CYCLE', 'REVERSIBILITY_EXPORT_10Y']);
  });
});

describe('canReadLedgerProof (échec fermé)', () => {
  it.each(ROLE_CODES)('rôle %s, appartenance directe : autorisé seulement s\'il porte une action de repli et n\'est pas technique', (role) => {
    expect(canReadLedgerProof(role, null)).toBe(EXPECTED_ALLOWED.has(role));
  });

  it('les rôles techniques (ERP, IA) sont refusés même si le rôle porte LEDGER_SAVE_DRAFT', () => {
    expect(permissionsOfRole('ERP_CONNECTOR_AGENT').has('LEDGER_SAVE_DRAFT')).toBe(true);
    for (const role of TECHNICAL_ROLE_CODES) {
      expect(canReadLedgerProof(role, null)).toBe(false);
    }
  });

  it('accès par mandat : le plafond doit contenir au moins une action de repli ; plafond vide ou hors repli = refus', () => {
    const ceiling = (...actions: PermissionAction[]): ReadonlySet<PermissionAction> => new Set(actions);
    expect(canReadLedgerProof('EXPERT_COMPTABLE_OEC', ceiling('REVERSIBILITY_EXPORT_10Y'))).toBe(true);
    expect(canReadLedgerProof('CHEF_MISSION', ceiling('LEDGER_VISA_CYCLE'))).toBe(true);
    expect(canReadLedgerProof('EXPERT_COMPTABLE_OEC', ceiling('INVOICE_CREATE_DRAFT', 'PAYROLL_9421_READ_EXPORT'))).toBe(false);
    expect(canReadLedgerProof('EXPERT_COMPTABLE_OEC', ceiling())).toBe(false);
  });

  it('rôle inconnu (valeur hors énumération) : refus', () => {
    expect(canReadLedgerProof('INCONNU' as RoleCode, null)).toBe(false);
  });
});
