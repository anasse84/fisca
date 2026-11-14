import type { PosStorage, SqlValue } from '../storage/ports.ts';
import { POS_CHAIN_GENESIS, canonicalJsonTuple, sha256HexOfText } from '../ticketing/ticket-hash.ts';
import type { CanonicalValue } from '../ticketing/ticket-hash.ts';
import { signTicketHash, verifyTicketSignature } from '../ticketing/ticket-signing.ts';
import type { ZTicketData } from './z-layout.ts';

/**
 * Clôture Ticket Z scellée (FSM 10, ERRATA D-22, étiquette `FISCA_POS_Z_V1`).
 * Tuple positionnel lu dans `apps/api-hono/src/core/ledger-hasher.ts` (lecture seule) :
 * `["FISCA_POS_Z_V1", terminalId, closureNumber, businessDate, netB2cHt20Cents, netB2cVat20Cents, netB2cHt10Cents,
 *   netB2cVat10Cents, netB2cHt0Cents, totalStampDutyCents, tpeGrossCents, prevZSha256]`.
 * Amorce POS : 64 zéros (CHECK 64 hexadécimaux de `prev_z_sha256`). Signature ECDSA P-256 de l'UTF-8 des 64 hexadécimaux de `z_sha256`,
 * avec la clé non extractable du terminal, rangée dans `pos_z_seals` (la table `pos_z_closures` n'a pas de colonne de signature).
 *
 * Agrégation (interprétation documentée, voir rapport) : tickets de la session, hors `CONVERTI_B2B_AVANT_Z` (exclus du Z B2C) ;
 * les `RETURN_REFUND` se soustraient (net) ; le TPE brut = cartes des seules ventes. Tout en bigint, jamais de flottant.
 */

export const POS_Z_LABEL = 'FISCA_POS_Z_V1' as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type ZClosureErrorCode = 'SESSION_NOT_FOUND' | 'COUNT_NOT_LOCKED' | 'AMOUNT_OUT_OF_RANGE';

export class ZClosureError extends Error {
  readonly code: ZClosureErrorCode;
  constructor(code: ZClosureErrorCode, message: string) {
    super(message);
    this.name = 'ZClosureError';
    this.code = code;
  }
}

export interface ZHashFields {
  readonly terminalId: string;
  readonly closureNumber: number;
  readonly businessDate: string;
  readonly netB2cHt20Cents: number;
  readonly netB2cVat20Cents: number;
  readonly netB2cHt10Cents: number;
  readonly netB2cVat10Cents: number;
  readonly netB2cHt0Cents: number;
  readonly totalStampDutyCents: number;
  readonly tpeGrossCents: number;
  readonly prevZSha256: string;
}

export function buildZTuple(f: ZHashFields): readonly CanonicalValue[] {
  return [
    POS_Z_LABEL, f.terminalId, f.closureNumber, f.businessDate, f.netB2cHt20Cents, f.netB2cVat20Cents, f.netB2cHt10Cents,
    f.netB2cVat10Cents, f.netB2cHt0Cents, f.totalStampDutyCents, f.tpeGrossCents, f.prevZSha256,
  ];
}

export async function computeZSha256(fields: ZHashFields): Promise<string> {
  if (!SHA256_HEX.test(fields.prevZSha256)) throw new TypeError('empreinte Z : prevZSha256 doit être 64 hexadécimaux minuscules (amorce : 64 zéros).');
  return sha256HexOfText(canonicalJsonTuple(buildZTuple(fields)));
}

export interface ZTotals {
  readonly ticketCount: number;
  readonly ht20: bigint;
  readonly vat20: bigint;
  readonly ht10: bigint;
  readonly vat10: bigint;
  readonly ht0: bigint;
  readonly stamp: bigint;
  readonly tpeGross: bigint;
}

const NOT_CONVERTED_BEFORE_Z = "b2b_conversion_state <> 'CONVERTI_B2B_AVANT_Z'";

