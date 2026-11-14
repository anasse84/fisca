/** Outillage de test POS : paire ECDSA P-256 de terminal, tickets signés et chaînés, magasin mémoire. Code de test uniquement. */
import {
  computePosTicketHash,
  POS_CHAIN_GENESIS,
  posSeqKey,
  type PosSyncStore,
  type PosSyncTicket,
  type PosTerminalDirectory,
  type PosTerminalRecord,
  type PosVatRulesPort,
  type StoredPosTicket,
} from '../../src/pos/index.ts';

export const TERMINAL = 'POS-M01-C01';
export const COMPANY = 'soc-pos-1';
export const SESSION = 'sess-1';

export interface TerminalKeys {
  readonly publicJwk: { readonly kty: 'EC'; readonly crv: 'P-256'; readonly x: string; readonly y: string };
  readonly sign: (message: string) => Promise<Uint8Array>;
}

export async function newTerminalKeys(): Promise<TerminalKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    publicJwk: { kty: 'EC', crv: 'P-256', x: String(exported.x), y: String(exported.y) },
    sign: async (message) => new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(message))),
  };
}

export const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

export interface TicketSpec {
  readonly seq: number;
  readonly prev: string;
  readonly ht20?: number;
  readonly vat20?: number;
  readonly ht10?: number;
  readonly vat10?: number;
  readonly stamp?: number;
  readonly total?: number;
  readonly kind?: 'SALE_B2C' | 'RETURN_REFUND';
  readonly origin?: string | null;
  readonly session?: string;
}

/** Ticket valide : HT 20 % 10000 → TVA 2000, timbre 30, TTC 12030 (valeurs par défaut). */
export async function makeTicket(keys: TerminalKeys, spec: TicketSpec): Promise<PosSyncTicket> {
  const ht20 = spec.ht20 ?? 10000;
  const vat20 = spec.vat20 ?? 2000;
  const ht10 = spec.ht10 ?? 0;
  const vat10 = spec.vat10 ?? 0;
  const stamp = spec.stamp ?? 30;
  const total = spec.total ?? ht20 + vat20 + ht10 + vat10 + stamp;
  const kind = spec.kind ?? 'SALE_B2C';
  const issuedAtIso = new Date(Date.parse('2026-11-13T09:00:00.000Z') + spec.seq * 1000).toISOString();
  const hash = await computePosTicketHash({
    terminalId: TERMINAL, terminalSeqNumber: spec.seq, issuedAtIso, ticketKind: kind, ht20Cents: ht20, vat20Cents: vat20, ht10Cents: ht10, vat10Cents: vat10,
    ht0Cents: 0, stampDutyCents: stamp, totalTtcCents: total, prevTicketSha256: spec.prev,
  });
  return {
    ticketId: `tkt-${spec.seq}`, sessionId: spec.session ?? SESSION, terminalSeqNumber: spec.seq, issuedAtIso, ticketKind: kind, originTicketId: spec.origin ?? null,
    ht20Cents: ht20, vat20Cents: vat20, ht10Cents: ht10, vat10Cents: vat10, ht0Cents: 0, stampDutyCents: stamp, totalTtcCents: total,
    paidCashCents: total, paidCardTpeCents: 0, paidDeliveryAppCents: 0, qrConversionToken: `qr-token-${String(spec.seq).padStart(16, '0')}`,
    prevTicketSha256: spec.prev, ticketSha256: hash, ecdsaSignatureB64: toBase64(await keys.sign(hash)),
  };
}

export async function makeChain(keys: TerminalKeys, count: number, start = 1, startPrev: string = POS_CHAIN_GENESIS): Promise<PosSyncTicket[]> {
  const out: PosSyncTicket[] = [];
  let prev = startPrev;
  for (let seq = start; seq < start + count; seq += 1) {
    const ticket = await makeTicket(keys, { seq, prev });
    out.push(ticket);
    prev = ticket.ticketSha256;
  }
  return out;
}

export function directoryFor(keys: TerminalKeys, overrides: Partial<PosTerminalRecord> = {}): PosTerminalDirectory & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    lookups,
    find: (terminalId) => {
      lookups.push(terminalId);
      return Promise.resolve(terminalId === TERMINAL ? { terminalId, companyId: COMPANY, status: 'ACTIVE', publicKey: { kind: 'jwk', jwk: keys.publicJwk }, ...overrides } : null);
    },
  };
}

export const RULES_2026: PosVatRulesPort = { ratesAt: () => Promise.resolve({ slot20Bps: 2000, slot10Bps: 1000, slot0Bps: 0 }) };

export interface MemoryStore extends PosSyncStore {
  readonly rows: Map<string, StoredPosTicket>;
  failInsert: boolean;
  inserts: number;
}

export function memoryStore(sessions: readonly string[] = [SESSION]): MemoryStore {
  const rows = new Map<string, StoredPosTicket>();
  const store: MemoryStore = {
    rows,
    failInsert: false,
    inserts: 0,
    lastTicket: (terminalId) => {
      const mine = [...rows.values()].filter((row) => row.terminalId === terminalId).sort((a, b) => b.terminalSeqNumber - a.terminalSeqNumber);
      const top = mine[0];
      return Promise.resolve(top === undefined ? null : { terminalSeqNumber: top.terminalSeqNumber, ticketSha256: top.ticketSha256 });
    },
    findRelated: (terminalId, tickets) =>
      Promise.resolve(
        [...rows.values()].filter((row) =>
          tickets.some((t) => t.ticketId === row.ticketId || (row.terminalId === terminalId && t.terminalSeqNumber === row.terminalSeqNumber) || t.qrConversionToken === row.qrConversionToken),
        ),
      ),
    existingSessions: (_terminal, ids) => Promise.resolve(new Set(ids.filter((id) => sessions.includes(id)))),
    existingTicketIds: (ids) => Promise.resolve(new Set(ids.filter((id) => rows.has(id)))),
    insertAtomically: (terminalId, tickets) => {
      if (store.failInsert) return Promise.reject(new Error('disque plein'));
      store.inserts += 1;
      for (const ticket of tickets) rows.set(ticket.ticketId, { ...ticket, terminalId });
      return Promise.resolve();
    },
  };
  return store;
}

export { posSeqKey };
