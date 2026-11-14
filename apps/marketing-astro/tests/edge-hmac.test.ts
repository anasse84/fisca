import { describe, expect, it } from 'vitest';
import {
  base64UrlDecodeToText,
  base64UrlEncodeText,
  bytesToHex,
  hexToBytes,
  hmacSha256Hex,
  timingSafeEqualBytes,
  timingSafeEqualText,
  verifyHmacHex,
} from '../src/edge/hmac.ts';

describe('HMAC-SHA256 WebCrypto', () => {
  it('vecteur RFC 4231 (cas 2)', async () => {
    expect(await hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('vérification : bonne signature acceptée, majuscules acceptées, altérations refusées', async () => {
    const good = await hmacSha256Hex('k', 'm');
    expect(await verifyHmacHex('k', 'm', good)).toBe(true);
    expect(await verifyHmacHex('k', 'm', good.toUpperCase())).toBe(true);
    expect(await verifyHmacHex('k', 'm2', good)).toBe(false);
    expect(await verifyHmacHex('k2', 'm', good)).toBe(false);
    expect(await verifyHmacHex('k', 'm', `${good.slice(0, -1)}${good.endsWith('0') ? '1' : '0'}`)).toBe(false);
    expect(await verifyHmacHex('k', 'm', good.slice(0, -2))).toBe(false);
    expect(await verifyHmacHex('k', 'm', `${good}00`)).toBe(false);
    expect(await verifyHmacHex('k', 'm', '')).toBe(false);
  });

  it('hexadécimal strict : un caractère non hexadécimal n’est jamais lu comme un octet nul (défaut du code de référence de Doc_07 S11)', async () => {
    expect(hexToBytes('zz')).toBeNull();
    expect(hexToBytes('abc')).toBeNull();
    expect(hexToBytes('0g')).toBeNull();
    expect(bytesToHex(hexToBytes('00ff10') ?? new Uint8Array())).toBe('00ff10');
    expect(await verifyHmacHex('k', 'm', 'z'.repeat(64))).toBe(false);
  });

  it('comparaison à temps constant : longueurs différentes refusées, contenu comparé en entier', () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
    expect(timingSafeEqualText('abc', 'abc')).toBe(true);
    expect(timingSafeEqualText('abc', 'abd')).toBe(false);
  });

  it('base64url : aller-retour, entrée invalide refusée', () => {
    const text = '{"ice":"001234567000045","é":"ع"}';
    expect(base64UrlDecodeToText(base64UrlEncodeText(text))).toBe(text);
    expect(base64UrlEncodeText(text)).not.toMatch(/[+/=]/);
    expect(base64UrlDecodeToText('a+b')).toBeNull();
    expect(base64UrlDecodeToText('a')).toBeNull();
    expect(base64UrlDecodeToText('//8')).toBeNull();
  });
});
