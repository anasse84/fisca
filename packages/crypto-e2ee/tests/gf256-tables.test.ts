import { describe, expect, it } from 'vitest';
import { E2eeError } from '../src/e2ee-errors.ts';
import {
  GF256_EXP,
  GF256_LOG,
  SHAMIR_GF256_ZERO_INVERSE,
  gf256Inv,
  gf256Inverse,
  gf256Mul,
  gf256Multiply,
} from '../src/shamir-escrow.ts';

/** Référence lente « à la russe » (xtime) : polynôme 0x11b, conservée comme oracle indépendant des tables. */
function russianPeasantMultiply(a: number, b: number): number {
  let product = 0;
  let x = a;
  let y = b;
  while (y > 0) {
    if ((y & 1) === 1) product ^= x;
    const high = x & 0x80;
    x = (x << 1) & 0xff;
    if (high !== 0) x ^= 0x1b;
    y >>= 1;
  }
  return product;
}

describe('GF(256) — tables statiques exp/log (0x11b, générateur 0x03)', () => {
  it('les 65 536 produits (a, b) égalent la multiplication lente xtime', () => {
    let mismatches = 0;
    for (let a = 0; a < 256; a += 1) {
      for (let b = 0; b < 256; b += 1) {
        if (gf256Mul(a, b) !== russianPeasantMultiply(a, b)) mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('les 255 inverses vérifient a·inv(a) = 1 et inv(inv(a)) = a', () => {
    for (let a = 1; a < 256; a += 1) {
      const inverse = gf256Inv(a);
      expect(gf256Mul(a, inverse)).toBe(1);
      expect(russianPeasantMultiply(a, inverse)).toBe(1);
      expect(gf256Inv(inverse)).toBe(a);
    }
  });

  it('l’inverse de zéro lève une E2eeError portant le code SHAMIR_GF256_ZERO_INVERSE', () => {
    expect(SHAMIR_GF256_ZERO_INVERSE).toBe('SHAMIR_GF256_ZERO_INVERSE');
    for (const call of [() => gf256Inv(0), () => gf256Inverse(0)]) {
      try {
        call();
        expect.unreachable('l’inverse de zéro doit échouer');
      } catch (error) {
        expect(error).toBeInstanceOf(E2eeError);
        expect((error as E2eeError).code).toBe(SHAMIR_GF256_ZERO_INVERSE);
      }
    }
  });

  it('0·x = x·0 = 0 pour tout x', () => {
    for (let x = 0; x < 256; x += 1) {
      expect(gf256Mul(0, x)).toBe(0);
      expect(gf256Mul(x, 0)).toBe(0);
    }
  });

  it('les tables sont cohérentes : exp[log[a]] = a, log[exp[i]] = i, 0x03 engendre les 255 éléments non nuls', () => {
    const seen = new Set<number>();
    for (let a = 1; a < 256; a += 1) expect(GF256_EXP[GF256_LOG[a] ?? 0]).toBe(a);
    for (let i = 0; i < 255; i += 1) {
      const value = GF256_EXP[i] ?? 0;
      expect(GF256_LOG[value]).toBe(i);
      seen.add(value);
    }
    expect(seen.size).toBe(255);
    expect(seen.has(0)).toBe(false);
    expect(GF256_EXP[0]).toBe(1);
    expect(GF256_EXP[1]).toBe(3);
  });

  it('vecteurs FIPS 197 : 0x57·0x13 = 0xfe, 0x53·0xCA = 0x01', () => {
    expect(gf256Mul(0x57, 0x13)).toBe(0xfe);
    expect(gf256Mul(0x53, 0xca)).toBe(0x01);
    expect(gf256Inv(0x53)).toBe(0xca);
  });

  it('les noms exportés historiques sont des alias des fonctions à tables', () => {
    expect(gf256Multiply).toBe(gf256Mul);
    expect(gf256Inverse).toBe(gf256Inv);
  });
});
