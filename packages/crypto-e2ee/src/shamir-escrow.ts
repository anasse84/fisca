/**
 * Séquestre fiscal Art. 211 CGI : partage de secret de Shamir 2-sur-3 sur GF(256)
 * (Doc_10 § 05 et § 11 ; Doc_09 § 10 ; polynôme irréductible AES 0x11b).
 *
 * Le secret est découpé octet par octet : y = secret XOR (pente * x), x ∈ {1, 2, 3}, pente tirée par
 * crypto.getRandomValues. Une part seule est uniforme et ne révèle rien. Aucune part, aucun secret n'est
 * journalisé ni placé dans un message d'erreur (E2eeError porte un message constant par code).
 *
 * L'empreinte de contrôle d'une part (SHA-256 tronquée, sans clé) détecte l'altération accidentelle et le
 * mélange de partages ; elle n'authentifie pas la part face à un adversaire qui recalcule l'empreinte.
 */
import { bytesToHex, constantTimeEqualBytes, fromBase64Url, toBase64Url } from './e2ee-encoding.ts';
import { E2eeError } from './e2ee-errors.ts';

type Bytes = Uint8Array<ArrayBuffer>;
type ShareIndex = 1 | 2 | 3;

export const SHAMIR_SHARE_VERSION = 'shm1' as const;
export const SHAMIR_MAX_SECRET_BYTES = 4096;

const SET_ID_BYTES = 8;
const CHECK_BYTES = 16;
const TEXT_ENCODER = new TextEncoder();

/** Détenteurs prévus par la spec (Doc_09 § 10, Doc_10 § 05) ; l'index de part suit l'ordre. */
export const ESCROW_HOLDER_ROLES = ['MANDATAIRE_OEC', 'HSM_SYNAPTIC', 'TIERS_SEQUESTRE'] as const;
export type EscrowHolderRole = (typeof ESCROW_HOLDER_ROLES)[number];

export interface ShamirShare {
  readonly version: typeof SHAMIR_SHARE_VERSION;
  readonly index: ShareIndex;
  /** Identifiant aléatoire du partage (8 octets, base64url) : relie les parts d'un même partage. */
  readonly setId: string;
  readonly data: string;
  /** Empreinte de contrôle hexadécimale (16 octets). */
  readonly check: string;
}

export interface EscrowHolderAssignment {
  readonly role: EscrowHolderRole;
  readonly holderId: string;
}

export interface SealedEscrowShare {
  readonly holderRole: EscrowHolderRole;
  readonly holderId: string;
  /** Part sérialisée `shm1:<index>:<setId>:<data>:<check>`. */
  readonly share: string;
}

export interface EscrowPresentation {
  readonly holderRole: EscrowHolderRole;
  readonly holderId: string;
  readonly share: string | ShamirShare;
}

/** Code d'erreur typé (E2eeError) levé par l'inverse de zéro dans GF(256). */
export const SHAMIR_GF256_ZERO_INVERSE = 'SHAMIR_GF256_ZERO_INVERSE' as const;

/**
 * Tables statiques exp/log de GF(2^8) (polynôme 0x11b, générateur 0x03), construites une seule fois au
 * chargement du module. `GF256_EXP` est doublée (510 entrées utiles) pour éviter toute réduction modulo 255 :
 * exp[log a + log b] avec log a + log b ≤ 508. `GF256_LOG[0]` est sans objet (0 n'a pas de logarithme).
 */
function buildGf256Tables(): { readonly exp: Uint8Array; readonly log: Uint8Array } {
  const exp = new Uint8Array(512);
  const log = new Uint8Array(256);
  let value = 1;
  for (let power = 0; power < 255; power += 1) {
    exp[power] = value;
    log[value] = power;
    // value *= 0x03 = value XOR xtime(value)
    const doubled = ((value << 1) & 0xff) ^ ((value & 0x80) === 0 ? 0 : 0x1b);
    value ^= doubled;
  }
  for (let power = 255; power < 512; power += 1) {
    exp[power] = exp[power - 255] ?? 0;
  }
  return { exp, log };
}

