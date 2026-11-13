/**
 * Cycle de vie du compte e-mail + mot de passe : inscription (CTR-API-01), vérification d'e-mail (CTR-API-02) et
 * demande de réinitialisation (CTR-API-06). Doc_09 § 02 et Doc_07 § 02, ERRATA D-01.
 *
 * - register : compte NON vérifié, mot de passe haché par hashPasswordWorkerSafe (politique de auth-2fa.ts).
 *   Le résultat est identique que l'e-mail existe ou non (anti-énumération) ; le hachage est calculé dans tous les cas.
 * - verify-email : consomme un jeton à usage unique et expirant. Seule l'empreinte SHA-256 (préfixée par l'usage)
 *   est stockée ; un jeton de réinitialisation ne vérifie jamais un e-mail.
 * - password/forgot : émet un jeton de réinitialisation à usage unique (15 minutes, Doc_07 § 02) pour un compte
 *   existant, sans rien révéler. La route qui CONSOMME ce jeton n'existe pas au registre : elle n'est pas créée ici.
 * Tous les stockages et l'envoi d'e-mail sont des ports : tables `users` et jetons (S1B), envoi SES (P3-C).
 * Aucun envoi réel, aucune horloge lue ici.
 */

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hashPasswordWorkerSafe } from './auth-2fa.ts';
import { encodeBase64Url, secureRandomBytes, sha256Bytes } from './encoding.ts';
import type { RandomSource } from './encoding.ts';
import { normalizeEmail } from './oauth-google.ts';
import type { EmailProofSender } from './oauth-google.ts';

/** Durée de vie du jeton de vérification : non fixée par la spec, valeur de conception surchargeable. */
export const EMAIL_VERIFICATION_DEFAULT_TTL_SEC = 24 * 3600;
/** Doc_07 § 02 : lien de réinitialisation valable 15 minutes. */
export const PASSWORD_RESET_TTL_SEC = 900 as const;
const TOKEN_BYTES = 32;
const MAX_TOKEN_LENGTH = 256;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface OneTimeTokenRecord {
  /** Empreinte SHA-256 base64url du jeton ; le jeton en clair n'est jamais stocké. */
  readonly tokenHash: string;
  readonly userId: string;
  readonly emailNormalized: string;
  readonly expiresAtEpochSec: number;
}

/** Port de stockage de jetons à usage unique (table S1B). */
export interface OneTimeTokenStore {
  /** Enregistre le jeton et remplace tout jeton antérieur du même utilisateur (un seul jeton actif). */
  save(record: OneTimeTokenRecord): Promise<void>;
  /** Lecture ET suppression atomiques : null si l'empreinte est inconnue ou déjà consommée. */
  consume(tokenHash: string): Promise<OneTimeTokenRecord | null>;
}

export type RegistrationInsertResult =
  | { readonly kind: 'CREATED' }
  | { readonly kind: 'EMAIL_TAKEN'; readonly userId: string; readonly emailVerified: boolean };

export interface NewUnverifiedAccount {
  readonly userId: string;
  readonly emailNormalized: string;
  readonly passwordHash: string;
  readonly createdAtEpochSec: number;
}

/** Port des comptes (table `users`, S1B). */
export interface AccountRegistrationStore {
  /** Insère un compte non vérifié, sauf si l'e-mail existe déjà (insertion atomique sur contrainte d'unicité). */
  createUnverifiedAccount(input: NewUnverifiedAccount): Promise<RegistrationInsertResult>;
  findByEmailNormalized(emailNormalized: string): Promise<{ readonly userId: string; readonly emailVerified: boolean } | null>;
  /** Passe is_email_verified à 1 ; false si le compte n'existe plus. */
  markEmailVerified(userId: string, atEpochSec: number): Promise<boolean>;
}

export interface AccountEmailMessage {
  readonly emailNormalized: string;
  /** Jeton en clair à placer dans le lien envoyé ; seule son empreinte est stockée. */
  readonly token: string;
}

/**
 * Port d'envoi : étend EmailProofSender (preuve de liaison Google) avec les deux e-mails de ce cycle de vie.
 * Un seul adaptateur SES (P3-C) peut implémenter l'ensemble.
 */
export interface AccountEmailSender extends EmailProofSender {
  sendVerificationEmail(message: AccountEmailMessage): Promise<void>;
  sendPasswordResetEmail(message: AccountEmailMessage): Promise<void>;
}

export type DeliveryKind = 'verification' | 'reset';

export interface AccountLifecycleDeps {
  readonly accounts: AccountRegistrationStore;
  readonly verificationTokens: OneTimeTokenStore;
  readonly resetTokens: OneTimeTokenStore;
  readonly email: AccountEmailSender;
  /** Valeur du secret AUTH_PEPPER (CTR-SEC-01). */
  readonly pepper: string;
  readonly nowEpochSec: () => number;
  readonly randomBytes?: RandomSource;
  readonly newUserId?: () => string;
  readonly verificationTtlSec?: number;
  /** Appelé quand l'envoi échoue : la réponse HTTP reste identique (anti-énumération). */
  readonly reportDeliveryFailure?: (kind: DeliveryKind, error: unknown) => void;
}

export type AccountLifecycleErrorCode = 'REGISTRATION_INPUT_INVALID' | 'VERIFICATION_TOKEN_INVALID' | 'VERIFICATION_TOKEN_EXPIRED';

export class AccountLifecycleError extends Error {
  readonly code: AccountLifecycleErrorCode;

  constructor(code: AccountLifecycleErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'AccountLifecycleError';
    this.code = code;
  }
}

type TokenPurpose = 'email-verify' | 'password-reset';

