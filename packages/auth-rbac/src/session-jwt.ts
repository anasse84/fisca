/**
 * Sessions JWT EdDSA (Ed25519, WebCrypto) de 15 minutes (Doc_09 § 02, Doc_10 § 01 ; ticket T-S1A-04).
 *
 * La clé privée est le secret JWT_EDDSA_PRIVATE_JWK (CTR-SEC-02) : elle est fournie par l'appelant sous forme de
 * chaîne JSON JWK et n'est jamais lue dans l'environnement ici ni écrite en dur. La clé publique de vérification est
 * dérivée du même JWK (composante `x`), recoupée par une signature d'essai au chargement.
 * L'algorithme est figé à EdDSA : `none`, `HS*`, `RS*`, `ES*` et toute variante de casse sont refusés avant toute
 * vérification de signature.
 */

import { decodeBase64Url, encodeBase64Url, isRecord, secureRandomBytes, sha256Bytes } from './encoding.ts';
import type { RandomSource } from './encoding.ts';

/** Doc_09 § 02 : durée de vie de la session, 15 minutes. */
export const ACCESS_TOKEN_TTL_SEC = 900 as const;
export const SESSION_JWT_ALG = 'EdDSA' as const;
const JWT_TYPE = 'JWT';
const JTI_BYTES = 16;
const ED25519_SIGNATURE_BYTES = 64;
const ALLOWED_HEADER_FIELDS: readonly string[] = ['alg', 'typ', 'kid'];

export type SessionJwtErrorCode =
  | 'JWT_KEY_INVALID'
  | 'JWT_MALFORMED'
  | 'JWT_ALG_FORBIDDEN'
  | 'JWT_SIGNATURE_INVALID'
  | 'JWT_CLAIMS_INVALID'
  | 'JWT_ISSUER_INVALID'
  | 'JWT_AUDIENCE_INVALID'
  | 'JWT_EXPIRED'
  | 'JWT_NOT_YET_VALID';

export class SessionJwtError extends Error {
  readonly code: SessionJwtErrorCode;

  constructor(code: SessionJwtErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SessionJwtError';
    this.code = code;
  }
}

export interface SessionSigningKeys {
  /** Non extractible, usage `sign` uniquement. */
  readonly privateKey: CryptoKey;
  /** Dérivée du JWK privé, usage `verify` uniquement. */
  readonly publicKey: CryptoKey;
  /** Empreinte RFC 7638 de la clé publique. */
  readonly kid: string;
}

function keyError(message: string): SessionJwtError {
  return new SessionJwtError('JWT_KEY_INVALID', message);
}

/** Charge le secret JWT_EDDSA_PRIVATE_JWK (JWK OKP Ed25519 avec `d` et `x`). */
export async function loadSessionSigningKeys(privateJwkJson: string): Promise<SessionSigningKeys> {
  if (privateJwkJson.length === 0) {
    throw keyError('le secret JWT_EDDSA_PRIVATE_JWK est absent.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(privateJwkJson);
  } catch {
    throw keyError('le secret JWT_EDDSA_PRIVATE_JWK n’est pas un JSON valide.');
  }
  if (!isRecord(parsed)) {
    throw keyError('le JWK doit être un objet.');
  }
  const { kty, crv, d, x } = parsed;
  if (kty !== 'OKP' || crv !== 'Ed25519') {
    throw keyError('le JWK doit être de type OKP / Ed25519.');
  }
  if (typeof d !== 'string' || d.length === 0 || typeof x !== 'string' || x.length === 0) {
    throw keyError('le JWK doit porter la clé privée `d` et la clé publique `x`.');
  }
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey('jwk', { kty, crv, d, x }, { name: 'Ed25519' }, false, ['sign']);
    publicKey = await crypto.subtle.importKey('jwk', { kty, crv, x }, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    throw keyError('le JWK Ed25519 est refusé par WebCrypto.');
  }
  const probe = encodeBase64Url(secureRandomBytes(JTI_BYTES));
  const probeBytes = new TextEncoder().encode(probe);
  const probeSignature = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, probeBytes);
  if (!(await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, probeSignature, probeBytes))) {
    throw keyError('la composante publique `x` ne correspond pas à la clé privée `d`.');
  }
  const thumbprint = await sha256Bytes(new TextEncoder().encode(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`));
  return { privateKey, publicKey, kid: encodeBase64Url(thumbprint) };
}

export interface AccessTokenClaims {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  /** Identifiant de session = famille du refresh cookie. */
  readonly sid: string;
  readonly jti: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  /** Méthodes d'authentification (mot de passe, google, otp, code de secours, passkey). */
  readonly amr: readonly string[];
  /** Claim `mfa_verified_at` (Step-Up < 300 s) ; null si aucun second facteur n'a été validé. */
  readonly mfaVerifiedAtEpochSec: number | null;
}

export interface IssueAccessTokenParams {
  readonly keys: SessionSigningKeys;
  readonly issuer: string;
  readonly audience: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly amr: readonly string[];
  readonly mfaVerifiedAtEpochSec: number | null;
  readonly nowEpochSec: number;
  readonly randomBytes?: RandomSource;
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

export async function issueAccessToken(
  params: IssueAccessTokenParams,
): Promise<{ readonly token: string; readonly claims: AccessTokenClaims }> {
  const claims: AccessTokenClaims = {
    iss: params.issuer,
    aud: params.audience,
    sub: params.userId,
    sid: params.sessionId,
    jti: encodeBase64Url((params.randomBytes ?? secureRandomBytes)(JTI_BYTES)),
    iat: params.nowEpochSec,
    nbf: params.nowEpochSec,
    exp: params.nowEpochSec + ACCESS_TOKEN_TTL_SEC,
    amr: params.amr,
    mfaVerifiedAtEpochSec: params.mfaVerifiedAtEpochSec,
  };
  const payload: Record<string, unknown> = {
    iss: claims.iss,
    aud: claims.aud,
    sub: claims.sub,
    sid: claims.sid,
    jti: claims.jti,
    iat: claims.iat,
    nbf: claims.nbf,
    exp: claims.exp,
    amr: claims.amr,
  };
  if (claims.mfaVerifiedAtEpochSec !== null) {
    payload['mfa_verified_at'] = claims.mfaVerifiedAtEpochSec;
  }
  const signingInput = `${encodeJson({ alg: SESSION_JWT_ALG, typ: JWT_TYPE, kid: params.keys.kid })}.${encodeJson(payload)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, params.keys.privateKey, new TextEncoder().encode(signingInput)),
  );
  return { token: `${signingInput}.${encodeBase64Url(signature)}`, claims };
}

