/** Utilitaires d'octets compatibles Cloudflare Workers : WebCrypto seulement, aucun module node:*, aucun Buffer. */

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const HEX_LOWER = /^(?:[0-9a-f]{2})*$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export const SHA256_BYTES = 32;

export function utf8Encode(text: string): Uint8Array {
  return TEXT_ENCODER.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes);
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return diff === 0;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Hexadécimal minuscule strict (pas de majuscules, longueur paire). */
export function fromHex(hex: string): Uint8Array {
  if (!HEX_LOWER.test(hex)) throw new RangeError('hexadécimal minuscule invalide');
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
}

export function isSha256Hex(value: string): boolean {
  return value.length === SHA256_BYTES * 2 && HEX_LOWER.test(value);
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(await sha256(data));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !BASE64_PATTERN.test(text)) throw new RangeError('base64 invalide');
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}
