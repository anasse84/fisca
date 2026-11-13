/**
 * Mandats de cabinet (ticket T-S1B-11, H2 tranché par le propriétaire ; Doc_04 § 04, Doc_09 § 05 et § 06).
 *
 * Ports et adaptateurs SQL des voies B et C du TenantRouter :
 * - `MandateResolver` (voie B) : un cabinet dont l'utilisateur est membre actif détient un mandat ACTIF sur le dossier, lu dans
 *   `company_cpa_mandates` du plan de contrôle (migration 5). `createSqlMandateResolver` en est l'adaptateur SQL, portable
 *   SQLite et PostgreSQL 16 (aucune fonction JSON côté SQL : `scoped_user_ids_json` est filtré ici). Sans résolveur configuré, le
 *   routeur refuse tout accès cabinet (refus par défaut) ;
 * - `TenantKeyGrantReader` (voie C) : un dossier `ZERO_KNOWLEDGE_E2EE` exige en plus une enveloppe `tenant_key_grants` non
 *   révoquée pour le cabinet ou l'acteur. La table vit dans la base DU DOSSIER : la lecture a lieu APRÈS son ouverture ;
 * - `revokeCpaMandate` : `status = 'REVOKED'` et `revoked_at` dans le plan de contrôle, puis propagation de `tenant_key_grants.revoked_at`
 *   par le port `RevokeGrantsPort`. Les deux bases étant distinctes, il n'existe pas de transaction commune : le mandat est révoqué
 *   EN PREMIER (la voie B refuse aussitôt), la propagation suit et se rejoue sans effet de bord (idempotente).
 *
 * Convention d'enveloppe : le destinataire `EXTERNAL_CPA` est le cabinet (`grantee_actor_id` = `fiduciary_org_id`) ; une enveloppe
 * posée au nom d'un membre du cabinet est aussi acceptée. La révocation couvre les deux formes.
 */
import type { PermissionAction, RoleCode } from '@fisca/auth-rbac';
import { CPA_MANDATE_DELEGABLE_ROLES, type CpaMandateDelegableRole } from '@fisca/db-schema';
import type { TenantSqlDriver } from '@fisca/shared-types';
import { intersectRolePermissions } from './mandate-permission-ceiling.ts';

export type TenantCryptoMode = 'CLOUD_ASSISTED' | 'ZERO_KNOWLEDGE_E2EE';

export interface MandateAccess {
  /** Organisation propriétaire du dossier (le client), dont dépend l'abonnement. */
  readonly organizationId: string;
  /** Rôle EFFECTIF : le plus restrictif entre le rôle de l'utilisateur dans le cabinet et `max_delegated_role`. */
  readonly role: RoleCode;
  /**
   * Plafond de permissions (décision 2 du pilote) : INTERSECTION des permissions du rôle de l'utilisateur dans le cabinet et de
   * celles de `max_delegated_role`. Toute action hors de cet ensemble est refusée, quelle que soit la décision de la politique
   * sur `role`. `null` n'est jamais produit par l'adaptateur SQL ; il est réservé à l'accès direct (aucun plafond).
   */
  readonly permissionCeiling: ReadonlySet<PermissionAction> | null;
  /** `subscriptions.plan_code` de l'organisation propriétaire du dossier. */
  readonly planCode: string;
  /** Cabinet par lequel passe l'accès (`company_cpa_mandates.fiduciary_org_id`). */
  readonly fiduciaryOrgId: string;
  /** `can_access_payroll_pii` du mandat : première moitié de l'habilitation paie (l'attribut de l'utilisateur est la seconde). */
  readonly canAccessPayrollPii: boolean;
  /** `tenant_databases.crypto_mode` du dossier : `ZERO_KNOWLEDGE_E2EE` déclenche la voie C. */
  readonly cryptoMode: TenantCryptoMode;
}

export interface MandateResolver {
  /** Mandat ACTIF (révoqué exclu) de l'utilisateur sur le dossier ; null sinon, que le dossier existe ou non. */
  resolveMandate(query: { readonly userId: string; readonly companyId: string }): Promise<MandateAccess | null>;
}

// ---------------------------------------------------------------- rôle effectif

/**
 * Rang de restriction (plus petit = plus restrictif) : OEC (3) > CHEF_MISSION (2) > AIDE_COMPTABLE (1) > AUDITEUR_CAC_DGI (0).
 * AUDITEUR_CAC_DGI est lecture / audit seule (Doc_09 § 05, matrice B : « Lecture », « Télécharge FEC » ; policy-engine : la seule
 * permission est REVERSIBILITY_EXPORT_10Y), donc le plus bas.
 */
