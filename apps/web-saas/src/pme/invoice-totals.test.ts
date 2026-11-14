import { describe, expect, it } from 'vitest';
import { computeInvoiceTotals } from './invoice-totals.ts';

describe('computeInvoiceTotals : divRoundHalfUpBigInt, entiers seulement', () => {
  it('ligne : quantité en milli-unités × prix en centimes, arrondi demi supérieur', () => {
    // 2,5 × 100,00 = 250,00
    expect(computeInvoiceTotals([{ quantityMilli: 2500, unitPriceCents: 10000, vatRateBps: 2000 }]).lines[0]?.lineHtCents).toBe(25000);
    // 0,001 × 5,00 MAD = 0,005 MAD = 0,5 centime → 1 centime (demi supérieur)
    expect(computeInvoiceTotals([{ quantityMilli: 1, unitPriceCents: 500, vatRateBps: 0 }]).lines[0]?.lineHtCents).toBe(1);
    // 0,001 × 4,99 MAD = 0,499 centime → 0
    expect(computeInvoiceTotals([{ quantityMilli: 1, unitPriceCents: 499, vatRateBps: 0 }]).lines[0]?.lineHtCents).toBe(0);
  });

  it('ventile base HT et TVA par taux du port, TVA arrondie une fois par taux', () => {
    const t = computeInvoiceTotals([
      { quantityMilli: 1000, unitPriceCents: 10000, vatRateBps: 2000 },
      { quantityMilli: 3000, unitPriceCents: 3333, vatRateBps: 2000 },
      { quantityMilli: 1000, unitPriceCents: 5000, vatRateBps: 1000 },
      { quantityMilli: 2000, unitPriceCents: 1000, vatRateBps: 0 },
    ]);
    expect(t.vatByRate).toEqual([
      { rateBps: 0, baseHtCents: 2000, vatCents: 0 },
      { rateBps: 1000, baseHtCents: 5000, vatCents: 500 },
      // base 10000 + 9999 = 19999 ; 19999 × 2000 / 10000 = 3999,8 → 4000
      { rateBps: 2000, baseHtCents: 19999, vatCents: 4000 },
    ]);
    expect(t.totalHtCents).toBe(26999);
    expect(t.totalVatCents).toBe(4500);
    expect(t.totalTtcCents).toBe(31499);
  });

  it('demi exact → arrondi vers le haut (3725 × 10 % = 372,5 → 373)', () => {
    const t = computeInvoiceTotals([{ quantityMilli: 1000, unitPriceCents: 3725, vatRateBps: 1000 }]);
    expect(t.totalVatCents).toBe(373);
    expect(t.totalTtcCents).toBe(4098);
  });

  it('liste vide : totaux nuls', () => {
    const t = computeInvoiceTotals([]);
    expect(t).toEqual({ lines: [], vatByRate: [], totalHtCents: 0, totalVatCents: 0, totalTtcCents: 0 });
  });

  it('refuse un flottant ou un entier hors plage sûre', () => {
    expect(() => computeInvoiceTotals([{ quantityMilli: Number('1.5'), unitPriceCents: 100, vatRateBps: 0 }])).toThrow();
    expect(() => computeInvoiceTotals([{ quantityMilli: 1000, unitPriceCents: Number('100.5'), vatRateBps: 0 }])).toThrow();
    expect(() => computeInvoiceTotals([{ quantityMilli: 1000, unitPriceCents: 100, vatRateBps: Number('20.5') }])).toThrow();
  });

  it('grandes sommes exactes (BigInt interne)', () => {
    const t = computeInvoiceTotals([{ quantityMilli: 1000000, unitPriceCents: 9007199254, vatRateBps: 2000 }]);
    expect(t.totalHtCents).toBe(9007199254000);
    expect(t.totalVatCents).toBe(1801439850800);
  });
});
