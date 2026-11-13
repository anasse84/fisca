/**
 * Lecture de preuve du grand livre (GET /api/v1/ledger/verify-chain) : permission dédiée `LEDGER_READ_PROOF` de `auth-rbac`
 * (Doc_09 § 06B : l'Auditeur CAC/DGI a « Lecture Preuves », les autres rôles comptables « Lecture »), à échec fermé.
 *
 * - La matrice de `auth-rbac` accorde LEDGER_READ_PROOF aux seuls rôles humains concernés ; les identités techniques
 *   (ERP_CONNECTOR_AGENT, AI_MCP_ACTOR) ne la portent jamais et sont de plus refusées ici par garde explicite.
 * - Accès par mandat : le plafond de permissions du mandat doit contenir LEDGER_READ_PROOF (intersection stricte avec le rôle).
 */
import { TECHNICAL_ROLE_CODES, permissionsOfRole, type PermissionAction, type RoleCode } from '@fisca/auth-rbac';
import { LedgerError } from './ledger-errors.ts';

function isTechnicalRole(role: RoleCode): boolean {
  return (TECHNICAL_ROLE_CODES as readonly string[]).includes(role);
}

/** `ceiling` : plafond d'un accès par mandat ; `null` ou absent : appartenance directe, aucun plafond. */
export function canReadLedgerProof(role: RoleCode, ceiling: ReadonlySet<PermissionAction> | null | undefined): boolean {
  if (isTechnicalRole(role) || !permissionsOfRole(role).has('LEDGER_READ_PROOF')) {
    return false;
  }
  return ceiling === null || ceiling === undefined || ceiling.has('LEDGER_READ_PROOF');
}

/** Refus au code RBAC habituel du grand livre (403 `LEDGER_ACCESS_DENIED`, `denialCode` = `RBAC_FORBIDDEN_FOR_<rôle>`). */
export function assertCanReadLedgerProof(holder: { readonly role: RoleCode; readonly permissionCeiling?: ReadonlySet<PermissionAction> | null | undefined }): void {
  if (canReadLedgerProof(holder.role, holder.permissionCeiling)) {
    return;
  }
  const denialCode = `RBAC_FORBIDDEN_FOR_${holder.role}` as const;
  throw new LedgerError('LEDGER_ACCESS_DENIED', `${denialCode} : lecture de la preuve du grand livre refusée (LEDGER_READ_PROOF absente du rôle ou du plafond du mandat).`, { denialCode });
}
