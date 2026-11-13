/**
 * RFC 9457 « Problem Details » pour apps/api-hono (ticket T-S1B-11 ; Doc_07 § 01 et § 11).
 *
 * - Le corps de base est validé par `ProblemDetailsSchema` (packages/shared-types, gelé) : type, title, status, errorCode,
 *   traceId, detail, legalRef. Les seules extensions admises sont `instance` (chemin de la requête) et `issues`
 *   (au plus MAX_PROBLEM_ISSUES entrées, textes tronqués) ; elles s'ajoutent après validation du socle.
 * - `onError` ne laisse JAMAIS fuiter un détail interne : le texte d'une erreur n'est jamais recopié dans la réponse,
 *   ni pile, ni requête SQL. Les erreurs typées connues passent par des tables exhaustives (code stable, statut, texte fixe) ;
 *   toute autre erreur donne le 500 constant `INTERNAL_ERROR`.
 */
import { HTTPException } from 'hono/http-exception';
import type { DenialCode, RoleCode } from '@fisca/auth-rbac';
import { SessionJwtError } from '@fisca/auth-rbac';
import { SchemaMigrationError } from '@fisca/db-schema';
import {
  AdrInvariantError,
  FiscaIntegerError,
  FsmTransitionError,
  InfrastructureError,
  ProblemDetailsSchema,
  type FsmErrorCode,
  type InfrastructureErrorCode,
  type ProblemDetails,
  type ProblemIssue,
} from '@fisca/shared-types';
import { LedgerError, type LedgerErrorCode } from './ledger-errors.ts';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json' as const;
/** RFC 9457 § 4.2.1 : `about:blank` quand le type n'ajoute rien à la sémantique du statut HTTP. */
export const PROBLEM_TYPE_ABOUT_BLANK = 'about:blank' as const;
export const MAX_PROBLEM_ISSUES = 20 as const;
const MAX_ISSUE_TEXT_LENGTH = 200;
const MAX_INSTANCE_LENGTH = 200;
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;
const ZERO_TRACE_ID = '00000000000000000000000000000000';

/** Contenu d'un problème avant sérialisation. `detail` doit être un texte fixe, jamais le message d'une exception. */
export interface ProblemInput {
  readonly status: number;
  readonly errorCode: string;
  readonly title: string;
  readonly detail: string;
  readonly legalRef?: string;
  readonly issues?: readonly ProblemIssue[];
  readonly headers?: Readonly<Record<string, string>>;
}

/** Erreur que le code d'une route peut lancer : traduite telle quelle par `onError`. */
export class ProblemError extends Error {
  readonly problem: ProblemInput;

  constructor(problem: ProblemInput) {
    super(problem.errorCode);
    this.name = 'ProblemError';
    this.problem = problem;
  }
}

/** Refus de la politique d'accès (evaluateAccessPolicy) à traduire en 403 : le code de refus devient le code d'erreur. */
export class PolicyDenialError extends Error {
  readonly denialCode: DenialCode;
  readonly role: RoleCode | null;

  constructor(denialCode: DenialCode, role: RoleCode | null = null) {
    super(denialCode);
    this.name = 'PolicyDenialError';
    this.denialCode = denialCode;
    this.role = role;
  }
}

// ---------------------------------------------------------------- trace

export function newTraceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Identifiant de trace W3C : repris de `traceparent` s'il est valide, sinon tiré au hasard. */
export function traceIdFromRequest(traceparent: string | null | undefined, generate: () => string = newTraceId): string {
  const match = traceparent === null || traceparent === undefined ? null : TRACEPARENT_PATTERN.exec(traceparent.trim().toLowerCase());
  const candidate = match?.[1];
  return candidate !== undefined && candidate !== ZERO_TRACE_ID ? candidate : generate();
}

