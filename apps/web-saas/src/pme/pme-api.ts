/**
 * Client des routes du registre utilisées par les écrans PME (T-P2B-08) : `fetch` injectable, aucun appel global.
 * CTR-API-45 POST /api/v1/ledger/entries, CTR-API-46 …/:id/submit, CTR-API-48 …/:id/visa, CTR-API-12 POST /api/v1/banking/reconcile.
 * X-Fisca-Company-Id est fourni par l'hôte (jamais saisi, jamais dans un corps) ; Idempotency-Key = UUIDv7 client, fournie par
 * l'appelant pour qu'une reprise réutilise la même clé. Seul `errorCode` d'un ProblemDetails (RFC 9457) est conservé :
 * `title` et `detail` du serveur ne sont jamais lus.
 */
import { UUID_V7_PATTERN } from './uuid-v7.ts';

export type PmeFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface PmeProblem {
  readonly status: number;
  readonly errorCode: string;
  readonly traceId?: string;
  readonly retryAfterSec: number | null;
  readonly fieldErrors: Readonly<Record<string, never>>;
}

export type PmeResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly problem: PmeProblem };

export const PME_PATHS = {
  createEntry: '/api/v1/ledger/entries',
  banking: '/api/v1/banking/reconcile',
  entry: '/api/v1/ledger/entries',
} as const;

export type EntryState = 'IA_PROPOSITION' | 'DRAFT' | 'REVISEE_CYCLE' | 'POSTED';

export interface DraftLineRequest {
  readonly accountNumber: string;
  readonly debitCents: number;
  readonly creditCents: number;
  readonly description: string;
}

/** Corps strict de CTR-API-45. */
export interface CreateEntryRequest {
  readonly journalId: string;
  readonly fiscalYearId: string;
  readonly entryDate: string;
  readonly reviewCycle: string;
  readonly sourceDocumentType: string;
  readonly initialState: 'IA_PROPOSITION' | 'DRAFT';
  readonly lines: readonly DraftLineRequest[];
}

export interface CreateEntryResponse {
  readonly entryId: string;
  readonly entryReference: string;
  readonly sequenceNumber: number;
  readonly status: 'IA_PROPOSITION' | 'DRAFT';
}

/** Réponse de CTR-API-46 et CTR-API-48. */
export interface TransitionResponse {
  readonly entryId: string;
  readonly fromState: EntryState;
  readonly toState: EntryState;
  readonly replayed: boolean;
}

export const UBL_PAYMENT_CODES = ['10_ESPECES', '20_CHEQUE', '30_VIREMENT', '42_EFFET_LCN', '48_CARTE', '97_COMPENSATION'] as const;
export type UblPaymentCode = (typeof UBL_PAYMENT_CODES)[number];
export type RecoverableTarget = 'VAT_RECOVERABLE_CHARGES' | 'VAT_RECOVERABLE_IMMOB';

/** Corps strict de CTR-API-12. */
export interface ReconcileRequest {
  readonly bankTransactionId: string;
  readonly journalId: string;
  readonly fiscalYearId: string;
  readonly entryDate: string;
  readonly paymentMethodCode: UblPaymentCode;
  readonly lcnBankCollectionDate?: string;
  readonly recoverableTarget?: RecoverableTarget;
  readonly candidates: readonly { readonly invoiceEntryId: string; readonly settledBeforeCents: number }[];
}

export type ReconcileResponse =
  | { readonly outcome: 'MATCHED_FULL' | 'MATCHED_PARTIAL'; readonly bankTransactionId: string; readonly reconciliationCode: string; readonly invoiceEntryId: string; readonly clearingEntryId: string; readonly clearedCents: number }
  | { readonly outcome: 'SUSPENS_AMBIGU_3497_4497'; readonly bankTransactionId: string; readonly reconciliationCode: string; readonly candidateCount: number }
  | { readonly outcome: 'NO_MATCH'; readonly bankTransactionId: string };

export interface PmeApiOptions {
  readonly fetch: PmeFetch;
  readonly baseUrl?: string;
  readonly getAccessToken: () => string | null;
  readonly getCompanyId: () => string | null;
}

export interface PmeApi {
  createEntry(body: CreateEntryRequest, idempotencyKey: string): Promise<PmeResult<CreateEntryResponse>>;
  submitEntry(entryId: string, idempotencyKey: string): Promise<PmeResult<TransitionResponse>>;
  visaEntry(entryId: string, idempotencyKey: string): Promise<PmeResult<TransitionResponse>>;
  reconcile(body: ReconcileRequest, idempotencyKey: string): Promise<PmeResult<ReconcileResponse>>;
}

