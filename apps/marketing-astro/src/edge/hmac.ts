/** HMAC-SHA256 en WebCrypto pur (AGENTS.md loi 5), comparaison à temps constant. Aucune dépendance, aucun secret en dur. */

const encoder = new TextEncoder();
const HEX = /^[0-9a-fA-F]*$/;

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hexadécimal strict : `null` si la longueur est impaire ou si un caractère n'est pas hexadécimal (jamais de NaN silencieux). */
export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !HEX.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Comparaison sans sortie anticipée : la durée ne dépend que de la plus longue des deux entrées. */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function timingSafeEqualText(a: string, b: string): boolean {
  return timingSafeEqualBytes(encoder.encode(a), encoder.encode(b));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return bytesToHex(await hmacSha256(secret, message));
}

/** Vrai si `providedHex` est la signature HMAC-SHA256 de `message`. Tout hexadécimal invalide est refusé. */
export async function verifyHmacHex(secret: string, message: string, providedHex: string): Promise<boolean> {
  const expected = await hmacSha256(secret, message);
  const provided = hexToBytes(providedHex);
  if (provided === null) {
    timingSafeEqualBytes(expected, expected);
    return false;
  }
  return timingSafeEqualBytes(expected, provided);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlEncodeText(text: string): string {
  return base64UrlEncode(encoder.encode(text));
}

/** `null` si l'entrée n'est pas du base64url valide. */
export function base64UrlDecodeToText(text: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
