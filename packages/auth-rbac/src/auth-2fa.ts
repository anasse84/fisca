/**
 * CTR-COD-07 « auth-2fa » (Doc_09 § 02, ERRATA D-01 et section C).
 *
 * Ticket T-S1A-01 : hachage de mot de passe PBKDF2-HMAC-SHA512 + pepper, comparaison en temps constant
 * et verrouillage anti-bruteforce. WebCrypto uniquement (compatible Cloudflare Workers).
 * Le pepper (secret AUTH_PEPPER) est toujours fourni par l'appelant ; ce module ne lit aucun environnement.
 * L'horloge n'est jamais lue ici : l'heure est un paramètre.
 *
 * Ticket T-S1A-03 : la section « 2FA » en fin de fichier porte verifyTotpCodeRfc6238, les codes de secours et
 * le mfa_challenge_token. L'orchestration (ports, moteur) vit dans mfa-engine.ts, les routes dans mfa-routes.ts.
 */

import { PRODUCTION_PASSWORD_SERVICE, timingSafeEqualBytes } from './password-service.ts';
import type { PasswordService } from './password-service.ts';

// ---------------------------------------------------------------------------
// Utilitaires hexadécimaux (internes)
// ---------------------------------------------------------------------------

const HEX_DIGITS = '0123456789abcdef';

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += HEX_DIGITS.charAt(byte >>> 4) + HEX_DIGITS.charAt(byte & 0x0f);
  }
  return out;
}

/** Décode une chaîne hexadécimale minuscule de longueur paire ; renvoie null si elle est invalide. */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length >>> 1);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mot de passe : PBKDF2-HMAC-SHA512 + pepper (voir password-service.ts)
// ---------------------------------------------------------------------------

export {
  PASSWORD_DERIVED_BITS,
  PASSWORD_HASH_FORMAT_REGEX,
  PASSWORD_HASH_SCHEME,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PBKDF2_ITERATIONS,
  PASSWORD_SALT_BYTES,
  PRODUCTION_PASSWORD_SERVICE,
  decoyPasswordHash,
  parseStoredPasswordHash,
  timingSafeEqualBytes,
} from './password-service.ts';
export type { ParsedPasswordHash, PasswordService } from './password-service.ts';

/**
 * Hache un mot de passe avec la configuration de production (PBKDF2-HMAC-SHA512, 100 000 itérations, sel de
 * 16 octets, pepper). `providedSaltHex` sert aux tests et à la revérification.
 */
export async function hashPasswordWorkerSafe(
  plainPassword: string,
  serverPepper: string,
  providedSaltHex?: string,
): Promise<string> {
  return PRODUCTION_PASSWORD_SERVICE.hash(plainPassword, serverPepper, providedSaltHex);
}

/**
 * Vérifie un mot de passe contre une empreinte stockée avec la configuration de production : refuse (false,
 * jamais d'exception) une empreinte malformée ou sous 100 000 itérations. Comparaison en temps constant.
 */
export async function verifyPasswordWorkerSafe(
  plainPassword: string,
  serverPepper: string,
  storedHash: string,
): Promise<boolean> {
  return PRODUCTION_PASSWORD_SERVICE.verify(plainPassword, serverPepper, storedHash);
}

// ---------------------------------------------------------------------------
// Verrouillage anti-bruteforce (logique pure ; l'heure est un paramètre)
// ---------------------------------------------------------------------------

export interface LockoutPolicy {
  readonly maxConsecutiveFailures: number;
  readonly lockDurationMs: number;
}

export interface LockoutState {
  readonly consecutiveFailures: number;
  readonly lockedUntilEpochMs: number | null;
}

/** Doc_09 § 02 : verrouillage temporaire de 15 minutes après 5 échecs consécutifs. */
export const LOCKOUT_DEFAULT_POLICY: LockoutPolicy = {
  maxConsecutiveFailures: 5,
  lockDurationMs: 15 * 60 * 1000,
};

function assertLockoutInput(nowEpochMs: number, policy: LockoutPolicy): void {
  if (
    !Number.isSafeInteger(nowEpochMs) ||
    !Number.isSafeInteger(policy.maxConsecutiveFailures) ||
    policy.maxConsecutiveFailures < 1 ||
    !Number.isSafeInteger(policy.lockDurationMs) ||
    policy.lockDurationMs < 1
  ) {
    throw new Error('AUTH_LOCKOUT_INVALID_INPUT: heure et politique doivent être des entiers positifs.');
  }
}

