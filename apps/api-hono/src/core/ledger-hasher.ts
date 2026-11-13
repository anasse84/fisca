/**
 * Empreintes du grand livre (H1 tranché par le propriétaire, 2026-11-13) : `defaultSha256LedgerHasher`.
 *
 * RÈGLE UNIQUE. Toute empreinte est le SHA-256, en 64 hexadécimaux minuscules, de l'encodage UTF-8 de `JSON.stringify([...])`
 * sans espace. Le séparateur `|` est abandonné : un libellé ou une référence contenant `|` ou `\n` ne peut pas fabriquer de
 * collision, JSON échappant les guillemets, barres obliques inverses et caractères de contrôle. Normalisation : `undefined`
 * devient `null`, `-0` devient `0`, seuls les entiers sûrs sont admis (centimes), les colonnes chiffrées `_enc` sont exclues.
 *
 * Genèse unique : "GENESIS_HASH_" + "0".repeat(32) (45 caractères, Doc_06). Elle n'est PAS un SHA-256 : elle amorce
 * `journals.last_entry_hash` et `journal_entries.previous_entry_hash`, colonnes sans CHECK 64 hexadécimaux (DDL v3).
 *
 * - entry_hash   (FISCA_GL_ENTRY_V1) : ["FISCA_GL_ENTRY_V1", fiscalYearId, journalCode, sequenceNumber, entryReference, entryDate,
 *   validatedAtIso, sourceDocumentType, invoiceId, dgiClearanceUuid, reversalOfEntryId, totalDebitCents, totalCreditCents,
 *   previousEntryHash, lignes] ; lignes triées par lineNumber croissant, chacune
 *   [lineNumber, accountNumber, auxiliaryAccount, debitCents, creditCents, isTaxDeductible, table3ReintegrationCode].
 * - closing_hash (FISCA_GL_CLOSE_V1) : ["FISCA_GL_CLOSE_V1", fiscalYearId, fiscalYearCode, startDate, endDate, closedAtIso,
 *   grandTotalDebitCents, grandTotalCreditCents, journaux] ; journaux triés par code ASCII croissant, chacun
 *   [journalCode, lastSequenceNumber, lastEntryHash] (journal vide : [code, 0, genèse]).
 *
 * POUR P2-A, NON IMPLÉMENTÉ ICI (vecteurs dans ledger-hasher.vectors.json, clé « pour_P2A_non_implemente », validés par test
 * avec la seule sérialisation canonique) :
 * - PIH facture : ["FISCA_INV_PIH_V1", emitterIce15, sequentialNumber, icvCounter, ublTypeCode, issueDate, buyerIdentifier,
 *   currencyCode, totalHtCents, totalVatCents, stampDutyCents, totalTtcCents, previousPiHash], numéro {FAC|AVO|NDB|ACO|AUT}-{YYYY}-{SEQ6}.
 * - ticket POS : ["FISCA_POS_TKT_V1", terminalId, terminalSeqNumber, issuedAtIso, ticketKind, ht20Cents, vat20Cents, ht10Cents,
 *   vat10Cents, ht0Cents, stampDutyCents, totalTtcCents, prevTicketSha256].
 * - clôture Z : ["FISCA_POS_Z_V1", terminalId, closureNumber, businessDate, netB2cHt20Cents, netB2cVat20Cents, netB2cHt10Cents,
 *   netB2cVat10Cents, netB2cHt0Cents, totalStampDutyCents, tpeGrossCents, prevZSha256].
 */
import type { ClosingHashInput, EntryHashInput, LedgerHasher } from './immutable-cgnc-ledger-engine.ts';

export const LEDGER_GENESIS_HASH = `GENESIS_HASH_${'0'.repeat(32)}`;
export const FISCA_GL_ENTRY_V1 = 'FISCA_GL_ENTRY_V1';
export const FISCA_GL_CLOSE_V1 = 'FISCA_GL_CLOSE_V1';

export type CanonicalValue = string | number | boolean | null | undefined | readonly CanonicalValue[];

function normalize(value: CanonicalValue): CanonicalValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`empreinte : entier sûr exigé (reçu ${String(value)}).`);
    }
    return value === 0 ? 0 : value;
  }
  if (Array.isArray(value)) return (value as readonly CanonicalValue[]).map(normalize);
  return value;
}

/** JSON.stringify du tuple normalisé : aucun espace, `undefined` → null, `-0` → 0, entiers sûrs seulement. */
export function canonicalJsonTuple(tuple: readonly CanonicalValue[]): string {
  return JSON.stringify(normalize(tuple));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Tri par unités de code UTF-16 (identique à l'ordre ASCII pour les codes de journaux), indépendant de la collation de la base. */
function byAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildEntryHashTuple(input: EntryHashInput): readonly CanonicalValue[] {
  const lines = [...input.lines]
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map((l): readonly CanonicalValue[] => [
      l.lineNumber,
      l.accountNumber,
      l.auxiliaryAccount ?? null,
      l.debitCents,
      l.creditCents,
      Boolean(l.isTaxDeductible),
      l.table3ReintegrationCode ?? null,
    ]);
  return [
    FISCA_GL_ENTRY_V1,
    input.fiscalYearId,
    input.journalCode,
    input.sequenceNumber,
    input.entryReference,
    input.entryDate,
    input.validatedAt,
    input.sourceDocumentType,
    input.invoiceId ?? null,
    input.dgiClearanceUuid ?? null,
    input.reversalOfEntryId ?? null,
    input.totalDebitCents,
    input.totalCreditCents,
    input.previousEntryHash,
    lines,
  ];
}

export function buildClosingHashTuple(input: ClosingHashInput): readonly CanonicalValue[] {
  const journals = [...input.journalHeads]
    .sort((a, b) => byAscii(a.journalCode, b.journalCode))
    .map((j): readonly CanonicalValue[] => [j.journalCode, j.chainLength, j.lastEntryHash]);
  return [
    FISCA_GL_CLOSE_V1,
    input.fiscalYearId,
    input.fiscalYearCode,
    input.startDate,
    input.endDate,
    input.closedAtIso,
    input.grandTotalDebitCents,
    input.grandTotalCreditCents,
    journals,
  ];
}

/** Hasher de production, valeur par défaut de `ImmutableCgncLedgerEngine`. */
export const defaultSha256LedgerHasher: LedgerHasher = {
  async computeEntryHash(input: EntryHashInput): Promise<string> {
    return sha256Hex(canonicalJsonTuple(buildEntryHashTuple(input)));
  },
  async computeClosingHash(input: ClosingHashInput): Promise<string> {
    return sha256Hex(canonicalJsonTuple(buildClosingHashTuple(input)));
  },
};