export async function aggregateSessionTickets(storage: PosStorage, sessionId: string): Promise<ZTotals> {
  const rows = await storage.all(
    `SELECT ticket_kind, ht_20_cents, vat_20_cents, ht_10_cents, vat_10_cents, ht_0_cents, stamp_duty_cents, paid_card_tpe_cents
     FROM pos_tickets WHERE session_id = ? AND ${NOT_CONVERTED_BEFORE_Z} ORDER BY rowid`,
    [sessionId],
  );
  let ht20 = 0n, vat20 = 0n, ht10 = 0n, vat10 = 0n, ht0 = 0n, stamp = 0n, tpeGross = 0n;
  for (const row of rows) {
    const sign = row['ticket_kind'] === 'RETURN_REFUND' ? -1n : 1n;
    const big = (column: string): bigint => BigInt(Number(row[column] ?? 0));
    ht20 += sign * big('ht_20_cents');
    vat20 += sign * big('vat_20_cents');
    ht10 += sign * big('ht_10_cents');
    vat10 += sign * big('vat_10_cents');
    ht0 += sign * big('ht_0_cents');
    stamp += sign * big('stamp_duty_cents');
    if (sign === 1n) tpeGross += big('paid_card_tpe_cents');
  }
  return { ticketCount: rows.length, ht20, vat20, ht10, vat10, ht0, stamp, tpeGross };
}

function safe(value: bigint, name: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new ZClosureError('AMOUNT_OUT_OF_RANGE', `Montant « ${name} » hors de l’entier sûr.`);
  return Number(value);
}

export interface SealedZClosure {
  readonly id: string;
  readonly sessionId: string;
  readonly terminalId: string;
  readonly closureNumber: number;
  readonly businessDate: string;
  readonly totals: ZTotals;
  readonly prevZSha256: string;
  readonly zSha256: string;
  readonly signatureB64: string;
  /** Vrai si la clôture existait déjà (reprise après crash ou second appui) : rien n'a été réécrit. */
  readonly replayed: boolean;
}

export interface SealZDeps {
  readonly storage: PosStorage;
  readonly keyPair: CryptoKeyPair;
  readonly now: () => string;
  readonly newId: () => string;
}

function totalsFromRow(row: Readonly<Record<string, SqlValue>>, ticketCount: number): ZTotals {
  const big = (column: string): bigint => BigInt(Number(row[column]));
  return {
    ticketCount,
    ht20: big('net_b2c_ht_20_cents'), vat20: big('net_b2c_vat_20_cents'), ht10: big('net_b2c_ht_10_cents'), vat10: big('net_b2c_vat_10_cents'),
    ht0: big('net_b2c_ht_0_cents'), stamp: big('total_stamp_duty_cents'), tpeGross: big('tpe_gross_cents'),
  };
}

