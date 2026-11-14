/**
 * Ports et types de la synchronisation POS et de la conversion B2C → B2B. Tous injectés : annuaire des terminaux (licence et clé
 * publique), règles fiscales datées, horloge, magasins SQL, fabriques d'instructions (facture B2B, extourne comptable).
 * Aucune dépendance à Cloudflare, au réseau ou à une base dans ce dossier hors `sql-repository.ts`.
 */
import type { SqlStatementParams } from '@fisca/shared-types';
import type { PosTerminalPublicKey } from './signature.ts';

export const POS_TICKET_KINDS = ['SALE_B2C', 'RETURN_REFUND'] as const;
export type PosTicketKind = (typeof POS_TICKET_KINDS)[number];

/** Ticket signé hors ligne tel que reçu par `sync-batch` (le terminal est porté par le lot, pas par chaque ticket). */
export interface PosSyncTicket {
  readonly ticketId: string;
  readonly sessionId: string;
  /** Entier de la formule d'empreinte ; la colonne `terminal_seq_number` (TEXT UNIQUE) stocke `posSeqKey(terminalId, seq)`. */
  readonly terminalSeqNumber: number;
  readonly issuedAtIso: string;
  readonly ticketKind: PosTicketKind;
  readonly originTicketId: string | null;
  readonly ht20Cents: number;
  readonly vat20Cents: number;
  readonly ht10Cents: number;
  readonly vat10Cents: number;
  readonly ht0Cents: number;
  readonly stampDutyCents: number;
  readonly totalTtcCents: number;
  readonly paidCashCents: number;
  readonly paidCardTpeCents: number;
  readonly paidDeliveryAppCents: number;
  readonly qrConversionToken: string;
  readonly prevTicketSha256: string;
  readonly ticketSha256: string;
  readonly ecdsaSignatureB64: string;
}

/** Clé stockée dans `pos_tickets.terminal_seq_number` : préfixe terminal + séquence sur 9 chiffres (tri lexicographique = tri numérique). */
export function posSeqKey(terminalId: string, seq: number): string {
  return `${terminalId}-${String(seq).padStart(9, '0')}`;
}

export interface PosTerminalRecord {
  readonly terminalId: string;
  readonly companyId: string;
  /** `pos_terminal_meters.status`. */
  readonly status: 'ACTIVE' | 'DECOMMISSIONED';
  /** Clé publique du certificat/licence du terminal (jamais lue du lot). */
  readonly publicKey: PosTerminalPublicKey;
}

export interface PosTerminalDirectory {
  find(terminalId: string): Promise<PosTerminalRecord | null>;
}

/** Taux (points de base) des trois colonnes de ventilation, lus des règles fiscales datées (ADR-04). Aucune constante dans le code. */
export interface PosVatRates {
  readonly slot20Bps: number;
  readonly slot10Bps: number;
  readonly slot0Bps: number;
}

export interface PosVatRulesPort {
  /** Règle en vigueur à la date `AAAA-MM-JJ` ; `null` : aucune règle datée (le ticket est rejeté RULES_UNAVAILABLE). */
  ratesAt(businessDate: string): Promise<PosVatRates | null>;
}

export interface PosClock {
  nowIso(): string;
}

export interface StoredPosTicket extends PosSyncTicket {
  readonly terminalId: string;
}

