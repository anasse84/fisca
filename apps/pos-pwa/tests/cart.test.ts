import { describe, expect, it } from 'vitest';
import { CartError, addItem, cartTotals, changeQuantity, lineTotalTtcCents, removeItem, setQuantity } from '../src/sale/cart.ts';
import type { CatalogItem } from '../src/sale/cart.ts';
import { formatBps, formatMilli } from '../src/sale/format.ts';

/** Jeu de données de test : prix et taux viennent du port de catalogue, jamais du code. */
const bread: CatalogItem = { id: 'a1', name: 'Pain', unitPriceTtcCents: 120, vatRateBps: 1000, quantityStepMilli: 1000 };
const coffee: CatalogItem = { id: 'a2', name: 'Café', unitPriceTtcCents: 1250, vatRateBps: 2000, quantityStepMilli: 1000 };
const flour: CatalogItem = { id: 'a3', name: 'Farine', unitPriceTtcCents: 799, vatRateBps: 0, quantityStepMilli: 250 };

describe('panier : quantités en milli-unités, prix en centimes', () => {
  it('ajouter deux fois le même article cumule la quantité', () => {
    const cart = addItem(addItem([], bread), bread);
    expect(cart).toHaveLength(1);
    expect(cart[0]?.quantityMilli).toBe(2000);
  });

  it('le pas de quantité vient de l’article (250 milli-unités)', () => {
    expect(addItem([], flour)[0]?.quantityMilli).toBe(250);
  });

  it('total de ligne : prix × quantité arrondi demi supérieur via divRoundHalfUpBigInt (799 × 0,250 = 199,75 → 200)', () => {
    expect(lineTotalTtcCents({ item: flour, quantityMilli: 250 })).toBe(200);
    expect(lineTotalTtcCents({ item: bread, quantityMilli: 1500 })).toBe(180);
    expect(lineTotalTtcCents({ item: { ...bread, unitPriceTtcCents: 1 }, quantityMilli: 500 })).toBe(1);
  });

  it('changeQuantity : diminuer jusqu’à zéro retire la ligne ; setQuantity et removeItem', () => {
    let cart = addItem(addItem([], bread), bread);
    cart = changeQuantity(cart, 'a1', -1000);
    expect(cart[0]?.quantityMilli).toBe(1000);
    cart = changeQuantity(cart, 'a1', -1000);
    expect(cart).toEqual([]);
    expect(setQuantity(addItem([], bread), 'a1', 3500)[0]?.quantityMilli).toBe(3500);
    expect(removeItem(addItem([], bread), 'a1')).toEqual([]);
  });

  it('ventile le TTC par taux : HT = TTC × 10 000 / (10 000 + bps), TVA = TTC − HT, somme exacte', () => {
    const cart = addItem(addItem(addItem([], bread, 3000), coffee, 2000), flour, 1000);
    const totals = cartTotals(cart);
    // pain 3 × 120 = 360 (10 %) ; café 2 × 1250 = 2500 (20 %) ; farine 1 × 799 = 799 (0 %)
    expect(totals.totalTtcCents).toBe(3659);
    expect(totals.lines).toEqual({ ht20Cents: 2083, vat20Cents: 417, ht10Cents: 327, vat10Cents: 33, ht0Cents: 799 });
    const ticketTtc = Object.values(totals.lines).reduce((a, b) => a + b, 0);
    expect(ticketTtc).toBe(totals.totalTtcCents);
    expect(totals.byRate.map((r) => r.vatRateBps)).toEqual([2000, 1000, 0]);
  });

  it('un taux hors des colonnes du ticket (2 000, 1 000, 0 bps) est refusé', () => {
    const odd: CatalogItem = { ...bread, id: 'x', vatRateBps: 1400 };
    expect(() => cartTotals(addItem([], odd))).toThrowError(CartError);
    try {
      cartTotals(addItem([], odd));
    } catch (error) {
      expect((error as CartError).code).toBe('VAT_RATE_UNSUPPORTED');
    }
  });

  it('refuse un prix flottant, une quantité nulle ou non entière', () => {
    expect(() => addItem([], { ...bread, unitPriceTtcCents: Number.EPSILON })).toThrowError(CartError);
    expect(() => addItem([], bread, 0)).toThrowError(CartError);
    expect(() => addItem([], bread, 1.5)).toThrowError(CartError);
  });

  it('panier vide : totaux à zéro', () => {
    expect(cartTotals([]).totalTtcCents).toBe(0);
  });
});

describe('formats d’affichage sans flottant', () => {
  it('formatMilli : 1 000 → « 1 », 1 500 → « 1,5 », 250 → « 0,25 », 2 005 → « 2,005 »', () => {
    expect(formatMilli(1000)).toBe('1');
    expect(formatMilli(1500)).toBe('1,5');
    expect(formatMilli(250)).toBe('0,25');
    expect(formatMilli(2005)).toBe('2,005');
  });
  it('formatBps : 2 000 → « 20 », 1 000 → « 10 », 0 → « 0 », 550 → « 5,5 »', () => {
    expect(formatBps(2000)).toBe('20');
    expect(formatBps(1000)).toBe('10');
    expect(formatBps(0)).toBe('0');
    expect(formatBps(550)).toBe('5,5');
  });
});
