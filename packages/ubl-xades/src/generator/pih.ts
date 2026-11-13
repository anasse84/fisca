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
