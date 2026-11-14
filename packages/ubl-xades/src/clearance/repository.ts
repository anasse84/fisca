/**
 * Persistance de la clearance au-dessus de `TenantSqlDriver` (loi 11 : aucun accès direct à une base ; SQL positionnel `?`
 * commun à D1 et PostgreSQL). Chaque transition d'état est UN lot atomique : INSERT dans `state_transition_audit` puis
 * `UPDATE invoices ... WHERE <états attendus>`, les deux gardés par la même condition d'état attendu (verrou optimiste) ;
 * si l'état a changé entre-temps, rien n'est écrit et `FSM_CONCURRENCY_CONFLICT` est levé. Ce module n'écrit JAMAIS
 * `sequential_number`, `icv_counter` ni `sha256_hash` : le numéro attribué par l'InvoiceSequencerDO n'est ni modifié ni libéré.
 */
import {
  FsmTransitionError,
  type FsmEntityState,
  type SqlParam,
  type SqlStatementParams,
  type StateTransitionAuditEvent,
  type TenantSqlDriver,
} from '@fisca/shared-types';

export interface ClearanceInvoiceRow {
  readonly id: string;
  readonly clearanceState: string;
  readonly cdvLifecycleStatus: string;
  readonly sequentialNumber: string | null;
  readonly xhubUuid: string | null;
}

interface InvoiceDbRow {
  readonly id: string;
  readonly clearance_state: string;
  readonly cdv_lifecycle_status: string;
  readonly sequential_number: string | null;
  readonly xhub_uuid: string | null;
}

export async function loadInvoiceForClearance(db: TenantSqlDriver, invoiceId: string): Promise<ClearanceInvoiceRow | null> {
  const rows = await db.query<InvoiceDbRow>({
    sql: 'SELECT id, clearance_state, cdv_lifecycle_status, sequential_number, xhub_uuid FROM invoices WHERE id = ?',
    params: [invoiceId],
  });
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    clearanceState: row.clearance_state,
    cdvLifecycleStatus: row.cdv_lifecycle_status,
    sequentialNumber: row.sequential_number,
    xhubUuid: row.xhub_uuid,
  };
}

/** État FSM d'une facture : version et clés d'idempotence déduites de `state_transition_audit` (même méthode que le grand livre). */
export async function loadInvoiceFsmState<TState extends string>(db: TenantSqlDriver, invoiceId: string, state: TState): Promise<FsmEntityState<TState>> {
  const rows = await db.query<{ readonly idempotency_key: string }>({
    sql: "SELECT idempotency_key FROM state_transition_audit WHERE entity_table = 'invoices' AND entity_id = ?",
    params: [invoiceId],
  });
  return { entityTable: 'invoices', entityId: invoiceId, state, version: rows.length, appliedIdempotencyKeys: rows.map((row) => row.idempotency_key) };
}

export interface InvoiceStateExpectation {
  readonly clearanceState: string;
  readonly cdvLifecycleStatus: string;
}

export interface InvoiceColumnUpdate {
  readonly clearanceState?: string;
  readonly cdvLifecycleStatus?: string;
  readonly xhubUuid?: string;
  /** Certification uniquement (BROUILLON → NUMEROTEE_VERROUILLEE) : numéro du séquenceur, ICV et PIH précédent. */
  readonly sequentialNumber?: string;
  readonly icvCounter?: number;
  readonly previousPiHash?: string;
  /** Certification uniquement (NUMEROTEE_VERROUILLEE → SIGNEE_LOI_43_20) : PIH de la facture et identifiant d'archive AIP. */
  readonly sha256Hash?: string;
  readonly aipArchiveId?: string;
}

const AUDIT_INSERT = `INSERT INTO state_transition_audit (id, entity_table, entity_id, from_state, to_state, actor_kind, actor_id, idempotency_key, proof_ref, created_at)
  SELECT CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT)
  WHERE EXISTS (SELECT 1 FROM invoices WHERE id = ? AND clearance_state = ? AND cdv_lifecycle_status = ?)`;

function auditStatement(audit: StateTransitionAuditEvent<string>, expected: InvoiceStateExpectation): SqlStatementParams {
  const params: readonly SqlParam[] = [
    audit.id,
    audit.entityTable,
    audit.entityId,
    audit.fromState,
    audit.toState,
    audit.actorKind,
    audit.actorId,
    audit.idempotencyKey,
    audit.proofRef,
    audit.createdAtIso,
    audit.entityId,
    expected.clearanceState,
    expected.cdvLifecycleStatus,
  ];
  return { sql: AUDIT_INSERT, params };
}

function updateStatement(invoiceId: string, expected: InvoiceStateExpectation, update: InvoiceColumnUpdate): SqlStatementParams {
  const sets: string[] = [];
  const params: SqlParam[] = [];
  if (update.clearanceState !== undefined) {
    sets.push('clearance_state = ?');
    params.push(update.clearanceState);
  }
  if (update.cdvLifecycleStatus !== undefined) {
    sets.push('cdv_lifecycle_status = ?');
    params.push(update.cdvLifecycleStatus);
  }
  if (update.xhubUuid !== undefined) {
    sets.push('xhub_uuid = ?');
    params.push(update.xhubUuid);
  }
  const optionalColumns: ReadonlyArray<readonly [string, SqlParam | undefined]> = [
    ['sequential_number', update.sequentialNumber],
    ['icv_counter', update.icvCounter],
    ['previous_pi_hash', update.previousPiHash],
    ['sha256_hash', update.sha256Hash],
    ['aip_archive_id', update.aipArchiveId],
  ];
  for (const [column, value] of optionalColumns) {
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      params.push(value);
    }
  }
  if (sets.length === 0) throw new RangeError('CLEARANCE_UPDATE_EMPTY: aucune colonne à écrire.');
  params.push(invoiceId, expected.clearanceState, expected.cdvLifecycleStatus);
  return { sql: `UPDATE invoices SET ${sets.join(', ')} WHERE id = ? AND clearance_state = ? AND cdv_lifecycle_status = ?`, params };
}

/** Écrit une transition (audit + UPDATE conditionnels) en un lot atomique ; lève FSM_CONCURRENCY_CONFLICT si l'état attendu a changé. */
export async function commitInvoiceTransition(
  db: TenantSqlDriver,
  audit: StateTransitionAuditEvent<string>,
  expected: InvoiceStateExpectation,
  update: InvoiceColumnUpdate,
): Promise<void> {
  const { totalChanges } = await db.executeBatchAtomically([auditStatement(audit, expected), updateStatement(audit.entityId, expected, update)]);
  if (totalChanges < 2) {
    throw new FsmTransitionError('FSM_CONCURRENCY_CONFLICT', `State of [invoices:${audit.entityId}] changed concurrently.`);
  }
}

/** Écrit un événement d'audit SANS changement d'état (échec définitif de clearance : la facture et son numéro restent intacts). */
export async function commitAuditOnly(db: TenantSqlDriver, audit: StateTransitionAuditEvent<string>, expected: InvoiceStateExpectation): Promise<void> {
  const { totalChanges } = await db.executeBatchAtomically([auditStatement(audit, expected)]);
  if (totalChanges < 1) {
    throw new FsmTransitionError('FSM_CONCURRENCY_CONFLICT', `State of [invoices:${audit.entityId}] changed concurrently.`);
  }
}
