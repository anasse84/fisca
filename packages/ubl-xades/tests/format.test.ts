import { describe, expect, it } from 'vitest';
import { formatCentsDecimal, formatMilliQuantity, formatVatPercent } from '../src/index.ts';

describe('formats décimaux par arithmétique entière', () => {
  it.each([
    [0n, '0.00'],
    [5n, '0.05'],
    [100n, '1.00'],
    [123456n, '1234.56'],
    [-7n, '-0.07'],
    [-250000n, '-2500.00'],
    [9007199254740993n, '90071992547409.93'],
  ])('centimes %s → %s', (value, expected) => {
    expect(formatCentsDecimal(value)).toBe(expected);
  });

  it.each([
    [1000n, '1'],
    [2500n, '2.5'],
    [333n, '0.333'],
    [10050n, '10.05'],
    [1n, '0.001'],
  ])('milli-unités %s → %s', (value, expected) => {
    expect(formatMilliQuantity(value)).toBe(expected);
  });

  it('formate les taux D-04 en pourcentage entier et refuse les autres', () => {
    expect(formatVatPercent(2000)).toBe('20');
    expect(formatVatPercent(1000)).toBe('10');
    expect(formatVatPercent(0)).toBe('0');
    expect(() => formatVatPercent(700)).toThrow();
  });
});
