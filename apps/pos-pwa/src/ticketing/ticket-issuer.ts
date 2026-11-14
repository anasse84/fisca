import { assertCounterAt, buildConsumeStatements, reserveNextTicketNumber } from '../pairing/ticket-sequencer.ts';
import { loadTerminalIdentity } from '../pairing/pairing-flow.ts';
import type { PosStorage, SqlValue } from '../storage/ports.ts';
import { computeCashStampCents, resolveCashStampRule } from './cash-stamp.ts';
import type { CashStampRulePort } from './cash-stamp.ts';
import { POS_CHAIN_GENESIS, computeTicketSha256 } from './ticket-hash.ts';
import type { TicketHashFields } from './ticket-hash.ts';
import { signTicketHash, verifyTicketSignature } from './ticket-signing.ts';

/**
 * Émission d'un ticket de vente signé hors ligne : réservation du numéro, timbre espèces (règle injectée), empreinte chaînée,
 * signature ECDSA, puis UN lot atomique { INSERT pos_tickets, consommation de la réservation, avance du compteur }.
 * Un crash avant le lot laisse la réservation ouverte : la reprise rend le même numéro (aucun trou).
 * Les déclencheurs d'immuabilité de pos_tickets (migration locale v2) ne sont jamais contournés par ce module.
 *
 * Paiements : `payments` ventile le TTC des lignes (HT + TVA). Le timbre se calcule sur la seule part espèces et s'ajoute au
 * TTC ; la part espèces encaissée (`paid_cash_cents`) comprend ce timbre, de sorte que somme des paiements = TTC (timbre inclus).
 * Seule la nature SALE_B2C est émise ici ; l'avoir lié (RETURN_REFUND) n'est pas couvert par ce ticket.
 */

export type TicketIssuanceErrorCode =
  | 'TERMINAL_NOT_PAIRED'
  | 'SESSION_NOT_OPEN'
  | 'AMOUNT_INVALID'
  | 'PAYMENTS_MISMATCH'
  | 'STAMP_RULE_MISSING'
  | 'COUNTER_INCONSISTENT';

export class TicketIssuanceError extends Error {
  readonly code: TicketIssuanceErrorCode;
  constructor(code: TicketIssuanceErrorCode, message: string) {
    super(message);
    this.name = 'TicketIssuanceError';
    this.code = code;
  }
}

export interface TicketLinesInput {
  readonly ht20Cents: number;
  readonly vat20Cents: number;
  readonly ht10Cents: number;
  readonly vat10Cents: number;
  readonly ht0Cents: number;
}

export interface TicketPaymentsInput {
  readonly cashCents: number;
  readonly cardTpeCents: number;
  readonly deliveryAppCents: number;
}

export interface TicketInput {
  readonly sessionId: string;
  readonly ticketKind: 'SALE_B2C';
  readonly lines: TicketLinesInput;
  readonly payments: TicketPaymentsInput;
}

export interface TicketIssuerDeps {
  readonly storage: PosStorage;
  readonly keyPair: CryptoKeyPair;
  readonly stampRules: CashStampRulePort;
  readonly now: () => string;
  readonly newId: () => string;
  readonly newQrToken: () => string;
}

export interface IssuedTicket {
  readonly id: string;
  readonly ticketNumber: string;
  readonly sequence: number;
  readonly stampDutyCents: number;
  readonly totalTtcCents: number;
  readonly prevTicketSha256: string;
  readonly ticketSha256: string;
  readonly signatureB64: string;
}

function assertAmount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TicketIssuanceError('AMOUNT_INVALID', `Montant « ${name} » : entier de centimes sûr et positif ou nul exigé.`);
  }
}

function toSafe(value: bigint, name: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new TicketIssuanceError('AMOUNT_INVALID', `Montant « ${name} » au-delà de l’entier sûr.`);
  return Number(value);
}

/** Partie numérique (séquence) d'un numéro `POS-{MAG}-{TERM}-{AAAA}-{séq6}`. */
export function sequenceFromTicketNumber(ticketNumber: string): number {
  const last = ticketNumber.split('-').at(-1) ?? '';
  if (!/^\d{6,}$/.test(last)) throw new Error(`Numéro de ticket illisible : ${ticketNumber}.`);
  return Number(last);
}

