import type { FiscaInfrastructureAdapter, TenantSqlDriver, WormVaultDriver } from '@fisca/shared-types';
import { parseTimeStampToken, UblSignatureError, type TimestampProvider } from '@fisca/ubl-xades';
import { retentionUntilIso, type RetentionPolicy } from './aip.ts';
import { bytesEqual, concatBytes, fromBase64, fromHex, isSha256Hex, sha256Hex, SHA256_BYTES, toBase64, toHex, utf8Encode } from './bytes.ts';
import { canonicalJson } from './canonical-json.ts';
import { VaultMerkleError } from './errors.ts';
import { MS_PER_DAY, parseDayStartMs } from './time.ts';

/**
 * Ancrage quotidien RFC 3161 de la racine de Merkle (ADR-07, Doc_17 § 06 étape 4).
 *
 * Granularité : UNE racine par jour pour la plateforme (la table `archival_merkle_batches` du plan de contrôle porte
 * `batch_date TEXT NOT NULL UNIQUE` et aucune colonne de société ; les feuilles sont des empreintes d'AIP opaques de toutes les
 * sociétés, et la preuve d'une pièce n'expose que des hachages frères). `companyScope` est l'étiquette de portée du lot
 * (par exemple « platform ») : elle entre dans `batch_id` et dans les clés du coffre ; un second lot, de portée différente, pour
 * la même date est refusé (ANCHOR_SCOPE_CONFLICT) plutôt que de violer la contrainte UNIQUE.
 */

/** Valeur de `previous_batch_root_hash` du premier lot : 64 zéros hexadécimaux (colonne NOT NULL ; format non fixé par Doc_06). */
export const GENESIS_PREVIOUS_HASH = '0'.repeat(64);

/** Tolérance (secondes) sur genTime après la fin de la journée ancrée : le cron de 23:59 peut être servi après minuit. */
export const DEFAULT_GENTIME_TOLERANCE_SECONDS = 3600;

const SCOPE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface ArchivalMerkleBatchRow {
  readonly batchId: string;
  readonly batchDate: string;
  readonly leafCount: number;
  readonly previousBatchRootHash: string;
  readonly merkleRootSha256: string;
  readonly chainedRootSha256: string;
  readonly tsaRfc3161TokenB64: string;
  readonly lastLtaRenewalAt: string | null;
  readonly ltaRenewalTokenB64: string | null;
}

interface RawBatchRow {
  readonly batch_id: string;
  readonly batch_date: string;
  readonly leaf_count: number;
  readonly previous_batch_root_hash: string;
  readonly merkle_root_sha256: string;
  readonly chained_root_sha256: string;
  readonly tsa_rfc3161_token_b64: string;
  readonly last_lta_renewal_at: string | null;
  readonly lta_renewal_token_b64: string | null;
}

/** Colonnes réelles de `archival_merkle_batches` (CTR-SQL-18), dans l'ordre du DDL. */
export const ARCHIVAL_MERKLE_BATCH_COLUMNS = [
  'batch_id',
  'batch_date',
  'leaf_count',
  'previous_batch_root_hash',
  'merkle_root_sha256',
  'chained_root_sha256',
  'tsa_rfc3161_token_b64',
  'last_lta_renewal_at',
  'lta_renewal_token_b64',
] as const;

const SELECT_COLUMNS = ARCHIVAL_MERKLE_BATCH_COLUMNS.join(', ');

function toBatch(row: RawBatchRow): ArchivalMerkleBatchRow {
  return {
    batchId: row.batch_id,
    batchDate: row.batch_date,
    leafCount: row.leaf_count,
    previousBatchRootHash: row.previous_batch_root_hash,
    merkleRootSha256: row.merkle_root_sha256,
    chainedRootSha256: row.chained_root_sha256,
    tsaRfc3161TokenB64: row.tsa_rfc3161_token_b64,
    lastLtaRenewalAt: row.last_lta_renewal_at,
    ltaRenewalTokenB64: row.lta_renewal_token_b64,
  };
}

export async function listArchivalBatches(db: TenantSqlDriver): Promise<readonly ArchivalMerkleBatchRow[]> {
  // Sous-ensemble SQL portable (D1/SQLite, PostgreSQL, pilote mémoire) : pas d'ORDER BY, tri en TypeScript.
  const rows = await db.query<RawBatchRow>({ sql: `SELECT ${SELECT_COLUMNS} FROM archival_merkle_batches`, params: [] });
  return rows.map(toBatch).sort((left, right) => (left.batchDate < right.batchDate ? -1 : left.batchDate > right.batchDate ? 1 : 0));
}

export async function findBatchById(db: TenantSqlDriver, batchId: string): Promise<ArchivalMerkleBatchRow | undefined> {
  const rows = await db.query<RawBatchRow>({ sql: `SELECT ${SELECT_COLUMNS} FROM archival_merkle_batches WHERE batch_id = ?`, params: [batchId] });
  const row = rows[0];
  return row === undefined ? undefined : toBatch(row);
}

