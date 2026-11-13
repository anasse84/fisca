/** Colle ledger-api : `TenantContext.activeCpaMandate` → `LedgerActor.activeCpaMandate` → visa implicite du mode direct (route SEAL). */
import { describe, expect, it } from 'vitest';
import type { OrgPlanSegment } from '@fisca/auth-rbac';
import { createLedgerApi, type LedgerCall } from './ledger-api.ts';
import { ImmutableCgncLedgerEngine, LedgerError } from './immutable-cgnc-ledger-engine.ts';
import type { TenantContext } from './tenant-router.ts';
import { COMPANY_ID, FY_2026, SequentialUuidV7, StepClock, StubPreCloseControls, actorOf, openSqliteBackend, seedLedger, testCipher, testOnlyHasher } from './ledger-test-harness.ts';

async function world(segment: OrgPlanSegment) {
  const backend = await openSqliteBackend();
  await seedLedger(backend.driver);
  const clock = new StepClock();
  const ids = new SequentialUuidV7();
  const controls = new StubPreCloseControls();
  const engine = new ImmutableCgncLedgerEngine({ db: backend.driver, companyId: COMPANY_ID, clock, ids, hasher: testOnlyHasher, cipher: testCipher, preCloseControls: controls });
  const api = createLedgerApi({
    clock,
    ids,
    hasher: testOnlyHasher,
    cipher: testCipher,
    preCloseControls: controls,
    actorProfiles: { resolve: async () => ({ orgPlanSegment: segment, activeHumanMembersCount: 2, canAccessPayrollPii: false }) },
  });
  const draft = async (): Promise<string> =>
    (
      await engine.createDraft(actorOf('AIDE_COMPTABLE', 'u-aide', {}, clock), {
        journalId: 'jr-cai',
        fiscalYearId: FY_2026.id,
        entryDate: '2026-03-01',
        reviewCycle: 'TRESORERIE',
        sourceDocumentType: 'PAYMENT',
        initialState: 'DRAFT',
        lines: [
          { accountNumber: '51610000', debitCents: 500000, creditCents: 0, description: 'a' },
          { accountNumber: '11110000', debitCents: 0, creditCents: 500000, description: 'b' },
        ],
      })
    ).entryId;
  const callFor = (activeCpaMandate: boolean | null, role: TenantContext['role'] = 'OWNER_GERANT'): LedgerCall => ({
    tenant: { userId: 'u-gerant', role, companyId: COMPANY_ID, organizationId: 'org', accessKind: 'MEMBERSHIP', plan: 'P', canAccessPayrollPii: true, permissionCeiling: null, activeCpaMandate, tenantDb: backend.driver },
    auth: { userId: 'u-gerant', sessionId: null, boundCompanyId: null, mfaVerifiedAtEpochSec: clock.currentEpochSec() },
    subscriptionReadOnly: false,
  });
  const status = async (id: string): Promise<string | undefined> => (await backend.driver.query<{ status: string }>({ sql: 'SELECT status FROM journal_entries WHERE id = ?', params: [id] }))[0]?.status;
  return { api, draft, callFor, status };
}

describe('ledger-api : visa implicite du mode direct', () => {
  it('DIRECT_PME + aucun mandat actif : SEAL par le gérant depuis DRAFT aboutit (POSTED)', async () => {
    const w = await world('DIRECT_PME');
    const id = await w.draft();
    const out = await w.api.postEntry(w.callFor(false), { entryId: id, body: { action: 'SEAL' }, idempotencyKey: 'k-1' });
    expect(out).toMatchObject({ action: 'SEAL', toState: 'POSTED' });
    expect(await w.status(id)).toBe('POSTED');
  });

  it('mandat actif (true) ou inconnu (null) : refus LEDGER_ENTRY_NOT_IN_EXPECTED_STATE, DRAFT intact', async () => {
    const w = await world('DIRECT_PME');
    const id = await w.draft();
    for (const flag of [true, null]) {
      await expect(w.api.postEntry(w.callFor(flag), { entryId: id, body: { action: 'SEAL' }, idempotencyKey: `k-${String(flag)}` })).rejects.toMatchObject({
        code: 'LEDGER_ENTRY_NOT_IN_EXPECTED_STATE',
      });
    }
    expect(await w.status(id)).toBe('DRAFT');
    expect(LedgerError).toBeDefined();
  });

  it('plan non direct : refus même sans mandat actif', async () => {
    const w = await world('FIDUCIAIRE');
    const id = await w.draft();
    await expect(w.api.postEntry(w.callFor(false), { entryId: id, body: { action: 'SEAL' }, idempotencyKey: 'k-f' })).rejects.toMatchObject({ code: 'LEDGER_ENTRY_NOT_IN_EXPECTED_STATE' });
    expect(await w.status(id)).toBe('DRAFT');
  });
});