export async function issueSignedTicket(deps: TicketIssuerDeps, input: TicketInput): Promise<IssuedTicket> {
  const { storage } = deps;
  const identity = await loadTerminalIdentity(storage);
  if (identity === null) throw new TicketIssuanceError('TERMINAL_NOT_PAIRED', 'Terminal non appairé : aucun ticket ne peut être émis.');

  const sessions = await storage.all("SELECT id FROM pos_sessions WHERE id = ? AND terminal_id = ? AND status = 'SESSION_OUVERTE_ACTIVE'", [input.sessionId, identity.terminalId]);
  if (sessions.length === 0) throw new TicketIssuanceError('SESSION_NOT_OPEN', 'Aucune session de caisse ouverte pour ce ticket.');

  const { lines, payments } = input;
  for (const [name, value] of Object.entries({ ...lines, ...payments })) assertAmount(name, value);
  const goodsTtc =
    BigInt(lines.ht20Cents) + BigInt(lines.vat20Cents) + BigInt(lines.ht10Cents) + BigInt(lines.vat10Cents) + BigInt(lines.ht0Cents);
  const paid = BigInt(payments.cashCents) + BigInt(payments.cardTpeCents) + BigInt(payments.deliveryAppCents);
  if (paid !== goodsTtc) throw new TicketIssuanceError('PAYMENTS_MISMATCH', 'La somme des paiements diffère du TTC des lignes.');

  const issuedAt = deps.now();
  let stamp: bigint;
  try {
    const rule = await resolveCashStampRule(deps.stampRules, issuedAt);
    stamp = computeCashStampCents(BigInt(payments.cashCents), rule);
  } catch (error) {
    throw new TicketIssuanceError('STAMP_RULE_MISSING', error instanceof Error ? error.message : String(error));
  }
  const stampDutyCents = toSafe(stamp, 'stamp_duty_cents');
  const totalTtcCents = toSafe(goodsTtc + stamp, 'total_ttc_cents');
  const paidCashCents = toSafe(BigInt(payments.cashCents) + stamp, 'paid_cash_cents');

  const reservation = await reserveNextTicketNumber(storage, { year: new Date(issuedAt).getUTCFullYear(), nowIso: issuedAt });
  const previous = await storage.all('SELECT ticket_sha256 FROM pos_tickets WHERE terminal_id = ? ORDER BY rowid DESC LIMIT 1', [identity.terminalId]);
  const prevTicketSha256 = previous[0] === undefined ? POS_CHAIN_GENESIS : String(previous[0]['ticket_sha256']);

  const hashFields: TicketHashFields = {
    terminalId: identity.terminalId,
    terminalSeqNumber: reservation.sequence,
    issuedAtIso: issuedAt,
    ticketKind: input.ticketKind,
    ht20Cents: lines.ht20Cents,
    vat20Cents: lines.vat20Cents,
    ht10Cents: lines.ht10Cents,
    vat10Cents: lines.vat10Cents,
    ht0Cents: lines.ht0Cents,
    stampDutyCents,
    totalTtcCents,
    prevTicketSha256,
  };
  const ticketSha256 = await computeTicketSha256(hashFields);
  const signatureB64 = await signTicketHash(deps.keyPair.privateKey, ticketSha256);
  const id = deps.newId();

  const insertParams: readonly SqlValue[] = [
    id, input.sessionId, identity.terminalId, reservation.ticketNumber, issuedAt, input.ticketKind,
    lines.ht20Cents, lines.vat20Cents, lines.ht10Cents, lines.vat10Cents, lines.ht0Cents,
    stampDutyCents, totalTtcCents, paidCashCents, payments.cardTpeCents, payments.deliveryAppCents,
    deps.newQrToken(), prevTicketSha256, ticketSha256, signatureB64,
  ];
  await storage.batch([
    {
      sql: `INSERT INTO pos_tickets (id, session_id, terminal_id, terminal_seq_number, issued_at, ticket_kind,
        ht_20_cents, vat_20_cents, ht_10_cents, vat_10_cents, ht_0_cents, stamp_duty_cents, total_ttc_cents,
        paid_cash_cents, paid_card_tpe_cents, paid_delivery_app_cents, qr_conversion_token,
        prev_ticket_sha256, ticket_sha256, ecdsa_signature_b64)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: insertParams,
    },
    ...buildConsumeStatements(reservation, issuedAt),
  ]);
  try {
    await assertCounterAt(storage, reservation);
  } catch (error) {
    throw new TicketIssuanceError('COUNTER_INCONSISTENT', error instanceof Error ? error.message : String(error));
  }

  return { id, ticketNumber: reservation.ticketNumber, sequence: reservation.sequence, stampDutyCents, totalTtcCents, prevTicketSha256, ticketSha256, signatureB64 };
}

export type ChainVerification =
  | { readonly ok: true; readonly count: number }
  | { readonly ok: false; readonly reason: 'CHAIN_BROKEN' | 'HASH_MISMATCH' | 'SIGNATURE_INVALID'; readonly ticketNumber: string };

/** Relit tous les tickets : continuité du chaînage, empreinte recalculée depuis les colonnes, signature. */
export async function verifyTicketChain(storage: PosStorage, publicKey: CryptoKey): Promise<ChainVerification> {
  const rows = await storage.all('SELECT * FROM pos_tickets ORDER BY rowid');
  const lastByTerminal = new Map<string, string>();
  for (const row of rows) {
    const ticketNumber = String(row['terminal_seq_number']);
    const terminalId = String(row['terminal_id']);
    const prev = String(row['prev_ticket_sha256']);
    if (prev !== (lastByTerminal.get(terminalId) ?? POS_CHAIN_GENESIS)) return { ok: false, reason: 'CHAIN_BROKEN', ticketNumber };
    const recomputed = await computeTicketSha256({
      terminalId,
      terminalSeqNumber: sequenceFromTicketNumber(ticketNumber),
      issuedAtIso: String(row['issued_at']),
      ticketKind: String(row['ticket_kind']),
      ht20Cents: Number(row['ht_20_cents']),
      vat20Cents: Number(row['vat_20_cents']),
      ht10Cents: Number(row['ht_10_cents']),
      vat10Cents: Number(row['vat_10_cents']),
      ht0Cents: Number(row['ht_0_cents']),
      stampDutyCents: Number(row['stamp_duty_cents']),
      totalTtcCents: Number(row['total_ttc_cents']),
      prevTicketSha256: prev,
    });
    const stored = String(row['ticket_sha256']);
    if (recomputed !== stored) return { ok: false, reason: 'HASH_MISMATCH', ticketNumber };
    if (!(await verifyTicketSignature(publicKey, stored, String(row['ecdsa_signature_b64'])))) return { ok: false, reason: 'SIGNATURE_INVALID', ticketNumber };
    lastByTerminal.set(terminalId, stored);
  }
  return { ok: true, count: rows.length };
}
