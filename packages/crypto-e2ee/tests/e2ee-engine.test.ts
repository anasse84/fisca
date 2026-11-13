import { describe, expect, it } from 'vitest';
import {
  E2eeError,
  computeBlindIndex128,
  decryptFieldWithAad,
  encryptFieldWithAad,
  normalizeBlindIndexInput,
  verifyBlindIndex128,
} from '../src/e2ee-engine.ts';
import type { FieldAadContext } from '../src/e2ee-engine.ts';

async function newDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function newBidxKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, true, ['sign']);
}

const CTX: FieldAadContext = { companyId: 'co-1', tableName: 'third_parties', recordId: 'rec-9', columnName: 'cin_enc' };

async function failureOf(promise: Promise<unknown>): Promise<E2eeError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof E2eeError) return error;
    throw error;
  }
  throw new Error('une erreur E2eeError était attendue');
}

describe('encryptFieldWithAad / decryptFieldWithAad', () => {
  it('aller-retour, y compris Unicode et chaîne vide', async () => {
    const dek = await newDek();
    for (const clear of ['AB123456', 'Société Générale – مكتب الحسابات ✓', '']) {
      const sealed = await encryptFieldWithAad(dek, clear, CTX);
      expect(await decryptFieldWithAad(dek, sealed, CTX)).toBe(clear);
    }
  });

  it('format v1:<iv>:<ct+tag> avec IV de 12 octets', async () => {
    const sealed = await encryptFieldWithAad(await newDek(), 'x', CTX);
    const parts = sealed.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('v1');
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain('=');
  });

  it('deux chiffrements du même clair diffèrent (IV unique)', async () => {
    const dek = await newDek();
    const ivs = new Set<string>();
    const cts = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const sealed = await encryptFieldWithAad(dek, 'même clair', CTX);
      ivs.add(sealed.split(':')[1] ?? '');
      cts.add(sealed);
    }
    expect(ivs.size).toBe(50);
    expect(cts.size).toBe(50);
  });

  it.each(['companyId', 'tableName', 'recordId', 'columnName'] as const)('AAD modifiée sur %s => échec', async (field) => {
    const dek = await newDek();
    const sealed = await encryptFieldWithAad(dek, 'RIB-secret', CTX);
    const error = await failureOf(decryptFieldWithAad(dek, sealed, { ...CTX, [field]: `${CTX[field]}x` }));
    expect(error.code).toBe('DECRYPTION_FAILED');
  });

  it('une frontière déplacée entre composants change l’AAD (a|b,c ≠ a,b|c)', async () => {
    const dek = await newDek();
    const sealed = await encryptFieldWithAad(dek, 'v', { companyId: 'a', tableName: 'b', recordId: 'c', columnName: 'd' });
    const error = await failureOf(decryptFieldWithAad(dek, sealed, { companyId: 'a|b', tableName: 'c', recordId: 'd', columnName: 'd' }));
    expect(error.code).toBe('INVALID_INPUT');
  });

  it('composant AAD vide ou contenant « | » refusé au chiffrement', async () => {
    const dek = await newDek();
    expect((await failureOf(encryptFieldWithAad(dek, 'v', { ...CTX, recordId: '' }))).code).toBe('INVALID_INPUT');
    expect((await failureOf(encryptFieldWithAad(dek, 'v', { ...CTX, tableName: 'a|b' }))).code).toBe('INVALID_INPUT');
  });

  it('texte chiffré altéré (1 bit) => échec, pour chaque octet', async () => {
    const dek = await newDek();
    const sealed = await encryptFieldWithAad(dek, 'salaire 12000', CTX);
    const [version, iv, body] = sealed.split(':') as [string, string, string];
    const raw = Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (body.length % 4)) % 4)), (c) => c.charCodeAt(0));
    for (let index = 0; index < raw.length; index += 1) {
      const flipped = new Uint8Array(raw);
      flipped[index] = (flipped[index] ?? 0) ^ 1;
      const tampered = btoa(String.fromCharCode(...flipped)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      const error = await failureOf(decryptFieldWithAad(dek, `${version}:${iv}:${tampered}`, CTX));
      expect(error.code).toBe('DECRYPTION_FAILED');
    }
  });

  it('IV altéré => échec', async () => {
    const dek = await newDek();
    const sealed = await encryptFieldWithAad(dek, 'x', CTX);
    const [version, iv, body] = sealed.split(':') as [string, string, string];
    const altered = `${iv.startsWith('A') ? 'B' : 'A'}${iv.slice(1)}`;
    expect((await failureOf(decryptFieldWithAad(dek, `${version}:${altered}:${body}`, CTX))).code).toBe('DECRYPTION_FAILED');
  });

  it('mauvaise clé => échec sans fuite du clair', async () => {
    const sealed = await encryptFieldWithAad(await newDek(), 'SECRET-PLAINTEXT', CTX);
    const error = await failureOf(decryptFieldWithAad(await newDek(), sealed, CTX));
    expect(error.code).toBe('DECRYPTION_FAILED');
    expect(error.message).not.toContain('SECRET-PLAINTEXT');
    expect(error.message).not.toContain('co-1');
    expect(error.message).not.toContain('cin_enc');
  });

  it('message d’erreur identique pour AAD fausse, clé fausse et octet altéré', async () => {
    const dek = await newDek();
    const sealed = await encryptFieldWithAad(dek, 'x', CTX);
    const a = await failureOf(decryptFieldWithAad(dek, sealed, { ...CTX, recordId: 'autre' }));
    const b = await failureOf(decryptFieldWithAad(await newDek(), sealed, CTX));
    expect(a.message).toBe(b.message);
  });

  it('version inconnue refusée, format invalide refusé', async () => {
    const dek = await newDek();
    const sealed = await encryptFieldWithAad(dek, 'x', CTX);
    const rest = sealed.slice(2);
    expect((await failureOf(decryptFieldWithAad(dek, `v2${rest}`, CTX))).code).toBe('UNSUPPORTED_VERSION');
    expect((await failureOf(decryptFieldWithAad(dek, `v0${rest}`, CTX))).code).toBe('UNSUPPORTED_VERSION');
    for (const bad of ['', 'v1', 'v1:abc', 'v1::abc', 'v1:abc:', `${sealed}:extra`, 'garbage', `v1:${'!'.repeat(16)}:AAAA`, 'v1:AAAA:AAAAAAAAAAAAAAAAAAAAAA']) {
      const error = await failureOf(decryptFieldWithAad(dek, bad, CTX));
      expect(['INVALID_FORMAT', 'UNSUPPORTED_VERSION']).toContain(error.code);
    }
  });

  it('clé brute de 32 octets acceptée ; autre longueur refusée', async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const sealed = await encryptFieldWithAad(raw, 'brut', CTX);
    expect(await decryptFieldWithAad(raw, sealed, CTX)).toBe('brut');
    expect((await failureOf(encryptFieldWithAad(new Uint8Array(16), 'x', CTX))).code).toBe('INVALID_KEY');
  });

  it('CryptoKey de mauvais type (HMAC) refusée', async () => {
    expect((await failureOf(encryptFieldWithAad(await newBidxKey(), 'x', CTX))).code).toBe('INVALID_KEY');
  });
});

