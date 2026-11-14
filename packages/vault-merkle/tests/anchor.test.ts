import { describe, expect, it } from 'vitest';
import { ARCHIVAL_MERKLE_BATCH_COLUMNS, anchorDailyRoot, batchIdFor, computeChainedRoot, fromHex, GENESIS_PREVIOUS_HASH, listArchivalBatches, rootObjectKey, sha256, toBase64, tokenObjectKey, toHex } from '../src/index.ts';
import { createAnchorFixture } from './support/fixture.ts';

const retention = { days: 3653 };

async function rootOf(label: string): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(label));
}

describe('ancrage quotidien', () => {
  it('colonnes réelles de archival_merkle_batches', () => {
    expect(ARCHIVAL_MERKLE_BATCH_COLUMNS).toEqual([
      'batch_id', 'batch_date', 'leaf_count', 'previous_batch_root_hash', 'merkle_root_sha256', 'chained_root_sha256', 'tsa_rfc3161_token_b64', 'last_lta_renewal_at', 'lta_renewal_token_b64',
    ]);
  });

  it('ancre : jeton sur la racine (messageImprint), lot inscrit, objets au coffre', async () => {
    const { adapter, tsa } = await createAnchorFixture('2026-03-01T23:59:00Z');
    const root = await rootOf('r1');
    const result = await anchorDailyRoot({ date: '2026-03-01', companyScope: 'platform', root, leafCount: 5, timestampProvider: tsa, adapter, retention });
    expect(result.status).toBe('ANCHORED');
    expect(result.batch.batchId).toBe(batchIdFor('2026-03-01', 'platform'));
    expect(result.batch.merkleRootSha256).toBe(toHex(root));
    expect(result.batch.previousBatchRootHash).toBe(GENESIS_PREVIOUS_HASH);
    expect(result.batch.chainedRootSha256).toBe(await computeChainedRoot(GENESIS_PREVIOUS_HASH, toHex(root)));
    expect(result.batch.lastLtaRenewalAt).toBeNull();
    expect(toHex(tsa.imprints[0] as Uint8Array)).toBe(toHex(root));
    const vault = adapter.getLegalVault();
    expect(await vault.getObjectBytes(rootObjectKey(result.batch.batchId))).not.toBeNull();
    const token = await vault.getObjectBytes(tokenObjectKey(result.batch.batchId, 0));
    expect(toBase64(token?.bytes as Uint8Array)).toBe(result.batch.tsaRfc3161TokenB64);
    expect(await listArchivalBatches(adapter.getControlPlaneDb())).toHaveLength(1);
  });

  it('idempotent le même jour : aucun second lot ni appel TSA ; racine différente refusée', async () => {
    const { adapter, tsa } = await createAnchorFixture('2026-03-01T23:59:00Z');
    const root = await rootOf('r1');
    const base = { date: '2026-03-01', companyScope: 'platform', leafCount: 5, timestampProvider: tsa, adapter, retention };
    await anchorDailyRoot({ ...base, root });
    const again = await anchorDailyRoot({ ...base, root });
    expect(again.status).toBe('ALREADY_ANCHORED');
    expect(tsa.imprints).toHaveLength(1);
    expect(await listArchivalBatches(adapter.getControlPlaneDb())).toHaveLength(1);
    await expect(anchorDailyRoot({ ...base, root: await rootOf('autre') })).rejects.toMatchObject({ code: 'ANCHOR_ROOT_CONFLICT' });
    await expect(anchorDailyRoot({ ...base, root, companyScope: 'autre' })).rejects.toMatchObject({ code: 'ANCHOR_SCOPE_CONFLICT' });
  });

  it('chaîne les racines d’un jour à l’autre et refuse un lot antérieur', async () => {
    const { adapter, tsa, clock } = await createAnchorFixture('2026-03-01T23:59:00Z');
    const base = { companyScope: 'platform', leafCount: 2, timestampProvider: tsa, adapter, retention };
    const first = await anchorDailyRoot({ ...base, date: '2026-03-01', root: await rootOf('j1') });
    clock.set('2026-03-02T23:59:00Z');
    const root2 = await rootOf('j2');
    const second = await anchorDailyRoot({ ...base, date: '2026-03-02', root: root2 });
    expect(second.batch.previousBatchRootHash).toBe(first.batch.chainedRootSha256);
    expect(second.batch.chainedRootSha256).toBe(await computeChainedRoot(first.batch.chainedRootSha256, toHex(root2)));
    await expect(anchorDailyRoot({ ...base, date: '2026-02-28', root: await rootOf('j0') })).rejects.toMatchObject({ code: 'ANCHOR_INVALID_INPUT' });
  });

  it('refuse un genTime hors du jour ancré et des entrées invalides', async () => {
    const { adapter, tsa, clock } = await createAnchorFixture('2026-03-05T12:00:00Z');
    const base = { companyScope: 'platform', leafCount: 2, timestampProvider: tsa, adapter, retention };
    await expect(anchorDailyRoot({ ...base, date: '2026-03-01', root: await rootOf('x') })).rejects.toMatchObject({ code: 'ANCHOR_TIMESTAMP_INVALID' });
    clock.set('2026-03-01T10:00:00Z');
    await expect(anchorDailyRoot({ ...base, date: '2026-03-01', root: new Uint8Array(31) })).rejects.toMatchObject({ code: 'ANCHOR_INVALID_INPUT' });
    await expect(anchorDailyRoot({ ...base, date: '2026-03-01', root: await rootOf('x'), leafCount: 0 })).rejects.toMatchObject({ code: 'ANCHOR_INVALID_INPUT' });
    await expect(anchorDailyRoot({ ...base, date: '2026-02-30', root: await rootOf('x') })).rejects.toMatchObject({ code: 'ANCHOR_INVALID_INPUT' });
    expect(fromHex(toHex(await rootOf('x')))).toHaveLength(32);
  });

  it('refuse un jeton portant le condensé d’une autre racine', async () => {
    const { adapter, tsa } = await createAnchorFixture('2026-03-01T10:00:00Z');
    const wrong = await rootOf('autre');
    const lying = { timestamp: async () => tsa.timestamp(wrong) };
    await expect(anchorDailyRoot({ date: '2026-03-01', companyScope: 'platform', root: await rootOf('x'), leafCount: 1, timestampProvider: lying, adapter, retention })).rejects.toMatchObject({ code: 'ANCHOR_TIMESTAMP_INVALID' });
  });
});