// ---------------------------------------------------------------- fabrique

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function boundedIssues(issues: readonly ProblemIssue[]): ProblemIssue[] {
  return issues.slice(0, MAX_PROBLEM_ISSUES).map((issue) => ({
    path: truncate(issue.path, MAX_ISSUE_TEXT_LENGTH),
    message: truncate(issue.message, MAX_ISSUE_TEXT_LENGTH),
    ...(issue.code !== undefined ? { code: truncate(issue.code, MAX_ISSUE_TEXT_LENGTH) } : {}),
  }));
}

function boundedInstance(instance: string | null): string | null {
  if (instance === null || !instance.startsWith('/')) {
    return null;
  }
  const withoutQuery = instance.split('?')[0] ?? '';
  return truncate(withoutQuery, MAX_INSTANCE_LENGTH);
}

/** Construit le corps : validé par `ProblemDetailsSchema` (instance et issues[] y figurent depuis la PR n° 10), extensions bornées. */
export function buildProblemBody(input: ProblemInput, traceId: string, instance: string | null): ProblemDetails {
  const base = ProblemDetailsSchema.parse({
    type: PROBLEM_TYPE_ABOUT_BLANK,
    title: input.title,
    status: input.status,
    errorCode: input.errorCode,
    traceId,
    detail: input.detail,
    ...(input.legalRef !== undefined ? { legalRef: input.legalRef } : {}),
  });
  const safeInstance = boundedInstance(instance);
  return {
    ...base,
    ...(safeInstance !== null ? { instance: safeInstance } : {}),
    ...(input.issues !== undefined && input.issues.length > 0 ? { issues: boundedIssues(input.issues) } : {}),
  };
}

export function problemResponse(input: ProblemInput, traceId: string, instance: string | null): Response {
  const body = buildProblemBody(input, traceId, instance);
  return new Response(JSON.stringify(body), {
    status: input.status,
    headers: { 'Content-Type': PROBLEM_CONTENT_TYPE, 'Cache-Control': 'no-store', ...(input.headers ?? {}) },
  });
}

/** Variable de contexte de trace (les autres variables du pipeline sont déclarées dans tenant-router.ts). */
export interface TraceVariables {
  traceId?: string;
}

/** Partie du contexte Hono dont les gestionnaires d'erreur ont besoin : tout `Context<E>` dont E porte `traceId` la satisfait. */
export interface TraceContext {
  get(key: 'traceId'): string | undefined;
  readonly req: { readonly path: string };
}

/** Réponse problem+json pour un middleware : reprend l'identifiant de trace et le chemin de la requête. */
export function respondProblem(c: TraceContext, input: ProblemInput): Response {
  return problemResponse(input, c.get('traceId') ?? newTraceId(), c.req.path);
}

// ---------------------------------------------------------------- catalogue de problèmes fixes

export const INTERNAL_ERROR_PROBLEM: ProblemInput = {
  status: 500,
  errorCode: 'INTERNAL_ERROR',
  title: 'Erreur interne',
  detail: 'Une erreur interne est survenue.',
};

export const ROUTE_NOT_FOUND_PROBLEM: ProblemInput = {
  status: 404,
  errorCode: 'ROUTE_NOT_FOUND',
  title: 'Ressource introuvable',
  detail: "Cette route n'existe pas.",
};

function fixed(status: number, errorCode: string, title: string, detail: string): ProblemInput {
  return { status, errorCode, title, detail };
}

/** Refus identique pour « dossier inconnu » et « dossier non autorisé » : aucune énumération (Doc_09 § 12, anti-IDOR). */
export const TENANT_OUT_OF_SCOPE_PROBLEM = fixed(
  403,
  'ABAC_TENANT_OUT_OF_SCOPE',
  'Accès au dossier refusé',
  "Le dossier demandé n'est pas accessible avec cette session.",
);
export const TENANT_UNAVAILABLE_PROBLEM = fixed(
  503,
  'TENANT_UNAVAILABLE',
  'Dossier momentanément indisponible',
  'La base du dossier est momentanément indisponible, réessayez plus tard.',
);

