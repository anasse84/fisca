import { UblGeneratorError, type UblInputIssueDetail } from '../errors.ts';
import { isValidInvoiceNumber } from './invoice-number.ts';

/**
 * Hash chaîné des factures (PIH) et compteur ICV : formules décidées par le propriétaire (aucun texte officiel publié, ERRATA B-13).
 * Empreinte = SHA-256 hexadécimal minuscule de l'UTF-8 de JSON.stringify([...]) sans espace, undefined → null, -0 → 0.
 */

export const INVOICE_PIH_TUPLE_VERSION = 'FISCA_INV_PIH_V1' as const;

/** Amorce de chaîne (Doc_06) : GENESIS_HASH_ + 32 zéros = 45 caractères. */
export const INVOICE_GENESIS_HASH = `GENESIS_HASH_${'0'.repeat(32)}`;

export interface InvoicePihFields {
  /** ICE de l'émetteur, 15 chiffres. */
  readonly emitterIce15: string;
  /** Numéro de facture {FAC|AVO|NDB|ACO|AUT}-{YYYY}-{SEQ6}. */
  readonly sequentialNumber: string;
  /** Compteur ICV monotone, à partir de 1. */
  readonly icvCounter: number;
  /** Code de type UBL (380, 381, 383, 386, 389). */
  readonly ublTypeCode: string;
  /** Date d'émission AAAA-MM-JJ. */
  readonly issueDate: string;
  /** Identifiant de l'acheteur (ICE) ; undefined → null dans le tuple. */
  readonly buyerIdentifier: string | undefined;
  readonly currencyCode: string;
  readonly totalHtCents: number;
  readonly totalVatCents: number;
  readonly stampDutyCents: number;
  readonly totalTtcCents: number;
  /** Empreinte de la facture précédente, ou INVOICE_GENESIS_HASH pour la première. */
  readonly previousPiHash: string;
}

/**
 * Ligne de facture au format des colonnes de `invoices` (packages/db-schema/src/tenant.ts, table `invoices`).
 * Seules les colonnes lues par le tuple sont déclarées ; les autres colonnes de la ligne sont ignorées.
 * `ubl_type_code` porte la valeur stockée (`380_FACTURE`, `381_AVOIR`, `383_NOTE_DEBIT`, `386_ACOMPTE`, `389_AUTOFACTURATION`).
 * `total_ht_cents` EXCLUT les débours (`total_debours_cents` est une colonne distincte, ignorée ici) ;
 * `total_ttc_cents` les INCLUT (CHECK de la base : total_ht + total_debours + total_vat + stamp_duty = total_ttc).
 */
export interface InvoiceRowForPih {
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
}

/**
 * Identifiants que la ligne `invoices` ne porte pas en clair : l'ICE de l'émetteur (société) et l'identifiant de l'acheteur
 * (`fiscal_partners.ice_enc`, chiffré, à déchiffrer par l'appelant). `buyerIdentifier` absent → null dans le tuple.
 */
export interface PihPartyContext {
  readonly emitterIce15: string;
  readonly buyerIdentifier?: string | undefined;
}

/** `380_FACTURE` → `380` (préfixe numérique de la valeur stockée) ; un code déjà nu est conservé. */
function ublTypeCodeOfRow(stored: string): string {
  const separator = stored.indexOf('_');
  return separator === -1 ? stored : stored.slice(0, separator);
}

/**
 * Champs du tuple PIH tirés d'une ligne `invoices` : les colonnes stockées, telles quelles, pour que l'empreinte soit
 * recalculable hors ligne depuis la base. Une colonne NULL requise (numéro, ICV, empreinte précédente) est refusée : aucune valeur devinée.
 */
export function buildPihFieldsFromInvoiceRow(row: InvoiceRowForPih, parties: PihPartyContext): InvoicePihFields {
  const missing: UblInputIssueDetail[] = [];
  if (row.sequential_number === null) missing.push({ path: 'sequential_number', code: 'custom' });
  if (row.icv_counter === null) missing.push({ path: 'icv_counter', code: 'custom' });
  if (row.previous_pi_hash === null) missing.push({ path: 'previous_pi_hash', code: 'custom' });
  if (row.sequential_number === null || row.icv_counter === null || row.previous_pi_hash === null) {
    throw new UblGeneratorError('UBL_PIH_INVALID', `Colonnes requises absentes : ${missing.map((issue) => issue.path).join(', ')}.`, missing);
  }
  const fields: InvoicePihFields = {
    emitterIce15: parties.emitterIce15,
    sequentialNumber: row.sequential_number,
    icvCounter: row.icv_counter,
    ublTypeCode: ublTypeCodeOfRow(row.ubl_type_code),
    issueDate: row.issue_date,
    buyerIdentifier: parties.buyerIdentifier,
    currencyCode: row.currency_code,
    totalHtCents: row.total_ht_cents,
    totalVatCents: row.total_vat_cents,
    stampDutyCents: row.stamp_duty_cents,
    totalTtcCents: row.total_ttc_cents,
    previousPiHash: row.previous_pi_hash,
  };
  assertPihFields(fields);
  return fields;
}

export type PihTupleItem = string | number | null;

const HEX64 = /^[0-9a-f]{64}$/;
const ICE15 = /^\d{15}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPE_CODES: readonly string[] = ['380', '381', '383', '386', '389'];

function isPrevious(value: string): boolean {
  return value === INVOICE_GENESIS_HASH || HEX64.test(value);
}

function isSafeNonNegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Valide les champs ; l'erreur ne porte que des chemins, jamais les valeurs. */
export function assertPihFields(fields: InvoicePihFields): void {
  const issues: UblInputIssueDetail[] = [];
  const check = (path: string, ok: boolean): void => {
    if (!ok) issues.push({ path, code: 'custom' });
  };
  check('emitterIce15', ICE15.test(fields.emitterIce15));
  check('sequentialNumber', isValidInvoiceNumber(fields.sequentialNumber));
  check('icvCounter', Number.isSafeInteger(fields.icvCounter) && fields.icvCounter >= 1);
  check('ublTypeCode', TYPE_CODES.includes(fields.ublTypeCode));
  check('issueDate', ISO_DATE.test(fields.issueDate));
  check('buyerIdentifier', fields.buyerIdentifier === undefined || fields.buyerIdentifier.length > 0);
  check('currencyCode', /^[A-Z]{3}$/.test(fields.currencyCode));
  check('totalHtCents', isSafeNonNegative(fields.totalHtCents));
  check('totalVatCents', isSafeNonNegative(fields.totalVatCents));
  check('stampDutyCents', isSafeNonNegative(fields.stampDutyCents));
  check('totalTtcCents', isSafeNonNegative(fields.totalTtcCents));
  check('previousPiHash', isPrevious(fields.previousPiHash));
  if (issues.length > 0) {
    throw new UblGeneratorError('UBL_PIH_INVALID', `Champs PIH invalides : ${issues.map((issue) => issue.path).join(', ')}.`, issues);
  }
}

/** -0 → 0 ; les entiers sûrs seuls sont admis (assertPihFields). */
function normaliseNumber(value: number): number {
  return value === 0 ? 0 : value;
}

/** Tuple PIH dans l'ordre décidé par le propriétaire. */
export function buildPihTuple(fields: InvoicePihFields): readonly PihTupleItem[] {
  return [
    INVOICE_PIH_TUPLE_VERSION,
    fields.emitterIce15,
    fields.sequentialNumber,
    normaliseNumber(fields.icvCounter),
    fields.ublTypeCode,
    fields.issueDate,
    fields.buyerIdentifier ?? null,
    fields.currencyCode,
    normaliseNumber(fields.totalHtCents),
    normaliseNumber(fields.totalVatCents),
    normaliseNumber(fields.stampDutyCents),
    normaliseNumber(fields.totalTtcCents),
    fields.previousPiHash,
  ];
}

/** Sérialisation canonique : JSON.stringify sans espace du tuple. */
export function serializePihTuple(fields: InvoicePihFields): string {
  return JSON.stringify(buildPihTuple(fields));
}

/** SHA-256 hexadécimal minuscule d'un texte UTF-8 (WebCrypto uniquement). */
export async function sha256HexUtf8(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Empreinte PIH d'une facture. */
export async function computeInvoicePih(fields: InvoicePihFields): Promise<string> {
  assertPihFields(fields);
  return sha256HexUtf8(serializePihTuple(fields));
}

/** Maillon de chaîne : champs de la facture et empreinte stockée (colonne `sha256_hash`). */
export interface ChainedInvoicePih extends InvoicePihFields {
  readonly piHash: string;
}

export type PihChainViolationCode =
  | 'FIELDS_INVALID'
  | 'HASH_MISMATCH'
  | 'PREVIOUS_HASH_MISMATCH'
  | 'ICV_NOT_MONOTONIC'
  | 'ICV_GAP';

export interface PihChainViolation {
  readonly index: number;
  readonly code: PihChainViolationCode;
}

export interface PihChainAnchor {
  readonly icvCounter: number;
  readonly piHash: string;
}

export interface PihChainReport {
  readonly valid: boolean;
  readonly violations: readonly PihChainViolation[];
}

/**
 * Rejoue une chaîne ordonnée. Sans ancre, la chaîne part de l'amorce (ICV 0 virtuel, premier ICV = 1) ;
 * `anchor` permet de vérifier un segment qui suit un maillon déjà vérifié.
 * Violations : champs invalides, empreinte stockée ≠ recalculée, hash précédent ≠ empreinte du maillon précédent,
 * ICV non strictement croissant (ICV_NOT_MONOTONIC) ou avec trou (ICV_GAP).
 */
export async function verifyPihChain(
  invoices: readonly ChainedInvoicePih[],
  anchor: PihChainAnchor = { icvCounter: 0, piHash: INVOICE_GENESIS_HASH },
): Promise<PihChainReport> {
  const violations: PihChainViolation[] = [];
  let expectedPrevious = anchor.piHash;
  let previousIcv = anchor.icvCounter;
  for (const [index, invoice] of invoices.entries()) {
    let recomputed: string | undefined;
    try {
      recomputed = await computeInvoicePih(invoice);
    } catch (error) {
      if (!(error instanceof UblGeneratorError)) throw error;
      violations.push({ index, code: 'FIELDS_INVALID' });
    }
    if (recomputed !== undefined && recomputed !== invoice.piHash) violations.push({ index, code: 'HASH_MISMATCH' });
    if (invoice.previousPiHash !== expectedPrevious) violations.push({ index, code: 'PREVIOUS_HASH_MISMATCH' });
    if (invoice.icvCounter <= previousIcv) violations.push({ index, code: 'ICV_NOT_MONOTONIC' });
    else if (invoice.icvCounter !== previousIcv + 1) violations.push({ index, code: 'ICV_GAP' });
    expectedPrevious = invoice.piHash;
    previousIcv = invoice.icvCounter;
  }
  return { valid: violations.length === 0, violations };
}
