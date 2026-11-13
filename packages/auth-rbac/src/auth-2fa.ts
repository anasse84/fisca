/**
 * CTR-COD-07 « auth-2fa » (Doc_09 § 02, ERRATA D-01 et section C).
 *
 * Ticket T-S1A-01 : hachage de mot de passe PBKDF2-HMAC-SHA512 + pepper, comparaison en temps constant
 * et verrouillage anti-bruteforce. WebCrypto uniquement (compatible Cloudflare Workers).
 * Le pepper (secret AUTH_PEPPER) est toujours fourni par l'appelant ; ce module ne lit aucun environnement.
 * L'horloge n'est jamais lue ici : l'heure est un paramètre.
 *
 * Les autres exports du contrat (verifyTotpCodeRfc6238, mfa_challenge_token) arrivent au ticket T-S1A-03
 * et s'ajoutent dans la section « 2FA » en fin de fichier.
 */

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
// Mot de passe : PBKDF2-HMAC-SHA512 + pepper
// ---------------------------------------------------------------------------

export const PASSWORD_HASH_SCHEME = 'pbkdf2_sha512' as const;
export const PASSWORD_PBKDF2_ITERATIONS = 100000 as const;
export const PASSWORD_SALT_BYTES = 16 as const;
export const PASSWORD_DERIVED_BITS = 256 as const;
export const PASSWORD_MIN_LENGTH = 12 as const;
export const PASSWORD_MAX_LENGTH = 128 as const;

/** Format exact : pbkdf2_sha512$100000$<sel hex 32>$<empreinte hex 64> (ERRATA C et D-01). */
export const PASSWORD_HASH_FORMAT_REGEX = /^pbkdf2_sha512\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/;

export interface ParsedPasswordHash {
  readonly iterations: typeof PASSWORD_PBKDF2_ITERATIONS;
  readonly saltHex: string;
  readonly hashHex: string;
}

/** Décode une empreinte stockée ; renvoie null (jamais d'exception) si le format n'est pas exact. */
export function parseStoredPasswordHash(stored: string): ParsedPasswordHash | null {
  if (!PASSWORD_HASH_FORMAT_REGEX.test(stored)) {
    return null;
  }
  const parts = stored.split('$');
  const saltHex = parts[2];
  const hashHex = parts[3];
  if (saltHex === undefined || hashHex === undefined) {
    return null;
  }
  return { iterations: PASSWORD_PBKDF2_ITERATIONS, saltHex, hashHex };
}

/**
 * Comparaison en temps constant : parcourt toute la longueur et accumule les différences par OU exclusif,
 * sans sortie anticipée sur le contenu. Les longueurs différentes sont refusées (la longueur n'est pas secrète).
 */
export function timingSafeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

function assertPasswordPolicy(plainPassword: string): void {
  if (plainPassword.length < PASSWORD_MIN_LENGTH || plainPassword.length > PASSWORD_MAX_LENGTH) {
    throw new Error('AUTH_PASSWORD_LENGTH_POLICY: Le mot de passe doit contenir entre 12 et 128 caractères.');
  }
}

function assertPepper(pepper: string): void {
  if (pepper.length === 0) {
    throw new Error('AUTH_PEPPER_MISSING: Le secret AUTH_PEPPER doit être fourni par l’appelant.');
  }
}

async function derivePasswordBytes(plainPassword: string, pepper: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${plainPassword}\u0000${pepper}`),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PASSWORD_PBKDF2_ITERATIONS, hash: 'SHA-512' },
    keyMaterial,
    PASSWORD_DERIVED_BITS,
  );
  return new Uint8Array(derived);
}

/**
 * Hache un mot de passe en WebCrypto natif (PBKDF2-HMAC-SHA512, 100 000 itérations, sel de 16 octets, pepper).
 * `providedSaltHex` (32 caractères hexadécimaux minuscules) sert aux tests et à la revérification ;
 * sans lui, le sel est aléatoire.
 */
export async function hashPasswordWorkerSafe(
  plainPassword: string,
  serverPepper: string,
  providedSaltHex?: string,
): Promise<string> {
  assertPasswordPolicy(plainPassword);
  assertPepper(serverPepper);
  let saltBytes: Uint8Array<ArrayBuffer>;
  if (providedSaltHex === undefined) {
    saltBytes = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  } else {
    const decoded = hexToBytes(providedSaltHex);
    if (decoded === null || decoded.length !== PASSWORD_SALT_BYTES) {
      throw new Error('AUTH_SALT_INVALID: Le sel doit contenir exactement 16 octets en hexadécimal minuscule.');
    }
    saltBytes = decoded;
  }
  const derived = await derivePasswordBytes(plainPassword, serverPepper, saltBytes);
  return `${PASSWORD_HASH_SCHEME}$${PASSWORD_PBKDF2_ITERATIONS}$${bytesToHex(saltBytes)}$${bytesToHex(derived)}`;
}

/**
 * Vérifie un mot de passe contre une empreinte stockée. Renvoie false (jamais d'exception) si l'empreinte est
 * malformée, si le mot de passe est hors politique, si le pepper est vide ou si l'empreinte ne correspond pas.
 * La comparaison se fait en temps constant.
 */
export async function verifyPasswordWorkerSafe(
  plainPassword: string,
  serverPepper: string,
  storedHash: string,
): Promise<boolean> {
  const parsed = parseStoredPasswordHash(storedHash);
  if (parsed === null || serverPepper.length === 0) {
    return false;
  }
  if (plainPassword.length < PASSWORD_MIN_LENGTH || plainPassword.length > PASSWORD_MAX_LENGTH) {
    return false;
  }
  const salt = hexToBytes(parsed.saltHex);
  const expected = hexToBytes(parsed.hashHex);
  if (salt === null || expected === null) {
    return false;
  }
  const actual = await derivePasswordBytes(plainPassword, serverPepper, salt);
  return timingSafeEqualBytes(actual, expected);
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
  const ok = await verifyPasswordWorkerSafe(params.plainPassword, params.pepper, params.storedHash);
  if (ok) {
    return { outcome: 'SUCCESS', state: recordSuccessfulAttempt(), retryAfterMs: 0 };
  }
  const next = recordFailedAttempt(params.state, params.nowEpochMs, policy);
  const retryAfterMs = next.lockedUntilEpochMs === null ? 0 : next.lockedUntilEpochMs - params.nowEpochMs;
  return { outcome: 'FAILURE', state: next, retryAfterMs };
}

// ---------------------------------------------------------------------------
// 2FA (verifyTotpCodeRfc6238, mfa_challenge_token) : ticket T-S1A-03, à ajouter ici.
// ---------------------------------------------------------------------------
