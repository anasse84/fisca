import { bytesEqual, concatBytes, fromHex, isSha256Hex, sha256, toHex } from './bytes.ts';
import { VaultMerkleError } from './errors.ts';

/**
 * Arbre de Merkle de type RFC 6962 § 2.1 (Certificate Transparency) : SHA-256, préfixe 0x00 pour une feuille et 0x01 pour un
 * nœud interne (aucune seconde préimage entre feuille et nœud). Arbre non équilibré : la séparation se fait à la plus grande
 * puissance de deux strictement inférieure à n. Arbre vide : SHA-256 de la chaîne vide.
 *
 * Granularité : une racine par jour, sur les empreintes d'AIP du jour (voir README).
 * Le calcul de cohérence entre deux arbres (RFC 6962 § 2.1.2) n'est pas fourni : chaque jour a son arbre, la continuité entre
 * jours passe par `chained_root_sha256` (voir anchor.ts).
 */

const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

export interface MerkleInclusionProof {
  /** Position de la feuille (0 = première). */
  readonly leafIndex: number;
  readonly treeSize: number;
  /** Racine déclarée par la preuve, hexadécimal minuscule (64 caractères). */
  readonly rootHex: string;
  /** Hachages frères, de la feuille vers la racine, hexadécimal minuscule. */
  readonly path: readonly string[];
}

export interface MerkleTree {
  readonly leafCount: number;
  readonly root: Uint8Array;
  readonly rootHex: string;
  /** Preuve d'inclusion de la feuille d'indice donné (RFC 6962 § 2.1.1, PATH). */
  inclusionProof(index: number): Promise<MerkleInclusionProof>;
}

export async function hashLeaf(leaf: Uint8Array): Promise<Uint8Array> {
  return sha256(concatBytes(LEAF_PREFIX, leaf));
}

export async function hashNodes(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return sha256(concatBytes(NODE_PREFIX, left, right));
}

/** Plus grande puissance de deux strictement inférieure à n (n >= 2). */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

