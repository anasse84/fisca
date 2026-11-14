import { describe, expect, it } from 'vitest';
import { FakeCacheStorage } from './helpers-fake-caches.ts';
import { OFFLINE_WINDOW_MS } from '../src/offline/offline-window.ts';
import { CACHED_AT_HEADER, buildCacheNames } from '../src/sw/cache-policy.ts';
import { handleActivate, handleFetch, handleInstall, installServiceWorker } from '../src/sw/sw-runtime.ts';
import type { SwDeps, SwListener, SwScope } from '../src/sw/sw-runtime.ts';

const NOW = Date.parse('2026-11-14T08:00:00.000Z');
const ORIGIN = 'https://pos.fisca.ma';

function makeDeps(over: Partial<SwDeps> & { network?: (request: Request) => Promise<Response> } = {}): { deps: SwDeps; caches: FakeCacheStorage } {
  const caches = new FakeCacheStorage();
  const network = over.network ?? (async (request: Request) => new Response(`réseau:${new URL(request.url).pathname}`, { status: 200 }));
  const deps: SwDeps = {
    caches,
    fetchFn: network,
    nowMs: over.nowMs ?? (() => NOW),
    config: {
      version: '2',
      origin: ORIGIN,
      shellPath: '/index.html',
      precachePaths: ['/', '/index.html', '/assets/app.js'],
    },
  };
  return { deps, caches };
}

const get = (path: string, init: { mode?: RequestMode; destination?: string } = {}) => ({
  request: new Request(`${ORIGIN}${path}`),
  facts: { method: 'GET', url: `${ORIGIN}${path}`, mode: init.mode ?? 'no-cors', destination: init.destination ?? '' },
});

describe('Service Worker : installation et activation', () => {
  it('précache toutes les ressources de la coquille', async () => {
    const { deps, caches } = makeDeps();
    await handleInstall(deps);
    const store = await caches.open(buildCacheNames('2').precache);
    expect([...store.entries.keys()].sort()).toEqual([`${ORIGIN}/`, `${ORIGIN}/assets/app.js`, `${ORIGIN}/index.html`]);
  });

  it('échoue franchement si une ressource du précache est indisponible', async () => {
    const { deps } = makeDeps({ network: async () => new Response('KO', { status: 500 }) });
    await expect(handleInstall(deps)).rejects.toThrow(/précache/);
  });

  it('à l’activation, supprime les caches Fisca des anciennes versions et garde ceux de la version courante', async () => {
    const { deps, caches } = makeDeps();
    await caches.open('fisca-pos-precache-v1');
    await caches.open('fisca-pos-runtime-v1');
    await caches.open('autre-cache');
    await handleInstall(deps);
    await caches.open(buildCacheNames('2').runtime);
    const deleted = await handleActivate(deps);
    expect(deleted.sort()).toEqual(['fisca-pos-precache-v1', 'fisca-pos-runtime-v1']);
    expect((await caches.keys()).sort()).toEqual(['autre-cache', 'fisca-pos-precache-v2', 'fisca-pos-runtime-v2']);
  });
});

