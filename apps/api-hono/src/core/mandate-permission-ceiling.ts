/**
 * Plafond de permissions d'un accès par mandat (ticket T-S1B-11, décision 2 du pilote).
 *
 * Règle : les permissions effectives d'un accès par mandat sont l'INTERSECTION des permissions du rôle de l'utilisateur dans le
 * cabinet et de celles de `max_delegated_role`. La matrice des rôles n'étant pas hiérarchique (AIDE_COMPTABLE porte
 * INVOICE_CREATE_DRAFT, pas CHEF_MISSION), un rôle unique ne la représente pas : l'accès porte donc, en plus du rôle
 * d'évaluation, un ensemble explicite `permissionCeiling`. Une action absente de cet ensemble est refusée quelle que soit la
 * décision de `evaluateAccessPolicy` ; le refus porte le MÊME code que le refus RBAC. Appartenance directe : `null`, aucun plafond.
 *
 * Les permissions d'un rôle viennent de `permissionsOfRole` (auth-rbac, jonction livrée par S1A) : plus de sondage.
 */
import { permissionsOfRole, type PermissionAction, type RoleCode } from '@fisca/auth-rbac';
import { LedgerError } from './ledger-errors.ts';

/** Permissions d'un rôle (lecture directe de la matrice d'auth-rbac). */
export function probeRolePermissions(role: RoleCode): ReadonlySet<PermissionAction> {
  return permissionsOfRole(role);
}

/** Intersection des permissions de deux rôles. */
export function intersectRolePermissions(first: RoleCode, second: RoleCode): ReadonlySet<PermissionAction> {
  const other = probeRolePermissions(second);
  return new Set([...probeRolePermissions(first)].filter((action) => other.has(action)));
}

/** Ce que le contrôle lit d'un contexte d'accès : `TenantContext` et `LedgerActor` le satisfont. */
export interface PermissionCeilingHolder {
  readonly role: RoleCode;
  readonly permissionCeiling?: ReadonlySet<PermissionAction> | null | undefined;
}

/**
 * Refuse (LEDGER_ACCESS_DENIED, code `RBAC_FORBIDDEN_FOR_<rôle d'évaluation>`) toute action hors du plafond. À appeler AVANT
 * `evaluateAccessPolicy`. Sans plafond (`null` ou absent : appartenance directe), ne refuse rien.
 */
export function assertPermissionWithinMandateCeiling(action: PermissionAction, holder: PermissionCeilingHolder): void {
  const ceiling = holder.permissionCeiling;
  if (ceiling === null || ceiling === undefined || ceiling.has(action)) {
    return;
  }
  const denialCode = `RBAC_FORBIDDEN_FOR_${holder.role}` as const;
  throw new LedgerError('LEDGER_ACCESS_DENIED', `${denialCode} : ${action} hors du plafond de permissions du mandat (intersection du rôle du cabinet et de max_delegated_role).`, {
    denialCode,
  });
}
