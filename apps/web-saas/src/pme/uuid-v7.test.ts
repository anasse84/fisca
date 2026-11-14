import { describe, expect, it } from 'vitest';
import { UUID_V7_PATTERN, newIdempotencyKey, uuidV7 } from './uuid-v7.ts';

describe('Idempotency-Key : UUIDv7 produit par le client', () => {
  const fixedRandom = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  it('respecte le motif UUIDv7 (version 7, variante RFC 9562)', () => {
    expect(uuidV7(1_700_000_000_123, fixedRandom)).toMatch(UUID_V7_PATTERN);
  });
  it('encode l’horloge sur 48 bits en tête, en hexadécimal', () => {
    const ms = 1_700_000_000_123;
    const id = uuidV7(ms, fixedRandom).replaceAll('-', '');
    expect(BigInt(`0x${id.slice(0, 12)}`)).toBe(BigInt(ms));
  });
  it('deux clés produites à des instants croissants se trient dans l’ordre', () => {
    const a = uuidV7(1_700_000_000_000, fixedRandom);
    const b = uuidV7(1_700_000_000_001, fixedRandom);
    expect(a < b).toBe(true);
  });
  it('refuse une graine trop courte ou une horloge invalide', () => {
    expect(() => uuidV7(1, new Uint8Array(3))).toThrow(/UUID_V7/);
    expect(() => uuidV7(-1, fixedRandom)).toThrow(/UUID_V7/);
    expect(() => uuidV7(1.5, fixedRandom)).toThrow(/UUID_V7/);
  });
  it('newIdempotencyKey : horloge et source aléatoire injectables, deux clés distinctes', () => {
    let n = 0;
    const rng = (bytes: Uint8Array): Uint8Array => {
      bytes.fill((n += 1));
      return bytes;
    };
    const a = newIdempotencyKey(() => 1_700_000_000_000, rng);
    const b = newIdempotencyKey(() => 1_700_000_000_000, rng);
    expect(a).toMatch(UUID_V7_PATTERN);
    expect(a).not.toBe(b);
  });
  it('la clé par défaut (WebCrypto) est un UUIDv7 valide', () => {
    expect(newIdempotencyKey()).toMatch(UUID_V7_PATTERN);
  });
});
