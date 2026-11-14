import { describe, expect, it } from 'vitest';
import { formatCentimesMad } from '../src/format-centimes.ts';

describe('formatCentimesMad', () => {
  it.each([
    [0, '0,00 MAD'],
    [5, '0,05 MAD'],
    [100, '1,00 MAD'],
    [123456, '1 234,56 MAD'],
    [99999999, '999 999,99 MAD'],
    [-5, '-0,05 MAD'],
    [-123456, '-1 234,56 MAD'],
  ])('formate %i en « %s »', (input, expected) => {
    expect(formatCentimesMad(input)).toBe(expected);
  });

  it('accepte un bigint, y compris au-delà de Number.MAX_SAFE_INTEGER', () => {
    expect(formatCentimesMad(123456n)).toBe('1 234,56 MAD');
    expect(formatCentimesMad(-123456n)).toBe('-1 234,56 MAD');
    expect(formatCentimesMad(0n)).toBe('0,00 MAD');
    expect(formatCentimesMad(900719925474099312345n)).toBe('9 007 199 254 740 993 123,45 MAD');
    expect(formatCentimesMad(-900719925474099312345n)).toBe('-9 007 199 254 740 993 123,45 MAD');
  });

  it('accepte une autre devise', () => {
    expect(formatCentimesMad(150, 'EUR')).toBe('1,50 EUR');
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])('rejette le nombre non entier sûr %s', (input) => {
    expect(() => formatCentimesMad(input)).toThrow(/UI_FLOAT_FORBIDDEN/);
  });

  it('ne produit jamais « -0,00 »', () => {
    expect(formatCentimesMad(-0)).toBe('0,00 MAD');
  });
});
