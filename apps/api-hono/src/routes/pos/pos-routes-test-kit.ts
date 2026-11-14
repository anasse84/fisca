/** Outillage de test des routes POS : pipeline du socle, base de dossier réelle (SQLite ou PostgreSQL), ports externes de test. Code de test uniquement. */
import { createHash } from 'node:crypto';
import { CONTROL_PLANE_MIGRATIONS, ensureTenantSchemaUpToDate } from '@fisca/db-schema';
import type { SqlParam, SqlStatementParams, TenantSqlDriver } from '@fisca/shared-types';
import { computePosClosureHash, computePosTicketHash, POS_CHAIN_GENESIS, posSeqKey, type PosSyncTicket, type PosTerminalDirectory, type PosVatRulesPort } from '@fisca/ubl-xades/pos';
import type { Hono } from 'hono';
import { createPipelineDeps } from '../../core/pipeline-composition.ts';
import {
  COMPANY_A,
  COMPANY_B,
  USER_1,
  activeRows,
  createFakeEntitlements,
  createFakeKv,
  createFakeMemberships,
  createTestClock,
  createTestJwt,
  grant,
} from '../../core/pipeline-test-support.ts';
import { StepClock, openBareSqliteDriver, openSqliteBackend, seedLedger, type LedgerBackend } from '../../core/ledger-test-harness.ts';
import { createSqlIdempotencyStore } from '../../core/sql-idempotency-store.ts';
import { COMPANY_ID_HEADER, createAccessTokenAuthenticator, type PipelineEnv } from '../../core/tenant-router.ts';
import { createPosRoutes, type PosConversionExternalPorts } from './index.ts';

export { COMPANY_A, COMPANY_B, COMPANY_ID_HEADER, USER_1 };
export const USER_CAISSIER = 'user-caissier';
export const USER_COMPTA = 'user-compta';
export const TERMINAL = 'POS-M01-C01';
export const SESSION = 'sess-1';
export const MAX_BATCH = 5;
export const WINDOW_DAYS = 30;
export const KEY = (n: number): string => `018f3b5e-7c2a-7d3e-8a1b-${n.toString(16).padStart(12, '0')}`;
export const CLIENT_ICE = '001197530853397';
export const Z_ENTRY = 'je-z-1';

export const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

export interface TicketSpec {
  readonly seq: number;
  readonly prev: string;
  readonly ht20?: number;
  readonly vat20?: number;
  readonly stamp?: number;
  readonly total?: number;
}

export interface PosKit {
  readonly app: Hono<PipelineEnv>;
  readonly tenantDb: TenantSqlDriver;
  readonly publicGuard: { turnstileOk: boolean; rateOk: boolean; tokenRateOk: boolean; turnstileTokens: (string | null)[]; rateKeys: string[] };
  readonly publicLookups: string[];
  readonly reports: { traceId: string; errorName: string }[];
  readonly clock: StepClock;
  /** Date ISO courante de l'horloge du kit (modifiable pour tester la fenêtre de conversion). */
  nowOverride: { iso: string | null };
  key(): string;
  token(userId: string): Promise<string>;
  makeTicket(spec: TicketSpec): Promise<PosSyncTicket>;
  makeChain(count: number, start?: number, prev?: string): Promise<PosSyncTicket[]>;
  rows<T>(sql: string, params?: readonly SqlParam[]): Promise<readonly T[]>;
  seedSession(id?: string): Promise<void>;
  /** Clôture Z de la session (ligne `pos_z_closures` + écriture VTE du jour) et passage de la session à CLOTURE_TICKET_Z_SCELLEE. */
  sealZ(options?: { glEntry?: boolean; businessDate?: string }): Promise<void>;
  syncBatch(tickets: readonly PosSyncTicket[], options?: { user?: string | null; company?: string | null; key?: string | null; terminalId?: string; rawBody?: string }): Promise<Response>;
  convert(qrToken: string, body: unknown, options?: { key?: string | null; query?: string; rawBody?: string }): Promise<Response>;
  readonly conversionPorts: PosConversionExternalPorts;
  readonly terminalKeys: { readonly sign: (message: string) => Promise<Uint8Array> };
}

export interface PosKitOptions {
  readonly backend?: LedgerBackend;
  readonly terminalCompany?: string;
  readonly terminalStatus?: 'ACTIVE' | 'DECOMMISSIONED';
}

