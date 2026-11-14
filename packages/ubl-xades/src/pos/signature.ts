/**
 * Vérification de la signature ECDSA P-256 / SHA-256 d'un ticket POS (Doc_10 § 08 : paire WebCrypto non extractible du terminal).
 *
 * FORMAT ET OBJET SIGNÉ : Doc_10 § 08 et la skill fisca-pos-offline-sce ne précisent NI le format de la signature NI l'octet signé.
 * Hypothèses du dépôt (à confirmer avec apps/pos-pwa) :
 * - objet signé : les octets UTF-8 des 64 caractères hexadécimaux minuscules de `ticket_sha256` (jamais le JSON du ticket) ;
 *   WebCrypto applique SHA-256 à ce message dans `crypto.subtle.sign/verify` ;
 * - format : r‖s brut de 64 octets (sortie native de `crypto.subtle.sign`), encodé en base64 standard (colonne `ecdsa_signature_b64`) ;
 *   une signature DER est convertie explicitement (mêmes règles strictes que `normalizeCscSignature` du client CSC, réécrites ici : importer
 *   `signature/csc-client.ts` ferait entrer `signature/bytes.ts` dans le typage de apps/api-hono) ; tout autre
 *   format est refusé (échec fermé : POS_SIGNATURE_FORMAT_UNKNOWN).
 * La clé publique vient du certificat ou de la licence du terminal, fournie par un port : jamais du lot reçu.
 */
import { PosError } from './errors.ts';

export interface PosEcPublicJwk {
  readonly kty: 'EC';
  readonly crv: 'P-256';
  readonly x: string;
  readonly y: string;
}

export type PosTerminalPublicKey = { readonly kind: 'jwk'; readonly jwk: PosEcPublicJwk } | { readonly kind: 'spki'; readonly spkiBase64: string };

export interface VerifyPosTicketSignatureInput {
  readonly publicKey: PosTerminalPublicKey;
  /** `ticket_sha256` : 64 hexadécimaux minuscules. */
  readonly ticketHash: string;
  /** Base64 standard de r‖s (64 octets) ou d'une signature DER. */
  readonly signature: string;
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_SIGNATURE_BYTES = 128;

type Bytes = Uint8Array<ArrayBuffer>;

function decodeBase64(value: string, error: () => PosError): Bytes {
  if (value.length === 0 || value.length > 4 * MAX_SIGNATURE_BYTES || !BASE64.test(value)) throw error();
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

/** Entier DER strict d'une signature ECDSA : positif, minimal, non nul, au plus 32 octets significatifs ; rendu sur 32 octets. */
function derIntegerTo32(raw: Uint8Array): Uint8Array {
  const first = raw[0] ?? 0;
  if (raw.length === 0 || first >= 0x80 || (first === 0 && raw.length > 1 && (raw[1] ?? 0) < 0x80)) throw new Error('der');
  const trimmed = first === 0 && raw.length > 1 ? raw.subarray(1) : raw;
  if (trimmed.length > 32 || trimmed.every((byte) => byte === 0)) throw new Error('der');
  const out = new Uint8Array(32);
  out.set(trimmed, 32 - trimmed.length);
  return out;
}

/** Longueur DER courte uniquement (< 128 octets suffit pour 2 × 33 octets + en-têtes) ; toute autre forme est refusée. */
function readDerLength(bytes: Uint8Array, offset: number): { readonly length: number; readonly next: number } {
  const first = bytes[offset];
  if (first === undefined || first >= 0x80) throw new Error('der');
  return { length: first, next: offset + 1 };
}

/** r‖s de 64 octets : déjà brut (r et s non nuls), ou DER `SEQUENCE { INTEGER r, INTEGER s }` strict ; sinon refus. */
function toRawSignature(raw: Bytes): Bytes {
  if (raw.length === 64) {
    if (raw.subarray(0, 32).every((byte) => byte === 0) || raw.subarray(32).every((byte) => byte === 0)) throw new Error('der');
    return raw;
  }
  if (raw[0] !== 0x30) throw new Error('der');
  const sequence = readDerLength(raw, 1);
  if (sequence.next + sequence.length !== raw.length) throw new Error('der');
  const out = new Uint8Array(64);
  let offset = sequence.next;
  for (const slot of [0, 32]) {
    if (raw[offset] !== 0x02) throw new Error('der');
    const integer = readDerLength(raw, offset + 1);
    const end = integer.next + integer.length;
    if (end > raw.length) throw new Error('der');
    out.set(derIntegerTo32(raw.subarray(integer.next, end)), slot);
    offset = end;
  }
  if (offset !== raw.length) throw new Error('der');
  return out;
}

export async function importPosTerminalKey(key: PosTerminalPublicKey): Promise<Awaited<ReturnType<typeof crypto.subtle.importKey>>> {
  const params = { name: 'ECDSA', namedCurve: 'P-256' } as const;
  const invalid = (): PosError => new PosError('POS_TERMINAL_KEY_INVALID');
  try {
    if (key.kind === 'jwk') {
      if (key.jwk.kty !== 'EC' || key.jwk.crv !== 'P-256') throw invalid();
      return await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: key.jwk.x, y: key.jwk.y }, params, false, ['verify']);
    }
    return await crypto.subtle.importKey('spki', decodeBase64(key.spkiBase64, invalid), params, false, ['verify']);
  } catch (error) {
    throw error instanceof PosError ? error : invalid();
  }
}

/**
 * `true` : signature valide ; `false` : signature bien formée mais invalide (ticket modifié, autre terminal).
 * Lève POS_SIGNATURE_FORMAT_UNKNOWN (format inconnu) ou POS_TERMINAL_KEY_INVALID (clé du terminal inutilisable).
 */
export async function verifyPosTicketSignature(input: VerifyPosTicketSignatureInput): Promise<boolean> {
  if (!HEX64.test(input.ticketHash)) throw new PosError('POS_FIELDS_INVALID', [{ path: 'ticketHash', code: 'invalid' }]);
  const formatError = (): PosError => new PosError('POS_SIGNATURE_FORMAT_UNKNOWN');
  const raw = decodeBase64(input.signature, formatError);
  let rs: Bytes;
  try {
    rs = toRawSignature(raw);
  } catch {
    throw formatError();
  }
  const key = await importPosTerminalKey(input.publicKey);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, rs, new TextEncoder().encode(input.ticketHash));
}
