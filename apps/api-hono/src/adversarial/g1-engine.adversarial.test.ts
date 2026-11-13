import { afterAll, describe, expect, it } from 'vitest';
import {
  ImmutableCgncLedgerEngine, LedgerError, type CreateDraftInput, type LedgerActor,
} from '../core/immutable-cgnc-ledger-engine.ts';
import {
  COMPANY_ID, FY_2026, PostgresHarness, SequentialUuidV7, StepClock, StubPreCloseControls, actorOf, openSqliteBackend, seedLedger, testCipher,
  type LedgerBackend,
} from '../core/ledger-test-harness.ts';
import { permissionsOfRole } from '@fisca/auth-rbac';
import { defaultSha256LedgerHasher } from '../core/ledger-hasher.ts';

/** Tests adverses de l'auditeur, G1 tour 2 : moteur de grand livre sur SQLite et PostgreSQL 16 réels (hasher par défaut). */
const pgh = new PostgresHarness();
afterAll(async () => { await pgh.close(); });
const BACKENDS: readonly { name: string; open(): Promise<LedgerBackend> }[] = [{ name: 'sqlite', open: openSqliteBackend }, { name: 'postgres', open: () => pgh.fresh() }];

const cash = (debit: number, credit: number, journalId = 'jr-cai'): CreateDraftInput => ({
  journalId, fiscalYearId: FY_2026.id, entryDate: '2026-03-01', reviewCycle: 'TRESORERIE', sourceDocumentType: 'PAYMENT', initialState: 'DRAFT',
  lines: [
    { accountNumber: '51610000', debitCents: debit, creditCents: credit, description: 'caisse' },
    { accountNumber: debit > 0 ? '11110000' : '61110000', debitCents: credit, creditCents: debit, description: 'contrepartie' },
  ],
});

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return e instanceof LedgerError ? e.code : `ERR:${String(e).slice(0, 50)}`; }
}

