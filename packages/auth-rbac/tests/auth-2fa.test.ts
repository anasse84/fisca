import { describe, expect, it } from 'vitest';
import {
  LOCKOUT_DEFAULT_POLICY,
  PASSWORD_HASH_FORMAT_REGEX,
  PASSWORD_PBKDF2_ITERATIONS,
  PRODUCTION_PASSWORD_SERVICE,
  authenticatePassword,
  hashPasswordWorkerSafe,
  initialLockoutState,
  isLockedOut,
  parseStoredPasswordHash,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  timingSafeEqualBytes,
  verifyPasswordWorkerSafe,
} from '../src/index.ts';
import { TEST_PASSWORD_ITERATIONS, createLowCostPasswordService } from '../src/testing.ts';

// Valeurs factices de test uniquement : jamais le vrai secret AUTH_PEPPER.
const TEST_PEPPER = 'pepper-factice-de-test-uniquement';
const OTHER_PEPPER = 'autre-pepper-factice-de-test';
const PASSWORD = 'Correct-Horse-Battery-42';
const FIXED_SALT_HEX = '00112233445566778899aabbccddeeff';
// Coût bas réservé aux tests (fabrique non exportée par l'index public) ; un seul test garde le coût réel.
const LOW = createLowCostPasswordService();
const LOW_HASH_FORMAT_REGEX = new RegExp(`^pbkdf2_sha512\\$${TEST_PASSWORD_ITERATIONS}\\$[0-9a-f]{32}\\$[0-9a-f]{64}$`);

describe('hashPasswordWorkerSafe : format', () => {
  it('produit pbkdf2_sha512$100000$<sel hex 32>$<empreinte hex 64>', async () => {
    // Seul test au coût réel : prouve le paramètre de production (un hash + une vérification à 100 000 itérations).
    const stored = await hashPasswordWorkerSafe(PASSWORD, TEST_PEPPER);
    expect(stored).toMatch(/^pbkdf2_sha512\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(stored).toMatch(PASSWORD_HASH_FORMAT_REGEX);
    const parts = stored.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2_sha512');
    expect(stored.split('$')[1]).toBe('100000');
    await expect(verifyPasswordWorkerSafe(PASSWORD, TEST_PEPPER, stored)).resolves.toBe(true);
  }, 20_000);

  it('utilise exactement 100000 itérations', () => {
    expect(PASSWORD_PBKDF2_ITERATIONS).toBe(100000);
    expect(PRODUCTION_PASSWORD_SERVICE.iterations).toBe(100000);
  });

  it('tire un sel aléatoire distinct à chaque appel', async () => {
    const first = await LOW.hash(PASSWORD, TEST_PEPPER);
    const second = await LOW.hash(PASSWORD, TEST_PEPPER);
    expect(first.split('$')[2]).not.toBe(second.split('$')[2]);
    expect(first).not.toBe(second);
  });

  it('est déterministe pour un sel fourni et change avec le pepper', async () => {
    const a = await LOW.hash(PASSWORD, TEST_PEPPER, FIXED_SALT_HEX);
    const b = await LOW.hash(PASSWORD, TEST_PEPPER, FIXED_SALT_HEX);
    const c = await LOW.hash(PASSWORD, OTHER_PEPPER, FIXED_SALT_HEX);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.split('$')[2]).toBe(FIXED_SALT_HEX);
  });

  it('applique la politique de longueur 12 à 128 caractères', async () => {
    await expect(LOW.hash('court', TEST_PEPPER)).rejects.toThrow('AUTH_PASSWORD_LENGTH_POLICY');
    await expect(LOW.hash('x'.repeat(129), TEST_PEPPER)).rejects.toThrow('AUTH_PASSWORD_LENGTH_POLICY');
    await expect(LOW.hash('x'.repeat(12), TEST_PEPPER)).resolves.toMatch(LOW_HASH_FORMAT_REGEX);
    await expect(LOW.hash('x'.repeat(128), TEST_PEPPER)).resolves.toMatch(LOW_HASH_FORMAT_REGEX);
  });

  it('refuse un pepper vide et un sel fourni invalide', async () => {
    await expect(LOW.hash(PASSWORD, '')).rejects.toThrow('AUTH_PEPPER_MISSING');
    await expect(LOW.hash(PASSWORD, TEST_PEPPER, 'zz')).rejects.toThrow('AUTH_SALT_INVALID');
    await expect(LOW.hash(PASSWORD, TEST_PEPPER, '00ff')).rejects.toThrow('AUTH_SALT_INVALID');
  });
});

