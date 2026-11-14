import type { SqlRow } from '../storage/ports.ts';

/**
 * Contrats du synchroniseur de la caisse. La route cible est CTR-API-16 `POST /api/v1/pos/sync-batch` (DRAFT, certificat terminal
 * + signature ECDSA P-256). Aucun code serveur n'existe encore dans `apps/api-hono` : le corps exact reste à fixer côté serveur.
 * Ces types décrivent donc le CONTRAT CLIENT du port `SyncTransport` (lignes locales telles qu'en base, noms de colonnes du DDL),
 * sans prétendre à un format HTTP. L'adaptateur réseau se branchera derrière ce port quand la route sera écrite.
 */

/** Ligne `pos_tickets` telle que stockée (colonnes du DDL serveur, centimes entiers, empreintes, signature). */
export type SyncTicketRecord = SqlRow;
/** Ligne `pos_z_closures` + `ecdsa_signature_b64` du scellé `pos_z_seals`. */
export type SyncClosureRecord = SqlRow;

export interface SyncBatchPayload {
  /** Dans l'ordre de la chaîne (rowid croissant) ; au plus `batchSize` tickets (200 d'après Doc_07 § 03). */
  readonly tickets: readonly SyncTicketRecord[];
  readonly closures: readonly SyncClosureRecord[];
}

export interface SyncRejection {
  readonly id: string;
  readonly kind: 'TICKET' | 'CLOSURE';
  readonly reason: string;
}

export interface SyncBatchAck {
  /** Identifiants acquittés, y compris ceux déjà connus du serveur (rejeu idempotent, UNIQUE sur l'identifiant du ticket). */
  readonly acknowledgedTicketIds: readonly string[];
  readonly acknowledgedClosureIds: readonly string[];
  readonly rejected: readonly SyncRejection[];
}

export interface SyncTransport {
  sendBatch(payload: SyncBatchPayload): Promise<SyncBatchAck>;
}

export type SyncErrorCode = 'NETWORK' | 'SERVER' | 'REJECTED';

export class SyncTransportError extends Error {
  readonly code: Exclude<SyncErrorCode, 'REJECTED'>;
  constructor(code: Exclude<SyncErrorCode, 'REJECTED'>, message: string) {
    super(message);
    this.name = 'SyncTransportError';
    this.code = code;
  }
}

/** Horloge et minuteries injectables : aucun `Date.now` ni `setTimeout` global dans le moteur. */
export interface SyncClock {
  nowMs(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export type SyncStatus = 'PENDING' | 'SYNCING' | 'ERROR' | 'SYNCED';

export interface SyncState {
  readonly status: SyncStatus;
  readonly pendingTickets: number;
  readonly pendingClosures: number;
  readonly lastSyncAtMs: number | null;
  readonly errorCode: SyncErrorCode | null;
  /** Tentatives consécutives en échec (0 après un succès). */
  readonly attempts: number;
  readonly nextRetryAtMs: number | null;
}

export interface SyncStateSource {
  getState(): SyncState;
  subscribe(listener: () => void): () => void;
  syncNow(): Promise<SyncState>;
}
