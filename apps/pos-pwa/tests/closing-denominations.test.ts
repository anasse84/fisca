import { describe, expect, it } from 'vitest';
import { DenominationError, totalCountedCents, validateGrid } from '../src/closing/denominations.ts';
import { TEST_DENOMINATIONS } from './helpers-closing.ts';

describe('comptage de caisse : coupures fournies par un port, centimes entiers', () => {
  it('totalise coupures et pièces en centimes entiers', () => {
    expect(totalCountedCents(TEST_DENOMINATIONS, { 'note-20000': 1, 'note-5000': 2, 'coin-500': 3, 'coin-10': 7 })).toBe(20000 + 10000 + 1500 + 70);
    expect(totalCountedCents(TEST_DENOMINATIONS, {})).toBe(0);
  });

  it('refuse une quantité négative, décimale ou une coupure inconnue', () => {
    expect(() => totalCountedCents(TEST_DENOMINATIONS, { 'note-20000': -1 })).toThrowError(DenominationError);
    expect(() => totalCountedCents(TEST_DENOMINATIONS, { 'note-20000': 1.5 })).toThrowError(DenominationError);
    expect(() => totalCountedCents(TEST_DENOMINATIONS, { 'billet-fantome': 1 })).toThrowError(DenominationError);
  });

  it('valide la grille : valeurs entières strictement positives, identifiants uniques, grille non vide', () => {
    expect(() => validateGrid([])).toThrowError(DenominationError);
    expect(() => validateGrid([{ id: 'a', valueCents: 0, kind: 'coin' }])).toThrowError(DenominationError);
    expect(() => validateGrid([{ id: 'a', valueCents: Number.EPSILON, kind: 'coin' }])).toThrowError(DenominationError);
    expect(() => validateGrid([{ id: 'a', valueCents: 5, kind: 'coin' }, { id: 'a', valueCents: 10, kind: 'coin' }])).toThrowError(DenominationError);
    expect(() => validateGrid(TEST_DENOMINATIONS)).not.toThrow();
  });

  it('un total au-delà de l’entier sûr est refusé (bigint interne, jamais de flottant)', () => {
    expect(() => totalCountedCents([{ id: 'x', valueCents: 20000, kind: 'banknote' }], { x: Number.MAX_SAFE_INTEGER })).toThrowError(DenominationError);
  });
});