export function initialLockoutState(): LockoutState {
  return { consecutiveFailures: 0, lockedUntilEpochMs: null };
}

/** Vrai tant que l'heure est strictement avant la fin du verrou. */
export function isLockedOut(state: LockoutState, nowEpochMs: number): boolean {
  if (!Number.isSafeInteger(nowEpochMs)) {
    throw new Error('AUTH_LOCKOUT_INVALID_INPUT: heure et politique doivent être des entiers positifs.');
  }
  return state.lockedUntilEpochMs !== null && nowEpochMs < state.lockedUntilEpochMs;
}

/**
 * Enregistre un échec. Pendant un verrou actif l'état est inchangé (pas de prolongation) ; un verrou expiré
 * repart d'un compteur neuf.
 */
export function recordFailedAttempt(state: LockoutState, nowEpochMs: number, policy: LockoutPolicy): LockoutState {
  assertLockoutInput(nowEpochMs, policy);
  if (isLockedOut(state, nowEpochMs)) {
    return state;
  }
  const previous = state.lockedUntilEpochMs === null ? state.consecutiveFailures : 0;
  const consecutiveFailures = previous + 1;
  if (consecutiveFailures >= policy.maxConsecutiveFailures) {
    return { consecutiveFailures, lockedUntilEpochMs: nowEpochMs + policy.lockDurationMs };
  }
  return { consecutiveFailures, lockedUntilEpochMs: null };
}

/** Un succès remet le compteur à zéro et lève tout verrou. */
export function recordSuccessfulAttempt(): LockoutState {
  return initialLockoutState();
}

export type PasswordAuthOutcome = 'SUCCESS' | 'FAILURE' | 'LOCKED';

export interface AuthenticatePasswordParams {
  readonly plainPassword: string;
  readonly pepper: string;
  readonly storedHash: string;
  readonly state: LockoutState;
  readonly nowEpochMs: number;
  readonly policy?: LockoutPolicy;
  /** Configuration de mots de passe ; production (100 000 itérations) par défaut. */
  readonly passwordService?: PasswordService;
}

export interface AuthenticatePasswordResult {
  readonly outcome: PasswordAuthOutcome;
  readonly state: LockoutState;
  /** Millisecondes restantes de verrou (0 hors verrou). */
  readonly retryAfterMs: number;
}

/**
 * Facteur 1 complet : refuse sans dériver tant que le compte est verrouillé, sinon vérifie le mot de passe et
 * met à jour le compteur. Une empreinte malformée compte comme un échec.
 */
export async function authenticatePassword(params: AuthenticatePasswordParams): Promise<AuthenticatePasswordResult> {
  const policy = params.policy ?? LOCKOUT_DEFAULT_POLICY;
  assertLockoutInput(params.nowEpochMs, policy);
  if (isLockedOut(params.state, params.nowEpochMs)) {
    const until = params.state.lockedUntilEpochMs ?? params.nowEpochMs;
    return { outcome: 'LOCKED', state: params.state, retryAfterMs: until - params.nowEpochMs };
  }
  const ok = await (params.passwordService ?? PRODUCTION_PASSWORD_SERVICE).verify(params.plainPassword, params.pepper, params.storedHash);
  if (ok) {
    return { outcome: 'SUCCESS', state: recordSuccessfulAttempt(), retryAfterMs: 0 };
  }
  const next = recordFailedAttempt(params.state, params.nowEpochMs, policy);
  const retryAfterMs = next.lockedUntilEpochMs === null ? 0 : next.lockedUntilEpochMs - params.nowEpochMs;
  return { outcome: 'FAILURE', state: next, retryAfterMs };
}

// ---------------------------------------------------------------------------
// 2FA : TOTP RFC 6238, codes de secours, mfa_challenge_token (ticket T-S1A-03)
// ---------------------------------------------------------------------------
//
// Doc_09 § 02 : facteur 1 validé, puis mfa_challenge_token (TTL 5 min, zéro droit API métier), puis un second
// facteur (TOTP, OTP Infobip ou code de secours) avant toute session. Aucun secret n'est lu ici : la clé de
// signature du jeton est fournie par l'appelant ; le chiffrement du secret TOTP au repos relève de crypto-e2ee.

