import { describe, expect, it } from 'vitest';
import { computeCashStampCents, resolveCashStampRule } from '../src/ticketing/cash-stamp.ts';
import type { CashStampRule, CashStampRulePort } from '../src/ticketing/cash-stamp.ts';

/** Jeu de données de test : le taux n’existe en production que comme donnée datée fournie par le port. */
const RULE_DATASET: CashStampRule = { ruleId: 'jeu-de-test', rateBps: 25, rounding: 'HALF_UP' };

describe('timbre espèces : entiers, divRoundHalfUpBigInt, taux injecté', () => {
  it('cas du vecteur d’or : 120,30 MAD d’espèces → 30 centimes de timbre sur 12 000', () => {
    expect(computeCashStampCents(12000n, RULE_DATASET)).toBe(30n);
  });

  it('0 centime → 0 ; 1 centime → 0 (0,0025 arrondi)', () => {
    expect(computeCashStampCents(0n, RULE_DATASET)).toBe(0n);
    expect(computeCashStampCents(1n, RULE_DATASET)).toBe(0n);
  });

  it('demi supérieur exact : 200 cts → 0,5 → 1 ; 199 cts → 0,4975 → 0 ; 600 cts → 1,5 → 2', () => {
    expect(computeCashStampCents(200n, RULE_DATASET)).toBe(1n);
    expect(computeCashStampCents(199n, RULE_DATASET)).toBe(0n);
    expect(computeCashStampCents(600n, RULE_DATASET)).toBe(2n);
  });

  it('grands montants bigint, au-delà de Number.MAX_SAFE_INTEGER, sans perte', () => {
    expect(computeCashStampCents(10n ** 30n, RULE_DATASET)).toBe(25n * 10n ** 26n);
    expect(computeCashStampCents(10n ** 30n + 199n, RULE_DATASET)).toBe(25n * 10n ** 26n);
    expect(computeCashStampCents(10n ** 30n + 200n, RULE_DATASET)).toBe(25n * 10n ** 26n + 1n);
  });

  it('suit le taux injecté (autre jeu de données) : 100 bps de 12 345 → 123 ; 0 bps → 0', () => {
    expect(computeCashStampCents(12345n, { ruleId: 'autre', rateBps: 100, rounding: 'HALF_UP' })).toBe(123n);
    expect(computeCashStampCents(12345n, { ruleId: 'nul', rateBps: 0, rounding: 'HALF_UP' })).toBe(0n);
  });

  it('refuse un montant négatif, un taux non entier / négatif / > 10 000 et un arrondi inconnu', () => {
    expect(() => computeCashStampCents(-1n, RULE_DATASET)).toThrow(/négatif/);
    expect(() => computeCashStampCents(100n, { ...RULE_DATASET, rateBps: Number('0.25') })).toThrow(/rateBps/);
    expect(() => computeCashStampCents(100n, { ...RULE_DATASET, rateBps: -1 })).toThrow(/rateBps/);
    expect(() => computeCashStampCents(100n, { ...RULE_DATASET, rateBps: 10001 })).toThrow(/rateBps/);
    expect(() => computeCashStampCents(100n, { ...RULE_DATASET, rounding: 'CEIL' as 'HALF_UP' })).toThrow(/arrondi/);
  });

  it('aucune règle fournie par le port → refus explicite (jamais de constante implicite)', async () => {
    const empty: CashStampRulePort = { getCashStampRule: async () => null };
    await expect(resolveCashStampRule(empty, '2026-11-13T10:15:00.000Z')).rejects.toThrow(/règle de timbre/);
    const given: CashStampRulePort = { getCashStampRule: async () => RULE_DATASET };
    expect(await resolveCashStampRule(given, '2026-11-13T10:15:00.000Z')).toEqual(RULE_DATASET);
  });
});