const GF256_TABLES = buildGf256Tables();
export const GF256_EXP: Readonly<Uint8Array> = GF256_TABLES.exp;
export const GF256_LOG: Readonly<Uint8Array> = GF256_TABLES.log;

/**
 * Multiplication dans GF(2^8) en O(1) par tables : exp[log a + log b], 0 si un facteur est nul.
 * Les accès aux tables dépendent des opérandes (canal auxiliaire de cache possible), contrairement à
 * l'ancienne boucle à masques ; les parts d'un séquestre ne sont manipulées que côté serveur de confiance.
 */
export function gf256Mul(a: number, b: number): number {
  const x = a & 0xff;
  const y = b & 0xff;
  if (x === 0 || y === 0) {
    return 0;
  }
  return GF256_EXP[(GF256_LOG[x] ?? 0) + (GF256_LOG[y] ?? 0)] ?? 0;
}

/** Inverse en O(1) : exp[255 - log a]. Zéro n'a pas d'inverse : E2eeError SHAMIR_GF256_ZERO_INVERSE. */
export function gf256Inv(a: number): number {
  const x = a & 0xff;
  if (x === 0) {
    throw new E2eeError(SHAMIR_GF256_ZERO_INVERSE);
  }
  return GF256_EXP[255 - (GF256_LOG[x] ?? 0)] ?? 0;
}

/** Noms historiques exportés (aucune importation existante ne casse). */
export const gf256Multiply: typeof gf256Mul = gf256Mul;
export const gf256Inverse: typeof gf256Inv = gf256Inv;

function isShareIndex(value: number): value is ShareIndex {
  return value === 1 || value === 2 || value === 3;
}