describe('verifyPasswordWorkerSafe', () => {
  it('accepte le bon mot de passe avec le bon pepper', async () => {
    const stored = await LOW.hash(PASSWORD, TEST_PEPPER);
    await expect(LOW.verify(PASSWORD, TEST_PEPPER, stored)).resolves.toBe(true);
  });

  it('refuse un mot de passe faux', async () => {
    const stored = await LOW.hash(PASSWORD, TEST_PEPPER);
    await expect(LOW.verify('Mauvais-Mot-De-Passe-1', TEST_PEPPER, stored)).resolves.toBe(false);
  });

  it('refuse un pepper différent', async () => {
    const stored = await LOW.hash(PASSWORD, TEST_PEPPER);
    await expect(LOW.verify(PASSWORD, OTHER_PEPPER, stored)).resolves.toBe(false);
  });

  it('refuse sans exception un mot de passe hors politique ou un pepper vide', async () => {
    const stored = await LOW.hash(PASSWORD, TEST_PEPPER);
    await expect(LOW.verify('court', TEST_PEPPER, stored)).resolves.toBe(false);
    await expect(LOW.verify(PASSWORD, '', stored)).resolves.toBe(false);
  });

  it('refuse sans exception toute empreinte malformée', async () => {
    const good = await LOW.hash(PASSWORD, TEST_PEPPER, FIXED_SALT_HEX);
    const [, , salt, digest] = good.split('$');
    const malformed: readonly string[] = [
      '',
      'n-importe-quoi',
      'pbkdf2_sha512$100000$$',
      `pbkdf2_sha512$100000$${salt}`,
      `pbkdf2_sha512$100000$${salt}$${digest}$extra`,
      `pbkdf2_sha256$100000$${salt}$${digest}`,
      `pbkdf2_sha512$100000$${salt}$${String(digest).slice(0, 62)}`,
      `pbkdf2_sha512$100000$${String(salt).slice(0, 30)}$${digest}`,
      `pbkdf2_sha512$100000$${'g'.repeat(32)}$${digest}`,
      `pbkdf2_sha512$100000$${salt}$${'z'.repeat(64)}`,
      `PBKDF2_SHA512$100000$${salt}$${digest}`,
      `pbkdf2_sha512$100000$${String(salt).toUpperCase()}$${digest}`,
    ];
    // 99999 itérations : bien formé (le hash porte son coût) mais sous la borne de production, donc refusé.
    const belowBound = `pbkdf2_sha512$99999$${salt}$${digest}`;
    expect(parseStoredPasswordHash(belowBound)?.iterations).toBe(99999);
    await expect(verifyPasswordWorkerSafe(PASSWORD, TEST_PEPPER, belowBound)).resolves.toBe(false);
    for (const candidate of malformed) {
      expect(parseStoredPasswordHash(candidate)).toBeNull();
      await expect(LOW.verify(PASSWORD, TEST_PEPPER, candidate)).resolves.toBe(false);
    }
  });

  it('parseStoredPasswordHash décode une empreinte valide', async () => {
    const good = await LOW.hash(PASSWORD, TEST_PEPPER, FIXED_SALT_HEX);
    const parsed = parseStoredPasswordHash(good.replace(`$${TEST_PASSWORD_ITERATIONS}$`, '$100000$'));
    expect(parsed).not.toBeNull();
    expect(parsed?.saltHex).toBe(FIXED_SALT_HEX);
    expect(parsed?.iterations).toBe(100000);
    expect(parsed?.hashHex).toHaveLength(64);
  });
});

