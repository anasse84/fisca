/**
 * Moteur de clearance (Doc_02 § 02, Doc_17 § 07) : décisions, transitions et soumission idempotente, SANS Workflow Cloudflare.
 * Le Workflow n'est que la colle qui appelle ces fonctions dans des `step.do` / `step.sleep`.
 *
 * Invariants :
 * - le moteur n'attribue, ne modifie ni ne libère aucun numéro : l'attribution relève de l'InvoiceSequencerDO (aucun port
 *   d'allocation n'est même exposé ici) ; un échec définitif laisse la facture dans son état et son numéro intacts ;
 * - la soumission est idempotente par clé = identifiant de facture + SHA-256 du XML signé ;
 * - toute écriture d'état passe par `applyTransition` puis un lot atomique conditionnel (repository.ts).
 */
import { applyTransition, type StateTransitionAuditEvent, type TenantSqlDriver } from '@fisca/shared-types';
import { computeClearanceBackoffSchedule } from './backoff.ts';
import { ClearanceGatewayError, type ClearanceGateway } from './gateway.ts';
import {
  CDV_LIFECYCLE_FSM,
  INVOICE_CLEARANCE_FSM,
  deriveCdvStatus,
  projectCdvStatus,
  type CdvStatus,
  type ClearanceState,
} from './fsm.ts';
import {
  commitAuditOnly,
  commitInvoiceTransition,
  loadInvoiceForClearance,
  loadInvoiceFsmState,
  type ClearanceInvoiceRow,
  type InvoiceColumnUpdate,
} from './repository.ts';

export const CLEARANCE_ACTOR_ID = 'dgi-clearance-workflow';
/** Noms de files (ERRATA D-08) ; Doc_17 ne prévoit ni producteur ni consommateur pour la clearance : exportés pour référence, non utilisés. */
export const CLEARANCE_QUEUE_NAME = 'fisca-xhub-clearance';
export const CLEARANCE_DLQ_NAME = 'dlq-fisca-xhub-clearance';

export type ClearanceEngineErrorCode =
  | 'CLEARANCE_INVOICE_NOT_FOUND'
  | 'CLEARANCE_INVOICE_NOT_SIGNED'
  | 'CLEARANCE_XML_DIGEST_MISMATCH'
  | 'CLEARANCE_IDEMPOTENCY_CONFLICT'
  | 'CDV_INVOICE_NOT_CLEARED'
  | 'CDV_REFERENCE_MISMATCH';

/** Erreur non retentable du moteur ; message constant, sans donnée de facture. */
export class ClearanceEngineError extends Error {
  readonly code: ClearanceEngineErrorCode;

  constructor(code: ClearanceEngineErrorCode) {
    super(code);
    this.name = 'ClearanceEngineError';
    this.code = code;
  }
}

export interface ClearanceClock {
  nowIso(): string;
  nowMs(): number;
}

export interface ClearanceIdSource {
  newId(): string;
}

export type StoredSubmission =
  | { readonly kind: 'CLEARED'; readonly xhubUuid: string; readonly receivedAt: string }
  | { readonly kind: 'REJECTED'; readonly code: string };

export type SubmissionReservation =
  | { readonly outcome: 'RESERVED' }
  | { readonly outcome: 'IN_PROGRESS' }
  | { readonly outcome: 'COMPLETED'; readonly stored: StoredSubmission }
  | { readonly outcome: 'CONFLICT' };

/** Port d'idempotence de soumission ; adapté sur SqlIdempotencyStore par la colle de apps/api-hono. */
export interface SubmissionIdempotencyPort {
  reserve(key: string, fingerprint: string, nowMs: number): Promise<SubmissionReservation>;
  complete(key: string, fingerprint: string, stored: StoredSubmission): Promise<void>;
  release(key: string, fingerprint: string): Promise<void>;
}

export interface ClearancePorts {
  readonly db: TenantSqlDriver;
  readonly gateway: ClearanceGateway;
  readonly idempotency: SubmissionIdempotencyPort;
  readonly clock: ClearanceClock;
  readonly ids: ClearanceIdSource;
  /** XML signé de la facture (archive) ; jamais journalisé. */
  loadSignedXml(invoiceId: string): Promise<string>;
  /** Compteur d'essais de soumission du séquenceur (Doc_01) ; optionnel : n'attribue ni ne libère aucun numéro. */
  recordSubmissionAttempt?(invoiceId: string): Promise<void>;
}