const RESTRICTION_RANK: Readonly<Record<CpaMandateDelegableRole, number>> = {
  EXPERT_COMPTABLE_OEC: 3,
  CHEF_MISSION: 2,
  AIDE_COMPTABLE: 1,
  AUDITEUR_CAC_DGI: 0,
};

function isDelegableRole(value: string): value is CpaMandateDelegableRole {
  return (CPA_MANDATE_DELEGABLE_ROLES as readonly string[]).includes(value);
}

/** Rôles qui possèdent REVERSIBILITY_EXPORT_10Y (policy-engine) : seuls ceux-là peuvent se voir réduits à AUDITEUR_CAC_DGI. */
const CAN_BE_REDUCED_TO_AUDITOR: ReadonlySet<CpaMandateDelegableRole> = new Set<CpaMandateDelegableRole>(['EXPERT_COMPTABLE_OEC', 'AUDITEUR_CAC_DGI']);

/**
 * Rôle effectif d'un utilisateur de cabinet sous un mandat : le plus restrictif des deux, jamais plus large que l'un ou l'autre.
 * Refus (null) : rôle non délégable (PME, technique, inconnu) ; ou AUDITEUR_CAC_DGI combiné à CHEF_MISSION / AIDE_COMPTABLE, car
 * l'auditeur détient REVERSIBILITY_EXPORT_10Y que ces deux rôles n'ont pas : le retenir élargirait les droits. Un test compare
 * cette table à la matrice réelle de `evaluateAccessPolicy`.
 */
export function effectiveMandateRole(userRoleInCabinet: string, maxDelegatedRole: string): CpaMandateDelegableRole | null {
  if (!isDelegableRole(userRoleInCabinet) || !isDelegableRole(maxDelegatedRole)) {
    return null;
  }
  const lower = RESTRICTION_RANK[userRoleInCabinet] <= RESTRICTION_RANK[maxDelegatedRole] ? userRoleInCabinet : maxDelegatedRole;
  const higher = lower === userRoleInCabinet ? maxDelegatedRole : userRoleInCabinet;
  if (lower === 'AUDITEUR_CAC_DGI' && !CAN_BE_REDUCED_TO_AUDITOR.has(higher)) {
    return null;
  }
  return lower;
}

/**
 * Plafond de permissions d'un accès par mandat : intersection des permissions des deux rôles (null si la combinaison est refusée,
 * comme `effectiveMandateRole`). Le rôle effectif n'est qu'un rôle d'évaluation : seul ce plafond garantit qu'aucune permission
 * hors intersection n'est accordée (ex. CHEF_MISSION plafonné à AIDE_COMPTABLE ne gagne jamais INVOICE_CREATE_DRAFT).
 */
export function mandatePermissionCeiling(userRoleInCabinet: string, maxDelegatedRole: string): ReadonlySet<PermissionAction> | null {
  if (effectiveMandateRole(userRoleInCabinet, maxDelegatedRole) === null || !isDelegableRole(userRoleInCabinet) || !isDelegableRole(maxDelegatedRole)) {
    return null;
  }
  return intersectRolePermissions(userRoleInCabinet, maxDelegatedRole);
}

// ---------------------------------------------------------------- adaptateur SQL de la voie B

/**
 * Paramètres : (user_id, company_id). Le cabinet doit compter l'utilisateur parmi ses membres ; le dossier fournit l'organisation
 * propriétaire et son mode cryptographique ; l'abonnement de cette organisation fournit le plan (sans abonnement : aucune ligne).
 */
export const CPA_MANDATE_LOOKUP_SQL = `SELECT m.mandate_id, m.fiduciary_org_id, m.max_delegated_role, m.can_access_payroll_pii, m.scoped_user_ids_json,
    om.role_code AS member_role_code, td.organization_id AS owner_org_id, td.crypto_mode, s.plan_code
FROM company_cpa_mandates m
JOIN organization_memberships om ON om.organization_id = m.fiduciary_org_id AND om.user_id = ?
JOIN tenant_databases td ON td.company_id = m.company_id
JOIN subscriptions s ON s.organization_id = td.organization_id
WHERE m.company_id = ? AND m.status = 'ACTIVE' AND m.revoked_at IS NULL
ORDER BY m.fiduciary_org_id, m.mandate_id`;

interface MandateLookupRow {
  readonly mandate_id: string;
  readonly fiduciary_org_id: string;
  readonly max_delegated_role: string;
  readonly can_access_payroll_pii: number | string | bigint;
  readonly scoped_user_ids_json: string | null;
  readonly member_role_code: string;
  readonly owner_org_id: string;
  readonly crypto_mode: string;
  readonly plan_code: string;
}

