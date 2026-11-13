import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { datedValue } from '../src/content/dated-values.ts';
import {
  LARGE_GROUP_OWNERSHIP_THRESHOLD_BPS,
  MOWAKABA_ELIGIBILITY_MAX_REVENUE_HT_CENTS,
  PACK_MOWAKABA_CABINET,
  getPricingPlan,
} from '../src/content/pricing.ts';
import { computeAeClientThreshold, computeAeQuarterlyIr, computeAeSwitch } from '../src/tools/auto-entrepreneur.ts';
import type { AeThresholdParams } from '../src/tools/auto-entrepreneur.ts';
import { computeMowakaba } from '../src/tools/mowakaba.ts';
import type { MowakabaParams } from '../src/tools/mowakaba.ts';
import { ruleParam } from '../src/tools/rule-params.ts';

interface Vector {
  readonly id: string;
  readonly law: string;
  readonly state: string;
  readonly input: Record<string, number | string>;
  readonly expected: Record<string, number | string>;
  readonly calculation: string;
}
const GOLD = JSON.parse(readFileSync(new URL('./golden/tools-viraux.vectors.json', import.meta.url), 'utf8')) as { readonly vectors: readonly Vector[]; readonly rule_date: string };
function vector(id: string): Vector {
  const found = GOLD.vectors.find((v) => v.id === id);
  if (found === undefined) throw new Error(`vecteur absent : ${id}`);
  return found;
}
function n(record: Record<string, number | string>, key: string): number {
  const x = record[key];
  if (typeof x !== 'number') throw new Error(`nombre attendu : ${key}`);
  return x;
}

/** Paramètres lus des données de contenu datées, jamais recopiés ici. */
const AE_PARAMS: AeThresholdParams = { thresholdCents: ruleParam('ae_client_threshold_cents').value, withholdingBps: ruleParam('ae_withholding_bps').value };
const MOW_PARAMS: MowakabaParams = {
  coverageLowBps: ruleParam('mowakaba_coverage_low_bps').value,
  coverageHighBps: ruleParam('mowakaba_coverage_high_bps').value,
  maxRevenueHtCents: ruleParam('mowakaba_max_revenue_ht_cents').value,
  maxGroupOwnershipBps: ruleParam('mowakaba_group_ownership_max_bps').value,
};

describe('paramètres datés des outils 5 et 6', () => {
  it('chaque valeur porte as_of, état et source ; le taux d’IR n’est jamais RECOUPÉ', () => {
    for (const key of ['ae_ir_rate_low_bps', 'ae_ir_rate_high_bps', 'ae_client_threshold_cents', 'ae_withholding_bps', 'mowakaba_coverage_low_bps', 'mowakaba_coverage_high_bps', 'mowakaba_max_revenue_ht_cents', 'mowakaba_group_ownership_max_bps']) {
      const v = datedValue(key);
      expect(v.as_of, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['RECOUPÉ', 'NON RECOUPÉ', 'PROVISOIRE']).toContain(v.state);
      expect(v.specRef.length).toBeGreaterThan(5);
    }
    expect(datedValue('ae_ir_rate_low_bps').state).toBe('NON RECOUPÉ');
    expect(datedValue('ae_ir_rate_high_bps').state).toBe('NON RECOUPÉ');
  });

  it('plafond et seuil Mowakaba du contenu daté = constantes de la grille tarifaire (une seule vérité)', () => {
    expect(datedValue('mowakaba_max_revenue_ht_cents').value).toBe(MOWAKABA_ELIGIBILITY_MAX_REVENUE_HT_CENTS);
    expect(datedValue('mowakaba_group_ownership_max_bps').value).toBe(LARGE_GROUP_OWNERSHIP_THRESHOLD_BPS);
  });
});