const COMPANY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ENTRY_STATES: readonly string[] = ['IA_PROPOSITION', 'DRAFT', 'REVISEE_CYCLE', 'POSTED'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isState = (v: unknown): v is EntryState => typeof v === 'string' && ENTRY_STATES.includes(v);

const local = (status: number, errorCode: string): PmeResult<never> => ({ ok: false, problem: { status, errorCode, retryAfterSec: null, fieldErrors: {} } });

function parseTransition(body: unknown): TransitionResponse | null {
  if (!isRecord(body) || !isText(body['entryId']) || !isState(body['fromState']) || !isState(body['toState']) || typeof body['replayed'] !== 'boolean') return null;
  return { entryId: body['entryId'], fromState: body['fromState'], toState: body['toState'], replayed: body['replayed'] };
}

function parseCreate(body: unknown): CreateEntryResponse | null {
  if (!isRecord(body) || !isText(body['entryId']) || !isText(body['entryReference']) || !isInt(body['sequenceNumber'])) return null;
  const status = body['status'];
  if (status !== 'IA_PROPOSITION' && status !== 'DRAFT') return null;
  return { entryId: body['entryId'], entryReference: body['entryReference'], sequenceNumber: body['sequenceNumber'], status };
}

function parseReconcile(body: unknown): ReconcileResponse | null {
  if (!isRecord(body) || !isText(body['bankTransactionId'])) return null;
  const bankTransactionId = body['bankTransactionId'];
  switch (body['outcome']) {
    case 'MATCHED_FULL':
    case 'MATCHED_PARTIAL':
      return isText(body['reconciliationCode']) && isText(body['invoiceEntryId']) && isText(body['clearingEntryId']) && isInt(body['clearedCents'])
        ? { outcome: body['outcome'], bankTransactionId, reconciliationCode: body['reconciliationCode'], invoiceEntryId: body['invoiceEntryId'], clearingEntryId: body['clearingEntryId'], clearedCents: body['clearedCents'] }
        : null;
    case 'SUSPENS_AMBIGU_3497_4497':
      return isText(body['reconciliationCode']) && isInt(body['candidateCount'])
        ? { outcome: 'SUSPENS_AMBIGU_3497_4497', bankTransactionId, reconciliationCode: body['reconciliationCode'], candidateCount: body['candidateCount'] }
        : null;
    case 'NO_MATCH':
      return { outcome: 'NO_MATCH', bankTransactionId };
    default:
      return null;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function toProblem(response: Response): Promise<PmeProblem> {
  const body = await readJson(response);
  const raw = response.headers.get('Retry-After');
  const retryAfterSec = raw !== null && /^\d{1,9}$/.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : null;
  if (!isRecord(body) || typeof body['errorCode'] !== 'string') {
    return { status: response.status, errorCode: 'UNKNOWN_ERROR', retryAfterSec, fieldErrors: {} };
  }
  return { status: response.status, errorCode: body['errorCode'], ...(typeof body['traceId'] === 'string' ? { traceId: body['traceId'] } : {}), retryAfterSec, fieldErrors: {} };
}

export function createPmeApi(options: PmeApiOptions): PmeApi {
  const base = options.baseUrl ?? '';

  async function post<T>(path: string, body: unknown, idempotencyKey: string, parse: (b: unknown) => T | null): Promise<PmeResult<T>> {
    const token = options.getAccessToken();
    if (token === null || token === '') return local(401, 'AUTH_REQUIRED');
    const company = options.getCompanyId();
    if (company === null || !COMPANY_ID_PATTERN.test(company)) return local(400, 'COMPANY_ID_INVALID');
    if (!UUID_V7_PATTERN.test(idempotencyKey)) return local(400, 'IDEMPOTENCY_KEY_INVALID');
    let response: Response;
    try {
      response = await options.fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, application/problem+json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Fisca-Company-Id': company,
          'Idempotency-Key': idempotencyKey,
        },
        cache: 'no-store',
        body: JSON.stringify(body),
      });
    } catch {
      return local(0, 'NETWORK_ERROR');
    }
    if (!response.ok) return { ok: false, problem: await toProblem(response) };
    const data = parse(await readJson(response));
    return data === null ? local(response.status, 'RESPONSE_INVALID') : { ok: true, data };
  }

  const entryPath = (entryId: string, action: 'submit' | 'visa'): string => `${PME_PATHS.entry}/${encodeURIComponent(entryId)}/${action}`;

  return {
    createEntry: (body, key) => post(PME_PATHS.createEntry, body, key, parseCreate),
    submitEntry: (entryId, key) => post(entryPath(entryId, 'submit'), {}, key, parseTransition),
    visaEntry: (entryId, key) => post(entryPath(entryId, 'visa'), {}, key, parseTransition),
    reconcile: (body, key) => post(PME_PATHS.banking, body, key, parseReconcile),
  };
}
