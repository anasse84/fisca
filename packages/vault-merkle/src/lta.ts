import type { FiscaInfrastructureAdapter, WormVaultDriver } from '@fisca/shared-types';
import { parseTimeStampToken, UblSignatureError, type TimestampProvider } from '@fisca/ubl-xades';
import { retentionUntilIso, type RetentionPolicy } from './aip.ts';
import {
  type ArchivalMerkleBatchRow,
  decodeBatchToken,
  DEFAULT_GENTIME_TOLERANCE_SECONDS,
  findBatchById,
  putWormIfAbsent,
  tokenObjectKey,
} from './anchor.ts';
import { fromHex, toBase64 } from './bytes.ts';
import { VaultMerkleError } from './errors.ts';
import { addMonthsUtc, formatInstant, MS_PER_DAY, parseDayStartMs, parseInstantMs } from './time.ts';
import { checkTimestampChain, renewalImprint, SHA256_OID } from './timestamp-chain.ts';

/** Périodicité de ré-horodatage : 24 mois (ADR-07, Doc_10 § « Pérennité des signatures d'archives »). Paramètre, jamais figé dans la logique. */
export const DEFAULT_LTA_RENEWAL_MONTHS = 24 as const;

const MAX_RENEWAL_MONTHS = 120;
const MAX_CHAIN_LENGTH = 1000;

export interface LtaRenewalDue {
  readonly batchId: string;
  readonly batchDate: string;
  /** Début de la période courante : dernier renouvellement, sinon 00:00 UTC du jour du lot. */
  readonly referenceIso: string;
  /** Échéance = référence + renewalMonths mois civils UTC. */
  readonly dueAtIso: string;
  /** Jours entiers de retard au-delà de l'échéance (0 le jour même). */
  readonly overdueDays: number;
}

/**
 * Plan de renouvellement, pure (aucune E/S, horloge injectée). Retourne les lots dont l'échéance est atteinte (dueAt <= now),
 * du plus ancien au plus récent. Dates en entiers de millisecondes UTC ; fin de mois ramenée au dernier jour du mois d'arrivée.
 * Écart assumé : sans colonne dédiée au `genTime` du premier jeton, la référence initiale est le début du jour du lot (échéance
 * au plus tôt, donc au plus conservatrice).
 */
export function planLtaRenewal(batches: readonly ArchivalMerkleBatchRow[], now: string, renewalMonths: number = DEFAULT_LTA_RENEWAL_MONTHS): readonly LtaRenewalDue[] {
  if (!Number.isSafeInteger(renewalMonths) || renewalMonths < 1 || renewalMonths > MAX_RENEWAL_MONTHS) {
    throw new VaultMerkleError('LTA_INVALID_INPUT', 'renewalMonths : entier entre 1 et 120 attendu.');
  }
  const nowMs = parseInstantMs(now, 'LTA_INVALID_INPUT');
  const due: LtaRenewalDue[] = [];
  for (const batch of batches) {
    const referenceMs = batch.lastLtaRenewalAt === null ? parseDayStartMs(batch.batchDate, 'LTA_INVALID_INPUT') : parseInstantMs(batch.lastLtaRenewalAt, 'LTA_INVALID_INPUT');
    const dueMs = addMonthsUtc(referenceMs, renewalMonths);
    if (dueMs <= nowMs) {
      due.push({
        batchId: batch.batchId,
        batchDate: batch.batchDate,
        referenceIso: formatInstant(referenceMs),
        dueAtIso: formatInstant(dueMs),
        overdueDays: Math.floor((nowMs - dueMs) / MS_PER_DAY),
      });
    }
  }
  return due.sort((left, right) => (left.dueAtIso < right.dueAtIso ? -1 : left.dueAtIso > right.dueAtIso ? 1 : left.batchId < right.batchId ? -1 : 1));
}

/**
 * Chaîne de jetons d'un lot, dans l'ordre : jeton 0 (initial) puis renouvellements 1..n, lus dans le coffre WORM (append-only).
 * Si le jeton 0 manque au coffre, la colonne SQL `tsa_rfc3161_token_b64` sert de repli (jamais d'écriture ici).
 */
export async function loadTokenChain(vault: WormVaultDriver, batch: ArchivalMerkleBatchRow): Promise<readonly Uint8Array[]> {
  const chain: Uint8Array[] = [];
  const first = await vault.getObjectBytes(tokenObjectKey(batch.batchId, 0));
  const sqlFirst = decodeBatchToken(batch.tsaRfc3161TokenB64);
  if (first !== null && toBase64(first.bytes) !== toBase64(sqlFirst)) {
    throw new VaultMerkleError('LTA_CHAIN_UNREADABLE', 'le jeton initial du coffre diffère de celui de la base.');
  }
  chain.push(first === null ? sqlFirst : first.bytes);
  for (let index = 1; index < MAX_CHAIN_LENGTH; index += 1) {
    const next = await vault.getObjectBytes(tokenObjectKey(batch.batchId, index));
    if (next === null) break;
    chain.push(next.bytes);
  }
  return chain;
}

