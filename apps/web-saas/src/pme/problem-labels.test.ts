import { describe, expect, it } from 'vitest';
import { problemCategory } from './problem-labels.ts';

describe('errorCode → catégorie de libellé (jamais le texte serveur)', () => {
  const cases: [string, string][] = [
    ['NETWORK_ERROR', 'network'],
    ['AUTH_REQUIRED', 'session'],
    ['LEDGER_ACCESS_DENIED', 'forbidden'],
    ['ENTITLEMENT_READ_ONLY_MODE', 'forbidden'],
    ['LEDGER_UNBALANCED', 'invalid'],
    ['REQUEST_VALIDATION_FAILED', 'invalid'],
    ['LEDGER_ENTRY_NOT_IN_EXPECTED_STATE', 'conflict'],
    ['BANK_TRANSACTION_ALREADY_RECONCILED', 'alreadyReconciled'],
    ['BANK_TRANSACTION_NOT_FOUND', 'notFound'],
    ['LEDGER_UNKNOWN_ENTRY', 'notFound'],
    ['IDEMPOTENCY_KEY_REUSED', 'idempotency'],
    ['LEDGER_IDEMPOTENCY_KEY_REUSED', 'idempotency'],
    ['IDEMPOTENCY_REQUEST_IN_PROGRESS', 'idempotency'],
    ['LEDGER_STORAGE_FAILURE', 'unavailable'],
    ['INTERNAL_ERROR', 'unavailable'],
    ['CODE_QUI_NEXISTE_PAS', 'generic'],
  ];
  for (const [code, category] of cases) {
    it(`${code} → ${category}`, () => expect(problemCategory(code)).toBe(category));
  }
});
