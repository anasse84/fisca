import { compareBytes, concatBytes } from './bytes.ts';
import { UblSignatureError } from './errors.ts';

/** DER minimal : encodage et lecture stricte (longueurs définies seulement), suffisant pour RFC 3161, CMS, X.509 (lecture) et ESS. */

export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  PRINTABLE_STRING: 0x13,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const;

function encodeLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export function tlv(tag: number, ...content: readonly Uint8Array[]): Uint8Array {
  const body = concatBytes(...content);
  return concatBytes(Uint8Array.of(tag), encodeLength(body.length), body);
}

export const sequence = (...items: readonly Uint8Array[]): Uint8Array => tlv(TAG.SEQUENCE, ...items);
/** SET OF : éléments triés par encodage (X.690 § 11.6). */
export const setOf = (...items: readonly Uint8Array[]): Uint8Array => tlv(TAG.SET, ...[...items].sort(compareBytes));
export const octetString = (value: Uint8Array): Uint8Array => tlv(TAG.OCTET_STRING, value);
export const derNull = (): Uint8Array => tlv(TAG.NULL);
export const derBoolean = (value: boolean): Uint8Array => tlv(TAG.BOOLEAN, Uint8Array.of(value ? 0xff : 0x00));
export const utf8String = (value: string): Uint8Array => tlv(TAG.UTF8_STRING, new TextEncoder().encode(value));
export const printableString = (value: string): Uint8Array => tlv(TAG.PRINTABLE_STRING, new TextEncoder().encode(value));
/** [n] EXPLICIT (constructed, classe contexte). */
export const explicit = (number: number, ...content: readonly Uint8Array[]): Uint8Array => tlv(0xa0 | number, ...content);
/** [n] IMPLICIT constructed (SEQUENCE/SET remplacé). */
export const implicitConstructed = explicit;

export function bitString(content: Uint8Array): Uint8Array {
  return tlv(TAG.BIT_STRING, Uint8Array.of(0), content);
}

export function oid(dotted: string): Uint8Array {
  const arcs = dotted.split('.').map((part) => BigInt(part));
  const first = arcs[0];
  const second = arcs[1];
  if (first === undefined || second === undefined) throw new RangeError('OID invalide');
  const values = [first * 40n + second, ...arcs.slice(2)];
  const body: number[] = [];
  for (const value of values) {
    const groups: number[] = [Number(value & 0x7fn)];
    let rest = value >> 7n;
    while (rest > 0n) {
      groups.unshift(Number(rest & 0x7fn) | 0x80);
      rest >>= 7n;
    }
    body.push(...groups);
  }
  return tlv(TAG.OID, Uint8Array.from(body));
}

/** INTEGER non négatif depuis un bigint. */
export function integerFromBigInt(value: bigint): Uint8Array {
  if (value < 0n) throw new RangeError('entier négatif non géré');
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const raw = Uint8Array.from(hex.match(/../g) ?? ['00'], (pair) => Number.parseInt(pair, 16));
  return integerFromUnsignedBytes(raw);
}

/** INTEGER non négatif depuis des octets big-endian (zéros de tête retirés, 0x00 ajouté si le bit de poids fort est posé). */
export function integerFromUnsignedBytes(raw: Uint8Array): Uint8Array {
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0) start += 1;
  const trimmed = raw.subarray(start);
  const needsPad = (trimmed[0] ?? 0) >= 0x80;
  return tlv(TAG.INTEGER, needsPad ? Uint8Array.of(0) : new Uint8Array(0), trimmed.length === 0 ? Uint8Array.of(0) : trimmed);
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

export function utcTime(date: Date): Uint8Array {
  const text = `${pad2(date.getUTCFullYear() % 100)}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
  return tlv(TAG.UTC_TIME, new TextEncoder().encode(text));
}

export function generalizedTime(date: Date): Uint8Array {
  const text = `${date.getUTCFullYear().toString().padStart(4, '0')}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
  return tlv(TAG.GENERALIZED_TIME, new TextEncoder().encode(text));
}

/** Nœud DER lu. `raw` est l'encodage complet (en-tête compris) ; `content` le contenu. */
export interface DerNode {
  readonly tag: number;
  readonly raw: Uint8Array;
  readonly content: Uint8Array;
}

