/** Utilitaires d'encodage internes (base64url strict, octets aléatoires, SHA-256). Pas d'export public du paquet. */

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Décode du base64url sans remplissage ; renvoie null si l'entrée n'est pas du base64url valide. */
export function decodeBase64Url(input: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL_PATTERN.test(input) || input.length % 4 === 1) {
    return null;
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
    return null;
  }
}

export type RandomSource = (length: number) => Uint8Array;

export const secureRandomBytes: RandomSource = (length) => crypto.getRandomValues(new Uint8Array(length));

export async function sha256Bytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