/** Table exhaustive (le compilateur refuse un code d'erreur oublié) : InfrastructureError → problème. */
const INFRASTRUCTURE_PROBLEMS: Readonly<Record<InfrastructureErrorCode, ProblemInput>> = {
  INFRA_INVALID_COMPANY_ID: fixed(400, 'INFRA_INVALID_COMPANY_ID', 'Identifiant de dossier invalide', "L'identifiant de dossier est invalide."),
  INFRA_TENANT_NOT_FOUND: TENANT_OUT_OF_SCOPE_PROBLEM,
  INFRA_SQL_REJECTED: fixed(409, 'INFRA_SQL_REJECTED', 'Écriture refusée par la base', "La base a refusé l'opération."),
  INFRA_SQL_UNSUPPORTED: fixed(503, 'INFRA_SQL_UNSUPPORTED', 'Opération indisponible', "L'opération n'est pas disponible sur ce mode d'infrastructure."),
  INFRA_BATCH_ROLLED_BACK: fixed(409, 'INFRA_BATCH_ROLLED_BACK', 'Lot annulé', "Le lot d'écritures a été annulé en bloc."),
  INFRA_INVALID_OBJECT_KEY: fixed(400, 'INFRA_INVALID_OBJECT_KEY', "Clé d'objet invalide", "La clé d'objet est invalide."),
  INFRA_VAULT_IMMUTABLE: fixed(409, 'INFRA_VAULT_IMMUTABLE', 'Objet immuable', "L'objet du coffre est immuable."),
  INFRA_VAULT_HASH_MISMATCH: fixed(422, 'INFRA_VAULT_HASH_MISMATCH', 'Empreinte incohérente', "L'empreinte fournie ne correspond pas au contenu."),
  INFRA_VAULT_INVALID_RETENTION: fixed(422, 'INFRA_VAULT_INVALID_RETENTION', 'Rétention invalide', 'La durée de rétention demandée est invalide.'),
  INFRA_UNKNOWN_QUEUE: fixed(503, 'INFRA_UNKNOWN_QUEUE', 'File indisponible', 'La file de traitement demandée est indisponible.'),
  INFRA_INVALID_QUEUE_ARGUMENT: fixed(400, 'INFRA_INVALID_QUEUE_ARGUMENT', 'Argument de file invalide', 'Un argument de mise en file est invalide.'),
  INFRA_MIRROR_INVALID_DELTA: fixed(422, 'INFRA_MIRROR_INVALID_DELTA', 'Delta de miroir invalide', 'Le delta de réplication est invalide.'),
  INFRA_MIRROR_SEQUENCE_REJECTED: fixed(409, 'INFRA_MIRROR_SEQUENCE_REJECTED', 'Séquence de miroir refusée', 'La séquence de réplication est refusée.'),
  INFRA_ADAPTER_NOT_FOR_PRODUCTION: INTERNAL_ERROR_PROBLEM,
};

const SCHEMA_MIGRATION_PROBLEM = fixed(
  503,
  'TENANT_SCHEMA_UNAVAILABLE',
  'Schéma du dossier indisponible',
  'Le schéma du dossier ne peut pas être préparé pour le moment.',
);