export interface RenewTimestampInput {
  readonly batch: ArchivalMerkleBatchRow;
  readonly timestampProvider: TimestampProvider;
  /** Plan de contrôle (`archival_merkle_batches`) et coffre WORM. */
  readonly adapter: FiscaInfrastructureAdapter;
  readonly retention: RetentionPolicy;
  /** Horloge injectée : instant ISO 8601 UTC. */
  readonly now: string;
  readonly genTimeToleranceSeconds?: number;
}

export interface RenewTimestampResult {
  readonly status: 'RENEWED' | 'RECONCILED';
  readonly tokenIndex: number;
  readonly batch: ArchivalMerkleBatchRow;
}

function invalid(detail: string): VaultMerkleError {
  return new VaultMerkleError('ANCHOR_TIMESTAMP_INVALID', detail);
}

/**
 * Ré-horodatage chaîné d'un lot : le condensé soumis à la TSA couvre l'ancien jeton ET la racine (renewalImprint). Le nouveau jeton
 * est AJOUTÉ au coffre (clé token-NNN, jamais écrasée) puis `last_lta_renewal_at` et `lta_renewal_token_b64` sont mis à jour ;
 * la chaîne complète reste lisible dans le coffre. Si un incident a laissé un jeton au coffre sans mise à jour SQL, la base est
 * simplement rattrapée (RECONCILED), sans nouvel appel à la TSA. L'appelant décide de l'opportunité via planLtaRenewal.
 * Limite : l'interface TimestampProvider ne produit que du SHA-256 ; le SHA-512 de l'ADR-07 n'est pas pris en charge ici.
 */
export async function renewTimestamp(input: RenewTimestampInput): Promise<RenewTimestampResult> {
  const nowMs = parseInstantMs(input.now, 'LTA_INVALID_INPUT');
  const tolerance = input.genTimeToleranceSeconds ?? DEFAULT_GENTIME_TOLERANCE_SECONDS;
  if (!Number.isSafeInteger(tolerance) || tolerance < 0) throw new VaultMerkleError('LTA_INVALID_INPUT', 'tolérance genTime : entier >= 0 attendu.');
  const db = input.adapter.getControlPlaneDb();
  const vault = input.adapter.getLegalVault();
  const current = await findBatchById(db, input.batch.batchId);
  if (current === undefined) throw new VaultMerkleError('LTA_BATCH_UNKNOWN', 'lot inconnu de archival_merkle_batches.');
  const root = fromHex(current.merkleRootSha256);
  const chain = await loadTokenChain(vault, current);
  const checks = await checkTimestampChain(chain, root);
  if (checks.some((check) => !check.ok)) throw new VaultMerkleError('LTA_CHAIN_UNREADABLE', 'la chaîne de jetons existante ne se vérifie pas : renouvellement refusé.');
  const last = chain[chain.length - 1] as Uint8Array;
  const lastGenIso = checks[checks.length - 1]?.genTimeIso as string;

  if (chain.length > 1 && current.ltaRenewalTokenB64 !== toBase64(last)) {
    const reconciled = await persistRenewal(db, current, lastGenIso, last);
    return { status: 'RECONCILED', tokenIndex: chain.length - 1, batch: reconciled };
  }

  const imprint = await renewalImprint(last, root);
  const token = await input.timestampProvider.timestamp(imprint);
  let genTime: Date;
  try {
    genTime = parseTimeStampToken(token, { expectedImprintSha256: imprint }).genTime;
  } catch (error) {
    if (error instanceof UblSignatureError) throw invalid(error.code === 'TIMESTAMP_IMPRINT_MISMATCH' ? 'le condensé du jeton de renouvellement ne couvre pas ancien jeton et racine.' : 'jeton de renouvellement illisible.');
    throw error;
  }
  const genMs = genTime.getTime();
  if (Math.abs(genMs - nowMs) > tolerance * 1000) throw invalid('genTime du jeton de renouvellement trop éloigné de l’horloge.');
  if (genMs < parseInstantMs(lastGenIso, 'LTA_INVALID_INPUT')) throw invalid('genTime du jeton de renouvellement antérieur au jeton précédent.');
  const genIso = formatInstant(genMs);
  const index = chain.length;
  await putWormIfAbsent(vault, tokenObjectKey(current.batchId, index), token, retentionUntilIso(genIso, input.retention), { 'fisca-format': 'merkle-lta-renewal-v1', 'fisca-hash-oid': SHA256_OID });
  const updated = await persistRenewal(db, current, genIso, token);
  return { status: 'RENEWED', tokenIndex: index, batch: updated };
}

async function persistRenewal(
  db: ReturnType<FiscaInfrastructureAdapter['getControlPlaneDb']>,
  batch: ArchivalMerkleBatchRow,
  genIso: string,
  token: Uint8Array,
): Promise<ArchivalMerkleBatchRow> {
  const tokenB64 = toBase64(token);
  await db.executeBatchAtomically([
    { sql: 'UPDATE archival_merkle_batches SET last_lta_renewal_at = ?, lta_renewal_token_b64 = ? WHERE batch_id = ?', params: [genIso, tokenB64, batch.batchId] },
  ]);
  return { ...batch, lastLtaRenewalAt: genIso, ltaRenewalTokenB64: tokenB64 };
}
