import { describe, expect, it } from 'vitest';
import { PRICING_PLANS, PRICING_CURRENCY, getPricingPlan } from '../src/content/pricing.ts';
import { centsToDecimalString, formatCentsMad } from '../src/lib/money.ts';

describe('pricing.ts', () => {
  it('expose les 4 offres de Doc_03 S02/S06 dans l’ordre', () => {
    expect(PRICING_PLANS.map((p) => p.code)).toEqual([
      'SOLO_AE',
      'ESSENTIEL_TPE',
      'CROISSANCE_PME',
      'PACK_MOWAKABA_TPME',
    ]);
    expect(PRICING_CURRENCY).toBe('MAD');
  });

  it('tous les montants sont des entiers de centimes', () => {
    for (const plan of PRICING_PLANS) {
      const amounts = plan.kind === 'RECURRING' ? [plan.monthly_ht_cents, plan.annual_ht_cents] : [plan.one_off_ht_cents];
      for (const a of amounts) {
        expect(Number.isSafeInteger(a)).toBe(true);
        expect(a).toBeGreaterThan(0);
      }
    }
  });

  it('valeurs de la grille', () => {
    const solo = getPricingPlan('SOLO_AE');
    const pack = getPricingPlan('PACK_MOWAKABA_TPME');
    expect(solo.kind === 'RECURRING' && solo.monthly_ht_cents).toBe(12900);
    expect(solo.kind === 'RECURRING' && solo.annual_ht_cents).toBe(129000);
    expect(pack.kind === 'ONE_OFF' && pack.one_off_ht_cents).toBe(1800000);
  });

  it('annuel = 10 mensualités (2 mois offerts, Doc_03 S02)', () => {
    for (const plan of PRICING_PLANS) {
      if (plan.kind === 'RECURRING') expect(plan.annual_ht_cents).toBe(plan.monthly_ht_cents * 10);
    }
  });

  it('formatage entier', () => {
    expect(centsToDecimalString(12900)).toBe('129.00');
    expect(centsToDecimalString(5)).toBe('0.05');
    expect(formatCentsMad(12900)).toBe('129,00 MAD');
    expect(formatCentsMad(1800000)).toBe('18 000,00 MAD');
    expect(formatCentsMad(-150)).toBe('-1,50 MAD');
  });

  it('refuse un montant non entier', () => {
    expect(() => formatCentsMad(1.5)).toThrow();
  });
});