async function computeCheck(index: number, setId: string, data: Uint8Array): Promise<string> {
  const header = TEXT_ENCODER.encode(`${SHAMIR_SHARE_VERSION}|${index}|${setId}|`);
  const input = new Uint8Array(header.length + data.length);
  input.set(header, 0);
  input.set(data, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return bytesToHex(digest.subarray(0, CHECK_BYTES));
}

/** Assemble une part avec son empreinte (utilisé aussi par les tests de vecteurs). */
export async function buildShamirShare(index: ShareIndex, setId: string, data: Uint8Array): Promise<ShamirShare> {
  return {
    version: SHAMIR_SHARE_VERSION,
    index,
    setId,
    data: toBase64Url(data),
    check: await computeCheck(index, setId, data),
  };
}

export function serializeShamirShare(share: ShamirShare): string {
  return `${share.version}:${share.index}:${share.setId}:${share.data}:${share.check}`;
}

async function verifyShare(share: ShamirShare): Promise<Bytes> {
  if (share.version !== SHAMIR_SHARE_VERSION) {
    throw new E2eeError('UNSUPPORTED_VERSION');
  }
  if (!isShareIndex(share.index)) {
    throw new E2eeError('INVALID_FORMAT');
  }
  const data = fromBase64Url(share.data);
  const setId = fromBase64Url(share.setId);
  if (data.length === 0 || data.length > SHAMIR_MAX_SECRET_BYTES || setId.length !== SET_ID_BYTES) {
    throw new E2eeError('INVALID_FORMAT');
  }
  const expected = TEXT_ENCODER.encode(await computeCheck(share.index, share.setId, data));
  if (!constantTimeEqualBytes(expected, TEXT_ENCODER.encode(share.check))) {
    throw new E2eeError('SHAMIR_SHARE_CORRUPT');
  }
  return data;
}

/** Analyse une part sérialisée et en contrôle l'empreinte. */
export async function parseShamirShare(serialized: string): Promise<ShamirShare> {
  const parts = serialized.split(':');
  if (parts.length !== 5) {
    throw new E2eeError('INVALID_FORMAT');
  }
  const [version, indexText, setId, data, check] = parts;
  if (version === undefined || indexText === undefined || setId === undefined || data === undefined || check === undefined) {
    throw new E2eeError('INVALID_FORMAT');
  }
  if (!/^shm[0-9]+$/.test(version)) {
    throw new E2eeError('INVALID_FORMAT');
  }
  if (version !== SHAMIR_SHARE_VERSION) {
    throw new E2eeError('UNSUPPORTED_VERSION');
  }
  const index = Number(indexText);
  if (!/^[0-9]$/.test(indexText) || !isShareIndex(index)) {
    throw new E2eeError('INVALID_FORMAT');
  }
  const share: ShamirShare = { version: SHAMIR_SHARE_VERSION, index, setId, data, check };
  await verifyShare(share);
  return share;
}

/** Découpe un secret (1 à 4096 octets) en 3 parts, seuil 2 ; x = 1, 2, 3. */
export async function splitSecretShamir2of3(
  secret: Uint8Array,
): Promise<readonly [ShamirShare, ShamirShare, ShamirShare]> {
  if (secret.length === 0 || secret.length > SHAMIR_MAX_SECRET_BYTES) {
    throw new E2eeError('INVALID_INPUT');
  }
  const slope = crypto.getRandomValues(new Uint8Array(secret.length));
  const setId = toBase64Url(crypto.getRandomValues(new Uint8Array(SET_ID_BYTES)));
  const buffers: Bytes[] = [];
  try {
    const indices: readonly ShareIndex[] = [1, 2, 3];
    const shares: ShamirShare[] = [];
    for (const x of indices) {
      const y = new Uint8Array(secret.length);
      buffers.push(y);
      for (let i = 0; i < secret.length; i += 1) {
        y[i] = (secret[i] ?? 0) ^ gf256Multiply(slope[i] ?? 0, x);
      }
      shares.push(await buildShamirShare(x, setId, y));
    }
    const [first, second, third] = shares;
    if (first === undefined || second === undefined || third === undefined) {
      throw new E2eeError('ENCRYPTION_FAILED');
    }
    return [first, second, third];
  } finally {
    slope.fill(0);
    for (const buffer of buffers) {
      buffer.fill(0);
    }
  }
}

function lagrangeAtZero(a: ShamirShare, ya: Uint8Array, b: ShamirShare, yb: Uint8Array): Bytes {
  const invDx = gf256Inverse(a.index ^ b.index);
  const la = gf256Multiply(b.index, invDx);
  const lb = gf256Multiply(a.index, invDx);
  const out = new Uint8Array(ya.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = gf256Multiply(ya[i] ?? 0, la) ^ gf256Multiply(yb[i] ?? 0, lb);
  }
  return out;
}

/**
 * Reconstruit le secret par interpolation de Lagrange en x = 0 à partir de 2 parts (ou 3, cohérentes).
 * Parts altérées, de partages différents ou d'index répétés : refus typé.
 */
export async function reconstructSecretShamir2of3(shares: readonly (ShamirShare | string)[]): Promise<Bytes> {
  if (shares.length < 2) {
    throw new E2eeError('SHAMIR_INSUFFICIENT_SHARES');
  }
  if (shares.length > 3) {
    throw new E2eeError('INVALID_INPUT');
  }
  const parsed: ShamirShare[] = [];
  const data: Bytes[] = [];
  for (const entry of shares) {
    const share = typeof entry === 'string' ? await parseShamirShare(entry) : entry;
    data.push(await verifyShare(share));
    parsed.push(share);
  }
  const first = parsed[0];
  if (first === undefined) {
    throw new E2eeError('SHAMIR_INSUFFICIENT_SHARES');
  }
  const indices = new Set(parsed.map((share) => share.index));
  if (indices.size !== parsed.length) {
    throw new E2eeError('SHAMIR_DUPLICATE_SHARE');
  }
  const firstData = data[0];
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i]?.setId !== first.setId || data[i]?.length !== firstData?.length) {
      throw new E2eeError('SHAMIR_SHARE_MISMATCH');
    }
  }
  const second = parsed[1];
  const secondData = data[1];
  if (second === undefined || firstData === undefined || secondData === undefined) {
    throw new E2eeError('SHAMIR_INSUFFICIENT_SHARES');
  }
  const secret = lagrangeAtZero(first, firstData, second, secondData);
  const third = parsed[2];
  const thirdData = data[2];
  if (third !== undefined && thirdData !== undefined) {
    // Les trois points doivent être alignés : chaque paire rend le même secret.
    const viaFirstThird = lagrangeAtZero(first, firstData, third, thirdData);
    const viaSecondThird = lagrangeAtZero(second, secondData, third, thirdData);
    const consistent = constantTimeEqualBytes(secret, viaFirstThird) && constantTimeEqualBytes(secret, viaSecondThird);
    viaFirstThird.fill(0);
    viaSecondThird.fill(0);
    if (!consistent) {
      secret.fill(0);
      throw new E2eeError('SHAMIR_SHARE_MISMATCH');
    }
  }
  return secret;
}