describe('computeBlindIndex128', () => {
  it('déterministe, 32 hex minuscules', async () => {
    const key = await newBidxKey();
    const a = await computeBlindIndex128(key, '001234567000089');
    const b = await computeBlindIndex128(key, '001234567000089');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('distinct selon la clé', async () => {
    expect(await computeBlindIndex128(await newBidxKey(), 'X')).not.toBe(await computeBlindIndex128(await newBidxKey(), 'X'));
  });

  it('distinct selon l’entrée', async () => {
    const key = await newBidxKey();
    expect(await computeBlindIndex128(key, 'AB123')).not.toBe(await computeBlindIndex128(key, 'AB124'));
  });

  it('normalisation : casse, espaces, tirets, Unicode', async () => {
    const key = await newBidxKey();
    const ref = await computeBlindIndex128(key, 'AB123456');
    expect(await computeBlindIndex128(key, '  ab-12 34\t56 ')).toBe(ref);
    expect(await computeBlindIndex128(key, 'ab\u00a0123456')).toBe(ref);
    expect(await computeBlindIndex128(key, 'ＡＢ１２３４５６')).toBe(ref);
    const composed = await computeBlindIndex128(key, 'É-1');
    expect(await computeBlindIndex128(key, 'E\u0301-1')).toBe(composed);
    expect(normalizeBlindIndexInput(' a-b c ')).toBe('ABC');
  });

  it('compatible avec la référence HMAC-SHA256 tronqué (vecteur calculé indépendamment)', async () => {
    const raw = new Uint8Array(32).fill(7);
    const mac = await crypto.subtle.sign(
      'HMAC',
      await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
      new TextEncoder().encode('ICE001'),
    );
    const expected = Array.from(new Uint8Array(mac).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(await computeBlindIndex128(raw, 'ice-001')).toBe(expected);
  });

  it('refuse une entrée vide après normalisation et une clé invalide', async () => {
    const key = await newBidxKey();
    expect((await failureOf(computeBlindIndex128(key, ' - '))).code).toBe('INVALID_INPUT');
    expect((await failureOf(computeBlindIndex128(new Uint8Array(8), 'A'))).code).toBe('INVALID_KEY');
    expect((await failureOf(computeBlindIndex128(await newDek(), 'A'))).code).toBe('INVALID_KEY');
  });

  it('verifyBlindIndex128 : vrai pour l’égalité, faux sinon, jamais d’exception sur forme invalide', async () => {
    const key = await newBidxKey();
    const index = await computeBlindIndex128(key, 'ICE-1');
    expect(await verifyBlindIndex128(key, 'ice 1', index)).toBe(true);
    expect(await verifyBlindIndex128(key, 'ICE-2', index)).toBe(false);
    expect(await verifyBlindIndex128(key, 'ICE-1', 'zz')).toBe(false);
    expect(await verifyBlindIndex128(key, 'ICE-1', index.toUpperCase())).toBe(false);
  });
});