async function findBatchByDate(db: TenantSqlDriver, batchDate: string): Promise<ArchivalMerkleBatchRow | undefined> {
  const rows = await db.query<RawBatchRow>({ sql: `SELECT ${SELECT_COLUMNS} FROM archival_merkle_batches WHERE batch_date = ?`, params: [batchDate] });
  const row = rows[0];
  return row === undefined ? undefined : toBatch(row);
}

export function batchIdFor(date: string, companyScope: string): string {
  parseDayStartMs(date, 'ANCHOR_INVALID_INPUT');
  if (!SCOPE_PATTERN.test(companyScope)) throw new VaultMerkleError('ANCHOR_INVALID_INPUT', 'companyScope : identifiant opaque [A-Za-z0-9_-]{1,64} attendu.');
  return `merkle_${date.replaceAll('-', '')}_${companyScope}`;
}

/** Racine chaînée : SHA-256( condensé du lot précédent (32 octets) || racine du jour (32 octets) ), hexadécimal minuscule. */
export async function computeChainedRoot(previousBatchRootHash: string, rootHex: string): Promise<string> {
  return sha256Hex(concatBytes(fromHex(previousBatchRootHash), fromHex(rootHex)));
}

export function tokenObjectKey(batchId: string, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 999) throw new VaultMerkleError('LTA_INVALID_INPUT', 'indice de jeton hors de 0..999.');
  return `merkle/v1/${batchId}/token-${String(index).padStart(3, '0')}.tst`;
}

export function rootObjectKey(batchId: string): string {
  return `merkle/v1/${batchId}/root.json`;
}

/** Écrit un objet WORM si la clé est libre ; si elle existe avec les mêmes octets, ne fait rien (reprise après incident) ; sinon refuse. */
export async function putWormIfAbsent(
  vault: WormVaultDriver,
  key: string,
  bytes: Uint8Array,
  retentionUntil: string,
  metadata: Readonly<Record<string, string>>,
): Promise<'WRITTEN' | 'ALREADY_PRESENT'> {
  const existing = await vault.getObjectBytes(key);
  if (existing !== null) {
    if (!bytesEqual(existing.bytes, bytes)) throw new VaultMerkleError('ANCHOR_ROOT_CONFLICT', 'un objet différent existe déjà sous cette clé WORM.');
    return 'ALREADY_PRESENT';
  }
  await vault.putImmutableObject(key, bytes, { retentionUntilIso: retentionUntil, sha256Hex: await sha256Hex(bytes), customMetadata: metadata });
  return 'WRITTEN';
}

export interface AnchorDailyRootInput {
  /** Jour ancré, AAAA-MM-JJ (UTC). */
  readonly date: string;
  /** Étiquette de portée du lot, identifiant opaque. */
  readonly companyScope: string;
  /** Racine de Merkle du jour, 32 octets. */
  readonly root: Uint8Array;
  readonly leafCount: number;
  readonly timestampProvider: TimestampProvider;
  /** Plan de contrôle (`archival_merkle_batches`) et coffre WORM. */
  readonly adapter: FiscaInfrastructureAdapter;
  /** Durée de rétention des objets du lot, fournie par l'appelant (voir DEFAULT_RETENTION_DAYS). */
  readonly retention: RetentionPolicy;
  readonly genTimeToleranceSeconds?: number;
}

export interface AnchorResult {
  readonly status: 'ANCHORED' | 'ALREADY_ANCHORED';
  readonly batch: ArchivalMerkleBatchRow;
}

function invalidToken(detail: string): VaultMerkleError {
  return new VaultMerkleError('ANCHOR_TIMESTAMP_INVALID', detail);
}

/** Contrôle d'un jeton initial : structure, condensé SHA-256 == racine, genTime dans [début du jour, fin du jour + tolérance]. */
export function assertInitialToken(token: Uint8Array, root: Uint8Array, date: string, toleranceSeconds: number): string {
  let genTime: Date;
  try {
    genTime = parseTimeStampToken(token, { expectedImprintSha256: root }).genTime;
  } catch (error) {
    if (error instanceof UblSignatureError) throw invalidToken(error.code === 'TIMESTAMP_IMPRINT_MISMATCH' ? 'le condensé du jeton ne correspond pas à la racine.' : 'jeton RFC 3161 illisible.');
    throw error;
  }
  const dayStart = parseDayStartMs(date, 'ANCHOR_INVALID_INPUT');
  const genMs = genTime.getTime();
  if (genMs < dayStart || genMs > dayStart + MS_PER_DAY + toleranceSeconds * 1000) throw invalidToken('genTime du jeton hors de la fenêtre du jour ancré.');
  return `${genTime.toISOString().slice(0, 19)}Z`;
}

/**
 * Ancre la racine du jour : jeton RFC 3161 sur la racine (SHA-256), jeton et racine écrits au coffre WORM, ligne inscrite dans
 * `archival_merkle_batches`. Idempotent : le même jour, avec la même racine, ne crée aucun second lot et n'appelle pas la TSA ;
 * un jeton déjà au coffre (incident entre coffre et SQL) est réutilisé au lieu d'être redemandé.
 */
