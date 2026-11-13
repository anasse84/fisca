import { bytesToHex, constantTimeEqualBytes } from './e2ee-encoding.ts';
import { E2eeError } from './e2ee-errors.ts';
import { resolveHmacSha256Key } from './e2ee-keys.ts';
import type { E2eeKeyMaterial } from './e2ee-keys.ts';

export const BLIND_INDEX_BYTES = 16;
export const BLIND_INDEX_HEX_LENGTH = BLIND_INDEX_BYTES * 2;
const BLIND_INDEX_HEX_PATTERN = /^[0-9a-f]{32}$/;
const TEXT_ENCODER = new TextEncoder();

/**
 * Normalisation déterministe (Doc_10 § 04) : majuscules, suppression des espaces et des tirets.
 * Ajout de sûreté : NFKC d'abord, pour que des graphies Unicode équivalentes donnent le même index.
 */
export function normalizeBlindIndexInput(rawIdentifier: string): string {
  return rawIdentifier.normalize('NFKC').toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Index aveugle HMAC-SHA256(Tenant_BIDX_Key, normalisé) tronqué à 128 bits, en 32 caractères hexadécimaux
 * minuscules. La clé BIDX est distincte de la clé de chiffrement ; l'appelant la fournit.
 * La spec ne prévoit pas de séparation de domaine par colonne : l'isolation vient de la clé par société.
 */
export async function computeBlindIndex128(
  bidxHmacKey: E2eeKeyMaterial,
  rawIdentifier: string,
): Promise<string> {
  if (typeof rawIdentifier !== 'string') {
    throw new E2eeError('INVALID_INPUT');
  }
  const canonical = normalizeBlindIndexInput(rawIdentifier);
  if (canonical.length === 0) {
    throw new E2eeError('INVALID_INPUT');
  }
  const key = await resolveHmacSha256Key(bidxHmacKey);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, TEXT_ENCODER.encode(canonical)));
  return bytesToHex(mac.slice(0, BLIND_INDEX_BYTES));
}

/** Compare un index stocké à celui d'un identifiant en temps constant ; false (sans exception) si la forme est invalide. */
export async function verifyBlindIndex128(
  bidxHmacKey: E2eeKeyMaterial,
  rawIdentifier: string,
  storedIndexHex: string,
): Promise<boolean> {
  if (typeof storedIndexHex !== 'string' || !BLIND_INDEX_HEX_PATTERN.test(storedIndexHex)) {
    return false;
  }
  const computed = await computeBlindIndex128(bidxHmacKey, rawIdentifier);
  return constantTimeEqualBytes(TEXT_ENCODER.encode(computed), TEXT_ENCODER.encode(storedIndexHex));
}
