/** Fixtures de test : clé Ed25519 générée à la volée (jamais de clé en dur, CTR-SEC-02). */

export async function generateEd25519PrivateJwkJson(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  if (!('privateKey' in pair)) {
    throw new Error('génération Ed25519 impossible');
  }
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return JSON.stringify(jwk);
}

export function encodeSegment(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
