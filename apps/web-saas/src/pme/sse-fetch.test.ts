import { describe, expect, it } from 'vitest';
import { createFetchEventSource } from './sse-fetch.ts';
import type { SseEventLike } from './purchase-stream.ts';

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('EventSource à base de fetch (en-têtes que l’EventSource natif ne porte pas)', () => {
  it('pose Authorization, X-Fisca-Company-Id et Last-Event-ID, puis restitue les événements typés', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const factory = createFetchEventSource({
      fetch: async (url, init) => {
        seen.push({ url, headers: init.headers as Record<string, string> });
        return streamOf(['id: 5\nevent: ingestion.queued\ndata: {"rowId":"a","sourceLabel":"x"}\n\n', 'id: 6\nevent: ocr.fields_extracted\nda', 'ta: {"rowId":"a"}\n\n']);
      },
      getAccessToken: () => 'jwt',
      getCompanyId: () => 'dossier_1',
    });
    const source = factory({ url: '/api/v1/purchases/stream', lastEventId: 'e-4' });
    const got: [string, SseEventLike][] = [];
    for (const type of ['open', 'error', 'ingestion.queued', 'ocr.fields_extracted']) source.addEventListener(type, (e) => got.push([type, e]));
    await settle();
    expect(seen[0]?.url).toBe('/api/v1/purchases/stream');
    expect(seen[0]?.headers).toMatchObject({ Authorization: 'Bearer jwt', 'X-Fisca-Company-Id': 'dossier_1', 'Last-Event-ID': 'e-4', Accept: 'text/event-stream' });
    expect(got.map(([t, e]) => `${t}:${e.lastEventId}`)).toEqual(['open:', 'ingestion.queued:5', 'ocr.fields_extracted:6', 'error:']);
    expect(source.readyState).toBe(2);
  });
  it('première connexion : pas d’en-tête Last-Event-ID', async () => {
    let headers: Record<string, string> = {};
    const factory = createFetchEventSource({
      fetch: async (_url, init) => {
        headers = init.headers as Record<string, string>;
        return streamOf([]);
      },
      getAccessToken: () => 'jwt',
      getCompanyId: () => 'd',
    });
    factory({ url: '/s', lastEventId: null });
    await settle();
    expect(headers['Last-Event-ID']).toBeUndefined();
  });
  it('jeton absent ou dossier hors [A-Za-z0-9_-]{1,64} : aucune requête, erreur immédiate (readyState 2)', async () => {
    let calls = 0;
    for (const [token, company] of [[null, 'd'], ['jwt', null], ['jwt', 'a b'], ['jwt', 'x'.repeat(65)]] as const) {
      const factory = createFetchEventSource({
        fetch: async () => {
          calls += 1;
          return streamOf([]);
        },
        getAccessToken: () => token,
        getCompanyId: () => company,
      });
      const source = factory({ url: '/s', lastEventId: null });
      let errored = false;
      source.addEventListener('error', () => (errored = true));
      await settle();
      expect(errored).toBe(true);
      expect(source.readyState).toBe(2);
    }
    expect(calls).toBe(0);
  });
  it('réponse non 2xx ou panne réseau : erreur et fermeture', async () => {
    for (const run of [async () => new Response('', { status: 503 }), async () => Promise.reject(new Error('coupé'))]) {
      const source = createFetchEventSource({ fetch: run, getAccessToken: () => 'jwt', getCompanyId: () => 'd' })({ url: '/s', lastEventId: null });
      let errored = false;
      source.addEventListener('error', () => (errored = true));
      await settle();
      expect(errored).toBe(true);
      expect(source.readyState).toBe(2);
    }
  });
  it('close() interrompt la requête sans signaler d’erreur', async () => {
    let signal: AbortSignal | undefined;
    const source = createFetchEventSource({
      fetch: (_url, init) => {
        signal = init.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('abort'))));
      },
      getAccessToken: () => 'jwt',
      getCompanyId: () => 'd',
    })({ url: '/s', lastEventId: null });
    let errored = false;
    source.addEventListener('error', () => (errored = true));
    await settle();
    source.close();
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(errored).toBe(false);
  });
});