describe('timingSafeEqualBytes (comparaison en temps constant)', () => {
  it('compare octet à octet sur toute la longueur', () => {
    const base = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(timingSafeEqualBytes(base, new Uint8Array(base))).toBe(true);
    for (let index = 0; index < base.length; index += 1) {
      const altered = new Uint8Array(base);
      altered[index] = (altered[index] ?? 0) ^ 0xff;
      expect(timingSafeEqualBytes(base, altered)).toBe(false);
    }
  });

  it('refuse deux longueurs différentes et accepte deux tableaux vides', () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(timingSafeEqualBytes(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });
});

describe('verrouillage anti-bruteforce (logique pure, heure injectée)', () => {
  const T0 = 1_700_000_000_000;
  const policy = LOCKOUT_DEFAULT_POLICY;

  it('la politique par défaut est 5 échecs consécutifs puis 15 minutes', () => {
    expect(policy.maxConsecutiveFailures).toBe(5);
    expect(policy.lockDurationMs).toBe(15 * 60 * 1000);
  });

  it('ne verrouille pas avant N échecs', () => {
    let state = initialLockoutState();
    for (let attempt = 1; attempt < policy.maxConsecutiveFailures; attempt += 1) {
      state = recordFailedAttempt(state, T0, policy);
      expect(state.consecutiveFailures).toBe(attempt);
      expect(isLockedOut(state, T0)).toBe(false);
    }
  });

  it('verrouille au N-ième échec pour la durée prévue', () => {
    let state = initialLockoutState();
    for (let attempt = 0; attempt < policy.maxConsecutiveFailures; attempt += 1) {
      state = recordFailedAttempt(state, T0, policy);
    }
    expect(state.lockedUntilEpochMs).toBe(T0 + policy.lockDurationMs);
    expect(isLockedOut(state, T0)).toBe(true);
    expect(isLockedOut(state, T0 + policy.lockDurationMs - 1)).toBe(true);
  });

  it('déverrouille après le délai et repart d’un compteur neuf', () => {
    let state = initialLockoutState();
    for (let attempt = 0; attempt < policy.maxConsecutiveFailures; attempt += 1) {
      state = recordFailedAttempt(state, T0, policy);
    }
    const later = T0 + policy.lockDurationMs;
    expect(isLockedOut(state, later)).toBe(false);
    const afterOne = recordFailedAttempt(state, later, policy);
    expect(afterOne.consecutiveFailures).toBe(1);
    expect(afterOne.lockedUntilEpochMs).toBeNull();
  });

  it('un échec pendant le verrou ne le prolonge pas', () => {
    let state = initialLockoutState();
    for (let attempt = 0; attempt < policy.maxConsecutiveFailures; attempt += 1) {
      state = recordFailedAttempt(state, T0, policy);
    }
    const during = recordFailedAttempt(state, T0 + 1000, policy);
    expect(during).toEqual(state);
  });

  it('réinitialise au succès', () => {
    const afterTwo = recordFailedAttempt(recordFailedAttempt(initialLockoutState(), T0, policy), T0, policy);
    expect(afterTwo.consecutiveFailures).toBe(2);
    expect(recordSuccessfulAttempt()).toEqual(initialLockoutState());
    expect(recordSuccessfulAttempt().consecutiveFailures).toBe(0);
  });

  it('rejette une heure ou une politique non entière', () => {
    expect(() => recordFailedAttempt(initialLockoutState(), 1.5, policy)).toThrow('AUTH_LOCKOUT_INVALID_INPUT');
    expect(() => isLockedOut(initialLockoutState(), Number.NaN)).toThrow('AUTH_LOCKOUT_INVALID_INPUT');
    expect(() =>
      recordFailedAttempt(initialLockoutState(), T0, { maxConsecutiveFailures: 0, lockDurationMs: 1000 }),
    ).toThrow('AUTH_LOCKOUT_INVALID_INPUT');
  });
});

describe('authenticatePassword (vérification + verrouillage)', () => {
  const T0 = 1_700_000_000_000;

  it('verrouille après 5 mauvais mots de passe, refuse même le bon, puis déverrouille', async () => {
    const storedHash = await LOW.hash(PASSWORD, TEST_PEPPER);
    let state = initialLockoutState();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await authenticatePassword({
        plainPassword: 'Mauvais-Mot-De-Passe-1',
        pepper: TEST_PEPPER,
        storedHash,
        state,
        nowEpochMs: T0,
        passwordService: LOW,
      });
      expect(result.outcome).toBe('FAILURE');
      state = result.state;
    }
    const locked = await authenticatePassword({
      plainPassword: PASSWORD,
      pepper: TEST_PEPPER,
      storedHash,
      state,
      nowEpochMs: T0 + 1000,
      passwordService: LOW,
    });
    expect(locked.outcome).toBe('LOCKED');
    expect(locked.retryAfterMs).toBe(15 * 60 * 1000 - 1000);

    const unlocked = await authenticatePassword({
      plainPassword: PASSWORD,
      pepper: TEST_PEPPER,
      storedHash,
      state,
      nowEpochMs: T0 + 15 * 60 * 1000,
      passwordService: LOW,
    });
    expect(unlocked.outcome).toBe('SUCCESS');
    expect(unlocked.state).toEqual(initialLockoutState());
  });

  it('un succès remet le compteur à zéro', async () => {
    const storedHash = await LOW.hash(PASSWORD, TEST_PEPPER);
    const failed = await authenticatePassword({
      plainPassword: 'Mauvais-Mot-De-Passe-1',
      pepper: TEST_PEPPER,
      storedHash,
      state: initialLockoutState(),
      nowEpochMs: T0,
      passwordService: LOW,
    });
    expect(failed.state.consecutiveFailures).toBe(1);
    const ok = await authenticatePassword({
      plainPassword: PASSWORD,
      pepper: TEST_PEPPER,
      storedHash,
      state: failed.state,
      nowEpochMs: T0 + 10,
      passwordService: LOW,
    });
    expect(ok.outcome).toBe('SUCCESS');
    expect(ok.state.consecutiveFailures).toBe(0);
  });

  it('compte une empreinte malformée comme un échec, sans exception', async () => {
    const result = await authenticatePassword({
      plainPassword: PASSWORD,
      pepper: TEST_PEPPER,
      storedHash: 'malformee',
      state: initialLockoutState(),
      nowEpochMs: T0,
      passwordService: LOW,
    });
    expect(result.outcome).toBe('FAILURE');
    expect(result.state.consecutiveFailures).toBe(1);
  });
});
