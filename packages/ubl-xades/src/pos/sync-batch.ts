/**
 * Moteur PUR de POST /api/v1/pos/sync-batch (CTR-API-16) : lot de tickets signés d'UN terminal.
 *
 * Vérifications, dans l'ordre, par ticket (trié par séquence) : champs → séquence continue depuis le dernier ticket connu →
 * chaînage (prev == empreinte du précédent) → recalcul de l'empreinte → signature ECDSA P-256 (clé du terminal fournie par le port)
 * → TVA recalculée par `divRoundHalfUpBigInt` depuis les taux datés du port → HT + TVA + timbre = TTC → session et origine connues.
 *
 * CHOIX D'ATOMICITÉ (Doc_07 § 03 : « acquitter chaque ticket_id » ; Doc_02 § 13 : séquence par terminal) :
 * - un ticket invalide est REJETÉ avec un code (207 côté route) ; les suivants le sont aussi (PREDECESSOR_REJECTED), car la chaîne
 *   par terminal doit rester continue : les tickets acceptés forment toujours un préfixe contigu ;
 * - les tickets acceptés sont insérés en UN lot atomique (tout ou rien) : un échec d'écriture n'acquitte aucun ticket ;
 * - un conflit (même identifiant avec un contenu différent, séquence ou jeton QR pris par un autre ticket) annule TOUT le lot
 *   avant toute écriture (POS_BATCH_CONFLICT, 409) : le terminal est alors incohérent avec le serveur.
 * Idempotence : un ticket déjà stocké à l'identique est rejoué en succès (REPLAYED), sans écriture (UNIQUE sur l'identifiant).
 * Hypothèse (TVA) : le terminal arrondit UNE fois par taux sur le HT agrégé du ticket ; tout écart est rejeté.
 */
import { divRoundHalfUpBigInt } from '@fisca/shared-types';
import { PosError } from './errors.ts';
import { assertPosTicketHashFields, computePosTicketHash, POS_CHAIN_GENESIS } from './hash.ts';
import {
  POS_TICKET_KINDS,
  type PosClock,
  type PosRejectCode,
  type PosSyncStore,
  type PosSyncResult,
  type PosSyncTicket,
  type PosTerminalDirectory,
  type PosTicketResult,
  type PosVatRates,
  type PosVatRulesPort,
  type StoredPosTicket,
} from './ports.ts';
import { verifyPosTicketSignature } from './signature.ts';

export interface PosSyncPorts {
  readonly store: PosSyncStore;
  readonly terminals: PosTerminalDirectory;
  readonly vatRules: PosVatRulesPort;
  readonly clock: PosClock;
}

export interface PosSyncInput {
  /** Société résolue côté serveur (D-16). */
  readonly companyId: string;
  readonly terminalId: string;
  readonly tickets: readonly PosSyncTicket[];
}

const IDENTIFIER = /^[A-Za-z0-9._-]{1,128}$/;
const QR_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const BPS_MAX = 10_000;

function structurallyValid(ticket: PosSyncTicket, terminalId: string): boolean {
  const kinds: readonly string[] = POS_TICKET_KINDS;
  const nonNegative = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  try {
    assertPosTicketHashFields({ ...ticket, terminalId });
  } catch {
    return false;
  }
  return (
    IDENTIFIER.test(ticket.ticketId) &&
    IDENTIFIER.test(ticket.sessionId) &&
    kinds.includes(ticket.ticketKind) &&
    (ticket.originTicketId === null || IDENTIFIER.test(ticket.originTicketId)) &&
    (ticket.ticketKind !== 'RETURN_REFUND' || ticket.originTicketId !== null) &&
    nonNegative(ticket.paidCashCents) &&
    nonNegative(ticket.paidCardTpeCents) &&
    nonNegative(ticket.paidDeliveryAppCents) &&
    QR_TOKEN.test(ticket.qrConversionToken) &&
    HEX64.test(ticket.ticketSha256) &&
    typeof ticket.ecdsaSignatureB64 === 'string'
  );
}

