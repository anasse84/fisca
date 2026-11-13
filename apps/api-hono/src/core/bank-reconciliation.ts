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
 *
 * TRANSACTION ATOMIQUE UNIQUE. Le brouillon VAT_CLEARING (pièce et lignes, construits par
 * `ImmutableCgncLedgerEngine.buildVatClearingDraftStatements`, sans exécution) ET la mise à jour de la ligne bancaire (état
 * MATCHED_FULL / MATCHED_PARTIAL, code de lettrage, lien `gl_entry_id`, trace d'audit) s'écrivent dans le MÊME lot
 * `executeBatchAtomically` : en cas d'échec, aucun brouillon orphelin. Le code de lettrage reste DÉTERMINISTE (SHA-256 de la ligne
 * bancaire, de la facture, du solde antérieur et du montant) et posé sur les lignes du brouillon.
 * Concurrence : l'UPDATE porte `WHERE reconciliation_state = 'UNMATCHED'` et l'audit, placé en DERNIER, a `from_state` NULL si la
 * ligne n'est pas liée à CE brouillon (ou si la transition est déjà tracée) : le lot entier est annulé, aucun brouillon n'est créé.
 * De deux demandes strictement simultanées, une seule gagne ; l'autre reçoit 409 BANK_TRANSACTION_ALREADY_RECONCILED.
 * Rejeu SÉQUENTIEL après succès (même demande ou non) : la ligne n'est plus UNMATCHED, 409 BANK_TRANSACTION_ALREADY_RECONCILED
 * (contrat HTTP existant, testé) ; le brouillon déjà en place reste seul et lié à la ligne, sans doublon. Brouillon orphelin hérité de l'ancien traitement en deux
 * lots (code présent, ligne encore UNMATCHED) : réutilisé, seule la ligne bancaire est marquée.
 */
import { sha256Hex, type SqlParam, type SqlStatementParams, type TenantSqlDriver } from '@fisca/shared-types';
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
}

interface BankRow {
  readonly id: string;
  readonly amount_cents: number | string;
  readonly reconciliation_state: string;
  readonly reconciliation_code: string | null;
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

interface ClearingRow {
  readonly id: string;
  readonly total_debit_cents: number | string;
}

/** Code de lettrage déterministe : même ligne bancaire, mêmes factures et montants, même code (clé de reprise). */
export async function reconciliationCodeFor(parts: readonly (string | number)[]): Promise<string> {
  const digest = await sha256Hex(new TextEncoder().encode(parts.join('|')));
  return `LTR-${digest.slice(0, 32)}`;
}

const UPDATE_BANK = `UPDATE bank_transactions SET reconciliation_state = ?, reconciliation_code = ?
  WHERE id = ? AND reconciliation_state = 'UNMATCHED'`;

const UPDATE_BANK_LINKED = `UPDATE bank_transactions SET reconciliation_state = ?, reconciliation_code = ?, gl_entry_id = ?
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

/** Brouillon VAT_CLEARING déjà créé pour ce code de lettrage (reprise après panne entre les deux lots), sinon `null`. */
async function findClearingByCode(db: TenantSqlDriver, code: string): Promise<{ readonly entryId: string; readonly clearedCents: number } | null> {
  const rows = await read<ClearingRow>(
    db,
    `SELECT je.id AS id, je.total_debit_cents AS total_debit_cents FROM journal_entries je
      WHERE je.source_document_type = 'VAT_CLEARING'
        AND EXISTS (SELECT 1 FROM journal_entry_lines jel WHERE jel.entry_id = je.id AND jel.reconciliation_code = ?)
      LIMIT 1`,
    [code],
  );
  const row = rows[0];
  return row === undefined ? null : { entryId: row.id, clearedCents: Number(row.total_debit_cents) };
}

export async function reconcileBankTransaction(
  deps: BankReconciliationDeps,
  actor: LedgerActor,
  request: ReconcileRequest,
): Promise<ReconcileResponse> {
  deps.authorize();
  const bankRows = await read<BankRow>(deps.db, 'SELECT id, amount_cents, reconciliation_state, reconciliation_code FROM bank_transactions WHERE id = ?', [request.bankTransactionId]);
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

  const exact = candidates.filter((candidate) => candidate.openCents === movementCents);
  if (movementCents > 0 && exact.length >= 2) {
    const code = await reconciliationCodeFor([bank.id, 'SUSPENS', ...exact.map((candidate) => candidate.invoiceEntryId).sort()]);
    await markBank(deps.db, 'SUSPENS_AMBIGU_3497_4497', code, bank.id);
    return { outcome: 'SUSPENS_AMBIGU_3497_4497', bankTransactionId: bank.id, reconciliationCode: code, candidateCount: exact.length };
  }
  const only = candidates.length === 1 ? candidates[0] : undefined;
  const target = exact[0] ?? (only !== undefined && movementCents > 0 && movementCents < only.openCents ? only : undefined);
  if (target === undefined || movementCents === 0) {
    return { outcome: 'NO_MATCH', bankTransactionId: bank.id };
  }

  const code = await reconciliationCodeFor([bank.id, target.invoiceEntryId, target.settledBeforeCents, movementCents]);
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
    reconciliationCode: code,
  };
  const finalState = movementCents === target.openCents ? 'MATCHED_FULL' : 'MATCHED_PARTIAL';
  const existing = await findClearingByCode(deps.db, code);
  const respond = (clearing: { readonly entryId: string; readonly clearedCents: number }): ReconcileResponse => ({
    outcome: finalState,
    bankTransactionId: bank.id,
    reconciliationCode: code,
    invoiceEntryId: target.invoiceEntryId,
    clearingEntryId: clearing.entryId,
    clearedCents: clearing.clearedCents,
  });
  if (existing !== null) {
    await markBank(deps.db, finalState, code, bank.id);
    return respond(existing);
  }

  const draft = await deps.engine.buildVatClearingDraftStatements(actor, clearingInput);
  const statements: SqlStatementParams[] = [
    ...draft.statements,
    { sql: UPDATE_BANK_LINKED, params: [finalState, code, draft.entryId, bank.id] },
    deps.engine.buildGuardedAuditStatement(actor, {
      entityTable: 'bank_transactions',
      entityId: bank.id,
      fromState: 'UNMATCHED',
      toState: finalState,
      idempotencyKey: `bank-reconcile:${code}`,
      proofRef: draft.entryId,
      guardSql: `EXISTS (SELECT 1 FROM bank_transactions WHERE id = ? AND reconciliation_state = ? AND reconciliation_code = ? AND gl_entry_id = ?)`,
      guardParams: [bank.id, finalState, code, draft.entryId],
    }),
  ];
  try {
    await deps.db.executeBatchAtomically(statements);
  } catch (error) {
    const mapped = mapDatabaseError(error);
    if (mapped instanceof LedgerError && mapped.code === 'LEDGER_CONCURRENCY_CONFLICT') {
      const after = (await read<BankRow>(deps.db, 'SELECT id, amount_cents, reconciliation_state, reconciliation_code FROM bank_transactions WHERE id = ?', [bank.id]))[0];
      if (after !== undefined && after.reconciliation_state !== 'UNMATCHED') {
        throw new ProblemError(BANK_TRANSACTION_ALREADY_RECONCILED_PROBLEM);
      }
    }
    throw mapped;
  }
  return respond({ entryId: draft.entryId, clearedCents: draft.clearedCents });
}
