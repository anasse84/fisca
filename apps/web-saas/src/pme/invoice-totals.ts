import { divRoundHalfUpBigInt, ensureSafeInteger } from '@fisca/shared-types';

export interface InvoiceLineInput {
  /** Quantité en milli-unités (2,5 unités = 2500). */
  readonly quantityMilli: number;
  readonly unitPriceCents: number;
  /** Taux en points de base, choisi dans la liste fournie par le port. */
  readonly vatRateBps: number;
}

export interface InvoiceLineTotal extends InvoiceLineInput {
  readonly lineHtCents: number;
}

export interface VatBreakdownRow {
  readonly rateBps: number;
  readonly baseHtCents: number;
  readonly vatCents: number;
}

export interface InvoiceTotals {
  readonly lines: readonly InvoiceLineTotal[];
  readonly vatByRate: readonly VatBreakdownRow[];
  readonly totalHtCents: number;
  readonly totalVatCents: number;
  readonly totalTtcCents: number;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function toSafeNumber(value: bigint, label: string): number {
  if (value > MAX_SAFE || value < -MAX_SAFE) {
    throw new Error(`UI_AMOUNT_OVERFLOW: ${label} dépasse la plage d'entiers sûrs.`);
  }
  return Number(value);
}

/**
 * Totaux d'une facture, en BigInt et par `divRoundHalfUpBigInt` (ERRATA D-09) :
 * HT de ligne = quantité (milli) × prix (centimes) / 1000 ; TVA = base HT du taux × bps / 10000, arrondie une fois par taux.
 * Les taux viennent des lignes (donc du port) ; aucun taux n'est défini ici.
 */
export function computeInvoiceTotals(inputs: readonly InvoiceLineInput[]): InvoiceTotals {
  const lines: InvoiceLineTotal[] = [];
  const baseByRate = new Map<number, bigint>();
  let totalHt = 0n;
  for (const input of inputs) {
    const quantity = ensureSafeInteger(input.quantityMilli, 'quantityMilli');
    const price = ensureSafeInteger(input.unitPriceCents, 'unitPriceCents');
    const rate = ensureSafeInteger(input.vatRateBps, 'vatRateBps');
    const lineHt = divRoundHalfUpBigInt(BigInt(quantity) * BigInt(price), 1000n);
    lines.push({ quantityMilli: quantity, unitPriceCents: price, vatRateBps: rate, lineHtCents: toSafeNumber(lineHt, 'lineHtCents') });
    baseByRate.set(rate, (baseByRate.get(rate) ?? 0n) + lineHt);
    totalHt += lineHt;
  }
  const vatByRate: VatBreakdownRow[] = [];
  let totalVat = 0n;
  for (const rate of [...baseByRate.keys()].sort((a, b) => a - b)) {
    const base = baseByRate.get(rate) ?? 0n;
    const vat = divRoundHalfUpBigInt(base * BigInt(rate), 10000n);
    vatByRate.push({ rateBps: rate, baseHtCents: toSafeNumber(base, 'baseHtCents'), vatCents: toSafeNumber(vat, 'vatCents') });
    totalVat += vat;
  }
  return {
    lines,
    vatByRate,
    totalHtCents: toSafeNumber(totalHt, 'totalHtCents'),
    totalVatCents: toSafeNumber(totalVat, 'totalVatCents'),
    totalTtcCents: toSafeNumber(totalHt + totalVat, 'totalTtcCents'),
  };
}
