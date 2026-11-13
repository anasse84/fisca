/**
 * Lecture de preuve du grand livre (GET /api/v1/ledger/verify-chain) : règle de REPLI à échec fermé.
 *
 * `auth-rbac` ne définit AUCUNE permission de lecture du grand livre (PERMISSION_ACTIONS : seules LEDGER_SAVE_DRAFT,
 * LEDGER_VISA_CYCLE, LEDGER_POST_IMMUTABLE et REVERSIBILITY_EXPORT_10Y touchent le grand livre). En attendant une permission dédiée
 * (recommandation : `LEDGER_READ_PROOF`), la lecture est réservée aux rôles qui portent au moins une de ces actions. Pour la
 * remplacer, il suffit de substituer `LEDGER_READ_PROOF_FALLBACK_ACTIONS` par la permission dédiée : aucune autre règle à changer.
 *
 * - Les identités techniques (ERP, IA) sont refusées quoi que porte leur rôle : elles ne lisent pas la preuve légale.
 * - Accès par mandat : le plafond de permissions doit contenir au moins une action du repli (intersection non vide).
 */
import { PERMISSION_ACTIONS, TECHNICAL_ROLE_CODES, permissionsOfRole, type PermissionAction, type RoleCode } from '@fisca/auth-rbac';
import { LedgerError } from './ledger-errors.ts';

/** Actions de repli : toute action LEDGER_* du catalogue, plus l'export de réversibilité 10 ans (auditeurs CAC / DGI). */
export const LEDGER_READ_PROOF_FALLBACK_ACTIONS: ReadonlySet<PermissionAction> = new Set<PermissionAction>([
  ...PERMISSION_ACTIONS.filter((action) => action.startsWith('LEDGER_')),
  'REVERSIBILITY_EXPORT_10Y',
]);

function isTechnicalRole(role: RoleCode): boolean {
  return (TECHNICAL_ROLE_CODES as readonly string[]).includes(role);
}

function holdsFallbackAction(actions: ReadonlySet<PermissionAction>): boolean {
  for (const action of actions) {
    if (LEDGER_READ_PROOF_FALLBACK_ACTIONS.has(action)) {
      return true;
    }
  }
  return false;
}

/** `ceiling` : plafond d'un accès par mandat ; `null` ou absent : appartenance directe, aucun plafond. */
export function canReadLedgerProof(role: RoleCode, ceiling: ReadonlySet<PermissionAction> | null | undefined): boolean {
  if (isTechnicalRole(role) || !holdsFallbackAction(permissionsOfRole(role))) {
    return false;
  }
  return ceiling === null || ceiling === undefined || holdsFallbackAction(ceiling);
}

/** Refus au code RBAC habituel du grand livre (403 `LEDGER_ACCESS_DENIED`, `denialCode` = `RBAC_FORBIDDEN_FOR_<rôle>`). */
export function assertCanReadLedgerProof(holder: { readonly role: RoleCode; readonly permissionCeiling?: ReadonlySet<PermissionAction> | null | undefined }): void {
  if (canReadLedgerProof(holder.role, holder.permissionCeiling)) {
    return;
  }
  const denialCode = `RBAC_FORBIDDEN_FOR_${holder.role}` as const;
  throw new LedgerError('LEDGER_ACCESS_DENIED', `${denialCode} : lecture de la preuve du grand livre refusée (aucune action LEDGER_* ni REVERSIBILITY_EXPORT_10Y dans le rôle ou le plafond du mandat).`, { denialCode });
}
