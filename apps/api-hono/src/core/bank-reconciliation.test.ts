import { afterAll, describe, expect, it } from 'vitest';
import type { SqlParam, SqlStatementParams, TenantSqlDriver } from '@fisca/shared-types';
import { ImmutableCgncLedgerEngine, LedgerError, type DraftLineInput, type LedgerActor } from './immutable-cgnc-ledger-engine.ts';
import { reconcileBankTransaction, reconciliationCodeFor, type BankReconciliationDeps } from './bank-reconciliation.ts';
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

/**
 * Pilote enveloppant : au premier lot dont une instruction contient `needle`, remplace CETTE instruction (ou la dernière du lot si
 * `target` vaut 'last') par une instruction invalide, puis exécute le lot sur la vraie base. L'échec survient donc APRÈS les
 * écritures précédentes du lot : seul un lot atomique les efface.
 */
function failingOnce(
  driver: TenantSqlDriver,
  needle: string,
  target: 'matching' | 'last' = 'matching',
): { readonly driver: TenantSqlDriver; readonly failures: () => number; readonly batchSizes: () => readonly number[] } {
  let failures = 0;
  const sizes: number[] = [];
  const wrapped: TenantSqlDriver = {
    tenantId: driver.tenantId,
    query: (statement) => driver.query(statement),
    executeBatchAtomically: async (statements: readonly SqlStatementParams[]) => {
      sizes.push(statements.length);
      if (failures === 0 && statements.some((statement) => statement.sql.includes(needle))) {
        failures += 1;
        const victim = target === 'last' ? statements.length - 1 : statements.findIndex((statement) => statement.sql.includes(needle));
        const broken = statements.map((statement, index) =>
          index === victim ? { sql: 'UPDATE bank_transactions SET colonne_inexistante_panne = 1', params: [] } : statement,
        );
        return driver.executeBatchAtomically(broken);
      }
      return driver.executeBatchAtomically(statements);
    },
  };
  return { driver: wrapped, failures: () => failures, batchSizes: () => sizes };
}

/** Barrière : les lots portant une pièce VAT_CLEARING partent ensemble, une fois les deux arrivés (demandes strictement simultanées). */
function simultaneous(driver: TenantSqlDriver, parties: number): TenantSqlDriver {
  let arrived = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    tenantId: driver.tenantId,
    query: (statement) => driver.query(statement),
    executeBatchAtomically: async (statements: readonly SqlStatementParams[]) => {
      if (statements.some((statement) => statement.sql.includes('INSERT INTO journal_entries'))) {
        arrived += 1;
        if (arrived >= parties) {
          release();
        }
        await gate;
      }
      return driver.executeBatchAtomically(statements);
    },
  };
}

const CLEARINGS = `SELECT id FROM journal_entries WHERE source_document_type = 'VAT_CLEARING'`;

const request = (world: World, bankTransactionId: string): ReconcileRequest => ({
  bankTransactionId,
  journalId: 'jr-od',
  fiscalYearId: FY_2026.id,
  entryDate: '2026-04-20',
  paymentMethodCode: '30_VIREMENT',
  candidates: [{ invoiceEntryId: world.invoiceEntryId, settledBeforeCents: 0 }],
});

