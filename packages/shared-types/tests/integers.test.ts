import { describe, expect, it } from 'vitest';
import {
  FiscaIntegerError,
  addInt,
  applyBps,
  bps,
  centimes,
  micro,
  milli,
  mulInt,
  subInt,
} from '../src/index.ts';
import vectors from './golden/primitives.vectors.json';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof FiscaIntegerError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

describe('constructeurs de types de marque', () => {
  const constructors = [
    ['centimes', centimes],
    ['bps', bps],
    ['milli', milli],
    ['micro', micro],
  ] as const;

  for (const [name, make] of constructors) {
    it(`${name} accepte les entiers sûrs, zéro et négatifs`, () => {
      expect(make(0)).toBe(0);
      expect(make(-12345)).toBe(-12345);
      expect(make(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
      expect(make(-Number.MAX_SAFE_INTEGER)).toBe(-Number.MAX_SAFE_INTEGER);
    });

    it(`${name} rejette non-entier, NaN, Infinity et dépassement`, () => {
      expect(codeOf(() => make(1.5))).toBe('NOT_INTEGER');
      expect(codeOf(() => make(0.1 + 0.2))).toBe('NOT_INTEGER');
      expect(codeOf(() => make(Number.NaN))).toBe('NOT_A_NUMBER');
      expect(codeOf(() => make(Number.POSITIVE_INFINITY))).toBe('NOT_FINITE');
      expect(codeOf(() => make(Number.NEGATIVE_INFINITY))).toBe('NOT_FINITE');
      expect(codeOf(() => make(Number.MAX_SAFE_INTEGER + 1))).toBe('UNSAFE_INTEGER');
      expect(codeOf(() => make(-Number.MAX_SAFE_INTEGER - 1))).toBe('UNSAFE_INTEGER');
    });
  }

  it('rejette une valeur qui n’est pas un nombre', () => {
    expect(codeOf(() => centimes('100' as unknown as number))).toBe('NOT_A_NUMBER');
  });

  it('le message d’erreur porte le code ADR_03 et le libellé', () => {
    expect(() => centimes(1.5)).toThrowError(/ADR_03_FLOAT_FORBIDDEN.*centimes/);
  });
});

describe('addition, soustraction, multiplication sûres', () => {
  it('additionne et soustrait exactement', () => {
    expect(addInt(centimes(10), centimes(20))).toBe(30);
    expect(subInt(centimes(10), centimes(25))).toBe(-15);
    expect(addInt(bps(2000), bps(500))).toBe(2500);
  });

  it('détecte le dépassement à l’addition et à la soustraction', () => {
    expect(codeOf(() => addInt(centimes(Number.MAX_SAFE_INTEGER), centimes(1)))).toBe('UNSAFE_INTEGER');
    expect(codeOf(() => subInt(centimes(-Number.MAX_SAFE_INTEGER), centimes(1)))).toBe('UNSAFE_INTEGER');
  });

  it('multiplie par un entier et refuse un facteur non entier', () => {
    expect(mulInt(centimes(1250), 3)).toBe(3750);
    expect(mulInt(centimes(1250), 0)).toBe(0);
    expect(mulInt(centimes(1250), -2)).toBe(-2500);
    expect(codeOf(() => mulInt(centimes(1250), 0.5))).toBe('NOT_INTEGER');
    expect(codeOf(() => mulInt(centimes(Number.MAX_SAFE_INTEGER), 2))).toBe('UNSAFE_INTEGER');
    expect(codeOf(() => mulInt(centimes(94906267), 94906267))).toBe('UNSAFE_INTEGER');
  });
});

describe('applyBps : divRoundHalfUpBigInt(montant × bps, 10000)', () => {
  for (const vector of vectors.vectors) {
    it(`${vector.id} ${vector.label} → ${vector.expectedCents} [${vector.state}] ${vector.law}`, () => {
      expect(applyBps(centimes(vector.amountCents), bps(vector.rateBps))).toBe(vector.expectedCents);
    });
  }

  it('arrondit le demi vers le haut', () => {
    expect(applyBps(centimes(5), bps(5000))).toBe(3);
    expect(applyBps(centimes(1), bps(4999))).toBe(0);
    expect(applyBps(centimes(1), bps(5000))).toBe(1);
  });

  it('gère zéro, taux zéro, 100 % et montant négatif (avoir)', () => {
    expect(applyBps(centimes(0), bps(2000))).toBe(0);
    expect(applyBps(centimes(10000), bps(0))).toBe(0);
    expect(applyBps(centimes(10000), bps(10000))).toBe(10000);
    expect(applyBps(centimes(-10000), bps(2000))).toBe(-2000);
    expect(applyBps(centimes(-1), bps(5000))).toBe(0);
  });

  it('reste exact au-delà de 2^53 en produit intermédiaire', () => {
    const big = centimes(9_000_000_000_000_000);
    expect(applyBps(big, bps(10000))).toBe(9_000_000_000_000_000);
    expect(applyBps(big, bps(5000))).toBe(4_500_000_000_000_000);
  });

  it('refuse un résultat hors entiers sûrs', () => {
    expect(codeOf(() => applyBps(centimes(Number.MAX_SAFE_INTEGER), bps(20000)))).toBe('UNSAFE_INTEGER');
  });
});