describe('auto-entrepreneur : seuil par client (VEC-CGI-04)', () => {
  it('vecteur d’or VEC-CGI-04 : surplus 700 000 c, retenue 210 000 c, net 990 000 c', () => {
    const v = vector('VEC-CGI-04');
    expect(v.state).toBe('NON RECOUPÉ');
    expect(v.law).toMatch(/80 000/);
    expect(n(v.input, 'threshold_cents')).toBe(AE_PARAMS.thresholdCents);
    expect(n(v.input, 'withholding_bps')).toBe(AE_PARAMS.withholdingBps);
    const out = computeAeClientThreshold({ priorCumulCents: n(v.input, 'prior_cumul_cents'), invoiceCents: n(v.input, 'invoice_cents') }, AE_PARAMS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.cumulAfterCents).toBe(n(v.expected, 'cumul_after_cents'));
    expect(out.result.surplusCents).toBe(700000);
    expect(out.result.withheldCents).toBe(210000);
    expect(out.result.netCents).toBe(990000);
    expect(out.result.exceeded).toBe(true);
    expect(out.result.headroomCents).toBe(0);
  });

  it('cumul déjà au-delà du seuil : toute la nouvelle facture est taxée', () => {
    const v = vector('AE-THR-ALREADY-OVER');
    const out = computeAeClientThreshold({ priorCumulCents: n(v.input, 'prior_cumul_cents'), invoiceCents: n(v.input, 'invoice_cents') }, AE_PARAMS);
    expect(out.ok && [out.result.surplusCents, out.result.withheldCents, out.result.netCents]).toEqual([500000, 150000, 350000]);
  });

  it('borne : cumul égal au seuil = aucune retenue ; un centime de plus = 1 centime de surplus', () => {
    const v = vector('AE-THR-AT-THRESHOLD');
    const at = computeAeClientThreshold({ priorCumulCents: n(v.input, 'prior_cumul_cents'), invoiceCents: n(v.input, 'invoice_cents') }, AE_PARAMS);
    expect(at.ok && [at.result.exceeded, at.result.surplusCents, at.result.withheldCents, at.result.headroomCents]).toEqual([false, 0, 0, 0]);
    const over = computeAeClientThreshold({ priorCumulCents: 7000000, invoiceCents: 1000001 }, AE_PARAMS);
    expect(over.ok && [over.result.exceeded, over.result.surplusCents]).toEqual([true, 1]);
    const under = computeAeClientThreshold({ priorCumulCents: 100, invoiceCents: 200 }, AE_PARAMS);
    expect(under.ok && under.result.headroomCents).toBe(AE_PARAMS.thresholdCents - 300);
  });

  it('refuse les entrées invalides sans lever d’exception', () => {
    expect(computeAeClientThreshold({ priorCumulCents: -1, invoiceCents: 5 }, AE_PARAMS)).toEqual({ ok: false, error: 'CUMUL' });
    expect(computeAeClientThreshold({ priorCumulCents: 0, invoiceCents: 0 }, AE_PARAMS)).toEqual({ ok: false, error: 'INVOICE' });
    expect(computeAeClientThreshold({ priorCumulCents: 0, invoiceCents: Number.NaN }, AE_PARAMS)).toEqual({ ok: false, error: 'INVOICE' });
    expect(computeAeClientThreshold({ priorCumulCents: 0, invoiceCents: 5 }, { thresholdCents: 10, withholdingBps: 10001 })).toEqual({ ok: false, error: 'PARAMS' });
    expect(computeAeClientThreshold({ priorCumulCents: Number.MAX_SAFE_INTEGER, invoiceCents: 5 }, AE_PARAMS)).toEqual({ ok: false, error: 'CUMUL' });
  });
});

describe('auto-entrepreneur : IR trimestriel et comparaison', () => {
  it('vecteurs AE-IR : 0,5 % et 1 % de 50 000 MAD', () => {
    for (const id of ['AE-IR-QUARTER-LOW', 'AE-IR-QUARTER-HIGH']) {
      const v = vector(id);
      expect(v.state).toBe('NON RECOUPÉ');
      const out = computeAeQuarterlyIr(n(v.input, 'quarter_revenue_cents'), n(v.input, 'rate_bps'));
      expect(out.ok && out.result.quarterIrCents, id).toBe(n(v.expected, 'quarter_ir_cents'));
    }
  });

  it('les deux taux proposés sont ceux du contenu daté ; un taux saisi est accepté, jamais deviné', () => {
    expect(ruleParam('ae_ir_rate_low_bps').value).toBe(50);
    expect(ruleParam('ae_ir_rate_high_bps').value).toBe(100);
    const custom = computeAeQuarterlyIr(333333, 125);
    expect(custom.ok && custom.result.quarterIrCents).toBe(4167); // 333333 x 125 / 10000 = 4166,66 -> demi supérieur 4167
    expect(computeAeQuarterlyIr(0, 50)).toEqual({ ok: false, error: 'REVENUE' });
    expect(computeAeQuarterlyIr(100, 10001)).toEqual({ ok: false, error: 'RATE' });
    expect(computeAeQuarterlyIr(100, -5)).toEqual({ ok: false, error: 'RATE' });
  });

  it('comparaison : prix Solo et Essentiel lus de pricing.ts (HT), IR annualisé, autres coûts saisis', () => {
    const solo = getPricingPlan('SOLO_AE');
    const essentiel = getPricingPlan('ESSENTIEL_TPE');
    if (solo.kind !== 'RECURRING' || essentiel.kind !== 'RECURRING') throw new Error('offres récurrentes attendues');
    const prices = { soloAnnualHtCents: solo.annual_ht_cents, essentielAnnualHtCents: essentiel.annual_ht_cents };
    const out = computeAeSwitch({ quarterRevenueCents: 5000000, rateBps: 50, otherCompanyCostsCents: 0 }, prices);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.quarterIrCents).toBe(25000);
    expect(out.result.annualIrCents).toBe(100000);
    expect(out.result.aeTotalCents).toBe(100000 + solo.annual_ht_cents);
    expect(out.result.companyTotalCents).toBe(essentiel.annual_ht_cents);
    expect(out.result.differenceCents).toBe(essentiel.annual_ht_cents - 100000 - solo.annual_ht_cents);
    const withCosts = computeAeSwitch({ quarterRevenueCents: 5000000, rateBps: 50, otherCompanyCostsCents: 600000 }, prices);
    expect(withCosts.ok && withCosts.result.differenceCents).toBe(out.result.differenceCents + 600000);
    const negative = computeAeSwitch({ quarterRevenueCents: 90000000, rateBps: 100, otherCompanyCostsCents: 0 }, prices);
    expect(negative.ok && negative.result.differenceCents).toBeLessThan(0);
    expect(computeAeSwitch({ quarterRevenueCents: 5000000, rateBps: 50, otherCompanyCostsCents: -1 }, prices)).toEqual({ ok: false, error: 'COSTS' });
  });
});

