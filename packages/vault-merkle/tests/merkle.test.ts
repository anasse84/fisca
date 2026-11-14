import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildMerkleTree,
  checkInclusionProof,
  fromHex,
  merkleInclusionProof,
  merkleRoot,
  parseInclusionProof,
  serializeInclusionProof,
  toHex,
  verifyInclusionProof,
  VaultMerkleError,
} from '../src/index.ts';

interface Vectors {
  readonly leafInputsHex: readonly string[];
  readonly roots: Readonly<Record<string, string>>;
}

const vectors = JSON.parse(readFileSync(new URL('./golden/merkle.vectors.json', import.meta.url), 'utf8')) as Vectors;
const leaves = vectors.leafInputsHex.map((hex) => fromHex(hex));

/** Calcul indépendant (RFC 6962 § 2.1, définition récursive MTH) avec node:crypto. */
function independentRoot(data: readonly Uint8Array[]): string {
  const digest = (bytes: Uint8Array): Uint8Array => new Uint8Array(createHash('sha256').update(bytes).digest());
  const mth = (items: readonly Uint8Array[]): Uint8Array => {
    if (items.length === 0) return digest(new Uint8Array(0));
    if (items.length === 1) return digest(Uint8Array.of(0, ...(items[0] as Uint8Array)));
    let k = 1;
    while (k * 2 < items.length) k *= 2;
    return digest(Uint8Array.of(1, ...mth(items.slice(0, k)), ...mth(items.slice(k))));
  };
  return toHex(mth(data));
}

describe('Arbre de Merkle RFC 6962 : vecteurs d’or', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])('%i feuille(s) : racine = vecteur d’or = calcul indépendant', async (n) => {
    const subset = leaves.slice(0, n);
    const expected = vectors.roots[String(n)];
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(independentRoot(subset)).toBe(expected);
    expect(toHex(await merkleRoot(subset))).toBe(expected);
    expect((await buildMerkleTree(subset)).rootHex).toBe(expected);
  });

  it('arbre vide : SHA-256 de la chaîne vide ; aucune preuve possible', async () => {
    const tree = await buildMerkleTree([]);
    expect(tree.leafCount).toBe(0);
    expect(tree.rootHex).toBe(createHash('sha256').update('').digest('hex'));
    await expect(tree.inclusionProof(0)).rejects.toMatchObject({ code: 'MERKLE_INDEX_OUT_OF_RANGE' });
  });

  it('préfixes 0x00 / 0x01 : une feuille égale à deux hachages concaténés ne donne pas la racine du nœud (seconde préimage)', async () => {
    const pair = await buildMerkleTree([Uint8Array.of(1), Uint8Array.of(2)]);
    const fake = await buildMerkleTree([Uint8Array.of(0x01, ...(await (await buildMerkleTree([Uint8Array.of(1)])).root), ...(await (await buildMerkleTree([Uint8Array.of(2)])).root))]);
    expect(fake.rootHex).not.toBe(pair.rootHex);
  });
});

describe('Preuves d’inclusion', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('arbre de %i feuille(s) : toutes les preuves se vérifient', async (n) => {
    const subset = leaves.slice(0, n);
    const tree = await buildMerkleTree(subset);
    for (let index = 0; index < n; index += 1) {
      const proof = await tree.inclusionProof(index);
      expect(proof.treeSize).toBe(n);
      expect(await verifyInclusionProof(subset[index] as Uint8Array, proof, tree.rootHex)).toBe(true);
    }
  });

  it('arbres de 1 à 37 feuilles (tailles non puissances de deux)', async () => {
    for (let n = 1; n <= 37; n += 1) {
      const data = Array.from({ length: n }, (_, index) => Uint8Array.of(index, n));
      const tree = await buildMerkleTree(data);
      for (let index = 0; index < n; index += 1) {
        expect(await verifyInclusionProof(data[index] as Uint8Array, await tree.inclusionProof(index), tree.rootHex)).toBe(true);
      }
    }
  });

  it('merkleInclusionProof(leaves, index) équivaut à buildMerkleTree().inclusionProof()', async () => {
    const direct = await merkleInclusionProof(leaves, 5);
    const viaTree = await (await buildMerkleTree(leaves)).inclusionProof(5);
    expect(direct).toEqual(viaTree);
  });

  it('feuille altérée → LEAF_NOT_IN_TREE ; racine attendue différente → ROOT_MISMATCH ; chemin tronqué → PROOF_MALFORMED', async () => {
    const tree = await buildMerkleTree(leaves);
    const proof = await tree.inclusionProof(3);
    expect(await checkInclusionProof(Uint8Array.of(9, 9), proof, tree.rootHex)).toEqual({ ok: false, failure: 'LEAF_NOT_IN_TREE' });
    const otherRoot = await merkleRoot(leaves.slice(0, 7));
    expect(await checkInclusionProof(leaves[3] as Uint8Array, proof, toHex(otherRoot))).toEqual({ ok: false, failure: 'ROOT_MISMATCH' });
    expect(await checkInclusionProof(leaves[3] as Uint8Array, { ...proof, path: proof.path.slice(1) }, tree.rootHex)).toEqual({ ok: false, failure: 'PROOF_MALFORMED' });
    expect(await checkInclusionProof(leaves[3] as Uint8Array, { ...proof, path: [...proof.path, proof.path[0] as string] }, tree.rootHex)).toEqual({ ok: false, failure: 'PROOF_MALFORMED' });
    expect(await checkInclusionProof(leaves[3] as Uint8Array, { ...proof, leafIndex: 99 }, tree.rootHex)).toEqual({ ok: false, failure: 'PROOF_MALFORMED' });
    expect(await verifyInclusionProof(leaves[3] as Uint8Array, { ...proof, path: ['AB'] }, tree.rootHex)).toBe(false);
  });

  it('une preuve ne se rejoue pas à un autre indice', async () => {
    const tree = await buildMerkleTree(leaves);
    const proof = await tree.inclusionProof(2);
    expect(await verifyInclusionProof(leaves[2] as Uint8Array, { ...proof, leafIndex: 3 }, tree.rootHex)).toBe(false);
  });

  it('indice hors arbre refusé avec une erreur typée', async () => {
    const tree = await buildMerkleTree(leaves);
    await expect(tree.inclusionProof(8)).rejects.toBeInstanceOf(VaultMerkleError);
    await expect(tree.inclusionProof(-1)).rejects.toMatchObject({ code: 'MERKLE_INDEX_OUT_OF_RANGE' });
    await expect(tree.inclusionProof(1.5)).rejects.toMatchObject({ code: 'MERKLE_INDEX_OUT_OF_RANGE' });
  });

  it('sérialisation merkle_proof_json : aller-retour et refus d’un JSON invalide', async () => {
    const tree = await buildMerkleTree(leaves);
    const proof = await tree.inclusionProof(6);
    const json = serializeInclusionProof(proof);
    expect(parseInclusionProof(json)).toEqual(proof);
    expect(() => parseInclusionProof('{"leafIndex":"x"}')).toThrow(VaultMerkleError);
    expect(() => parseInclusionProof('null')).toThrow(VaultMerkleError);
  });
});
