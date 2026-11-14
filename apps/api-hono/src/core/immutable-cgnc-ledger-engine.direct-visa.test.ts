/**
 * Visa implicite du mode direct (Doc_09 § 06B réconciliant Doc_02) : OWNER_GERANT a LEDGER_VISA_CYCLE depuis l'arbitrage du propriétaire (Loi 9-88), mais le scellement direct reste en 2 transitions ; sans mandat cabinet
 * actif, son scellement enchaîne DRAFT → REVISEE_CYCLE (acteur système, au nom du gérant) puis REVISEE_CYCLE → POSTED (le gérant),
 * dans le MÊME lot atomique, avec deux lignes de `state_transition_audit`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { TenantSqlDriver } from '@fisca/shared-types';
import { ImmutableCgncLedgerEngine, LedgerError, type CreateDraftInput, type LedgerActor } from './immutable-cgnc-ledger-engine.ts';
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

const postgres = new PostgresHarness();
afterAll(async () => {
  await postgres.close();
});

const BACKENDS: readonly { readonly name: 'sqlite' | 'postgres'; open(): Promise<LedgerBackend> }[] = [
  { name: 'sqlite', open: openSqliteBackend },
  { name: 'postgres', open: () => postgres.fresh() },
];

const DRAFT_INPUT: CreateDraftInput = {
  journalId: 'jr-cai',
  fiscalYearId: FY_2026.id,
  entryDate: '2026-03-01',
  reviewCycle: 'TRESORERIE',
  sourceDocumentType: 'PAYMENT',
  initialState: 'DRAFT',
  lines: [
    { accountNumber: '51610000', debitCents: 500000, creditCents: 0, description: 'encaissement' },
    { accountNumber: '11110000', debitCents: 0, creditCents: 500000, description: 'capital' },
  ],
};

interface AuditLine {
  readonly from_state: string;
  readonly to_state: string;
  readonly actor_kind: string;
  readonly actor_id: string;
  readonly proof_ref: string | null;
  readonly idempotency_key: string;
}

async function failure(action: () => Promise<unknown>): Promise<LedgerError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof LedgerError) return error;
    throw error;
  }
  throw new Error('LedgerError attendue');
}

/** Pilote qui ajoute une instruction invalide au lot de scellement : le lot atomique doit tout annuler. */
function failingSealDriver(inner: TenantSqlDriver): TenantSqlDriver {
  return {
    ...inner,
    query: (statement) => inner.query(statement),
    executeBatchAtomically: (statements) =>
      inner.executeBatchAtomically(
        statements.some((s) => s.sql.includes(`SET status = 'POSTED'`)) ? [...statements, { sql: 'INSERT INTO table_inexistante_injection (x) VALUES (1)', params: [] }] : statements,
      ),
  };
}

