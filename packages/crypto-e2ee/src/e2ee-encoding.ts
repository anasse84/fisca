import { E2eeError } from './e2ee-errors.ts';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const HEX_DIGITS = '0123456789abcdef';

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Base64url strict sans remplissage ; toute entrée invalide lève INVALID_FORMAT. */
export function fromBase64Url(input: string): Uint8Array<ArrayBuffer> {
  if (!BASE64URL_PATTERN.test(input) || input.length % 4 === 1) {
    throw new E2eeError('INVALID_FORMAT');
  }
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      out[index] = binary.charCodeAt(index);
    }
    return out;
  } catch {
    throw new E2eeError('INVALID_FORMAT');
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += HEX_DIGITS.charAt(byte >> 4) + HEX_DIGITS.charAt(byte & 0x0f);
  }
  return out;
}

/** Comparaison en temps constant (la longueur seule est publique). */
export function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}
