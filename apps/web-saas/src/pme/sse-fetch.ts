import { createSseParser } from './sse-protocol.ts';
import type { EventSourceFactoryRequest, EventSourceLike, SseEventLike } from './purchase-stream.ts';

export type StreamFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface FetchEventSourceOptions {
  readonly fetch: StreamFetch;
  readonly getAccessToken: () => string | null;
  /** Fourni par l'hôte (jamais saisi par l'utilisateur) : [A-Za-z0-9_-]{1,64}. */
  readonly getCompanyId: () => string | null;
}

const COMPANY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const READY_CONNECTING = 0;
const READY_OPEN = 1;
const READY_CLOSED = 2;

/**
 * Fabrique d'EventSource à base de `fetch` : porte Authorization, X-Fisca-Company-Id et Last-Event-ID,
 * ce que l'EventSource natif ne sait pas faire. Toute fin de flux ou erreur ferme la source (readyState 2) :
 * `connectPurchaseStream` reconnecte alors avec le dernier identifiant reçu.
 */
export function createFetchEventSource(options: FetchEventSourceOptions): (request: EventSourceFactoryRequest) => EventSourceLike {
  return (request) => {
    const listeners = new Map<string, ((event: SseEventLike) => void)[]>();
    const controller = new AbortController();
    let readyState = READY_CONNECTING;
    const emit = (type: string, event: SseEventLike): void => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    };
    const fail = (): void => {
      if (readyState === READY_CLOSED && controller.signal.aborted) return;
      readyState = READY_CLOSED;
      emit('error', { data: '', lastEventId: '' });
    };
    const run = async (): Promise<void> => {
      const token = options.getAccessToken();
      const company = options.getCompanyId();
      if (token === null || token === '' || company === null || !COMPANY_ID_PATTERN.test(company)) {
        queueMicrotask(fail);
        return;
      }
      const headers: Record<string, string> = { Accept: 'text/event-stream', Authorization: `Bearer ${token}`, 'X-Fisca-Company-Id': company };
      if (request.lastEventId !== null) headers['Last-Event-ID'] = request.lastEventId;
      try {
        const response = await options.fetch(request.url, { method: 'GET', headers, cache: 'no-store', signal: controller.signal });
        if (!response.ok || response.body === null) {
          fail();
          return;
        }
        readyState = READY_OPEN;
        emit('open', { data: '', lastEventId: '' });
        const parser = createSseParser();
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const message of parser.feed(value)) emit(message.event, { data: message.data, lastEventId: message.id ?? '' });
        }
        fail();
      } catch {
        fail();
      }
    };
    queueMicrotask(() => {
      void run();
    });
    return {
      get readyState(): number {
        return readyState;
      },
      addEventListener(type, listener): void {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      close(): void {
        readyState = READY_CLOSED;
        controller.abort();
      },
    };
  };
}
