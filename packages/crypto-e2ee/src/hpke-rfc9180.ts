import { toBase64Url } from './e2ee-encoding.ts';
import { E2eeError } from './e2ee-errors.ts';

/**
 * HPKE RFC 9180, mode Base (0x00), implémenté sur les seules primitives WebCrypto (ECDH, HMAC, AES-GCM).
 * Suites : KEM DHKEM(X25519, HKDF-SHA256) 0x0020 ou DHKEM(P-256, HKDF-SHA256) 0x0010 ; KDF HKDF-SHA256 0x0001 ;
 * AEAD AES-128-GCM 0x0001. Validé contre les vecteurs officiels de l'annexe A (A.1 et A.3).
 */
export type HpkeKem = 'DHKEM_X25519_HKDF_SHA256' | 'DHKEM_P256_HKDF_SHA256';

interface KemParameters {
  readonly id: number;
  readonly publicKeyBytes: number;
  readonly privateKeyBytes: number;
}

const KEM_PARAMETERS: Readonly<Record<HpkeKem, KemParameters>> = {
  DHKEM_X25519_HKDF_SHA256: { id: 0x0020, publicKeyBytes: 32, privateKeyBytes: 32 },
  DHKEM_P256_HKDF_SHA256: { id: 0x0010, publicKeyBytes: 65, privateKeyBytes: 32 },
};

const KDF_ID = 0x0001;
const AEAD_ID = 0x0001;
const HASH_BYTES = 32;
const AEAD_KEY_BYTES = 16;
const AEAD_NONCE_BYTES = 12;
const MODE_BASE = 0x00;
const TEXT_ENCODER = new TextEncoder();
const VERSION_LABEL = TEXT_ENCODER.encode('HPKE-v1');

type Bytes = Uint8Array<ArrayBuffer>;

export interface HpkeEphemeralKeyPair {
  readonly publicKeyRaw: Uint8Array;
  readonly privateKeyRaw: Uint8Array;
}

export interface HpkeBaseSchedule {
  readonly enc: Bytes;
  readonly sharedSecret: Bytes;
  readonly key: Bytes;
  readonly baseNonce: Bytes;
  readonly exporterSecret: Bytes;
}

export function hpkeKemParameters(kem: HpkeKem): Readonly<KemParameters> {
  return KEM_PARAMETERS[kem];
}