export async function anchorDailyRoot(input: AnchorDailyRootInput): Promise<AnchorResult> {
  const batchId = batchIdFor(input.date, input.companyScope);
  if (input.root.length !== SHA256_BYTES) throw new VaultMerkleError('ANCHOR_INVALID_INPUT', 'la racine doit faire 32 octets.');
  if (!Number.isSafeInteger(input.leafCount) || input.leafCount < 1) throw new VaultMerkleError('ANCHOR_INVALID_INPUT', 'leafCount : entier >= 1 attendu (CHECK leaf_count > 0).');
  const tolerance = input.genTimeToleranceSeconds ?? DEFAULT_GENTIME_TOLERANCE_SECONDS;
  if (!Number.isSafeInteger(tolerance) || tolerance < 0) throw new VaultMerkleError('ANCHOR_INVALID_INPUT', 'tolérance genTime : entier >= 0 attendu.');
  const rootHex = toHex(input.root);
  const db = input.adapter.getControlPlaneDb();
  const vault = input.adapter.getLegalVault();

  const sameDay = await findBatchByDate(db, input.date);
  if (sameDay !== undefined) return reuse(sameDay, batchId, rootHex);
  const existingBatches = await db.query<{ readonly batch_date: string; readonly chained_root_sha256: string }>({
    sql: 'SELECT batch_date, chained_root_sha256 FROM archival_merkle_batches',
    params: [],
  });
  if (existingBatches.some((row) => row.batch_date > input.date)) throw new VaultMerkleError('ANCHOR_INVALID_INPUT', 'un lot postérieur existe déjà : la chaîne des racines est append-only.');

  const tokenKey = tokenObjectKey(batchId, 0);
  const stored = await vault.getObjectBytes(tokenKey);
  const token = stored !== null ? stored.bytes : await input.timestampProvider.timestamp(input.root);
  const genTimeIso = assertInitialToken(token, input.root, input.date, tolerance);
  const until = retentionUntilIso(genTimeIso, input.retention);
  const metadata = { 'fisca-format': 'merkle-anchor-v1' };
  const rootDocument = utf8Encode(canonicalJson({ batchId, date: input.date, leafCount: input.leafCount, rootHex }));
  await putWormIfAbsent(vault, rootObjectKey(batchId), rootDocument, until, metadata);
  await putWormIfAbsent(vault, tokenKey, token, until, metadata);

  const previous = existingBatches.filter((row) => row.batch_date < input.date).sort((left, right) => (left.batch_date < right.batch_date ? 1 : -1))[0];
  const previousHash = previous?.chained_root_sha256 ?? GENESIS_PREVIOUS_HASH;
  if (!isSha256Hex(previousHash)) throw new VaultMerkleError('ANCHOR_INVALID_INPUT', 'condensé du lot précédent illisible.');
  const chained = await computeChainedRoot(previousHash, rootHex);
  const batch: ArchivalMerkleBatchRow = {
    batchId,
    batchDate: input.date,
    leafCount: input.leafCount,
    previousBatchRootHash: previousHash,
    merkleRootSha256: rootHex,
    chainedRootSha256: chained,
    tsaRfc3161TokenB64: toBase64(token),
    lastLtaRenewalAt: null,
    ltaRenewalTokenB64: null,
  };
  try {
    await db.executeBatchAtomically([
      {
        sql: `INSERT INTO archival_merkle_batches (batch_id, batch_date, leaf_count, previous_batch_root_hash, merkle_root_sha256, chained_root_sha256, tsa_rfc3161_token_b64) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [batch.batchId, batch.batchDate, batch.leafCount, batch.previousBatchRootHash, batch.merkleRootSha256, batch.chainedRootSha256, batch.tsaRfc3161TokenB64],
      },
    ]);
  } catch (error) {
    const raced = await findBatchByDate(db, input.date);
    if (raced === undefined) throw error;
    return reuse(raced, batchId, rootHex);
  }
  return { status: 'ANCHORED', batch };
}

function reuse(existing: ArchivalMerkleBatchRow, batchId: string, rootHex: string): AnchorResult {
  if (existing.batchId !== batchId) throw new VaultMerkleError('ANCHOR_SCOPE_CONFLICT', 'un lot d’une autre portée existe déjà pour cette date (une racine par jour).');
  if (existing.merkleRootSha256 !== rootHex) throw new VaultMerkleError('ANCHOR_ROOT_CONFLICT', 'un lot de ce jour existe avec une racine différente.');
  return { status: 'ALREADY_ANCHORED', batch: existing };
}

export function decodeBatchToken(tokenB64: string): Uint8Array {
  try {
    return fromBase64(tokenB64);
  } catch {
    throw new VaultMerkleError('LTA_CHAIN_UNREADABLE', 'jeton base64 illisible.');
  }
}

