/**
 * Plafond de règlement en espèces, art. 11-II du CGI (VEC-CGI-01 ; D-20 pour le cumul mensuel).
 * Plafonds par fournisseur, par jour et par mois : paramètres datés (`cash_cap_day_cents`, `cash_cap_month_cents`).
 * Base du plafond : TTC par défaut ; HT sur option (`cap_basis`, ERRATA E : le texte ne tranche pas, la base est un paramètre).
 * Part dépassant le plafond : TVA non récupérable et charge réintégrée (Tableau 3 de l'IS) ; la part dans le plafond reste admise.
 */
import { parseIsoDate } from './civil-date.ts';
import { htFromTtc, isNonNegativeSafeInteger, proportionHalfUp } from './amounts.ts';
import { CITED_ACCOUNTS, buildEntry } from './ledger.ts';
import type { LedgerEntry } from './ledger.ts';
import type { CapBasis } from './rule-params.ts';

export interface CashPayment {
  readonly date: string;
  readonly supplier: string;
  readonly amountTtcCents: number;
}

export interface CashParams {
  readonly capDayCents: number;
  readonly capMonthCents: number;
  readonly vatRateBps: number;
  readonly capBasis: CapBasis;
}

export type CashBinding = 'DAY' | 'MONTH' | null;

export interface CashLine {
  /** Position du règlement dans la saisie (0 = première ligne). */
  readonly inputIndex: number;
  readonly date: string;
  readonly supplier: string;
  readonly ttcCents: number;
  readonly htCents: number;
  readonly vatCents: number;
  /** TTC couvert par les plafonds. */
  readonly allowedTtcCents: number;
  /** TTC au-delà des plafonds, à scinder. */
  readonly excessTtcCents: number;
  readonly deductibleHtCents: number;
  readonly deductibleVatCents: number;
  /** HT réintégré au Tableau 3 de l'IS. */
  readonly reintegratedHtCents: number;
  /** TVA non récupérable. */
  readonly lostVatCents: number;
  readonly binding: CashBinding;
  /** Cumul de la journée et du mois pour ce fournisseur, après ce règlement, dans la base du plafond. */
  readonly dayCumulCents: number;
  readonly monthCumulCents: number;
}

export interface CashTotals {
  readonly ttcCents: number;
  readonly excessTtcCents: number;
  readonly reintegratedHtCents: number;
  readonly lostVatCents: number;
  readonly deductibleHtCents: number;
  readonly deductibleVatCents: number;
}

export type CashError = 'EMPTY' | 'DATE' | 'AMOUNT' | 'PARAMS';

export type CashOutcome =
  | { readonly ok: true; readonly lines: readonly CashLine[]; readonly totals: CashTotals; readonly entry: LedgerEntry }
  | { readonly ok: false; readonly error: CashError; readonly inputIndex?: number };

function minOf(...values: readonly number[]): number {
  return values.reduce((a, b) => (b < a ? b : a));
}