function concat(...parts: readonly Uint8Array[]): Bytes {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function copy(bytes: Uint8Array): Bytes {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

function i2osp(value: number, length: number): Bytes {
  const out = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    out[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return out;
}

function kemSuiteId(kem: HpkeKem): Bytes {
  return concat(TEXT_ENCODER.encode('KEM'), i2osp(KEM_PARAMETERS[kem].id, 2));
}

function hpkeSuiteId(kem: HpkeKem): Bytes {
  return concat(TEXT_ENCODER.encode('HPKE'), i2osp(KEM_PARAMETERS[kem].id, 2), i2osp(KDF_ID, 2), i2osp(AEAD_ID, 2));
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Bytes> {
  const material = key.length === 0 ? new Uint8Array(HASH_BYTES) : copy(key);
  const imported = await crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, copy(data)));
}

async function labeledExtract(suiteId: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array): Promise<Bytes> {
  return hmacSha256(salt, concat(VERSION_LABEL, suiteId, TEXT_ENCODER.encode(label), ikm));
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Bytes> {
  const out = new Uint8Array(length);
  let previous: Bytes = new Uint8Array(0);
  let written = 0;
  for (let counter = 1; written < length; counter += 1) {
    previous = await hmacSha256(prk, concat(previous, info, Uint8Array.of(counter)));
    const take = Math.min(previous.length, length - written);
    out.set(previous.subarray(0, take), written);
    written += take;
  }
  return out;
}

async function labeledExpand(
  suiteId: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
): Promise<Bytes> {
  return hkdfExpand(prk, concat(i2osp(length, 2), VERSION_LABEL, suiteId, TEXT_ENCODER.encode(label), info), length);
}

function ecdhAlgorithm(kem: HpkeKem): { name: 'X25519' } | { name: 'ECDH'; namedCurve: 'P-256' } {
  return kem === 'DHKEM_X25519_HKDF_SHA256' ? { name: 'X25519' } : { name: 'ECDH', namedCurve: 'P-256' };
}

async function importPublicKeyRaw(kem: HpkeKem, raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== KEM_PARAMETERS[kem].publicKeyBytes) {
    throw new E2eeError('INVALID_KEY');
  }
  try {
    return await crypto.subtle.importKey('raw', copy(raw), ecdhAlgorithm(kem), true, []);
  } catch {
    throw new E2eeError('INVALID_KEY');
  }
}

/** Import d'une clé privée brute (vecteurs de test uniquement : la production utilise des clés non extractibles). */
export async function importRecipientPrivateKeyRaw(
  kem: HpkeKem,
  privateKeyRaw: Uint8Array,
  publicKeyRaw: Uint8Array,
): Promise<CryptoKey> {
  const parameters = KEM_PARAMETERS[kem];
  if (privateKeyRaw.length !== parameters.privateKeyBytes || publicKeyRaw.length !== parameters.publicKeyBytes) {
    throw new E2eeError('INVALID_KEY');
  }
  const jwk: JsonWebKey =
    kem === 'DHKEM_X25519_HKDF_SHA256'
      ? { kty: 'OKP', crv: 'X25519', d: toBase64Url(privateKeyRaw), x: toBase64Url(publicKeyRaw) }
      : {
          kty: 'EC',
          crv: 'P-256',
          d: toBase64Url(privateKeyRaw),
          x: toBase64Url(publicKeyRaw.subarray(1, 33)),
          y: toBase64Url(publicKeyRaw.subarray(33, 65)),
        };
  try {
    return await crypto.subtle.importKey('jwk', jwk, ecdhAlgorithm(kem), false, ['deriveBits']);
  } catch {
    throw new E2eeError('INVALID_KEY');
  }
}

async function diffieHellman(kem: HpkeKem, privateKey: CryptoKey, publicKey: CryptoKey): Promise<Bytes> {
  let shared: Bytes;
  try {
    shared = new Uint8Array(await crypto.subtle.deriveBits({ name: ecdhAlgorithm(kem).name, public: publicKey }, privateKey, 256));
  } catch {
    throw new E2eeError('DECRYPTION_FAILED');
  }
  if (shared.every((byte) => byte === 0)) {
    throw new E2eeError('DECRYPTION_FAILED');
  }
  return shared;
}

async function extractAndExpand(kem: HpkeKem, dh: Uint8Array, kemContext: Uint8Array): Promise<Bytes> {
  const suiteId = kemSuiteId(kem);
  const prk = await labeledExtract(suiteId, new Uint8Array(0), 'eae_prk', dh);
  return labeledExpand(suiteId, prk, 'shared_secret', kemContext, HASH_BYTES);
}

async function keySchedule(
  kem: HpkeKem,
  sharedSecret: Uint8Array,
  info: Uint8Array,
): Promise<Pick<HpkeBaseSchedule, 'key' | 'baseNonce' | 'exporterSecret'>> {
  const suiteId = hpkeSuiteId(kem);
  const empty = new Uint8Array(0);
  const pskIdHash = await labeledExtract(suiteId, empty, 'psk_id_hash', empty);
  const infoHash = await labeledExtract(suiteId, empty, 'info_hash', info);
  const context = concat(Uint8Array.of(MODE_BASE), pskIdHash, infoHash);
  const secret = await labeledExtract(suiteId, sharedSecret, 'secret', empty);
  return {
    key: await labeledExpand(suiteId, secret, 'key', context, AEAD_KEY_BYTES),
    baseNonce: await labeledExpand(suiteId, secret, 'base_nonce', context, AEAD_NONCE_BYTES),
    exporterSecret: await labeledExpand(suiteId, secret, 'exp', context, HASH_BYTES),
  };
}

async function generateEphemeral(kem: HpkeKem): Promise<{ privateKey: CryptoKey; publicKeyRaw: Bytes }> {
  const pair = (await crypto.subtle.generateKey(ecdhAlgorithm(kem), false, ['deriveBits'])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKeyRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

/** Encap + KeySchedule (mode Base). `ephemeral` ne sert qu'à rejouer les vecteurs officiels. */
export async function hpkeBaseSchedule(args: {
  readonly kem: HpkeKem;
  readonly recipientPublicKeyRaw: Uint8Array;
  readonly info: Uint8Array;
  readonly ephemeral?: HpkeEphemeralKeyPair;
}): Promise<HpkeBaseSchedule> {
  const { kem, recipientPublicKeyRaw, info, ephemeral } = args;
  const recipientKey = await importPublicKeyRaw(kem, recipientPublicKeyRaw);
  const generated =
    ephemeral === undefined
      ? await generateEphemeral(kem)
      : {
          privateKey: await importRecipientPrivateKeyRaw(kem, ephemeral.privateKeyRaw, ephemeral.publicKeyRaw),
          publicKeyRaw: copy(ephemeral.publicKeyRaw),
        };
  const dh = await diffieHellman(kem, generated.privateKey, recipientKey);
  const sharedSecret = await extractAndExpand(kem, dh, concat(generated.publicKeyRaw, recipientPublicKeyRaw));
  dh.fill(0);
  return { enc: generated.publicKeyRaw, sharedSecret, ...(await keySchedule(kem, sharedSecret, info)) };
}

export function computeNonce(baseNonce: Uint8Array, sequenceNumber: bigint): Bytes {
  const nonce = copy(baseNonce);
  let remaining = sequenceNumber;
  for (let index = nonce.length - 1; index >= 0 && remaining > 0n; index -= 1) {
    nonce[index] = (nonce[index] ?? 0) ^ Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return nonce;
}

async function aesKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', copy(key), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function aeadSeal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Promise<Bytes> {
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: copy(nonce), additionalData: copy(aad), tagLength: 128 }, await aesKey(key), copy(plaintext)),
  );
}

export async function aeadOpen(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Promise<Bytes> {
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: copy(nonce), additionalData: copy(aad), tagLength: 128 }, await aesKey(key), copy(ciphertext)),
    );
  } catch {
    throw new E2eeError('DECRYPTION_FAILED');
  }
}