describe.each(BACKENDS)('visa implicite du mode direct sur $name', (backendSpec) => {
  async function setup(wrap?: (d: TenantSqlDriver) => TenantSqlDriver) {
    const backend = await backendSpec.open();
    await seedLedger(backend.driver);
    const clock = new StepClock();
    const engine = new ImmutableCgncLedgerEngine({
      db: wrap === undefined ? backend.driver : wrap(backend.driver),
      companyId: COMPANY_ID,
      clock,
      ids: new SequentialUuidV7(),
      hasher: testOnlyHasher,
      cipher: testCipher,
      preCloseControls: new StubPreCloseControls(),
    });
    let counter = 0;
    const key = (): string => `dv-${(counter += 1)}`;
    const rows = <T>(sql: string, params: readonly (string | number | null)[] = []) => backend.driver.query<T>({ sql, params });
    const aide = actorOf('AIDE_COMPTABLE', 'u-aide', {}, clock);
    const direct = (role: Parameters<typeof actorOf>[0], id: string, overrides: Partial<LedgerActor> = {}): LedgerActor =>
      actorOf(role, id, { orgPlanSegment: 'DIRECT_PME', activeHumanMembersCount: 2, ...overrides }, clock);
    const draft = async (): Promise<string> => (await engine.createDraft(aide, DRAFT_INPUT)).entryId;
    const status = async (id: string): Promise<string> => (await rows<{ status: string }>('SELECT status FROM journal_entries WHERE id = ?', [id]))[0]?.status ?? 'ABSENT';
    const audits = (id: string) =>
      rows<AuditLine>('SELECT from_state, to_state, actor_kind, actor_id, proof_ref, idempotency_key FROM state_transition_audit WHERE entity_id = ? ORDER BY created_at, from_state', [id]);
    return { engine, key, aide, direct, draft, status, audits, clock };
  }

  it('le gérant seul (sans mandat cabinet actif) scelle depuis DRAFT : POSTED, deux lignes d\'audit dont le visa implicite marqué au nom du gérant', async () => {
    const w = await setup();
    const entryId = await w.draft();
    const before = (await w.audits(entryId)).length;
    const gerant = w.direct('OWNER_GERANT', 'u-gerant', { activeCpaMandate: false });
    const sealKey = w.key();
    const result = await w.engine.sealEntry(gerant, { entryId, idempotencyKey: sealKey });
    expect(result).toMatchObject({ fromState: 'REVISEE_CYCLE', toState: 'POSTED', replayed: false });
    expect(await w.status(entryId)).toBe('POSTED');
    const added = (await w.audits(entryId)).slice(before);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({
      from_state: 'DRAFT',
      to_state: 'REVISEE_CYCLE',
      actor_kind: 'DETERMINISTIC_SYSTEM',
      actor_id: 'SYSTEM:DIRECT_MODE_IMPLICIT_VISA',
    });
    expect(added[0]?.proof_ref).toBe('DIRECT_MODE_IMPLICIT_VISA:on_behalf_of=u-gerant');
    expect(added[1]).toMatchObject({ from_state: 'REVISEE_CYCLE', to_state: 'POSTED', actor_kind: 'HUMAN_USER', actor_id: 'u-gerant', idempotency_key: sealKey });
    // Rejeu de la même clé : réponse mémorisée, rien de réécrit.
    expect(await w.engine.sealEntry(gerant, { entryId, idempotencyKey: sealKey })).toMatchObject({ toState: 'POSTED', replayed: true });
    expect((await w.audits(entryId)).length).toBe(before + 2);
  });

  it('le gérant a LEDGER_VISA_CYCLE : visaCycle fait DRAFT → REVISEE_CYCLE (une seule transition, pas de scellement)', async () => {
    const w = await setup();
    const entryId = await w.draft();
    const gerant = w.direct('OWNER_GERANT', 'u-gerant', { activeCpaMandate: false });
    expect(await w.engine.visaCycle(gerant, { entryId, idempotencyKey: w.key() })).toMatchObject({ fromState: 'DRAFT', toState: 'REVISEE_CYCLE' });
    expect(await w.status(entryId)).toBe('REVISEE_CYCLE');
  });

  it('gérant avec mandat cabinet actif (ou information inconnue, ou plan non direct) : refusé sans visa du chef, brouillon intact', async () => {
    const w = await setup();
    const entryId = await w.draft();
    const before = (await w.audits(entryId)).length;
    const refused: readonly LedgerActor[] = [
      w.direct('OWNER_GERANT', 'u-gerant', { activeCpaMandate: true }),
      w.direct('OWNER_GERANT', 'u-gerant'),
      w.direct('OWNER_GERANT', 'u-gerant', { activeCpaMandate: undefined }),
      actorOf('OWNER_GERANT', 'u-gerant', { activeCpaMandate: false, orgPlanSegment: 'FIDUCIAIRE' }, w.clock),
    ];
    for (const actor of refused) {
      expect((await failure(() => w.engine.sealEntry(actor, { entryId, idempotencyKey: w.key() }))).code).toBe('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE');
    }
    expect(await w.status(entryId)).toBe('DRAFT');
    expect((await w.audits(entryId)).length).toBe(before);
  });

  it('aide-comptable et chef de mission : jamais de scellement, même avec activeCpaMandate false', async () => {
    const w = await setup();
    const entryId = await w.draft();
    const before = (await w.audits(entryId)).length;
    const aide = w.direct('AIDE_COMPTABLE', 'u-aide', { activeCpaMandate: false });
    const chef = w.direct('CHEF_MISSION', 'u-chef', { activeCpaMandate: false });
    expect((await failure(() => w.engine.sealEntry(aide, { entryId, idempotencyKey: w.key() }))).denialCode).toBe('RBAC_FORBIDDEN_FOR_AIDE_COMPTABLE');
    expect((await failure(() => w.engine.sealEntry(chef, { entryId, idempotencyKey: w.key() }))).denialCode).toBe('RBAC_FORBIDDEN_FOR_CHEF_MISSION');
    expect(await w.status(entryId)).toBe('DRAFT');
    expect((await w.audits(entryId)).length).toBe(before);
  });

  it('le visa implicite ne vaut que depuis DRAFT : IA_PROPOSITION reste refusée au gérant direct', async () => {
    const w = await setup();
    const { entryId } = await w.engine.createDraft(w.aide, { ...DRAFT_INPUT, initialState: 'IA_PROPOSITION' });
    const gerant = w.direct('OWNER_GERANT', 'u-gerant', { activeCpaMandate: false });
    expect((await failure(() => w.engine.sealEntry(gerant, { entryId, idempotencyKey: w.key() }))).code).toBe('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE');
    expect(await w.status(entryId)).toBe('IA_PROPOSITION');
  });

  it('pièce déjà visée par le chef : le gérant scelle sans second visa (une seule ligne d\'audit ajoutée)', async () => {
    const w = await setup();
    const entryId = await w.draft();
    await w.engine.visaCycle(actorOf('CHEF_MISSION', 'u-chef', {}, w.clock), { entryId, idempotencyKey: w.key() });
    const before = (await w.audits(entryId)).length;
    await w.engine.sealEntry(w.direct('OWNER_GERANT', 'u-gerant', { activeCpaMandate: false }), { entryId, idempotencyKey: w.key() });
    expect((await w.audits(entryId)).length).toBe(before + 1);
  });

  it('échec injecté au scellement : le visa implicite est annulé avec lui (DRAFT intact, aucune ligne d\'audit ajoutée)', async () => {
    const w = await setup(failingSealDriver);
    const entryId = await w.draft();
    const before = (await w.audits(entryId)).length;
    const gerant = w.direct('OWNER_GERANT', 'u-gerant', { activeCpaMandate: false });
    await expect(w.engine.sealEntry(gerant, { entryId, idempotencyKey: w.key() })).rejects.toThrow();
    expect(await w.status(entryId)).toBe('DRAFT');
    expect((await w.audits(entryId)).length).toBe(before);
  });
});