function sameContent(a: PosSyncTicket, b: PosSyncTicket): boolean {
  return (
    a.ticketId === b.ticketId && a.sessionId === b.sessionId && a.terminalSeqNumber === b.terminalSeqNumber && a.issuedAtIso === b.issuedAtIso &&
    a.ticketKind === b.ticketKind && a.originTicketId === b.originTicketId && a.ht20Cents === b.ht20Cents && a.vat20Cents === b.vat20Cents &&
    a.ht10Cents === b.ht10Cents && a.vat10Cents === b.vat10Cents && a.ht0Cents === b.ht0Cents && a.stampDutyCents === b.stampDutyCents &&
    a.totalTtcCents === b.totalTtcCents && a.paidCashCents === b.paidCashCents && a.paidCardTpeCents === b.paidCardTpeCents &&
    a.paidDeliveryAppCents === b.paidDeliveryAppCents && a.qrConversionToken === b.qrConversionToken && a.prevTicketSha256 === b.prevTicketSha256 &&
    a.ticketSha256 === b.ticketSha256 && a.ecdsaSignatureB64 === b.ecdsaSignatureB64
  );
}

/** TVA d'un taux : division entière arrondie au demi supérieur (ERRATA D-09), jamais de flottant. */
function vatOf(htCents: number, rateBps: number): number {
  return Number(divRoundHalfUpBigInt(BigInt(htCents) * BigInt(rateBps), 10_000n));
}

function ratesUsable(rates: PosVatRates): boolean {
  return [rates.slot20Bps, rates.slot10Bps, rates.slot0Bps].every((bps) => Number.isSafeInteger(bps) && bps >= 0 && bps <= BPS_MAX) && rates.slot0Bps === 0;
}

function totalsCode(ticket: PosSyncTicket, rates: PosVatRates): 'VAT_MISMATCH' | 'TOTAL_MISMATCH' | null {
  if (vatOf(ticket.ht20Cents, rates.slot20Bps) !== ticket.vat20Cents || vatOf(ticket.ht10Cents, rates.slot10Bps) !== ticket.vat10Cents) return 'VAT_MISMATCH';
  const sum = [ticket.ht20Cents, ticket.vat20Cents, ticket.ht10Cents, ticket.vat10Cents, ticket.ht0Cents, ticket.stampDutyCents].reduce((acc, value) => acc + BigInt(value), 0n);
  return sum === BigInt(ticket.totalTtcCents) ? null : 'TOTAL_MISMATCH';
}

