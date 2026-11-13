/**
 * Refresh cookie rotatif (Doc_09 § 02, annexe : « HttpOnly, Secure, SameSite=Strict » ; ticket T-S1A-04).
 *
 * - Jeton opaque de 32 octets aléatoires (256 bits), jamais stocké : seule son empreinte SHA-256 l'est. Un jeton à
 *   haute entropie n'a pas besoin de sel ; la fuite de la table ne permet pas de rejouer un jeton.
 * - Rotation à chaque usage : le jeton présenté est marqué « tourné » (compare-and-set atomique du port) et un nouveau
 *   jeton de la même famille est émis.
 * - Détection de vol : présenter un jeton déjà tourné (ou perdre la course d'une rotation concurrente) révoque toute
 *   la famille, donc la chaîne de sessions issue de cette connexion.
 * La table de stockage vient de S1B : tout passe par le port RefreshTokenStore.
 */

import { decodeBase64Url, encodeBase64Url, secureRandomBytes, sha256Bytes } from './encoding.ts';
import type { RandomSource } from './encoding.ts';

/** Préfixe __Host- : cookie lié à l'hôte exact, Secure, Path=/, sans attribut Domain. */
export const REFRESH_COOKIE_NAME = '__Host-fisca_refresh' as const;
const REFRESH_TOKEN_BYTES = 32;
const FAMILY_ID_BYTES = 16;
const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type RefreshErrorCode =
  | 'REFRESH_TOKEN_MISSING'
  | 'REFRESH_TOKEN_INVALID'
  | 'REFRESH_TOKEN_EXPIRED'
  | 'REFRESH_TOKEN_REVOKED'
  | 'REFRESH_TOKEN_REUSED';

export class RefreshError extends Error {
  readonly code: RefreshErrorCode;

  constructor(code: RefreshErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RefreshError';
    this.code = code;
  }
}

/** Vue applicative d'une ligne de refresh token. Le jeton en clair n'y figure jamais. */
export interface RefreshTokenRecord {
  readonly tokenHash: string;
  readonly familyId: string;
  readonly userId: string;
  readonly issuedAtEpochSec: number;
  readonly expiresAtEpochSec: number;
  /** Renseigné quand le jeton a été échangé contre son successeur. */
  readonly rotatedAtEpochSec: number | null;
  /** Renseigné quand la famille est révoquée. */
  readonly revokedAtEpochSec: number | null;
  /** Conservé d'une rotation à l'autre : un refresh ne renouvelle jamais mfa_verified_at (Step-Up). */
  readonly mfaVerifiedAtEpochSec: number | null;
  readonly amr: readonly string[];
}

