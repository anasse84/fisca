/** Codes d'erreur du moteur E2EE (Doc_10 § 04, § 11). Aucun code ne transporte de clair, de clé ni de contexte. */
export type E2eeErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_KEY'
  | 'INVALID_FORMAT'
  | 'UNSUPPORTED_VERSION'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED';

const SAFE_MESSAGES: Readonly<Record<E2eeErrorCode, string>> = {
  INVALID_INPUT: 'E2EE_INVALID_INPUT',
  INVALID_KEY: 'E2EE_INVALID_KEY',
  INVALID_FORMAT: 'E2EE_UNSUPPORTED_CIPHERTEXT_FORMAT',
  UNSUPPORTED_VERSION: 'E2EE_UNSUPPORTED_CIPHERTEXT_VERSION',
  ENCRYPTION_FAILED: 'E2EE_ENCRYPTION_FAILED',
  DECRYPTION_FAILED: 'E2EE_DECRYPTION_FAILED',
};

/**
 * Erreur typée du moteur E2EE. Le message est une constante par code : il ne dépend ni du clair,
 * ni de la clé, ni du contexte AAD, et ne distingue pas la cause d'un échec d'authentification GCM.
 */
export class E2eeError extends Error {
  readonly code: E2eeErrorCode;

  constructor(code: E2eeErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'E2eeError';
    this.code = code;
  }
}
