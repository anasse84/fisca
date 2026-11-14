/**
 * Empreinte du ticket POS (ERRATA D-22, étiquette `FISCA_POS_TKT_V1`).
 *
 * Règle unique du propriétaire : SHA-256, en 64 hexadécimaux minuscules, de l'UTF-8 de `JSON.stringify([...])` sans espace
 * (`undefined` → `null`, `-0` → `0`, entiers sûrs seulement). Tuple positionnel, lu dans
 * `apps/api-hono/src/core/ledger-hasher.ts` (lecture seule) :
 * `["FISCA_POS_TKT_V1", terminalId, terminalSeqNumber, issuedAtIso, ticketKind, ht20Cents, vat20Cents, ht10Cents, vat10Cents,
 *   ht0Cents, stampDutyCents, totalTtcCents, prevTicketSha256]`.
 * Amorce de la chaîne POS : 64 zéros (CHECK de 64 hexadécimaux, migration locale v1 ; ERRATA D-22).
 * Les empreintes d'or POS sont recalculées par P2-A : ce module n'en fige aucune.
 */

export const POS_TICKET_LABEL = 'FISCA_POS_TKT_V1' as const;
export const POS_CHAIN_GENESIS = '0'.repeat(64);

const SHA256_HEX = /^[0-9a-f]{64}$/;

export type CanonicalValue = string | number | boolean | null | undefined | readonly CanonicalValue[];

function normalize(value: CanonicalValue): CanonicalValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError(`empreinte : entier sûr exigé (reçu ${String(value)}).`);
    return value === 0 ? 0 : value;
  }
  if (Array.isArray(value)) return (value as readonly CanonicalValue[]).map(normalize);
  return value;
}

/** `JSON.stringify` du tuple normalisé : aucun espace, `undefined` → null, `-0` → 0, entiers sûrs seulement. */
export function canonicalJsonTuple(tuple: readonly CanonicalValue[]): string {
  return JSON.stringify(normalize(tuple));
}

export async function sha256HexOfText(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface TicketHashFields {
  readonly terminalId: string;
  /** Séquence entière du terminal (la partie numérique du numéro `POS-{MAG}-{TERM}-{AAAA}-{séq6}`). */
  readonly terminalSeqNumber: number;
  readonly issuedAtIso: string;
  /** Valeur stockée de `pos_tickets.ticket_kind`. */
  readonly ticketKind: string;
  readonly ht20Cents: number;
  readonly vat20Cents: number;
  readonly ht10Cents: number;
  readonly vat10Cents: number;
  readonly ht0Cents: number;
  readonly stampDutyCents: number;
  readonly totalTtcCents: number;
  readonly prevTicketSha256: string;
}

export function buildTicketTuple(fields: TicketHashFields): readonly CanonicalValue[] {
  return [
    POS_TICKET_LABEL,
    fields.terminalId,
    fields.terminalSeqNumber,
    fields.issuedAtIso,
    fields.ticketKind,
    fields.ht20Cents,
    fields.vat20Cents,
    fields.ht10Cents,
    fields.vat10Cents,
    fields.ht0Cents,
    fields.stampDutyCents,
    fields.totalTtcCents,
    fields.prevTicketSha256,
  ];
}

export async function computeTicketSha256(fields: TicketHashFields): Promise<string> {
  if (!SHA256_HEX.test(fields.prevTicketSha256)) {
    throw new TypeError('empreinte : prevTicketSha256 doit être 64 hexadécimaux minuscules (amorce : 64 zéros).');
  }
  return sha256HexOfText(canonicalJsonTuple(buildTicketTuple(fields)));
}
