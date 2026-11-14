/**
 * Persistance de la certification au-dessus de `TenantSqlDriver` (loi 11 : SQL positionnel `?` commun à D1 et PostgreSQL).
 * Les deux transitions passent par `applyTransition` (INVOICE_CLEARANCE_FSM) puis `commitInvoiceTransition` : audit et UPDATE
 * conditionnels dans un même lot atomique, verrou optimiste sur l'état attendu.
 */
import { applyTransition, type TenantSqlDriver } from '@fisca/shared-types';
import { INVOICE_CLEARANCE_FSM, type ClearanceState } from '../clearance/fsm.ts';
import { commitInvoiceTransition, loadInvoiceFsmState } from '../clearance/repository.ts';
import type { UblTypeCode } from '../generator/invoice-number.ts';
import { CertifyError } from './errors.ts';
import type { CertifiableInvoice, InvoiceCertificationRepository } from './ports.ts';

interface InvoiceRowDb {
  readonly id: string;
  readonly direction: string;
  readonly clearance_state: string;
  readonly cdv_lifecycle_status: string;
  readonly ubl_type_code: string;
  readonly sequential_number: string | null;
  readonly icv_counter: number | null;
  readonly issue_date: string;
  readonly currency_code: string;
  readonly total_ht_cents: number;
  readonly total_vat_cents: number;
  readonly stamp_duty_cents: number;
  readonly total_ttc_cents: number;
  readonly previous_pi_hash: string | null;
  readonly sha256_hash: string | null;
  readonly aip_archive_id: string | null;
}

const COLUMNS =
  'id, direction, clearance_state, cdv_lifecycle_status, ubl_type_code, sequential_number, icv_counter, issue_date, currency_code, total_ht_cents, total_vat_cents, stamp_duty_cents, total_ttc_cents, previous_pi_hash, sha256_hash, aip_archive_id';

const TYPE_CODES: readonly UblTypeCode[] = ['380', '381', '383', '386', '389'];

function typeCodeOf(stored: string): UblTypeCode | null {
  const prefix = stored.split('_')[0] ?? '';
  return TYPE_CODES.find((code) => code === prefix) ?? null;
}

/** Les montants de `invoices` sont des entiers (CHECK) ; PostgreSQL BIGINT peut revenir en chaîne selon le pilote : conversion entière stricte. */
function safeInt(value: number | string, field: string): number {
  const converted = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(converted)) throw new CertifyError('CERTIFY_INVOICE_DATA_INVALID', [{ path: field, code: 'invalid_integer' }]);
  return converted;
}

export function createSqlCertificationRepository(db: TenantSqlDriver): InvoiceCertificationRepository {
  async function transition(input: {
    readonly invoiceId: string;
    readonly from: ClearanceState;
    readonly to: ClearanceState;
    readonly actorKind: 'HUMAN_USER' | 'DETERMINISTIC_SYSTEM';
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly auditId: string;
    readonly nowIso: string;
    readonly update: Parameters<typeof commitInvoiceTransition>[3];
  }): Promise<void> {
    const state = await loadInvoiceFsmState<ClearanceState>(db, input.invoiceId, input.from);
    const result = applyTransition(
      INVOICE_CLEARANCE_FSM,
      state,
      {
        entityTable: 'invoices',
        entityId: input.invoiceId,
        expectedFromState: input.from,
        targetState: input.to,
        actorKind: input.actorKind,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        reasonOrProofRef: `CERTIFY:${input.to}`,
      },
      [],
      { nowIso: input.nowIso, auditId: input.auditId },
    );
    await commitInvoiceTransition(db, result.audit, { clearanceState: input.from, cdvLifecycleStatus: 'NONE' }, input.update);
  }

  return {
    async load(invoiceId): Promise<CertifiableInvoice | null> {
      const rows = await db.query<InvoiceRowDb>({ sql: `SELECT ${COLUMNS} FROM invoices WHERE id = ?`, params: [invoiceId] });
      const row = rows[0];
      if (row === undefined) return null;
      if (row.direction !== 'EMISE') throw new CertifyError('CERTIFY_STATE_INVALID');
      const typeCode = typeCodeOf(row.ubl_type_code);
      if (typeCode === null) throw new CertifyError('CERTIFY_INVOICE_DATA_INVALID', [{ path: 'ubl_type_code', code: 'invalid_value' }]);
      return {
        id: row.id,
        clearanceState: row.clearance_state,
        cdvLifecycleStatus: row.cdv_lifecycle_status,
        typeCode,
        issueYear: Number(row.issue_date.slice(0, 4)),
        sha256Hash: row.sha256_hash,
        aipArchiveId: row.aip_archive_id,
        row: {
          ubl_type_code: row.ubl_type_code,
          sequential_number: row.sequential_number,
          icv_counter: row.icv_counter === null ? null : safeInt(row.icv_counter, 'icv_counter'),
          issue_date: row.issue_date,
          currency_code: row.currency_code,
          total_ht_cents: safeInt(row.total_ht_cents, 'total_ht_cents'),
          total_vat_cents: safeInt(row.total_vat_cents, 'total_vat_cents'),
          stamp_duty_cents: safeInt(row.stamp_duty_cents, 'stamp_duty_cents'),
          total_ttc_cents: safeInt(row.total_ttc_cents, 'total_ttc_cents'),
          previous_pi_hash: row.previous_pi_hash,
        },
      };
    },
    async commitNumbered(input): Promise<void> {
      await transition({
        invoiceId: input.invoiceId,
        from: 'BROUILLON',
        to: 'NUMEROTEE_VERROUILLEE',
        actorKind: 'HUMAN_USER',
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        auditId: input.auditId,
        nowIso: input.nowIso,
        update: {
          clearanceState: 'NUMEROTEE_VERROUILLEE',
          sequentialNumber: input.numbering.sequentialNumber,
          icvCounter: input.numbering.icvCounter,
          previousPiHash: input.numbering.previousPiHash,
        },
      });
    },
    async commitSigned(input): Promise<void> {
      await transition({
        invoiceId: input.invoiceId,
        from: 'NUMEROTEE_VERROUILLEE',
        to: 'SIGNEE_LOI_43_20',
        actorKind: 'DETERMINISTIC_SYSTEM',
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        auditId: input.auditId,
        nowIso: input.nowIso,
        update: { clearanceState: 'SIGNEE_LOI_43_20', sha256Hash: input.piHash, aipArchiveId: input.aipArchiveId },
      });
    },
  };
}

