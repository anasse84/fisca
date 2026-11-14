/**
 * Empreintes et chaînes POS (D-22, propriétaire) : SHA-256 hexadécimal minuscule de l'UTF-8 de JSON.stringify([...]) sans espace
 * (`undefined` → `null`, `-0` → `0`, entiers sûrs). Étiquettes `FISCA_POS_TKT_V1` et `FISCA_POS_Z_V1`.
 * Amorce de la chaîne POS : 64 zéros (CHECK 64 hexadécimaux des colonnes `prev_ticket_sha256` / `prev_z_sha256`, migration v4),
 * PAS la genèse de 45 caractères des autres chaînes. WebCrypto uniquement ; aucune arithmétique sur les montants.
 * Article de loi : référence à confirmer par l'expert-comptable (la Section 13 de Doc_02 n'en cite aucun) ; état PROVISOIRE.
 */
import { sha256HexUtf8 } from '../generator/pih.ts';
import { PosError, type PosIssue } from './errors.ts';

export const POS_TICKET_LABEL = 'FISCA_POS_TKT_V1' as const;
export const POS_CLOSURE_LABEL = 'FISCA_POS_Z_V1' as const;
export const POS_CHAIN_GENESIS = '0'.repeat(64);

/** Valeurs du CHECK `pos_tickets.ticket_kind` (db-schema, `POS_TICKET_KINDS`). */
export const POS_STORED_TICKET_KINDS = ['SALE_B2C', 'RETURN_REFUND'] as const;
export type PosStoredTicketKind = (typeof POS_STORED_TICKET_KINDS)[number];

/**
 * Correspondance explicite entre la valeur STOCKÉE de `ticket_kind` et le libellé qui entre dans le tuple d'empreinte.
 * Le vecteur d'or du propriétaire écrit « SALE » pour une vente : la base stocke `SALE_B2C`, donc `SALE_B2C → "SALE"`.
 * `RETURN_REFUND → "RETURN_REFUND"` est une HYPOTHÈSE (aucun vecteur du propriétaire pour un remboursement) : à confirmer.
 * Un client (apps/pos-pwa) qui construit le tuple doit appliquer la même table ; la barrière G2 compare client et serveur.
 */
export const POS_TICKET_KIND_TUPLE_LABEL: Readonly<Record<PosStoredTicketKind, string>> = {
  SALE_B2C: 'SALE',
  RETURN_REFUND: 'RETURN_REFUND',
};

export function posTicketKindTupleLabel(storedKind: string): string {
  const label = (POS_TICKET_KIND_TUPLE_LABEL as Readonly<Record<string, string>>)[storedKind];
  if (label === undefined) throw new PosError('POS_FIELDS_INVALID', [{ path: 'ticketKind', code: 'invalid' }]);
  return label;
}

