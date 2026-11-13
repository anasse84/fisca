import { describe, expect, it } from 'vitest';
import { FiscaIntegerError, divRoundHalfUpBigInt } from '../src/index.ts';

describe('divRoundHalfUpBigInt (demi supérieur : le demi va vers +∞, comme Math.round)', () => {
  const table: ReadonlyArray<readonly [bigint, bigint, bigint]> = [
    [10n, 4n, 3n], // 2,5 → 3
    [9n, 4n, 2n], // 2,25 → 2
    [11n, 4n, 3n], // 2,75 → 3
    [8n, 4n, 2n],
    [0n, 7n, 0n],
    [0n, -7n, 0n],
    [1n, 2n, 1n], // 0,5 → 1
    [-1n, 2n, 0n], // -0,5 → 0
    [-3n, 2n, -1n], // -1,5 → -1
    [-5n, 2n, -2n], // -2,5 → -2
    [-7n, 4n, -2n], // -1,75 → -2
    [-9n, 4n, -2n], // -2,25 → -2
    [-10n, 4n, -2n], // -2,5 → -2
    [5n, -2n, -2n], // -2,5 → -2
    [-5n, -2n, 3n], // 2,5 → 3
    [7n, -4n, -2n], // -1,75 → -2
    [3n, 1n, 3n],
    [-3n, 1n, -3n],
  ];

  for (const [num, den, expected] of table) {
    it(`${num} / ${den} = ${expected}`, () => {
      expect(divRoundHalfUpBigInt(num, den)).toBe(expected);
    });
  }

  it('lève DIVISION_BY_ZERO pour un diviseur nul', () => {
    expect(() => divRoundHalfUpBigInt(1n, 0n)).toThrowError(FiscaIntegerError);
    try {
      divRoundHalfUpBigInt(0n, 0n);
    } catch (error) {
      expect(error).toBeInstanceOf(FiscaIntegerError);
      expect((error as FiscaIntegerError).code).toBe('DIVISION_BY_ZERO');
    }
  });

  it('reste exact pour de très grands opérandes', () => {
    const num = 10n ** 30n + 5n;
    expect(divRoundHalfUpBigInt(num, 10n)).toBe(10n ** 29n + 1n);
  });
});