export function evaluateCashPayments(payments: readonly CashPayment[], params: CashParams, expenseAccount: string | null = null): CashOutcome {
  if (payments.length === 0) return { ok: false, error: 'EMPTY' };
  if (!isNonNegativeSafeInteger(params.capDayCents) || !isNonNegativeSafeInteger(params.capMonthCents) || !isNonNegativeSafeInteger(params.vatRateBps)) {
    return { ok: false, error: 'PARAMS' };
  }
  const indexed = payments.map((p, inputIndex) => ({ p, inputIndex, date: parseIsoDate(p.date) }));
  for (const item of indexed) {
    if (item.date === null) return { ok: false, error: 'DATE', inputIndex: item.inputIndex };
    if (!isNonNegativeSafeInteger(item.p.amountTtcCents) || item.p.amountTtcCents === 0) return { ok: false, error: 'AMOUNT', inputIndex: item.inputIndex };
  }
  const ordered = [...indexed].sort((a, b) => (a.p.date < b.p.date ? -1 : a.p.date > b.p.date ? 1 : a.inputIndex - b.inputIndex));
  const dayUsed = new Map<string, number>();
  const monthUsed = new Map<string, number>();
  const lines: CashLine[] = [];
  for (const { p, inputIndex } of ordered) {
    const supplierKey = p.supplier.trim().toLowerCase();
    const dayKey = `${supplierKey}|${p.date}`;
    const monthKey = `${supplierKey}|${p.date.slice(0, 7)}`;
    const ttc = p.amountTtcCents;
    const ht = htFromTtc(ttc, params.vatRateBps);
    const vat = ttc - ht;
    const base = params.capBasis === 'TTC' ? ttc : ht;
    const dayRemaining = Math.max(0, params.capDayCents - (dayUsed.get(dayKey) ?? 0));
    const monthRemaining = Math.max(0, params.capMonthCents - (monthUsed.get(monthKey) ?? 0));
    const allowedBase = minOf(base, dayRemaining, monthRemaining);
    const binding: CashBinding = allowedBase === base ? null : allowedBase === dayRemaining && dayRemaining <= monthRemaining ? 'DAY' : 'MONTH';
    let deductibleHt: number;
    let deductibleVat: number;
    if (params.capBasis === 'TTC') {
      deductibleHt = allowedBase === ttc ? ht : htFromTtc(allowedBase, params.vatRateBps);
      deductibleVat = allowedBase - deductibleHt;
    } else {
      deductibleHt = allowedBase;
      deductibleVat = allowedBase === ht ? vat : proportionHalfUp(allowedBase, params.vatRateBps);
    }
    const allowedTtc = deductibleHt + deductibleVat;
    dayUsed.set(dayKey, (dayUsed.get(dayKey) ?? 0) + allowedBase);
    monthUsed.set(monthKey, (monthUsed.get(monthKey) ?? 0) + allowedBase);
    lines.push({
      inputIndex,
      date: p.date,
      supplier: p.supplier.trim(),
      ttcCents: ttc,
      htCents: ht,
      vatCents: vat,
      allowedTtcCents: allowedTtc,
      excessTtcCents: ttc - allowedTtc,
      deductibleHtCents: deductibleHt,
      deductibleVatCents: deductibleVat,
      reintegratedHtCents: ht - deductibleHt,
      lostVatCents: vat - deductibleVat,
      binding,
      dayCumulCents: dayUsed.get(dayKey) ?? 0,
      monthCumulCents: monthUsed.get(monthKey) ?? 0,
    });
  }
  const sum = (pick: (l: CashLine) => number): number => lines.reduce((acc, l) => acc + pick(l), 0);
  const totals: CashTotals = {
    ttcCents: sum((l) => l.ttcCents),
    excessTtcCents: sum((l) => l.excessTtcCents),
    reintegratedHtCents: sum((l) => l.reintegratedHtCents),
    lostVatCents: sum((l) => l.lostVatCents),
    deductibleHtCents: sum((l) => l.deductibleHtCents),
    deductibleVatCents: sum((l) => l.deductibleVatCents),
  };
  const cashAccount = CITED_ACCOUNTS.CASH?.account ?? null;
  const vatAccount = CITED_ACCOUNTS.VAT_RECOVERABLE?.account ?? null;
  const entry = buildEntry([
    { role: 'EXPENSE_DEDUCTIBLE', account: expenseAccount, debitCents: totals.deductibleHtCents, creditCents: 0 },
    { role: 'EXPENSE_NON_DEDUCTIBLE', account: expenseAccount, debitCents: totals.reintegratedHtCents, creditCents: 0 },
    { role: 'VAT_RECOVERABLE', account: vatAccount, debitCents: totals.deductibleVatCents, creditCents: 0 },
    { role: 'VAT_NON_RECOVERABLE', account: expenseAccount, debitCents: totals.lostVatCents, creditCents: 0 },
    { role: 'CASH', account: cashAccount, debitCents: 0, creditCents: totals.ttcCents },
  ]);
  return { ok: true, lines: [...lines].sort((a, b) => a.inputIndex - b.inputIndex), totals, entry };
}