/** NULL : aucun filtre. Sinon l'utilisateur doit figurer dans le tableau ; tout JSON inexploitable ou tout élément non textuel refuse. */
function isUserInScope(scopedUserIdsJson: string | null, userId: string): boolean {
  if (scopedUserIdsJson === null) {
    return true;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(scopedUserIdsJson);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || !parsed.every((item): item is string => typeof item === 'string')) {
    return false;
  }
  return parsed.includes(userId);
}

function toCryptoMode(value: string): TenantCryptoMode {
  return value === 'CLOUD_ASSISTED' ? 'CLOUD_ASSISTED' : 'ZERO_KNOWLEDGE_E2EE';
}

/** Adaptateur SQL du port `MandateResolver` sur le pilote du plan de contrôle. Une panne du pilote remonte (le routeur répond 503). */
export function createSqlMandateResolver(controlPlane: TenantSqlDriver): MandateResolver {
  return {
    resolveMandate: async ({ userId, companyId }) => {
      const rows = await controlPlane.query<MandateLookupRow>({ sql: CPA_MANDATE_LOOKUP_SQL, params: [userId, companyId] });
      let best: { readonly access: MandateAccess; readonly rank: number } | null = null;
      for (const row of rows) {
        const role = effectiveMandateRole(row.member_role_code, row.max_delegated_role);
        if (role === null || !isUserInScope(row.scoped_user_ids_json, userId)) {
          continue;
        }
        const rank = RESTRICTION_RANK[role];
        if (best === null || rank > best.rank) {
          best = {
            rank,
            access: {
              organizationId: row.owner_org_id,
              role,
              permissionCeiling: mandatePermissionCeiling(row.member_role_code, row.max_delegated_role),
              planCode: row.plan_code,
              fiduciaryOrgId: row.fiduciary_org_id,
              canAccessPayrollPii: Number(row.can_access_payroll_pii) === 1,
              cryptoMode: toCryptoMode(row.crypto_mode),
            },
          };
        }
      }
      return best === null ? null : best.access;
    },
  };
}

// ---------------------------------------------------------------- voie C : enveloppes de clés

/** Lecture des enveloppes dans la base DU DOSSIER, déjà ouverte par le routeur. */
export interface TenantKeyGrantReader {
  /** true si une enveloppe EXTERNAL_CPA NON RÉVOQUÉE existe pour le cabinet ou pour l'acteur. */
  hasActiveGrant(query: {
    readonly tenantDb: TenantSqlDriver;
    readonly companyId: string;
    readonly userId: string;
    readonly fiduciaryOrgId: string;
  }): Promise<boolean>;
}

/** Paramètres : (cabinet, acteur). */
export const CPA_ACTIVE_GRANT_SQL = `SELECT grant_id FROM tenant_key_grants WHERE grantee_role = 'EXTERNAL_CPA' AND grantee_actor_id IN (?, ?) AND revoked_at IS NULL LIMIT 1`;

export function createSqlTenantKeyGrantReader(): TenantKeyGrantReader {
  return {
    hasActiveGrant: async ({ tenantDb, userId, fiduciaryOrgId }) => {
      const rows = await tenantDb.query<{ readonly grant_id: string }>({ sql: CPA_ACTIVE_GRANT_SQL, params: [fiduciaryOrgId, userId] });
      return rows.length > 0;
    },
  };
}

// ---------------------------------------------------------------- révocation

/** Propage la révocation à `tenant_key_grants` de la base du dossier ; renvoie le nombre d'enveloppes révoquées. Idempotent. */
export interface RevokeGrantsPort {
  revokeCpaGrants(input: { readonly companyId: string; readonly actorIds: readonly string[]; readonly revokedAt: string }): Promise<number>;
}

/** Ouvre la base d'un dossier (`SqlInfrastructure` satisfait ce port, comme `TenantDatabaseProvider`). */
export interface TenantDbOpener {
  getTenantDbUpToDate(companyId: string): Promise<TenantSqlDriver>;
}

/** Paramètres : (revoked_at, actor_id). Ne réécrit jamais une révocation antérieure. */
export const CPA_REVOKE_GRANTS_SQL = `UPDATE tenant_key_grants SET revoked_at = ? WHERE grantee_role = 'EXTERNAL_CPA' AND grantee_actor_id = ? AND revoked_at IS NULL`;

export function createSqlRevokeGrantsPort(tenants: TenantDbOpener): RevokeGrantsPort {
  return {
    revokeCpaGrants: async ({ companyId, actorIds, revokedAt }) => {
      if (actorIds.length === 0) {
        return 0;
      }
      const tenantDb = await tenants.getTenantDbUpToDate(companyId);
      const result = await tenantDb.executeBatchAtomically(actorIds.map((actorId) => ({ sql: CPA_REVOKE_GRANTS_SQL, params: [revokedAt, actorId] })));
      return result.totalChanges;
    },
  };
}

