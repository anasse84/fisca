import type { SqlStatementParams } from '@fisca/shared-types';
import { afterEach, describe, expect, it } from 'vitest';
import {
  anchorDailyRoot,
  batchIdFor,
  checkTimestampChain,
  computeChainedRoot,
  findBatchById,
  GENESIS_PREVIOUS_HASH,
  listArchivalBatches,
  loadTokenChain,
  planLtaRenewal,
  renewTimestamp,
  sha256,
  toBase64,
  toHex,
  tokenObjectKey,
} from '../src/index.ts';
import { createBackendFixture, type BackendFixture, type SqlBackendKind } from './support/sql-backends.ts';

const retention = { days: 3653 };
const rootOf = (label: string): Promise<Uint8Array> => sha256(new TextEncoder().encode(label));
const open: BackendFixture[] = [];

async function fixture(kind: SqlBackendKind, startIso: string): Promise<BackendFixture> {
  const created = await createBackendFixture(kind, startIso);
  open.push(created);
  return created;
}

afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

/** Mêmes scénarios sur le pilote en mémoire et sur PostgreSQL 16 réel : toute divergence de SQL (CAST, ordre, types) échoue ici. */
describe.each(['memory', 'postgres'] as const)('coffre : ancrage quotidien et LTA sur %s', (kind) => {
  it('ancre, relit le lot par identifiant et par liste (colonnes réelles de archival_merkle_batches)', async () => {
    const { adapter, tsa, controlDb } = await fixture(kind, '2026-03-01T23:59:00Z');
    const root = await rootOf('r1');
    const result = await anchorDailyRoot({ date: '2026-03-01', companyScope: 'platform', root, leafCount: 5, timestampProvider: tsa, adapter, retention });
    expect(result.status).toBe('ANCHORED');
    expect(result.batch).toMatchObject({ batchId: batchIdFor('2026-03-01', 'platform'), leafCount: 5, previousBatchRootHash: GENESIS_PREVIOUS_HASH, lastLtaRenewalAt: null });
    expect(typeof result.batch.leafCount).toBe('number');
    expect(await findBatchById(controlDb, result.batch.batchId)).toEqual(result.batch);
    expect(await listArchivalBatches(controlDb)).toEqual([result.batch]);
  });

  it('idempotent le même jour ; racine ou périmètre différents refusés ; une seule ligne', async () => {
    const { adapter, tsa, controlDb } = await fixture(kind, '2026-03-01T23:59:00Z');
    const root = await rootOf('r1');
    const base = { date: '2026-03-01', companyScope: 'platform', leafCount: 5, timestampProvider: tsa, adapter, retention };
    await anchorDailyRoot({ ...base, root });
    expect((await anchorDailyRoot({ ...base, root })).status).toBe('ALREADY_ANCHORED');
    await expect(anchorDailyRoot({ ...base, root: await rootOf('autre') })).rejects.toMatchObject({ code: 'ANCHOR_ROOT_CONFLICT' });
    await expect(anchorDailyRoot({ ...base, root, companyScope: 'autre' })).rejects.toMatchObject({ code: 'ANCHOR_SCOPE_CONFLICT' });
    expect(tsa.imprints).toHaveLength(1);
    expect(await listArchivalBatches(controlDb)).toHaveLength(1);
  });

  it('chaîne les racines d’un jour à l’autre ; la liste revient triée par date', async () => {
    const { adapter, tsa, clock, controlDb } = await fixture(kind, '2026-03-01T23:59:00Z');
    const base = { companyScope: 'platform', leafCount: 2, timestampProvider: tsa, adapter, retention };
    const first = await anchorDailyRoot({ ...base, date: '2026-03-01', root: await rootOf('j1') });
    clock.set('2026-03-02T23:59:00Z');
    const root2 = await rootOf('j2');
    const second = await anchorDailyRoot({ ...base, date: '2026-03-02', root: root2 });
    expect(second.batch.previousBatchRootHash).toBe(first.batch.chainedRootSha256);
    expect(second.batch.chainedRootSha256).toBe(await computeChainedRoot(first.batch.chainedRootSha256, toHex(root2)));
    expect((await listArchivalBatches(controlDb)).map((batch) => batch.batchDate)).toEqual(['2026-03-01', '2026-03-02']);
    await expect(anchorDailyRoot({ ...base, date: '2026-02-28', root: await rootOf('j0') })).rejects.toMatchObject({ code: 'ANCHOR_INVALID_INPUT' });
  });

  it('renouvellement LTA : deux jetons ajoutés, ancien jamais écrasé, lot relu avec les colonnes de renouvellement', async () => {
    const { adapter, tsa, clock, controlDb } = await fixture(kind, '2024-03-01T12:00:00Z');
    const root = await rootOf('racine');
    const { batch } = await anchorDailyRoot({ date: '2024-03-01', companyScope: 'platform', root, leafCount: 3, timestampProvider: tsa, adapter, retention });
    clock.set('2026-03-01T08:00:00Z');
    const one = await renewTimestamp({ batch, timestampProvider: tsa, adapter, retention, now: clock.nowIso() });
    expect(one).toMatchObject({ status: 'RENEWED', tokenIndex: 1 });
    expect((await findBatchById(controlDb, batch.batchId))?.lastLtaRenewalAt).toBe('2026-03-01T08:00:00Z');
    clock.set('2028-03-01T08:00:00Z');
    const two = await renewTimestamp({ batch: one.batch, timestampProvider: tsa, adapter, retention, now: clock.nowIso() });
    expect(two.tokenIndex).toBe(2);
    const stored = await findBatchById(controlDb, batch.batchId);
    expect(stored?.tsaRfc3161TokenB64).toBe(batch.tsaRfc3161TokenB64);
    const chain = await loadTokenChain(adapter.getLegalVault(), two.batch);
    expect(chain).toHaveLength(3);
    expect(toBase64(chain[0] as Uint8Array)).toBe(batch.tsaRfc3161TokenB64);
    expect((await checkTimestampChain(chain, root)).every((check) => check.ok)).toBe(true);
    expect(planLtaRenewal(await listArchivalBatches(controlDb), '2028-03-02T00:00:00Z')).toEqual([]);
    expect(await adapter.getLegalVault().getObjectBytes(tokenObjectKey(batch.batchId, 3))).toBeNull();
  });
});

describe('PostgreSQL : écarts de comportement mesurés', () => {
  it('la base impose l’unicité de batch_date et le CHECK leaf_count > 0 (refus SQL, pas seulement TypeScript)', async () => {
    const { controlDb } = await fixture('postgres', '2026-03-01T10:00:00Z');
    const insert = (id: string, date: string, leaves: number): SqlStatementParams => ({
      sql: `INSERT INTO archival_merkle_batches (batch_id, batch_date, leaf_count, previous_batch_root_hash, merkle_root_sha256, chained_root_sha256, tsa_rfc3161_token_b64)
            VALUES (?, ?, ?, 'a', 'b', 'c', 'AA==')`,
      params: [id, date, leaves],
    });
    await controlDb.executeBatchAtomically([insert('b1', '2026-03-01', 1)]);
    await expect(controlDb.executeBatchAtomically([insert('b2', '2026-03-01', 1)])).rejects.toBeDefined();
    await expect(controlDb.executeBatchAtomically([insert('b3', '2026-03-02', 0)])).rejects.toBeDefined();
    expect(await listArchivalBatches(controlDb)).toHaveLength(1);
  });
});