export interface RefreshTokenStore {
  insert(record: RefreshTokenRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Compare-and-set atomique : true seulement si le jeton n'était pas encore tourné. */
  markRotated(tokenHash: string, nowEpochSec: number): Promise<boolean>;
  /** Révoque tous les jetons de la famille (ligne par ligne ou en bloc, à la discrétion du stockage). */
  revokeFamily(familyId: string, nowEpochSec: number): Promise<void>;
}

export interface RefreshDeps {
  readonly store: RefreshTokenStore;
  /** Durée de vie d'un jeton de refresh, en secondes : à fournir par l'appelant (la spécification ne la fixe pas). */
  readonly ttlSec: number;
  readonly nowEpochSec: () => number;
  readonly randomBytes?: RandomSource;
}

export interface RefreshSessionContext {
  readonly userId: string;
  readonly mfaVerifiedAtEpochSec: number | null;
  readonly amr: readonly string[];
}

export interface IssuedRefresh extends RefreshSessionContext {
  /** Jeton en clair : à poser dans le cookie, jamais à stocker ni journaliser. */
  readonly token: string;
  readonly familyId: string;
  readonly expiresAtEpochSec: number;
  /** Valeur d'un en-tête Set-Cookie. */
  readonly cookie: string;
}

const HEX_DIGITS = '0123456789abcdef';

/** Empreinte SHA-256 hexadécimale d'un jeton de refresh. */
export async function hashRefreshToken(token: string): Promise<string> {
  const digest = await sha256Bytes(new TextEncoder().encode(token));
  let out = '';
  for (const byte of digest) {
    out += HEX_DIGITS.charAt(byte >>> 4) + HEX_DIGITS.charAt(byte & 0x0f);
  }
  return out;
}

export function buildRefreshCookie(token: string, maxAgeSec: number): string {
  return [`${REFRESH_COOKIE_NAME}=${token}`, 'Path=/', `Max-Age=${maxAgeSec}`, 'HttpOnly', 'Secure', 'SameSite=Strict'].join('; ');
}

export function buildClearRefreshCookie(): string {
  return [`${REFRESH_COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'Secure', 'SameSite=Strict'].join('; ');
}

/** Extrait la valeur du cookie de refresh d'un en-tête Cookie ; null s'il est absent. */
export function readRefreshCookie(cookieHeader: string | null): string | null {
  if (cookieHeader === null) {
    return null;
  }
  for (const pair of cookieHeader.split(';')) {
    const trimmed = pair.trim();
    const separator = trimmed.indexOf('=');
    if (separator > 0 && trimmed.slice(0, separator) === REFRESH_COOKIE_NAME) {
      const value = trimmed.slice(separator + 1);
      return value.length === 0 ? null : value;
    }
  }
  return null;
}

function assertTtl(ttlSec: number): void {
  if (!Number.isSafeInteger(ttlSec) || ttlSec < 1) {
    throw new Error('REFRESH_TTL_INVALID: la durée de vie du refresh doit être un entier positif de secondes.');
  }
}

async function insertToken(
  deps: RefreshDeps,
  familyId: string,
  context: RefreshSessionContext,
): Promise<IssuedRefresh> {
  assertTtl(deps.ttlSec);
  const random = deps.randomBytes ?? secureRandomBytes;
  const token = encodeBase64Url(random(REFRESH_TOKEN_BYTES));
  const now = deps.nowEpochSec();
  const expiresAtEpochSec = now + deps.ttlSec;
  await deps.store.insert({
    tokenHash: await hashRefreshToken(token),
    familyId,
    userId: context.userId,
    issuedAtEpochSec: now,
    expiresAtEpochSec,
    rotatedAtEpochSec: null,
    revokedAtEpochSec: null,
    mfaVerifiedAtEpochSec: context.mfaVerifiedAtEpochSec,
    amr: context.amr,
  });
  return {
    token,
    familyId,
    expiresAtEpochSec,
    cookie: buildRefreshCookie(token, deps.ttlSec),
    userId: context.userId,
    mfaVerifiedAtEpochSec: context.mfaVerifiedAtEpochSec,
    amr: context.amr,
  };
}

/** Ouvre une nouvelle famille de refresh (une connexion = une famille). */
export async function startRefreshFamily(deps: RefreshDeps, context: RefreshSessionContext): Promise<IssuedRefresh> {
  const familyId = encodeBase64Url((deps.randomBytes ?? secureRandomBytes)(FAMILY_ID_BYTES));
  return insertToken(deps, familyId, context);
}

async function findRecord(deps: RefreshDeps, token: string): Promise<RefreshTokenRecord> {
  if (!REFRESH_TOKEN_PATTERN.test(token) || decodeBase64Url(token) === null) {
    throw new RefreshError('REFRESH_TOKEN_INVALID', 'jeton de refresh mal formé.');
  }
  const record = await deps.store.findByHash(await hashRefreshToken(token));
  if (record === null) {
    throw new RefreshError('REFRESH_TOKEN_INVALID', 'jeton de refresh inconnu.');
  }
  return record;
}

/**
 * Échange un refresh contre son successeur. Un jeton déjà tourné révoque toute la famille (REFRESH_TOKEN_REUSED) ;
 * un jeton d'une famille déjà révoquée est refusé (REFRESH_TOKEN_REVOKED).
 */
export async function rotateRefreshToken(deps: RefreshDeps, input: { readonly token: string }): Promise<IssuedRefresh> {
  const record = await findRecord(deps, input.token);
  const now = deps.nowEpochSec();
  if (record.revokedAtEpochSec !== null) {
    throw new RefreshError('REFRESH_TOKEN_REVOKED', 'la famille de ce jeton est révoquée.');
  }
  if (record.rotatedAtEpochSec !== null) {
    await deps.store.revokeFamily(record.familyId, now);
    throw new RefreshError('REFRESH_TOKEN_REUSED', 'jeton déjà utilisé : toute la famille est révoquée.');
  }
  if (record.expiresAtEpochSec <= now) {
    throw new RefreshError('REFRESH_TOKEN_EXPIRED', 'jeton de refresh expiré.');
  }
  if (!(await deps.store.markRotated(record.tokenHash, now))) {
    await deps.store.revokeFamily(record.familyId, now);
    throw new RefreshError('REFRESH_TOKEN_REUSED', 'rotation concurrente : toute la famille est révoquée.');
  }
  return insertToken(deps, record.familyId, {
    userId: record.userId,
    mfaVerifiedAtEpochSec: record.mfaVerifiedAtEpochSec,
    amr: record.amr,
  });
}

/** Révoque la famille d'un jeton (déconnexion). Un jeton inconnu ou mal formé lève REFRESH_TOKEN_INVALID. */
export async function revokeRefreshFamily(deps: RefreshDeps, input: { readonly token: string }): Promise<void> {
  const record = await findRecord(deps, input.token);
  await deps.store.revokeFamily(record.familyId, deps.nowEpochSec());
}
