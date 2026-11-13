import { afterAll, describe, expect, it } from 'vitest';
import type { SqlParam, SqlStatementParams, TenantSqlDriver } from '@fisca/shared-types';
import { ImmutableCgncLedgerEngine, LedgerError, type DraftLineInput, type LedgerActor } from './immutable-cgnc-ledger-engine.ts';
import { reconcileBankTransaction, type BankReconciliationDeps } from './bank-reconciliation.ts';
import type { ReconcileRequest } from './api-v1-schemas.ts';
import {
  COMPANY_ID,
  FY_2026,
  PostgresHarness,
  SequentialUuidV7,
  StepClock,
  StubPreCloseControls,
  actorOf,
  openSqliteBackend,
  seedLedger,
  testCipher,
  testOnlyHasher,
  type LedgerBackend,
} from './ledger-test-harness.ts';

/**
 * Reprise du lettrage bancaire (T-S1B-04, clause G1) : le brouillon VAT_CLEARING puis la ligne bancaire s'écrivent en deux lots
 * (non atomique, toléré à condition que la reprise ne crée JAMAIS un second brouillon). Prouvé sur SQLite et PostgreSQL 16 réels.
 */
const postgres = new PostgresHarness();
afterAll(async () => {
  await postgres.close();
});

const BACKENDS: readonly { readonly name: 'sqlite' | 'postgres'; open(): Promise<LedgerBackend> }[] = [
  { name: 'sqlite', open: openSqliteBackend },
  { name: 'postgres', open: () => postgres.fresh() },
];

const L = (accountNumber: string, debitCents: number, creditCents: number): DraftLineInput => ({
  accountNumber,
  debitCents,
  creditCents,
  description: `ligne ${accountNumber}`,
});

interface World {
  readonly backend: LedgerBackend;
  readonly engine: ImmutableCgncLedgerEngine;
  readonly aide: LedgerActor;
  readonly invoiceEntryId: string;
  deps(db: TenantSqlDriver): BankReconciliationDeps;
  rows<T>(sql: string, params?: readonly SqlParam[]): Promise<readonly T[]>;
  addBank(id: string, amountCents: number): Promise<void>;
}

async function build(backend: LedgerBackend): Promise<World> {
  await seedLedger(backend.driver);
  const clock = new StepClock();
  const ids = new SequentialUuidV7();
  const engine = new ImmutableCgncLedgerEngine({
    db: backend.driver,
    companyId: COMPANY_ID,
    clock,
    ids,
    hasher: testOnlyHasher,
    cipher: testCipher,
    preCloseControls: new StubPreCloseControls(),
  });
  const aide = actorOf('AIDE_COMPTABLE', 'u-aide', {}, clock);
  const chef = actorOf('CHEF_MISSION', 'u-chef', {}, clock);
  const oec = actorOf('EXPERT_COMPTABLE_OEC', 'u-oec', {}, clock);
  let keyCounter = 0;
  const key = (): string => `idem-${(keyCounter += 1)}`;
  const created = await engine.createDraft(aide, {
    journalId: 'jr-vte',
    fiscalYearId: FY_2026.id,
    entryDate: '2026-04-01',
    reviewCycle: 'VENTES',
    sourceDocumentType: 'INVOICE',
    initialState: 'DRAFT',
    lines: [L('34210000', 87500, 0), L('71110000', 0, 75000), L('44558000', 0, 12500)],
  });
  await engine.visaCycle(chef, { entryId: created.entryId, idempotencyKey: key() });
  await engine.sealEntry({ ...oec, mfaVerifiedAtEpochSec: clock.currentEpochSec() }, { entryId: created.entryId, idempotencyKey: key() });
  return {
    backend,
    engine,
    aide,
    invoiceEntryId: created.entryId,
    deps: (db) => ({ db, engine, authorize: () => undefined }),
    rows: async <T>(sql: string, params: readonly SqlParam[] = []) => backend.driver.query<T>({ sql, params }),
    addBank: async (id, amountCents) => {
      await backend.driver.executeBatchAtomically([
        {
          sql: `INSERT INTO bank_transactions (id, bank_code, statement_date, value_date, raw_label_enc, reference_code, amount_cents) VALUES (?, 'BMCE', '2026-04-20', '2026-04-20', 'enc', NULL, ?)`,
          params: [id, amountCents],
        },
      ]);
    },
  };
}

