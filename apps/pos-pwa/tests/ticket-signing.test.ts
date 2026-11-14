import { describe, expect, it } from 'vitest';
import {
  createMemorySigningKeyStore,
  exportPublicKeySpkiB64,
  generateSigningKeyPair,
  importPublicKeySpkiB64,
  loadOrCreateSigningKeyPair,
  signTicketHash,
  verifyTicketSignature,
} from '../src/ticketing/ticket-signing.ts';

const HASH = 'ab'.repeat(32);

describe('signature ECDSA P-256 non extractible', () => {
  it('la paire est P-256, la clé privée est non extractable et exportKey échoue (pkcs8 et jwk)', async () => {
    const pair = await generateSigningKeyPair();
    expect(pair.privateKey.extractable).toBe(false);
    expect((pair.privateKey.algorithm as EcKeyAlgorithm).namedCurve).toBe('P-256');
    expect(pair.privateKey.usages).toEqual(['sign']);
    await expect(crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('jwk', pair.privateKey)).rejects.toThrow();
  });

  it('la clé publique s’exporte pour l’enrôlement (SPKI base64) et se réimporte', async () => {
    const pair = await generateSigningKeyPair();
    const spki = await exportPublicKeySpkiB64(pair);
    expect(spki).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const imported = await importPublicKeySpkiB64(spki);
    expect(imported.usages).toEqual(['verify']);
  });

  it('signe le hachage du ticket et vérifie ; un autre hachage, une autre clé ou une signature altérée échouent', async () => {
    const pair = await generateSigningKeyPair();
    const other = await generateSigningKeyPair();
    const signature = await signTicketHash(pair.privateKey, HASH);
    expect(await verifyTicketSignature(pair.publicKey, HASH, signature)).toBe(true);
    expect(await verifyTicketSignature(pair.publicKey, 'cd'.repeat(32), signature)).toBe(false);
    expect(await verifyTicketSignature(other.publicKey, HASH, signature)).toBe(false);
    const tampered = (signature.startsWith('A') ? 'B' : 'A') + signature.slice(1);
    expect(await verifyTicketSignature(pair.publicKey, HASH, tampered)).toBe(false);
  });

  it('refuse de signer autre chose qu’un hachage de 64 hexadécimaux minuscules', async () => {
    const pair = await generateSigningKeyPair();
    await expect(signTicketHash(pair.privateKey, 'pas-un-hash')).rejects.toThrow(/64 hexadécimaux/);
  });

  it('loadOrCreate : crée une fois, réutilise ensuite (la CryptoKey est stockée, jamais un JWK)', async () => {
    const store = createMemorySigningKeyStore();
    const first = await loadOrCreateSigningKeyPair(store);
    const second = await loadOrCreateSigningKeyPair(store);
    expect(second.privateKey).toBe(first.privateKey);
    expect(second.privateKey.extractable).toBe(false);
  });

  it('un magasin qui rendrait une clé privée extractable est refusé', async () => {
    const extractable = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const store = createMemorySigningKeyStore();
    await store.save(extractable);
    await expect(loadOrCreateSigningKeyPair(store)).rejects.toThrow(/extractable/);
  });
});
