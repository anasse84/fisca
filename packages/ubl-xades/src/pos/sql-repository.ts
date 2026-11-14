/**
 * Persistance POS au-dessus de `TenantSqlDriver` (loi 11 : SQL positionnel `?` commun à D1 et PostgreSQL). Le tenant est la base du
 * dossier ; `pos_terminal_meters` vit dans le plan de contrôle (second driver). Les montants sont des entiers (CHECK) ; BIGINT PostgreSQL
 * peut revenir en chaîne selon le pilote : conversion entière stricte.
 */
import type { SqlParam, TenantSqlDriver } from '@fisca/shared-types';
import { PosError } from './errors.ts';
import {
  posSeqKey,
  type PosConversionState,
  type PosConversionStore,
  type PosSyncStore,
  type PosTerminalDirectory,
  type PosTicketForConversion,
  type PosTicketKind,
  type StoredPosTicket,
} from './ports.ts';
import type { PosTerminalPublicKey } from './signature.ts';

function safeInt(value: number | string | bigint, field: string): number {
  const converted = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(converted)) throw new PosError('POS_FIELDS_INVALID', [{ path: field, code: 'invalid_integer' }]);
  return converted;
}

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

interface TicketRow {
  readonly id: string;
  readonly session_id: string;
  readonly terminal_id: string;
  readonly terminal_seq_number: string;
  readonly issued_at: string;
  readonly ticket_kind: string;
  readonly origin_ticket_id: string | null;
  readonly ht_20_cents: number | string;
  readonly vat_20_cents: number | string;
  readonly ht_10_cents: number | string;
  readonly vat_10_cents: number | string;
  readonly ht_0_cents: number | string;
  readonly stamp_duty_cents: number | string;
  readonly total_ttc_cents: number | string;
  readonly paid_cash_cents: number | string;
  readonly paid_card_tpe_cents: number | string;
  readonly paid_delivery_app_cents: number | string;
  readonly qr_conversion_token: string;
  readonly prev_ticket_sha256: string;
  readonly ticket_sha256: string;
  readonly ecdsa_signature_b64: string;
}

const TICKET_COLUMNS =
  'id, session_id, terminal_id, terminal_seq_number, issued_at, ticket_kind, origin_ticket_id, ht_20_cents, vat_20_cents, ht_10_cents, vat_10_cents, ht_0_cents, stamp_duty_cents, total_ttc_cents, paid_cash_cents, paid_card_tpe_cents, paid_delivery_app_cents, qr_conversion_token, prev_ticket_sha256, ticket_sha256, ecdsa_signature_b64';

function seqOf(terminalId: string, key: string): number {
  const prefix = `${terminalId}-`;
  if (!key.startsWith(prefix)) throw new PosError('POS_FIELDS_INVALID', [{ path: 'terminal_seq_number', code: 'invalid' }]);
  return safeInt(key.slice(prefix.length), 'terminal_seq_number');
}

function toStored(row: TicketRow): StoredPosTicket {
  return {
    ticketId: row.id,
    sessionId: row.session_id,
    terminalId: row.terminal_id,
    terminalSeqNumber: seqOf(row.terminal_id, row.terminal_seq_number),
    issuedAtIso: row.issued_at,
    ticketKind: row.ticket_kind as PosTicketKind,
    originTicketId: row.origin_ticket_id,
    ht20Cents: safeInt(row.ht_20_cents, 'ht_20_cents'),
    vat20Cents: safeInt(row.vat_20_cents, 'vat_20_cents'),
    ht10Cents: safeInt(row.ht_10_cents, 'ht_10_cents'),
    vat10Cents: safeInt(row.vat_10_cents, 'vat_10_cents'),
    ht0Cents: safeInt(row.ht_0_cents, 'ht_0_cents'),
    stampDutyCents: safeInt(row.stamp_duty_cents, 'stamp_duty_cents'),
    totalTtcCents: safeInt(row.total_ttc_cents, 'total_ttc_cents'),
    paidCashCents: safeInt(row.paid_cash_cents, 'paid_cash_cents'),
    paidCardTpeCents: safeInt(row.paid_card_tpe_cents, 'paid_card_tpe_cents'),
    paidDeliveryAppCents: safeInt(row.paid_delivery_app_cents, 'paid_delivery_app_cents'),
    qrConversionToken: row.qr_conversion_token,
    prevTicketSha256: row.prev_ticket_sha256,
    ticketSha256: row.ticket_sha256,
    ecdsaSignatureB64: row.ecdsa_signature_b64,
  };
}

