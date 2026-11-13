/** Lecture de preuve du grand livre (verify-chain) : permission dédiée LEDGER_READ_PROOF de auth-rbac. */
import { describe, expect, it } from 'vitest';
import { ROLE_CODES, TECHNICAL_ROLE_CODES, permissionsOfRole, type PermissionAction, type RoleCode } from '@fisca/auth-rbac';
import { canReadLedgerProof } from './ledger-read-proof.ts';

/** Rôles qui lisaient la preuve sous l'ancien repli (action LEDGER_* ou REVERSIBILITY_EXPORT_10Y, hors identités techniques). */
const EXPECTED_ALLOWED: ReadonlySet<RoleCode> = new Set<RoleCode>(['OWNER_GERANT', 'DAF_TRESORIER', 'AIDE_COMPTABLE', 'CHEF_MISSION', 'EXPERT_COMPTABLE_OEC', 'AUDITEUR_CAC_DGI']);

describe('LEDGER_READ_PROOF dans la matrice auth-rbac', () => {
  it('est portée exactement par les rôles attendus, et par aucune identité technique', () => {
    const holders = ROLE_CODES.filter((role) => permissionsOfRole(role).has('LEDGER_READ_PROOF'));
    expect(new Set(holders)).toEqual(EXPECTED_ALLOWED);
    for (const role of TECHNICAL_ROLE_CODES) {
      expect(permissionsOfRole(role).has('LEDGER_READ_PROOF')).toBe(false);
    }
  });
});

describe('canReadLedgerProof (échec fermé)', () => {
  it.each(ROLE_CODES)('rôle %s, appartenance directe : autorisé exactement comme avant le repli', (role) => {
    expect(canReadLedgerProof(role, null)).toBe(EXPECTED_ALLOWED.has(role));
    expect(canReadLedgerProof(role, undefined)).toBe(EXPECTED_ALLOWED.has(role));
  });

  it('les rôles techniques (ERP, IA) sont refusés même si le rôle porte LEDGER_SAVE_DRAFT', () => {
    expect(permissionsOfRole('ERP_CONNECTOR_AGENT').has('LEDGER_SAVE_DRAFT')).toBe(true);
    for (const role of TECHNICAL_ROLE_CODES) {
      expect(canReadLedgerProof(role, null)).toBe(false);
    }
  });

  it('accès par mandat : le plafond doit contenir LEDGER_READ_PROOF ; plafond vide ou sans cette action = refus', () => {
    const ceiling = (...actions: PermissionAction[]): ReadonlySet<PermissionAction> => new Set(actions);
    expect(canReadLedgerProof('EXPERT_COMPTABLE_OEC', ceiling('LEDGER_READ_PROOF'))).toBe(true);
    expect(canReadLedgerProof('AUDITEUR_CAC_DGI', ceiling('LEDGER_READ_PROOF', 'INVOICE_CREATE_DRAFT'))).toBe(true);
    expect(canReadLedgerProof('EXPERT_COMPTABLE_OEC', ceiling('LEDGER_VISA_CYCLE', 'LEDGER_POST_IMMUTABLE', 'REVERSIBILITY_EXPORT_10Y'))).toBe(false);
    expect(canReadLedgerProof('EXPERT_COMPTABLE_OEC', ceiling('INVOICE_CREATE_DRAFT', 'PAYROLL_9421_READ_EXPORT'))).toBe(false);
    expect(canReadLedgerProof('EXPERT_COMPTABLE_OEC', ceiling())).toBe(false);
  });

  it('intersection stricte : un plafond contenant LEDGER_READ_PROOF ne l\'accorde pas à un rôle qui ne la porte pas', () => {
    const full: ReadonlySet<PermissionAction> = new Set<PermissionAction>(['LEDGER_READ_PROOF']);
    for (const role of ROLE_CODES.filter((candidate) => !EXPECTED_ALLOWED.has(candidate))) {
      expect(canReadLedgerProof(role, full)).toBe(false);
    }
  });

  it('rôle inconnu (valeur hors énumération) : refus', () => {
    expect(canReadLedgerProof('INCONNU' as RoleCode, null)).toBe(false);
  });
});