describe('Mowakaba : éligibilité et reste à charge', () => {
  const tpme = getPricingPlan('PACK_MOWAKABA_TPME');
  if (tpme.kind !== 'ONE_OFF') throw new Error('pack ponctuel attendu');
  const prices: Record<string, number> = { TPME: tpme.one_off_ht_cents, CABINET: PACK_MOWAKABA_CABINET.one_off_ht_cents };

  it('les prix des packs viennent de pricing.ts : 18 000 et 45 000 MAD HT', () => {
    expect(prices['TPME']).toBe(1800000);
    expect(prices['CABINET']).toBe(4500000);
  });

  it('vecteurs d’or aux bornes 80 % et 90 % pour les deux packs', () => {
    for (const id of ['MOW-TPME-80', 'MOW-TPME-90', 'MOW-CABINET-80', 'MOW-CABINET-90']) {
      const v = vector(id);
      expect(v.state).toBe('NON RECOUPÉ');
      const price = n(v.input, 'pack_price_ht_cents');
      expect([1800000, 4500000]).toContain(price);
      const bps = n(v.input, 'coverage_bps');
      const out = computeMowakaba({ revenueHtCents: 1000000, groupOwnershipBps: null, packPriceHtCents: price, chosenCoverageBps: bps }, MOW_PARAMS);
      expect(out.ok, id).toBe(true);
      if (!out.ok) continue;
      expect(out.result.chosen?.subsidyCents, id).toBe(n(v.expected, 'subsidy_cents'));
      expect(out.result.chosen?.remainingCents, id).toBe(n(v.expected, 'remaining_cents'));
    }
  });

  it('fourchette : TPME entre 1 800 et 3 600 MAD HT, Cabinet entre 4 500 et 9 000 MAD HT', () => {
    const t = computeAeOrThrow(prices['TPME'] ?? 0);
    expect([t.high.remainingCents, t.low.remainingCents]).toEqual([180000, 360000]);
    const c = computeAeOrThrow(prices['CABINET'] ?? 0);
    expect([c.high.remainingCents, c.low.remainingCents]).toEqual([450000, 900000]);
    expect(t.low.coverageBps).toBe(8000);
    expect(t.high.coverageBps).toBe(9000);
    expect(t.chosen).toBeNull();
  });

  function computeAeOrThrow(price: number) {
    const out = computeMowakaba({ revenueHtCents: 100000000, groupOwnershipBps: null, packPriceHtCents: price, chosenCoverageBps: null }, MOW_PARAMS);
    if (!out.ok) throw new Error(out.error);
    return out.result;
  }

  it('borne du plafond de 200 M MAD HT : égal = éligible, un centime de plus = non éligible', () => {
    const at = vector('MOW-ELIG-AT-CEILING');
    const above = vector('MOW-ELIG-ABOVE-CEILING');
    expect(n(at.input, 'max_revenue_ht_cents')).toBe(MOW_PARAMS.maxRevenueHtCents);
    const eligible = computeMowakaba({ revenueHtCents: n(at.input, 'revenue_ht_cents'), groupOwnershipBps: null, packPriceHtCents: 1800000, chosenCoverageBps: null }, MOW_PARAMS);
    expect(eligible.ok && eligible.result.eligible).toBe(n(at.expected, 'eligible') === 1);
    const ineligible = computeMowakaba({ revenueHtCents: n(above.input, 'revenue_ht_cents'), groupOwnershipBps: null, packPriceHtCents: 1800000, chosenCoverageBps: null }, MOW_PARAMS);
    expect(ineligible.ok && ineligible.result.eligible).toBe(n(above.expected, 'eligible') === 1);
    expect(ineligible.ok && ineligible.result.reasons).toEqual(['REVENUE_ABOVE_CEILING']);
    expect(MOW_PARAMS.maxRevenueHtCents).toBe(200 * 1000000 * 100);
  });

  it('détention par un grand groupe : 25 % = éligible, au-delà = non éligible ; non renseignée = ignorée', () => {
    const base = { revenueHtCents: 1000000, packPriceHtCents: 1800000, chosenCoverageBps: null };
    const at = computeMowakaba({ ...base, groupOwnershipBps: 2500 }, MOW_PARAMS);
    expect(at.ok && at.result.eligible).toBe(true);
    const over = computeMowakaba({ ...base, groupOwnershipBps: 2501 }, MOW_PARAMS);
    expect(over.ok && over.result.reasons).toEqual(['GROUP_OWNERSHIP_ABOVE_THRESHOLD']);
    const both = computeMowakaba({ ...base, revenueHtCents: 20000000001, groupOwnershipBps: 5000 }, MOW_PARAMS);
    expect(both.ok && both.result.reasons).toEqual(['REVENUE_ABOVE_CEILING', 'GROUP_OWNERSHIP_ABOVE_THRESHOLD']);
  });

  it('taux choisi hors fourchette refusé ; entrées invalides refusées', () => {
    const base = { revenueHtCents: 1000000, groupOwnershipBps: null, packPriceHtCents: 1800000 };
    expect(computeMowakaba({ ...base, chosenCoverageBps: 7999 }, MOW_PARAMS)).toEqual({ ok: false, error: 'COVERAGE' });
    expect(computeMowakaba({ ...base, chosenCoverageBps: 9001 }, MOW_PARAMS)).toEqual({ ok: false, error: 'COVERAGE' });
    const mid = computeMowakaba({ ...base, chosenCoverageBps: 8500 }, MOW_PARAMS);
    expect(mid.ok && mid.result.chosen?.remainingCents).toBe(270000);
    expect(computeMowakaba({ ...base, revenueHtCents: -1, chosenCoverageBps: null }, MOW_PARAMS)).toEqual({ ok: false, error: 'REVENUE' });
    expect(computeMowakaba({ ...base, packPriceHtCents: 0, chosenCoverageBps: null }, MOW_PARAMS)).toEqual({ ok: false, error: 'PRICE' });
    expect(computeMowakaba({ ...base, chosenCoverageBps: null }, { ...MOW_PARAMS, coverageLowBps: 9500 })).toEqual({ ok: false, error: 'PARAMS' });
    expect(computeMowakaba({ ...base, groupOwnershipBps: 10001, chosenCoverageBps: null }, MOW_PARAMS)).toEqual({ ok: false, error: 'OWNERSHIP' });
  });
});

