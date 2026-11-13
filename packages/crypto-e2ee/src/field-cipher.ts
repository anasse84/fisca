import { fromBase64Url, toBase64Url } from './e2ee-encoding.ts';
import { E2eeError } from './e2ee-errors.ts';
import { resolveAesGcmKey } from './e2ee-keys.ts';
import type { E2eeKeyMaterial } from './e2ee-keys.ts';
import { buildCanonicalAadBytes } from './field-aad.ts';
import type { FieldAadContext } from './field-aad.ts';

export const FIELD_FORMAT_VERSION = 'v1';
export const GCM_IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;
const VERSION_PATTERN = /^v[0-9]+$/;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Chiffrement authentifié par cellule AES-256-GCM, AAD = companyId|tableName|recordId|columnName.
 * Sortie : `v1:<iv_b64url>:<ciphertext_and_tag_b64url>`, IV de 12 octets aléatoire neuf à chaque appel.
 */
export async function encryptFieldWithAad(
  dek: E2eeKeyMaterial,
  plaintext: string,
  aadCtx: FieldAadContext,
): Promise<string> {
  if (typeof plaintext !== 'string') {
    throw new E2eeError('INVALID_INPUT');
  }
  const aad = buildCanonicalAadBytes(aadCtx);
  const key = await resolveAesGcmKey(dek);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  try {
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: GCM_TAG_BYTES * 8 },
      key,
      TEXT_ENCODER.encode(plaintext),
    );
    return `${FIELD_FORMAT_VERSION}:${toBase64Url(iv)}:${toBase64Url(new Uint8Array(sealed))}`;
  } catch {
    throw new E2eeError('ENCRYPTION_FAILED');
  }
}

/**
 * Déchiffrement : tout échec d'authentification (clé, AAD, IV ou octet altéré) lève le même
 * E2eeError('DECRYPTION_FAILED'), sans clair ni contexte dans le message.
 */
export async function decryptFieldWithAad(
  dek: E2eeKeyMaterial,
  serializedCiphertext: string,
  aadCtx: FieldAadContext,
): Promise<string> {
  if (typeof serializedCiphertext !== 'string') {
    throw new E2eeError('INVALID_FORMAT');
  }
  const parts = serializedCiphertext.split(':');
  const version = parts[0] ?? '';
  if (!VERSION_PATTERN.test(version)) {
    throw new E2eeError('INVALID_FORMAT');
  }
  if (version !== FIELD_FORMAT_VERSION) {
    throw new E2eeError('UNSUPPORTED_VERSION');
  }
  const ivPart = parts[1];
  const bodyPart = parts[2];
  if (parts.length !== 3 || !ivPart || !bodyPart) {
    throw new E2eeError('INVALID_FORMAT');
  }
  const iv = fromBase64Url(ivPart);
  const cipherBytes = fromBase64Url(bodyPart);
  if (iv.length !== GCM_IV_BYTES || cipherBytes.length < GCM_TAG_BYTES) {
    throw new E2eeError('INVALID_FORMAT');
  }
  const aad = buildCanonicalAadBytes(aadCtx);
  const key = await resolveAesGcmKey(dek);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: GCM_TAG_BYTES * 8 },
      key,
      cipherBytes,
    );
    return TEXT_DECODER.decode(plain);
  } catch {
    throw new E2eeError('DECRYPTION_FAILED');
  }
}
