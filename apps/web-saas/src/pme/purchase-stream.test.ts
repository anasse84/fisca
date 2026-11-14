import { describe, expect, it } from 'vitest';
import { connectPurchaseStream } from './purchase-stream.ts';
import type { EventSourceFactoryRequest, EventSourceLike, PurchaseStreamStatus } from './purchase-stream.ts';

class FakeSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  readonly listeners = new Map<string, ((e: { data: string; lastEventId: string }) => void)[]>();
  constructor(readonly request: EventSourceFactoryRequest) {}
  addEventListener(type: string, listener: (e: { data: string; lastEventId: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data: unknown, id: string): void {
    for (const l of this.listeners.get(type) ?? []) l({ data: JSON.stringify(data), lastEventId: id });
  }
  open(): void {
    this.readyState = 1;
    for (const l of this.listeners.get('open') ?? []) l({ data: '', lastEventId: '' });
  }
  fail(readyState: number): void {
    this.readyState = readyState;
    for (const l of this.listeners.get('error') ?? []) l({ data: '', lastEventId: '' });
  }
}

function harness() {
  const sources: FakeSource[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const events: { type: string; data: unknown }[] = [];
  const statuses: PurchaseStreamStatus[] = [];
  const handle = connectPurchaseStream({
    url: '/api/v1/purchases/stream',
    factory: (request) => {
      const s = new FakeSource(request);
      sources.push(s);
      return s;
    },
    onEvent: (type, data) => events.push({ type, data }),
    onStatus: (s) => statuses.push(s),
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
  });
  return { sources, timers, events, statuses, handle };
}

describe('flux SSE des achats : reconnexion, reprise, dédoublonnage', () => {
  it('écoute exactement les quatre types d’événements du registre', () => {
    const h = harness();
    expect([...(h.sources[0]?.listeners.keys() ?? [])].filter((k) => k.includes('.')).sort()).toEqual([
      'cgi.cash_split_alert',
      'ingestion.queued',
      'ocr.fields_extracted',
      'pcge.account_proposed',
    ]);
  });
  it('première connexion sans Last-Event-ID ; statut open à l’ouverture', () => {
    const h = harness();
    expect(h.sources[0]?.request).toEqual({ url: '/api/v1/purchases/stream', lastEventId: null });
    h.sources[0]?.open();
    expect(h.statuses).toEqual(['connecting', 'open']);
  });
  it('reconnexion après fermeture : nouvelle source reprise au dernier identifiant reçu, attente exponentielle bornée', () => {
    const h = harness();
    h.sources[0]?.open();
    h.sources[0]?.emit('ingestion.queued', { rowId: 'a' }, 'e-1');
    h.sources[0]?.emit('ingestion.queued', { rowId: 'b' }, 'e-2');
    h.sources[0]?.fail(2);
    expect(h.statuses.at(-1)).toBe('reconnecting');
    expect(h.timers).toHaveLength(1);
    const first = h.timers[0];
    first?.fn();
    expect(h.sources).toHaveLength(2);
    expect(h.sources[1]?.request.lastEventId).toBe('e-2');
    h.sources[1]?.fail(2);
    h.sources[1]?.fail(2);
    const delays = h.timers.map((t) => t.ms);
    expect(delays[1]).toBeGreaterThan(delays[0] ?? 0);
    for (let i = 0; i < 20; i += 1) {
      const last = h.timers.at(-1);
      last?.fn();
      h.sources.at(-1)?.fail(2);
    }
    expect(Math.max(...h.timers.map((t) => t.ms))).toBeLessThanOrEqual(30_000);
  });
  it('l’attente repart du début après une connexion réussie', () => {
    const h = harness();
    h.sources[0]?.fail(2);
    h.timers[0]?.fn();
    h.sources[1]?.fail(2);
    h.timers[1]?.fn();
    h.sources[2]?.open();
    h.sources[2]?.fail(2);
    expect(h.timers.at(-1)?.ms).toBe(h.timers[0]?.ms);
  });
  it('déduplique par identifiant d’événement (rejeu après reprise)', () => {
    const h = harness();
    h.sources[0]?.emit('ingestion.queued', { rowId: 'a' }, 'e-1');
    h.sources[0]?.emit('ingestion.queued', { rowId: 'a' }, 'e-1');
    h.sources[0]?.fail(2);
    h.timers[0]?.fn();
    h.sources[1]?.emit('ingestion.queued', { rowId: 'a' }, 'e-1');
    h.sources[1]?.emit('ocr.fields_extracted', { rowId: 'a' }, 'e-3');
    expect(h.events.map((e) => e.type)).toEqual(['ingestion.queued', 'ocr.fields_extracted']);
  });
  it('erreur pendant que le navigateur se reconnecte seul (readyState 0) : pas de seconde source', () => {
    const h = harness();
    h.sources[0]?.fail(0);
    expect(h.timers).toHaveLength(0);
    expect(h.sources).toHaveLength(1);
  });
  it('close() ferme la source, annule le minuteur et interdit toute reconnexion', () => {
    const h = harness();
    h.sources[0]?.fail(2);
    h.handle.close();
    expect(h.timers[0]?.cancelled).toBe(true);
    expect(h.statuses.at(-1)).toBe('closed');
    h.timers[0]?.fn();
    expect(h.sources).toHaveLength(1);
    h.sources[0]?.emit('ingestion.queued', { rowId: 'z' }, 'e-9');
    expect(h.events).toHaveLength(0);
  });
  it('une charge utile qui n’est pas du JSON est ignorée sans lever', () => {
    const h = harness();
    for (const l of h.sources[0]?.listeners.get('ingestion.queued') ?? []) l({ data: '{pas json', lastEventId: 'e-5' });
    expect(h.events).toHaveLength(0);
  });
});
