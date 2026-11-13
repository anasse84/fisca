import { fromBase64Url, toBase64Url } from './e2ee-encoding.ts';
import { E2eeError } from './e2ee-errors.ts';
import { hpkeKemParameters, hpkeOpenBase, hpkeSealBase } from './hpke-rfc9180.ts';
import type { HpkeKem } from './hpke-rfc9180.ts';

export type { HpkeKem } from './hpke-rfc9180.ts';

/** Version du format d'enveloppe HPKE transporté (en-tête X-Fisca-HPKE-Dek, Doc_07 § 01 ; Doc_10 § 03). */
export const HPKE_ENVELOPE_VERSION = 'hpke1';
export const DEFAULT_HPKE_KEM: HpkeKem = 'DHKEM_X25519_HKDF_SHA256';

const KEM_LABELS: Readonly<Record<HpkeKem, string>> = {
  DHKEM_X25519_HKDF_SHA256: 'x25519',
  DHKEM_P256_HKDF_SHA256: 'p256',
};
const TEXT_ENCODER = new TextEncoder();
const EMPTY = new Uint8Array(0);

/** Contexte lié à l'enveloppe : société et finalité entrent dans `info` HPKE (RFC 9180 § 5). */
export interface HpkeSecretContext {
  readonly companyId: string;
  readonly purpose: string;
}

function assertComponent(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.includes('|')) {
    throw new E2eeError('INVALID_INPUT');
  }
}

function buildInfo(context: HpkeSecretContext): Uint8Array<ArrayBuffer> {
  assertComponent(context.companyId);
  assertComponent(context.purpose);
  const encoded = TEXT_ENCODER.encode(`fisca-hpke-v1|${context.companyId}|${context.purpose}`);
  const out = new Uint8Array(encoded.length);
  out.set(encoded);
  return out;
}

function kemFromLabel(label: string): HpkeKem {
  for (const kem of Object.keys(KEM_LABELS) as HpkeKem[]) {
    if (KEM_LABELS[kem] === label) return kem;
  }
  throw new E2eeError('INVALID_FORMAT');
}

/**
 * Scelle un secret (ex. Tenant_DEK) à destination de la clé publique d'une enclave éphémère.
 * Retourne `hpke1:<kem>:<enc base64url>:<ciphertext base64url>`.
 */
export async function sealSecretForEnclave(args: {
  readonly kem?: HpkeKem;
  readonly recipientPublicKeyRaw: Uint8Array;
  readonly secret: Uint8Array;
  readonly companyId: string;
  readonly purpose: string;
}): Promise<string> {
  const kem = args.kem ?? DEFAULT_HPKE_KEM;
  if (args.secret.length === 0) {
    throw new E2eeError('INVALID_INPUT');
  }
  const info = buildInfo(args);
  try {
    const sealed = await hpkeSealBase({
      kem,
      recipientPublicKeyRaw: args.recipientPublicKeyRaw,
      info,
      aad: EMPTY,
      plaintext: args.secret,
    });
    return `${HPKE_ENVELOPE_VERSION}:${KEM_LABELS[kem]}:${toBase64Url(sealed.enc)}:${toBase64Url(sealed.ciphertext)}`;
  } catch (error) {
    if (error instanceof E2eeError) throw error;
    throw new E2eeError('ENCRYPTION_FAILED');
  }
}

/**
 * Enclave RAM : la clé privée HPKE est générée non extractible, tenue dans un champ privé, jamais sérialisée
 * ni journalisée ; `destroy()` abandonne la référence (une CryptoKey non extractible n'expose pas ses octets).
 */
export interface HpkeEnclave {
  readonly kem: HpkeKem;
  readonly publicKeyRaw: Uint8Array;
  readonly destroyed: boolean;
  readonly privateKeyExtractable: boolean;
  openSecret(envelope: string, context: HpkeSecretContext): Promise<Uint8Array>;
  withOpenedSecret<T>(
    envelope: string,
    context: HpkeSecretContext,
    use: (secret: Uint8Array) => T | Promise<T>,
  ): Promise<T>;
  destroy(): void;
}

class RamHpkeEnclave implements HpkeEnclave {
  readonly kem: HpkeKem;
  #privateKey: CryptoKey | null;
  readonly #publicKeyRaw: Uint8Array<ArrayBuffer>;

  constructor(kem: HpkeKem, privateKey: CryptoKey, publicKeyRaw: Uint8Array<ArrayBuffer>) {
    this.kem = kem;
    this.#privateKey = privateKey;
    this.#publicKeyRaw = publicKeyRaw;
  }

  get publicKeyRaw(): Uint8Array {
    const copy = new Uint8Array(this.#publicKeyRaw.length);
    copy.set(this.#publicKeyRaw);
    return copy;
  }

  get destroyed(): boolean {
    return this.#privateKey === null;
  }

  get privateKeyExtractable(): boolean {
    return this.#privateKey?.extractable ?? false;
  }

  async openSecret(envelope: string, context: HpkeSecretContext): Promise<Uint8Array> {
    const privateKey = this.#privateKey;
    if (privateKey === null) {
      throw new E2eeError('ENCLAVE_DESTROYED');
    }
    const info = buildInfo(context);
    const parts = envelope.split(':');
    const [version, kemLabel, encPart, ciphertextPart] = parts;
    if (parts.length !== 4 || version === undefined || kemLabel === undefined || encPart === undefined || ciphertextPart === undefined) {
      throw new E2eeError('INVALID_FORMAT');
    }
    if (version !== HPKE_ENVELOPE_VERSION) {
      throw new E2eeError(/^hpke[0-9]+$/.test(version) ? 'UNSUPPORTED_VERSION' : 'INVALID_FORMAT');
    }
    if (kemFromLabel(kemLabel) !== this.kem) {
      throw new E2eeError('INVALID_FORMAT');
    }
    const enc = fromBase64Url(encPart);
    const ciphertext = fromBase64Url(ciphertextPart);
    if (enc.length !== hpkeKemParameters(this.kem).publicKeyBytes) {
      throw new E2eeError('INVALID_FORMAT');
    }
    return hpkeOpenBase({
      kem: this.kem,
      recipientPrivateKey: privateKey,
      recipientPublicKeyRaw: this.#publicKeyRaw,
      enc,
      info,
      aad: EMPTY,
      ciphertext,
    });
  }

  async withOpenedSecret<T>(
    envelope: string,
    context: HpkeSecretContext,
    use: (secret: Uint8Array) => T | Promise<T>,
  ): Promise<T> {
    const secret = await this.openSecret(envelope, context);
    try {
      return await use(secret);
    } finally {
      secret.fill(0);
    }
  }

  destroy(): void {
    this.#privateKey = null;
    this.#publicKeyRaw.fill(0);
  }
}

/** Crée une enclave éphémère (clé fournie par WebCrypto, jamais lue ailleurs). */
export async function createHpkeEnclave(options?: { readonly kem?: HpkeKem }): Promise<HpkeEnclave> {
  const kem = options?.kem ?? DEFAULT_HPKE_KEM;
  const algorithm = kem === 'DHKEM_X25519_HKDF_SHA256' ? { name: 'X25519' } : { name: 'ECDH', namedCurve: 'P-256' };
  let pair: CryptoKeyPair;
  try {
    pair = (await crypto.subtle.generateKey(algorithm, false, ['deriveBits'])) as CryptoKeyPair;
  } catch {
    throw new E2eeError('INVALID_KEY');
  }
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return new RamHpkeEnclave(kem, pair.privateKey, publicKeyRaw);
}