const fsmConflict = (errorCode: string): ProblemInput => fixed(409, errorCode, 'Transition refusée', "La transition d'état demandée est refusée.");
const FSM_PROBLEMS: Readonly<Record<FsmErrorCode, ProblemInput>> = {
  FSM_ILLEGAL_TRANSITION: fsmConflict('FSM_ILLEGAL_TRANSITION'),
  FSM_FORBIDDEN_ACTOR: fixed(403, 'FSM_FORBIDDEN_ACTOR', 'Acteur non autorisé', "Cet acteur n'est pas autorisé à effectuer cette transition."),
  FSM_MISSING_PROOF: fixed(422, 'FSM_MISSING_PROOF', 'Preuve manquante', 'Une preuve est requise pour cette transition.'),
  FSM_CONCURRENCY_CONFLICT: fsmConflict('FSM_CONCURRENCY_CONFLICT'),
  FSM_DUPLICATE_APPLICATION: fsmConflict('FSM_DUPLICATE_APPLICATION'),
  FSM_TERMINAL_STATE: fsmConflict('FSM_TERMINAL_STATE'),
  FSM_ENTITY_MISMATCH: fixed(422, 'FSM_ENTITY_MISMATCH', 'Entité incohérente', "L'entité ne correspond pas à la transition demandée."),
  FSM_GUARD_FAILED: fixed(422, 'FSM_GUARD_FAILED', 'Condition non remplie', "Une condition de la transition n'est pas remplie."),
  FSM_POSTED_IMMUTABLE: fixed(409, 'FSM_POSTED_IMMUTABLE', 'Pièce comptabilisée immuable', 'Une pièce comptabilisée ne se modifie pas : passez par une contre-passation.'),
  FSM_INVALID_INITIAL_STATE: fixed(422, 'FSM_INVALID_INITIAL_STATE', 'État initial invalide', "L'état initial demandé est invalide."),
  FSM_INVALID_DEFINITION: INTERNAL_ERROR_PROBLEM,
  FSM_INVALID_OPTIONS: INTERNAL_ERROR_PROBLEM,
  FSM_REVERSAL_REQUIRES_POSTED: fixed(409, 'FSM_REVERSAL_REQUIRES_POSTED', 'Contre-passation impossible', 'Seule une pièce comptabilisée peut être contre-passée.'),
  FSM_REVERSAL_SELF_REFERENCE: fixed(422, 'FSM_REVERSAL_SELF_REFERENCE', 'Contre-passation invalide', 'Une pièce ne peut pas se contre-passer elle-même.'),
};

