/** errorCode d'un ProblemDetails → catégorie de libellé i18n. Jamais le `title`/`detail` du serveur. */
export type ProblemCategory = 'network' | 'session' | 'forbidden' | 'invalid' | 'conflict' | 'alreadyReconciled' | 'notFound' | 'idempotency' | 'unavailable' | 'generic';

export const PROBLEM_CATEGORIES: readonly ProblemCategory[] = ['network', 'session', 'forbidden', 'invalid', 'conflict', 'alreadyReconciled', 'notFound', 'idempotency', 'unavailable', 'generic'];

const EXACT: Readonly<Record<string, ProblemCategory>> = {
  NETWORK_ERROR: 'network',
  AUTH_REQUIRED: 'session',
  BANK_TRANSACTION_ALREADY_RECONCILED: 'alreadyReconciled',
  BANK_TRANSACTION_NOT_FOUND: 'notFound',
  LEDGER_ACCESS_DENIED: 'forbidden',
  TENANT_SELECTOR_FORBIDDEN: 'forbidden',
  COMPANY_ID_INVALID: 'invalid',
  COMPANY_ID_REQUIRED: 'invalid',
  REQUEST_BODY_INVALID: 'invalid',
  REQUEST_VALIDATION_FAILED: 'invalid',
  RESPONSE_INVALID: 'unavailable',
  INTERNAL_ERROR: 'unavailable',
  DIRECTORY_UNAVAILABLE: 'unavailable',
  ROUTE_NOT_FOUND: 'notFound',
};

/** Les codes `LEDGER_*` suivent les familles du serveur : refus, conflit d'état, introuvable, entrée invalide, indisponibilité. */
export function problemCategory(errorCode: string): ProblemCategory {
  const exact = EXACT[errorCode];
  if (exact !== undefined) return exact;
  if (errorCode.startsWith('IDEMPOTENCY_') || errorCode === 'LEDGER_IDEMPOTENCY_KEY_REUSED') return 'idempotency';
  if (errorCode.startsWith('ENTITLEMENT_')) return 'forbidden';
  if (errorCode.startsWith('LEDGER_UNKNOWN_')) return 'notFound';
  if (errorCode === 'LEDGER_STORAGE_FAILURE' || errorCode === 'LEDGER_INVALID_ID_SOURCE') return 'unavailable';
  if (/^LEDGER_(INVALID|UNBALANCED|MISSING_HASH|HASH_INVALID|VAT_CLEARING_EXCEEDS|VAT_TARGET|VAT_ACCOUNT|NOTHING_TO)/.test(errorCode)) return 'invalid';
  if (errorCode.startsWith('LEDGER_')) return 'conflict';
  return 'generic';
}
