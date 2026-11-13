import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { JOURNAL_ENTRY_FSM, InfrastructureError } from '@fisca/shared-types';
import {
  ImmutableCgncLedgerEngine,
  LEDGER_ENTRY_STATES,
  LedgerError,
  type CreateDraftInput,
  type CreateVatClearingDraftInput,
  type DraftLineInput,
  type LedgerActor,
} from './immutable-cgnc-ledger-engine.ts';
import {
  BASE_EPOCH_SEC,
  COMPANY_ID,
  FY_2026,
  FY_2027,
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

const NON_INTEGER = 10.5;
const HEX64 = /^[0-9a-f]{64}$/;
const GENESIS = 'GENESIS_HASH_00000000000000000000000000000000';

const L = (accountNumber: string, debitCents: number, creditCents: number, extra: Partial<DraftLineInput> = {}): DraftLineInput => ({
  accountNumber,
  debitCents,
  creditCents,
  description: `ligne ${accountNumber}`,
  ...extra,
});

async function failure(action: () => Promise<unknown>): Promise<LedgerError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof LedgerError) return error;
    throw error;
  }
  throw new Error('LedgerError attendue');
}

interface World {
  readonly backend: LedgerBackend;
  readonly engine: ImmutableCgncLedgerEngine;
  readonly clock: StepClock;
  readonly controls: StubPreCloseControls;
  readonly aide: LedgerActor;
  readonly chef: LedgerActor;
  readonly oec: LedgerActor;
  readonly gerant: LedgerActor;
  key(): string;
  rows<T>(sql: string, params?: readonly (string | number | null)[]): Promise<readonly T[]>;
  exec(sql: string, params?: readonly (string | number | null)[]): Promise<void>;
}

async function buildWorld(backend: LedgerBackend): Promise<World> {
  await seedLedger(backend.driver);
  const clock = new StepClock();
  const controls = new StubPreCloseControls();
  const engine = new ImmutableCgncLedgerEngine({
    db: backend.driver,
    companyId: COMPANY_ID,
    clock,
    ids: new SequentialUuidV7(),
    hasher: testOnlyHasher,
    cipher: testCipher,
    preCloseControls: controls,
  });
  let keyCounter = 0;
  return {
    backend,
    engine,
    clock,
    controls,
    aide: actorOf('AIDE_COMPTABLE', 'u-aide', {}, clock),
    chef: actorOf('CHEF_MISSION', 'u-chef', {}, clock),
    oec: actorOf('EXPERT_COMPTABLE_OEC', 'u-oec', {}, clock),
    gerant: actorOf('OWNER_GERANT', 'u-gerant', { orgPlanSegment: 'DIRECT_PME', activeHumanMembersCount: 2 }, clock),
    key: () => `idem-${(keyCounter += 1)}`,
    rows: async <T>(sql: string, params: readonly (string | number | null)[] = []) => backend.driver.query<T>({ sql, params }),
    exec: async (sql, params = []) => {
      await backend.driver.executeBatchAtomically([{ sql, params }]);
    },
  };
}

/** Fraîcheur du Step-Up : l'acteur est ré-authentifié à l'instant courant de l'horloge injectée. */
function fresh(world: World, actor: LedgerActor): LedgerActor {
  return { ...actor, mfaVerifiedAtEpochSec: world.clock.currentEpochSec() };
}

function draftInput(overrides: Partial<CreateDraftInput> = {}): CreateDraftInput {
  return {
    journalId: 'jr-cai',
    fiscalYearId: FY_2026.id,
    entryDate: '2026-03-01',
    reviewCycle: 'TRESORERIE',
    sourceDocumentType: 'PAYMENT',
    initialState: 'IA_PROPOSITION',
    lines: [L('51610000', 500000, 0), L('11110000', 0, 500000)],
    ...overrides,
  };
}

/** Parcours complet des trois niveaux de visa, avec un acteur par niveau. */
async function postEntry(world: World, input: CreateDraftInput): Promise<string> {
  const created = await world.engine.createDraft(world.aide, input);
  if (input.initialState === 'IA_PROPOSITION') {
    await world.engine.submitDraft(world.aide, { entryId: created.entryId, idempotencyKey: world.key() });
  }
  await world.engine.visaCycle(world.chef, { entryId: created.entryId, idempotencyKey: world.key() });
  await world.engine.sealEntry(fresh(world, world.oec), { entryId: created.entryId, idempotencyKey: world.key() });
  return created.entryId;
}

async function statusOf(world: World, entryId: string): Promise<string> {
  const rows = await world.rows<{ status: string }>('SELECT status FROM journal_entries WHERE id = ?', [entryId]);
  return rows[0]?.status ?? 'ABSENT';
}

async function auditCount(world: World, entryId: string): Promise<number> {
  const rows = await world.rows<{ n: number }>('SELECT COUNT(*) AS n FROM state_transition_audit WHERE entity_id = ?', [entryId]);
  return Number(rows[0]?.n ?? 0);
}

async function netOf(world: World, accountNumber: string): Promise<number> {
  const rows = await world.rows<{ net: number }>(
    `SELECT CAST(COALESCE(SUM(jel.debit_cents - jel.credit_cents), 0) AS BIGINT) AS net
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id JOIN cgnc_accounts ca ON ca.id = jel.account_id
      WHERE je.status = 'POSTED' AND ca.account_number = ?`,
    [accountNumber],
  );
  return Number(rows[0]?.net ?? 0);
}

const postgres = new PostgresHarness();
afterAll(async () => {
  await postgres.close();
});

const BACKENDS: readonly { readonly name: 'sqlite' | 'postgres'; open(): Promise<LedgerBackend> }[] = [
  { name: 'sqlite', open: openSqliteBackend },
  { name: 'postgres', open: () => postgres.fresh() },
];

describe('FSM du grand livre : aucun état CONTRE_PASSEE (ERRATA D-03)', () => {
  it('les états exposés sont les quatre du CHECK et la FSM de shared-types n\'en connaît pas d\'autre', () => {
    expect([...LEDGER_ENTRY_STATES]).toEqual(['IA_PROPOSITION', 'DRAFT', 'REVISEE_CYCLE', 'POSTED']);
    expect([...JOURNAL_ENTRY_FSM.states]).toEqual([...LEDGER_ENTRY_STATES]);
    expect(JSON.stringify(JOURNAL_ENTRY_FSM)).not.toContain('CONTRE_PASSEE');
  });

  it('le code source du moteur ne contient aucun taux, aucun seuil ni aucune règle fiscale chiffrée en dur (loi 2)', () => {
    for (const file of ['immutable-cgnc-ledger-engine.ts', 'ledger-calculations.ts', 'ledger-errors.ts']) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/vat_rate|taux|\b(2000|1400|700|0\.2|0\.1)\b/i);
    }
  });
});

