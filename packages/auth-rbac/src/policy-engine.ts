/**
 * CTR-COD-06 — evaluateAccessPolicy (Doc_09 §05, §06, §07, §08, §11 ; ERRATA D-02, D-16).
 *
 * Fonction pure, déterministe, sans E/S : l'horloge arrive par `nowEpochSec`, la preuve
 * d'authentification forte par `mfaVerifiedAtEpochSec`. Refus par défaut : toute décision
 * d'autorisation traverse la chaîne de contrôles ci-dessous et la dernière ligne seule autorise.
 */
import { assertSafeMcpToolSchema } from '@fisca/shared-types';

/** 12 rôles canoniques : 10 humains + 2 identités techniques (ERRATA D-02). */
export const HUMAN_ROLE_CODES = [
  'OWNER_GERANT',
  'COMMERCIAL_FACTURATION',
  'CAISSIER_POS',
  'ACHATS_BUYER',
  'MAGASINIER_BL',
  'DAF_TRESORIER',
  'AIDE_COMPTABLE',
  'CHEF_MISSION',
  'EXPERT_COMPTABLE_OEC',
  'AUDITEUR_CAC_DGI',
] as const;

export const TECHNICAL_ROLE_CODES = ['ERP_CONNECTOR_AGENT', 'AI_MCP_ACTOR'] as const;

export const ROLE_CODES = [...HUMAN_ROLE_CODES, ...TECHNICAL_ROLE_CODES] as const;

export type HumanRoleCode = (typeof HUMAN_ROLE_CODES)[number];
export type TechnicalRoleCode = (typeof TECHNICAL_ROLE_CODES)[number];
export type RoleCode = (typeof ROLE_CODES)[number];

