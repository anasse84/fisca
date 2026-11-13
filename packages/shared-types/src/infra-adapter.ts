/**
 * Contrat FiscaInfrastructureAdapter (Doc_04 § 10, ADR-12, ERRATA D-07 : fichier infra-adapter.ts,
 * appelé StorageAdapter dans Doc_04). Tout accès D1/R2/Queues ou PostgreSQL/MinIO/BullMQ du code
 * métier passe par cette interface.
 */

export type InfrastructureProviderMode = 'CLOUDFLARE_EDGE' | 'SOVEREIGN_MOROCCO_VPS';

export const INFRASTRUCTURE_PROVIDER_MODES: readonly InfrastructureProviderMode[] = [
  'CLOUDFLARE_EDGE',
  'SOVEREIGN_MOROCCO_VPS',
];

/** ERRATA D-08 : files Cloudflare ; chacune a sa file d'erreurs `dlq-fisca-<nom>`. */
export const FISCA_QUEUE_NAMES = [
  'fisca-invoice-ingestion',
  'fisca-xhub-clearance',
  'fisca-erp-sync-outbound',
  'fisca-sovereign-mirror',
  'fisca-notifications',
] as const;
export type FiscaQueueName = (typeof FISCA_QUEUE_NAMES)[number];
export type FiscaDeadLetterQueueName = `dlq-${FiscaQueueName}`;

export const FISCA_DEAD_LETTER_QUEUE_NAMES: readonly FiscaDeadLetterQueueName[] = FISCA_QUEUE_NAMES.map(
  (name): FiscaDeadLetterQueueName => `dlq-${name}`,
);

export function isKnownQueueName(name: string): name is FiscaQueueName | FiscaDeadLetterQueueName {
  return (
    (FISCA_QUEUE_NAMES as readonly string[]).includes(name) ||
    (FISCA_DEAD_LETTER_QUEUE_NAMES as readonly string[]).includes(name)
  );
}

export type InfrastructureErrorCode =
  | 'INFRA_INVALID_COMPANY_ID'
  | 'INFRA_TENANT_NOT_FOUND'
  | 'INFRA_SQL_REJECTED'
  | 'INFRA_SQL_UNSUPPORTED'
  | 'INFRA_BATCH_ROLLED_BACK'
  | 'INFRA_INVALID_OBJECT_KEY'
  | 'INFRA_VAULT_IMMUTABLE'
  | 'INFRA_VAULT_HASH_MISMATCH'
  | 'INFRA_VAULT_INVALID_RETENTION'
  | 'INFRA_UNKNOWN_QUEUE'
  | 'INFRA_INVALID_QUEUE_ARGUMENT'
  | 'INFRA_MIRROR_INVALID_DELTA'
  | 'INFRA_MIRROR_SEQUENCE_REJECTED'
  | 'INFRA_ADAPTER_NOT_FOR_PRODUCTION';

/** Erreur typée de l'adaptateur : le message commence par le code. */
export class InfrastructureError extends Error {
  readonly code: InfrastructureErrorCode;

  constructor(code: InfrastructureErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'InfrastructureError';
    this.code = code;
  }
}

export type SqlParam = string | number | null;

export interface SqlStatementParams {
  readonly sql: string;
  readonly params: readonly SqlParam[];
}

export interface BatchResult {
  readonly totalChanges: number;
}

export interface TenantSqlDriver {
  /** `companyId` pour une base société, `control-plane` pour le plan de contrôle. */
  readonly tenantId: string;
  query<TRow>(stmt: SqlStatementParams): Promise<readonly TRow[]>;
  /** Tout ou rien : si une instruction échoue, aucune n'est appliquée. */
  executeBatchAtomically(statements: readonly SqlStatementParams[]): Promise<BatchResult>;
}

export interface WormPutOptions {
  /** Ex. : clôture + 10 ans + 1 jour (art. 211 CGI). Instant ISO 8601 UTC. */
  readonly retentionUntilIso: string;
  readonly sha256Hex: string;
  readonly customMetadata: Readonly<Record<string, string>>;
}

