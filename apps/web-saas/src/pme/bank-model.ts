/**
 * Logique pure du rapprochement bancaire (Doc_02 Section 05) : classification d'une suggestion et corps exact de CTR-API-12.
 * Aucun montant n'est calculé : les centimes viennent du port et ne sont que vérifiés entiers.
 */
import type { ReconcileRequest, ReconcileResponse, UblPaymentCode } from './pme-api.ts';
import type { BankContext, BankEntryCandidate, BankStatementLine, ReconcileSuggestion } from './ports-ops.ts';

/** Contrainte du schéma de CTR-API-12 : 1 à 20 candidates. */
const MIN_CANDIDATES = 1;
const MAX_CANDIDATES = 20;

export type SuggestionKind = 'unique' | 'ambiguous' | 'none';

/** 0 candidate → aucune ; 1 → unique ; 2 ou plus → ambiguë (lettrage automatique interdit, suspens 3497/4497 imposé). */
export function classifySuggestion(suggestion: ReconcileSuggestion): SuggestionKind {
  const distinct = new Set(suggestion.candidateEntryIds).size;
  if (distinct === 0) return 'none';
  return distinct === 1 ? 'unique' : 'ambiguous';
}

export type BuildFailure = 'paymentMethod' | 'candidates' | 'amount';
export type BuildResult = { readonly ok: true; readonly body: ReconcileRequest } | { readonly ok: false; readonly reason: BuildFailure };

export interface BuildChoices {
  readonly paymentMethodCode?: UblPaymentCode;
}

/** Corps de CTR-API-12 depuis le contexte hôte, la ligne bancaire et les candidates ; refus local si le schéma serveur serait violé. */
export function buildReconcileRequest(
  context: BankContext,
  line: BankStatementLine,
  candidates: readonly BankEntryCandidate[],
  choices: BuildChoices = {},
): BuildResult {
  const method = choices.paymentMethodCode ?? line.paymentMethodCode;
  if (method === undefined || !context.paymentMethods.includes(method)) return { ok: false, reason: 'paymentMethod' };
  const distinct: BankEntryCandidate[] = [];
  for (const candidate of candidates) {
    if (!distinct.some((d) => d.invoiceEntryId === candidate.invoiceEntryId)) distinct.push(candidate);
  }
  if (distinct.length < MIN_CANDIDATES || distinct.length > MAX_CANDIDATES) return { ok: false, reason: 'candidates' };
  if (distinct.some((c) => !Number.isSafeInteger(c.settledBeforeCents) || c.settledBeforeCents < 0)) return { ok: false, reason: 'amount' };
  return {
    ok: true,
    body: {
      bankTransactionId: line.id,
      journalId: context.journalId,
      fiscalYearId: context.fiscalYearId,
      entryDate: line.valueDate,
      paymentMethodCode: method,
      ...(line.lcnBankCollectionDate === undefined ? {} : { lcnBankCollectionDate: line.lcnBankCollectionDate }),
      ...(line.recoverableTarget === undefined ? {} : { recoverableTarget: line.recoverableTarget }),
      candidates: distinct.map((c) => ({ invoiceEntryId: c.invoiceEntryId, settledBeforeCents: c.settledBeforeCents })),
    },
  };
}

export type OutcomeKind = 'matched' | 'partial' | 'suspense' | 'noMatch';

export function outcomeKind(outcome: ReconcileResponse['outcome']): OutcomeKind {
  switch (outcome) {
    case 'MATCHED_FULL':
      return 'matched';
    case 'MATCHED_PARTIAL':
      return 'partial';
    case 'SUSPENS_AMBIGU_3497_4497':
      return 'suspense';
    case 'NO_MATCH':
      return 'noMatch';
  }
}