export interface RevokeCpaMandateDeps {
  readonly controlPlane: TenantSqlDriver;
  readonly revokeGrants: RevokeGrantsPort;
  /** Horodatage UTC `YYYY-MM-DDTHH:MM:SSZ` (format du plan de contrôle). */
  readonly nowIso: () => string;
}

export interface RevokeCpaMandateResult {
  readonly mandateId: string;
  readonly companyId: string;
  readonly fiduciaryOrgId: string;
  /** false si le mandat était déjà révoqué (nouvel appel : la propagation est simplement rejouée). */
  readonly newlyRevoked: boolean;
  readonly revokedAt: string;
  readonly grantsRevoked: number;
}

interface MandateRow {
  readonly company_id: string;
  readonly fiduciary_org_id: string;
  readonly status: string;
  readonly revoked_at: string | null;
}

const UTC_SECONDS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const SELECT_MANDATE_SQL = 'SELECT company_id, fiduciary_org_id, status, revoked_at FROM company_cpa_mandates WHERE mandate_id = ?';
/** Paramètres : (revoked_at, mandate_id). Une ligne seulement pour celui qui révoque ; aucune réécriture d'une révocation. */
export const CPA_REVOKE_MANDATE_SQL = `UPDATE company_cpa_mandates SET status = 'REVOKED', revoked_at = ? WHERE mandate_id = ? AND status = 'ACTIVE' RETURNING mandate_id`;
/**
 * Paramètres : (cabinet, dossier, mandat). Membres du cabinet, sauf ceux d'un AUTRE cabinet encore mandaté (ACTIVE) sur le même
 * dossier : leur enveloppe nominative reste valable par cet autre mandat.
 */
export const CPA_REVOCATION_ACTORS_SQL = `SELECT om.user_id FROM organization_memberships om
WHERE om.organization_id = ?
  AND om.user_id NOT IN (
    SELECT other.user_id FROM company_cpa_mandates m2
    JOIN organization_memberships other ON other.organization_id = m2.fiduciary_org_id
    WHERE m2.company_id = ? AND m2.status = 'ACTIVE' AND m2.mandate_id <> ?
  )
ORDER BY om.user_id`;

/**
 * Révoque un mandat et propage aux enveloppes. Renvoie null si le mandat n'existe pas. Ordre : mandat d'abord (la voie B refuse
 * aussitôt), enveloppes ensuite ; si la propagation échoue, l'erreur remonte et un nouvel appel la termine.
 */
export async function revokeCpaMandate(deps: RevokeCpaMandateDeps, input: { readonly mandateId: string }): Promise<RevokeCpaMandateResult | null> {
  const [found] = await deps.controlPlane.query<MandateRow>({ sql: SELECT_MANDATE_SQL, params: [input.mandateId] });
  if (found === undefined) {
    return null;
  }
  let revokedAt = found.revoked_at;
  let newlyRevoked = false;
  if (found.status === 'ACTIVE') {
    const candidate = deps.nowIso();
    if (!UTC_SECONDS_PATTERN.test(candidate)) {
      throw new Error(`horodatage de révocation invalide (YYYY-MM-DDTHH:MM:SSZ attendu) : ${candidate}`);
    }
    const updated = await deps.controlPlane.query<{ readonly mandate_id: string }>({ sql: CPA_REVOKE_MANDATE_SQL, params: [candidate, input.mandateId] });
    if (updated.length > 0) {
      newlyRevoked = true;
      revokedAt = candidate;
    } else {
      // révoqué entre-temps par un appel concurrent : on reprend son horodatage
      const [current] = await deps.controlPlane.query<MandateRow>({ sql: SELECT_MANDATE_SQL, params: [input.mandateId] });
      revokedAt = current?.revoked_at ?? candidate;
    }
  }
  if (revokedAt === null) {
    throw new Error(`mandat ${input.mandateId} incohérent : REVOKED sans revoked_at`);
  }
  const members = await deps.controlPlane.query<{ readonly user_id: string }>({
    sql: CPA_REVOCATION_ACTORS_SQL,
    params: [found.fiduciary_org_id, found.company_id, input.mandateId],
  });
  const grantsRevoked = await deps.revokeGrants.revokeCpaGrants({
    companyId: found.company_id,
    actorIds: [found.fiduciary_org_id, ...members.map((member) => member.user_id)],
    revokedAt,
  });
  return { mandateId: input.mandateId, companyId: found.company_id, fiduciaryOrgId: found.fiduciary_org_id, newlyRevoked, revokedAt, grantsRevoked };
}
