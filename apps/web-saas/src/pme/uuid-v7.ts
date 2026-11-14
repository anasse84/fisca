/**
 * Idempotency-Key = UUIDv7 produit par le client (Doc_07 § 01 ; l'API refuse tout autre format).
 * Horloge et source aléatoire injectables pour les tests ; aucune valeur monétaire ici.
 */
export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RANDOM_BYTES = 10;
const HEX_RADIX = 16;
const NIBBLE_MASK = 0x0f;
const VERSION_7 = 0x70;
const VARIANT_MASK = 0x3f;
const VARIANT_RFC = 0x80;

const hex = (byte: number): string => byte.toString(HEX_RADIX).padStart(2, '0');

/** Construit un UUIDv7 : 48 bits d'horloge (ms), version 7, variante RFC 9562, 74 bits aléatoires. */
export function uuidV7(nowMs: number, random: Uint8Array): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('UUID_V7_CLOCK_INVALID');
  }
  if (random.length < RANDOM_BYTES) {
    throw new Error('UUID_V7_RANDOM_TOO_SHORT');
  }
  const stamp = BigInt(nowMs).toString(HEX_RADIX).padStart(12, '0').slice(-12);
  const r = Array.from(random.slice(0, RANDOM_BYTES));
  const b6 = VERSION_7 | ((r[0] ?? 0) & NIBBLE_MASK);
  const b8 = VARIANT_RFC | ((r[2] ?? 0) & VARIANT_MASK);
  const tail = [b8, r[3] ?? 0, r[4] ?? 0, r[5] ?? 0, r[6] ?? 0, r[7] ?? 0, r[8] ?? 0, r[9] ?? 0].map(hex).join('');
  return `${stamp.slice(0, 8)}-${stamp.slice(8, 12)}-${hex(b6)}${hex(r[1] ?? 0)}-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

export type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array;

const webCryptoFill: RandomFill = (bytes) => crypto.getRandomValues(bytes);

/** Nouvelle clé d'idempotence (une par intention utilisateur ; réutilisée telle quelle pour une reprise). */
export function newIdempotencyKey(now: () => number = Date.now, fill: RandomFill = webCryptoFill): string {
  const bytes = new Uint8Array(new ArrayBuffer(RANDOM_BYTES));
  fill(bytes);
  return uuidV7(now(), bytes);
}