async function readExisting(storage: PosStorage, sessionId: string): Promise<SealedZClosure | null> {
  const rows = await storage.all(
    'SELECT c.*, s.ecdsa_signature_b64 FROM pos_z_closures c LEFT JOIN pos_z_seals s ON s.closure_id = c.id WHERE c.session_id = ?',
    [sessionId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  const count = await storage.all(`SELECT COUNT(*) AS n FROM pos_tickets WHERE session_id = ? AND ${NOT_CONVERTED_BEFORE_Z}`, [sessionId]);
  return {
    id: String(row['id']), sessionId, terminalId: String(row['terminal_id']), closureNumber: Number(row['closure_number']), businessDate: String(row['business_date']),
    totals: totalsFromRow(row, Number(count[0]?.['n'] ?? 0)), prevZSha256: String(row['prev_z_sha256']), zSha256: String(row['z_sha256']),
    signatureB64: String(row['ecdsa_signature_b64'] ?? ''), replayed: true,
  };
}

/** Données du Ticket Z avant scellement (aperçu) : mêmes agrégats, empreintes absentes. */
export async function previewZClosure(storage: PosStorage, sessionId: string, businessDate: string): Promise<ZTicketData> {
  const sessions = await storage.all('SELECT terminal_id FROM pos_sessions WHERE id = ?', [sessionId]);
  const session = sessions[0];
  if (session === undefined) throw new ZClosureError('SESSION_NOT_FOUND', 'Session de caisse inconnue.');
  const terminalId = String(session['terminal_id']);
  const last = await storage.all('SELECT closure_number FROM pos_z_closures WHERE terminal_id = ? ORDER BY closure_number DESC LIMIT 1', [terminalId]);
  const existing = await readExisting(storage, sessionId);
  if (existing !== null) return toZTicketData(existing);
  const totals = await aggregateSessionTickets(storage, sessionId);
  return {
    terminalId, closureNumber: Number(last[0]?.['closure_number'] ?? 0) + 1, businessDate, ticketCount: totals.ticketCount,
    rates: zRates(totals), stampDutyCents: safe(totals.stamp, 'stamp'), tpeGrossCents: safe(totals.tpeGross, 'tpe'), zSha256: null, prevZSha256: null,
  };
}

/**
 * Libellés des colonnes de `pos_z_closures` (ht_20 / ht_10 / ht_0) : ce sont les taux nommés par le schéma lui-même ;
 * aucun taux n'est calculé ni déduit ici.
 */
const Z_COLUMN_RATES_BPS = [2000, 1000, 0] as const;

function zRates(t: ZTotals): ZTicketData['rates'] {
  const [r20, r10, r0] = Z_COLUMN_RATES_BPS;
  return [
    { vatRateBps: r20, htCents: safe(t.ht20, 'ht20'), vatCents: safe(t.vat20, 'vat20') },
    { vatRateBps: r10, htCents: safe(t.ht10, 'ht10'), vatCents: safe(t.vat10, 'vat10') },
    { vatRateBps: r0, htCents: safe(t.ht0, 'ht0'), vatCents: 0 },
  ];
}

export function toZTicketData(sealed: SealedZClosure): ZTicketData {
  return {
    terminalId: sealed.terminalId, closureNumber: sealed.closureNumber, businessDate: sealed.businessDate, ticketCount: sealed.totals.ticketCount,
    rates: zRates(sealed.totals), stampDutyCents: safe(sealed.totals.stamp, 'stamp'), tpeGrossCents: safe(sealed.totals.tpeGross, 'tpe'),
    zSha256: sealed.zSha256, prevZSha256: sealed.prevZSha256,
  };
}

/**
 * Scelle la clôture : un seul lot atomique { INSERT pos_z_closures, INSERT pos_z_seals, UPDATE session → CLOTURE_TICKET_Z_SCELLEE }.
 * Idempotent : `UNIQUE(session_id)` + lecture préalable → un rejeu (crash après le lot, double appui) renvoie la clôture existante.
 */
export async function sealZClosure(deps: SealZDeps, input: { readonly sessionId: string }): Promise<SealedZClosure> {
  const { storage } = deps;
  const existing = await readExisting(storage, input.sessionId);
  if (existing !== null) return existing;

  const sessions = await storage.all('SELECT terminal_id, status, blind_counted_cash_cents FROM pos_sessions WHERE id = ?', [input.sessionId]);
  const session = sessions[0];
  if (session === undefined) throw new ZClosureError('SESSION_NOT_FOUND', 'Session de caisse inconnue.');
  if (session['status'] !== 'COMPTAGE_AVEUGLE_PRE_Z' || session['blind_counted_cash_cents'] === null) {
    throw new ZClosureError('COUNT_NOT_LOCKED', 'La clôture Z exige le comptage de caisse verrouillé.');
  }
  const terminalId = String(session['terminal_id']);
  const totals = await aggregateSessionTickets(storage, input.sessionId);
  const last = await storage.all('SELECT closure_number, z_sha256 FROM pos_z_closures WHERE terminal_id = ? ORDER BY closure_number DESC LIMIT 1', [terminalId]);
  const closureNumber = Number(last[0]?.['closure_number'] ?? 0) + 1;
  const prevZSha256 = last[0] === undefined ? POS_CHAIN_GENESIS : String(last[0]['z_sha256']);
  const sealedAt = deps.now();
  const businessDate = sealedAt.slice(0, 10);

  const fields: ZHashFields = {
    terminalId, closureNumber, businessDate,
    netB2cHt20Cents: safe(totals.ht20, 'ht20'), netB2cVat20Cents: safe(totals.vat20, 'vat20'), netB2cHt10Cents: safe(totals.ht10, 'ht10'),
    netB2cVat10Cents: safe(totals.vat10, 'vat10'), netB2cHt0Cents: safe(totals.ht0, 'ht0'),
    totalStampDutyCents: safe(totals.stamp, 'stamp'), tpeGrossCents: safe(totals.tpeGross, 'tpe'), prevZSha256,
  };
  const zSha256 = await computeZSha256(fields);
  const signatureB64 = await signTicketHash(deps.keyPair.privateKey, zSha256);
  const id = deps.newId();

  try {
    await storage.batch([
      {
        sql: `INSERT INTO pos_z_closures (id, session_id, terminal_id, closure_number, business_date, net_b2c_ht_20_cents, net_b2c_vat_20_cents,
          net_b2c_ht_10_cents, net_b2c_vat_10_cents, net_b2c_ht_0_cents, total_stamp_duty_cents, tpe_gross_cents, prev_z_sha256, z_sha256)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, input.sessionId, terminalId, closureNumber, businessDate, fields.netB2cHt20Cents, fields.netB2cVat20Cents, fields.netB2cHt10Cents,
          fields.netB2cVat10Cents, fields.netB2cHt0Cents, fields.totalStampDutyCents, fields.tpeGrossCents, prevZSha256, zSha256],
      },
      { sql: 'INSERT INTO pos_z_seals (closure_id, ecdsa_signature_b64, sealed_at) VALUES (?, ?, ?)', params: [id, signatureB64, sealedAt] },
      { sql: "UPDATE pos_sessions SET status = 'CLOTURE_TICKET_Z_SCELLEE', closed_at = ? WHERE id = ? AND status = 'COMPTAGE_AVEUGLE_PRE_Z'", params: [sealedAt, input.sessionId] },
    ]);
  } catch (error) {
    // Concurrence ou reprise : si la clôture existe désormais, c'est la même (UNIQUE(session_id)) ; sinon l'échec est réel.
    const raced = await readExisting(storage, input.sessionId).catch(() => null);
    if (raced !== null) return raced;
    throw error;
  }
  return { id, sessionId: input.sessionId, terminalId, closureNumber, businessDate, totals, prevZSha256, zSha256, signatureB64, replayed: false };
}

export type ZChainVerification =
  | { readonly ok: true; readonly count: number }
  | { readonly ok: false; readonly reason: 'CHAIN_BROKEN' | 'HASH_MISMATCH' | 'SIGNATURE_INVALID'; readonly closureNumber: number };

/** Relit toutes les clôtures : chaînage par terminal, empreinte recalculée depuis les colonnes, signature ECDSA. */
export async function verifyZChain(storage: PosStorage, publicKey: CryptoKey): Promise<ZChainVerification> {
  const rows = await storage.all('SELECT c.*, s.ecdsa_signature_b64 FROM pos_z_closures c LEFT JOIN pos_z_seals s ON s.closure_id = c.id ORDER BY c.terminal_id, c.closure_number');
  const lastByTerminal = new Map<string, string>();
  for (const row of rows) {
    const terminalId = String(row['terminal_id']);
    const closureNumber = Number(row['closure_number']);
    const prev = String(row['prev_z_sha256']);
    if (prev !== (lastByTerminal.get(terminalId) ?? POS_CHAIN_GENESIS)) return { ok: false, reason: 'CHAIN_BROKEN', closureNumber };
    const recomputed = await computeZSha256({
      terminalId, closureNumber, businessDate: String(row['business_date']),
      netB2cHt20Cents: Number(row['net_b2c_ht_20_cents']), netB2cVat20Cents: Number(row['net_b2c_vat_20_cents']),
      netB2cHt10Cents: Number(row['net_b2c_ht_10_cents']), netB2cVat10Cents: Number(row['net_b2c_vat_10_cents']),
      netB2cHt0Cents: Number(row['net_b2c_ht_0_cents']), totalStampDutyCents: Number(row['total_stamp_duty_cents']),
      tpeGrossCents: Number(row['tpe_gross_cents']), prevZSha256: prev,
    });
    const stored = String(row['z_sha256']);
    if (recomputed !== stored) return { ok: false, reason: 'HASH_MISMATCH', closureNumber };
    const signature = row['ecdsa_signature_b64'];
    if (typeof signature !== 'string' || !(await verifyTicketSignature(publicKey, stored, signature))) return { ok: false, reason: 'SIGNATURE_INVALID', closureNumber };
    lastByTerminal.set(terminalId, stored);
  }
  return { ok: true, count: rows.length };
}

export type ZAggregateVerification = { readonly ok: true; readonly count: number } | { readonly ok: false; readonly closureNumber: number };

/** Recoupe chaque clôture avec les tickets actuels de sa session : un ticket ajouté ou modifié après coup est détecté. */
export async function verifyZAggregatesMatchTickets(storage: PosStorage): Promise<ZAggregateVerification> {
  const rows = await storage.all('SELECT * FROM pos_z_closures ORDER BY terminal_id, closure_number');
  for (const row of rows) {
    const t = await aggregateSessionTickets(storage, String(row['session_id']));
    const stored = totalsFromRow(row, t.ticketCount);
    const same = t.ht20 === stored.ht20 && t.vat20 === stored.vat20 && t.ht10 === stored.ht10 && t.vat10 === stored.vat10 && t.ht0 === stored.ht0 && t.stamp === stored.stamp && t.tpeGross === stored.tpeGross;
    if (!same) return { ok: false, closureNumber: Number(row['closure_number']) };
  }
  return { ok: true, count: rows.length };
}
