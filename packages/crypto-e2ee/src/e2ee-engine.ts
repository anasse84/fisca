/**
 * CTR-COD-08 « e2ee-engine » (Doc_10 § 03, § 04, § 11 ; ERRATA section C).
 *
 * Point d'entrée unique du moteur E2EE. Ticket T-S1A-06 : chiffrement AES-256-GCM par cellule avec AAD
 * et index aveugle. Les tickets suivants (07 enveloppes RSA-OAEP et enclave HPKE : key-envelope.ts, hpke-enclave.ts ; 08 Shamir, 09 scrubber PII : pii-scrubber.ts) ajoutent
 * leurs modules et les réexportent ici.
 */
export { E2eeError } from './e2ee-errors.ts';
export type { E2eeErrorCode } from './e2ee-errors.ts';
export type { E2eeKeyMaterial } from './e2ee-keys.ts';
export { buildCanonicalAadBytes } from './field-aad.ts';
export type { FieldAadContext } from './field-aad.ts';
export { FIELD_FORMAT_VERSION, decryptFieldWithAad, encryptFieldWithAad } from './field-cipher.ts';
export { BLIND_INDEX_HEX_LENGTH, computeBlindIndex128, normalizeBlindIndexInput, verifyBlindIndex128 } from './blind-index.ts';
export {
  GRANTEE_ROLES,
  KEY_ENVELOPE_VERSION,
  RSA_OAEP_MODULUS_BITS,
  addActorGrant,
  createMemoryKeyGrantStore,
  generateActorKeyPair,
  generateTenantKeyMaterial,
  grantDekVersion,
  publicKeyFingerprintHex,
  revokeActorGrant,
  unwrapCurrentGrant,
  unwrapKeyGrant,
  wrapKeyMaterialForActor,
} from './key-envelope.ts';
export type {
  ActorIdentity,
  ActorKeyPair,
  GranteeDescriptor,
  GranteeRole,
  KeyGrantRecord,
  KeyGrantStore,
  RevocationResult,
  TenantKeyMaterial,
} from './key-envelope.ts';
export {
  DEFAULT_HPKE_KEM,
  HPKE_ENVELOPE_VERSION,
  createHpkeEnclave,
  sealSecretForEnclave,
} from './hpke-enclave.ts';
export type { HpkeEnclave, HpkeKem, HpkeSecretContext } from './hpke-enclave.ts';
export {
  ESCROW_HOLDER_ROLES,
  SHAMIR_MAX_SECRET_BYTES,
  SHAMIR_SHARE_VERSION,
  gf256Inverse,
  gf256Multiply,
  parseShamirShare,
  reconstructEscrowSecret,
  reconstructSecretShamir2of3,
  sealEscrowSecret,
  serializeShamirShare,
  splitSecretShamir2of3,
} from './shamir-escrow.ts';
export type {
  EscrowHolderAssignment,
  EscrowHolderRole,
  EscrowPresentation,
  SealedEscrowShare,
  ShamirShare,
} from './shamir-escrow.ts';
export { EphemeralRamPiiScrubber } from './pii-scrubber.ts';
export type { PiiScrubContext } from './pii-scrubber.ts';