/** Pilote qui échoue UNE fois sur le premier lot dont une instruction contient `needle` (panne entre les deux écritures). */
function failingOnce(driver: TenantSqlDriver, needle: string): { readonly driver: TenantSqlDriver; readonly failures: () => number } {
  let failures = 0;
  const wrapped: TenantSqlDriver = {
    tenantId: driver.tenantId,
    query: (statement) => driver.query(statement),
    executeBatchAtomically: async (statements: readonly SqlStatementParams[]) => {
      if (failures === 0 && statements.some((statement) => statement.sql.includes(needle))) {
        failures += 1;
        throw new Error('panne simulée sur le second lot');
      }
      return driver.executeBatchAtomically(statements);
    },
  };
  return { driver: wrapped, failures: () => failures };
}

const request = (world: World, bankTransactionId: string): ReconcileRequest => ({
  bankTransactionId,
  journalId: 'jr-od',
  fiscalYearId: FY_2026.id,
  entryDate: '2026-04-20',
  paymentMethodCode: '30_VIREMENT',
  candidates: [{ invoiceEntryId: world.invoiceEntryId, settledBeforeCents: 0 }],
});

describe.each(BACKENDS)('reprise idempotente du lettrage sur $name', (spec) => {
  it('échec entre le brouillon VAT_CLEARING et la ligne bancaire, puis rejeu : exactement UN brouillon, la ligne passe à MATCHED_FULL', async () => {
    const world = await build(await spec.open());
    await world.addBank('bk-1', 87500);
    const flaky = failingOnce(world.backend.driver, 'UPDATE bank_transactions');

    await expect(reconcileBankTransaction(world.deps(flaky.driver), world.aide, request(world, 'bk-1'))).rejects.toBeInstanceOf(LedgerError);
    expect(flaky.failures()).toBe(1);
    const afterFailure = await world.rows<{ id: string }>(`SELECT id FROM journal_entries WHERE source_document_type = 'VAT_CLEARING'`);
    expect(afterFailure).toHaveLength(1);
    const [stillOpen] = await world.rows<{ reconciliation_state: string }>('SELECT reconciliation_state FROM bank_transactions WHERE id = ?', ['bk-1']);
    expect(stillOpen?.reconciliation_state).toBe('UNMATCHED');

    const replay = await reconcileBankTransaction(world.deps(flaky.driver), world.aide, request(world, 'bk-1'));
    expect(replay).toMatchObject({ outcome: 'MATCHED_FULL', bankTransactionId: 'bk-1', clearedCents: 12500 });
    const drafts = await world.rows<{ id: string }>(`SELECT id FROM journal_entries WHERE source_document_type = 'VAT_CLEARING'`);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.id).toBe(afterFailure[0]?.id);
    expect(replay).toMatchObject({ clearingEntryId: afterFailure[0]?.id, invoiceEntryId: world.invoiceEntryId });
    const [bank] = await world.rows<{ reconciliation_state: string; reconciliation_code: string }>(
      'SELECT reconciliation_state, reconciliation_code FROM bank_transactions WHERE id = ?',
      ['bk-1'],
    );
    expect(bank).toEqual({ reconciliation_state: 'MATCHED_FULL', reconciliation_code: 'reconciliationCode' in replay ? replay.reconciliationCode : null });
  });

  it('règlement partiel : même reprise, un seul brouillon, MATCHED_PARTIAL', async () => {
    const world = await build(await spec.open());
    await world.addBank('bk-2', 35000);
    const flaky = failingOnce(world.backend.driver, 'UPDATE bank_transactions');
    await expect(reconcileBankTransaction(world.deps(flaky.driver), world.aide, request(world, 'bk-2'))).rejects.toBeInstanceOf(LedgerError);
    const replay = await reconcileBankTransaction(world.deps(flaky.driver), world.aide, request(world, 'bk-2'));
    expect(replay).toMatchObject({ outcome: 'MATCHED_PARTIAL', clearedCents: 5000 });
    expect(await world.rows(`SELECT id FROM journal_entries WHERE source_document_type = 'VAT_CLEARING'`)).toHaveLength(1);
  });

  it('deux lignes bancaires distinctes pour la même facture gardent chacune leur brouillon (la reprise ne fusionne pas des demandes différentes)', async () => {
    const world = await build(await spec.open());
    await world.addBank('bk-3', 35000);
    await world.addBank('bk-4', 35000);
    const first = await reconcileBankTransaction(world.deps(world.backend.driver), world.aide, request(world, 'bk-3'));
    const second = await reconcileBankTransaction(world.deps(world.backend.driver), world.aide, request(world, 'bk-4'));
    expect(first).toMatchObject({ outcome: 'MATCHED_PARTIAL' });
    expect(second).toMatchObject({ outcome: 'MATCHED_PARTIAL' });
    expect(await world.rows(`SELECT id FROM journal_entries WHERE source_document_type = 'VAT_CLEARING'`)).toHaveLength(2);
  });
});