export async function syncPosBatch(ports: PosSyncPorts, input: PosSyncInput): Promise<PosSyncResult> {
  const terminal = await ports.terminals.find(input.terminalId);
  if (terminal === null) throw new PosError('POS_TERMINAL_UNKNOWN');
  if (terminal.status !== 'ACTIVE') throw new PosError('POS_TERMINAL_INACTIVE');
  if (terminal.companyId !== input.companyId) throw new PosError('POS_TERMINAL_COMPANY_MISMATCH');

  const tickets = [...input.tickets].sort((a, b) => a.terminalSeqNumber - b.terminalSeqNumber);
  const seen = new Set<string>();
  const duplicates: { path: string; code: string }[] = [];
  for (const [index, ticket] of tickets.entries()) {
    const seqKey = String(ticket.terminalSeqNumber);
    if (seen.has(ticket.ticketId) || seen.has(`seq:${seqKey}`)) duplicates.push({ path: `tickets[${index}]`, code: 'duplicate_in_batch' });
    seen.add(ticket.ticketId);
    seen.add(`seq:${seqKey}`);
  }
  if (duplicates.length > 0) throw new PosError('POS_BATCH_CONFLICT', duplicates);

  const last = await ports.store.lastTicket(input.terminalId);
  const related = await ports.store.findRelated(input.terminalId, tickets);
  const byId = new Map<string, StoredPosTicket>(related.map((row) => [row.ticketId, row]));
  const bySeq = new Map<number, StoredPosTicket>(related.map((row) => [row.terminalSeqNumber, row]));
  const byToken = new Map<string, StoredPosTicket>(related.map((row) => [row.qrConversionToken, row]));

  const conflicts: { path: string; code: string }[] = [];
  for (const [index, ticket] of tickets.entries()) {
    const stored = byId.get(ticket.ticketId);
    if (stored !== undefined) {
      if (!sameContent(stored, ticket)) conflicts.push({ path: `tickets[${index}]`, code: 'ticket_conflict' });
    } else if (bySeq.has(ticket.terminalSeqNumber)) {
      conflicts.push({ path: `tickets[${index}]`, code: 'sequence_conflict' });
    }
  }
  if (conflicts.length > 0) throw new PosError('POS_BATCH_CONFLICT', conflicts);

  const sessions = await ports.store.existingSessions(input.terminalId, [...new Set(tickets.map((ticket) => ticket.sessionId))]);
  const origins = tickets.flatMap((ticket) => (ticket.originTicketId === null ? [] : [ticket.originTicketId]));
  const knownOrigins = await ports.store.existingTicketIds(origins);
  const acceptedIds = new Set<string>();

  const rateCache = new Map<string, PosVatRates | null>();
  let expectedSeq = last === null ? 1 : last.terminalSeqNumber + 1;
  let expectedPrev = last === null ? POS_CHAIN_GENESIS : last.ticketSha256;
  let blocked = false;
  const results: PosTicketResult[] = [];
  const toInsert: PosSyncTicket[] = [];

  const reject = (ticket: PosSyncTicket, code: PosRejectCode): void => {
    blocked = true;
    results.push({ ticketId: ticket.ticketId, terminalSeqNumber: ticket.terminalSeqNumber, outcome: 'REJECTED', code });
  };

  for (const ticket of tickets) {
    if (byId.has(ticket.ticketId)) {
      results.push({ ticketId: ticket.ticketId, terminalSeqNumber: ticket.terminalSeqNumber, outcome: 'REPLAYED' });
      continue;
    }
    if (blocked) {
      results.push({ ticketId: ticket.ticketId, terminalSeqNumber: ticket.terminalSeqNumber, outcome: 'REJECTED', code: 'PREDECESSOR_REJECTED' });
      continue;
    }
    if (!structurallyValid(ticket, input.terminalId)) {
      reject(ticket, 'FIELDS_INVALID');
      continue;
    }
    if (ticket.terminalSeqNumber < expectedSeq) {
      reject(ticket, 'SEQUENCE_REGRESSION');
      continue;
    }
    if (ticket.terminalSeqNumber > expectedSeq) {
      reject(ticket, 'SEQUENCE_GAP');
      continue;
    }
    if (ticket.prevTicketSha256 !== expectedPrev) {
      reject(ticket, 'CHAIN_BREAK');
      continue;
    }
    if ((await computePosTicketHash({ ...ticket, terminalId: input.terminalId })) !== ticket.ticketSha256) {
      reject(ticket, 'HASH_MISMATCH');
      continue;
    }
    let signatureValid: boolean;
    try {
      signatureValid = await verifyPosTicketSignature({ publicKey: terminal.publicKey, ticketHash: ticket.ticketSha256, signature: ticket.ecdsaSignatureB64 });
    } catch (error) {
      if (error instanceof PosError && error.code === 'POS_SIGNATURE_FORMAT_UNKNOWN') {
        reject(ticket, 'SIGNATURE_FORMAT_UNKNOWN');
        continue;
      }
      throw error;
    }
    if (!signatureValid) {
      reject(ticket, 'SIGNATURE_INVALID');
      continue;
    }
    const businessDate = ticket.issuedAtIso.slice(0, 10);
    if (!rateCache.has(businessDate)) rateCache.set(businessDate, await ports.vatRules.ratesAt(businessDate));
    const rates = rateCache.get(businessDate) ?? null;
    if (rates === null || !ratesUsable(rates)) {
      reject(ticket, 'RULES_UNAVAILABLE');
      continue;
    }
    const totals = totalsCode(ticket, rates);
    if (totals !== null) {
      reject(ticket, totals);
      continue;
    }
    if (!sessions.has(ticket.sessionId)) {
      reject(ticket, 'SESSION_UNKNOWN');
      continue;
    }
    if (ticket.originTicketId !== null && !knownOrigins.has(ticket.originTicketId) && !acceptedIds.has(ticket.originTicketId)) {
      reject(ticket, 'ORIGIN_UNKNOWN');
      continue;
    }
    if (byToken.has(ticket.qrConversionToken)) {
      reject(ticket, 'QR_TOKEN_CONFLICT');
      continue;
    }
    expectedSeq = ticket.terminalSeqNumber + 1;
    expectedPrev = ticket.ticketSha256;
    toInsert.push(ticket);
    acceptedIds.add(ticket.ticketId);
    results.push({ ticketId: ticket.ticketId, terminalSeqNumber: ticket.terminalSeqNumber, outcome: 'ACCEPTED' });
  }

  if (toInsert.length > 0) {
    try {
      await ports.store.insertAtomically(input.terminalId, toInsert);
    } catch {
      throw new PosError('POS_SYNC_UNAVAILABLE');
    }
  }
  const count = (outcome: PosTicketResult['outcome']): number => results.filter((result) => result.outcome === outcome).length;
  return { terminalId: input.terminalId, syncedAtIso: ports.clock.nowIso(), results, accepted: count('ACCEPTED'), replayed: count('REPLAYED'), rejected: count('REJECTED') };
}
