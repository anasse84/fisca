import type { ApiProblem } from './api-client.ts';

/** Clés d'erreur de l'espace `ui.auth.*` (suffixe). Les textes du serveur ne sont jamais affichés. */
export type AuthErrorKey =
  | 'errors.generic'
  | 'errors.network'
  | 'errors.invalidCredentials'
  | 'errors.accountLocked'
  | 'errors.rateLimited'
  | 'errors.turnstile'
  | 'errors.requestInvalid'
  | 'errors.registrationInvalid'
  | 'errors.tokenInvalid'
  | 'errors.tokenExpired'
  | 'errors.mfaCodeInvalid'
  | 'errors.challengeExpired'
  | 'errors.attemptsExhausted'
  | 'errors.methodUnavailable'
  | 'errors.enrollmentRequired'
  | 'errors.passkeyFailed'
  | 'errors.passkeyCancelled'
  | 'errors.sessionRequired'
  | 'errors.iceNotFound'
  | 'errors.iceRejected'
  | 'errors.iceShape'
  | 'errors.server'
  | 'errors.googleFailed';

const BY_CODE: Readonly<Record<string, AuthErrorKey>> = {
  NETWORK_ERROR: 'errors.network',
  RESPONSE_INVALID: 'errors.server',
  LOGIN_INVALID_CREDENTIALS: 'errors.invalidCredentials',
  LOGIN_ACCOUNT_LOCKED: 'errors.accountLocked',
  RATE_LIMITED: 'errors.rateLimited',
  TURNSTILE_REQUIRED: 'errors.turnstile',
  REQUEST_INVALID: 'errors.requestInvalid',
  REQUEST_VALIDATION_FAILED: 'errors.requestInvalid',
  REGISTRATION_INPUT_INVALID: 'errors.registrationInvalid',
  PASSWORD_RESET_INPUT_INVALID: 'errors.registrationInvalid',
  VERIFICATION_TOKEN_INVALID: 'errors.tokenInvalid',
  PASSWORD_RESET_TOKEN_INVALID: 'errors.tokenInvalid',
  VERIFICATION_TOKEN_EXPIRED: 'errors.tokenExpired',
  TOTP_CODE_INVALID: 'errors.mfaCodeInvalid',
  MFA_CODE_INVALID: 'errors.mfaCodeInvalid',
  MFA_CHALLENGE_EXPIRED: 'errors.challengeExpired',
  MFA_CHALLENGE_REPLAYED: 'errors.challengeExpired',
  MFA_CHALLENGE_MALFORMED: 'errors.challengeExpired',
  MFA_CHALLENGE_SIGNATURE_INVALID: 'errors.challengeExpired',
  MFA_SIGNING_KEY_INVALID: 'errors.challengeExpired',
  MFA_CHALLENGE_USER_MISMATCH: 'errors.challengeExpired',
  MFA_CHALLENGE_ATTEMPTS_EXHAUSTED: 'errors.attemptsExhausted',
  MFA_METHOD_UNAVAILABLE: 'errors.methodUnavailable',
  MFA_FACTOR_NOT_ENROLLED: 'errors.methodUnavailable',
  MFA_ENROLLMENT_REQUIRED: 'errors.enrollmentRequired',
  PASSKEY_CANCELLED: 'errors.passkeyCancelled',
  PASSKEY_AUTHENTICATION_FAILED: 'errors.passkeyFailed',
  PASSKEY_REQUEST_MALFORMED: 'errors.passkeyFailed',
  PASSKEY_CLIENT_DATA_INVALID: 'errors.passkeyFailed',
  AUTH_REQUIRED: 'errors.sessionRequired',
  DIRECTORY_ICE_NOT_FOUND: 'errors.iceNotFound',
  PROVIDER_ERROR: 'errors.googleFailed',
  STATE_INVALID: 'errors.googleFailed',
  STATE_EXPIRED: 'errors.googleFailed',
};

/** Codes de défi MFA qui invalident le défi : retour à la première étape. */
export const MFA_CHALLENGE_TERMINAL_CODES: ReadonlySet<string> = new Set([
  'MFA_CHALLENGE_EXPIRED',
  'MFA_CHALLENGE_REPLAYED',
  'MFA_CHALLENGE_MALFORMED',
  'MFA_CHALLENGE_SIGNATURE_INVALID',
  'MFA_SIGNING_KEY_INVALID',
  'MFA_CHALLENGE_USER_MISMATCH',
  'MFA_CHALLENGE_ATTEMPTS_EXHAUSTED',
]);

/** Erreurs d'identification ou de code qui comptent pour le verrou d'interface. */
export function countsAsCredentialFailure(problem: Pick<ApiProblem, 'status' | 'errorCode'>): boolean {
  return problem.status === 401 && problem.errorCode !== 'AUTH_REQUIRED';
}

export function problemMessageKey(problem: Pick<ApiProblem, 'status' | 'errorCode'>): AuthErrorKey {
  const byCode = BY_CODE[problem.errorCode];
  if (byCode !== undefined) {
    return byCode;
  }
  if (problem.status === 429) {
    return 'errors.rateLimited';
  }
  if (problem.status >= 500 || problem.status === 0) {
    return problem.status === 0 ? 'errors.network' : 'errors.server';
  }
  return 'errors.generic';
}