describe('Service Worker : requêtes', () => {
  it('ressource précachée servie hors ligne', async () => {
    const { deps } = makeDeps();
    await handleInstall(deps);
    const offline: SwDeps = { ...deps, fetchFn: async () => Promise.reject(new TypeError('hors ligne')) };
    const { request, facts } = get('/assets/app.js', { destination: 'script' });
    const outcome = await handleFetch(request, facts, offline);
    expect(await outcome.response.text()).toBe('réseau:/assets/app.js');
  });

  it('navigation hors ligne : repli sur la coquille précachée', async () => {
    const { deps } = makeDeps();
    await handleInstall(deps);
    const offline: SwDeps = { ...deps, fetchFn: async () => Promise.reject(new TypeError('hors ligne')) };
    const { request, facts } = get('/ventes', { mode: 'navigate', destination: 'document' });
    const outcome = await handleFetch(request, facts, offline);
    expect(await outcome.response.text()).toBe('réseau:/index.html');
  });

  it('navigation hors ligne sans coquille : 503 explicite', async () => {
    const { deps } = makeDeps({ network: async () => Promise.reject(new TypeError('hors ligne')) });
    const { request, facts } = get('/ventes', { mode: 'navigate', destination: 'document' });
    const outcome = await handleFetch(request, facts, deps);
    expect(outcome.response.status).toBe(503);
  });

  it('API : jamais lue ni écrite dans le cache', async () => {
    const { deps, caches } = makeDeps();
    const { request, facts } = get('/api/v1/pos/sync-batch');
    const outcome = await handleFetch(request, facts, deps);
    expect(outcome.response.status).toBe(200);
    expect([...caches.stores.values()].every((store) => store.entries.size === 0)).toBe(true);
  });

  it('statique : première lecture réseau puis écriture horodatée dans le cache d’exécution', async () => {
    const { deps, caches } = makeDeps();
    const { request, facts } = get('/assets/x.css', { destination: 'style' });
    const outcome = await handleFetch(request, facts, deps);
    expect(await outcome.response.text()).toBe('réseau:/assets/x.css');
    const runtime = await caches.open(buildCacheNames('2').runtime);
    const stored = await runtime.match(`${ORIGIN}/assets/x.css`);
    expect(stored?.headers.get(CACHED_AT_HEADER)).toBe(String(NOW));
  });

  it('statique : entrée fraîche servie depuis le cache, revalidation en arrière-plan', async () => {
    const { deps, caches } = makeDeps();
    const runtime = await caches.open(buildCacheNames('2').runtime);
    await runtime.put(`${ORIGIN}/assets/x.css`, new Response('ancien', { headers: { [CACHED_AT_HEADER]: String(NOW - 1000) } }));
    const { request, facts } = get('/assets/x.css', { destination: 'style' });
    const outcome = await handleFetch(request, facts, deps);
    expect(await outcome.response.text()).toBe('ancien');
    expect(outcome.background).toBeDefined();
    await outcome.background;
    expect(await (await runtime.match(`${ORIGIN}/assets/x.css`))?.text()).toBe('réseau:/assets/x.css');
  });

  it('statique : entrée de plus de 72 h purgée ; réseau absent donc 504, jamais de contenu périmé', async () => {
    const { deps, caches } = makeDeps({ network: async () => Promise.reject(new TypeError('hors ligne')) });
    const runtime = await caches.open(buildCacheNames('2').runtime);
    await runtime.put(`${ORIGIN}/assets/x.css`, new Response('périmé', { headers: { [CACHED_AT_HEADER]: String(NOW - OFFLINE_WINDOW_MS - 1) } }));
    const { request, facts } = get('/assets/x.css', { destination: 'style' });
    const outcome = await handleFetch(request, facts, deps);
    expect(outcome.response.status).toBe(504);
    expect(await runtime.match(`${ORIGIN}/assets/x.css`)).toBeUndefined();
  });

  it('statique : une réponse 404 n’est pas mise en cache', async () => {
    const { deps, caches } = makeDeps({ network: async () => new Response('absent', { status: 404 }) });
    const { request, facts } = get('/assets/x.css', { destination: 'style' });
    await handleFetch(request, facts, deps);
    const runtime = await caches.open(buildCacheNames('2').runtime);
    expect(runtime.entries.size).toBe(0);
  });
});

describe('Service Worker : câblage des événements', () => {
  it('enregistre install, activate et fetch sur la portée', () => {
    const registered: string[] = [];
    const scope: SwScope = {
      addEventListener(type: string, listener: SwListener) {
        registered.push(typeof listener === 'function' ? type : 'invalide');
      },
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
    };
    installServiceWorker(scope, makeDeps().deps);
    expect(registered.sort()).toEqual(['activate', 'fetch', 'install']);
  });
});
