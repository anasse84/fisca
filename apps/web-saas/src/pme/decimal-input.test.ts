import { describe, expect, it } from 'vitest';
import { formatBps, formatScaledDecimal, parseScaledDecimal } from './decimal-input.ts';

describe('parseScaledDecimal : saisie décimale → entier mis à l’échelle, sans flottant', () => {
  it('quantité en milli-unités (échelle 3)', () => {
    expect(parseScaledDecimal('2', 3)).toBe(2000n);
    expect(parseScaledDecimal('2,5', 3)).toBe(2500n);
    expect(parseScaledDecimal('0.001', 3)).toBe(1n);
    expect(parseScaledDecimal('1 234,567', 3)).toBe(1234567n);
  });
  it('prix en centimes (échelle 2)', () => {
    expect(parseScaledDecimal('1234,50', 2)).toBe(123450n);
    expect(parseScaledDecimal('0,1', 2)).toBe(10n);
    expect(parseScaledDecimal('19.99', 2)).toBe(1999n);
  });
  it('chiffres arabo-indiens acceptés', () => {
    expect(parseScaledDecimal('١٢٫٥', 2)).toBe(1250n);
    expect(parseScaledDecimal('٣', 0)).toBe(3n);
  });
  it('refuse trop de décimales, signes, texte, vide, séparateurs multiples', () => {
    for (const bad of ['', ' ', '1,234', '-1', '+1', 'abc', '1,2,3', '1e3', ',', '.5.']) {
      expect(parseScaledDecimal(bad, 2), bad).toBeNull();
    }
  });
  it('accepte « ,5 » et « 5, » comme 0,5 et 5', () => {
    expect(parseScaledDecimal(',5', 2)).toBe(50n);
    expect(parseScaledDecimal('5,', 2)).toBe(500n);
  });
  it('grand entier exact (au-delà de 2^53)', () => {
    expect(parseScaledDecimal('90071992547409930', 0)).toBe(90071992547409930n);
  });
});

describe('formatScaledDecimal et formatBps (affichage)', () => {
  it('formate sans zéros inutiles', () => {
    expect(formatScaledDecimal(2500n, 3)).toBe('2,5');
    expect(formatScaledDecimal(2000n, 3)).toBe('2');
    expect(formatScaledDecimal(1n, 3)).toBe('0,001');
  });
  it('taux en bps : 2000 → 20 %, 1050 → 10,5 %, 0 → 0 %', () => {
    expect(formatBps(2000)).toBe('20 %');
    expect(formatBps(1050)).toBe('10,5 %');
    expect(formatBps(0)).toBe('0 %');
    expect(formatBps(1005)).toBe('10,05 %');
  });
});