describe.each(BACKENDS)('lettrage + VAT_CLEARING en UNE transaction atomique sur $name', (spec) => {
  it.each([
    ['la mise à jour de la ligne bancaire échoue', 'UPDATE bank_transactions', 'matching'],
    ['la dernière instruction du lot échoue', 'UPDATE bank_transactions', 'last'],
  ] as const)('%s : rien n\'écrit (0 brouillon, ligne inchangée), puis rejeu réussi : exactement 1 brouillon', async (_label, needle, target) => {
    const world = await build(await spec.open());
    await world.addBank('bk-1', 87500);
    const flaky = failingOnce(world.backend.driver, needle, target);

    await expect(reconcileBankTransaction(world.deps(flaky.driver), world.aide, request(world, 'bk-1'))).rejects.toBeInstanceOf(LedgerError);
    expect(flaky.failures()).toBe(1);
    expect(await world.rows(CLEARINGS)).toHaveLength(0);
    expect(await world.rows('SELECT id FROM journal_entry_lines WHERE reconciliation_code IS NOT NULL')).toHaveLength(0);
    const [stillOpen] = await world.rows<{ reconciliation_state: string; reconciliation_code: string | null; gl_entry_id: string | null }>(
      'SELECT reconciliation_state, reconciliation_code, gl_entry_id FROM bank_transactions WHERE id = ?',
      ['bk-1'],
    );
    expect(stillOpen).toEqual({ reconciliation_state: 'UNMATCHED', reconciliation_code: null, gl_entry_id: null });

    const replay = await reconcileBankTransaction(world.deps(flaky.driver), world.aide, request(world, 'bk-1'));
    expect(replay).toMatchObject({ outcome: 'MATCHED_FULL', bankTransactionId: 'bk-1', clearedCents: 12500, invoiceEntryId: world.invoiceEntryId });
    const drafts = await world.rows<{ id: string }>(CLEARINGS);
    expect(drafts).toHaveLength(1);
    expect(replay).toMatchObject({ clearingEntryId: drafts[0]?.id });
    const [bank] = await world.rows<{ reconciliation_state: string; reconciliation_code: string; gl_entry_id: string }>(
      'SELECT reconciliation_state, reconciliation_code, gl_entry_id FROM bank_transactions WHERE id = ?',
      ['bk-1'],
    );
    expect(bank).toEqual({
      reconciliation_state: 'MATCHED_FULL',
      reconciliation_code: 'reconciliationCode' in replay ? replay.reconciliationCode : null,
      gl_entry_id: drafts[0]?.id,
    });
  });

  it('le brouillon et la ligne bancaire partent dans UN SEUL lot (aucun second lot)', async () => {
    const world = await build(await spec.open());
    await world.addBank('bk-1', 87500);
    const spy = failingOnce(world.backend.driver, 'aucune-instruction-ne-contient-ceci');
    await reconcileBankTransaction(world.deps(spy.driver), world.aide, request(world, 'bk-1'));
    expect(spy.batchSizes()).toHaveLength(1);
    expect(spy.batchSizes()[0]).toBeGreaterThanOrEqual(5);
  });

  it('règlement partiel : MATCHED_PARTIAL, un seul brouillon, échec injecté sans orphelin', async () => {
    const world = await build(await spec.open());
    await world.addBank('bk-2', 35000);
    const flaky = failingOnce(world.backend.driver, 'UPDATE bank_transactions');
    await expect(reconcileBankTransaction(world.deps(flaky.driver), world.aide, request(world, 'bk-2'))).rejects.toBeInstanceOf(LedgerError);
    expect(await world.rows(CLEARINGS)).toHaveLength(0);
    const replay = await reconcileBankTransaction(world.deps(flaky.driver), world.aide, request(world, 'bk-2'));
    expect(replay).toMatchObject({ outcome: 'MATCHED_PARTIAL', clearedCents: 5000 });
    expect(await world.rows(CLEARINGS)).toHaveLength(1);
  });

  it('rejeu après succès : 409 (contrat existant), le brouillon déjà en place reste seul et lié à la ligne, sans doublon', async () => {
    const world = await build(await spec.open());
    await world.addBank('bk-1', 87500);
    const first = await reconcileBankTransaction(world.deps(world.backend.driver), world.aide, request(world, 'bk-1'));
    await expect(reconcileBankTransaction(world.deps(world.backend.driver), world.aide, request(world, 'bk-1'))).rejects.toMatchObject({
      problem: { errorCode: 'BANK_TRANSACTION_ALREADY_RECONCILED' },
    });
    const drafts = await world.rows<{ id: string }>(CLEARINGS);
    expect(drafts).toHaveLength(1);
    expect(first).toMatchObject({ clearingEntryId: drafts[0]?.id });
    const [bank] = await world.rows<{ gl_entry_id: string }>('SELECT gl_entry_id FROM bank_transactions WHERE id = ?', ['bk-1']);
    expect(bank?.gl_entry_id).toBe(drafts[0]?.id);
  });

  it('ligne bancaire déjà lettrée par une AUTRE demande : 409, aucun brouillon de plus', async () => {
    const world = await build(await spec.open());
    await world.addBank('bk-1', 35000);
    await reconcileBankTransaction(world.deps(world.backend.driver), world.aide, request(world, 'bk-1'));
    const other: ReconcileRequest = { ...request(world, 'bk-1'), candidates: [{ invoiceEntryId: world.invoiceEntryId, settledBeforeCents: 1000 }] };
    await expect(reconcileBankTransaction(world.deps(world.backend.driver), world.aide, other)).rejects.toMatchObject({ problem: { errorCode: 'BANK_TRANSACTION_ALREADY_RECONCILED' } });
    expect(await world.rows(CLEARINGS)).toHaveLength(1);
  });

  it('deux demandes STRICTEMENT simultanées : une seule gagne (le second lot est annulé), exactement UN brouillon', async () => {
    const world = await build(await spec.open());
    await world.addBank('bk-1', 87500);
    const gated = simultaneous(world.backend.driver, 2);
    const results = await Promise.allSettled([
      reconcileBankTransaction(world.deps(gated), world.aide, request(world, 'bk-1')),
      reconcileBankTransaction(world.deps(gated), world.aide, request(world, 'bk-1')),
    ]);
    const won = results.filter((result) => result.status === 'fulfilled');
    const lost = results.filter((result) => result.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const reason: unknown = lost[0]?.status === 'rejected' ? lost[0].reason : undefined;
    expect(reason).toMatchObject({ problem: { errorCode: 'BANK_TRANSACTION_ALREADY_RECONCILED' } });
    const drafts = await world.rows<{ id: string }>(CLEARINGS);
    expect(drafts).toHaveLength(1);
    const [bank] = await world.rows<{ reconciliation_state: string; gl_entry_id: string }>('SELECT reconciliation_state, gl_entry_id FROM bank_transactions WHERE id = ?', ['bk-1']);
    expect(bank).toEqual({ reconciliation_state: 'MATCHED_FULL', gl_entry_id: drafts[0]?.id });
  });

  it('deux lignes bancaires distinctes pour la même facture gardent chacune leur brouillon (la reprise ne fusionne pas des demandes différentes)', async () => {
    const world = await build(await spec.open());
    await world.addBank('bk-3', 35000);
    await world.addBank('bk-4', 35000);
    const first = await reconcileBankTransaction(world.deps(world.backend.driver), world.aide, request(world, 'bk-3'));
    const second = await reconcileBankTransaction(world.deps(world.backend.driver), world.aide, request(world, 'bk-4'));
    expect(first).toMatchObject({ outcome: 'MATCHED_PARTIAL' });
    expect(second).toMatchObject({ outcome: 'MATCHED_PARTIAL' });
    expect(await world.rows(CLEARINGS)).toHaveLength(2);
  });

  it('LCN code 42 : échéance atteinte sans encaissement effectif, refus LEDGER_VAT_CLEARING_DEFERRED_LCN, aucun brouillon, ligne inchangée', async () => {
    const world = await build(await spec.open());
    await world.addBank('bk-1', 87500);
    const lcn: ReconcileRequest = { ...request(world, 'bk-1'), paymentMethodCode: '42_EFFET_LCN', entryDate: '2026-05-30' };
    await expect(reconcileBankTransaction(world.deps(world.backend.driver), world.aide, lcn)).rejects.toMatchObject({ code: 'LEDGER_VAT_CLEARING_DEFERRED_LCN' });
    expect(await world.rows(CLEARINGS)).toHaveLength(0);
    const [bank] = await world.rows<{ reconciliation_state: string }>('SELECT reconciliation_state FROM bank_transactions WHERE id = ?', ['bk-1']);
    expect(bank?.reconciliation_state).toBe('UNMATCHED');
    const collected = await reconcileBankTransaction(world.deps(world.backend.driver), world.aide, { ...lcn, lcnBankCollectionDate: '2026-05-30' });
    expect(collected).toMatchObject({ outcome: 'MATCHED_FULL' });
    expect(await world.rows(CLEARINGS)).toHaveLength(1);
  });

  it('buildVatClearingDraftStatements ne rien écrit seul ; createVatClearingDraft garde son comportement', async () => {
    const world = await build(await spec.open());
    const input = {
      invoiceEntryId: world.invoiceEntryId,
      journalId: 'jr-od',
      fiscalYearId: FY_2026.id,
      entryDate: '2026-04-20',
      settledBeforeCents: 0,
      settledNowCents: 87500,
      paymentMethodCode: '30_VIREMENT',
    } as const;
    const built = await world.engine.buildVatClearingDraftStatements(world.aide, input);
    expect(built.statements.length).toBeGreaterThanOrEqual(3);
    expect(await world.rows(CLEARINGS)).toHaveLength(0);
    await world.backend.driver.executeBatchAtomically(built.statements);
    expect((await world.rows<{ id: string }>(CLEARINGS))[0]?.id).toBe(built.entryId);
    const direct = await world.engine.createVatClearingDraft(world.aide, input);
    expect(direct.clearedCents).toBe(built.clearedCents);
    expect(await world.rows(CLEARINGS)).toHaveLength(2);
  });

  it('brouillon orphelin hérité (code posé, ligne encore UNMATCHED) : réutilisé, ligne marquée, pas de second brouillon', async () => {
    const world = await build(await spec.open());
    await world.addBank('bk-1', 87500);
    const code = await reconciliationCodeFor(['bk-1', world.invoiceEntryId, 0, 87500]);
    const orphan = await world.engine.createVatClearingDraft(world.aide, {
      invoiceEntryId: world.invoiceEntryId,
      journalId: 'jr-od',
      fiscalYearId: FY_2026.id,
      entryDate: '2026-04-20',
      settledBeforeCents: 0,
      settledNowCents: 87500,
      paymentMethodCode: '30_VIREMENT',
      reconciliationCode: code,
    });
    const result = await reconcileBankTransaction(world.deps(world.backend.driver), world.aide, request(world, 'bk-1'));
    expect(result).toMatchObject({ outcome: 'MATCHED_FULL', clearingEntryId: orphan.entryId });
    expect(await world.rows(CLEARINGS)).toHaveLength(1);
  });
});
