/**
 * Flux SSE de la boîte d'achats (CTR-API-22 GET /api/v1/purchases/stream, DRAFT).
 * `EventSource` est injectable (fabrique) : le navigateur ne pose ni Authorization ni X-Fisca-Company-Id, l'hôte fournit donc
 * `createFetchEventSource` (voir sse-fetch.ts) ou une fabrique de test. Reconnexion manuelle avec attente exponentielle bornée,
 * reprise par Last-Event-ID (dernier identifiant reçu), dédoublonnage par identifiant d'événement.
 */
export const PURCHASE_EVENT_TYPES = ['ingestion.queued', 'ocr.fields_extracted', 'cgi.cash_split_alert', 'pcge.account_proposed'] as const;
export type PurchaseEventType = (typeof PURCHASE_EVENT_TYPES)[number];

export interface SseEventLike {
  readonly data: string;
  readonly lastEventId: string;
}

export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: SseEventLike) => void): void;
  close(): void;
}

export interface EventSourceFactoryRequest {
  readonly url: string;
  /** Dernier identifiant d'événement reçu : à renvoyer dans l'en-tête Last-Event-ID. `null` à la première connexion. */
  readonly lastEventId: string | null;
}

export type EventSourceFactory = (request: EventSourceFactoryRequest) => EventSourceLike;
export type PurchaseStreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Valeurs de `readyState` de la spécification EventSource. */
const READY_CLOSED = 2;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;
const MAX_SEEN_IDS = 4096;

export interface PurchaseStreamOptions {
  readonly url: string;
  readonly factory: EventSourceFactory;
  readonly onEvent: (type: PurchaseEventType, data: unknown) => void;
  readonly onStatus?: (status: PurchaseStreamStatus) => void;
  /** Planificateur injectable ; retourne l'annulation. */
  readonly schedule?: (fn: () => void, ms: number) => () => void;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

export function connectPurchaseStream(options: PurchaseStreamOptions): { close(): void } {
  const schedule = options.schedule ?? defaultSchedule;
  const base = options.baseDelayMs ?? BASE_DELAY_MS;
  const cap = options.maxDelayMs ?? MAX_DELAY_MS;
  const seen = new Set<string>();
  let lastEventId: string | null = null;
  let attempt = 0;
  let closed = false;
  let source: EventSourceLike | null = null;
  let cancelTimer: (() => void) | null = null;

  const status = (s: PurchaseStreamStatus): void => options.onStatus?.(s);

  const remember = (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > MAX_SEEN_IDS) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  };

  const connect = (): void => {
    cancelTimer = null;
    status('connecting');
    const current = options.factory({ url: options.url, lastEventId });
    source = current;
    current.addEventListener('open', () => {
      if (closed || source !== current) return;
      attempt = 0;
      status('open');
    });
    for (const type of PURCHASE_EVENT_TYPES) {
      current.addEventListener(type, (event) => {
        if (closed || source !== current) return;
        if (event.lastEventId !== '') {
          const fresh = remember(event.lastEventId);
          lastEventId = event.lastEventId;
          if (!fresh) return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        options.onEvent(type, payload);
      });
    }
    current.addEventListener('error', () => {
      if (closed || source !== current) return;
      status('reconnecting');
      if (current.readyState !== READY_CLOSED || cancelTimer !== null) return;
      current.close();
      const delay = Math.min(cap, base * 2 ** attempt);
      attempt += 1;
      cancelTimer = schedule(() => {
        if (!closed) connect();
      }, delay);
    });
  };

  connect();

  return {
    close(): void {
      closed = true;
      cancelTimer?.();
      source?.close();
      status('closed');
    },
  };
}