export type MfaErrorCode =
  | 'TOTP_INVALID_BASE32_SECRET'
  | 'TOTP_SETUP_REQUIRED'
  | 'TOTP_ALREADY_ENABLED'
  | 'TOTP_CODE_INVALID'
  | 'MFA_SIGNING_KEY_INVALID'
  | 'MFA_CHALLENGE_MALFORMED'
  | 'MFA_CHALLENGE_SIGNATURE_INVALID'
  | 'MFA_CHALLENGE_EXPIRED'
  | 'MFA_CHALLENGE_USER_MISMATCH'
  | 'MFA_CHALLENGE_REPLAYED'
  | 'MFA_CHALLENGE_ATTEMPTS_EXHAUSTED'
  | 'MFA_FACTOR_NOT_ENROLLED'
  | 'MFA_METHOD_UNAVAILABLE'
  | 'MFA_CODE_INVALID';

export class MfaError extends Error {
  readonly code: MfaErrorCode;

  constructor(code: MfaErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'MfaError';
    this.code = code;
  }
}

const mfaEncoder = new TextEncoder();
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MFA_RANDOM_BYTES = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

/** Source d'octets aléatoires injectable (tests) ; par défaut WebCrypto. */
export type MfaRandomBytes = (length: number) => Uint8Array;

// --- base32 (RFC 4648, sans remplissage) -----------------------------------

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 0x1f);
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) {
    out += BASE32_ALPHABET.charAt((value << (5 - bits)) & 0x1f);
  }
  return out;
}

/** Décode du base32 (casse et espaces tolérés, remplissage « = » toléré) ; lève TOTP_INVALID_BASE32_SECRET sinon. */
export function decodeBase32(input: string): Uint8Array<ArrayBuffer> {
  const cleaned = input.toUpperCase().replace(/\s+/g, '').replace(/=+$/g, '');
  if (cleaned.length === 0) {
    throw new MfaError('TOTP_INVALID_BASE32_SECRET', 'Le secret TOTP est vide.');
  }
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new MfaError('TOTP_INVALID_BASE32_SECRET', 'Le secret TOTP n’est pas du base32 valide.');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return new Uint8Array(output);
}

// --- TOTP / HOTP (RFC 4226, RFC 6238, HMAC-SHA1) ---------------------------

export const TOTP_STEP_SECONDS = 30 as const;
export const TOTP_DIGITS = 6 as const;
/** Fenêtre de dérive : un pas avant et un pas après le pas courant. */
export const TOTP_DRIFT_STEPS = 1 as const;
export const TOTP_SECRET_BYTES = 20 as const;

async function importHmacSha1Key(secretBytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
}

/** HOTP (RFC 4226 § 5.3) : troncature dynamique du HMAC-SHA1 du compteur 64 bits. */
async function computeHotp(key: CryptoKey, counter: number, digits: 6 | 8): Promise<string> {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, buffer));
  const offset = (digest[19] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);
  const modulus = digits === 8 ? 100000000 : 1000000;
  return String(binary % modulus).padStart(digits, '0');
}

export interface GenerateTotpParams {
  readonly base32Secret: string;
  readonly nowEpochSec: number;
  /** 6 par défaut ; 8 uniquement pour recouper les vecteurs de la RFC 6238 annexe B. */
  readonly digits?: 6 | 8;
}

/** Code TOTP du pas contenant `nowEpochSec` (utile aux tests et à la simulation d'un authentificateur). */
export async function generateTotpCodeRfc6238(params: GenerateTotpParams): Promise<string> {
  const key = await importHmacSha1Key(decodeBase32(params.base32Secret));
  return computeHotp(key, Math.floor(params.nowEpochSec / TOTP_STEP_SECONDS), params.digits ?? TOTP_DIGITS);
}

/** Secret TOTP de 160 bits (recommandation RFC 4226 § 4) en base32 : 32 caractères. */
export function generateTotpSecretBase32(randomBytes: MfaRandomBytes = MFA_RANDOM_BYTES): string {
  return encodeBase32(randomBytes(TOTP_SECRET_BYTES));
}

export interface OtpauthUriParams {
  readonly issuer: string;
  readonly accountName: string;
  readonly base32Secret: string;
}

/** URI de provisionnement otpauth://totp (Key Uri Format de Google Authenticator). */
export function buildOtpauthUri(params: OtpauthUriParams): string {
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.accountName)}`;
  return (
    `otpauth://totp/${label}?secret=${params.base32Secret}&issuer=${encodeURIComponent(params.issuer)}` +
    `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`
  );
}

export interface VerifyTotpParams {
  readonly base32Secret: string;
  readonly sixDigitCode: string;
  readonly nowEpochSec: number;
  /** Dernier pas accepté pour cet utilisateur (null si aucun) : tout pas inférieur ou égal est refusé. */
  readonly lastUsedStep: number | null;
}

