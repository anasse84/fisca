/**
 * Connexion Email + mot de passe (CTR-API-03 ; Doc_09 § 02, ERRATA D-01).
 *
 * Flux : e-mail normalisé, verrouillage anti-bruteforce (15 min après 5 échecs), PBKDF2-HMAC-SHA512 + pepper
 * (AUTH_PEPPER, fourni par l'appelant), puis `completeFirstFactor` : défi MFA ou session directe.
 * Un e-mail inconnu, un compte sans mot de passe et un mauvais mot de passe donnent la même erreur, et une
 * dérivation PBKDF2 factice égalise le temps de réponse.
 */

import { LOCKOUT_DEFAULT_POLICY, PRODUCTION_PASSWORD_SERVICE, authenticatePassword, decoyPasswordHash, initialLockoutState } from './auth-2fa.ts';
import type { PasswordService } from './auth-2fa.ts';
import type { LockoutState } from './auth-2fa.ts';
import { completeFirstFactor } from './first-factor.ts';
import type { FirstFactorDeps, FirstFactorOutcome } from './first-factor.ts';
import { normalizeEmail } from './oauth-google.ts';

export interface PasswordAccount {
  readonly userId: string;
  /** NULL si le compte a été créé exclusivement via Google. */
  readonly passwordHash: string | null;
  readonly lockout: LockoutState;
}

/** Port des comptes (table `users`, S1B). */
export interface PasswordAccountStore {
  findByEmailNormalized(emailNormalized: string): Promise<PasswordAccount | null>;
  saveLockoutState(userId: string, state: LockoutState): Promise<void>;
}

export interface LoginDeps {
  readonly accounts: PasswordAccountStore;
  /** Valeur du secret AUTH_PEPPER (CTR-SEC-01). */
  readonly pepper: string;
  readonly flow: FirstFactorDeps;
  /** Configuration de mots de passe ; production (100 000 itérations, borne 100 000) par défaut. */
  readonly passwordService?: PasswordService;
}

export type LoginErrorCode = 'LOGIN_INVALID_CREDENTIALS' | 'LOGIN_ACCOUNT_LOCKED';

export class LoginError extends Error {
  readonly code: LoginErrorCode;
  /** Secondes avant la fin du verrou (0 hors verrou). */
  readonly retryAfterSec: number;

  constructor(code: LoginErrorCode, message: string, retryAfterSec = 0) {
    super(`${code}: ${message}`);
    this.name = 'LoginError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export async function loginWithPassword(
  deps: LoginDeps,
  input: { readonly email: string; readonly password: string },
): Promise<FirstFactorOutcome> {
  const nowEpochMs = deps.flow.mfa.nowEpochSec() * 1000;
  const passwordService = deps.passwordService ?? PRODUCTION_PASSWORD_SERVICE;
  const account = await deps.accounts.findByEmailNormalized(normalizeEmail(input.email));
  if (account === null || account.passwordHash === null) {
    await authenticatePassword({
      plainPassword: input.password,
      pepper: deps.pepper,
      storedHash: decoyPasswordHash(passwordService),
      state: initialLockoutState(),
      nowEpochMs,
      passwordService,
    });
    throw new LoginError('LOGIN_INVALID_CREDENTIALS', 'identifiants invalides.');
  }
  const result = await authenticatePassword({
    plainPassword: input.password,
    pepper: deps.pepper,
    storedHash: account.passwordHash,
    state: account.lockout,
    nowEpochMs,
    policy: LOCKOUT_DEFAULT_POLICY,
    passwordService,
  });
  if (result.outcome === 'LOCKED') {
    throw new LoginError('LOGIN_ACCOUNT_LOCKED', 'compte temporairement verrouillé.', Math.ceil(result.retryAfterMs / 1000));
  }
  await deps.accounts.saveLockoutState(account.userId, result.state);
  if (result.outcome === 'FAILURE') {
    throw new LoginError('LOGIN_INVALID_CREDENTIALS', 'identifiants invalides.');
  }
  return completeFirstFactor(deps.flow, { userId: account.userId, firstFactor: 'PASSWORD' });
}
