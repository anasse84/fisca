import { describe, expect, it } from 'vitest';
import { LedgerError, mapDatabaseError } from './ledger-errors.ts';
import {
  assertBalancedLines,
  computeOpeningBalanceLines,
  computeVatClearingMovements,
  invertLines,
  totalsOfLines,
} from './ledger-calculations.ts';
import { LEDGER_TRIGGER_MESSAGES, TENANT_V4_TRIGGER_MESSAGES } from '@fisca/db-schema';

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof LedgerError) return error.code;
    throw error;
  }
  throw new Error('LedgerError attendue');
}

const PENDING_LINES = [
  { lineNumber: 2, accountNumber: '44558000', role: 'VAT_COLLECTED_PENDING', side: 'CREDIT', amountCents: 10000 },
  { lineNumber: 3, accountNumber: '44558000', role: 'VAT_COLLECTED_PENDING', side: 'CREDIT', amountCents: 2500 },
] as const;
const TARGETS = { VAT_COLLECTED_PENDING: '44551000', VAT_RECOVERABLE_PENDING: '34552000' };

describe('calculs du grand livre (entiers, BigInt, aucun flottant)', () => {
  it('totalsOfLines additionne en BigInt et assertBalancedLines refuse un écart d\'un centime', () => {
    expect(totalsOfLines([{ debitCents: 100, creditCents: 0 }, { debitCents: 0, creditCents: 100 }])).toEqual({ debit: 100n, credit: 100n });
    expect(codeOf(() => assertBalancedLines([{ debitCents: 100, creditCents: 0 }, { debitCents: 0, creditCents: 99 }]))).toBe('LEDGER_UNBALANCED');
    expect(codeOf(() => assertBalancedLines([]))).toBe('LEDGER_INVALID_LINE');
  });

  it('invertLines échange débit et crédit sans toucher aux numéros de ligne ni aux comptes', () => {
    const inverted = invertLines([
      { lineNumber: 1, accountNumber: '34210000', debitCents: 120000, creditCents: 0 },
      { lineNumber: 2, accountNumber: '71110000', debitCents: 0, creditCents: 100000 },
    ]);
    expect(inverted).toEqual([
      { lineNumber: 1, accountNumber: '34210000', debitCents: 0, creditCents: 120000 },
      { lineNumber: 2, accountNumber: '71110000', debitCents: 100000, creditCents: 0 },
    ]);
  });

  it('VAT_CLEARING : encaissement de 40 % d\'une facture multi-taux, ventilé au centime exact', () => {
    const movements = computeVatClearingMovements({
      pendingLines: PENDING_LINES,
      invoiceTtcCents: 87500,
      settledBeforeCents: 0,
      settledNowCents: 35000,
      targetByPendingRole: TARGETS,
    });
    expect(movements.map((m) => m.amountCents)).toEqual([4000, 1000]);
    expect(movements.every((m) => m.pendingSide === 'DEBIT' && m.targetAccountNumber === '44551000')).toBe(true);
  });

  it('VAT_CLEARING : arrondi demi-supérieur par ligne, puis le solde exact au dernier encaissement (aucune dérive)', () => {
    const first = computeVatClearingMovements({
      pendingLines: PENDING_LINES,
      invoiceTtcCents: 87500,
      settledBeforeCents: 0,
      settledNowCents: 33333,
      targetByPendingRole: TARGETS,
    });
    expect(first.map((m) => m.amountCents)).toEqual([3809, 952]);
    const last = computeVatClearingMovements({
      pendingLines: PENDING_LINES,
      invoiceTtcCents: 87500,
      settledBeforeCents: 33333,
      settledNowCents: 54167,
      targetByPendingRole: TARGETS,
    });
    expect(last.map((m) => m.amountCents)).toEqual([6191, 1548]);
    expect(first.concat(last).reduce((sum, m) => sum + m.amountCents, 0)).toBe(12500);
  });

  it('VAT_CLEARING d\'un achat : la TVA récupérable d\'attente se crédite, la cible se débite', () => {
    const movements = computeVatClearingMovements({
      pendingLines: [{ lineNumber: 2, accountNumber: '34558000', role: 'VAT_RECOVERABLE_PENDING', side: 'DEBIT', amountCents: 8000 }],
      invoiceTtcCents: 48000,
      settledBeforeCents: 0,
      settledNowCents: 48000,
      targetByPendingRole: TARGETS,
    });
    expect(movements).toEqual([
      { sourceLineNumber: 2, pendingAccountNumber: '34558000', targetAccountNumber: '34552000', pendingSide: 'CREDIT', amountCents: 8000 },
    ]);
  });

  it('VAT_CLEARING refuse un encaissement nul, négatif, ou qui dépasse le TTC', () => {
    const base = { pendingLines: PENDING_LINES, invoiceTtcCents: 87500, targetByPendingRole: TARGETS };
    expect(codeOf(() => computeVatClearingMovements({ ...base, settledBeforeCents: 0, settledNowCents: 0 }))).toBe('LEDGER_INVALID_AMOUNT');
    expect(codeOf(() => computeVatClearingMovements({ ...base, settledBeforeCents: -1, settledNowCents: 10 }))).toBe('LEDGER_INVALID_AMOUNT');
    expect(codeOf(() => computeVatClearingMovements({ ...base, settledBeforeCents: 80000, settledNowCents: 7501 }))).toBe(
      'LEDGER_VAT_CLEARING_EXCEEDS_INVOICE',
    );
    expect(codeOf(() => computeVatClearingMovements({ ...base, settledBeforeCents: 0, settledNowCents: 1 }))).toBe('LEDGER_NOTHING_TO_CLEAR');
  });

  it('journal d\'à-nouveaux : soldes de bilan des classes 1 à 5, trié par compte, équilibré', () => {
    const lines = computeOpeningBalanceLines([
      { accountNumber: '51610000', cgncClass: 5, netCents: 700000 },
      { accountNumber: '11110000', cgncClass: 1, netCents: -1000000 },
      { accountNumber: '23400000', cgncClass: 2, netCents: 300000 },
      { accountNumber: '61110000', cgncClass: 6, netCents: 0 },
      { accountNumber: '34210000', cgncClass: 3, netCents: 0 },
    ]);
    expect(lines).toEqual([
      { lineNumber: 1, accountNumber: '11110000', debitCents: 0, creditCents: 1000000 },
      { lineNumber: 2, accountNumber: '23400000', debitCents: 300000, creditCents: 0 },
      { lineNumber: 3, accountNumber: '51610000', debitCents: 700000, creditCents: 0 },
    ]);
  });

  it('journal d\'à-nouveaux : refuse si le résultat (classes 6 à 8) n\'est pas affecté, ou s\'il n\'y a rien à reprendre', () => {
    expect(
      codeOf(() =>
        computeOpeningBalanceLines([
          { accountNumber: '51610000', cgncClass: 5, netCents: 100 },
          { accountNumber: '71110000', cgncClass: 7, netCents: -100 },
        ]),
      ),
    ).toBe('LEDGER_RESULT_NOT_AFFECTED');
    expect(codeOf(() => computeOpeningBalanceLines([{ accountNumber: '51610000', cgncClass: 5, netCents: 0 }]))).toBe(
      'LEDGER_NOTHING_TO_CARRY_FORWARD',
    );
  });

  it('mapDatabaseError traduit les textes des triggers du socle en erreurs typées (dernière ligne de défense)', () => {
    const cases: readonly [string, string][] = [
      [LEDGER_TRIGGER_MESSAGES.unbalanced, 'LEDGER_UNBALANCED'],
      [LEDGER_TRIGGER_MESSAGES.negativeCash, 'LEDGER_NEGATIVE_CASH'],
      [LEDGER_TRIGGER_MESSAGES.missingHash, 'LEDGER_MISSING_HASH'],
      [LEDGER_TRIGGER_MESSAGES.entryUpdate, 'LEDGER_POSTED_IMMUTABLE'],
      [LEDGER_TRIGGER_MESSAGES.directPostedInsert, 'LEDGER_POSTED_IMMUTABLE'],
      [TENANT_V4_TRIGGER_MESSAGES.closedFiscalYearEntryInsert, 'LEDGER_FISCAL_YEAR_CLOSED'],
      [TENANT_V4_TRIGGER_MESSAGES.closedFiscalYearUpdate, 'LEDGER_FISCAL_YEAR_CLOSED'],
    ];
    for (const [message, code] of cases) {
      const mapped = mapDatabaseError(new Error(`INFRA_BATCH_ROLLED_BACK: ${message}`));
      expect(mapped.code).toBe(code);
      expect(mapped.origin).toBe('DATABASE_TRIGGER');
    }
    expect(mapDatabaseError(new Error('violates not-null constraint from_state')).code).toBe('LEDGER_CONCURRENCY_CONFLICT');
    expect(mapDatabaseError(new Error('boom')).code).toBe('LEDGER_STORAGE_FAILURE');
  });
});