export const PERMISSION_ACTIONS = [
  'INVOICE_CREATE_DRAFT',
  'INVOICE_CERTIFY_XHUB',
  'POS_ENCASH_TICKET',
  'POS_VIEW_EXPECTED_CASH',
  'PO_CREATE',
  'BL_CONFIRM_RECEIPT',
  'PARTNER_PROPOSE_RIB_CHANGE',
  'PARTNER_APPROVE_RIB_CHANGE',
  'PAYMENT_PREPARE_PAIN001',
  'PAYMENT_SIGN_PAIN001',
  'LEDGER_SAVE_DRAFT',
  'LEDGER_VISA_CYCLE',
  'LEDGER_POST_IMMUTABLE',
  'PAYROLL_9421_READ_EXPORT',
  'REVERSIBILITY_EXPORT_10Y',
  'E2EE_REVOKE_CPA_GRANT',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** Durée de validité d'une preuve Step-Up (Doc_09 §07). */
export const STEP_UP_MAX_AGE_SEC = 300 as const;

/** Portée MCP requise pour tout dépôt de brouillon par AI_MCP_ACTOR (Doc_09 §10). */
export const MCP_DRAFT_SCOPE = 'mcp:draft' as const;

const ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly PermissionAction[]>> = {
  OWNER_GERANT: [
    'INVOICE_CREATE_DRAFT', 'INVOICE_CERTIFY_XHUB', 'POS_ENCASH_TICKET', 'POS_VIEW_EXPECTED_CASH',
    'PO_CREATE', 'BL_CONFIRM_RECEIPT', 'PARTNER_PROPOSE_RIB_CHANGE', 'PARTNER_APPROVE_RIB_CHANGE',
    'PAYMENT_PREPARE_PAIN001', 'PAYMENT_SIGN_PAIN001', 'LEDGER_SAVE_DRAFT', 'LEDGER_POST_IMMUTABLE',
    'PAYROLL_9421_READ_EXPORT', 'REVERSIBILITY_EXPORT_10Y', 'E2EE_REVOKE_CPA_GRANT',
  ],
  COMMERCIAL_FACTURATION: ['INVOICE_CREATE_DRAFT', 'INVOICE_CERTIFY_XHUB'],
  // POS_VIEW_EXPECTED_CASH volontairement absent : comptage aveugle (SoD-04).
  CAISSIER_POS: ['POS_ENCASH_TICKET'],
  ACHATS_BUYER: ['PO_CREATE', 'PARTNER_PROPOSE_RIB_CHANGE'],
  MAGASINIER_BL: ['BL_CONFIRM_RECEIPT'],
  DAF_TRESORIER: [
    'INVOICE_CREATE_DRAFT', 'INVOICE_CERTIFY_XHUB', 'POS_VIEW_EXPECTED_CASH',
    'PARTNER_APPROVE_RIB_CHANGE', 'PAYMENT_PREPARE_PAIN001', 'PAYMENT_SIGN_PAIN001',
    'PAYROLL_9421_READ_EXPORT', 'REVERSIBILITY_EXPORT_10Y',
  ],
  // 9421 : accordé sous l'attribut can_access_payroll_pii seulement (Doc_09 §06B, §07 ; ABAC ci-dessous).
  AIDE_COMPTABLE: ['INVOICE_CREATE_DRAFT', 'LEDGER_SAVE_DRAFT', 'PAYROLL_9421_READ_EXPORT'],
  CHEF_MISSION: ['LEDGER_SAVE_DRAFT', 'LEDGER_VISA_CYCLE', 'PAYROLL_9421_READ_EXPORT'],
  EXPERT_COMPTABLE_OEC: [
    'LEDGER_SAVE_DRAFT', 'LEDGER_VISA_CYCLE', 'LEDGER_POST_IMMUTABLE',
    'PAYROLL_9421_READ_EXPORT', 'REVERSIBILITY_EXPORT_10Y',
  ],
  AUDITEUR_CAC_DGI: ['REVERSIBILITY_EXPORT_10Y'],
  ERP_CONNECTOR_AGENT: ['INVOICE_CREATE_DRAFT', 'LEDGER_SAVE_DRAFT'],
  // Aucune mutation définitive ni financière : brouillons uniquement.
  AI_MCP_ACTOR: ['INVOICE_CREATE_DRAFT'],
};

const STEP_UP_MFA_ACTIONS: ReadonlySet<PermissionAction> = new Set<PermissionAction>([
  'INVOICE_CERTIFY_XHUB',
  'PARTNER_APPROVE_RIB_CHANGE',
  'PAYMENT_SIGN_PAIN001',
  'LEDGER_POST_IMMUTABLE',
  'E2EE_REVOKE_CPA_GRANT',
]);

const LEDGER_WRITE_ACTIONS: ReadonlySet<PermissionAction> = new Set<PermissionAction>([
  'LEDGER_SAVE_DRAFT',
  'LEDGER_VISA_CYCLE',
  'LEDGER_POST_IMMUTABLE',
]);

/**
 * Actions que la matrice RBAC accorde à un rôle (hors contrôles ABAC/SoD).
 * Renvoie une copie fraîche à chaque appel : la matrice interne reste immuable.
 */
export function permissionsOfRole(role: RoleCode): ReadonlySet<PermissionAction> {
  if (!Object.hasOwn(ROLE_PERMISSIONS, role)) {
    return new Set<PermissionAction>();
  }
  return new Set<PermissionAction>(ROLE_PERMISSIONS[role]);
}

export type OrgPlanSegment = 'DIRECT_PME' | 'FIDUCIAIRE' | 'ENTERPRISE';
export type SupplierRibStatus = 'VERIFIED' | 'ALERTE_RIB_DAF';

export interface AuthorizationContext {
  readonly actorId: string;
  readonly role: RoleCode;
  readonly companyId: string;
  readonly assignedCompanyIds: readonly string[];
  readonly orgPlanSegment: OrgPlanSegment;
  readonly activeHumanMembersCount: number;
  readonly subscriptionReadOnly: boolean;
  readonly fiscalYearClosed: boolean;
  readonly canAccessPayrollPii: boolean;
  /** Instant (secondes epoch) de la dernière preuve WebAuthn / OTP validée. */
  readonly mfaVerifiedAtEpochSec?: number | undefined;
  /** Horloge fournie par l'appelant : la logique ne lit jamais l'heure globale. */
  readonly nowEpochSec: number;
  /** Auteur de l'étape amont : émetteur du BC (SoD-01), modificateur du RIB (SoD-02), préparateur du lot (SoD-03). */
  readonly sodMakerActorId?: string | undefined;
  /** SoD-01 : autres intervenants du rapprochement tripartite (ex. approbateur d'écart). */
  readonly sodPriorActorIds?: readonly string[] | undefined;
  /** SoD RIB / pain.001 : dernier utilisateur ayant modifié le RIB du fournisseur payé. */
  readonly sodRibModifierActorId?: string | undefined;
  readonly supplierRibStatus?: SupplierRibStatus | undefined;
  /** Portées du jeton MCP (AI_MCP_ACTOR). */
  readonly mcpScopes?: readonly string[] | undefined;
  /** Noms des arguments de l'outil IA/MCP appelé (D-16). */
  readonly toolArgumentKeys?: readonly string[] | undefined;
}

export type DenialCode =
  | 'CONTEXT_INVALID'
  | 'RBAC_UNKNOWN_ACTION'
  | 'RBAC_UNKNOWN_ROLE'
  | `RBAC_FORBIDDEN_FOR_${RoleCode}`
  | 'ABAC_TENANT_OUT_OF_SCOPE'
  | 'ABAC_TECHNICAL_SINGLE_TENANT'
  | 'ABAC_SUBSCRIPTION_READ_ONLY'
  | 'ABAC_PAYROLL_PII_CLEARANCE_MISSING'
  | 'ABAC_FISCAL_YEAR_CLOSED'
  | 'ABAC_STEP_UP_MFA_REQUIRED'
  | 'MCP_SCOPE_MISSING'
  | 'MCP_TENANT_ARGUMENT_FORBIDDEN'
  | 'SOD_MAKER_UNRESOLVED'
  | 'SOD_01_ORDER_RECEIPT_CONFLICT'
  | 'SOD_02_RIB_DUAL_CONTROL'
  | 'SOD_02_RIB_ALERT_PENDING'
  | 'SOD_03_PAIN001_PREPARE_SIGN_CONFLICT'
  | 'SOD_RIB_MODIFIER_CANNOT_APPROVE_PAYMENT';

export type AuditFlag = 'SINGLE_OWNER_SOD_WAIVER';

export type PolicyDecision =
  | { readonly allowed: true; readonly auditFlags: readonly AuditFlag[] }
  | {
      readonly allowed: false;
      readonly denialCode: DenialCode;
      readonly denialMessage: string;
      readonly auditFlags: readonly AuditFlag[];
    };

function deny(denialCode: DenialCode, denialMessage: string): PolicyDecision {
  return { allowed: false, denialCode, denialMessage, auditFlags: [] };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isKnownRole(value: unknown): value is RoleCode {
  return typeof value === 'string' && (ROLE_CODES as readonly string[]).includes(value);
}

function isKnownAction(value: unknown): value is PermissionAction {
  return typeof value === 'string' && (PERMISSION_ACTIONS as readonly string[]).includes(value);
}

function isTechnicalRole(role: RoleCode): role is TechnicalRoleCode {
  return (TECHNICAL_ROLE_CODES as readonly string[]).includes(role);
}

function isStepUpFresh(mfaVerifiedAtEpochSec: number | undefined, nowEpochSec: number): boolean {
  if (mfaVerifiedAtEpochSec === undefined || !Number.isSafeInteger(mfaVerifiedAtEpochSec)) {
    return false;
  }
  const ageSec = nowEpochSec - mfaVerifiedAtEpochSec;
  return ageSec >= 0 && ageSec < STEP_UP_MAX_AGE_SEC;
}

function isContextWellFormed(ctx: AuthorizationContext): boolean {
  return (
    isNonEmptyString(ctx.actorId) &&
    isNonEmptyString(ctx.companyId) &&
    Array.isArray(ctx.assignedCompanyIds) &&
    Number.isSafeInteger(ctx.nowEpochSec) &&
    Number.isSafeInteger(ctx.activeHumanMembersCount) &&
    typeof ctx.subscriptionReadOnly === 'boolean' &&
    typeof ctx.fiscalYearClosed === 'boolean'
  );
}

function isCompanyHeaderKey(key: string): boolean {
  return key.toLowerCase().replace(/[^a-z]/g, '') === 'xfiscacompanyid';
}

function hasTenantArgument(keys: readonly string[]): boolean {
  if (keys.some(isCompanyHeaderKey)) {
    return true;
  }
  try {
    assertSafeMcpToolSchema('evaluateAccessPolicy', keys);
    return false;
  } catch {
    return true;
  }
}

type SodConflict = Extract<
  DenialCode,
  | 'SOD_01_ORDER_RECEIPT_CONFLICT'
  | 'SOD_02_RIB_DUAL_CONTROL'
  | 'SOD_03_PAIN001_PREPARE_SIGN_CONFLICT'
  | 'SOD_RIB_MODIFIER_CANNOT_APPROVE_PAYMENT'
>;

const SOD_MESSAGES: Readonly<Record<SodConflict, string>> = {
  SOD_01_ORDER_RECEIPT_CONFLICT:
    "SoD-01 : l'émetteur du bon de commande ne peut pas valider la réception ni approuver l'écart.",
  SOD_02_RIB_DUAL_CONTROL:
    "SoD-02 : l'auteur du changement de RIB ne peut pas l'approuver (deux utilisateurs distincts).",
  SOD_03_PAIN001_PREPARE_SIGN_CONFLICT:
    'SoD-03 : le préparateur du lot pain.001 ne peut pas en être le signataire final.',
  SOD_RIB_MODIFIER_CANNOT_APPROVE_PAYMENT:
    'SoD-02/03 : la personne qui a modifié le RIB du fournisseur ne peut pas approuver le virement correspondant.',
};

/** Retourne les conflits d'identité, ou un refus de décision si l'amont n'est pas renseigné. */
function findSodConflicts(
  action: PermissionAction,
  ctx: AuthorizationContext,
): { readonly conflicts: readonly SodConflict[] } | { readonly unresolved: true } {
  const maker = ctx.sodMakerActorId;
  if (maker === undefined || maker.length === 0) {
    return { unresolved: true };
  }
  const conflicts: SodConflict[] = [];
  if (action === 'BL_CONFIRM_RECEIPT') {
    const others = ctx.sodPriorActorIds ?? [];
    if (maker === ctx.actorId || others.includes(ctx.actorId)) {
      conflicts.push('SOD_01_ORDER_RECEIPT_CONFLICT');
    }
  } else if (action === 'PARTNER_APPROVE_RIB_CHANGE') {
    if (maker === ctx.actorId) {
      conflicts.push('SOD_02_RIB_DUAL_CONTROL');
    }
  } else {
    const ribModifier = ctx.sodRibModifierActorId;
    if (ribModifier === undefined || ribModifier.length === 0) {
      return { unresolved: true };
    }
    if (maker === ctx.actorId) {
      conflicts.push('SOD_03_PAIN001_PREPARE_SIGN_CONFLICT');
    }
    if (ribModifier === ctx.actorId) {
      conflicts.push('SOD_RIB_MODIFIER_CANNOT_APPROVE_PAYMENT');
    }
  }
  return { conflicts };
}

export function evaluateAccessPolicy(action: PermissionAction, ctx: AuthorizationContext): PolicyDecision {
  // 0. Entrées : tout ce qui n'est pas explicitement reconnu est refusé.
  if (!isKnownAction(action)) {
    return deny('RBAC_UNKNOWN_ACTION', `Action inconnue [${String(action)}] : refus par défaut.`);
  }
  if (!isKnownRole(ctx.role)) {
    return deny('RBAC_UNKNOWN_ROLE', `Rôle inconnu [${String(ctx.role)}] : refus par défaut.`);
  }
  if (!isContextWellFormed(ctx)) {
    return deny('CONTEXT_INVALID', "Contexte d'autorisation incomplet ou mal formé : refus par défaut.");
  }
  const role = ctx.role;

  // 1. ABAC portefeuille : le dossier doit figurer dans les affectations de l'acteur.
  if (!ctx.assignedCompanyIds.includes(ctx.companyId)) {
    return deny('ABAC_TENANT_OUT_OF_SCOPE', "Le dossier demandé n'appartient pas au portefeuille de l'acteur.");
  }

  // 1 bis. Les identités techniques sont liées à un seul dossier (Doc_09 §05, §10).
  if (isTechnicalRole(role) && ctx.assignedCompanyIds.length !== 1) {
    return deny('ABAC_TECHNICAL_SINGLE_TENANT', `L'identité technique ${role} est limitée à un seul dossier.`);
  }

  // 2. Sanctuarisation Art. 211 CGI : seul l'export décennal reste ouvert en lecture seule.
  if (ctx.subscriptionReadOnly && action !== 'REVERSIBILITY_EXPORT_10Y') {
    return deny('ABAC_SUBSCRIPTION_READ_ONLY', 'Abonnement en lecture seule (RESTRICTED_READ_ONLY) : action bloquée.');
  }

  // 3. RBAC.
  if (!ROLE_PERMISSIONS[role].includes(action)) {
    return deny(`RBAC_FORBIDDEN_FOR_${role}`, `Le rôle ${role} n'est pas habilité à exécuter ${action}.`);
  }

  // 3 bis. Acteur IA/MCP : portée mcp:draft et jamais d'identifiant de dossier en argument (D-16).
  if (role === 'AI_MCP_ACTOR') {
    if (ctx.mcpScopes === undefined || !ctx.mcpScopes.includes(MCP_DRAFT_SCOPE)) {
      return deny('MCP_SCOPE_MISSING', `La portée ${MCP_DRAFT_SCOPE} est requise pour déposer un brouillon.`);
    }
    if (ctx.toolArgumentKeys !== undefined && hasTenantArgument(ctx.toolArgumentKeys)) {
      return deny(
        'MCP_TENANT_ARGUMENT_FORBIDDEN',
        "Un outil IA/MCP ne reçoit jamais d'identifiant de dossier ni l'en-tête X-Fisca-Company-Id en argument.",
      );
    }
  }

  // 4. ABAC données personnelles : État 9421 (salaires, CIN, CNSS) — habilitation explicite.
  if (action === 'PAYROLL_9421_READ_EXPORT' && ctx.canAccessPayrollPii !== true) {
    return deny('ABAC_PAYROLL_PII_CLEARANCE_MISSING', "L'habilitation can_access_payroll_pii est requise pour l'État 9421.");
  }

  // 5. Verrou d'exercice clôturé.
  if (ctx.fiscalYearClosed && LEDGER_WRITE_ACTIONS.has(action)) {
    return deny('ABAC_FISCAL_YEAR_CLOSED', 'Exercice au statut CLOSED : écriture comptable refusée.');
  }

  // 6. Step-Up : preuve d'authentification forte de moins de 300 s.
  const stepUpFresh = isStepUpFresh(ctx.mfaVerifiedAtEpochSec, ctx.nowEpochSec);
  if (STEP_UP_MFA_ACTIONS.has(action) && !stepUpFresh) {
    return deny('ABAC_STEP_UP_MFA_REQUIRED', `Une authentification forte de moins de ${STEP_UP_MAX_AGE_SEC} secondes est requise.`);
  }

  // 7. Séparation des tâches SoD-01 (BL), SoD-02 (RIB), SoD-03 (pain.001).
  const auditFlags: AuditFlag[] = [];
  const sodGuarded =
    action === 'BL_CONFIRM_RECEIPT' || action === 'PARTNER_APPROVE_RIB_CHANGE' || action === 'PAYMENT_SIGN_PAIN001';
  if (sodGuarded) {
    if (action === 'PAYMENT_SIGN_PAIN001' && ctx.supplierRibStatus === 'ALERTE_RIB_DAF') {
      return deny('SOD_02_RIB_ALERT_PENDING', 'RIB fournisseur en ALERTE_RIB_DAF : paiement bloqué jusqu’à double validation.');
    }
    const found = findSodConflicts(action, ctx);
    if ('unresolved' in found) {
      return deny('SOD_MAKER_UNRESOLVED', "L'auteur de l'étape amont n'est pas renseigné : séparation des tâches invérifiable.");
    }
    const firstConflict = found.conflicts[0];
    if (firstConflict !== undefined) {
      const soloOwnerEligible =
        ctx.orgPlanSegment === 'DIRECT_PME' && ctx.activeHumanMembersCount === 1 && role === 'OWNER_GERANT';
      if (!soloOwnerEligible) {
        return deny(firstConflict, SOD_MESSAGES[firstConflict]);
      }
      if (!stepUpFresh) {
        return deny(
          'ABAC_STEP_UP_MFA_REQUIRED',
          `La dispense SoD du dirigeant unique exige une authentification forte de moins de ${STEP_UP_MAX_AGE_SEC} secondes.`,
        );
      }
      auditFlags.push('SINGLE_OWNER_SOD_WAIVER');
    }
  }

  return { allowed: true, auditFlags };
}
