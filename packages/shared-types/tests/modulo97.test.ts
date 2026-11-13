import { describe, expect, it } from 'vitest';
import { isValidIceChecksum, mod97OfDigits } from '../src/index.ts';
import vectors from './golden/primitives.vectors.json';

describe('Modulo 97 de l’ICE (contrôle de cohérence seulement, ERRATA section E)', () => {
  for (const vector of vectors.ice) {
    it(`${vector.id} ${vector.value} → ${String(vector.valid)} [${vector.state}] ${vector.law}`, () => {
      expect(isValidIceChecksum(vector.value)).toBe(vector.valid);
    });
  }

  it('calcule le reste sur de longues chaînes de chiffres', () => {
    expect(mod97OfDigits('003976749000084')).toBe(0);
    expect(mod97OfDigits('123456789000057')).toBe(43);
    expect(mod97OfDigits('0')).toBe(0);
    expect(mod97OfDigits('97')).toBe(0);
    expect(mod97OfDigits('98')).toBe(1);
  });

  it('rejette longueur ≠ 15, caractères non numériques et espaces', () => {
    expect(isValidIceChecksum('')).toBe(false);
    expect(isValidIceChecksum('39767490000084')).toBe(false);
    expect(isValidIceChecksum('0039767490000840')).toBe(false);
    expect(isValidIceChecksum('00397674900008A')).toBe(false);
    expect(isValidIceChecksum('003976749 00084')).toBe(false);
    expect(isValidIceChecksum('٠٠٣٩٧٦٧٤٩٠٠٠٠٨٤')).toBe(false);
  });

  it('mod97OfDigits refuse une entrée vide ou non numérique', () => {
    expect(() => mod97OfDigits('')).toThrowError(/MOD97/);
    expect(() => mod97OfDigits('12a')).toThrowError(/MOD97/);
  });
});
