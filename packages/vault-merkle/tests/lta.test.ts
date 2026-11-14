import { describe, expect, it } from 'vitest';
import {
  addMonthsUtc, type ArchivalMerkleBatchRow, anchorDailyRoot, checkTimestampChain, findBatchById, loadTokenChain, planLtaRenewal, renewalImprint, renewTimestamp, sha256, tokenObjectKey, toBase64, toHex,
} from '../src/index.ts';
import { createAnchorFixture } from './support/fixture.ts';

const retention = { days: 3653 };

function row(date: string, last: string | null): ArchivalMerkleBatchRow {
  return {
    batchId: `merkle_${date.replaceAll('-', '')}_platform`, batchDate: date, leafCount: 1, previousBatchRootHash: '0'.repeat(64),
    merkleRootSha256: '1'.repeat(64), chainedRootSha256: '2'.repeat(64), tsaRfc3161TokenB64: 'AA==', lastLtaRenewalAt: last, ltaRenewalTokenB64: null,
  };
}

describe('planLtaRenewal (pure, horloge injectée)', () => {
  it('24 mois en calendrier UTC : échéance atteinte à la seconde près', () => {
    const batches = [row('2024-03-01', null)];
    expect(planLtaRenewal(batches, '2026-02-28T23:59:59Z')).toEqual([]);
    const due = planLtaRenewal(batches, '2026-03-01T00:00:00Z');
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ dueAtIso: '2026-03-01T00:00:00Z', referenceIso: '2024-03-01T00:00:00Z', overdueDays: 0 });
    expect(planLtaRenewal(batches, '2026-03-11T12:00:00Z')[0]?.overdueDays).toBe(10);
  });

  it('fin de mois ramenée au dernier jour (29 février 2024 + 24 mois = 28 février 2026)', () => {
    expect(addMonthsUtc(Date.UTC(2024, 1, 29), 24)).toBe(Date.UTC(2026, 1, 28));
    expect(planLtaRenewal([row('2024-02-29', null)], '2026-02-28T00:00:00Z')).toHaveLength(1);
  });

  it('un renouvellement récent repousse l’échéance ; tri du plus ancien au plus récent ; paramètre renewalMonths', () => {
    const batches = [row('2024-06-01', null), row('2023-01-01', null), row('2023-01-01', '2025-12-01T00:00:00Z')];
    const due = planLtaRenewal(batches, '2026-07-01T00:00:00Z');
    expect(due.map((entry) => entry.batchDate)).toEqual(['2023-01-01', '2024-06-01']);
    expect(planLtaRenewal([row('2025-01-01', null)], '2026-02-01T00:00:00Z', 12)).toHaveLength(1);
    expect(() => planLtaRenewal(batches, '2026-07-01T00:00:00Z', 0)).toThrow(/LTA_INVALID_INPUT/);
    expect(() => planLtaRenewal(batches, 'hier')).toThrow(/LTA_INVALID_INPUT/);
  });

  it('est pure : n’altère pas ses entrées', () => {
    const batches = [row('2024-03-01', null)];
    const copy = JSON.stringify(batches);
    planLtaRenewal(batches, '2030-01-01T00:00:00Z');
    expect(JSON.stringify(batches)).toBe(copy);
  });
});

describe('renewTimestamp (chaînage append-only)', () => {
  async function anchored() {
    const fx = await createAnchorFixture('2024-03-01T12:00:00Z');
    const root = await sha256(new TextEncoder().encode('racine'));
    const { batch } = await anchorDailyRoot({ date: '2024-03-01', companyScope: 'platform', root, leafCount: 3, timestampProvider: fx.tsa, adapter: fx.adapter, retention });
    return { ...fx, root, batch };
  }

  it('le jeton de renouvellement couvre l’ancien jeton ET la racine et s’ajoute au coffre', async () => {
    const { adapter, tsa, clock, root, batch } = await anchored();
    const first = await adapter.getLegalVault().getObjectBytes(tokenObjectKey(batch.batchId, 0));
    clock.set('2026-03-01T08:00:00Z');
    const result = await renewTimestamp({ batch, timestampProvider: tsa, adapter, retention, now: clock.nowIso() });
    expect(result.status).toBe('RENEWED');
    expect(result.tokenIndex).toBe(1);
    expect(toHex(tsa.imprints[1] as Uint8Array)).toBe(toHex(await renewalImprint(first?.bytes as Uint8Array, root)));
    expect(result.batch.lastLtaRenewalAt).toBe('2026-03-01T08:00:00Z');
    const stored = await findBatchById(adapter.getControlPlaneDb(), batch.batchId);
    expect(stored?.ltaRenewalTokenB64).toBe(result.batch.ltaRenewalTokenB64);
    expect(stored?.tsaRfc3161TokenB64).toBe(batch.tsaRfc3161TokenB64);
    const chain = await loadTokenChain(adapter.getLegalVault(), stored as ArchivalMerkleBatchRow);
    expect(chain).toHaveLength(2);
    expect(toBase64(chain[0] as Uint8Array)).toBe(batch.tsaRfc3161TokenB64);
    expect((await checkTimestampChain(chain, root)).every((check) => check.ok)).toBe(true);
  });

  it('deux renouvellements successifs : chaîne de 3 jetons, anciens jamais écrasés', async () => {
    const { adapter, tsa, clock, root, batch } = await anchored();
    clock.set('2026-03-01T08:00:00Z');
    const one = await renewTimestamp({ batch, timestampProvider: tsa, adapter, retention, now: clock.nowIso() });
    clock.set('2028-03-01T08:00:00Z');
    const two = await renewTimestamp({ batch: one.batch, timestampProvider: tsa, adapter, retention, now: clock.nowIso() });
    expect(two.tokenIndex).toBe(2);
    const chain = await loadTokenChain(adapter.getLegalVault(), two.batch);
    expect(chain).toHaveLength(3);
    expect(toBase64(chain[1] as Uint8Array)).toBe(one.batch.ltaRenewalTokenB64);
    expect(toHex(tsa.imprints[2] as Uint8Array)).toBe(toHex(await renewalImprint(chain[1] as Uint8Array, root)));
    expect(await planLtaRenewal([two.batch], '2028-03-02T00:00:00Z')).toEqual([]);
  });

  it('refuse un jeton dont le genTime s’écarte de l’horloge, et un lot inconnu', async () => {
    const { adapter, tsa, clock, batch } = await anchored();
    clock.set('2026-03-01T08:00:00Z');
    await expect(renewTimestamp({ batch, timestampProvider: tsa, adapter, retention, now: '2026-03-05T08:00:00Z' })).rejects.toMatchObject({ code: 'ANCHOR_TIMESTAMP_INVALID' });
    await expect(renewTimestamp({ batch: row('2020-01-01', null), timestampProvider: tsa, adapter, retention, now: clock.nowIso() })).rejects.toMatchObject({ code: 'LTA_BATCH_UNKNOWN' });
    expect((await adapter.getLegalVault().getObjectBytes(tokenObjectKey(batch.batchId, 1)))).toBeNull();
  });
});
