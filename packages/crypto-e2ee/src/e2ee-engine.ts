/**
 * CTR-COD-08 « e2ee-engine » (Doc_10 § 03, § 04, § 11 ; ERRATA section C).
 *
 * Point d'entrée unique du moteur E2EE. Ticket T-S1A-06 : chiffrement AES-256-GCM par cellule avec AAD
 * et index aveugle. Les tickets suivants (07 enveloppes RSA-OAEP, 08 Shamir, 09 scrubber PII) ajoutent
 * leurs modules et les réexportent ici.
 */
export { E2eeError } from './e2ee-errors.ts';
export type { E2eeErrorCode } from './e2ee-errors.ts';
export type { E2eeKeyMaterial } from './e2ee-keys.ts';
export { buildCanonicalAadBytes } from './field-aad.ts';
export type { FieldAadContext } from './field-aad.ts';
export { FIELD_FORMAT_VERSION, decryptFieldWithAad, encryptFieldWithAad } from './field-cipher.ts';
export { BLIND_INDEX_HEX_LENGTH, computeBlindIndex128, normalizeBlindIndexInput, verifyBlindIndex128 } from './blind-index.ts';
