/**
 * Erreurs typées du moteur de grand livre (ticket T-S1B-10). Le message commence toujours par le code.
 *
 * `origin` distingue ce que le moteur a détecté lui-même avant d'écrire (`ENGINE`) de ce que la base a refusé en dernière
 * ligne de défense (`DATABASE_TRIGGER`, textes de `LEDGER_TRIGGER_MESSAGES` et `TENANT_V4_TRIGGER_MESSAGES`) ou d'un conflit
 * de concurrence (`DATABASE`).
 */
import { LEDGER_TRIGGER_MESSAGES, TENANT_V4_TRIGGER_MESSAGES } from '@fisca/db-schema';
import type { DenialCode } from '@fisca/auth-rbac';
import type { FsmErrorCode } from '@fisca/shared-types';

export const LEDGER_ERROR_CODES = [
  'LEDGER_INVALID_INPUT',
  'LEDGER_INVALID_ID_SOURCE',
  'LEDGER_INVALID_INITIAL_STATE',
  'LEDGER_INVALID_AMOUNT',
  'LEDGER_INVALID_LINE',
  'LEDGER_UNBALANCED',
  'LEDGER_UNKNOWN_ACCOUNT',
  'LEDGER_UNKNOWN_JOURNAL',
  'LEDGER_UNKNOWN_FISCAL_YEAR',
  'LEDGER_UNKNOWN_ENTRY',
  'LEDGER_FISCAL_YEAR_CLOSED',
  'LEDGER_FISCAL_YEAR_NOT_OPEN',
  'LEDGER_FISCAL_YEAR_NOT_CLOSING',
  'LEDGER_FISCAL_YEAR_NOT_CLOSED',
  'LEDGER_ACCESS_DENIED',
  'LEDGER_ENTRY_NOT_IN_EXPECTED_STATE',
  'LEDGER_ENTRY_ALREADY_POSTED',
  'LEDGER_FSM_REJECTED',
  'LEDGER_IDEMPOTENCY_KEY_REUSED',
  'LEDGER_CONCURRENCY_CONFLICT',
  'LEDGER_NEGATIVE_CASH',
  'LEDGER_MISSING_HASH',
  'LEDGER_HASH_INVALID',
  'LEDGER_POSTED_IMMUTABLE',
  'LEDGER_REVERSAL_REQUIRES_POSTED',
  'LEDGER_ALREADY_REVERSED',
  'LEDGER_VAT_CLEARING_EXCEEDS_INVOICE',
  'LEDGER_VAT_CLEARING_DEFERRED_LCN',
  'LEDGER_VAT_TARGET_REQUIRED',
  'LEDGER_VAT_ACCOUNT_UNRESOLVED',
  'LEDGER_NOTHING_TO_CLEAR',
  'LEDGER_PRECLOSE_CONTROLS_FAILED',
  'LEDGER_SUSPENSE_NOT_CLEARED',
  'LEDGER_UNPOSTED_ENTRIES_REMAIN',
  'LEDGER_RESULT_NOT_AFFECTED',
  'LEDGER_NOTHING_TO_CARRY_FORWARD',
  'LEDGER_OPENING_ALREADY_GENERATED',
  'LEDGER_STORAGE_FAILURE',
] as const;

export type LedgerErrorCode = (typeof LEDGER_ERROR_CODES)[number];
export type LedgerErrorOrigin = 'ENGINE' | 'DATABASE_TRIGGER' | 'DATABASE';

export interface LedgerErrorDetails {
  readonly origin?: LedgerErrorOrigin;
  readonly denialCode?: DenialCode;
  readonly fsmCode?: FsmErrorCode;
}

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;
  readonly origin: LedgerErrorOrigin;
  readonly denialCode: DenialCode | undefined;
  readonly fsmCode: FsmErrorCode | undefined;

  constructor(code: LedgerErrorCode, detail: string, details: LedgerErrorDetails = {}) {
    super(`${code}: ${detail}`);
    this.name = 'LedgerError';
    this.code = code;
    this.origin = details.origin ?? 'ENGINE';
    this.denialCode = details.denialCode;
    this.fsmCode = details.fsmCode;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Traduit un refus de la base (triggers du socle, conflits) en erreur typée. Les textes viennent de db-schema. */
export function mapDatabaseError(error: unknown): LedgerError {
  if (error instanceof LedgerError) {
    return error;
  }
  const message = messageOf(error);
  const trigger = (code: LedgerErrorCode): LedgerError => new LedgerError(code, message, { origin: 'DATABASE_TRIGGER' });
  if (message.includes('CGNC_NEGATIVE_CASH_5161')) return trigger('LEDGER_NEGATIVE_CASH');
  if (message.includes('CGNC_UNBALANCED_LINES')) return trigger('LEDGER_UNBALANCED');
  if (message.includes('PAF_MISSING_HASH')) return trigger('LEDGER_MISSING_HASH');
  if (message.includes('CGNC_FISCAL_YEAR_CLOSED') || message.includes(TENANT_V4_TRIGGER_MESSAGES.closedFiscalYearUpdate)) {
    return trigger('LEDGER_FISCAL_YEAR_CLOSED');
  }
  if (message.includes('VIOLATION_PAF_CGI_ART_145') || message.includes(LEDGER_TRIGGER_MESSAGES.directPostedInsert)) {
    return trigger('LEDGER_POSTED_IMMUTABLE');
  }
  const guardAborted = /not[- ]null/i.test(message) && message.includes('from_state');
  const duplicate = /unique constraint|duplicate key/i.test(message);
  if (guardAborted || duplicate) {
    return new LedgerError('LEDGER_CONCURRENCY_CONFLICT', message, { origin: 'DATABASE' });
  }
  return new LedgerError('LEDGER_STORAGE_FAILURE', message, { origin: 'DATABASE' });
}