export interface ClearanceInput {
  readonly invoiceId: string;
  /** SHA-256 hexadécimal minuscule du XML signé, fixé à la création de l'instance. */
  readonly xmlSha256: string;
}

export type AttemptOutcome =
  | { readonly kind: 'CLEARED'; readonly xhubUuid: string; readonly receivedAt: string; readonly replayed: boolean }
  | { readonly kind: 'REJECTED'; readonly code: string }
  | { readonly kind: 'TRANSIENT'; readonly code: string };

export type NextAction =
  | { readonly action: 'FINISH' }
  | { readonly action: 'SLEEP_THEN_RETRY'; readonly sleepSeconds: number }
  | { readonly action: 'EXHAUSTED' };

/** Clé d'idempotence de la soumission : identifiant de facture + SHA-256 du XML signé. */
export function clearanceIdempotencyKey(input: ClearanceInput): string {
  return `clearance:${input.invoiceId}:${input.xmlSha256}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Décision pure après une tentative. `retryIndex` = nombre de réessais déjà consommés (0 après la tentative initiale).
 * Rejet permanent ou succès : fin immédiate, aucun réessai. Panne transitoire : attente du barème, puis épuisement après 8 réessais.
 */
export function decideNextAction(outcome: AttemptOutcome, retryIndex: number, schedule: readonly number[] = computeClearanceBackoffSchedule()): NextAction {
  if (outcome.kind !== 'TRANSIENT') return { action: 'FINISH' };
  const sleepSeconds = schedule[retryIndex];
  return sleepSeconds === undefined ? { action: 'EXHAUSTED' } : { action: 'SLEEP_THEN_RETRY', sleepSeconds };
}

/** Précondition : facture connue, signée (SIGNEE_LOI_43_20) ou déjà déposée (rejeu). Renvoie l'état courant. */
export async function prepareClearance(ports: ClearancePorts, input: ClearanceInput): Promise<ClearanceInvoiceRow> {
  const invoice = await loadInvoiceForClearance(ports.db, input.invoiceId);
  if (invoice === null) throw new ClearanceEngineError('CLEARANCE_INVOICE_NOT_FOUND');
  if (invoice.clearanceState !== 'SIGNEE_LOI_43_20' && invoice.clearanceState !== 'DEPOSEE_CERTIFIEE_DGI' && invoice.clearanceState !== 'REJETEE_XHUB') {
    throw new ClearanceEngineError('CLEARANCE_INVOICE_NOT_SIGNED');
  }
  return invoice;
}

/** Une tentative de soumission, idempotente ; ne lève que pour une erreur non retentable ou d'infrastructure. */
export async function attemptClearanceSubmission(ports: ClearancePorts, input: ClearanceInput): Promise<AttemptOutcome> {
  const xml = await ports.loadSignedXml(input.invoiceId);
  if ((await sha256Hex(xml)) !== input.xmlSha256) throw new ClearanceEngineError('CLEARANCE_XML_DIGEST_MISMATCH');
  const key = clearanceIdempotencyKey(input);
  const reservation = await ports.idempotency.reserve(key, input.xmlSha256, ports.clock.nowMs());
  if (reservation.outcome === 'CONFLICT') throw new ClearanceEngineError('CLEARANCE_IDEMPOTENCY_CONFLICT');
  if (reservation.outcome === 'COMPLETED') {
    const stored = reservation.stored;
    return stored.kind === 'CLEARED' ? { kind: 'CLEARED', xhubUuid: stored.xhubUuid, receivedAt: stored.receivedAt, replayed: true } : { kind: 'REJECTED', code: stored.code };
  }
  // RESERVED, ou IN_PROGRESS (reprise après interruption) : la passerelle reçoit la même clé de dédoublonnage.
  if (ports.recordSubmissionAttempt !== undefined) await ports.recordSubmissionAttempt(input.invoiceId);
  try {
    const receipt = await ports.gateway.submit(xml, { invoiceId: input.invoiceId, xmlSha256: input.xmlSha256, idempotencyKey: key });
    await ports.idempotency.complete(key, input.xmlSha256, { kind: 'CLEARED', xhubUuid: receipt.xhubUuid, receivedAt: receipt.receivedAt });
    return { kind: 'CLEARED', xhubUuid: receipt.xhubUuid, receivedAt: receipt.receivedAt, replayed: false };
  } catch (error) {
    if (error instanceof ClearanceGatewayError && error.kind === 'permanent') {
      await ports.idempotency.complete(key, input.xmlSha256, { kind: 'REJECTED', code: error.code });
      return { kind: 'REJECTED', code: error.code };
    }
    await ports.idempotency.release(key, input.xmlSha256);
    // Erreur transitoire typée, ou toute autre panne de la passerelle : code constant, jamais le message d'origine.
    return { kind: 'TRANSIENT', code: error instanceof ClearanceGatewayError ? error.code : 'GATEWAY_UNEXPECTED_ERROR' };
  }
}

export type FinalizeResult =
  | { readonly status: 'DEPOSEE_CERTIFIEE_DGI'; readonly xhubUuid: string; readonly applied: boolean }
  | { readonly status: 'REJETEE_XHUB'; readonly code: string; readonly applied: boolean }
  | { readonly status: 'CLEARANCE_EXHAUSTED'; readonly applied: boolean };

function systemRequest(input: ClearanceInput, from: ClearanceState, to: ClearanceState, suffix: string, proof: string) {
  return {
    entityTable: 'invoices' as const,
    entityId: input.invoiceId,
    expectedFromState: from,
    targetState: to,
    actorKind: 'DETERMINISTIC_SYSTEM' as const,
    actorId: CLEARANCE_ACTOR_ID,
    idempotencyKey: `clearance:${input.invoiceId}:${input.xmlSha256}:${suffix}`,
    reasonOrProofRef: proof,
  };
}

/** Écrit l'issue de la clearance. Rejouable : un état déjà atteint est un no-op (`applied: false`). */
export async function finalizeClearance(ports: ClearancePorts, input: ClearanceInput, outcome: AttemptOutcome | { readonly kind: 'EXHAUSTED' }): Promise<FinalizeResult> {
  const invoice = await prepareClearance(ports, input);
  const options = () => ({ nowIso: ports.clock.nowIso(), auditId: ports.ids.newId() });
  const expected = { clearanceState: invoice.clearanceState, cdvLifecycleStatus: invoice.cdvLifecycleStatus };

  if (outcome.kind === 'CLEARED') {
    if (invoice.clearanceState === 'DEPOSEE_CERTIFIEE_DGI' && invoice.xhubUuid === outcome.xhubUuid) {
      return { status: 'DEPOSEE_CERTIFIEE_DGI', xhubUuid: outcome.xhubUuid, applied: false };
    }
    if (invoice.clearanceState !== 'SIGNEE_LOI_43_20') throw new ClearanceEngineError('CLEARANCE_INVOICE_NOT_SIGNED');
    const state = await loadInvoiceFsmState<ClearanceState>(ports.db, input.invoiceId, 'SIGNEE_LOI_43_20');
    const request = systemRequest(input, 'SIGNEE_LOI_43_20', 'DEPOSEE_CERTIFIEE_DGI', 'DEPOSEE', 'XHUB_UUID_RECEIVED');
    const result = applyTransition(INVOICE_CLEARANCE_FSM, state, request, [], options());
    await commitInvoiceTransition(ports.db, result.audit, expected, { clearanceState: 'DEPOSEE_CERTIFIEE_DGI', xhubUuid: outcome.xhubUuid });
    return { status: 'DEPOSEE_CERTIFIEE_DGI', xhubUuid: outcome.xhubUuid, applied: true };
  }

  if (outcome.kind === 'REJECTED') {
    if (invoice.clearanceState === 'REJETEE_XHUB') return { status: 'REJETEE_XHUB', code: outcome.code, applied: false };
    if (invoice.clearanceState !== 'SIGNEE_LOI_43_20') throw new ClearanceEngineError('CLEARANCE_INVOICE_NOT_SIGNED');
    const state = await loadInvoiceFsmState<ClearanceState>(ports.db, input.invoiceId, 'SIGNEE_LOI_43_20');
    const request = systemRequest(input, 'SIGNEE_LOI_43_20', 'REJETEE_XHUB', 'REJETEE', `XHUB_REJECT:${outcome.code}`);
    const result = applyTransition(INVOICE_CLEARANCE_FSM, state, request, [], options());
    await commitInvoiceTransition(ports.db, result.audit, expected, { clearanceState: 'REJETEE_XHUB' });
    return { status: 'REJETEE_XHUB', code: outcome.code, applied: true };
  }

  // Échec définitif (réessais épuisés) : AUCUN changement d'état ni de numéro ; événement d'audit explicite, posé une seule fois.
  const key = `clearance:${input.invoiceId}:${input.xmlSha256}:EXHAUSTED`;
  const state = await loadInvoiceFsmState<ClearanceState>(ports.db, input.invoiceId, 'SIGNEE_LOI_43_20');
  if (state.appliedIdempotencyKeys.includes(key)) return { status: 'CLEARANCE_EXHAUSTED', applied: false };
  if (invoice.clearanceState !== 'SIGNEE_LOI_43_20') throw new ClearanceEngineError('CLEARANCE_INVOICE_NOT_SIGNED');
  const audit: StateTransitionAuditEvent<string> = {
    id: ports.ids.newId(),
    entityTable: 'invoices',
    entityId: input.invoiceId,
    fromState: invoice.clearanceState,
    toState: invoice.clearanceState,
    actorKind: 'DETERMINISTIC_SYSTEM',
    actorId: CLEARANCE_ACTOR_ID,
    idempotencyKey: key,
    proofRef: 'CLEARANCE_RETRIES_EXHAUSTED',
    createdAtIso: ports.clock.nowIso(),
  };
  await commitAuditOnly(ports.db, audit, expected);
  return { status: 'CLEARANCE_EXHAUSTED', applied: true };
}

export interface ApplyCdvStatusInput {
  readonly invoiceId: string;
  readonly responseId: string;
  readonly status: Exclude<CdvStatus, 'DEPOSEE_CERTIFIEE_DGI'>;
  /** Numéro de facture visé par le message (`DocumentReference/ID`) ; comparé à `invoices.sequential_number`. */
  readonly invoiceReference: string;
  readonly actorKind: 'DETERMINISTIC_SYSTEM' | 'EXTERNAL_WEBHOOK';
  readonly actorId: string;
}

export type ApplyCdvStatusResult = { readonly applied: boolean; readonly from: CdvStatus; readonly to: CdvStatus };

/** Applique un statut CDV par `applyTransition` (transition invalide : FsmTransitionError, rien n'est écrit). Rejeu du même message : no-op. */
export async function applyCdvStatus(
  ports: Pick<ClearancePorts, 'db' | 'clock' | 'ids'>,
  input: ApplyCdvStatusInput,
): Promise<ApplyCdvStatusResult> {
  const invoice = await loadInvoiceForClearance(ports.db, input.invoiceId);
  if (invoice === null) throw new ClearanceEngineError('CLEARANCE_INVOICE_NOT_FOUND');
  if (invoice.sequentialNumber === null || invoice.sequentialNumber !== input.invoiceReference) throw new ClearanceEngineError('CDV_REFERENCE_MISMATCH');
  const current = deriveCdvStatus(invoice.clearanceState, invoice.cdvLifecycleStatus);
  if (current === null) throw new ClearanceEngineError('CDV_INVOICE_NOT_CLEARED');
  const key = `cdv:${input.invoiceId}:${input.responseId}`;
  const state = await loadInvoiceFsmState<CdvStatus>(ports.db, input.invoiceId, current);
  if (state.appliedIdempotencyKeys.includes(key)) return { applied: false, from: current, to: input.status };
  const result = applyTransition(
    CDV_LIFECYCLE_FSM,
    state,
    {
      entityTable: 'invoices',
      entityId: input.invoiceId,
      expectedFromState: current,
      targetState: input.status,
      actorKind: input.actorKind,
      actorId: input.actorId,
      idempotencyKey: key,
      reasonOrProofRef: `CDV:${input.status}`,
    },
    [],
    { nowIso: ports.clock.nowIso(), auditId: ports.ids.newId() },
  );
  const projection = projectCdvStatus(input.status);
  const update: InvoiceColumnUpdate = {
    ...(projection.clearanceState === null ? {} : { clearanceState: projection.clearanceState }),
    ...(projection.cdvColumn === null ? {} : { cdvLifecycleStatus: projection.cdvColumn }),
  };
  await commitInvoiceTransition(ports.db, result.audit, { clearanceState: invoice.clearanceState, cdvLifecycleStatus: invoice.cdvLifecycleStatus }, update);
  return { applied: true, from: current, to: input.status };
}
