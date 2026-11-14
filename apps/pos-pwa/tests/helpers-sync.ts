import type { SyncBatchAck, SyncBatchPayload, SyncClock, SyncTransport } from '../src/sync/sync-types.ts';
import { SyncTransportError } from '../src/sync/sync-types.ts';
import type { ConnectivityTarget } from '../src/offline/connectivity.ts';

/** Serveur factice : UNIQUE par identifiant de ticket, continuité de chaîne par terminal (amorce de 64 zéros), mêmes règles que la spec. */
export class FakeSyncServer {
  readonly tickets = new Map<string, Record<string, unknown>>();
  readonly closures = new Map<string, Record<string, unknown>>();
  readonly calls: SyncBatchPayload[] = [];
  private readonly lastHash = new Map<string, string>();
  failNext: SyncTransportError | null = null;
  /** Applique le lot puis perd la réponse (réseau coupé après traitement serveur). */
  dropAckNext = false;
  readonly transport: SyncTransport = {
    sendBatch: async (payload): Promise<SyncBatchAck> => {
      this.calls.push(payload);
      if (this.failNext !== null) {
        const error = this.failNext;
        this.failNext = null;
        throw error;
      }
      const ackedTickets: string[] = [];
      const ackedClosures: string[] = [];
      const rejected: { id: string; kind: 'TICKET' | 'CLOSURE'; reason: string }[] = [];
      let broken = false;
      for (const t of payload.tickets) {
        const id = String(t['id']);
        if (broken) continue;
        if (this.tickets.has(id)) {
          ackedTickets.push(id);
          continue;
        }
        const terminal = String(t['terminal_id']);
        const expectedPrev = this.lastHash.get(terminal) ?? '0'.repeat(64);
        if (t['prev_ticket_sha256'] !== expectedPrev) {
          rejected.push({ id, kind: 'TICKET', reason: 'CHAIN_BREAK' });
          broken = true;
          continue;
        }
        this.tickets.set(id, t);
        this.lastHash.set(terminal, String(t['ticket_sha256']));
        ackedTickets.push(id);
      }
      for (const z of payload.closures) {
        const id = String(z['id']);
        if (!this.closures.has(id)) this.closures.set(id, z);
        ackedClosures.push(id);
      }
      if (this.dropAckNext) {
        this.dropAckNext = false;
        throw new SyncTransportError('NETWORK', 'accusé perdu');
      }
      return { acknowledgedTicketIds: ackedTickets, acknowledgedClosureIds: ackedClosures, rejected };
    },
  };
}

interface Timer {
  readonly id: number;
  readonly at: number;
  readonly fn: () => void;
  readonly every: number | null;
}

/** Horloge manuelle injectée : aucun vrai délai, aucun `setTimeout` global. */
export class FakeClock implements SyncClock {
  now = Date.parse('2026-11-14T08:00:00.000Z');
  readonly timers: Timer[] = [];
  readonly scheduledDelays: number[] = [];
  private seq = 0;
  nowMs = (): number => this.now;
  setTimeout = (fn: () => void, ms: number): unknown => {
    this.seq += 1;
    this.scheduledDelays.push(ms);
    this.timers.push({ id: this.seq, at: this.now + ms, fn, every: null });
    return this.seq;
  };
  clearTimeout = (handle: unknown): void => {
    const i = this.timers.findIndex((t) => t.id === handle);
    if (i >= 0) this.timers.splice(i, 1);
  };
  setInterval = (fn: () => void, ms: number): unknown => {
    this.seq += 1;
    this.timers.push({ id: this.seq, at: this.now + ms, fn, every: ms });
    return this.seq;
  };
  clearInterval = (handle: unknown): void => this.clearTimeout(handle);
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.now = due.at;
      if (due.every === null) this.timers.splice(this.timers.indexOf(due), 1);
      else this.timers[this.timers.indexOf(due)] = { ...due, at: due.at + due.every };
      due.fn();
    }
    this.now = target;
  }
  get pendingTimeouts(): number {
    return this.timers.filter((t) => t.every === null).length;
  }
}

export class FakeConnectivity implements ConnectivityTarget {
  online = true;
  private readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: 'online' | 'offline', listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: 'online' | 'offline', listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: 'online' | 'offline'): void {
    this.online = type === 'online';
    for (const l of this.listeners.get(type) ?? []) l();
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}
