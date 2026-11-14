import { describe, expect, it } from 'vitest';
import {
  aipLeaf, aipObjectKey, anchorDailyRoot, buildDailyBatch, DEFAULT_RETENTION_DAYS, findBatchById, listArchivalBatches, loadTokenChain, planLtaRenewal, readAip, renewTimestamp, toHex, verifyAip, verifyArchiveEvidence, writeAip,
} from '../src/index.ts';
import { createAnchorFixture, makeInvoiceAip, testCipher } from './support/fixture.ts';

describe('bout en bout : 5 factures → AIP → racine → ancrage → preuve → LTA', () => {
  it('chaîne probante complète avec horloge simulée', async () => {
    const fx = await createAnchorFixture('2026-03-01T09:00:00Z');
    const { adapter, clock, tsa } = fx;
    const retention = { days: DEFAULT_RETENTION_DAYS };
    const vault = adapter.getLegalVault();

    const aips = [];
    for (let index = 1; index <= 5; index += 1) {
      const aip = await makeInvoiceAip('soc-a', index, clock.nowIso());
      await writeAip({ vault, aip, retention, cipher: testCipher });
      expect((await verifyAip({ vault, companyId: 'soc-a', aipId: aip.aipId, cipher: testCipher })).ok).toBe(true);
      aips.push(aip);
    }
    expect(aipObjectKey('soc-a', 'aip_003')).toBe('aip/v1/soc-a/aip_003.json');

    const daily = await buildDailyBatch(aips);
    expect(daily.tree.leafCount).toBe(5);
    clock.set('2026-03-01T23:59:00Z');
    const anchor = await anchorDailyRoot({ date: '2026-03-01', companyScope: 'platform', root: daily.tree.root, leafCount: 5, timestampProvider: tsa, adapter, retention });
    expect(anchor.status).toBe('ANCHORED');
    expect((await listArchivalBatches(adapter.getControlPlaneDb()))[0]?.merkleRootSha256).toBe(toHex(daily.tree.root));

    // Preuve d'inclusion de la 4e facture, relue depuis le coffre.
    const target = 'aip_004';
    const index = daily.aipIds.indexOf(target);
    const proof = await daily.tree.inclusionProof(index);
    const reread = await readAip({ vault, companyId: 'soc-a', aipId: target, cipher: testCipher });
    expect(toHex(aipLeaf(reread))).toBe(toHex(aipLeaf(aips[3] as (typeof aips)[number])));
    const stored = await findBatchById(adapter.getControlPlaneDb(), anchor.batch.batchId);
    const initialChain = await loadTokenChain(vault, stored ?? anchor.batch);
    const before = await verifyArchiveEvidence({ aip: reread, inclusionProof: proof, root: daily.tree.root, timestampTokens: initialChain });
    expect(before.ok).toBe(true);

    // 24 mois plus tard : le plan désigne le lot, le renouvellement chaîne un second jeton.
    expect(planLtaRenewal([anchor.batch], '2028-02-29T23:59:59Z')).toEqual([]);
    clock.set('2028-03-02T06:00:00Z');
    const due = planLtaRenewal([anchor.batch], clock.nowIso());
    expect(due.map((entry) => entry.batchId)).toEqual([anchor.batch.batchId]);
    const renewed = await renewTimestamp({ batch: anchor.batch, timestampProvider: tsa, adapter, retention, now: clock.nowIso() });
    expect(renewed.status).toBe('RENEWED');
    expect(planLtaRenewal([renewed.batch], clock.nowIso())).toEqual([]);

    const fullChain = await loadTokenChain(vault, renewed.batch);
    expect(fullChain).toHaveLength(2);
    const after = await verifyArchiveEvidence({ aip: reread, inclusionProof: proof, root: daily.tree.root, timestampTokens: fullChain });
    expect(after.ok).toBe(true);
    expect(after.timestamps.checks.map((check) => check.genTimeIso)).toEqual(['2026-03-01T23:59:00Z', '2028-03-02T06:00:00Z']);
    expect(after.timestamps.trust).toBe('NOT_EVALUATED');
  });
});