export interface VerifyAccessTokenParams {
  readonly token: string;
  readonly keys: Pick<SessionSigningKeys, 'publicKey' | 'kid'>;
  readonly issuer: string;
  readonly audience: string;
  readonly nowEpochSec: number;
  /** Tolérance d'horloge en secondes ; 0 par défaut. */
  readonly leewaySec?: number;
}

function malformed(message: string): SessionJwtError {
  return new SessionJwtError('JWT_MALFORMED', message);
}

function parseSegmentObject(segment: string): Record<string, unknown> {
  const bytes = decodeBase64Url(segment);
  if (bytes === null) {
    throw malformed('segment base64url invalide.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw malformed('segment JSON invalide.');
  }
  if (!isRecord(parsed)) {
    throw malformed('segment JSON non objet.');
  }
  return parsed;
}

function integerClaim(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new SessionJwtError('JWT_CLAIMS_INVALID', 'revendication numérique invalide.');
  }
  return value;
}

function stringClaim(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SessionJwtError('JWT_CLAIMS_INVALID', 'revendication textuelle invalide.');
  }
  return value;
}

/** Vérifie algorithme, signature, iss, aud, exp, nbf, jti ; renvoie les revendications. */
export async function verifyAccessToken(params: VerifyAccessTokenParams): Promise<AccessTokenClaims> {
  const parts = params.token.split('.');
  const headerSegment = parts[0];
  const payloadSegment = parts[1];
  const signatureSegment = parts[2];
  if (parts.length !== 3 || headerSegment === undefined || payloadSegment === undefined || signatureSegment === undefined) {
    throw malformed('un JWT compte trois segments.');
  }
  const header = parseSegmentObject(headerSegment);
  if (header['alg'] !== SESSION_JWT_ALG) {
    throw new SessionJwtError('JWT_ALG_FORBIDDEN', 'seul l’algorithme EdDSA est accepté.');
  }
  if (Object.keys(header).some((name) => !ALLOWED_HEADER_FIELDS.includes(name))) {
    throw malformed('en-tête JWT non pris en charge (crit, jwk, jku...).');
  }
  if (header['typ'] !== undefined && header['typ'] !== JWT_TYPE) {
    throw malformed('typ attendu : JWT.');
  }
  if (header['kid'] !== undefined && header['kid'] !== params.keys.kid) {
    throw new SessionJwtError('JWT_SIGNATURE_INVALID', 'kid inconnu.');
  }
  const signature = decodeBase64Url(signatureSegment);
  if (signature === null || signature.length !== ED25519_SIGNATURE_BYTES) {
    throw malformed('signature mal formée.');
  }
  const authentic = await crypto.subtle.verify(
    { name: 'Ed25519' },
    params.keys.publicKey,
    signature,
    new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
  );
  if (!authentic) {
    throw new SessionJwtError('JWT_SIGNATURE_INVALID', 'signature invalide.');
  }
  const payload = parseSegmentObject(payloadSegment);
  const amrRaw = payload['amr'];
  if (!Array.isArray(amrRaw) || amrRaw.some((item) => typeof item !== 'string')) {
    throw new SessionJwtError('JWT_CLAIMS_INVALID', 'amr invalide.');
  }
  const mfaRaw = payload['mfa_verified_at'];
  const claims: AccessTokenClaims = {
    iss: stringClaim(payload['iss']),
    aud: stringClaim(payload['aud']),
    sub: stringClaim(payload['sub']),
    sid: stringClaim(payload['sid']),
    jti: stringClaim(payload['jti']),
    iat: integerClaim(payload['iat']),
    nbf: integerClaim(payload['nbf']),
    exp: integerClaim(payload['exp']),
    amr: amrRaw.map(String),
    mfaVerifiedAtEpochSec: mfaRaw === undefined ? null : integerClaim(mfaRaw),
  };
  if (claims.iss !== params.issuer) {
    throw new SessionJwtError('JWT_ISSUER_INVALID', 'émetteur inattendu.');
  }
  if (claims.aud !== params.audience) {
    throw new SessionJwtError('JWT_AUDIENCE_INVALID', 'audience inattendue.');
  }
  const leeway = params.leewaySec ?? 0;
  if (params.nowEpochSec + leeway < claims.nbf) {
    throw new SessionJwtError('JWT_NOT_YET_VALID', 'jeton pas encore valide.');
  }
  if (params.nowEpochSec - leeway >= claims.exp) {
    throw new SessionJwtError('JWT_EXPIRED', 'jeton expiré.');
  }
  return claims;
}