export interface VerifyTotpResult {
  readonly valid: boolean;
  readonly matchedStep?: number;
}

/**
 * Vérifie un code TOTP à 6 chiffres (RFC 6238, HMAC-SHA1, pas de 30 s) avec dérive de ±1 pas.
 * Les trois candidats sont toujours calculés et comparés en temps constant, sans sortie anticipée.
 * Anti-rejeu : un pas inférieur ou égal à `lastUsedStep` n'est jamais accepté.
 */
export async function verifyTotpCodeRfc6238(params: VerifyTotpParams): Promise<VerifyTotpResult> {
  if (!/^\d{6}$/.test(params.sixDigitCode)) {
    return { valid: false };
  }
  const key = await importHmacSha1Key(decodeBase32(params.base32Secret));
  const supplied = mfaEncoder.encode(params.sixDigitCode);
  const currentStep = Math.floor(params.nowEpochSec / TOTP_STEP_SECONDS);
  let matchedStep: number | null = null;
  for (const offset of [0, -TOTP_DRIFT_STEPS, TOTP_DRIFT_STEPS]) {
    const candidate = currentStep + offset;
    if (candidate < 0) {
      continue;
    }
    const expected = mfaEncoder.encode(await computeHotp(key, candidate, TOTP_DIGITS));
    const equal = timingSafeEqualBytes(expected, supplied);
    const eligible = params.lastUsedStep === null || candidate > params.lastUsedStep;
    if (equal && eligible && matchedStep === null) {
      matchedStep = candidate;
    }
  }
  return matchedStep === null ? { valid: false } : { valid: true, matchedStep };
}

/** Port de mémorisation du dernier pas TOTP accepté (colonne last_used_totp_step de CTR-SQL-10, fournie par S1B). */
export interface TotpReplayStore {
  getLastUsedStep(userId: string): Promise<number | null>;
  /**
   * Compare-and-set atomique : mémorise `step` et renvoie true seulement si `step` est strictement supérieur
   * au pas mémorisé. Deux validations concurrentes du même pas ne réussissent jamais toutes les deux.
   */
  advanceLastUsedStep(userId: string, step: number): Promise<boolean>;
}

export interface VerifyTotpWithReplayGuardParams {
  readonly userId: string;
  readonly base32Secret: string;
  readonly sixDigitCode: string;
  readonly nowEpochSec: number;
  readonly store: TotpReplayStore;
}

/** Vérification TOTP complète : code, dérive, puis consommation atomique du pas. Un même pas ne valide qu'une fois. */
export async function verifyTotpWithReplayGuard(params: VerifyTotpWithReplayGuardParams): Promise<boolean> {
  const lastUsedStep = await params.store.getLastUsedStep(params.userId);
  const result = await verifyTotpCodeRfc6238({
    base32Secret: params.base32Secret,
    sixDigitCode: params.sixDigitCode,
    nowEpochSec: params.nowEpochSec,
    lastUsedStep,
  });
  if (!result.valid || result.matchedStep === undefined) {
    return false;
  }
  return params.store.advanceLastUsedStep(params.userId, result.matchedStep);
}

// --- Codes de secours -------------------------------------------------------

/** Doc_09 § 02 : 10 codes de secours générés à l'enrôlement. */
export const RECOVERY_CODE_BATCH_SIZE = 10 as const;
const RECOVERY_CODE_ENTROPY_BYTES = 10; // 80 bits = 16 caractères base32
const RECOVERY_CODE_SALT_BYTES = 16;
const RECOVERY_STORED_FORMAT = /^sha256\$([0-9a-f]{32})\$([0-9a-f]{64})$/;
const RECOVERY_NORMALIZED_FORMAT = /^[A-Z2-7]{16}$/;

function normalizeRecoveryCode(code: string): string | null {
  const normalized = code.toUpperCase().replace(/[\s-]/g, '');
  return RECOVERY_NORMALIZED_FORMAT.test(normalized) ? normalized : null;
}