describe.each(BACKENDS)('ImmutableCgncLedgerEngine sur $name', (backendSpec) => {
  let world: World;

  const setup = async (): Promise<World> => {
    world = await buildWorld(await backendSpec.open());
    return world;
  };

  it('parcours complet : brouillon → visa 1 (aide-comptable) → visa 2 (chef de mission) → scellement OEC, avec chaîne par journal', async () => {
    const w = await setup();
    const created = await w.engine.createDraft(w.aide, draftInput());
    expect(created).toMatchObject({ status: 'IA_PROPOSITION', sequenceNumber: 1, entryReference: 'CAI/EX-2026/000001' });

    expect(await w.engine.submitDraft(w.aide, { entryId: created.entryId, idempotencyKey: w.key() })).toMatchObject({ toState: 'DRAFT', replayed: false });
    expect(await w.engine.visaCycle(w.chef, { entryId: created.entryId, idempotencyKey: w.key() })).toMatchObject({ toState: 'REVISEE_CYCLE' });
    const sealed = await w.engine.sealEntry(fresh(w, w.oec), { entryId: created.entryId, idempotencyKey: w.key() });
    expect(sealed).toMatchObject({ toState: 'POSTED', replayed: false, previousEntryHash: GENESIS });
    expect(sealed.entryHash).toMatch(HEX64);

    const [entry] = await w.rows<{ status: string; entry_hash: string; previous_entry_hash: string; validated_at: string }>(
      'SELECT status, entry_hash, previous_entry_hash, validated_at FROM journal_entries WHERE id = ?',
      [created.entryId],
    );
    expect(entry).toMatchObject({ status: 'POSTED', entry_hash: sealed.entryHash, previous_entry_hash: GENESIS });
    expect(entry?.validated_at).toBeTruthy();
    const [journal] = await w.rows<{ last_entry_hash: string; last_sequence_number: number }>(
      `SELECT last_entry_hash, last_sequence_number FROM journals WHERE id = 'jr-cai'`,
    );
    expect(journal).toMatchObject({ last_entry_hash: sealed.entryHash, last_sequence_number: 1 });

    const audit = await w.rows<{ from_state: string; to_state: string; actor_id: string; actor_kind: string }>(
      `SELECT from_state, to_state, actor_id, actor_kind FROM state_transition_audit WHERE entity_id = ? ORDER BY created_at`,
      [created.entryId],
    );
    expect(audit).toEqual([
      { from_state: 'IA_PROPOSITION', to_state: 'DRAFT', actor_id: 'u-aide', actor_kind: 'HUMAN_USER' },
      { from_state: 'DRAFT', to_state: 'REVISEE_CYCLE', actor_id: 'u-chef', actor_kind: 'HUMAN_USER' },
      { from_state: 'REVISEE_CYCLE', to_state: 'POSTED', actor_id: 'u-oec', actor_kind: 'HUMAN_USER' },
    ]);

    const second = await postEntry(w, draftInput({ entryDate: '2026-03-02' }));
    const [secondRow] = await w.rows<{ previous_entry_hash: string }>('SELECT previous_entry_hash FROM journal_entries WHERE id = ?', [second]);
    expect(secondRow?.previous_entry_hash).toBe(sealed.entryHash);
    expect(await w.engine.verifyJournalChain('jr-cai')).toEqual({ valid: true, length: 2 });
  });

  it('refus à chaque niveau par rôle, par Step-Up, par portefeuille : aucun changement d\'état ni d\'audit', async () => {
    const w = await setup();
    const { entryId } = await w.engine.createDraft(w.aide, draftInput());

    expect((await failure(() => w.engine.visaCycle(w.aide, { entryId, idempotencyKey: w.key() }))).denialCode).toBe('RBAC_FORBIDDEN_FOR_AIDE_COMPTABLE');
    await w.engine.submitDraft(w.aide, { entryId, idempotencyKey: w.key() });
    expect((await failure(() => w.engine.visaCycle(w.aide, { entryId, idempotencyKey: w.key() }))).code).toBe('LEDGER_ACCESS_DENIED');
    expect((await failure(() => w.engine.sealEntry(fresh(w, w.aide), { entryId, idempotencyKey: w.key() }))).denialCode).toBe('RBAC_FORBIDDEN_FOR_AIDE_COMPTABLE');
    expect((await failure(() => w.engine.sealEntry(fresh(w, w.chef), { entryId, idempotencyKey: w.key() }))).denialCode).toBe('RBAC_FORBIDDEN_FOR_CHEF_MISSION');
    expect((await failure(() => w.engine.visaCycle(w.gerant, { entryId, idempotencyKey: w.key() }))).denialCode).toBe('RBAC_FORBIDDEN_FOR_OWNER_GERANT');
    const outsider = actorOf('CHEF_MISSION', 'u-autre', { assignedCompanyIds: ['soc-autre'] }, w.clock);
    expect((await failure(() => w.engine.visaCycle(outsider, { entryId, idempotencyKey: w.key() }))).denialCode).toBe('ABAC_TENANT_OUT_OF_SCOPE');
    const mcp = actorOf('AI_MCP_ACTOR', 'u-mcp', {}, w.clock);
    expect((await failure(() => w.engine.createDraft(mcp, draftInput()))).denialCode).toBe('RBAC_FORBIDDEN_FOR_AI_MCP_ACTOR');
    const readOnly = actorOf('AIDE_COMPTABLE', 'u-ro', { subscriptionReadOnly: true }, w.clock);
    expect((await failure(() => w.engine.createDraft(readOnly, draftInput()))).denialCode).toBe('ABAC_SUBSCRIPTION_READ_ONLY');
    expect(await statusOf(w, entryId)).toBe('DRAFT');
    expect(await auditCount(w, entryId)).toBe(1);

    await w.engine.visaCycle(w.chef, { entryId, idempotencyKey: w.key() });
    const stale = { ...w.oec, mfaVerifiedAtEpochSec: w.clock.currentEpochSec() - 301 };
    expect((await failure(() => w.engine.sealEntry(stale, { entryId, idempotencyKey: w.key() }))).denialCode).toBe('ABAC_STEP_UP_MFA_REQUIRED');
    const noProof = { ...w.oec, mfaVerifiedAtEpochSec: undefined };
    expect((await failure(() => w.engine.sealEntry(noProof, { entryId, idempotencyKey: w.key() }))).denialCode).toBe('ABAC_STEP_UP_MFA_REQUIRED');
    expect(await statusOf(w, entryId)).toBe('REVISEE_CYCLE');
    expect(await auditCount(w, entryId)).toBe(2);
    expect(BASE_EPOCH_SEC).toBeGreaterThan(0);
  });

  it('sources injectées : un identifiant qui n\'est pas un UUIDv7 et une empreinte mal formée sont refusés avant toute écriture', async () => {
    const w = await setup();
    const badIds = new ImmutableCgncLedgerEngine({
      db: w.backend.driver,
      companyId: COMPANY_ID,
      clock: w.clock,
      ids: { newId: () => 'pas-un-uuid' },
      hasher: testOnlyHasher,
      cipher: testCipher,
      preCloseControls: w.controls,
    });
    expect((await failure(() => badIds.createDraft(w.aide, draftInput()))).code).toBe('LEDGER_INVALID_ID_SOURCE');
    const badHasher = new ImmutableCgncLedgerEngine({
      db: w.backend.driver,
      companyId: COMPANY_ID,
      clock: w.clock,
      ids: new SequentialUuidV7(),
      hasher: { computeEntryHash: async () => 'ABC', computeClosingHash: async () => 'ABC' },
      cipher: testCipher,
      preCloseControls: w.controls,
    });
    const { entryId } = await badHasher.createDraft(w.aide, draftInput({ initialState: 'DRAFT' }));
    await badHasher.visaCycle(w.chef, { entryId, idempotencyKey: w.key() });
    expect((await failure(() => badHasher.sealEntry(fresh(w, w.oec), { entryId, idempotencyKey: w.key() }))).code).toBe('LEDGER_HASH_INVALID');
    expect(await statusOf(w, entryId)).toBe('REVISEE_CYCLE');
    const [count] = await w.rows<{ n: number }>('SELECT COUNT(*) AS n FROM journal_entries');
    expect(Number(count?.n)).toBe(1);
  });

  it('hiérarchie OEC : le gérant scelle en direct (Doc_09 § 06B) mais seulement une pièce déjà visée par le chef de mission', async () => {
    const w = await setup();
    const { entryId } = await w.engine.createDraft(w.aide, draftInput({ initialState: 'DRAFT' }));
    const early = await failure(() => w.engine.sealEntry(fresh(w, w.gerant), { entryId, idempotencyKey: w.key() }));
    expect(early.code).toBe('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE');
    await w.engine.visaCycle(w.chef, { entryId, idempotencyKey: w.key() });
    expect((await w.engine.sealEntry(fresh(w, w.gerant), { entryId, idempotencyKey: w.key() })).toState).toBe('POSTED');
  });

  it('refuse une écriture déséquilibrée, une ligne mixte, un montant non entier, un compte ou un journal inconnu', async () => {
    const w = await setup();
    const unbalanced = await failure(() => w.engine.createDraft(w.aide, draftInput({ lines: [L('51610000', 100000, 0), L('11110000', 0, 90000)] })));
    expect(unbalanced).toMatchObject({ code: 'LEDGER_UNBALANCED', origin: 'ENGINE' });
    expect((await failure(() => w.engine.createDraft(w.aide, draftInput({ lines: [L('51610000', 5, 5), L('11110000', 0, 0)] })))).code).toBe('LEDGER_INVALID_LINE');
    expect((await failure(() => w.engine.createDraft(w.aide, draftInput({ lines: [L('51610000', NON_INTEGER, 0), L('11110000', 0, NON_INTEGER)] })))).code).toBe('LEDGER_INVALID_AMOUNT');
    expect((await failure(() => w.engine.createDraft(w.aide, draftInput({ lines: [L('99999999', 10, 0), L('11110000', 0, 10)] })))).code).toBe('LEDGER_UNKNOWN_ACCOUNT');
    expect((await failure(() => w.engine.createDraft(w.aide, draftInput({ journalId: 'jr-inconnu' })))).code).toBe('LEDGER_UNKNOWN_JOURNAL');
    expect((await failure(() => w.engine.createDraft(w.aide, draftInput({ fiscalYearId: 'fy-inconnu' })))).code).toBe('LEDGER_UNKNOWN_FISCAL_YEAR');
    expect((await failure(() => w.engine.createDraft(w.aide, draftInput({ sourceDocumentType: 'REVERSAL' })))).code).toBe('LEDGER_INVALID_INPUT');
    expect((await failure(() => w.engine.createDraft(w.aide, draftInput({ initialState: 'POSTED' } as unknown as Partial<CreateDraftInput>)))).code).toBe(
      'LEDGER_INVALID_INITIAL_STATE',
    );
    const [count] = await w.rows<{ n: number }>('SELECT COUNT(*) AS n FROM journal_entries');
    expect(Number(count?.n)).toBe(0);
  });

  it('scellement : le moteur détecte lui-même des lignes qui ne bouclent pas avec la pièce, avant le trigger', async () => {
    const w = await setup();
    await w.exec(
      `INSERT INTO journal_entries (id, fiscal_year_id, journal_id, sequence_number, entry_reference, entry_date, status, source_document_type, total_debit_cents, total_credit_cents)
       VALUES ('e-tamper', ?, 'jr-od', 1, 'OD/EX-2026/000001', '2026-04-01', 'REVISEE_CYCLE', 'CUTOFF_OD', 1000, 1000)`,
      [FY_2026.id],
    );
    await w.backend.driver.executeBatchAtomically([
      { sql: `INSERT INTO journal_entry_lines (id, entry_id, line_number, account_id, description_enc, debit_cents, credit_cents) VALUES ('l-1', 'e-tamper', 1, 'acc-51610000', 'x', 1000, 0)`, params: [] },
      { sql: `INSERT INTO journal_entry_lines (id, entry_id, line_number, account_id, description_enc, debit_cents, credit_cents) VALUES ('l-2', 'e-tamper', 2, 'acc-11110000', 'x', 0, 900)`, params: [] },
    ]);
    const error = await failure(() => w.engine.sealEntry(fresh(w, w.oec), { entryId: 'e-tamper', idempotencyKey: w.key() }));
    expect(error).toMatchObject({ code: 'LEDGER_UNBALANCED', origin: 'ENGINE' });
    expect(await statusOf(w, 'e-tamper')).toBe('REVISEE_CYCLE');
    expect(await auditCount(w, 'e-tamper')).toBe(0);
    // Dernière ligne de défense : le trigger refuse la même pièce si on contourne le moteur.
    await expect(
      w.exec(`UPDATE journal_entries SET status = 'POSTED', entry_hash = ?, previous_entry_hash = ? WHERE id = 'e-tamper'`, ['a'.repeat(64), GENESIS]),
    ).rejects.toThrow(/CGNC_UNBALANCED_LINES/);
  });

  it('base (décision du pilote 7, migration v11) : hors du moteur, DRAFT ou IA_PROPOSITION vers POSTED est refusé par le trigger ; le moteur, lui, ne scelle que depuis REVISEE_CYCLE', async () => {
    const w = await setup();
    const draft = await w.engine.createDraft(w.aide, draftInput({ initialState: 'DRAFT' }));
    const proposal = await w.engine.createDraft(w.aide, draftInput({ initialState: 'IA_PROPOSITION' }));
    for (const entryId of [draft.entryId, proposal.entryId]) {
      await expect(
        w.exec(`UPDATE journal_entries SET status = 'POSTED', entry_hash = ?, previous_entry_hash = ? WHERE id = ?`, ['a'.repeat(64), GENESIS, entryId]),
      ).rejects.toThrow(/CGNC_POST_ONLY_FROM_REVISED_CYCLE/);
    }
    expect(await statusOf(w, draft.entryId)).toBe('DRAFT');
    expect(await statusOf(w, proposal.entryId)).toBe('IA_PROPOSITION');
    // Le chemin du moteur passe par REVISEE_CYCLE (visa du chef de mission) : le scellement aboutit.
    await w.engine.visaCycle(w.chef, { entryId: draft.entryId, idempotencyKey: w.key() });
    expect((await w.engine.sealEntry(fresh(w, w.oec), { entryId: draft.entryId, idempotencyKey: w.key() })).toState).toBe('POSTED');
    // Aucun chemin « gérant en direct » depuis DRAFT : le moteur refuse avant la base.
    expect((await failure(() => w.engine.sealEntry(fresh(w, w.gerant), { entryId: proposal.entryId, idempotencyKey: w.key() }))).code).toBe('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE');
  });

  it('caisse 5161 : un décaissement qui la rendrait négative est refusé par le moteur ; le solde nul est admis', async () => {
    const w = await setup();
    await postEntry(w, draftInput({ lines: [L('51610000', 200000, 0), L('11110000', 0, 200000)] }));
    const over = await w.engine.createDraft(w.aide, draftInput({ initialState: 'DRAFT', lines: [L('23400000', 200001, 0), L('51610000', 0, 200001)] }));
    await w.engine.visaCycle(w.chef, { entryId: over.entryId, idempotencyKey: w.key() });
    const refused = await failure(() => w.engine.sealEntry(fresh(w, w.oec), { entryId: over.entryId, idempotencyKey: w.key() }));
    expect(refused).toMatchObject({ code: 'LEDGER_NEGATIVE_CASH', origin: 'ENGINE' });
    expect(await statusOf(w, over.entryId)).toBe('REVISEE_CYCLE');
    expect(await netOf(w, '51610000')).toBe(200000);

    const exact = await postEntry(w, draftInput({ initialState: 'DRAFT', lines: [L('23400000', 200000, 0), L('51610000', 0, 200000)] }));
    expect(await statusOf(w, exact)).toBe('POSTED');
    expect(await netOf(w, '51610000')).toBe(0);
  });

  it('contre-passation : nouvelle écriture liée par reversal_of_entry_id, lignes inversées, originale intacte, jamais de statut CONTRE_PASSEE', async () => {
    const w = await setup();
    const original = await postEntry(
      w,
      draftInput({
        journalId: 'jr-vte',
        sourceDocumentType: 'INVOICE',
        reviewCycle: 'VENTES',
        lines: [L('34210000', 120000, 0), L('71110000', 0, 100000), L('44558000', 0, 20000)],
      }),
    );
    const before = await w.rows<Record<string, string | number | null>>('SELECT * FROM journal_entries WHERE id = ?', [original]);
    const linesBefore = await w.rows<Record<string, string | number | null>>('SELECT * FROM journal_entry_lines WHERE entry_id = ? ORDER BY line_number', [original]);

    const reversal = await w.engine.createReversalDraft(w.aide, { originalEntryId: original, entryDate: '2026-03-15', reasonText: 'Erreur de client' });
    expect(reversal.status).toBe('DRAFT');
    const [link] = await w.rows<{ reversal_of_entry_id: string; source_document_type: string; status: string; journal_id: string }>(
      'SELECT reversal_of_entry_id, source_document_type, status, journal_id FROM journal_entries WHERE id = ?',
      [reversal.entryId],
    );
    expect(link).toEqual({ reversal_of_entry_id: original, source_document_type: 'REVERSAL', status: 'DRAFT', journal_id: 'jr-vte' });

    await w.engine.visaCycle(w.chef, { entryId: reversal.entryId, idempotencyKey: w.key() });
    await w.engine.sealEntry(fresh(w, w.oec), { entryId: reversal.entryId, idempotencyKey: w.key() });

    expect(await w.rows('SELECT * FROM journal_entries WHERE id = ?', [original])).toEqual(before);
    expect(await w.rows('SELECT * FROM journal_entry_lines WHERE entry_id = ? ORDER BY line_number', [original])).toEqual(linesBefore);
    expect(await statusOf(w, original)).toBe('POSTED');

    const inverted = await w.rows<{ account_number: string; debit_cents: number; credit_cents: number }>(
      `SELECT ca.account_number, jel.debit_cents, jel.credit_cents FROM journal_entry_lines jel JOIN cgnc_accounts ca ON ca.id = jel.account_id
        WHERE jel.entry_id = ? ORDER BY jel.line_number`,
      [reversal.entryId],
    );
    expect(inverted).toEqual([
      { account_number: '34210000', debit_cents: 0, credit_cents: 120000 },
      { account_number: '71110000', debit_cents: 100000, credit_cents: 0 },
      { account_number: '44558000', debit_cents: 20000, credit_cents: 0 },
    ]);
    for (const account of ['34210000', '71110000', '44558000']) {
      expect(await netOf(w, account)).toBe(0);
    }
    const [totals] = await w.rows<{ d: number; c: number }>(
      `SELECT CAST(SUM(total_debit_cents) AS BIGINT) AS d, CAST(SUM(total_credit_cents) AS BIGINT) AS c FROM journal_entries WHERE id IN (?, ?)`,
      [original, reversal.entryId],
    );
    expect(Number(totals?.d)).toBe(Number(totals?.c));

    expect((await failure(() => w.engine.createReversalDraft(w.aide, { originalEntryId: original, entryDate: '2026-03-16', reasonText: 'bis' }))).code).toBe('LEDGER_ALREADY_REVERSED');
    const draftOnly = await w.engine.createDraft(w.aide, draftInput());
    expect((await failure(() => w.engine.createReversalDraft(w.aide, { originalEntryId: draftOnly.entryId, entryDate: '2026-03-16', reasonText: 'x' }))).code).toBe(
      'LEDGER_REVERSAL_REQUIRES_POSTED',
    );
    await expect(w.exec(`UPDATE journal_entries SET status = 'CONTRE_PASSEE' WHERE id = ?`, [draftOnly.entryId])).rejects.toThrow(InfrastructureError);
  });

  describe('contre-passation unique et reprise idempotente (G1)', () => {
    async function postedInvoice(w: World): Promise<string> {
      return postEntry(
        w,
        draftInput({
          journalId: 'jr-vte',
          sourceDocumentType: 'INVOICE',
          reviewCycle: 'VENTES',
          lines: [L('34210000', 120000, 0), L('71110000', 0, 100000), L('44558000', 0, 20000)],
        }),
      );
    }
    const reversalOf = (originalEntryId: string, entryDate = '2026-03-15') => ({ originalEntryId, entryDate, reasonText: 'Erreur de client' });
    const reversalCount = async (w: World, original: string): Promise<number> =>
      Number((await w.rows<{ n: number }>('SELECT COUNT(*) AS n FROM journal_entries WHERE reversal_of_entry_id = ?', [original]))[0]?.n);

    it('rejeu séquentiel de la même demande : la contre-passation existante est rendue (replayed), aucun second brouillon ; une autre date reste LEDGER_ALREADY_REVERSED', async () => {
      const w = await setup();
      const original = await postedInvoice(w);
      const first = await w.engine.createReversalDraft(w.aide, reversalOf(original));
      expect(first.replayed).toBe(false);
      const again = await w.engine.createReversalDraft(w.aide, reversalOf(original));
      expect(again).toMatchObject({ entryId: first.entryId, entryReference: first.entryReference, sequenceNumber: first.sequenceNumber, status: 'DRAFT', replayed: true });
      expect(await reversalCount(w, original)).toBe(1);
      expect((await failure(() => w.engine.createReversalDraft(w.aide, reversalOf(original, '2026-03-16')))).code).toBe('LEDGER_ALREADY_REVERSED');
      expect(await reversalCount(w, original)).toBe(1);
    });

    it('deux createReversalDraft simultanés de la même pièce : une seule contre-passation en base, l\'autre appel reçoit la même pièce marquée replayed', async () => {
      const w = await setup();
      const original = await postedInvoice(w);
      const [a, b] = await Promise.all([w.engine.createReversalDraft(w.aide, reversalOf(original)), w.engine.createReversalDraft(w.aide, reversalOf(original))]);
      expect(a.entryId).toBe(b.entryId);
      expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
      expect(await reversalCount(w, original)).toBe(1);
      const lines = await w.rows<{ n: number }>('SELECT COUNT(*) AS n FROM journal_entry_lines WHERE entry_id = ?', [a.entryId]);
      expect(Number(lines[0]?.n)).toBe(3);
    });

    it('un second REVERSAL de la même pièce, inséré directement, est refusé par l\'index unique uq_journal_entries_reversal_of', async () => {
      const w = await setup();
      const original = await postedInvoice(w);
      await w.engine.createReversalDraft(w.aide, reversalOf(original));
      await expect(
        w.exec(
          `INSERT INTO journal_entries (id, fiscal_year_id, journal_id, sequence_number, entry_reference, entry_date, source_document_type, reversal_of_entry_id, total_debit_cents, total_credit_cents)
           VALUES ('rev-direct', ?, 'jr-od', 1, 'OD/EX-2026/DIRECT', '2026-03-20', 'REVERSAL', ?, 1000, 1000)`,
          [FY_2026.id, original],
        ),
      ).rejects.toThrow(/reversal_of_entry_id|uq_journal_entries_reversal_of/);
      expect(await reversalCount(w, original)).toBe(1);
    });
  });

  it('idempotence : rejouer une transition avec la même clé ne double ni l\'audit ni la chaîne ; une clé ne sert qu\'à une transition', async () => {
    const w = await setup();
    const a = await w.engine.createDraft(w.aide, draftInput());
    const b = await w.engine.createDraft(w.aide, draftInput({ entryDate: '2026-03-03' }));
    const submitKey = w.key();
    expect((await w.engine.submitDraft(w.aide, { entryId: a.entryId, idempotencyKey: submitKey })).replayed).toBe(false);
    expect((await w.engine.submitDraft(w.aide, { entryId: a.entryId, idempotencyKey: submitKey })).replayed).toBe(true);
    expect(await auditCount(w, a.entryId)).toBe(1);
    expect((await failure(() => w.engine.submitDraft(w.aide, { entryId: b.entryId, idempotencyKey: submitKey }))).code).toBe('LEDGER_IDEMPOTENCY_KEY_REUSED');

    const visaKey = w.key();
    await w.engine.visaCycle(w.chef, { entryId: a.entryId, idempotencyKey: visaKey });
    expect((await w.engine.visaCycle(w.chef, { entryId: a.entryId, idempotencyKey: visaKey })).replayed).toBe(true);

    const sealKey = w.key();
    const first = await w.engine.sealEntry(fresh(w, w.oec), { entryId: a.entryId, idempotencyKey: sealKey });
    const replay = await w.engine.sealEntry(fresh(w, w.oec), { entryId: a.entryId, idempotencyKey: sealKey });
    expect(replay).toMatchObject({ replayed: true, entryHash: first.entryHash, previousEntryHash: GENESIS });
    expect(await auditCount(w, a.entryId)).toBe(3);
    const [journal] = await w.rows<{ last_sequence_number: number }>(`SELECT last_sequence_number FROM journals WHERE id = 'jr-cai'`);
    expect(journal?.last_sequence_number).toBe(1);
    // Une nouvelle clé sur une pièce déjà scellée n'est pas un rejeu : refus typé, rien ne bouge.
    expect((await failure(() => w.engine.sealEntry(fresh(w, w.oec), { entryId: a.entryId, idempotencyKey: w.key() }))).code).toBe('LEDGER_ENTRY_ALREADY_POSTED');
    expect(await auditCount(w, a.entryId)).toBe(3);
  });

  it('concurrence : deux scellements simultanés de la même pièce, un seul gagne', async () => {
    const w = await setup();
    const { entryId } = await w.engine.createDraft(w.aide, draftInput({ initialState: 'DRAFT' }));
    await w.engine.visaCycle(w.chef, { entryId, idempotencyKey: w.key() });
    const oecBis = actorOf('EXPERT_COMPTABLE_OEC', 'u-oec-bis', {}, w.clock);
    const settled = await Promise.allSettled([
      w.engine.sealEntry(fresh(w, w.oec), { entryId, idempotencyKey: w.key() }),
      w.engine.sealEntry(fresh(w, oecBis), { entryId, idempotencyKey: w.key() }),
    ]);
    const winners = settled.filter((s) => s.status === 'fulfilled');
    const losers = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(['LEDGER_CONCURRENCY_CONFLICT', 'LEDGER_ENTRY_ALREADY_POSTED']).toContain(losers[0]?.reason instanceof LedgerError ? losers[0].reason.code : 'AUTRE');
    const posted = await w.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM state_transition_audit WHERE entity_id = ? AND to_state = 'POSTED'`, [entryId]);
    expect(Number(posted[0]?.n)).toBe(1);
    const [journal] = await w.rows<{ last_sequence_number: number }>(`SELECT last_sequence_number FROM journals WHERE id = 'jr-cai'`);
    expect(journal?.last_sequence_number).toBe(1);
  });

  it('concurrence : deux pièces du même journal scellées ensemble ne fourchent jamais la chaîne', async () => {
    const w = await setup();
    const ids: string[] = [];
    for (const date of ['2026-03-01', '2026-03-02']) {
      const { entryId } = await w.engine.createDraft(w.aide, draftInput({ initialState: 'DRAFT', entryDate: date }));
      await w.engine.visaCycle(w.chef, { entryId, idempotencyKey: w.key() });
      ids.push(entryId);
    }
    const settled = await Promise.allSettled(ids.map((entryId) => w.engine.sealEntry(fresh(w, w.oec), { entryId, idempotencyKey: w.key() })));
    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        expect(outcome.reason instanceof LedgerError ? outcome.reason.code : 'AUTRE').toBe('LEDGER_CONCURRENCY_CONFLICT');
      }
    }
    for (const entryId of ids) {
      if ((await statusOf(w, entryId)) !== 'POSTED') {
        await w.engine.sealEntry(fresh(w, w.oec), { entryId, idempotencyKey: w.key() });
      }
    }
    expect(await w.engine.verifyJournalChain('jr-cai')).toEqual({ valid: true, length: 2 });
  });

  describe('VAT_CLEARING', () => {
    async function postInvoice(w: World): Promise<string> {
      return postEntry(
        w,
        draftInput({
          journalId: 'jr-vte',
          sourceDocumentType: 'INVOICE',
          reviewCycle: 'VENTES',
          entryDate: '2026-04-01',
          lines: [L('34210000', 87500, 0), L('71110000', 0, 50000), L('71110000', 0, 25000), L('44558000', 0, 10000), L('44558000', 0, 2500)],
        }),
      );
    }

    const clearingInput = (invoiceEntryId: string, overrides: Partial<CreateVatClearingDraftInput> = {}): CreateVatClearingDraftInput => ({
      invoiceEntryId,
      journalId: 'jr-od',
      fiscalYearId: FY_2026.id,
      entryDate: '2026-04-20',
      settledBeforeCents: 0,
      settledNowCents: 35000,
      paymentMethodCode: '30_VIREMENT' as const,
      ...overrides,
    });

    it('encaissement de 40 % d\'une facture multi-taux : 4 000 + 1 000 centimes, puis solde exact au règlement final', async () => {
      const w = await setup();
      const invoice = await postInvoice(w);
      const clearing = await w.engine.createVatClearingDraft(w.aide, clearingInput(invoice));
      expect(clearing.clearedCents).toBe(5000);
      const lines = await w.rows<{ account_number: string; debit_cents: number; credit_cents: number }>(
        `SELECT ca.account_number, jel.debit_cents, jel.credit_cents FROM journal_entry_lines jel JOIN cgnc_accounts ca ON ca.id = jel.account_id WHERE jel.entry_id = ? ORDER BY jel.line_number`,
        [clearing.entryId],
      );
      expect(lines).toEqual([
        { account_number: '44558000', debit_cents: 4000, credit_cents: 0 },
        { account_number: '44551000', debit_cents: 0, credit_cents: 4000 },
        { account_number: '44558000', debit_cents: 1000, credit_cents: 0 },
        { account_number: '44551000', debit_cents: 0, credit_cents: 1000 },
      ]);
      const [row] = await w.rows<{ source_document_type: string; status: string; total_debit_cents: number }>(
        'SELECT source_document_type, status, total_debit_cents FROM journal_entries WHERE id = ?',
        [clearing.entryId],
      );
      expect(row).toEqual({ source_document_type: 'VAT_CLEARING', status: 'DRAFT', total_debit_cents: 5000 });

      await w.engine.visaCycle(w.chef, { entryId: clearing.entryId, idempotencyKey: w.key() });
      await w.engine.sealEntry(fresh(w, w.oec), { entryId: clearing.entryId, idempotencyKey: w.key() });
      const rest = await w.engine.createVatClearingDraft(w.aide, clearingInput(invoice, { settledBeforeCents: 35000, settledNowCents: 52500 }));
      expect(rest.clearedCents).toBe(7500);
      await w.engine.visaCycle(w.chef, { entryId: rest.entryId, idempotencyKey: w.key() });
      await w.engine.sealEntry(fresh(w, w.oec), { entryId: rest.entryId, idempotencyKey: w.key() });
      expect(await netOf(w, '44558000')).toBe(0);
      expect(await netOf(w, '44551000')).toBe(-12500);
    });

    it('arrondi demi-supérieur ligne par ligne sans dérive : 33 333 puis le reste donnent exactement 12 500', async () => {
      const w = await setup();
      const invoice = await postInvoice(w);
      const first = await w.engine.createVatClearingDraft(w.aide, clearingInput(invoice, { settledNowCents: 33333 }));
      expect(first.clearedCents).toBe(4761);
      const last = await w.engine.createVatClearingDraft(w.aide, clearingInput(invoice, { settledBeforeCents: 33333, settledNowCents: 54167 }));
      expect(last.clearedCents).toBe(7739);
      expect(first.clearedCents + last.clearedCents).toBe(12500);
    });

    it('achat : TVA récupérable d\'attente reversée vers la cible choisie (charges ou immobilisations)', async () => {
      const w = await setup();
      const purchase = await postEntry(
        w,
        draftInput({
          journalId: 'jr-ach',
          sourceDocumentType: 'INVOICE',
          reviewCycle: 'ACHATS',
          lines: [L('61110000', 40000, 0), L('34558000', 8000, 0), L('44110000', 0, 48000)],
        }),
      );
      const missing = await failure(() => w.engine.createVatClearingDraft(w.aide, clearingInput(purchase, { settledNowCents: 48000 })));
      expect(missing.code).toBe('LEDGER_VAT_TARGET_REQUIRED');
      const clearing = await w.engine.createVatClearingDraft(w.aide, clearingInput(purchase, { settledNowCents: 48000, recoverableTarget: 'VAT_RECOVERABLE_CHARGES' }));
      expect(clearing.clearedCents).toBe(8000);
      await w.engine.visaCycle(w.chef, { entryId: clearing.entryId, idempotencyKey: w.key() });
      await w.engine.sealEntry(fresh(w, w.oec), { entryId: clearing.entryId, idempotencyKey: w.key() });
      expect(await netOf(w, '34558000')).toBe(0);
      expect(await netOf(w, '34552000')).toBe(8000);
    });

    it('effet de commerce (42_EFFET_LCN) : aucune TVA à la remise de l\'effet, seulement à l\'encaissement bancaire effectif', async () => {
      const w = await setup();
      const invoice = await postInvoice(w);
      const onRemise = await failure(() => w.engine.createVatClearingDraft(w.aide, clearingInput(invoice, { paymentMethodCode: '42_EFFET_LCN' })));
      expect(onRemise.code).toBe('LEDGER_VAT_CLEARING_DEFERRED_LCN');
      const collected = await w.engine.createVatClearingDraft(
        w.aide,
        clearingInput(invoice, { paymentMethodCode: '42_EFFET_LCN', lcnBankCollectionDate: '2026-05-30' }),
      );
      expect(collected.clearedCents).toBe(5000);
    });

    it('refuse un règlement qui dépasse le TTC, une pièce non scellée et une facture hors INVOICE / CREDIT_NOTE', async () => {
      const w = await setup();
      const invoice = await postInvoice(w);
      expect((await failure(() => w.engine.createVatClearingDraft(w.aide, clearingInput(invoice, { settledBeforeCents: 80000, settledNowCents: 7501 })))).code).toBe(
        'LEDGER_VAT_CLEARING_EXCEEDS_INVOICE',
      );
      expect((await failure(() => w.engine.createVatClearingDraft(w.aide, clearingInput(invoice, { settledNowCents: 0 })))).code).toBe('LEDGER_INVALID_AMOUNT');
      const draft = await w.engine.createDraft(w.aide, draftInput({ journalId: 'jr-vte', sourceDocumentType: 'INVOICE' }));
      expect((await failure(() => w.engine.createVatClearingDraft(w.aide, clearingInput(draft.entryId)))).code).toBe('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE');
      const payment = await postEntry(w, draftInput());
      expect((await failure(() => w.engine.createVatClearingDraft(w.aide, clearingInput(payment)))).code).toBe('LEDGER_INVALID_INPUT');
    });
  });

  describe('clôture d\'exercice et journal d\'à-nouveaux', () => {
    async function ledgerOf2026(w: World): Promise<void> {
      await postEntry(w, draftInput({ lines: [L('51610000', 1000000, 0), L('11110000', 0, 1000000)] }));
      await postEntry(w, draftInput({ journalId: 'jr-od', sourceDocumentType: 'CUTOFF_OD', initialState: 'DRAFT', lines: [L('23400000', 300000, 0), L('51610000', 0, 300000)] }));
      await postEntry(
        w,
        draftInput({
          journalId: 'jr-vte',
          sourceDocumentType: 'INVOICE',
          lines: [L('34210000', 120000, 0), L('71110000', 0, 100000), L('44558000', 0, 20000)],
        }),
      );
    }

    it('OPEN → CLOSING (chef de mission) → CLOSED (expert-comptable, Step-Up) ; contrôles de pré-clôture, suspens 3497 / 4497 et pièces non scellées', async () => {
      const w = await setup();
      await ledgerOf2026(w);
      const begin = await failure(() => w.engine.beginFiscalYearClosing(w.aide, { fiscalYearId: FY_2026.id, idempotencyKey: w.key() }));
      expect(begin.denialCode).toBe('RBAC_FORBIDDEN_FOR_AIDE_COMPTABLE');
      expect(await w.engine.beginFiscalYearClosing(w.chef, { fiscalYearId: FY_2026.id, idempotencyKey: w.key() })).toMatchObject({ toState: 'CLOSING', replayed: false });

      // En CLOSING, seules les écritures de clôture (CUTOFF_OD) restent admises.
      expect((await failure(() => w.engine.createDraft(w.aide, draftInput()))).code).toBe('LEDGER_FISCAL_YEAR_NOT_OPEN');
      const pending = await w.engine.createDraft(w.aide, draftInput({ journalId: 'jr-od', sourceDocumentType: 'CUTOFF_OD', lines: [L('71110000', 100000, 0), L('11910000', 0, 100000)] }));
      expect((await failure(() => w.engine.closeFiscalYear(fresh(w, w.oec), { fiscalYearId: FY_2026.id, idempotencyKey: w.key() }))).code).toBe('LEDGER_UNPOSTED_ENTRIES_REMAIN');
      await w.engine.submitDraft(w.aide, { entryId: pending.entryId, idempotencyKey: w.key() });
      await w.engine.visaCycle(w.chef, { entryId: pending.entryId, idempotencyKey: w.key() });
      await w.engine.sealEntry(fresh(w, w.oec), { entryId: pending.entryId, idempotencyKey: w.key() });

      const suspens = await postEntry(w, draftInput({ journalId: 'jr-od', sourceDocumentType: 'CUTOFF_OD', initialState: 'DRAFT', lines: [L('34970000', 5000, 0), L('44970000', 0, 5000)] }));
      expect((await failure(() => w.engine.closeFiscalYear(fresh(w, w.oec), { fiscalYearId: FY_2026.id, idempotencyKey: w.key() }))).code).toBe('LEDGER_SUSPENSE_NOT_CLEARED');
      const clear = await w.engine.createReversalDraft(w.aide, { originalEntryId: suspens, entryDate: '2026-12-31', reasonText: 'Soldé' });
      await w.engine.visaCycle(w.chef, { entryId: clear.entryId, idempotencyKey: w.key() });
      await w.engine.sealEntry(fresh(w, w.oec), { entryId: clear.entryId, idempotencyKey: w.key() });

      w.controls.passed = false;
      expect((await failure(() => w.engine.closeFiscalYear(fresh(w, w.oec), { fiscalYearId: FY_2026.id, idempotencyKey: w.key() }))).code).toBe('LEDGER_PRECLOSE_CONTROLS_FAILED');
      w.controls.passed = true;
      expect((await failure(() => w.engine.closeFiscalYear(fresh(w, w.chef), { fiscalYearId: FY_2026.id, idempotencyKey: w.key() }))).denialCode).toBe('RBAC_FORBIDDEN_FOR_CHEF_MISSION');
      const stale = { ...w.oec, mfaVerifiedAtEpochSec: w.clock.currentEpochSec() - 400 };
      expect((await failure(() => w.engine.closeFiscalYear(stale, { fiscalYearId: FY_2026.id, idempotencyKey: w.key() }))).denialCode).toBe('ABAC_STEP_UP_MFA_REQUIRED');

      const closeKey = w.key();
      const closed = await w.engine.closeFiscalYear(fresh(w, w.oec), { fiscalYearId: FY_2026.id, idempotencyKey: closeKey });
      expect(closed).toMatchObject({ fromState: 'CLOSING', toState: 'CLOSED', replayed: false });
      expect(closed.closingHash).toMatch(HEX64);
      const replay = await w.engine.closeFiscalYear(fresh(w, w.oec), { fiscalYearId: FY_2026.id, idempotencyKey: closeKey });
      expect(replay).toMatchObject({ replayed: true, closingHash: closed.closingHash });
      const [fy] = await w.rows<{ status: string; closing_hash: string }>('SELECT status, closing_hash FROM fiscal_years WHERE id = ?', [FY_2026.id]);
      expect(fy).toEqual({ status: 'CLOSED', closing_hash: closed.closingHash });
    });

    it('exercice clos : le moteur refuse l\'écriture avant la base, et les triggers la refusent aussi si on contourne le moteur', async () => {
      const w = await setup();
      await ledgerOf2026(w);
      await w.engine.beginFiscalYearClosing(w.chef, { fiscalYearId: FY_2026.id, idempotencyKey: w.key() });
      await postEntry(w, draftInput({ journalId: 'jr-od', sourceDocumentType: 'CUTOFF_OD', initialState: 'DRAFT', lines: [L('71110000', 100000, 0), L('11910000', 0, 100000)] }));
      await w.engine.closeFiscalYear(fresh(w, w.oec), { fiscalYearId: FY_2026.id, idempotencyKey: w.key() });

      expect((await failure(() => w.engine.createDraft(w.aide, draftInput()))).code).toBe('LEDGER_FISCAL_YEAR_CLOSED');
      expect((await failure(() => w.engine.beginFiscalYearClosing(w.chef, { fiscalYearId: FY_2026.id, idempotencyKey: w.key() }))).code).toBe('LEDGER_FISCAL_YEAR_CLOSED');
      await expect(
        w.exec(
          `INSERT INTO journal_entries (id, fiscal_year_id, journal_id, sequence_number, entry_reference, entry_date, status, source_document_type, total_debit_cents, total_credit_cents)
           VALUES ('e-late', ?, 'jr-od', 99, 'OD/EX-2026/000099', '2026-12-31', 'DRAFT', 'CUTOFF_OD', 10, 10)`,
          [FY_2026.id],
        ),
      ).rejects.toThrow(/CGNC_FISCAL_YEAR_CLOSED/);
      await expect(w.exec(`UPDATE fiscal_years SET status = 'OPEN' WHERE id = ?`, [FY_2026.id])).rejects.toThrow(/Exercice clos immuable/);
    });

    it('journal d\'à-nouveaux : écriture équilibrée dans le NOUVEL exercice, classes 1 à 5 seulement, scellable par le circuit normal', async () => {
      const w = await setup();
      await ledgerOf2026(w);
      const opening = { closedFiscalYearId: FY_2026.id, nextFiscalYear: { id: FY_2027.id, code: FY_2027.code, startDate: FY_2027.start, endDate: FY_2027.end }, journalId: 'jr-an', entryDate: '2027-01-01' };

      expect((await failure(() => w.engine.generateOpeningJournal(w.aide, opening))).denialCode).toBe('RBAC_FORBIDDEN_FOR_AIDE_COMPTABLE');
      expect((await failure(() => w.engine.generateOpeningJournal(fresh(w, w.oec), opening))).code).toBe('LEDGER_FISCAL_YEAR_NOT_CLOSED');

      await w.engine.beginFiscalYearClosing(w.chef, { fiscalYearId: FY_2026.id, idempotencyKey: w.key() });
      await w.engine.closeFiscalYear(fresh(w, w.oec), { fiscalYearId: FY_2026.id, idempotencyKey: w.key() });
      // Résultat (classe 7 : 100 000 centimes créditeurs) non affecté : l'à-nouveau ne boucle pas, le moteur refuse.
      expect((await failure(() => w.engine.generateOpeningJournal(fresh(w, w.oec), opening))).code).toBe('LEDGER_RESULT_NOT_AFFECTED');
      const [none] = await w.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM fiscal_years WHERE id = ?`, [FY_2027.id]);
      expect(Number(none?.n)).toBe(0);
    });

    it('journal d\'à-nouveaux après affectation du résultat : balance reprise, 2027 ouvert, AN scellé, doublon refusé', async () => {
      const w = await setup();
      await ledgerOf2026(w);
      await postEntry(w, draftInput({ journalId: 'jr-od', sourceDocumentType: 'CUTOFF_OD', initialState: 'DRAFT', lines: [L('71110000', 100000, 0), L('11910000', 0, 100000)] }));
      await w.engine.beginFiscalYearClosing(w.chef, { fiscalYearId: FY_2026.id, idempotencyKey: w.key() });
      await w.engine.closeFiscalYear(fresh(w, w.oec), { fiscalYearId: FY_2026.id, idempotencyKey: w.key() });

      const opening = { closedFiscalYearId: FY_2026.id, nextFiscalYear: { id: FY_2027.id, code: FY_2027.code, startDate: FY_2027.start, endDate: FY_2027.end }, journalId: 'jr-an', entryDate: '2027-01-01' };
      const generated = await w.engine.generateOpeningJournal(fresh(w, w.oec), opening);
      expect(generated).toMatchObject({ fiscalYearId: FY_2027.id, totalDebitCents: 1120000, lineCount: 6 });

      const [fy] = await w.rows<{ status: string }>('SELECT status FROM fiscal_years WHERE id = ?', [FY_2027.id]);
      expect(fy?.status).toBe('OPEN');
      const lines = await w.rows<{ account_number: string; cgnc_class: number; debit_cents: number; credit_cents: number }>(
        `SELECT ca.account_number, ca.cgnc_class, jel.debit_cents, jel.credit_cents FROM journal_entry_lines jel JOIN cgnc_accounts ca ON ca.id = jel.account_id WHERE jel.entry_id = ? ORDER BY ca.account_number`,
        [generated.entryId],
      );
      expect(lines.map((l) => [l.account_number, l.debit_cents, l.credit_cents])).toEqual([
        ['11110000', 0, 1000000],
        ['11910000', 0, 100000],
        ['23400000', 300000, 0],
        ['34210000', 120000, 0],
        ['44558000', 0, 20000],
        ['51610000', 700000, 0],
      ]);
      expect(lines.every((l) => l.cgnc_class >= 1 && l.cgnc_class <= 5)).toBe(true);
      const debit = lines.reduce((sum, l) => sum + BigInt(l.debit_cents), 0n);
      const credit = lines.reduce((sum, l) => sum + BigInt(l.credit_cents), 0n);
      expect(debit).toBe(credit);
      const [entry] = await w.rows<{ status: string; fiscal_year_id: string; journal_id: string; source_document_type: string }>(
        'SELECT status, fiscal_year_id, journal_id, source_document_type FROM journal_entries WHERE id = ?',
        [generated.entryId],
      );
      // v9 : le type source par défaut d'un à-nouveau est OPENING_BALANCE (plus de paramètre obligatoire détourné vers CUTOFF_OD).
      expect(entry).toEqual({ status: 'DRAFT', fiscal_year_id: FY_2027.id, journal_id: 'jr-an', source_document_type: 'OPENING_BALANCE' });

      await w.engine.visaCycle(w.chef, { entryId: generated.entryId, idempotencyKey: w.key() });
      await w.engine.sealEntry(fresh(w, w.oec), { entryId: generated.entryId, idempotencyKey: w.key() });
      const balance = await w.rows<{ opening_debit_cents: number; opening_credit_cents: number }>(
        `SELECT CAST(SUM(opening_debit_cents) AS BIGINT) AS opening_debit_cents, CAST(SUM(opening_credit_cents) AS BIGINT) AS opening_credit_cents FROM v_cgnc_trial_balance_6col WHERE fiscal_year_id = ?`,
        [FY_2027.id],
      );
      expect(Number(balance[0]?.opening_debit_cents)).toBe(1120000);
      expect(Number(balance[0]?.opening_credit_cents)).toBe(1120000);

      expect((await failure(() => w.engine.generateOpeningJournal(fresh(w, w.oec), opening))).code).toBe('LEDGER_OPENING_ALREADY_GENERATED');
    });

    it('journal d\'à-nouveaux : le type source reste paramétrable (CUTOFF_OD conservé), REVERSAL et une valeur inconnue sont refusés avant toute écriture', async () => {
      const w = await setup();
      await ledgerOf2026(w);
      await postEntry(w, draftInput({ journalId: 'jr-od', sourceDocumentType: 'CUTOFF_OD', initialState: 'DRAFT', lines: [L('71110000', 100000, 0), L('11910000', 0, 100000)] }));
      await w.engine.beginFiscalYearClosing(w.chef, { fiscalYearId: FY_2026.id, idempotencyKey: w.key() });
      await w.engine.closeFiscalYear(fresh(w, w.oec), { fiscalYearId: FY_2026.id, idempotencyKey: w.key() });
      const base = { closedFiscalYearId: FY_2026.id, nextFiscalYear: { id: FY_2027.id, code: FY_2027.code, startDate: FY_2027.start, endDate: FY_2027.end }, journalId: 'jr-an', entryDate: '2027-01-01' };
      expect((await failure(() => w.engine.generateOpeningJournal(fresh(w, w.oec), { ...base, sourceDocumentType: 'REVERSAL' }))).code).toBe('LEDGER_INVALID_INPUT');
      // Valeur volontairement hors de la liste, liée en paramètre pour prouver le refus à l'exécution.
      const unknownType = 'MANUAL' as unknown as 'REVERSAL';
      expect((await failure(() => w.engine.generateOpeningJournal(fresh(w, w.oec), { ...base, sourceDocumentType: unknownType }))).code).toBe('LEDGER_INVALID_INPUT');
      const [none] = await w.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM fiscal_years WHERE id = ?`, [FY_2027.id]);
      expect(Number(none?.n)).toBe(0);
      const generated = await w.engine.generateOpeningJournal(fresh(w, w.oec), { ...base, sourceDocumentType: 'CUTOFF_OD' });
      const [entry] = await w.rows<{ source_document_type: string }>('SELECT source_document_type FROM journal_entries WHERE id = ?', [generated.entryId]);
      expect(entry?.source_document_type).toBe('CUTOFF_OD');
    });

    it('createDraft accepte VAT_DECLARATION_CENTRALIZATION, FX_REVALUATION et OPENING_BALANCE (CHECK étendu par la v9), sur SQLite comme sur PostgreSQL', async () => {
      const w = await setup();
      for (const sourceDocumentType of ['VAT_DECLARATION_CENTRALIZATION', 'FX_REVALUATION', 'OPENING_BALANCE'] as const) {
        const created = await w.engine.createDraft(w.aide, draftInput({ journalId: 'jr-od', sourceDocumentType }));
        const [row] = await w.rows<{ source_document_type: string }>('SELECT source_document_type FROM journal_entries WHERE id = ?', [created.entryId]);
        expect(row?.source_document_type).toBe(sourceDocumentType);
      }
    });
  });
});


describe('ImmutableCgncLedgerEngine sur PostgreSQL : scellements concurrents (pool de connexions réelles, READ COMMITTED)', () => {
  const credit = (amount: number): DraftLineInput[] => [L('61110000', amount, 0), L('51610000', 0, amount)];

  async function readyToSeal(w: World, journalId: string, lines: DraftLineInput[]): Promise<string> {
    const created = await w.engine.createDraft(w.aide, draftInput({ journalId, initialState: 'DRAFT', lines }));
    await w.engine.visaCycle(w.chef, { entryId: created.entryId, idempotencyKey: w.key() });
    return created.entryId;
  }

  it('deux décaissements de 6 000 sur une caisse de 10 000 scellés en même temps : un seul passe, solde final non négatif', async () => {
    const w = await buildWorld(await postgres.fresh());
    await postEntry(w, draftInput({ initialState: 'DRAFT', lines: [L('51610000', 10000, 0), L('11110000', 0, 10000)] }));
    const first = await readyToSeal(w, 'jr-cai', credit(6000));
    const second = await readyToSeal(w, 'jr-bnq', credit(6000));
    const outcomes = await Promise.allSettled([
      w.engine.sealEntry(fresh(w, w.oec), { entryId: first, idempotencyKey: w.key() }),
      w.engine.sealEntry(fresh(w, w.oec), { entryId: second, idempotencyKey: w.key() }),
    ]);
    const rejected = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason as unknown] : []));
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toBeInstanceOf(LedgerError);
    expect((rejected[0] as LedgerError).code).toBe('LEDGER_NEGATIVE_CASH');
    expect(await netOf(w, '51610000')).toBe(4000);
  });

  it('deux scellements simultanés dans le MÊME journal : la chaîne previous_entry_hash reste valide, aucun maillon dupliqué', async () => {
    const w = await buildWorld(await postgres.fresh());
    const a = await readyToSeal(w, 'jr-od', [L('34210000', 1000, 0), L('71110000', 0, 1000)]);
    const b = await readyToSeal(w, 'jr-od', [L('34210000', 2000, 0), L('71110000', 0, 2000)]);
    const outcomes = await Promise.allSettled([
      w.engine.sealEntry(fresh(w, w.oec), { entryId: a, idempotencyKey: w.key() }),
      w.engine.sealEntry(fresh(w, w.oec), { entryId: b, idempotencyKey: w.key() }),
    ]);
    const done = outcomes.filter((outcome) => outcome.status === 'fulfilled').length;
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(LedgerError);
        expect((outcome.reason as LedgerError).code).toBe('LEDGER_CONCURRENCY_CONFLICT');
      }
    }
    expect(done).toBeGreaterThanOrEqual(1);
    expect(await w.engine.verifyJournalChain('jr-od')).toEqual({ valid: true, length: done });
    const links = await w.rows<{ previous_entry_hash: string }>(`SELECT previous_entry_hash FROM journal_entries WHERE journal_id = 'jr-od' AND status = 'POSTED'`);
    expect(new Set(links.map((row) => row.previous_entry_hash)).size).toBe(done);
  });
});
