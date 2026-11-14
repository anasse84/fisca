import { aipLeaf, type AipPackage } from './aip.ts';
import { VaultMerkleError } from './errors.ts';
import { buildMerkleTree, type MerkleTree } from './merkle.ts';

/**
 * Lot quotidien : feuilles = empreintes d'AIP (aipLeaf), triées par `aipId` (ordre des unités de code, indépendant de la locale)
 * pour que la racine ne dépende pas de l'ordre d'arrivée. Un `aipId` en double est refusé.
 */
export interface DailyBatch {
  readonly tree: MerkleTree;
  /** Identifiants d'AIP dans l'ordre des feuilles : l'indice d'un AIP est sa position ici. */
  readonly aipIds: readonly string[];
}

export async function buildDailyBatch(aips: readonly AipPackage[]): Promise<DailyBatch> {
  const sorted = [...aips].sort((left, right) => (left.aipId < right.aipId ? -1 : left.aipId > right.aipId ? 1 : 0));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]?.aipId === sorted[index - 1]?.aipId) throw new VaultMerkleError('AIP_INVALID_INPUT', 'aipId en double dans le lot quotidien.');
  }
  return { tree: await buildMerkleTree(sorted.map(aipLeaf)), aipIds: sorted.map((aip) => aip.aipId) };
}