describe('propriétés : entiers de bout en bout, aucun flottant', () => {
  it('10 000 tirages pseudo-aléatoires : toutes les sorties sont des entiers sûrs et la somme est exacte', () => {
    let seed = 20261113;
    const next = (max: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % (max + 1);
    };
    for (let i = 0; i < 10000; i += 1) {
      const price = 1 + next(9_000_000);
      const bps = 8000 + next(1000);
      const m = computeMowakaba({ revenueHtCents: next(30_000_000_000), groupOwnershipBps: null, packPriceHtCents: price, chosenCoverageBps: bps }, MOW_PARAMS);
      if (!m.ok || m.result.chosen === null) throw new Error('tirage invalide');
      const c = m.result.chosen;
      expect(Number.isSafeInteger(c.subsidyCents) && Number.isSafeInteger(c.remainingCents)).toBe(true);
      expect(c.subsidyCents + c.remainingCents).toBe(price);
      expect(m.result.high.remainingCents).toBeLessThanOrEqual(c.remainingCents);
      expect(c.remainingCents).toBeLessThanOrEqual(m.result.low.remainingCents);
      const a = computeAeClientThreshold({ priorCumulCents: next(20_000_000), invoiceCents: 1 + next(5_000_000) }, AE_PARAMS);
      if (!a.ok) throw new Error('tirage invalide');
      expect(Number.isSafeInteger(a.result.withheldCents)).toBe(true);
      expect(a.result.withheldCents + a.result.netCents).toBeGreaterThan(0);
      expect(a.result.surplusCents).toBeLessThanOrEqual(a.result.cumulAfterCents);
    }
  });

  it('les modules n’emploient ni flottant ni arrondi flottant', () => {
    for (const file of ['auto-entrepreneur', 'mowakaba']) {
      const src = readFileSync(new URL(`../src/tools/${file}.ts`, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(/parseFloat|Math\.round|Math\.ceil|Math\.floor|toFixed|\d\.\d/);
    }
  });
});
