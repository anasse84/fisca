import { describe, expect, it } from 'vitest';
import {
  CACHED_AT_HEADER,
  SW_CACHE_PREFIX,
  buildCacheNames,
  decideCacheStrategy,
  isCacheEntryExpired,
  isCacheableResponse,
  planCacheCleanup,
} from '../src/sw/cache-policy.ts';
import type { PolicyContext, RequestFacts } from '../src/sw/cache-policy.ts';
import { OFFLINE_WINDOW_MS } from '../src/offline/offline-window.ts';

const ctx: PolicyContext = {
  origin: 'https://pos.fisca.ma',
  precachePaths: new Set(['/', '/index.html', '/assets/app.js']),
};
const req = (over: Partial<RequestFacts>): RequestFacts => ({
  method: 'GET',
  url: 'https://pos.fisca.ma/assets/app.js',
  mode: 'no-cors',
  destination: 'script',
  ...over,
});

describe('décision de cache', () => {
  it('ressource précachée : cache d’abord', () => {
    expect(decideCacheStrategy(req({}), ctx)).toBe('CACHE_FIRST_PRECACHE');
  });
  it('navigation : réseau d’abord avec repli sur la coquille', () => {
    expect(decideCacheStrategy(req({ url: 'https://pos.fisca.ma/ventes', mode: 'navigate', destination: 'document' }), ctx)).toBe(
      'NETWORK_FIRST_NAVIGATION',
    );
  });
  it('ressource statique non précachée : stale-while-revalidate (dont .wasm)', () => {
    expect(decideCacheStrategy(req({ url: 'https://pos.fisca.ma/assets/x.css', destination: 'style' }), ctx)).toBe('STALE_WHILE_REVALIDATE');
    expect(decideCacheStrategy(req({ url: 'https://pos.fisca.ma/sqlite3.wasm', destination: '' }), ctx)).toBe('STALE_WHILE_REVALIDATE');
  });
  it('API, écritures et autres origines : jamais mis en cache', () => {
    expect(decideCacheStrategy(req({ url: 'https://pos.fisca.ma/api/v1/pos/sync-batch', destination: '' }), ctx)).toBe('NETWORK_ONLY');
    expect(decideCacheStrategy(req({ method: 'POST' }), ctx)).toBe('NETWORK_ONLY');
    expect(decideCacheStrategy(req({ url: 'https://autre.example/assets/app.js' }), ctx)).toBe('NETWORK_ONLY');
    expect(decideCacheStrategy(req({ url: 'https://pos.fisca.ma/donnees.json', destination: '' }), ctx)).toBe('NETWORK_ONLY');
  });
});

describe('expiration à 72 h', () => {
  const now = Date.parse('2026-11-14T08:00:00.000Z');
  it('entrée valide jusqu’à 72 h incluses, expirée au-delà', () => {
    expect(isCacheEntryExpired(now - OFFLINE_WINDOW_MS, now)).toBe(false);
    expect(isCacheEntryExpired(now - OFFLINE_WINDOW_MS - 1, now)).toBe(true);
  });
  it('horodatage absent ou illisible : expirée', () => {
    expect(isCacheEntryExpired(null, now)).toBe(true);
    expect(isCacheEntryExpired(Number.NaN, now)).toBe(true);
  });
  it('horodatage dans le futur : non expirée', () => {
    expect(isCacheEntryExpired(now + 1000, now)).toBe(false);
  });
  it('nom d’en-tête stable', () => {
    expect(CACHED_AT_HEADER).toBe('x-fisca-cached-at');
  });
});

describe('versions de cache', () => {
  it('nomme les caches par version', () => {
    expect(buildCacheNames('7')).toEqual({ precache: `${SW_CACHE_PREFIX}-precache-v7`, runtime: `${SW_CACHE_PREFIX}-runtime-v7` });
  });
  it('supprime les caches Fisca d’autres versions, jamais ceux d’autrui', () => {
    const names = ['fisca-pos-precache-v6', 'fisca-pos-runtime-v6', 'fisca-pos-precache-v7', 'fisca-pos-runtime-v7', 'autre-cache', 'fisca-web-v1'];
    expect(planCacheCleanup(names, '7')).toEqual(['fisca-pos-precache-v6', 'fisca-pos-runtime-v6']);
  });
  it('ne met en cache que les réponses 200 de même origine', () => {
    expect(isCacheableResponse(200, 'basic')).toBe(true);
    expect(isCacheableResponse(200, 'cors')).toBe(false);
    expect(isCacheableResponse(404, 'basic')).toBe(false);
    expect(isCacheableResponse(0, 'opaque')).toBe(false);
  });
});
