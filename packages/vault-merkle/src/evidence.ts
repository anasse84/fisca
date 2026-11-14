import { type AipFailure, type AipPackage, verifyAipPackage } from './aip.ts';
import { fromHex, isSha256Hex, toHex } from './bytes.ts';
import { checkInclusionProof, type InclusionFailure, type MerkleInclusionProof } from './merkle.ts';
import { checkTimestampChain, type TokenCheck } from './timestamp-chain.ts';

export type EvidenceFailureCode =
  /** Contenu, taille ou manifeste de l'AIP altéré. */
  | 'DOCUMENT_ALTERED'
  /** Preuve mal formée. */
  | 'PROOF_MALFORMED'
  /** L'empreinte de l'AIP n'appartient pas à l'arbre déclaré par la preuve. */
  | 'LEAF_NOT_IN_TREE'
  /** La preuve aboutit à une racine différente de la racine attendue. */
  | 'ROOT_MISMATCH'
  /** Aucun jeton fourni. */
  | 'NO_TIMESTAMP_TOKEN'
  /** Jeton illisible. */
  | 'TOKEN_UNREADABLE'
  /** Jeton initial dont le condensé n'est pas la racine (jeton d'un autre condensé). */
  | 'TOKEN_OTHER_DIGEST'
  /** Jeton de renouvellement qui ne couvre pas le jeton précédent et la racine. */
  | 'TOKEN_CHAIN_BROKEN'
  /** genTime décroissant dans la chaîne. */
  | 'TOKEN_TIME_REGRESSION';

export interface VerifyArchiveEvidenceInput {
  readonly aip: AipPackage;
  readonly inclusionProof: MerkleInclusionProof;
  /** Racine de Merkle attendue (32 octets), p. ex. issue de archival_merkle_batches. */
  readonly root: Uint8Array;
  /** Jeton initial puis renouvellements, dans l'ordre. */
  readonly timestampTokens: readonly Uint8Array[];
}

export interface ArchiveEvidenceReport {
  readonly ok: boolean;
  /** Maillon 1 : intégrité du paquet (objets, manifeste, empreinte). */
  readonly aip: { readonly ok: boolean; readonly failures: readonly AipFailure[]; readonly recomputedAipSha256Hex: string };
  /** Maillon 2 : preuve d'inclusion de l'empreinte RECALCULÉE de l'AIP dans la racine attendue. */
  readonly inclusion: { readonly ok: boolean; readonly failure?: InclusionFailure };
  /** Maillon 3 : chaîne de jetons (empreinte, chaînage, genTime). Signature TSA et certificats : non évalués. */
  readonly timestamps: { readonly ok: boolean; readonly trust: 'NOT_EVALUATED'; readonly checks: readonly TokenCheck[] };
  readonly failures: readonly EvidenceFailureCode[];
}

/**
 * Rapport par maillon, sans court-circuit : tous les maillons sont évalués pour que chaque échec reste distinct.
 * `trust: 'NOT_EVALUATED'` : ni signature de la TSA, ni chaîne de certification, ni révocation ne sont vérifiées ; un rapport `ok`
 * prouve la cohérence structurelle (empreintes et chaînage), pas la qualification de l'horodatage.
 */
export async function verifyArchiveEvidence(input: VerifyArchiveEvidenceInput): Promise<ArchiveEvidenceReport> {
  const failures: EvidenceFailureCode[] = [];
  const aipReport = await verifyAipPackage(input.aip);
  if (!aipReport.ok) failures.push('DOCUMENT_ALTERED');

  const rootHex = toHex(input.root);
  let inclusion: ArchiveEvidenceReport['inclusion'];
  if (input.root.length !== 32 || !isSha256Hex(aipReport.recomputedAipSha256Hex)) {
    inclusion = { ok: false, failure: 'PROOF_MALFORMED' };
  } else {
    const result = await checkInclusionProof(fromHex(aipReport.recomputedAipSha256Hex), input.inclusionProof, rootHex);
    inclusion = result.ok ? { ok: true } : { ok: false, failure: result.failure };
  }
  if (!inclusion.ok && inclusion.failure !== undefined) failures.push(inclusion.failure);

  let checks: readonly TokenCheck[] = [];
  if (input.timestampTokens.length === 0) {
    failures.push('NO_TIMESTAMP_TOKEN');
  } else if (input.root.length === 32) {
    checks = await checkTimestampChain(input.timestampTokens, input.root);
    for (const check of checks) {
      if (check.ok || check.failure === undefined) continue;
      failures.push(check.failure === 'TOKEN_IMPRINT_MISMATCH' ? 'TOKEN_OTHER_DIGEST' : check.failure);
    }
  }
  const timestampsOk = input.timestampTokens.length > 0 && checks.length === input.timestampTokens.length && checks.every((check) => check.ok);
  const unique = [...new Set(failures)];
  return {
    ok: unique.length === 0,
    aip: aipReport,
    inclusion,
    timestamps: { ok: timestampsOk, trust: 'NOT_EVALUATED', checks },
    failures: unique,
  };
}
