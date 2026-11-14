import { describe, expect, it } from 'vitest';
import { createPmeApi } from './pme-api.ts';
import type { PmeFetch } from './pme-api.ts';
import { UUID_V7_PATTERN } from './uuid-v7.ts';

const KEY = '0190f0f0-0000-7000-8000-000000000001';
const ENTRY = '0190f0f0-0000-7000-8000-0000000000aa';

interface Seen {
  readonly url: string;
  readonly init: RequestInit;
}

function mockFetch(respond: () => Response): { fetch: PmeFetch; seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: async (url, init) => {
      seen.push({ url, init: init ?? {} });
      return respond();
    },
  };
}

const json = (status: number, body: unknown, type = 'application/json'): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });
const make = (fetch: PmeFetch, company: string | null = 'dossier_1') => createPmeApi({ fetch, baseUrl: '', getAccessToken: () => 'jwt', getCompanyId: () => company });
const headersOf = (s: Seen | undefined): Record<string, string> => (s?.init.headers ?? {}) as Record<string, string>;

describe('client des routes du registre : en-têtes et corps exacts', () => {
  it('CTR-API-46 submit : POST /api/v1/ledger/entries/:id/submit, corps {}, 3 en-têtes, jamais de companyId dans le corps', async () => {
    const m = mockFetch(() => json(200, { entryId: ENTRY, fromState: 'IA_PROPOSITION', toState: 'DRAFT', replayed: false }));
    const res = await make(m.fetch).submitEntry(ENTRY, KEY);
    expect(res).toEqual({ ok: true, data: { entryId: ENTRY, fromState: 'IA_PROPOSITION', toState: 'DRAFT', replayed: false } });
    expect(m.seen[0]?.url).toBe(`/api/v1/ledger/entries/${ENTRY}/submit`);
    expect(m.seen[0]?.init.method).toBe('POST');
    expect(m.seen[0]?.init.body).toBe('{}');
    const h = headersOf(m.seen[0]);
    expect(h['Authorization']).toBe('Bearer jwt');
    expect(h['X-Fisca-Company-Id']).toBe('dossier_1');
    expect(h['Idempotency-Key']).toBe(KEY);
    expect(h['Idempotency-Key']).toMatch(UUID_V7_PATTERN);
  });
  it('CTR-API-48 visa : POST /api/v1/ledger/entries/:id/visa', async () => {
    const m = mockFetch(() => json(200, { entryId: ENTRY, fromState: 'DRAFT', toState: 'REVISEE_CYCLE', replayed: true }));
    const res = await make(m.fetch).visaEntry(ENTRY, KEY);
    expect(res.ok && res.data.toState).toBe('REVISEE_CYCLE');
    expect(m.seen[0]?.url).toBe(`/api/v1/ledger/entries/${ENTRY}/visa`);
  });
  it('CTR-API-45 création : corps strict transmis tel quel (initialState IA_PROPOSITION), réponse 201', async () => {
    const m = mockFetch(() => json(201, { entryId: ENTRY, entryReference: 'ACH-1', sequenceNumber: 1, status: 'IA_PROPOSITION' }));
    const body = {
      journalId: 'J',
      fiscalYearId: 'F',
      entryDate: '2027-02-03',
      reviewCycle: 'ACHATS',
      sourceDocumentType: 'INVOICE',
      initialState: 'IA_PROPOSITION',
      lines: [{ accountNumber: '6111', debitCents: 100, creditCents: 0, description: 'a' }],
    } as const;
    const res = await make(m.fetch).createEntry(body, KEY);
    expect(res.ok && res.data.status).toBe('IA_PROPOSITION');
    expect(m.seen[0]?.url).toBe('/api/v1/ledger/entries');
    expect(JSON.parse(String(m.seen[0]?.init.body))).toEqual(body);
  });
  it('CTR-API-12 reconcile : corps exact, 201 MATCHED_FULL et 200 SUSPENS acceptés', async () => {
    const body = { bankTransactionId: 'b1', journalId: 'J', fiscalYearId: 'F', entryDate: '2027-02-03', paymentMethodCode: '30_VIREMENT', candidates: [{ invoiceEntryId: ENTRY, settledBeforeCents: 0 }] } as const;
    const full = mockFetch(() => json(201, { outcome: 'MATCHED_FULL', bankTransactionId: 'b1', reconciliationCode: 'LTR-x', invoiceEntryId: ENTRY, clearingEntryId: 'c1', clearedCents: 100 }));
    const r1 = await make(full.fetch).reconcile(body, KEY);
    expect(r1.ok && r1.data.outcome).toBe('MATCHED_FULL');
    expect(full.seen[0]?.url).toBe('/api/v1/banking/reconcile');
    expect(JSON.parse(String(full.seen[0]?.init.body))).toEqual(body);
    const sus = mockFetch(() => json(200, { outcome: 'SUSPENS_AMBIGU_3497_4497', bankTransactionId: 'b1', reconciliationCode: 'LTR-y', candidateCount: 2 }));
    const r2 = await make(sus.fetch).reconcile(body, KEY);
    expect(r2.ok && r2.data.outcome).toBe('SUSPENS_AMBIGU_3497_4497');
    const none = mockFetch(() => json(200, { outcome: 'NO_MATCH', bankTransactionId: 'b1' }));
    expect((await make(none.fetch).reconcile(body, KEY)).ok).toBe(true);
  });
  it('ProblemDetails : seul errorCode est conservé, jamais title ni detail du serveur', async () => {
    const m = mockFetch(() => json(409, { type: 'about:blank', title: 'TITRE SERVEUR', detail: 'DETAIL SERVEUR', status: 409, errorCode: 'BANK_TRANSACTION_ALREADY_RECONCILED', traceId: 'abc' }, 'application/problem+json'));
    const res = await make(m.fetch).reconcile({ bankTransactionId: 'b', journalId: 'J', fiscalYearId: 'F', entryDate: '2027-02-03', paymentMethodCode: '30_VIREMENT', candidates: [{ invoiceEntryId: ENTRY, settledBeforeCents: 0 }] }, KEY);
    expect(res).toEqual({ ok: false, problem: { status: 409, errorCode: 'BANK_TRANSACTION_ALREADY_RECONCILED', traceId: 'abc', retryAfterSec: null, fieldErrors: {} } });
    expect(JSON.stringify(res)).not.toMatch(/SERVEUR/);
  });
  it('panne réseau : NETWORK_ERROR local ; réponse inattendue : RESPONSE_INVALID', async () => {
    const down = await make(async () => {
      throw new Error('coupé');
    }).submitEntry(ENTRY, KEY);
    expect(down).toMatchObject({ ok: false, problem: { errorCode: 'NETWORK_ERROR', status: 0 } });
    const bad = await make(mockFetch(() => json(200, { nimporte: 'quoi' })).fetch).submitEntry(ENTRY, KEY);
    expect(bad).toMatchObject({ ok: false, problem: { errorCode: 'RESPONSE_INVALID' } });
  });
  it('X-Fisca-Company-Id fourni par l’hôte : absent ou hors [A-Za-z0-9_-]{1,64} = aucun appel réseau', async () => {
    const m = mockFetch(() => json(200, {}));
    for (const company of [null, '', 'a b', 'x'.repeat(65), 'é']) {
      const res = await make(m.fetch, company).submitEntry(ENTRY, KEY);
      expect(res).toMatchObject({ ok: false, problem: { errorCode: 'COMPANY_ID_INVALID' } });
    }
    expect(m.seen).toHaveLength(0);
  });
  it('Idempotency-Key qui n’est pas un UUIDv7 : refusée localement', async () => {
    const m = mockFetch(() => json(200, {}));
    const res = await make(m.fetch).submitEntry(ENTRY, 'pas-un-uuid');
    expect(res).toMatchObject({ ok: false, problem: { errorCode: 'IDEMPOTENCY_KEY_INVALID' } });
    expect(m.seen).toHaveLength(0);
  });
  it('jeton absent : AUTH_REQUIRED sans appel réseau', async () => {
    const m = mockFetch(() => json(200, {}));
    const api = createPmeApi({ fetch: m.fetch, baseUrl: '', getAccessToken: () => null, getCompanyId: () => 'd' });
    expect(await api.submitEntry(ENTRY, KEY)).toMatchObject({ ok: false, problem: { errorCode: 'AUTH_REQUIRED' } });
    expect(m.seen).toHaveLength(0);
  });
});