const textEncoder = new TextEncoder();

async function hashToken(purpose: TokenPurpose, token: string): Promise<string> {
  return encodeBase64Url(await sha256Bytes(textEncoder.encode(`fisca:${purpose}:${token}`)));
}

/** Empreinte stable d'une adresse pour les clés de limitation de débit (l'adresse n'y figure jamais en clair). */
export async function hashEmailForRateKey(emailNormalized: string): Promise<string> {
  return encodeBase64Url(await sha256Bytes(textEncoder.encode(`fisca:rate-email:${emailNormalized}`)));
}

function isEmailShaped(emailNormalized: string): boolean {
  return emailNormalized.length <= MAX_EMAIL_LENGTH && EMAIL_SHAPE.test(emailNormalized);
}

async function issueToken(
  deps: AccountLifecycleDeps,
  purpose: TokenPurpose,
  store: OneTimeTokenStore,
  ttlSec: number,
  user: { readonly userId: string; readonly emailNormalized: string },
): Promise<string> {
  const token = encodeBase64Url((deps.randomBytes ?? secureRandomBytes)(TOKEN_BYTES));
  await store.save({
    tokenHash: await hashToken(purpose, token),
    userId: user.userId,
    emailNormalized: user.emailNormalized,
    expiresAtEpochSec: deps.nowEpochSec() + ttlSec,
  });
  return token;
}

async function deliver(deps: AccountLifecycleDeps, kind: DeliveryKind, message: AccountEmailMessage): Promise<void> {
  try {
    await (kind === 'verification' ? deps.email.sendVerificationEmail(message) : deps.email.sendPasswordResetEmail(message));
  } catch (error) {
    deps.reportDeliveryFailure?.(kind, error);
  }
}

async function sendVerification(deps: AccountLifecycleDeps, user: { readonly userId: string; readonly emailNormalized: string }): Promise<void> {
  const token = await issueToken(deps, 'email-verify', deps.verificationTokens, deps.verificationTtlSec ?? EMAIL_VERIFICATION_DEFAULT_TTL_SEC, user);
  await deliver(deps, 'verification', { emailNormalized: user.emailNormalized, token });
}

/**
 * Inscription. Lève AccountLifecycleError REGISTRATION_INPUT_INVALID si l'e-mail ou le mot de passe (12 à 128
 * caractères) est invalide ; sinon retourne sans rien révéler de l'existence du compte.
 */
export async function registerAccount(
  deps: AccountLifecycleDeps,
  input: { readonly email: string; readonly password: string },
): Promise<void> {
  const emailNormalized = normalizeEmail(input.email);
  if (!isEmailShaped(emailNormalized)) {
    throw new AccountLifecycleError('REGISTRATION_INPUT_INVALID', 'adresse e-mail invalide.');
  }
  if (input.password.length < PASSWORD_MIN_LENGTH || input.password.length > PASSWORD_MAX_LENGTH) {
    throw new AccountLifecycleError('REGISTRATION_INPUT_INVALID', `le mot de passe doit contenir entre ${PASSWORD_MIN_LENGTH} et ${PASSWORD_MAX_LENGTH} caractères.`);
  }
  const passwordHash = await hashPasswordWorkerSafe(input.password, deps.pepper);
  const userId = (deps.newUserId ?? (() => crypto.randomUUID()))();
  const result = await deps.accounts.createUnverifiedAccount({
    userId,
    emailNormalized,
    passwordHash,
    createdAtEpochSec: deps.nowEpochSec(),
  });
  if (result.kind === 'CREATED') {
    await sendVerification(deps, { userId, emailNormalized });
    return;
  }
  if (!result.emailVerified) {
    await sendVerification(deps, { userId: result.userId, emailNormalized });
  }
}

/** Consomme un jeton de vérification : lève VERIFICATION_TOKEN_INVALID ou VERIFICATION_TOKEN_EXPIRED. */
export async function verifyEmailToken(deps: AccountLifecycleDeps, token: string): Promise<void> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new AccountLifecycleError('VERIFICATION_TOKEN_INVALID', 'jeton invalide.');
  }
  const record = await deps.verificationTokens.consume(await hashToken('email-verify', token));
  if (record === null) {
    throw new AccountLifecycleError('VERIFICATION_TOKEN_INVALID', 'jeton invalide ou déjà utilisé.');
  }
  const now = deps.nowEpochSec();
  if (now >= record.expiresAtEpochSec) {
    throw new AccountLifecycleError('VERIFICATION_TOKEN_EXPIRED', 'jeton expiré.');
  }
  if (!(await deps.accounts.markEmailVerified(record.userId, now))) {
    throw new AccountLifecycleError('VERIFICATION_TOKEN_INVALID', 'compte introuvable.');
  }
}

/**
 * Demande de réinitialisation : émet un jeton (15 minutes) si le compte existe, sinon ne fait rien. Ne lève jamais
 * pour un e-mail inconnu ou mal formé. `throttled` (quota par adresse dépassé) supprime l'émission sans le montrer.
 */
export async function requestPasswordReset(deps: AccountLifecycleDeps, input: { readonly email: string; readonly throttled: boolean }): Promise<void> {
  const emailNormalized = normalizeEmail(input.email);
  if (input.throttled || !isEmailShaped(emailNormalized)) {
    return;
  }
  const account = await deps.accounts.findByEmailNormalized(emailNormalized);
  if (account === null) {
    return;
  }
  const token = await issueToken(deps, 'password-reset', deps.resetTokens, PASSWORD_RESET_TTL_SEC, { userId: account.userId, emailNormalized });
  await deliver(deps, 'reset', { emailNormalized, token });
}