export function createSqlPosSyncStore(db: TenantSqlDriver): PosSyncStore {
  return {
    async lastTicket(terminalId) {
      const rows = await db.query<{ terminal_seq_number: string; ticket_sha256: string }>({
        sql: 'SELECT terminal_seq_number, ticket_sha256 FROM pos_tickets WHERE terminal_id = ? ORDER BY terminal_seq_number DESC LIMIT 1',
        params: [terminalId],
      });
      const row = rows[0];
      return row === undefined ? null : { terminalSeqNumber: seqOf(terminalId, row.terminal_seq_number), ticketSha256: row.ticket_sha256 };
    },
    async findRelated(terminalId, tickets) {
      if (tickets.length === 0) return [];
      const ids = tickets.map((ticket) => ticket.ticketId);
      const keys = tickets.map((ticket) => posSeqKey(terminalId, ticket.terminalSeqNumber));
      const tokens = tickets.map((ticket) => ticket.qrConversionToken);
      const rows = await db.query<TicketRow>({
        sql: `SELECT ${TICKET_COLUMNS} FROM pos_tickets WHERE id IN (${placeholders(ids.length)}) OR (terminal_id = ? AND terminal_seq_number IN (${placeholders(keys.length)})) OR qr_conversion_token IN (${placeholders(tokens.length)})`,
        params: [...ids, terminalId, ...keys, ...tokens],
      });
      return rows.map(toStored);
    },
    async existingSessions(terminalId, sessionIds) {
      if (sessionIds.length === 0) return new Set();
      const rows = await db.query<{ id: string }>({
        sql: `SELECT id FROM pos_sessions WHERE terminal_id = ? AND id IN (${placeholders(sessionIds.length)})`,
        params: [terminalId, ...sessionIds],
      });
      return new Set(rows.map((row) => row.id));
    },
    async existingTicketIds(ticketIds) {
      if (ticketIds.length === 0) return new Set();
      const rows = await db.query<{ id: string }>({ sql: `SELECT id FROM pos_tickets WHERE id IN (${placeholders(ticketIds.length)})`, params: [...ticketIds] });
      return new Set(rows.map((row) => row.id));
    },
    async insertAtomically(terminalId, tickets) {
      await db.executeBatchAtomically(
        tickets.map((ticket) => ({
          sql: `INSERT INTO pos_tickets (${TICKET_COLUMNS}) VALUES (${placeholders(21)})`,
          params: [
            ticket.ticketId, ticket.sessionId, terminalId, posSeqKey(terminalId, ticket.terminalSeqNumber), ticket.issuedAtIso, ticket.ticketKind, ticket.originTicketId,
            ticket.ht20Cents, ticket.vat20Cents, ticket.ht10Cents, ticket.vat10Cents, ticket.ht0Cents, ticket.stampDutyCents, ticket.totalTtcCents,
            ticket.paidCashCents, ticket.paidCardTpeCents, ticket.paidDeliveryAppCents, ticket.qrConversionToken, ticket.prevTicketSha256, ticket.ticketSha256,
            ticket.ecdsaSignatureB64,
          ] satisfies SqlParam[],
        })),
      );
    },
  };
}

interface ConversionRow {
  readonly id: string;
  readonly ticket_kind: string;
  readonly session_id: string;
  readonly terminal_id: string;
  readonly issued_at: string;
  readonly ht_20_cents: number | string;
  readonly vat_20_cents: number | string;
  readonly ht_10_cents: number | string;
  readonly vat_10_cents: number | string;
  readonly ht_0_cents: number | string;
  readonly stamp_duty_cents: number | string;
  readonly total_ttc_cents: number | string;
  readonly b2b_conversion_state: string;
  readonly converted_invoice_id: string | null;
  readonly z_id: string | null;
  readonly z_business_date: string | null;
  readonly z_gl_journal_entry_id: string | null;
}

export function createSqlPosConversionStore(db: TenantSqlDriver): PosConversionStore {
  return {
    async findByQrToken(qrToken) {
      const rows = await db.query<ConversionRow>({
        sql: `SELECT t.id, t.ticket_kind, t.session_id, t.terminal_id, t.issued_at, t.ht_20_cents, t.vat_20_cents, t.ht_10_cents, t.vat_10_cents, t.ht_0_cents,
                t.stamp_duty_cents, t.total_ttc_cents, t.b2b_conversion_state, t.converted_invoice_id,
                z.id AS z_id, z.business_date AS z_business_date, z.gl_journal_entry_id AS z_gl_journal_entry_id
              FROM pos_tickets t LEFT JOIN pos_z_closures z ON z.session_id = t.session_id WHERE t.qr_conversion_token = ?`,
        params: [qrToken],
      });
      const row = rows[0];
      if (row === undefined) return null;
      const ticket: PosTicketForConversion = {
        ticketId: row.id,
        ticketKind: row.ticket_kind,
        sessionId: row.session_id,
        terminalId: row.terminal_id,
        issuedAtIso: row.issued_at,
        ht20Cents: safeInt(row.ht_20_cents, 'ht_20_cents'),
        vat20Cents: safeInt(row.vat_20_cents, 'vat_20_cents'),
        ht10Cents: safeInt(row.ht_10_cents, 'ht_10_cents'),
        vat10Cents: safeInt(row.vat_10_cents, 'vat_10_cents'),
        ht0Cents: safeInt(row.ht_0_cents, 'ht_0_cents'),
        stampDutyCents: safeInt(row.stamp_duty_cents, 'stamp_duty_cents'),
        totalTtcCents: safeInt(row.total_ttc_cents, 'total_ttc_cents'),
        conversionState: row.b2b_conversion_state as PosConversionState,
        convertedInvoiceId: row.converted_invoice_id,
        closure: row.z_id === null || row.z_business_date === null ? null : { closureId: row.z_id, businessDate: row.z_business_date, glJournalEntryId: row.z_gl_journal_entry_id },
      };
      return ticket;
    },
    async execute(statements) {
      await db.executeBatchAtomically(statements);
    },
  };
}

/** Licence du terminal (`pos_terminal_meters`, plan de contrôle) ; la clé publique vient du certificat du terminal (port `resolveKey`). */
export function createSqlTerminalDirectory(
  controlPlane: TenantSqlDriver,
  resolveKey: (terminalId: string) => Promise<PosTerminalPublicKey | null>,
): PosTerminalDirectory {
  return {
    async find(terminalId) {
      const rows = await controlPlane.query<{ terminal_id: string; company_id: string; status: string }>({
        sql: 'SELECT terminal_id, company_id, status FROM pos_terminal_meters WHERE terminal_id = ?',
        params: [terminalId],
      });
      const row = rows[0];
      if (row === undefined) return null;
      const publicKey = await resolveKey(terminalId);
      if (publicKey === null) return null;
      return { terminalId: row.terminal_id, companyId: row.company_id, status: row.status === 'ACTIVE' ? 'ACTIVE' : 'DECOMMISSIONED', publicKey };
    },
  };
}