export interface WormObject {
  readonly bytes: Uint8Array;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface WormVaultDriver {
  /** R2 : jurisdiction=eu (Doc_04 § 10) ; MinIO WORM au Maroc en mode souverain. */
  readonly jurisdiction: 'eu' | 'ma';
  putImmutableObject(key: string, ciphertext: Uint8Array, options: WormPutOptions): Promise<{ readonly etag: string }>;
  getObjectBytes(key: string): Promise<WormObject | null>;
}

export interface AsyncQueueDriver {
  /** Au plus un message par couple (file, clé d'idempotence). */
  enqueueIdempotent<TPayload>(
    queueName: string,
    idempotencyKey: string,
    payload: TPayload,
    delaySeconds?: number,
  ): Promise<void>;
}

/** Enveloppe de réplication poussée vers le miroir souverain et rejouée au Failback (Doc_04 § 10). */
export interface SignedReplicationDelta {
  readonly deltaId: string;
  readonly companyId: string;
  readonly sequenceMonotonic: number;
  readonly originProvider: InfrastructureProviderMode;
  readonly sqlBatchEncryptedB64: string;
  readonly r2AipKeysAdded: readonly string[];
  readonly latestJournalHashes: Readonly<Record<string, string>>;
  readonly hmacSignatureHex: string;
}

/**
 * Miroir souverain. Ajout à l'interface de Doc_04 § 10, qui décrit le flux (copie signée asynchrone,
 * rejeu au Failback) sans en donner la signature : à valider par le propriétaire.
 */
export interface SovereignMirrorDriver {
  /** Refuse toute séquence non strictement croissante pour la société. */
  pushDelta(delta: SignedReplicationDelta): Promise<{ readonly acceptedSequence: number }>;
  /** Deltas de la société avec une séquence strictement supérieure à `afterSequence`, par ordre croissant. */
  readDeltasAfter(companyId: string, afterSequence: number): Promise<readonly SignedReplicationDelta[]>;
}

export interface FiscaInfrastructureAdapter {
  readonly providerMode: InfrastructureProviderMode;
  getControlPlaneDb(): TenantSqlDriver;
  /** La base est résolue côté serveur après authentification (D-16) ; une société inconnue est refusée. */
  getTenantDb(companyId: string): Promise<TenantSqlDriver>;
  getLegalVault(): WormVaultDriver;
  getQueue(): AsyncQueueDriver;
  getSovereignMirror(): SovereignMirrorDriver;
}

const COMPANY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const CONTROL_PLANE_TENANT_ID = 'control-plane';

export function assertValidCompanyId(companyId: string): void {
  if (companyId === CONTROL_PLANE_TENANT_ID || !COMPANY_ID_PATTERN.test(companyId)) {
    throw new InfrastructureError(
      'INFRA_INVALID_COMPANY_ID',
      'companyId doit contenir 1 à 64 caractères parmi A-Z a-z 0-9 _ - (control-plane est réservé).',
    );
  }
}

export function assertValidObjectKey(key: string): void {
  if (key.length === 0 || key.length > 1024 || key.startsWith('/') || key.split('/').some((p) => p === '..' || p === '')) {
    throw new InfrastructureError(
      'INFRA_INVALID_OBJECT_KEY',
      `clé d'objet invalide (non vide, sans « / » initial, sans segment vide ni « .. ») : ${key}`,
    );
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const HMAC_HEX = /^[0-9a-f]{64}$/;

export function assertValidReplicationDelta(delta: SignedReplicationDelta): void {
  const bad = (detail: string): never => {
    throw new InfrastructureError('INFRA_MIRROR_INVALID_DELTA', `[${delta.deltaId}] ${detail}`);
  };
  if (delta.deltaId.trim().length === 0) bad('deltaId vide');
  assertValidCompanyId(delta.companyId);
  if (!Number.isSafeInteger(delta.sequenceMonotonic) || delta.sequenceMonotonic < 1) {
    bad('sequenceMonotonic doit être un entier sûr >= 1');
  }
  if (!INFRASTRUCTURE_PROVIDER_MODES.includes(delta.originProvider)) bad('originProvider inconnu');
  if (!HMAC_HEX.test(delta.hmacSignatureHex)) bad('hmacSignatureHex doit être 64 caractères hexadécimaux minuscules');
  for (const hash of Object.values(delta.latestJournalHashes)) {
    if (!SHA256_HEX.test(hash)) bad('latestJournalHashes ne contient que des SHA-256 hexadécimaux minuscules');
  }
}

/** SHA-256 hexadécimal via WebCrypto (Workers et Node), sans dépendance. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis as unknown as { readonly crypto: { readonly subtle: SubtleDigest } }).crypto.subtle;
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

interface SubtleDigest {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}
