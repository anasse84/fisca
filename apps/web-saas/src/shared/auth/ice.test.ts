import { describe, expect, it } from 'vitest';
import { ICE_LENGTH, isIceShapeValid, normalizeIceInput } from './ice.ts';

describe('ICE : contrôle de forme seulement', () => {
  it('15 chiffres exactement', () => {
    expect(ICE_LENGTH).toBe(15);
    expect(isIceShapeValid('001234567000089')).toBe(true);
    expect(isIceShapeValid('00123456700008')).toBe(false);
    expect(isIceShapeValid('0012345670000890')).toBe(false);
    expect(isIceShapeValid('00123456700008A')).toBe(false);
    expect(isIceShapeValid('')).toBe(false);
  });
  it('accepte des chiffres arabo-indiens et les normalise en chiffres occidentaux', () => {
    expect(normalizeIceInput('٠٠١٢٣٤٥٦٧٠٠٠٠٨٩')).toBe('001234567000089');
  });
  it('retire espaces, tirets et caractères non numériques, borne à 15', () => {
    expect(normalizeIceInput(' 001 234-567 000 089 ')).toBe('001234567000089');
    expect(normalizeIceInput('0012345670000891234')).toBe('001234567000089');
    expect(normalizeIceInput('abc')).toBe('');
  });
  it('n’applique aucune clé modulo 97 : un ICE de forme valide mais de clé arbitraire passe le contrôle client', () => {
    expect(isIceShapeValid('123456789012345')).toBe(true);
  });
});