async function recoveryDigest(salt: Uint8Array<ArrayBuffer>, normalizedCode: string): Promise<Uint8Array> {
  const codeBytes = mfaEncoder.encode(normalizedCode);
  const material = new Uint8Array(salt.length + codeBytes.length);
  material.set(salt, 0);
  material.set(codeBytes, salt.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
}

async function hashRecoveryCode(normalizedCode: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  return `sha256$${bytesToHex(salt)}$${bytesToHex(await recoveryDigest(salt, normalizedCode))}`;
}

export interface RecoveryCodeBatch {
  /** Codes en clair, à afficher une seule fois à l'utilisateur (format XXXX-XXXX-XXXX-XXXX). */
  readonly codes: readonly string[];
  /** Empreintes salées sha256$<sel hex>$<empreinte hex>, seules valeurs à stocker. */
  readonly hashes: readonly string[];
}

/** Génère un lot de codes de secours uniques (80 bits d'entropie chacun) et leurs empreintes salées. */
export async function generateRecoveryCodes(randomBytes: MfaRandomBytes = MFA_RANDOM_BYTES): Promise<RecoveryCodeBatch> {
  const normalizedCodes: string[] = [];
  while (normalizedCodes.length < RECOVERY_CODE_BATCH_SIZE) {
    const candidate = encodeBase32(randomBytes(RECOVERY_CODE_ENTROPY_BYTES));
    if (!normalizedCodes.includes(candidate)) {
      normalizedCodes.push(candidate);
    }
  }
  const hashes: string[] = [];
  for (const normalized of normalizedCodes) {
    const salt = new Uint8Array(randomBytes(RECOVERY_CODE_SALT_BYTES));
    hashes.push(await hashRecoveryCode(normalized, salt));
  }
  const codes = normalizedCodes.map((normalized) => normalized.replace(/(.{4})(?=.)/g, '$1-'));
  return { codes, hashes };
}

/**
 * Cherche l'empreinte stockée qui correspond au code saisi. Toutes les empreintes sont parcourues et comparées en
 * temps constant, sans sortie anticipée. Renvoie l'empreinte stockée (à consommer atomiquement) ou null.
 */
export async function findMatchingRecoveryCodeHash(code: string, storedHashes: readonly string[]): Promise<string | null> {
  const normalized = normalizeRecoveryCode(code);
  if (normalized === null) {
    return null;
  }
  let found: string | null = null;
  for (const stored of storedHashes) {
    const match = RECOVERY_STORED_FORMAT.exec(stored);
    const saltHex = match?.[1];
    const hashHex = match?.[2];
    if (saltHex === undefined || hashHex === undefined) {
      continue;
    }
    const salt = hexToBytes(saltHex);
    const expected = hexToBytes(hashHex);
    if (salt === null || expected === null) {
      continue;
    }
    const equal = timingSafeEqualBytes(await recoveryDigest(salt, normalized), expected);
    if (equal && found === null) {
      found = stored;
    }
  }
  return found;
}

// --- mfa_challenge_token ----------------------------------------------------

/** Doc_09 § 02 : TTL de 5 minutes. */
export const MFA_CHALLENGE_TTL_SEC = 300 as const;
/** Essais de second facteur autorisés par jeton avant verrouillage. */
export const MFA_CHALLENGE_MAX_FAILED_ATTEMPTS = 5 as const;
const MFA_CHALLENGE_PREFIX = 'fmc1';
const MFA_CHALLENGE_TYPE = 'mfa_challenge';
const MFA_SIGNING_KEY_MIN_BYTES = 32;
const MFA_JTI_BYTES = 16;
const MFA_BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type MfaFirstFactor = 'PASSWORD' | 'GOOGLE_OAUTH';

function mfaBase64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function mfaBase64UrlDecode(input: string): Uint8Array<ArrayBuffer> | null {
  if (!MFA_BASE64URL_PATTERN.test(input) || input.length % 4 === 1) {
    return null;
  }
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      out[index] = binary.charCodeAt(index);
    }
    return out;
  } catch {
    return null;
  }
}

