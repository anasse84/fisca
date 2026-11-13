/**
 * Consommation du jeton de réinitialisation émis par password/forgot (CTR-API-41, DRAFT). Doc_09 § 02, ERRATA D-01.
 *
 * Ordre : politique du mot de passe, hachage (PBKDF2-SHA512 + pepper, calculé même si le jeton est invalide : pas de
 * différence de durée), consommation atomique du jeton, expiration, puis révocation de TOUTES les familles de refresh
 * de l'utilisateur AVANT l'écriture du nouveau hash (un échec laisse au pire l'utilisateur déconnecté, jamais une
 * ancienne session vivante sous un nouveau mot de passe). Aucune session n'est créée.
 * Jeton rejoué, expiré, falsifié, inconnu, d'un autre usage ou compte disparu : une seule erreur, PASSWORD_RESET_TOKEN_INVALID.
 * Les stockages sont des ports (table `users`, jetons, refresh : S1B) ; aucune horloge lue ici.
 */

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PRODUCTION_PASSWORD_SERVICE } from './auth-2fa.ts';
import type { PasswordService } from './auth-2fa.ts';
import { hashOneTimeToken } from './account-lifecycle.ts';
import type { OneTimeTokenStore } from './account-lifecycle.ts';
import type { RefreshTokenStore } from './refresh-session.ts';

const MAX_TOKEN_LENGTH = 256;

/** Port d'écriture du hash de mot de passe (table `users`, S1B). */
export interface PasswordCredentialStore {
  /** Remplace le hash ; false si le compte n'existe plus. */
  setPasswordHash(userId: string, passwordHash: string, atEpochSec: number): Promise<boolean>;
}

/** Port d'index des familles de refresh d'un utilisateur (S1B) : identifiants de toutes ses familles. */
export interface RefreshFamilyIndex {
  listFamilyIds(userId: string): Promise<readonly string[]>;
}

export interface PasswordResetDeps {
  readonly resetTokens: OneTimeTokenStore;
  readonly credentials: PasswordCredentialStore;
  readonly refreshFamilies: RefreshFamilyIndex;
  readonly refreshStore: Pick<RefreshTokenStore, 'revokeFamily'>;
  /** Valeur du secret AUTH_PEPPER (CTR-SEC-01). */
  readonly pepper: string;
  /** Configuration de mots de passe ; production (100 000 itérations, borne 100 000) par défaut. */
  readonly passwordService?: PasswordService;
  readonly nowEpochSec: () => number;
}

export type PasswordResetErrorCode = 'PASSWORD_RESET_INPUT_INVALID' | 'PASSWORD_RESET_TOKEN_INVALID';

export class PasswordResetError extends Error {
  readonly code: PasswordResetErrorCode;

  constructor(code: PasswordResetErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'PasswordResetError';
    this.code = code;
  }
}

/** Réinitialise le mot de passe ; retourne l'utilisateur concerné. Lève PasswordResetError. */
export async function resetPassword(
  deps: PasswordResetDeps,
  input: { readonly token: string; readonly newPassword: string },
): Promise<{ readonly userId: string }> {
  if (input.newPassword.length < PASSWORD_MIN_LENGTH || input.newPassword.length > PASSWORD_MAX_LENGTH) {
    throw new PasswordResetError('PASSWORD_RESET_INPUT_INVALID', `le mot de passe doit contenir entre ${PASSWORD_MIN_LENGTH} et ${PASSWORD_MAX_LENGTH} caractères.`);
  }
  const passwordHash = await (deps.passwordService ?? PRODUCTION_PASSWORD_SERVICE).hash(input.newPassword, deps.pepper);
  if (input.token.length === 0 || input.token.length > MAX_TOKEN_LENGTH) {
    throw new PasswordResetError('PASSWORD_RESET_TOKEN_INVALID', 'jeton invalide.');
  }
  const record = await deps.resetTokens.consume(await hashOneTimeToken('password-reset', input.token));
  const now = deps.nowEpochSec();
  if (record === null || now >= record.expiresAtEpochSec) {
    throw new PasswordResetError('PASSWORD_RESET_TOKEN_INVALID', 'jeton invalide.');
  }
  for (const familyId of await deps.refreshFamilies.listFamilyIds(record.userId)) {
    await deps.refreshStore.revokeFamily(familyId, now);
  }
  if (!(await deps.credentials.setPasswordHash(record.userId, passwordHash, now))) {
    throw new PasswordResetError('PASSWORD_RESET_TOKEN_INVALID', 'jeton invalide.');
  }
  return { userId: record.userId };
}