export async function buildPosKit(options: PosKitOptions = {}): Promise<PosKit> {
  const backend = options.backend ?? (await openSqliteBackend());
  const controlDb = openBareSqliteDriver('control-plane');
  await ensureTenantSchemaUpToDate(null, controlDb, 'control-plane', CONTROL_PLANE_MIGRATIONS);
  const clock = new StepClock();
  const testClock = createTestClock(Date.parse('2026-11-13T10:00:00.000Z'));
  const nowOverride: { iso: string | null } = { iso: null };
  const jwt = await createTestJwt();
  const memberships = createFakeMemberships();
  grant(memberships, USER_1, COMPANY_A, 'OWNER_GERANT');
  grant(memberships, USER_CAISSIER, COMPANY_A, 'CAISSIER_POS');
  grant(memberships, USER_COMPTA, COMPANY_A, 'ACHATS_BUYER');
  const reports: { traceId: string; errorName: string }[] = [];
  const composed = createPipelineDeps({
    controlPlane: controlDb,
    authenticator: createAccessTokenAuthenticator({ verify: (token) => jwt.verify(token, clock.currentEpochSec()) }),
    memberships,
    tenants: {
      getTenantDbUpToDate: async (companyId) => {
        if (companyId === COMPANY_A) return backend.driver;
        throw new Error('base inconnue');
      },
    },
    entitlements: { source: createFakeEntitlements(activeRows([])), kv: createFakeKv(testClock), cacheTtlSec: 120 },
    idempotencyStore: createSqlIdempotencyStore(backend.driver),
    nowMs: testClock.nowMs,
    reportInternalError: (report) => reports.push(report),
  });
  const { cpaMandatePresence, ...pipeline } = composed;
  void cpaMandatePresence;

  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const terminalKeys = { sign: async (message: string) => new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(message))) };
  const terminals: PosTerminalDirectory = {
    find: (terminalId) =>
      Promise.resolve(
        terminalId === TERMINAL
          ? { terminalId, companyId: options.terminalCompany ?? COMPANY_A, status: options.terminalStatus ?? 'ACTIVE', publicKey: { kind: 'jwk', jwk: { kty: 'EC', crv: 'P-256', x: String(exported.x), y: String(exported.y) } } }
          : null,
      ),
  };
  const vatRules: PosVatRulesPort = { ratesAt: () => Promise.resolve({ slot20Bps: 2000, slot10Bps: 1000, slot0Bps: 0 }) };

  const db = backend.driver;
  const publicGuard = { turnstileOk: true, rateOk: true, tokenRateOk: true, turnstileTokens: [] as (string | null)[], rateKeys: [] as string[] };
  const publicLookups: string[] = [];

  const conversionPorts: PosConversionExternalPorts = {
    invoices: {
      buildDraftStatements: (input) => {
        const partnerId = `partner-b2b-${input.clientIce}`;
        const t = input.ticket;
        return Promise.resolve<readonly SqlStatementParams[]>([
          {
            sql: `INSERT INTO fiscal_partners (id, partner_role, tax_category, legal_name_enc, address_adc450_enc, pcge_auxiliary_account, created_at)
                  SELECT ?, 'CLIENT', 'COMPANY_IS', 'enc', 'enc', '34210001', ? WHERE NOT EXISTS (SELECT 1 FROM fiscal_partners WHERE id = ?)`,
            params: [partnerId, input.nowIso, partnerId],
          },
          {
            sql: `INSERT INTO invoices (id, direction, ubl_type_code, pos_ticket_id, partner_id, issue_date, service_delivery_date, legal_due_date, total_ht_cents, total_vat_cents,
                    stamp_duty_cents, total_ttc_cents, net_payable_cents, dgi_payment_method_id, ubl_payment_code, created_at, clearance_state, cdv_lifecycle_status)
                  VALUES (?, 'EMISE', '380_FACTURE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 3, '30_VIREMENT', ?, 'BROUILLON', 'NONE')`,
            params: [
              input.invoiceId, t.ticketId, partnerId, input.nowIso.slice(0, 10), t.issuedAtIso.slice(0, 10), input.nowIso.slice(0, 10),
              t.ht20Cents + t.ht10Cents + t.ht0Cents, t.vat20Cents + t.vat10Cents, t.stampDutyCents, t.totalTtcCents, t.totalTtcCents, input.nowIso,
            ],
          },
        ]);
      },
    },
    reversal: {
      /** Contre-passation B2C du ticket : écriture `B2C_TO_B2B_REVERSAL` liée à la facture B2B (voir SEAM_REQUEST : `reversal_of_entry_id` est unique par pièce). */
      buildReversalStatements: (input) => {
        const t = input.ticket;
        const entryId = `je-rev-${t.ticketId}`;
        const lines: readonly [string, number, number][] = [
          ['acc-71110000', t.ht20Cents + t.ht10Cents + t.ht0Cents, 0],
          ['acc-44551000', t.vat20Cents + t.vat10Cents, 0],
          ['acc-51610000', 0, t.totalTtcCents - t.stampDutyCents],
        ];
        const nonZero = lines.filter(([, debit, credit]) => debit > 0 || credit > 0);
        const total = nonZero.reduce((sum, [, debit]) => sum + debit, 0);
        return Promise.resolve<readonly SqlStatementParams[]>([
          {
            sql: `INSERT INTO journal_entries (id, fiscal_year_id, journal_id, sequence_number, entry_reference, entry_date, status, source_document_type, invoice_id, total_debit_cents, total_credit_cents)
                  VALUES (?, 'fy-2026', 'jr-vte', ?, ?, ?, 'DRAFT', 'B2C_TO_B2B_REVERSAL', ?, ?, ?)`,
            params: [entryId, 100 + Number(t.ticketId.replace(/\D/g, '')), `VTE-REV-${t.ticketId}`, input.businessDate, input.invoiceId, total, total],
          },
          ...nonZero.map(([account, debit, credit], index): SqlStatementParams => ({
            sql: `INSERT INTO journal_entry_lines (id, entry_id, line_number, account_id, description_enc, debit_cents, credit_cents) VALUES (?, ?, ?, ?, 'enc', ?, ?)`,
            params: [`${entryId}-l${index + 1}`, entryId, index + 1, account, debit, credit],
          })),
        ]);
      },
    },
  };

  const app = createPosRoutes({
    pipeline,
    syncPortsFor: () => ({ terminals, vatRules }),
    actorProfiles: { resolve: async () => ({ orgPlanSegment: 'DIRECT_PME', activeHumanMembersCount: 1, canAccessPayrollPii: false }) },
    clock: { nowMs: () => clock.currentEpochSec() * 1000, nowIso: () => nowOverride.iso ?? clock.nowIso() },
    maxBatchSize: MAX_BATCH,
    publicConvert: {
      lookup: {
        resolveByQrToken: (qrToken) => {
          publicLookups.push(qrToken);
          return db.query<{ id: string }>({ sql: 'SELECT id FROM pos_tickets WHERE qr_conversion_token = ?', params: [qrToken] }).then((rows) => (rows.length === 0 ? null : { companyId: COMPANY_A, db }));
        },
      },
      rateLimiter: {
        allow: (key) => {
          publicGuard.rateKeys.push(key);
          return Promise.resolve(key.startsWith('pos-qr:token:') ? publicGuard.tokenRateOk : publicGuard.rateOk);
        },
      },
      turnstile: {
        verify: ({ token }) => {
          publicGuard.turnstileTokens.push(token);
          return Promise.resolve(publicGuard.turnstileOk);
        },
      },
      conversionPortsFor: () => conversionPorts,
      conversionWindowDays: WINDOW_DAYS,
      clock: { nowMs: () => clock.currentEpochSec() * 1000, nowIso: () => nowOverride.iso ?? clock.nowIso() },
      ids: { newId: () => crypto.randomUUID() },
    },
  });

  let keyCounter = 9000;
  const token = (userId: string): Promise<string> => jwt.issue(userId, clock.currentEpochSec());

  const makeTicket = async (spec: TicketSpec): Promise<PosSyncTicket> => {
    const ht20 = spec.ht20 ?? 10000;
    const vat20 = spec.vat20 ?? 2000;
    const stamp = spec.stamp ?? 30;
    const total = spec.total ?? ht20 + vat20 + stamp;
    const issuedAtIso = new Date(Date.parse('2026-11-13T09:00:00.000Z') + spec.seq * 1000).toISOString();
    const hash = await computePosTicketHash({
      terminalId: TERMINAL, terminalSeqNumber: spec.seq, issuedAtIso, ticketKind: 'SALE_B2C', ht20Cents: ht20, vat20Cents: vat20, ht10Cents: 0, vat10Cents: 0, ht0Cents: 0,
      stampDutyCents: stamp, totalTtcCents: total, prevTicketSha256: spec.prev,
    });
    return {
      ticketId: `tkt-${spec.seq}`, sessionId: SESSION, terminalSeqNumber: spec.seq, issuedAtIso, ticketKind: 'SALE_B2C', originTicketId: null, ht20Cents: ht20, vat20Cents: vat20,
      ht10Cents: 0, vat10Cents: 0, ht0Cents: 0, stampDutyCents: stamp, totalTtcCents: total, paidCashCents: total, paidCardTpeCents: 0, paidDeliveryAppCents: 0,
      qrConversionToken: `qr-token-${String(spec.seq).padStart(16, '0')}`, prevTicketSha256: spec.prev, ticketSha256: hash, ecdsaSignatureB64: toBase64(await terminalKeys.sign(hash)),
    };
  };
  const makeChain = async (count: number, start = 1, prev: string = POS_CHAIN_GENESIS): Promise<PosSyncTicket[]> => {
    const out: PosSyncTicket[] = [];
    let previous = prev;
    for (let seq = start; seq < start + count; seq += 1) {
      const ticket = await makeTicket({ seq, prev: previous });
      out.push(ticket);
      previous = ticket.ticketSha256;
    }
    return out;
  };

  return {
    app,
    tenantDb: db,
    publicGuard,
    publicLookups,
    reports,
    clock,
    nowOverride,
    terminalKeys,
    conversionPorts,
    key: () => KEY((keyCounter += 1)),
    token,
    makeTicket,
    makeChain,
    rows: <T>(sql: string, params: readonly SqlParam[] = []) => db.query<T>({ sql, params }),
    seedSession: async (id = SESSION) => {
      await seedLedger(db);
      await db.executeBatchAtomically([
        {
          sql: `INSERT INTO pos_sessions (id, terminal_id, cashier_user_id, opened_at, opening_float_cents, status) VALUES (?, ?, ?, ?, 0, 'SESSION_OUVERTE_ACTIVE')`,
          params: [id, TERMINAL, USER_CAISSIER, '2026-11-13T08:00:00.000Z'],
        },
      ]);
    },
    sealZ: async (zOptions = {}) => {
      const businessDate = zOptions.businessDate ?? '2026-11-13';
      const hash = await computePosClosureHash({
        terminalId: TERMINAL, closureNumber: 1, businessDate, netB2cHt20Cents: 10000, netB2cVat20Cents: 2000, netB2cHt10Cents: 0, netB2cVat10Cents: 0, netB2cHt0Cents: 0,
        totalStampDutyCents: 30, tpeGrossCents: 0, prevZSha256: POS_CHAIN_GENESIS,
      });
      const withEntry = zOptions.glEntry ?? true;
      const statements: SqlStatementParams[] = [];
      if (withEntry) {
        statements.push({
          sql: `INSERT INTO journal_entries (id, fiscal_year_id, journal_id, sequence_number, entry_reference, entry_date, status, source_document_type, total_debit_cents, total_credit_cents)
                VALUES (?, 'fy-2026', 'jr-vte', 1, 'VTE-Z-1', ?, 'DRAFT', 'POS_Z_CLOSURE', 12000, 12000)`,
          params: [Z_ENTRY, businessDate],
        });
      }
      statements.push(
        {
          sql: `INSERT INTO pos_z_closures (id, session_id, terminal_id, closure_number, business_date, net_b2c_ht_20_cents, net_b2c_vat_20_cents, net_b2c_ht_10_cents, net_b2c_vat_10_cents,
                  net_b2c_ht_0_cents, total_stamp_duty_cents, tpe_gross_cents, gl_journal_entry_id, aip_archive_id, prev_z_sha256, z_sha256)
                VALUES (?, ?, ?, 1, ?, 10000, 2000, 0, 0, 0, 30, 0, ?, NULL, ?, ?)`,
          params: ['z-1', SESSION, TERMINAL, businessDate, withEntry ? Z_ENTRY : null, POS_CHAIN_GENESIS, hash],
        },
        { sql: `UPDATE pos_sessions SET status = 'CLOTURE_TICKET_Z_SCELLEE', closed_at = ? WHERE id = ?`, params: ['2026-11-13T20:00:00.000Z', SESSION] },
      );
      await db.executeBatchAtomically(statements);
    },
    syncBatch: async (tickets, o = {}) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const user = o.user === undefined ? USER_1 : o.user;
      if (user !== null) headers['Authorization'] = `Bearer ${await token(user)}`;
      if (o.company !== null) headers[COMPANY_ID_HEADER] = o.company ?? COMPANY_A;
      if (o.key !== null) headers['Idempotency-Key'] = o.key ?? KEY((keyCounter += 1));
      const body = o.rawBody ?? JSON.stringify({ terminalId: o.terminalId ?? TERMINAL, tickets });
      return app.request('/api/v1/pos/sync-batch', { method: 'POST', headers, body });
    },
    convert: async (qrToken, body, o = {}) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (o.key !== null) headers['Idempotency-Key'] = o.key ?? KEY((keyCounter += 1));
      return app.request(`/api/v1/public/pos-qr/${qrToken}/convert-b2b${o.query ?? '?cf-turnstile-response=tok'}`, { method: 'POST', headers, body: o.rawBody ?? JSON.stringify(body) });
    },
  };
}

export const sha256Of = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export { posSeqKey };