const ledgerInvalid = (errorCode: string): ProblemInput => fixed(422, errorCode, 'Écriture comptable invalide', "L'écriture comptable est invalide.");
const ledgerConflict = (errorCode: string): ProblemInput => fixed(409, errorCode, 'Conflit comptable', "L'opération est en conflit avec l'état du grand livre.");
const ledgerNotFound = (errorCode: string): ProblemInput => fixed(404, errorCode, 'Élément comptable introuvable', "L'élément comptable demandé est introuvable.");
const LEDGER_PROBLEMS: Readonly<Record<LedgerErrorCode, ProblemInput>> = {
  LEDGER_INVALID_INPUT: fixed(400, 'LEDGER_INVALID_INPUT', 'Requête comptable invalide', 'Les données comptables fournies sont invalides.'),
  LEDGER_INVALID_ID_SOURCE: INTERNAL_ERROR_PROBLEM,
  LEDGER_INVALID_INITIAL_STATE: ledgerInvalid('LEDGER_INVALID_INITIAL_STATE'),
  LEDGER_INVALID_AMOUNT: fixed(400, 'LEDGER_INVALID_AMOUNT', 'Montant invalide', 'Un montant doit être un entier exprimé en unité entière.'),
  LEDGER_INVALID_LINE: ledgerInvalid('LEDGER_INVALID_LINE'),
  LEDGER_UNBALANCED: ledgerInvalid('LEDGER_UNBALANCED'),
  LEDGER_UNKNOWN_ACCOUNT: ledgerNotFound('LEDGER_UNKNOWN_ACCOUNT'),
  LEDGER_UNKNOWN_JOURNAL: ledgerNotFound('LEDGER_UNKNOWN_JOURNAL'),
  LEDGER_UNKNOWN_FISCAL_YEAR: ledgerNotFound('LEDGER_UNKNOWN_FISCAL_YEAR'),
  LEDGER_UNKNOWN_ENTRY: ledgerNotFound('LEDGER_UNKNOWN_ENTRY'),
  LEDGER_FISCAL_YEAR_CLOSED: ledgerConflict('LEDGER_FISCAL_YEAR_CLOSED'),
  LEDGER_FISCAL_YEAR_NOT_OPEN: ledgerConflict('LEDGER_FISCAL_YEAR_NOT_OPEN'),
  LEDGER_FISCAL_YEAR_NOT_CLOSING: ledgerConflict('LEDGER_FISCAL_YEAR_NOT_CLOSING'),
  LEDGER_FISCAL_YEAR_NOT_CLOSED: ledgerConflict('LEDGER_FISCAL_YEAR_NOT_CLOSED'),
  LEDGER_ACCESS_DENIED: fixed(403, 'LEDGER_ACCESS_DENIED', 'Accès comptable refusé', "L'accès à cette opération comptable est refusé."),
  LEDGER_ENTRY_NOT_IN_EXPECTED_STATE: ledgerConflict('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE'),
  LEDGER_ENTRY_ALREADY_POSTED: ledgerConflict('LEDGER_ENTRY_ALREADY_POSTED'),
  LEDGER_FSM_REJECTED: ledgerConflict('LEDGER_FSM_REJECTED'),
  LEDGER_IDEMPOTENCY_KEY_REUSED: fixed(422, 'LEDGER_IDEMPOTENCY_KEY_REUSED', "Clé d'idempotence réutilisée", 'Cette clé a déjà servi pour une opération différente.'),
  LEDGER_CONCURRENCY_CONFLICT: ledgerConflict('LEDGER_CONCURRENCY_CONFLICT'),
  LEDGER_NEGATIVE_CASH: ledgerConflict('LEDGER_NEGATIVE_CASH'),
  LEDGER_MISSING_HASH: ledgerInvalid('LEDGER_MISSING_HASH'),
  LEDGER_HASH_INVALID: ledgerInvalid('LEDGER_HASH_INVALID'),
  LEDGER_POSTED_IMMUTABLE: ledgerConflict('LEDGER_POSTED_IMMUTABLE'),
  LEDGER_REVERSAL_REQUIRES_POSTED: ledgerConflict('LEDGER_REVERSAL_REQUIRES_POSTED'),
  LEDGER_ALREADY_REVERSED: ledgerConflict('LEDGER_ALREADY_REVERSED'),
  LEDGER_VAT_CLEARING_EXCEEDS_INVOICE: ledgerInvalid('LEDGER_VAT_CLEARING_EXCEEDS_INVOICE'),
  LEDGER_VAT_CLEARING_DEFERRED_LCN: ledgerConflict('LEDGER_VAT_CLEARING_DEFERRED_LCN'),
  LEDGER_VAT_TARGET_REQUIRED: ledgerInvalid('LEDGER_VAT_TARGET_REQUIRED'),
  LEDGER_VAT_ACCOUNT_UNRESOLVED: ledgerConflict('LEDGER_VAT_ACCOUNT_UNRESOLVED'),
  LEDGER_NOTHING_TO_CLEAR: ledgerConflict('LEDGER_NOTHING_TO_CLEAR'),
  LEDGER_PRECLOSE_CONTROLS_FAILED: ledgerConflict('LEDGER_PRECLOSE_CONTROLS_FAILED'),
  LEDGER_SUSPENSE_NOT_CLEARED: ledgerConflict('LEDGER_SUSPENSE_NOT_CLEARED'),
  LEDGER_UNPOSTED_ENTRIES_REMAIN: ledgerConflict('LEDGER_UNPOSTED_ENTRIES_REMAIN'),
  LEDGER_RESULT_NOT_AFFECTED: ledgerConflict('LEDGER_RESULT_NOT_AFFECTED'),
  LEDGER_NOTHING_TO_CARRY_FORWARD: ledgerConflict('LEDGER_NOTHING_TO_CARRY_FORWARD'),
  LEDGER_OPENING_ALREADY_GENERATED: ledgerConflict('LEDGER_OPENING_ALREADY_GENERATED'),
  LEDGER_STORAGE_FAILURE: fixed(503, 'LEDGER_STORAGE_FAILURE', 'Stockage comptable indisponible', 'Le stockage comptable est momentanément indisponible.'),
};

