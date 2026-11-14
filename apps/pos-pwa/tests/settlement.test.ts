import { describe, expect, it } from 'vitest';
import { appendDigit, computeSettlement, deleteLastDigit } from '../src/sale/settlement.ts';
import type { CashStampRulePort } from '../src/ticketing/cash-stamp.ts';

/** Jeu de données de test : 25 bps n’existe ici que comme donnée du port. */
const rules: CashStampRulePort = { getCashStampRule: async () => ({ ruleId: 'jeu', rateBps: 25, rounding: 'HALF_UP' }) };
const noRule: CashStampRulePort = { getCashStampRule: async () => null };
const AT = '2026-11-14T08:00:00.000Z';

describe('règlement : espèces, carte TPE, appli livraison, rendu monnaie en centimes entiers', () => {
  it('espèces seules : timbre via le port, espèces dues = part + timbre, rendu = remis − dû', async () => {
    const s = await computeSettlement({ goodsTtcCents: 12000, cardCents: 0, deliveryCents: 0, cashTenderedCents: 15000 }, rules, AT);
    expect(s.status).toBe('READY');
    expect(s.cashShareCents).toBe(12000);
    expect(s.stampCents).toBe(30);
    expect(s.cashDueCents).toBe(12030);
    expect(s.changeCents).toBe(2970);
  });

  it('mixte : le timbre ne porte que sur la part espèces', async () => {
    const s = await computeSettlement({ goodsTtcCents: 12000, cardCents: 8000, deliveryCents: 1000, cashTenderedCents: 3100 }, rules, AT);
    expect(s.cashShareCents).toBe(3000);
    expect(s.stampCents).toBe(8);
    expect(s.cashDueCents).toBe(3008);
    expect(s.changeCents).toBe(92);
    expect(s.status).toBe('READY');
  });

  it('carte seule : pas d’espèces, pas de timbre, pas de montant remis requis', async () => {
    const s = await computeSettlement({ goodsTtcCents: 5000, cardCents: 5000, deliveryCents: 0, cashTenderedCents: 0 }, rules, AT);
    expect(s).toMatchObject({ status: 'READY', cashShareCents: 0, stampCents: 0, cashDueCents: 0, changeCents: 0 });
  });

  it('montant remis insuffisant : SHORT', async () => {
    const s = await computeSettlement({ goodsTtcCents: 12000, cardCents: 0, deliveryCents: 0, cashTenderedCents: 12000 }, rules, AT);
    expect(s.status).toBe('SHORT');
    expect(s.changeCents).toBe(0);
    expect(s.shortfallCents).toBe(30);
  });

  it('carte + livraison supérieurs au total : EXCESS_NON_CASH', async () => {
    const s = await computeSettlement({ goodsTtcCents: 1000, cardCents: 900, deliveryCents: 200, cashTenderedCents: 0 }, rules, AT);
    expect(s.status).toBe('EXCESS_NON_CASH');
  });

  it('sans règle de timbre du port : STAMP_RULE_MISSING, aucune constante implicite', async () => {
    const s = await computeSettlement({ goodsTtcCents: 1000, cardCents: 0, deliveryCents: 0, cashTenderedCents: 1000 }, noRule, AT);
    expect(s.status).toBe('STAMP_RULE_MISSING');
  });

  it('panier vide : EMPTY', async () => {
    const s = await computeSettlement({ goodsTtcCents: 0, cardCents: 0, deliveryCents: 0, cashTenderedCents: 0 }, rules, AT);
    expect(s.status).toBe('EMPTY');
  });

  it('refuse un montant non entier', async () => {
    await expect(computeSettlement({ goodsTtcCents: Number.EPSILON, cardCents: 0, deliveryCents: 0, cashTenderedCents: 0 }, rules, AT)).rejects.toThrow();
  });
});

describe('pavé numérique : saisie en centimes entiers', () => {
  it('appendDigit : 1, 2, 5, 0 → 1 250 centimes ; deleteLastDigit → 125', () => {
    let v = 0;
    for (const d of [1, 2, 5, 0]) v = appendDigit(v, d);
    expect(v).toBe(1250);
    expect(deleteLastDigit(v)).toBe(125);
    expect(deleteLastDigit(5)).toBe(0);
  });
  it('plafonne à 10 chiffres et refuse un chiffre invalide', () => {
    let v = 0;
    for (let i = 0; i < 12; i += 1) v = appendDigit(v, 9);
    expect(v).toBe(9999999999);
    expect(() => appendDigit(0, 10)).toThrow();
  });
});