const HEX64 = /^[0-9a-f]{64}$/;
const TERMINAL_ID = /^[A-Za-z0-9._-]{1,64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface PosTicketHashFields {
  /** `pos_tickets.terminal_id` tel quel (ex. « POS-M01-C01 »). */
  readonly terminalId: string;
  /** Entier de la formule (1, 2, …), PAS la colonne `terminal_seq_number` (TEXT) qui stocke « {terminalId}-{séquence sur 9 chiffres} ». */
  readonly terminalSeqNumber: number;
  readonly issuedAtIso: string;
  /** Valeur stockée (`SALE_B2C` | `RETURN_REFUND`) ; le tuple en reçoit le libellé de `POS_TICKET_KIND_TUPLE_LABEL`. */
  readonly ticketKind: string;
  readonly ht20Cents: number;
  readonly vat20Cents: number;
  readonly ht10Cents: number;
  readonly vat10Cents: number;
  readonly ht0Cents: number;
  readonly stampDutyCents: number;
  readonly totalTtcCents: number;
  readonly prevTicketSha256: string;
}

export interface PosClosureHashFields {
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

/** Sérialisation canonique : JSON.stringify sans espace ; `undefined` → `null` (comportement natif en tableau), `-0` → `0`. */
export function serializePosTuple(values: readonly unknown[]): string {
  return JSON.stringify(values);
}

function isRealInstant(value: string): boolean {
  return ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isRealDate(value: string): boolean {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return ISO_DATE.test(value) && !Number.isNaN(parsed) && new Date(parsed).toISOString().startsWith(value);
}

function check(issues: PosIssue[], path: string, ok: boolean): void {
  if (!ok) issues.push({ path, code: 'invalid' });
}

const isSafeInt = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value);
const isNonNegativeInt = (value: unknown): boolean => isSafeInt(value) && (value as number) >= 0;

function raise(issues: readonly PosIssue[]): void {
  if (issues.length > 0) throw new PosError('POS_FIELDS_INVALID', issues);
}

export function assertPosTicketHashFields(fields: PosTicketHashFields): void {
  const issues: PosIssue[] = [];
  check(issues, 'terminalId', typeof fields.terminalId === 'string' && TERMINAL_ID.test(fields.terminalId));
  check(issues, 'terminalSeqNumber', isSafeInt(fields.terminalSeqNumber) && fields.terminalSeqNumber >= 1);
  check(issues, 'issuedAtIso', typeof fields.issuedAtIso === 'string' && isRealInstant(fields.issuedAtIso));
  check(issues, 'ticketKind', (POS_STORED_TICKET_KINDS as readonly string[]).includes(fields.ticketKind));
  for (const key of ['ht20Cents', 'vat20Cents', 'ht10Cents', 'vat10Cents', 'ht0Cents', 'stampDutyCents', 'totalTtcCents'] as const) {
    check(issues, key, isNonNegativeInt(fields[key]));
  }
  check(issues, 'prevTicketSha256', typeof fields.prevTicketSha256 === 'string' && HEX64.test(fields.prevTicketSha256));
  raise(issues);
}

export function assertPosClosureHashFields(fields: PosClosureHashFields): void {
  const issues: PosIssue[] = [];
  check(issues, 'terminalId', typeof fields.terminalId === 'string' && TERMINAL_ID.test(fields.terminalId));
  check(issues, 'closureNumber', isSafeInt(fields.closureNumber) && fields.closureNumber >= 1);
  check(issues, 'businessDate', typeof fields.businessDate === 'string' && isRealDate(fields.businessDate));
  for (const key of ['netB2cHt20Cents', 'netB2cVat20Cents', 'netB2cHt10Cents', 'netB2cVat10Cents', 'netB2cHt0Cents', 'totalStampDutyCents', 'tpeGrossCents'] as const) {
    check(issues, key, isSafeInt(fields[key]));
  }
  check(issues, 'prevZSha256', typeof fields.prevZSha256 === 'string' && HEX64.test(fields.prevZSha256));
  raise(issues);
}

export function buildPosTicketTuple(f: PosTicketHashFields): readonly unknown[] {
  return [POS_TICKET_LABEL, f.terminalId, f.terminalSeqNumber, f.issuedAtIso, posTicketKindTupleLabel(f.ticketKind), f.ht20Cents, f.vat20Cents, f.ht10Cents, f.vat10Cents, f.ht0Cents, f.stampDutyCents, f.totalTtcCents, f.prevTicketSha256];
}

export function buildPosClosureTuple(f: PosClosureHashFields): readonly unknown[] {
  return [POS_CLOSURE_LABEL, f.terminalId, f.closureNumber, f.businessDate, f.netB2cHt20Cents, f.netB2cVat20Cents, f.netB2cHt10Cents, f.netB2cVat10Cents, f.netB2cHt0Cents, f.totalStampDutyCents, f.tpeGrossCents, f.prevZSha256];
}

export async function computePosTicketHash(fields: PosTicketHashFields): Promise<string> {
  assertPosTicketHashFields(fields);
  return sha256HexUtf8(serializePosTuple(buildPosTicketTuple(fields)));
}

export async function computePosClosureHash(fields: PosClosureHashFields): Promise<string> {
  assertPosClosureHashFields(fields);
  return sha256HexUtf8(serializePosTuple(buildPosClosureTuple(fields)));
}

export type PosChainFailureCode = 'FIELDS_INVALID' | 'TERMINAL_MISMATCH' | 'SEQUENCE_REGRESSION' | 'SEQUENCE_GAP' | 'CHAIN_BREAK' | 'HASH_MISMATCH';

export type PosChainResult = { readonly ok: true } | { readonly ok: false; readonly index: number; readonly code: PosChainFailureCode };

export interface PosChainTicket extends PosTicketHashFields {
  readonly ticketSha256: string;
}
export interface PosChainClosure extends PosClosureHashFields {
  readonly zSha256: string;
}
/** Dernier maillon connu : la chaîne vérifiée doit s'y raccorder. Absent : début de chaîne (séquence 1, amorce de 64 zéros). */
export interface PosTicketAnchor {
  readonly terminalSeqNumber: number;
  readonly ticketSha256: string;
}
export interface PosClosureAnchor {
  readonly closureNumber: number;
  readonly zSha256: string;
}

export async function verifyPosTicketChain(tickets: readonly PosChainTicket[], anchor?: PosTicketAnchor): Promise<PosChainResult> {
  let expectedSeq = anchor === undefined ? 1 : anchor.terminalSeqNumber + 1;
  let expectedPrev = anchor === undefined ? POS_CHAIN_GENESIS : anchor.ticketSha256;
  const terminal = tickets[0]?.terminalId;
  for (const [index, ticket] of tickets.entries()) {
    try {
      assertPosTicketHashFields(ticket);
    } catch {
      return { ok: false, index, code: 'FIELDS_INVALID' };
    }
    if (ticket.terminalId !== terminal) return { ok: false, index, code: 'TERMINAL_MISMATCH' };
    if (ticket.terminalSeqNumber < expectedSeq) return { ok: false, index, code: 'SEQUENCE_REGRESSION' };
    if (ticket.terminalSeqNumber > expectedSeq) return { ok: false, index, code: 'SEQUENCE_GAP' };
    if (ticket.prevTicketSha256 !== expectedPrev) return { ok: false, index, code: 'CHAIN_BREAK' };
    if ((await computePosTicketHash(ticket)) !== ticket.ticketSha256) return { ok: false, index, code: 'HASH_MISMATCH' };
    expectedSeq = ticket.terminalSeqNumber + 1;
    expectedPrev = ticket.ticketSha256;
  }
  return { ok: true };
}

export async function verifyPosClosureChain(closures: readonly PosChainClosure[], anchor?: PosClosureAnchor): Promise<PosChainResult> {
  let expectedNumber = anchor === undefined ? 1 : anchor.closureNumber + 1;
  let expectedPrev = anchor === undefined ? POS_CHAIN_GENESIS : anchor.zSha256;
  const terminal = closures[0]?.terminalId;
  for (const [index, closure] of closures.entries()) {
    try {
      assertPosClosureHashFields(closure);
    } catch {
      return { ok: false, index, code: 'FIELDS_INVALID' };
    }
    if (closure.terminalId !== terminal) return { ok: false, index, code: 'TERMINAL_MISMATCH' };
    if (closure.closureNumber < expectedNumber) return { ok: false, index, code: 'SEQUENCE_REGRESSION' };
    if (closure.closureNumber > expectedNumber) return { ok: false, index, code: 'SEQUENCE_GAP' };
    if (closure.prevZSha256 !== expectedPrev) return { ok: false, index, code: 'CHAIN_BREAK' };
    if ((await computePosClosureHash(closure)) !== closure.zSha256) return { ok: false, index, code: 'HASH_MISMATCH' };
    expectedNumber = closure.closureNumber + 1;
    expectedPrev = closure.zSha256;
  }
  return { ok: true };
}
