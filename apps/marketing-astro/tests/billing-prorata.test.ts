import { describe, expect, it } from 'vitest';
import { BILLING_POLICY, MIN_BILLED_DAYS, computeDailyProrataCents, prorataClause, prorataRule } from '../src/content/billing-policy.ts';
import { FIDUCIARY_METER } from '../src/content/pricing.ts';
import { buildPricingView } from '../src/content/pricing-view.ts';
import { MARKETING_LOCALES } from '../src/i18n/locales.ts';

const TPE = 14900; // Doc_03 S04 : DOSSIER_TPE, centimes D1
const PME = 24900; // Doc_03 S04 : DOSSIER_PME_COMPLET

describe('prorata journalier exact (décision du propriétaire 2026-11-14)', () => {
  it('le catalogue porte les paliers de Doc_03 S04', () => {
    const codes = Object.fromEntries(FIDUCIARY_METER.dossierTiers.map((t) => [t.code, t.monthly_ht_cents]));
    expect(codes['DOSSIER_TPE']).toBe(TPE);
    expect(codes['DOSSIER_PME_COMPLET']).toBe(PME);
  });

  it('vecteurs Doc_03 S12 : 16 novembre, 30 jours, 15 jours actifs → 7 450 et 12 450 centimes', () => {
    expect(computeDailyProrataCents(TPE, 16, 30)).toBe(7450);
    expect(computeDailyProrataCents(PME, 16, 30)).toBe(12450);
  });

  it('mois entier si activé le 1er ; dernier jour = un jour', () => {
    expect(computeDailyProrataCents(TPE, 1, 30)).toBe(TPE);
    expect(computeDailyProrataCents(TPE, 30, 30)).toBe(497); // 14900 / 30 = 496,67 → demi supérieur
  });

  it('plancher d’un jour : activé et désactivé le même jour', () => {
    expect(MIN_BILLED_DAYS).toBe(1);
    expect(computeDailyProrataCents(TPE, 10, 30, 10)).toBe(computeDailyProrataCents(TPE, 30, 30));
    expect(computeDailyProrataCents(TPE, 10, 30, 10)).toBe(497);
    expect(computeDailyProrataCents(PME, 1, 31, 1)).toBe(803); // 24900 / 31 = 803,23
  });

  it('pas de mois minimum : trois jours actifs coûtent trois jours, pas le mois', () => {
    expect(computeDailyProrataCents(3000, 5, 30, 7)).toBe(300);
    expect(computeDailyProrataCents(TPE, 5, 30, 7)).toBeLessThan(TPE);
  });

  it('arrondi au demi supérieur en entiers (jamais de flottant)', () => {
    expect(computeDailyProrataCents(1, 16, 30)).toBe(1); // 15/30 = 0,5 → 1
    expect(computeDailyProrataCents(1, 17, 30)).toBe(0); // 14/30 → 0
    expect(Number.isInteger(computeDailyProrataCents(12345, 7, 31))).toBe(true);
    expect(computeDailyProrataCents(Number.MAX_SAFE_INTEGER, 1, 30)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('dates ou montants invalides : erreur explicite', () => {
    expect(() => computeDailyProrataCents(TPE, 0, 30)).toThrow(/BILLING_INVALID_PRORATA_DATES/);
    expect(() => computeDailyProrataCents(TPE, 31, 30)).toThrow(RangeError);
    expect(() => computeDailyProrataCents(TPE, 5, 27)).toThrow(RangeError);
    expect(() => computeDailyProrataCents(TPE, 5, 32)).toThrow(RangeError);
    expect(() => computeDailyProrataCents(TPE, 10, 30, 9)).toThrow(RangeError);
    expect(() => computeDailyProrataCents(TPE, 10, 30, 31)).toThrow(RangeError);
    expect(() => computeDailyProrataCents(1.5, 10, 30)).toThrow(RangeError);
    expect(() => computeDailyProrataCents(-1, 10, 30)).toThrow(RangeError);
    expect(() => computeDailyProrataCents(TPE, 1.5, 30)).toThrow(RangeError);
  });

  it('la politique de production est journalière et aucune page ne parle de question ouverte', () => {
    expect(BILLING_POLICY.fiduciaryProrata).toBe('DAILY');
    for (const loc of MARKETING_LOCALES) {
      const text = JSON.stringify(buildPricingView(loc, BILLING_POLICY));
      expect(text).not.toMatch(/Question ouverte|Open question|سؤال مفتوح|n’est pas tranch|not yet decided|باقي مفتوح/);
    }
    for (const c of ['fr', 'en', 'ar', 'ary'] as const) {
      expect(prorataClause(c).intro).not.toMatch(/المقابل|open|ouverte/i);
      expect(prorataRule(c).length).toBeGreaterThan(10);
    }
    expect(prorataClause('fr').faq).toContain('plancher d’un jour');
    expect(prorataClause('fr').faq).toContain('sans mois minimum');
  });
});
