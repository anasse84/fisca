import { describe, expect, it } from 'vitest';
import { aipLeaf, buildDailyBatch, type AipPackage, type MerkleInclusionProof, sha256, verifyArchiveEvidence } from '../src/index.ts';
import { createClock, makeInvoiceAip } from './support/fixture.ts';
import { createTestTimestampProvider } from '../../ubl-xades/tests/support/test-pki.ts';

const CREATED = '2026-03-01T10:00:00Z';

async function setup() {
  const aips: AipPackage[] = [];
  for (let index = 1; index <= 4; index += 1) aips.push(await makeInvoiceAip('soc-a', index, CREATED));
  const batch = await buildDailyBatch(aips);
  const clock = createClock('2026-03-01T23:00:00Z');
  const tsa = await createTestTimestampProvider({ now: clock.now });
  const token = await tsa.timestamp(batch.tree.root);
  const proof = await batch.tree.inclusionProof(1);
  return { aips, batch, token, proof, tsa, aip: aips[1] as AipPackage };
}

describe('verifyArchiveEvidence', () => {
  it('preuve complète valide, confiance TSA non évaluée', async () => {
    const { aip, proof, batch, token } = await setup();
    const report = await verifyArchiveEvidence({ aip, inclusionProof: proof, root: batch.tree.root, timestampTokens: [token] });
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.timestamps.trust).toBe('NOT_EVALUATED');
  });

  it('document altéré → DOCUMENT_ALTERED seul', async () => {
    const { aip, proof, batch, token } = await setup();
    const first = aip.contents[0];
    if (first === undefined) throw new Error('contenu attendu');
    const altered = { ...aip, contents: [{ ...first, dataB64: btoa('falsifie') }, ...aip.contents.slice(1)] };
    const report = await verifyArchiveEvidence({ aip: altered, inclusionProof: proof, root: batch.tree.root, timestampTokens: [token] });
    expect(report.failures).toEqual(['DOCUMENT_ALTERED']);
  });

  it('feuille hors arbre → LEAF_NOT_IN_TREE', async () => {
    const { aips, proof, batch, token } = await setup();
    const stranger = await makeInvoiceAip('soc-a', 99, CREATED);
    expect(aips.some((aip) => aip.aipId === stranger.aipId)).toBe(false);
    const report = await verifyArchiveEvidence({ aip: stranger, inclusionProof: proof, root: batch.tree.root, timestampTokens: [token] });
    expect(report.failures).toEqual(['LEAF_NOT_IN_TREE']);
    expect(report.aip.ok).toBe(true);
  });

  it('racine différente → ROOT_MISMATCH', async () => {
    const { aip, batch, token, aips } = await setup();
    const other = await buildDailyBatch(aips.slice(0, 3));
    const wrongProof: MerkleInclusionProof = await other.tree.inclusionProof(1);
    const report = await verifyArchiveEvidence({ aip, inclusionProof: wrongProof, root: batch.tree.root, timestampTokens: [token] });
    expect(report.failures).toContain('ROOT_MISMATCH');
    expect(report.failures).not.toContain('DOCUMENT_ALTERED');
  });

  it('jeton d’un autre condensé → TOKEN_OTHER_DIGEST ; aucun jeton → NO_TIMESTAMP_TOKEN ; jeton illisible', async () => {
    const { aip, proof, batch, tsa } = await setup();
    const foreign = await tsa.timestamp(await sha256(new TextEncoder().encode('autre')));
    const base = { aip, inclusionProof: proof, root: batch.tree.root };
    expect((await verifyArchiveEvidence({ ...base, timestampTokens: [foreign] })).failures).toEqual(['TOKEN_OTHER_DIGEST']);
    expect((await verifyArchiveEvidence({ ...base, timestampTokens: [] })).failures).toEqual(['NO_TIMESTAMP_TOKEN']);
    expect((await verifyArchiveEvidence({ ...base, timestampTokens: [new Uint8Array([1, 2, 3])] })).failures).toEqual(['TOKEN_UNREADABLE']);
  });

  it('renouvellement qui ne couvre pas le jeton précédent → TOKEN_CHAIN_BROKEN', async () => {
    const { aip, proof, batch, token, tsa } = await setup();
    const notChained = await tsa.timestamp(batch.tree.root);
    const report = await verifyArchiveEvidence({ aip, inclusionProof: proof, root: batch.tree.root, timestampTokens: [token, notChained] });
    expect(report.failures).toEqual(['TOKEN_CHAIN_BROKEN']);
    expect(aipLeaf(aip)).toHaveLength(32);
  });
});