export async function buildMerkleTree(leaves: readonly Uint8Array[]): Promise<MerkleTree> {
  const leafHashes: Uint8Array[] = [];
  for (const leaf of leaves) {
    if (!(leaf instanceof Uint8Array)) throw new VaultMerkleError('MERKLE_INVALID_LEAF', 'une feuille doit être un Uint8Array.');
    leafHashes.push(await hashLeaf(leaf));
  }
  const cache = new Map<string, Uint8Array>();

  const subtree = async (start: number, end: number): Promise<Uint8Array> => {
    const size = end - start;
    if (size === 0) return sha256(new Uint8Array(0));
    if (size === 1) return leafHashes[start] as Uint8Array;
    const cacheKey = `${start}:${end}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const k = splitPoint(size);
    const value = await hashNodes(await subtree(start, start + k), await subtree(start + k, end));
    cache.set(cacheKey, value);
    return value;
  };

  const root = await subtree(0, leafHashes.length);
  const rootHex = toHex(root);

  const path = async (index: number, start: number, end: number): Promise<Uint8Array[]> => {
    const size = end - start;
    if (size <= 1) return [];
    const k = splitPoint(size);
    if (index < start + k) return [...(await path(index, start, start + k)), await subtree(start + k, end)];
    return [...(await path(index, start + k, end)), await subtree(start, start + k)];
  };

  return {
    leafCount: leafHashes.length,
    root,
    rootHex,
    async inclusionProof(index: number): Promise<MerkleInclusionProof> {
      if (!Number.isSafeInteger(index) || index < 0 || index >= leafHashes.length) {
        throw new VaultMerkleError('MERKLE_INDEX_OUT_OF_RANGE', 'indice de feuille hors de l’arbre.');
      }
      const siblings = await path(index, 0, leafHashes.length);
      return { leafIndex: index, treeSize: leafHashes.length, rootHex, path: siblings.map(toHex) };
    },
  };
}

export async function merkleRoot(leaves: readonly Uint8Array[]): Promise<Uint8Array> {
  return (await buildMerkleTree(leaves)).root;
}

export async function merkleInclusionProof(leaves: readonly Uint8Array[], index: number): Promise<MerkleInclusionProof> {
  return (await buildMerkleTree(leaves)).inclusionProof(index);
}

export type InclusionFailure = 'PROOF_MALFORMED' | 'LEAF_NOT_IN_TREE' | 'ROOT_MISMATCH';

export type InclusionResult = { readonly ok: true } | { readonly ok: false; readonly failure: InclusionFailure };

function isWellFormed(proof: MerkleInclusionProof): boolean {
  return (
    Number.isSafeInteger(proof.leafIndex) &&
    Number.isSafeInteger(proof.treeSize) &&
    proof.treeSize >= 1 &&
    proof.treeSize <= 0x7fffffff &&
    proof.leafIndex >= 0 &&
    proof.leafIndex < proof.treeSize &&
    isSha256Hex(proof.rootHex) &&
    proof.path.every(isSha256Hex)
  );
}

/** Racine recalculée depuis la feuille et le chemin (RFC 9162 § 2.1.3.2) ; undefined si le chemin n'a pas la longueur attendue. */
async function rootFromPath(leaf: Uint8Array, proof: MerkleInclusionProof): Promise<Uint8Array | undefined> {
  let fn = proof.leafIndex;
  let sn = proof.treeSize - 1;
  let r = await hashLeaf(leaf);
  for (const siblingHex of proof.path) {
    if (sn === 0) return undefined;
    const sibling = fromHex(siblingHex);
    if ((fn & 1) === 1 || fn === sn) {
      r = await hashNodes(sibling, r);
      if ((fn & 1) === 0) {
        while ((fn & 1) === 0 && fn !== 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      r = await hashNodes(r, sibling);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 ? r : undefined;
}

/**
 * Vérifie une preuve d'inclusion. Échecs distincts : preuve mal formée, feuille absente de l'arbre déclaré par la preuve,
 * racine de la preuve différente de la racine attendue.
 */
export async function checkInclusionProof(leaf: Uint8Array, proof: MerkleInclusionProof, expectedRootHex: string): Promise<InclusionResult> {
  if (!isWellFormed(proof) || !isSha256Hex(expectedRootHex)) return { ok: false, failure: 'PROOF_MALFORMED' };
  const computed = await rootFromPath(leaf, proof);
  if (computed === undefined) return { ok: false, failure: 'PROOF_MALFORMED' };
  if (!bytesEqual(computed, fromHex(proof.rootHex))) return { ok: false, failure: 'LEAF_NOT_IN_TREE' };
  if (proof.rootHex !== expectedRootHex) return { ok: false, failure: 'ROOT_MISMATCH' };
  return { ok: true };
}

export async function verifyInclusionProof(leaf: Uint8Array, proof: MerkleInclusionProof, rootHex: string): Promise<boolean> {
  return (await checkInclusionProof(leaf, proof, rootHex)).ok;
}

/** Sérialisation de la preuve pour la colonne `merkle_proof_json` (clés triées, entiers seulement). */
export function serializeInclusionProof(proof: MerkleInclusionProof): string {
  return JSON.stringify({ leafIndex: proof.leafIndex, path: proof.path, rootHex: proof.rootHex, treeSize: proof.treeSize });
}

export function parseInclusionProof(json: string): MerkleInclusionProof {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null) throw new VaultMerkleError('MERKLE_INVALID_PROOF', 'preuve JSON illisible.');
  const record = raw as Record<string, unknown>;
  const { leafIndex, treeSize, rootHex, path } = record;
  if (
    typeof leafIndex !== 'number' ||
    typeof treeSize !== 'number' ||
    typeof rootHex !== 'string' ||
    !Array.isArray(path) ||
    !path.every((item): item is string => typeof item === 'string')
  ) {
    throw new VaultMerkleError('MERKLE_INVALID_PROOF', 'preuve JSON : champs attendus absents ou de mauvais type.');
  }
  return { leafIndex, treeSize, rootHex, path };
}