/** HPKE Export(exporter_context, L) (RFC 9180 § 5.3). */
export async function hpkeExport(
  kem: HpkeKem,
  exporterSecret: Uint8Array,
  exporterContext: Uint8Array,
  length: number,
): Promise<Bytes> {
  return labeledExpand(hpkeSuiteId(kem), exporterSecret, 'sec', exporterContext, length);
}

/** SealBase (RFC 9180 § 6.1), séquence 0. */
export async function hpkeSealBase(args: {
  readonly kem: HpkeKem;
  readonly recipientPublicKeyRaw: Uint8Array;
  readonly info: Uint8Array;
  readonly aad: Uint8Array;
  readonly plaintext: Uint8Array;
  readonly ephemeral?: HpkeEphemeralKeyPair;
}): Promise<{ readonly enc: Bytes; readonly ciphertext: Bytes }> {
  const schedule = await hpkeBaseSchedule({
    kem: args.kem,
    recipientPublicKeyRaw: args.recipientPublicKeyRaw,
    info: args.info,
    ...(args.ephemeral === undefined ? {} : { ephemeral: args.ephemeral }),
  });
  try {
    const ciphertext = await aeadSeal(schedule.key, computeNonce(schedule.baseNonce, 0n), args.aad, args.plaintext);
    return { enc: schedule.enc, ciphertext };
  } finally {
    schedule.sharedSecret.fill(0);
    schedule.key.fill(0);
    schedule.baseNonce.fill(0);
    schedule.exporterSecret.fill(0);
  }
}

/** OpenBase (RFC 9180 § 6.1), séquence 0. */
export async function hpkeOpenBase(args: {
  readonly kem: HpkeKem;
  readonly recipientPrivateKey: CryptoKey;
  readonly recipientPublicKeyRaw: Uint8Array;
  readonly enc: Uint8Array;
  readonly info: Uint8Array;
  readonly aad: Uint8Array;
  readonly ciphertext: Uint8Array;
}): Promise<Bytes> {
  const { kem } = args;
  let senderKey: CryptoKey;
  try {
    senderKey = await importPublicKeyRaw(kem, args.enc);
  } catch {
    throw new E2eeError('DECRYPTION_FAILED');
  }
  const dh = await diffieHellman(kem, args.recipientPrivateKey, senderKey);
  const sharedSecret = await extractAndExpand(kem, dh, concat(args.enc, args.recipientPublicKeyRaw));
  dh.fill(0);
  const schedule = await keySchedule(kem, sharedSecret, args.info);
  try {
    return await aeadOpen(schedule.key, computeNonce(schedule.baseNonce, 0n), args.aad, args.ciphertext);
  } finally {
    sharedSecret.fill(0);
    schedule.key.fill(0);
    schedule.baseNonce.fill(0);
    schedule.exporterSecret.fill(0);
  }
}
