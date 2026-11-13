/**
 * Décodeur CBOR minimal et strict (RFC 8949), limité à ce que WebAuthn emploie : entiers, chaînes d'octets,
 * chaînes de texte, tableaux, tables et booléens/null. Refuse les longueurs indéfinies, les étiquettes, les flottants,
 * les entiers hors de la plage sûre, les clés dupliquées et les imbrications profondes. Interne au paquet.
 */

export type CborValue =
  | number
  | string
  | boolean
  | null
  | Uint8Array<ArrayBuffer>
  | readonly CborValue[]
  | ReadonlyMap<number | string, CborValue>;

export class CborError extends Error {
  constructor(message: string) {
    super(`CBOR_INVALID: ${message}`);
    this.name = 'CborError';
  }
}

const MAX_DEPTH = 8;

interface Cursor {
  readonly bytes: Uint8Array<ArrayBuffer>;
  offset: number;
}

function take(cursor: Cursor, length: number): Uint8Array<ArrayBuffer> {
  if (length < 0 || cursor.offset + length > cursor.bytes.length) {
    throw new CborError('données tronquées.');
  }
  const slice = cursor.bytes.slice(cursor.offset, cursor.offset + length);
  cursor.offset += length;
  return slice;
}

function readArgument(cursor: Cursor, additional: number): number {
  if (additional < 24) {
    return additional;
  }
  const size = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : additional === 27 ? 8 : 0;
  if (size === 0) {
    throw new CborError('longueur indéfinie ou réservée refusée.');
  }
  const raw = take(cursor, size);
  const view = new DataView(raw.buffer);
  if (size === 1) {
    return view.getUint8(0);
  }
  if (size === 2) {
    return view.getUint16(0, false);
  }
  if (size === 4) {
    return view.getUint32(0, false);
  }
  const high = view.getUint32(0, false);
  const low = view.getUint32(4, false);
  if (high > 0x1fffff) {
    throw new CborError('entier hors de la plage sûre.');
  }
  return high * 0x100000000 + low;
}

function decodeItem(cursor: Cursor, depth: number): CborValue {
  if (depth > MAX_DEPTH) {
    throw new CborError('imbrication trop profonde.');
  }
  const initial = take(cursor, 1)[0] ?? 0;
  const major = initial >> 5;
  const additional = initial & 0x1f;
  if (major === 7) {
    if (additional === 20) {
      return false;
    }
    if (additional === 21) {
      return true;
    }
    if (additional === 22) {
      return null;
    }
    throw new CborError('valeur simple ou flottant non pris en charge.');
  }
  if (major === 6) {
    throw new CborError('étiquette non prise en charge.');
  }
  const argument = readArgument(cursor, additional);
  switch (major) {
    case 0:
      return argument;
    case 1:
      return -1 - argument;
    case 2:
      return take(cursor, argument);
    case 3:
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(take(cursor, argument));
      } catch {
        throw new CborError('texte UTF-8 invalide.');
      }
    case 4: {
      if (argument > cursor.bytes.length - cursor.offset) {
        throw new CborError('tableau plus long que les données.');
      }
      const items: CborValue[] = [];
      for (let index = 0; index < argument; index += 1) {
        items.push(decodeItem(cursor, depth + 1));
      }
      return items;
    }
    default: {
      if (argument > cursor.bytes.length - cursor.offset) {
        throw new CborError('table plus longue que les données.');
      }
      const entries = new Map<number | string, CborValue>();
      for (let index = 0; index < argument; index += 1) {
        const key = decodeItem(cursor, depth + 1);
        if (typeof key !== 'number' && typeof key !== 'string') {
          throw new CborError('clé de table non prise en charge.');
        }
        if (entries.has(key)) {
          throw new CborError('clé de table dupliquée.');
        }
        entries.set(key, decodeItem(cursor, depth + 1));
      }
      return entries;
    }
  }
}

/** Décode un élément CBOR à partir de `offset` ; renvoie la valeur et le nombre d'octets consommés. */
export function decodeCbor(bytes: Uint8Array<ArrayBuffer>, offset = 0): { readonly value: CborValue; readonly length: number } {
  const cursor: Cursor = { bytes, offset };
  const value = decodeItem(cursor, 0);
  return { value, length: cursor.offset - offset };
}