export const AUTH_REQUIRED_PROBLEM = fixed(401, 'AUTH_REQUIRED', 'Authentification requise', 'Une session active est requise.');

/** Statuts HTTP d'une HTTPException de Hono que l'on restitue (le reste devient le 500 constant). */
const HTTP_EXCEPTION_PROBLEMS: Readonly<Record<number, ProblemInput>> = {
  400: fixed(400, 'REQUEST_INVALID', 'Requête invalide', 'La requête est invalide.'),
  401: AUTH_REQUIRED_PROBLEM,
  403: fixed(403, 'FORBIDDEN', 'Accès refusé', 'Accès refusé.'),
  404: ROUTE_NOT_FOUND_PROBLEM,
  405: fixed(405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée', "Cette méthode n'est pas autorisée sur cette route."),
  413: fixed(413, 'PAYLOAD_TOO_LARGE', 'Corps trop volumineux', 'Le corps de la requête est trop volumineux.'),
  415: fixed(415, 'UNSUPPORTED_MEDIA_TYPE', 'Type de contenu non pris en charge', 'Le type de contenu est non pris en charge.'),
  429: fixed(429, 'RATE_LIMITED', 'Trop de requêtes', 'Limite de débit dépassée, réessayez plus tard.'),
};

/** Correspondance d'une erreur quelconque vers un problème sans détail interne. */
export function problemForError(error: unknown): ProblemInput {
  if (error instanceof ProblemError) {
    return error.problem;
  }
  if (error instanceof PolicyDenialError) {
    return fixed(403, error.denialCode, 'Action refusée', "L'action demandée est refusée par la politique d'accès.");
  }
  if (error instanceof InfrastructureError) {
    return INFRASTRUCTURE_PROBLEMS[error.code];
  }
  if (error instanceof LedgerError) {
    return LEDGER_PROBLEMS[error.code];
  }
  if (error instanceof FsmTransitionError) {
    return FSM_PROBLEMS[error.code];
  }
  if (error instanceof SchemaMigrationError) {
    return SCHEMA_MIGRATION_PROBLEM;
  }
  if (error instanceof SessionJwtError) {
    return AUTH_REQUIRED_PROBLEM;
  }
  if (error instanceof FiscaIntegerError) {
    return fixed(400, 'ADR_03_FLOAT_FORBIDDEN', 'Montant non entier', 'Les montants sont des entiers à unité fixe, jamais des nombres décimaux.');
  }
  if (error instanceof AdrInvariantError) {
    return fixed(422, error.code, 'Invariant violé', "Une règle d'architecture inviolable est violée par la requête.");
  }
  if (error instanceof HTTPException) {
    return HTTP_EXCEPTION_PROBLEMS[error.status] ?? INTERNAL_ERROR_PROBLEM;
  }
  return INTERNAL_ERROR_PROBLEM;
}

// ---------------------------------------------------------------- onError / notFound

export interface InternalErrorReport {
  readonly traceId: string;
  /** Nom de la classe d'erreur seulement : jamais de message, de pile ni de requête. */
  readonly errorName: string;
}

export interface ProblemHandlerOptions {
  readonly reportInternalError?: (report: InternalErrorReport) => void;
}

/** À brancher sur `app.onError` (Hono 4 : `(err, c) => Response`). */
export function createProblemErrorHandler(
  options: ProblemHandlerOptions = {},
): (error: Error, c: TraceContext) => Response {
  return (error, c) => {
    const traceId = c.get('traceId') ?? newTraceId();
    const problem = problemForError(error);
    if (problem.status >= 500 && options.reportInternalError !== undefined) {
      options.reportInternalError({ traceId, errorName: error.name });
    }
    return problemResponse(problem, traceId, c.req.path);
  };
}

/** À brancher sur `app.notFound`. */
export function createProblemNotFoundHandler(): (c: TraceContext) => Response {
  return (c) => respondProblem(c, ROUTE_NOT_FOUND_PROBLEM);
}