function malformed(): UblSignatureError {
  return new UblSignatureError('DER_MALFORMED', 'Structure DER invalide ou non supportée (longueur indéfinie, troncature ou tag étendu).');
}

/** Lit un TLV à `offset` ; retourne le nœud et l'offset suivant. */
export function readNode(bytes: Uint8Array, offset = 0): { readonly node: DerNode; readonly next: number } {
  const tag = bytes[offset];
  const first = bytes[offset + 1];
  if (tag === undefined || first === undefined || (tag & 0x1f) === 0x1f) throw malformed();
  let length = first;
  let headerLength = 2;
  if (first >= 0x80) {
    const count = first & 0x7f;
    if (count === 0 || count > 4) throw malformed();
    length = 0;
    for (let index = 0; index < count; index += 1) {
      const byte = bytes[offset + 2 + index];
      if (byte === undefined) throw malformed();
      length = length * 256 + byte;
    }
    headerLength = 2 + count;
  }
  const end = offset + headerLength + length;
  if (end > bytes.length) throw malformed();
  return {
    node: { tag, raw: bytes.subarray(offset, end), content: bytes.subarray(offset + headerLength, end) },
    next: end,
  };
}

/** Enfants d'un nœud constructed. */
export function children(node: DerNode): DerNode[] {
  const out: DerNode[] = [];
  let offset = 0;
  while (offset < node.content.length) {
    const { node: child, next } = readNode(node.content, offset);
    out.push(child);
    offset = next;
  }
  return out;
}

export function parseDer(bytes: Uint8Array): DerNode {
  const { node, next } = readNode(bytes, 0);
  if (next !== bytes.length) throw malformed();
  return node;
}

export function expectTag(node: DerNode | undefined, tag: number): DerNode {
  if (node === undefined || node.tag !== tag) throw malformed();
  return node;
}

export function decodeOid(node: DerNode): string {
  expectTag(node, TAG.OID);
  const content = node.content;
  if (content.length === 0) throw malformed();
  const arcs: bigint[] = [];
  let value = 0n;
  for (const byte of content) {
    value = (value << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) {
      arcs.push(value);
      value = 0n;
    }
  }
  const head = arcs[0] ?? 0n;
  const firstArc = head < 80n ? head / 40n : 2n;
  const secondArc = head < 80n ? head % 40n : head - 80n;
  return [firstArc, secondArc, ...arcs.slice(1)].map(String).join('.');
}

export function decodeInteger(node: DerNode): bigint {
  expectTag(node, TAG.INTEGER);
  let value = 0n;
  for (const byte of node.content) value = (value << 8n) | BigInt(byte);
  return value;
}

/** GeneralizedTime (AAAAMMJJhhmmssZ, fraction ignorée) ou UTCTime → Date. */
export function decodeTime(node: DerNode): Date {
  const text = new TextDecoder().decode(node.content);
  const match =
    node.tag === TAG.GENERALIZED_TIME
      ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z$/.exec(text)
      : node.tag === TAG.UTC_TIME
        ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
        : null;
  if (match === null) throw malformed();
  let year = Number(match[1]);
  if (node.tag === TAG.UTC_TIME) year += year >= 50 ? 1900 : 2000;
  return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])));
}

/** Signature ECDSA IEEE P1363 (r || s) → Ecdsa-Sig-Value DER (CMS). */
export function ecdsaP1363ToDer(signature: Uint8Array): Uint8Array {
  if (signature.length === 0 || signature.length % 2 !== 0) {
    throw new UblSignatureError('SIGNER_RESULT_INVALID', 'Signature ECDSA : format r||s attendu.');
  }
  const half = signature.length / 2;
  return sequence(integerFromUnsignedBytes(signature.subarray(0, half)), integerFromUnsignedBytes(signature.subarray(half)));
}

/** Ecdsa-Sig-Value DER → r || s de `size` octets chacun. */
export function ecdsaDerToP1363(der: Uint8Array, size: number): Uint8Array {
  const parts = children(expectTag(parseDer(der), TAG.SEQUENCE));
  const out = new Uint8Array(size * 2);
  for (const [index, part] of [parts[0], parts[1]].entries()) {
    const integer = expectTag(part, TAG.INTEGER).content;
    const trimmed = integer[0] === 0 ? integer.subarray(1) : integer;
    if (trimmed.length > size) throw malformed();
    out.set(trimmed, index * size + size - trimmed.length);
  }
  return out;
}
