import { describe, expect, it } from 'vitest';
import { buildMerkleTree, sha256 } from '../src/index.ts';
describe('AUDIT G2 : racine de Merkle RFC 6962 de 500 feuilles = calcul Python indépendant', () => {
  it('500 feuilles', async () => {
    const leaves = await Promise.all(Array.from({ length: 500 }, (_, i) => sha256(new TextEncoder().encode(`archive-${i}`))));
    const tree = await buildMerkleTree(leaves);
    expect(tree.rootHex).toBe('0b8c2d9e1e6b0bc8ac86b5b173bb41b0d7c61cf38e011d151f2c33c399fbe86b');
  });
});

import { aipLeaf, anchorDailyRoot, buildDailyBatch, verifyInclusionProof } from '../src/index.ts';
import { createAnchorFixture, makeInvoiceAip } from './support/fixture.ts';

describe('AUDIT G2 : 500 archives_packages le même jour → UN SEUL appel TSA RFC 3161', () => {
  it('500 AIP, une racine, un seul jeton, preuves d’inclusion vérifiables', async () => {
    const fx = await createAnchorFixture('2026-03-01T09:00:00Z');
    const retention = { days: 3653 };
    const aips = [];
    for (let i = 1; i <= 500; i += 1) aips.push(await makeInvoiceAip(`soc-${i % 7}`, i, fx.clock.nowIso()));
    const daily = await buildDailyBatch(aips);
    expect(daily.tree.leafCount).toBe(500);
    fx.clock.set('2026-03-01T23:59:00Z');
    const base = { date: '2026-03-01', companyScope: 'platform', root: daily.tree.root, leafCount: 500, timestampProvider: fx.tsa, adapter: fx.adapter, retention };
    const first = await anchorDailyRoot(base);
    const again = await anchorDailyRoot(base);
    expect([first.status, again.status]).toEqual(['ANCHORED', 'ALREADY_ANCHORED']);
    expect(fx.tsa.imprints).toHaveLength(1);
    for (const i of [0, 1, 255, 256, 499]) {
      const p = await daily.tree.inclusionProof(i);
      expect(p.treeSize).toBe(500);
      expect(await verifyInclusionProof(aipLeaf(aips.find((a) => a.aipId === daily.aipIds[i])!), p, daily.tree.rootHex)).toBe(true);
    }
  }, 120_000);
});
