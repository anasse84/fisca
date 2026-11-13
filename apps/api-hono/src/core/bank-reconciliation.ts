/**
 * Lettrage bancaire (POST /api/v1/banking/reconcile, CTR-API-12 ; Doc_02 § 05, Doc_09 § AIDE_COMPTABLE, Doc_13 règle (b)).
 *
 * Règles (aucune n'est fiscale, aucun seuil n'est codé) :
 * - une seule facture candidate au montant exact du mouvement : brouillon VAT_CLEARING par le moteur, puis la ligne bancaire passe
 *   à MATCHED_FULL ;
 * - une seule facture désignée et un règlement inférieur au solde : brouillon VAT_CLEARING pour ce montant, MATCHED_PARTIAL ;
 * - deux candidates ou plus au montant exact : lettrage automatique INTERDIT, la ligne passe en SUSPENS_AMBIGU_3497_4497
 *   (aucune écriture) ;
 * - sinon NO_MATCH, rien n'est écrit.
 * Solde restant d'une candidate = total TTC de la pièce (`total_debit_cents`) moins `settledBeforeCents` fourni par l'appelant,
 * comme pour `createVatClearingDraft`. Sens du mouvement : `amount_cents` positif (encaissement) ou négatif (décaissement),
 * on règle sa valeur absolue.
 */
import type { SqlParam, TenantSqlDriver } from '@fisca/shared-types';
import { LedgerError, mapDatabaseError } from './ledger-errors.ts';
import type { CreateVatClearingDraftInput, ImmutableCgncLedgerEngine, LedgerActor } from './immutable-cgnc-ledger-engine.ts';
import { ProblemError } from './problem-details.ts';
import type { ReconcileRequest, ReconcileResponse } from './api-v1-schemas.ts';

export const BANK_TRANSACTION_NOT_FOUND_PROBLEM = {
  status: 404,
  errorCode: 'BANK_TRANSACTION_NOT_FOUND',
  title: 'Ligne bancaire introuvable',
  detail: 'La ligne bancaire demandée est introuvable.',
} as const;

export const BANK_TRANSACTION_ALREADY_RECONCILED_PROBLEM = {
  status: 409,
  errorCode: 'BANK_TRANSACTION_ALREADY_RECONCILED',
  title: 'Ligne bancaire déjà traitée',
  detail: "Cette ligne bancaire n'est plus à l'état non lettré.",
} as const;

export interface BankReconciliationDeps {
  readonly db: TenantSqlDriver;
  readonly engine: ImmutableCgncLedgerEngine;
  /** Droit de préparer un brouillon de lettrage (LEDGER_SAVE_DRAFT) ; lève LEDGER_ACCESS_DENIED sinon. */
  readonly authorize: () => void;
  /** UUIDv7 neuf : suffixe du code de lettrage. */
  readonly newId: () => string;
}

interface BankRow {
  readonly id: string;
  readonly amount_cents: number | string;
  readonly reconciliation_state: string;
}

interface EntryRow {
  readonly id: string;
  readonly total_debit_cents: number | string;
}

interface Candidate {
  readonly invoiceEntryId: string;
  readonly settledBeforeCents: number;
  readonly openCents: number;
}

const UPDATE_BANK = `UPDATE bank_transactions SET reconciliation_state = ?, reconciliation_code = ?
  WHERE id = ? AND reconciliation_state = 'UNMATCHED'`;

async function read<TRow>(db: TenantSqlDriver, sql: string, params: readonly SqlParam[]): Promise<readonly TRow[]> {
  try {
    return await db.query<TRow>({ sql, params });
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

async function markBank(db: TenantSqlDriver, state: string, code: string, bankTransactionId: string): Promise<void> {
  let changes: number;
  try {
    changes = (await db.executeBatchAtomically([{ sql: UPDATE_BANK, params: [state, code, bankTransactionId] }])).totalChanges;
  } catch (error) {
    throw mapDatabaseError(error);
  }
  if (changes !== 1) {
    throw new ProblemError(BANK_TRANSACTION_ALREADY_RECONCILED_PROBLEM);
  }
}

export async function reconcileBankTransaction(
  deps: BankReconciliationDeps,
  actor: LedgerActor,
  request: ReconcileRequest,
): Promise<ReconcileResponse> {
  deps.authorize();
  const bankRows = await read<BankRow>(deps.db, 'SELECT id, amount_cents, reconciliation_state FROM bank_transactions WHERE id = ?', [request.bankTransactionId]);
  const bank = bankRows[0];
  if (bank === undefined) {
    throw new ProblemError(BANK_TRANSACTION_NOT_FOUND_PROBLEM);
  }
  if (bank.reconciliation_state !== 'UNMATCHED') {
    throw new ProblemError(BANK_TRANSACTION_ALREADY_RECONCILED_PROBLEM);
  }
  const movementCents = Math.abs(Number(bank.amount_cents));

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const candidate of request.candidates) {
    if (seen.has(candidate.invoiceEntryId)) {
      continue;
    }
    seen.add(candidate.invoiceEntryId);
    const rows = await read<EntryRow>(deps.db, 'SELECT id, total_debit_cents FROM journal_entries WHERE id = ?', [candidate.invoiceEntryId]);
    const entry = rows[0];
    if (entry === undefined) {
      throw new LedgerError('LEDGER_UNKNOWN_ENTRY', `la pièce ${candidate.invoiceEntryId} est introuvable.`);
    }
    const openCents = Number(entry.total_debit_cents) - candidate.settledBeforeCents;
    if (openCents > 0) {
      candidates.push({ invoiceEntryId: candidate.invoiceEntryId, settledBeforeCents: candidate.settledBeforeCents, openCents });
    }
  }

  const code = `LTR-${deps.newId()}`;
  const exact = candidates.filter((candidate) => candidate.openCents === movementCents);
  if (movementCents > 0 && exact.length >= 2) {
    await markBank(deps.db, 'SUSPENS_AMBIGU_3497_4497', code, bank.id);
    return { outcome: 'SUSPENS_AMBIGU_3497_4497', bankTransactionId: bank.id, reconciliationCode: code, candidateCount: exact.length };
  }
  const only = candidates.length === 1 ? candidates[0] : undefined;
  const target = exact[0] ?? (only !== undefined && movementCents > 0 && movementCents < only.openCents ? only : undefined);
  if (target === undefined || movementCents === 0) {
    return { outcome: 'NO_MATCH', bankTransactionId: bank.id };
  }

  const clearingInput: CreateVatClearingDraftInput = {
    invoiceEntryId: target.invoiceEntryId,
    journalId: request.journalId,
    fiscalYearId: request.fiscalYearId,
    entryDate: request.entryDate,
    settledBeforeCents: target.settledBeforeCents,
    settledNowCents: movementCents,
    paymentMethodCode: request.paymentMethodCode,
    ...(request.lcnBankCollectionDate === undefined ? {} : { lcnBankCollectionDate: request.lcnBankCollectionDate }),
    ...(request.recoverableTarget === undefined ? {} : { recoverableTarget: request.recoverableTarget }),
  };
  const clearing = await deps.engine.createVatClearingDraft(actor, clearingInput);
  const full = movementCents === target.openCents;
  await markBank(deps.db, full ? 'MATCHED_FULL' : 'MATCHED_PARTIAL', code, bank.id);
  return {
    outcome: full ? 'MATCHED_FULL' : 'MATCHED_PARTIAL',
    bankTransactionId: bank.id,
    reconciliationCode: code,
    invoiceEntryId: target.invoiceEntryId,
    clearingEntryId: clearing.entryId,
    clearedCents: clearing.clearedCents,
  };
}