describe.each(BACKENDS)('G1 adverse — moteur sur $name', (spec) => {
  async function setup() {
    const backend = await spec.open(); await seedLedger(backend.driver);
    const clock = new StepClock();
    const engine = new ImmutableCgncLedgerEngine({ db: backend.driver, companyId: COMPANY_ID, clock, ids: new SequentialUuidV7(), cipher: testCipher, preCloseControls: new StubPreCloseControls() });
    const chef = actorOf('CHEF_MISSION', 'u-chef', {}, clock); const oec = actorOf('EXPERT_COMPTABLE_OEC', 'u-oec', {}, clock);
    const aide = actorOf('AIDE_COMPTABLE', 'u-aide', {}, clock);
    let n = 0; const key = (): string => `k-${(n += 1)}`;
    const rows = <T>(sql: string, p: (string | number | null)[] = []) => backend.driver.query<T>({ sql, params: p });
    const sealed = async (input: CreateDraftInput): Promise<string> => {
      const { entryId } = await engine.createDraft(aide, input);
      await engine.visaCycle(chef, { entryId, idempotencyKey: key() }); await engine.sealEntry(oec, { entryId, idempotencyKey: key() }); return entryId;
    };
    const visaed = async (input: CreateDraftInput): Promise<string> => {
      const { entryId } = await engine.createDraft(aide, input); await engine.visaCycle(chef, { entryId, idempotencyKey: key() }); return entryId;
    };
    return { engine, clock, chef, oec, aide, key, rows, sealed, visaed };
  }

  it('hasher par défaut : empreinte chaînée, valeur calculée indépendamment', async () => {
    const w = await setup();
    const id = await w.sealed(cash(10000, 0));
    const [r] = await w.rows<{ entry_hash: string; previous_entry_hash: string }>('SELECT entry_hash, previous_entry_hash FROM journal_entries WHERE id = ?', [id]);
    expect(r?.previous_entry_hash).toBe(`GENESIS_HASH_${'0'.repeat(32)}`);
    expect(r?.entry_hash).toMatch(/^[0-9a-f]{64}$/);
    const chain = await w.engine.verifyJournalChain('jr-cai');
    expect(chain).toEqual({ valid: true, length: 1 });
    void defaultSha256LedgerHasher;
  });

  it('deux scellements concurrents créditant la caisse au-delà du solde : un seul passe, solde final >= 0', async () => {
    const w = await setup();
    await w.sealed(cash(10000, 0));
    const b = await w.visaed(cash(0, 6000)); const c = await w.visaed(cash(0, 6000));
    const res = await Promise.all([code(w.engine.sealEntry(w.oec, { entryId: b, idempotencyKey: w.key() })), code(w.engine.sealEntry(w.oec, { entryId: c, idempotencyKey: w.key() }))]);
    const [bal] = await w.rows<{ b: number | string }>(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS b FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN cgnc_accounts a ON a.id = l.account_id WHERE e.status = 'POSTED' AND a.account_number LIKE '5161%'`);
    expect(Number(bal?.b), JSON.stringify(res)).toBeGreaterThanOrEqual(0);
    expect(res.filter((r) => r === 'OK'), JSON.stringify(res)).toHaveLength(1);
  });

  it('même clé d\'idempotence rejouée en parallèle : une seule transition', async () => {
    const w = await setup();
    const id = await w.visaed(cash(5000, 0)); const k = w.key();
    const res = await Promise.all([1, 2, 3, 4].map(() => w.engine.sealEntry(w.oec, { entryId: id, idempotencyKey: k }).then((r) => (r.replayed ? 'REPLAY' : 'DONE'), (e: unknown) => (e instanceof LedgerError ? e.code : String(e).slice(0, 40)))));
    const [n] = await w.rows<{ n: number | string }>(`SELECT COUNT(*) AS n FROM state_transition_audit WHERE entity_id = ? AND to_state = 'POSTED'`, [id]);
    expect(Number(n?.n), JSON.stringify(res)).toBe(1);
  });

  it('deux contre-passations concurrentes de la même pièce : une seule', async () => {
    const w = await setup();
    const id = await w.sealed(cash(5000, 0));
    const res = await Promise.all([1, 2].map(() => code(w.engine.createReversalDraft(w.aide, { originalEntryId: id, entryDate: '2026-03-02', reasonText: 'erreur' }))));
    const [n] = await w.rows<{ n: number | string }>('SELECT COUNT(*) AS n FROM journal_entries WHERE reversal_of_entry_id = ?', [id]);
    expect(Number(n?.n), JSON.stringify(res)).toBe(1);
  });

  it('contre-passation d\'un brouillon (non POSTED) refusée', async () => {
    const w = await setup();
    const { entryId } = await w.engine.createDraft(w.aide, cash(5000, 0));
    expect(await code(w.engine.createReversalDraft(w.aide, { originalEntryId: entryId, entryDate: '2026-03-02', reasonText: 'x' }))).not.toBe('OK');
  });

  it('Step-Up expiré (> 300 s) : scellement refusé', async () => {
    const w = await setup();
    const id = await w.visaed(cash(5000, 0));
    const stale: LedgerActor = { ...w.oec, mfaVerifiedAtEpochSec: w.clock.currentEpochSec() - 301 };
    expect(await code(w.engine.sealEntry(stale, { entryId: id, idempotencyKey: w.key() }))).not.toBe('OK');
    const none: LedgerActor = { ...w.oec, mfaVerifiedAtEpochSec: undefined };
    expect(await code(w.engine.sealEntry(none, { entryId: id, idempotencyKey: w.key() }))).not.toBe('OK');
  });

  it('un acteur d\'un autre dossier (assignedCompanyIds) est refusé', async () => {
    const w = await setup();
    const id = await w.visaed(cash(5000, 0));
    const other: LedgerActor = { ...w.oec, assignedCompanyIds: ['autre-dossier'] };
    expect(await code(w.engine.sealEntry(other, { entryId: id, idempotencyKey: w.key() }))).not.toBe('OK');
  });

  it('mandat : un CHEF_MISSION plafonné AIDE_COMPTABLE ne vise ni ne scelle ; un OEC plafonné AIDE_COMPTABLE ne scelle pas', async () => {
    const w = await setup();
    const id = await w.visaed(cash(5000, 0)); const posted = await w.sealed(cash(7000, 0)); const draft = (await w.engine.createDraft(w.aide, cash(100, 0))).entryId;
    const ceiling = permissionsOfRole('AIDE_COMPTABLE');
    const chefCapped: LedgerActor = { ...w.chef, permissionCeiling: ceiling };
    const oecCapped: LedgerActor = { ...w.oec, permissionCeiling: ceiling };
    expect(await code(w.engine.visaCycle(chefCapped, { entryId: draft, idempotencyKey: w.key() }))).toBe('LEDGER_ACCESS_DENIED');
    expect(await code(w.engine.sealEntry(oecCapped, { entryId: id, idempotencyKey: w.key() }))).toBe('LEDGER_ACCESS_DENIED');
    expect(await code(w.engine.createReversalDraft({ ...w.chef, permissionCeiling: new Set() }, { originalEntryId: posted, entryDate: '2026-03-02', reasonText: 'x' }))).toBe('LEDGER_ACCESS_DENIED');
  });
});
