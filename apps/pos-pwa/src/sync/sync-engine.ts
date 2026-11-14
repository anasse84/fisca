import { createConnectivityMonitor } from '../offline/connectivity.ts';
import type { ConnectivityTarget } from '../offline/connectivity.ts';
import { loadSyncSnapshot, markSynced, markTicketsSynced } from '../offline/sync-state.ts';
import type { PosStorage } from '../storage/ports.ts';
import { countPending, loadPendingBatch, markClosuresSynced } from './sync-queue.ts';
import { SyncTransportError } from './sync-types.ts';
import type { SyncClock, SyncErrorCode, SyncState, SyncStateSource, SyncTransport } from './sync-types.ts';

/**
 * Synchroniseur automatique : file locale → lots → `SyncTransport` (port injectable), reprise à la reconnexion (événement `online`)
 * et par intervalle, backoff exponentiel borné avec gigue injectable, idempotence (le serveur acquitte aussi les identifiants déjà
 * connus ; les marquages locaux ne s'appliquent qu'une fois), ordre de la chaîne respecté (un rejet arrête les maillons suivants).
 * Aucune donnée de réseau ni d'horloge n'est lue ailleurs que par les ports.
 */

export interface SyncConfig {
  readonly batchSize: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly intervalMs: number;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = { batchSize: 200, baseDelayMs: 2_000, maxDelayMs: 300_000, intervalMs: 60_000 };

/** Gigue : reçoit le plafond courant du délai (ms) et renvoie le délai effectif ; bornée à [0, plafond]. */
export type JitterFn = (capMs: number) => number;

export const fullJitter: JitterFn = (capMs) => Math.random() * capMs;

/** `base × 2^(tentative − 1)` plafonné à `maxDelayMs`, puis gigue bornée à [0, plafond]. `attempt` ≥ 1. */
export function backoffDelayMs(attempt: number, config: SyncConfig, jitter: JitterFn): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 30);
  const cap = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** exponent);
  return Math.min(cap, Math.max(0, Math.floor(jitter(cap))));
}

export interface SyncEngineOptions {
  readonly storage: PosStorage;
  readonly transport: SyncTransport;
  readonly clock: SyncClock;
  readonly isOnline: () => boolean;
  readonly connectivity?: ConnectivityTarget;
  readonly jitter?: JitterFn;
  readonly config?: Partial<SyncConfig>;
}

export class SyncEngine implements SyncStateSource {
  private readonly o: SyncEngineOptions;
  private readonly config: SyncConfig;
  private readonly jitter: JitterFn;
  private readonly listeners = new Set<() => void>();
  private state: SyncState = { status: 'SYNCED', pendingTickets: 0, pendingClosures: 0, lastSyncAtMs: null, errorCode: null, attempts: 0, nextRetryAtMs: null };
  private running: Promise<SyncState> | null = null;
  private retryHandle: unknown = null;
  private intervalHandle: unknown = null;
  private unsubscribeConnectivity: (() => void) | null = null;

  constructor(options: SyncEngineOptions) {
    this.o = options;
    this.config = { ...DEFAULT_SYNC_CONFIG, ...options.config };
    this.jitter = options.jitter ?? fullJitter;
  }

  getState(): SyncState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: Partial<SyncState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  /** Branche la reprise automatique : événement `online` (déclenche aussitôt, backoff remis à zéro) et intervalle. */
  start(): void {
    if (this.intervalHandle !== null) return;
    if (this.o.connectivity !== undefined) {
      let first = true;
      this.unsubscribeConnectivity = createConnectivityMonitor(this.o.connectivity, this.o.isOnline, (online) => {
        if (first) {
          first = false;
          return;
        }
        if (online) {
          this.set({ attempts: 0, nextRetryAtMs: null });
          this.clearRetry();
          void this.syncNow();
        }
      });
    }
    this.intervalHandle = this.o.clock.setInterval(() => void this.syncNow(), this.config.intervalMs);
    void this.syncNow();
  }

  stop(): void {
    this.unsubscribeConnectivity?.();
    this.unsubscribeConnectivity = null;
    if (this.intervalHandle !== null) this.o.clock.clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    this.clearRetry();
  }

  private clearRetry(): void {
    if (this.retryHandle !== null) this.o.clock.clearTimeout(this.retryHandle);
    this.retryHandle = null;
  }

  /** Un seul tour à la fois : un déclenchement pendant un tour en cours partage ce tour. */
  syncNow(): Promise<SyncState> {
    if (this.running !== null) return this.running;
    this.running = this.runOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async refreshCounts(): Promise<{ readonly tickets: number; readonly closures: number }> {
    const counts = await countPending(this.o.storage);
    const snapshot = await loadSyncSnapshot(this.o.storage);
    this.set({ pendingTickets: counts.tickets, pendingClosures: counts.closures, lastSyncAtMs: snapshot.lastSyncAtMs });
    return counts;
  }

  private async runOnce(): Promise<SyncState> {
    this.clearRetry();
    let counts = await this.refreshCounts();
    if (counts.tickets + counts.closures === 0) {
      this.set({ status: 'SYNCED', errorCode: null, attempts: 0, nextRetryAtMs: null });
      return this.state;
    }
    if (!this.o.isOnline()) {
      this.set({ status: 'PENDING' });
      return this.state;
    }
    this.set({ status: 'SYNCING', errorCode: null, nextRetryAtMs: null });
    try {
      while (counts.tickets + counts.closures > 0) {
        const batch = await loadPendingBatch(this.o.storage, this.config.batchSize);
        if (batch.tickets.length + batch.closures.length === 0) break;
        const ack = await this.o.transport.sendBatch(batch);
        const nowIso = new Date(this.o.clock.nowMs()).toISOString();
        const batchTickets = new Set(batch.tickets.map((t) => String(t['id'])));
        const batchClosures = new Set(batch.closures.map((c) => String(c['id'])));
        await markTicketsSynced(this.o.storage, ack.acknowledgedTicketIds.filter((id) => batchTickets.has(id)), nowIso);
        await markClosuresSynced(this.o.storage, ack.acknowledgedClosureIds.filter((id) => batchClosures.has(id)), nowIso);
        const progressed = ack.acknowledgedTicketIds.length + ack.acknowledgedClosureIds.length > 0;
        if (progressed) await markSynced(this.o.storage, nowIso);
        counts = await this.refreshCounts();
        if (ack.rejected.length > 0) return this.fail('REJECTED');
        if (!progressed) return this.fail('SERVER');
      }
    } catch (error) {
      return this.fail(error instanceof SyncTransportError ? error.code : 'NETWORK');
    }
    this.set({ status: 'SYNCED', errorCode: null, attempts: 0, nextRetryAtMs: null });
    return this.state;
  }

  private fail(code: SyncErrorCode): SyncState {
    const attempts = this.state.attempts + 1;
    const delay = backoffDelayMs(attempts, this.config, this.jitter);
    const nextRetryAtMs = this.o.clock.nowMs() + delay;
    this.set({ status: 'ERROR', errorCode: code, attempts, nextRetryAtMs });
    this.retryHandle = this.o.clock.setTimeout(() => {
      this.retryHandle = null;
      void this.syncNow();
    }, delay);
    return this.state;
  }
}
