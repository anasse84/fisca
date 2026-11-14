/**
 * Retenue à la source de TVA, art. 117 du CGI (VEC-CGI-03) : 75 % de la TVA si le fournisseur produit une attestation
 * de moins de 6 mois au jour du règlement, 100 % sinon. Taux, durée de validité et seuil d'exclusion : paramètres datés.
 *
 * Validité de l'attestation : date de règlement >= date d'émission ET < émission + 6 mois (calendaires). Le jour
 * anniversaire exact (« 6 mois pile ») n'est pas tranché par l'ERRATA : il est traité comme expiré, et signalé.
 */
import { addMonths, compareDates, parseIsoDate } from './civil-date.ts';
import { isNonNegativeSafeInteger, proportionHalfUp } from './amounts.ts';
import { CITED_ACCOUNTS, buildEntry } from './ledger.ts';
import type { LedgerEntry } from './ledger.ts';

export interface RasParams {
  readonly reducedBps: number;
  readonly fullBps: number;
  readonly attestationMonths: number;
  /** Les règlements de TTC inférieur ou égal à ce seuil ne subissent pas la retenue (Doc_07 S08 : « supérieure à 5 000 MAD TTC »). */
  readonly exclusionThresholdTtcCents: number;
}

export interface RasInput {
  readonly htCents: number;
  readonly vatRateBps: number;
  readonly paymentDate: string;
  /** Date d'émission de l'attestation de régularité fiscale ; null si le fournisseur n'en produit pas. */
  readonly attestationDate: string | null;
}

export type RasError = 'AMOUNT' | 'PAYMENT_DATE' | 'ATTESTATION_DATE' | 'ATTESTATION_AFTER_PAYMENT' | 'PARAMS';

export type RasAttestationState = 'NONE' | 'VALID' | 'EXPIRED';

export interface RasResult {
  readonly htCents: number;
  readonly vatCents: number;
  readonly ttcCents: number;
  readonly attestation: RasAttestationState;
  readonly aboveThreshold: boolean;
  readonly rateBps: number;
  readonly withheldCents: number;
  /** Net versé au fournisseur : TTC - retenue. */
  readonly netPaidCents: number;
  readonly entry: LedgerEntry;
}

export type RasOutcome = { readonly ok: true; readonly result: RasResult } | { readonly ok: false; readonly error: RasError };

export interface RasAccounts {
  /** Compte de règlement (banque ou caisse) : saisi par l'utilisateur, non cité par les spécifications sauf 5161. */
  readonly payment: string | null;
  /** Compte de la retenue due à l'État : saisi par l'utilisateur, non cité par les spécifications. */
  readonly withheldDue: string | null;
}

export function computeRasTva(input: RasInput, params: RasParams, accounts: RasAccounts = { payment: null, withheldDue: null }): RasOutcome {
  const numbers = [params.reducedBps, params.fullBps, params.attestationMonths, params.exclusionThresholdTtcCents];
  if (!numbers.every(isNonNegativeSafeInteger) || params.fullBps > 10000 || params.reducedBps > 10000) return { ok: false, error: 'PARAMS' };
  if (!isNonNegativeSafeInteger(input.htCents) || input.htCents === 0 || !isNonNegativeSafeInteger(input.vatRateBps)) return { ok: false, error: 'AMOUNT' };
  const payment = parseIsoDate(input.paymentDate);
  if (payment === null) return { ok: false, error: 'PAYMENT_DATE' };
  let attestation: RasAttestationState = 'NONE';
  if (input.attestationDate !== null) {
    const issued = parseIsoDate(input.attestationDate);
    if (issued === null) return { ok: false, error: 'ATTESTATION_DATE' };
    if (compareDates(issued, payment) > 0) return { ok: false, error: 'ATTESTATION_AFTER_PAYMENT' };
    attestation = compareDates(payment, addMonths(issued, params.attestationMonths)) < 0 ? 'VALID' : 'EXPIRED';
  }
  const vatCents = proportionHalfUp(input.htCents, input.vatRateBps);
  const ttcCents = input.htCents + vatCents;
  const aboveThreshold = ttcCents > params.exclusionThresholdTtcCents;
  const rateBps = attestation === 'VALID' ? params.reducedBps : params.fullBps;
  const withheldCents = aboveThreshold ? proportionHalfUp(vatCents, rateBps) : 0;
  const netPaidCents = ttcCents - withheldCents;
  const entry = buildEntry([
    { role: 'SUPPLIER', account: CITED_ACCOUNTS.SUPPLIER?.account ?? null, debitCents: ttcCents, creditCents: 0 },
    { role: 'PAYMENT', account: accounts.payment, debitCents: 0, creditCents: netPaidCents },
    { role: 'VAT_WITHHELD_DUE', account: accounts.withheldDue, debitCents: 0, creditCents: withheldCents },
  ]);
  return { ok: true, result: { htCents: input.htCents, vatCents, ttcCents, attestation, aboveThreshold, rateBps, withheldCents, netPaidCents, entry } };
}
