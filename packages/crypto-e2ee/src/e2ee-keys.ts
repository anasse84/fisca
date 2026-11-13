import { E2eeError } from './e2ee-errors.ts';

/** Clé fournie par l'appelant : CryptoKey ou octets bruts. Ce module ne lit jamais l'environnement. */
export type E2eeKeyMaterial = CryptoKey | Uint8Array;

export const AES_KEY_BYTES = 32;
export const HMAC_KEY_MIN_BYTES = 32;

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

/** Clé AES-256-GCM (encrypt + decrypt). Refuse toute autre longueur ou algorithme avec INVALID_KEY. */
export async function resolveAesGcmKey(key: E2eeKeyMaterial): Promise<CryptoKey> {
  if (key instanceof Uint8Array) {
    if (key.length !== AES_KEY_BYTES) {
      throw new E2eeError('INVALID_KEY');
    }
    try {
      return await crypto.subtle.importKey('raw', copyBytes(key), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    } catch {
      throw new E2eeError('INVALID_KEY');
    }
  }
  const algorithm = key.algorithm as Partial<AesKeyAlgorithm>;
  if (algorithm.name !== 'AES-GCM' || algorithm.length !== 256) {
    throw new E2eeError('INVALID_KEY');
  }
  return key;
}

/** Clé HMAC-SHA256 (sign). Les octets bruts doivent compter au moins 32 octets. */
export async function resolveHmacSha256Key(key: E2eeKeyMaterial): Promise<CryptoKey> {
  if (key instanceof Uint8Array) {
    if (key.length < HMAC_KEY_MIN_BYTES) {
      throw new E2eeError('INVALID_KEY');
    }
    try {
      return await crypto.subtle.importKey('raw', copyBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    } catch {
      throw new E2eeError('INVALID_KEY');
    }
  }
  const algorithm = key.algorithm as Partial<HmacKeyAlgorithm>;
  const hashName = typeof algorithm.hash === 'object' ? algorithm.hash.name : undefined;
  if (algorithm.name !== 'HMAC' || hashName !== 'SHA-256') {
    throw new E2eeError('INVALID_KEY');
  }
  return key;
}