async function importMfaSigningKey(signingKey: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  const keyBytes = mfaEncoder.encode(signingKey);
  if (keyBytes.length < MFA_SIGNING_KEY_MIN_BYTES) {
    throw new MfaError('MFA_SIGNING_KEY_INVALID', 'La clé de signature du défi MFA doit contenir au moins 32 octets.');
  }
  return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export interface IssueMfaChallengeParams {
  readonly userId: string;
  readonly firstFactor: MfaFirstFactor;
  /** Clé HMAC-SHA256 fournie par l'appelant (secret de l'environnement), jamais lue ici. */
  readonly signingKey: string;
  readonly nowEpochSec: number;
  readonly randomBytes?: MfaRandomBytes;
}

export interface IssuedMfaChallenge {
  readonly token: string;
  readonly jti: string;
  readonly expiresAtEpochSec: number;
}

/** Émet un mfa_challenge_token signé (HMAC-SHA256), lié à l'utilisateur et au premier facteur, valable 5 minutes. */
export async function issueMfaChallengeToken(params: IssueMfaChallengeParams): Promise<IssuedMfaChallenge> {
  const key = await importMfaSigningKey(params.signingKey, 'sign');
  const randomBytes = params.randomBytes ?? MFA_RANDOM_BYTES;
  const jti = mfaBase64UrlEncode(randomBytes(MFA_JTI_BYTES));
  const expiresAtEpochSec = params.nowEpochSec + MFA_CHALLENGE_TTL_SEC;
  const payload = mfaBase64UrlEncode(
    mfaEncoder.encode(
      JSON.stringify({
        typ: MFA_CHALLENGE_TYPE,
        sub: params.userId,
        ff: params.firstFactor,
        jti,
        iat: params.nowEpochSec,
        exp: expiresAtEpochSec,
      }),
    ),
  );
  const signingInput = `${MFA_CHALLENGE_PREFIX}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, mfaEncoder.encode(signingInput)));
  return { token: `${signingInput}.${mfaBase64UrlEncode(signature)}`, jti, expiresAtEpochSec };
}

export interface VerifyMfaChallengeParams {
  readonly token: string;
  readonly signingKey: string;
  readonly nowEpochSec: number;
  /** Si fourni, le jeton doit avoir été émis pour cet utilisateur. */
  readonly expectedUserId?: string;
}

export interface MfaChallengeClaims {
  readonly userId: string;
  readonly firstFactor: MfaFirstFactor;
  readonly jti: string;
  readonly issuedAtEpochSec: number;
  readonly expiresAtEpochSec: number;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Vérifie signature (temps constant, WebCrypto), type, expiration et, si demandé, l'utilisateur.
 * Ne vérifie PAS l'usage unique : c'est le rôle du port MfaChallengeStore (moteur).
 */
export async function verifyMfaChallengeToken(params: VerifyMfaChallengeParams): Promise<MfaChallengeClaims> {
  const key = await importMfaSigningKey(params.signingKey, 'verify');
  const parts = params.token.split('.');
  const prefix = parts[0];
  const payloadSegment = parts[1];
  const signatureSegment = parts[2];
  if (
    parts.length !== 3 ||
    prefix !== MFA_CHALLENGE_PREFIX ||
    payloadSegment === undefined ||
    signatureSegment === undefined
  ) {
    throw new MfaError('MFA_CHALLENGE_MALFORMED', 'Le jeton de défi MFA est mal formé.');
  }
  const signature = mfaBase64UrlDecode(signatureSegment);
  const payloadBytes = mfaBase64UrlDecode(payloadSegment);
  if (signature === null || payloadBytes === null) {
    throw new MfaError('MFA_CHALLENGE_MALFORMED', 'Le jeton de défi MFA est mal formé.');
  }
  const authentic = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    mfaEncoder.encode(`${prefix}.${payloadSegment}`),
  );
  if (!authentic) {
    throw new MfaError('MFA_CHALLENGE_SIGNATURE_INVALID', 'La signature du jeton de défi MFA est invalide.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    throw new MfaError('MFA_CHALLENGE_MALFORMED', 'Le jeton de défi MFA est mal formé.');
  }
  if (!isRecordValue(parsed)) {
    throw new MfaError('MFA_CHALLENGE_MALFORMED', 'Le jeton de défi MFA est mal formé.');
  }
  const { typ, sub, ff, jti, iat, exp } = parsed;
  if (
    typ !== MFA_CHALLENGE_TYPE ||
    typeof sub !== 'string' ||
    sub.length === 0 ||
    (ff !== 'PASSWORD' && ff !== 'GOOGLE_OAUTH') ||
    typeof jti !== 'string' ||
    jti.length === 0 ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    !Number.isSafeInteger(iat) ||
    !Number.isSafeInteger(exp)
  ) {
    throw new MfaError('MFA_CHALLENGE_MALFORMED', 'Le jeton de défi MFA est mal formé.');
  }
  if (exp <= params.nowEpochSec) {
    throw new MfaError('MFA_CHALLENGE_EXPIRED', 'Le jeton de défi MFA a expiré.');
  }
  if (params.expectedUserId !== undefined && params.expectedUserId !== sub) {
    throw new MfaError('MFA_CHALLENGE_USER_MISMATCH', 'Le jeton de défi MFA appartient à un autre utilisateur.');
  }
  return { userId: sub, firstFactor: ff, jti, issuedAtEpochSec: iat, expiresAtEpochSec: exp };
}
