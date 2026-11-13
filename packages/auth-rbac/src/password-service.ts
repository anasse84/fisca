/**
 * Service de mots de passe : PBKDF2-HMAC-SHA512 + pepper (ERRATA C et D-01), WebCrypto uniquement.
 *
 * Le coût (itérations) et la borne minimale acceptée (`minIterations`) forment UNE configuration. La production
 * est figée à 100 000 itérations (PRODUCTION_PASSWORD_SERVICE). Le hash stocké porte son nombre d'itérations
 * (`pbkdf2_sha512$<itérations>$<sel>$<empreinte>`) ; verify() REFUSE tout hash en dessous de `minIterations`
 * (garde-fou anti-rétrogradation). La fabrique générique createPasswordService n'est PAS exportée par l'index
 * public : seule la fabrique réservée aux tests (sous-chemin `@fisca/auth-rbac/testing`) l'utilise.
 */

export const PASSWORD_HASH_SCHEME = 'pbkdf2_sha512' as const;
export const PASSWORD_PBKDF2_ITERATIONS = 100000 as const;
export const PASSWORD_SALT_BYTES = 16 as const;
export const PASSWORD_DERIVED_BITS = 256 as const;
export const PASSWORD_MIN_LENGTH = 12 as const;
export const PASSWORD_MAX_LENGTH = 128 as const;

/** Format exact de production : pbkdf2_sha512$100000$<sel hex 32>$<empreinte hex 64> (ERRATA C et D-01). */
export const PASSWORD_HASH_FORMAT_REGEX = /^pbkdf2_sha512\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/;

const GENERIC_HASH_FORMAT_REGEX = /^pbkdf2_sha512\$([1-9][0-9]{0,8})\$[0-9a-f]{32}\$[0-9a-f]{64}$/;

export interface ParsedPasswordHash {
  readonly iterations: number;
  readonly saltHex: string;
  readonly hashHex: string;
}

const HEX_DIGITS = '0123456789abcdef';

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += HEX_DIGITS.charAt(byte >>> 4) + HEX_DIGITS.charAt(byte & 0x0f);
  }
  return out;
}

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

/** Comparaison en temps constant ; les longueurs différentes sont refusées (la longueur n'est pas secrète). */
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

/** Décode une empreinte stockée (toute itération bien formée) ; null, jamais d'exception, si le format est inexact. */
export function parseStoredPasswordHash(stored: string): ParsedPasswordHash | null {
  const match = GENERIC_HASH_FORMAT_REGEX.exec(stored);
  if (match === null) {
    return null;
  }
  const parts = stored.split('$');
  const saltHex = parts[2];
  const hashHex = parts[3];
  const iterations = Number(match[1]);
  if (saltHex === undefined || hashHex === undefined || !Number.isSafeInteger(iterations)) {
    return null;
  }
  return { iterations, saltHex, hashHex };
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

async function derivePasswordBytes(
  plainPassword: string,
  pepper: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${plainPassword}\u0000${pepper}`),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-512' },
    keyMaterial,
    PASSWORD_DERIVED_BITS,
  );
  return new Uint8Array(derived);
}

export interface PasswordServiceConfig {
  /** Itérations PBKDF2 des nouveaux hash. */
  readonly iterations: number;
  /** Borne minimale : tout hash stocké en dessous est refusé à la vérification. */
  readonly minIterations: number;
}

export interface PasswordService {
  readonly iterations: number;
  readonly minIterations: number;
  /**
   * `providedSaltHex` (32 caractères hexadécimaux minuscules) sert aux tests et à la revérification ;
   * sans lui, le sel est aléatoire.
   */
  hash(plainPassword: string, serverPepper: string, providedSaltHex?: string): Promise<string>;
  /** false (jamais d'exception) si hash malformé, sous la borne, hors politique, pepper vide ou non correspondant. */
  verify(plainPassword: string, serverPepper: string, storedHash: string): Promise<boolean>;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

/** Fabrique générique : NON exportée par l'index public (voir en-tête). */
export function createPasswordService(config: PasswordServiceConfig): PasswordService {
  const { iterations, minIterations } = config;
  if (!isPositiveSafeInteger(iterations) || !isPositiveSafeInteger(minIterations) || iterations < minIterations) {
    throw new Error('AUTH_PASSWORD_SERVICE_CONFIG_INVALID: itérations et borne doivent être des entiers positifs, itérations ≥ borne.');
  }
  return {
    iterations,
    minIterations,
    async hash(plainPassword, serverPepper, providedSaltHex) {
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
      const derived = await derivePasswordBytes(plainPassword, serverPepper, saltBytes, iterations);
      return `${PASSWORD_HASH_SCHEME}$${iterations}$${bytesToHex(saltBytes)}$${bytesToHex(derived)}`;
    },
    async verify(plainPassword, serverPepper, storedHash) {
      const parsed = parseStoredPasswordHash(storedHash);
      if (parsed === null || parsed.iterations < minIterations || serverPepper.length === 0) {
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
      const actual = await derivePasswordBytes(plainPassword, serverPepper, salt, parsed.iterations);
      return timingSafeEqualBytes(actual, expected);
    },
  };
}

/** Configuration de production : 100 000 itérations, borne 100 000 (ERRATA D-01). */
export const PRODUCTION_PASSWORD_SERVICE: PasswordService = createPasswordService({
  iterations: PASSWORD_PBKDF2_ITERATIONS,
  minIterations: PASSWORD_PBKDF2_ITERATIONS,
});

/** Empreinte bien formée qui ne correspond à aucun mot de passe, au coût du service : égalise le temps de calcul. */
export function decoyPasswordHash(service: PasswordService): string {
  return `${PASSWORD_HASH_SCHEME}$${service.iterations}$${'00'.repeat(16)}$${'00'.repeat(32)}`;
}