function isHolderRole(value: string): value is EscrowHolderRole {
  return (ESCROW_HOLDER_ROLES as readonly string[]).includes(value);
}

function roleIndex(role: EscrowHolderRole): ShareIndex {
  return (ESCROW_HOLDER_ROLES.indexOf(role) + 1) as ShareIndex;
}

/**
 * Scelle le secret en 3 parts destinées aux 3 détenteurs nommés : mandataire/OEC (x=1), HSM froid
 * SYNAPTIC SYSTEMS (x=2), tiers de confiance / séquestre légal (x=3). Rôles et identifiants distincts.
 * Le chiffrement de chaque part pour son détenteur (clé publique, HSM) reste à la charge de l'appelant.
 */
export async function sealEscrowSecret(
  secret: Uint8Array,
  holders: readonly [EscrowHolderAssignment, EscrowHolderAssignment, EscrowHolderAssignment],
): Promise<readonly [SealedEscrowShare, SealedEscrowShare, SealedEscrowShare]> {
  if (holders.length !== 3) {
    throw new E2eeError('INVALID_INPUT');
  }
  for (const holder of holders) {
    if (!isHolderRole(holder.role) || holder.holderId.trim().length === 0 || holder.holderId.length > 200) {
      throw new E2eeError('INVALID_INPUT');
    }
  }
  const ids = new Set(holders.map((holder) => holder.holderId.trim()));
  const roles = new Set(holders.map((holder) => holder.role));
  if (ids.size !== 3 || roles.size !== 3) {
    throw new E2eeError('SHAMIR_HOLDER_NOT_DISTINCT');
  }
  const shares = await splitSecretShamir2of3(secret);
  const out = ESCROW_HOLDER_ROLES.map((role, position) => {
    const holder = holders.find((candidate) => candidate.role === role);
    const share = shares[position];
    if (holder === undefined || share === undefined) {
      throw new E2eeError('INVALID_INPUT');
    }
    return { holderRole: role, holderId: holder.holderId.trim(), share: serializeShamirShare(share) };
  });
  const [a, b, c] = out;
  if (a === undefined || b === undefined || c === undefined) {
    throw new E2eeError('INVALID_INPUT');
  }
  return [a, b, c];
}

/** Restitution : au moins 2 détenteurs DISTINCTS (identifiant et rôle), chacun avec sa propre part. */
export async function reconstructEscrowSecret(presentations: readonly EscrowPresentation[]): Promise<Bytes> {
  if (presentations.length < 2) {
    throw new E2eeError('SHAMIR_INSUFFICIENT_SHARES');
  }
  const ids = new Set(presentations.map((entry) => entry.holderId.trim()));
  const roles = new Set(presentations.map((entry) => entry.holderRole));
  if (ids.has('') || ids.size !== presentations.length || roles.size !== presentations.length) {
    throw new E2eeError('SHAMIR_HOLDER_NOT_DISTINCT');
  }
  const shares: ShamirShare[] = [];
  for (const entry of presentations) {
    if (!isHolderRole(entry.holderRole)) {
      throw new E2eeError('INVALID_INPUT');
    }
    const share = typeof entry.share === 'string' ? await parseShamirShare(entry.share) : entry.share;
    await verifyShare(share);
    if (share.index !== roleIndex(entry.holderRole)) {
      throw new E2eeError('SHAMIR_SHARE_MISMATCH');
    }
    shares.push(share);
  }
  return reconstructSecretShamir2of3(shares);
}