export interface PosSyncStore {
  lastTicket(terminalId: string): Promise<{ readonly terminalSeqNumber: number; readonly ticketSha256: string } | null>;
  /** Tickets déjà stockés qui partagent l'identifiant, la séquence du terminal ou le jeton QR d'un ticket du lot. */
  findRelated(terminalId: string, tickets: readonly PosSyncTicket[]): Promise<readonly StoredPosTicket[]>;
  existingSessions(terminalId: string, sessionIds: readonly string[]): Promise<ReadonlySet<string>>;
  existingTicketIds(ticketIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Insertion de tous les tickets en UN lot atomique (tout ou rien). */
  insertAtomically(terminalId: string, tickets: readonly PosSyncTicket[]): Promise<void>;
}

export type PosRejectCode =
  | 'FIELDS_INVALID'
  | 'SEQUENCE_REGRESSION'
  | 'SEQUENCE_GAP'
  | 'CHAIN_BREAK'
  | 'HASH_MISMATCH'
  | 'SIGNATURE_INVALID'
  | 'SIGNATURE_FORMAT_UNKNOWN'
  | 'VAT_MISMATCH'
  | 'TOTAL_MISMATCH'
  | 'RULES_UNAVAILABLE'
  | 'SESSION_UNKNOWN'
  | 'ORIGIN_UNKNOWN'
  | 'QR_TOKEN_CONFLICT'
  | 'PREDECESSOR_REJECTED';

export interface PosTicketResult {
  readonly ticketId: string;
  readonly terminalSeqNumber: number;
  readonly outcome: 'ACCEPTED' | 'REPLAYED' | 'REJECTED';
  readonly code?: PosRejectCode;
}

export interface PosSyncResult {
  readonly terminalId: string;
  readonly syncedAtIso: string;
  readonly results: readonly PosTicketResult[];
  readonly accepted: number;
  readonly replayed: number;
  readonly rejected: number;
}

/** Montants d'un ticket converti, repris tels quels par la facture B2B et par l'extourne (somme de TVA conservée). */
export interface PosTicketAmounts {
  readonly ht20Cents: number;
  readonly vat20Cents: number;
  readonly ht10Cents: number;
  readonly vat10Cents: number;
  readonly ht0Cents: number;
  readonly stampDutyCents: number;
  readonly totalTtcCents: number;
}

export type PosConversionState = 'NONE' | 'CONVERTI_B2B_AVANT_Z' | 'CONVERTI_B2B_POST_Z_NEUTRALISE';

export interface PosTicketForConversion extends PosTicketAmounts {
  readonly ticketId: string;
  readonly ticketKind: string;
  readonly sessionId: string;
  readonly terminalId: string;
  readonly issuedAtIso: string;
  readonly conversionState: PosConversionState;
  readonly convertedInvoiceId: string | null;
  /** Clôture Z scellée de la session, ou `null` tant que la session n'est pas clôturée. */
  readonly closure: { readonly closureId: string; readonly businessDate: string; readonly glJournalEntryId: string | null } | null;
}

export interface PosConversionStore {
  findByQrToken(qrToken: string): Promise<PosTicketForConversion | null>;
  /** Instructions et exécution en UN lot atomique. */
  execute(statements: readonly SqlStatementParams[]): Promise<void>;
}

export interface B2bDraftInput {
  readonly invoiceId: string;
  readonly ticket: PosTicketForConversion;
  readonly clientIce: string;
  /** Raison sociale éventuelle : donnée personnelle possible, chiffrée par l'implémentation, jamais journalisée. */
  readonly clientLegalName: string | null;
  readonly nowIso: string;
}

/** Fabrique du brouillon de facture B2B : rend les instructions SQL (partenaire client + facture portant `pos_ticket_id`), sans les exécuter. */
export interface PosB2bInvoicePort {
  buildDraftStatements(input: B2bDraftInput): Promise<readonly SqlStatementParams[]>;
}

export interface PosReversalInput {
  readonly ticket: PosTicketForConversion;
  readonly closureId: string;
  readonly glJournalEntryId: string;
  readonly businessDate: string;
  readonly invoiceId: string;
  readonly nowIso: string;
}

/**
 * Fabrique de l'écriture d'extourne B2C : rend les instructions SQL d'une contre-passation LIÉE par `reversal_of_entry_id`
 * (jamais d'UPDATE d'une pièce POSTED, loi 3, D-03). Les montants (HT, TVA par taux, timbre) sont ceux de `input.ticket`.
 */
export interface PosReversalPort {
  buildReversalStatements(input: PosReversalInput): Promise<readonly SqlStatementParams[]>;
}

export interface PosCertificationStarter {
  /** Après validation de la conversion : certification de la facture B2B (reprenable, hors transaction). */
  start(invoiceId: string): Promise<void>;
}
