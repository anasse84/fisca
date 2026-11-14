import {
  CACHED_AT_HEADER,
  buildCacheNames,
  decideCacheStrategy,
  isCacheEntryExpired,
  isCacheableResponse,
  planCacheCleanup,
} from './cache-policy.ts';
import type { RequestFacts } from './cache-policy.ts';

/**
 * Logique du Service Worker, indépendante de la portée globale : toutes les dépendances (caches, réseau, horloge)
 * sont injectées pour être testées sous Node. Le fichier `sw.ts` ne fait que les câbler.
 */

export interface SwCacheLike {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
  delete(request: Request | string): Promise<boolean>;
}

export interface SwCacheStorageLike {
  open(name: string): Promise<SwCacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

export interface SwConfig {
  readonly version: string;
  readonly origin: string;
  /** Chemin de la coquille d'application servie en repli de navigation. */
  readonly shellPath: string;
  readonly precachePaths: readonly string[];
}

export interface SwDeps {
  readonly caches: SwCacheStorageLike;
  readonly fetchFn: (request: Request) => Promise<Response>;
  readonly nowMs: () => number;
  readonly config: SwConfig;
}

export interface FetchOutcome {
  readonly response: Response;
  /** Travail de revalidation à confier à `event.waitUntil`. */
  readonly background?: Promise<void>;
}

function absolute(deps: SwDeps, path: string): string {
  return new URL(path, deps.config.origin).href;
}

/** Installation : précache de la coquille. Échec franc si une ressource est indisponible (pas de précache partiel). */
export async function handleInstall(deps: SwDeps): Promise<void> {
  const store = await deps.caches.open(buildCacheNames(deps.config.version).precache);
  const fetched: Array<{ url: string; response: Response }> = [];
  for (const path of deps.config.precachePaths) {
    const url = absolute(deps, path);
    const response = await deps.fetchFn(new Request(url));
    if (!response.ok) {
      throw new Error(`Échec du précache : ${path} a répondu ${response.status}.`);
    }
    fetched.push({ url, response });
  }
  for (const { url, response } of fetched) {
    await store.put(url, response);
  }
}

/** Activation : supprime les caches Fisca POS des versions précédentes ; retourne les noms supprimés. */
export async function handleActivate(deps: SwDeps): Promise<string[]> {
  const stale = planCacheCleanup(await deps.caches.keys(), deps.config.version);
  for (const name of stale) {
    await deps.caches.delete(name);
  }
  return stale;
}

async function stampedCopy(response: Response, nowMs: number): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(nowMs));
  return new Response(await response.clone().arrayBuffer(), { status: response.status, statusText: response.statusText, headers });
}

function cachedAtOf(response: Response): number | null {
  const raw = response.headers.get(CACHED_AT_HEADER);
  return raw === null ? null : Number(raw);
}

async function storeRuntime(deps: SwDeps, request: Request, response: Response): Promise<void> {
  if (!isCacheableResponse(response.status, response.type)) return;
  const runtime = await deps.caches.open(buildCacheNames(deps.config.version).runtime);
  await runtime.put(request.url, await stampedCopy(response, deps.nowMs()));
}

export async function handleFetch(request: Request, facts: RequestFacts, deps: SwDeps): Promise<FetchOutcome> {
  const strategy = decideCacheStrategy(facts, {
    origin: deps.config.origin,
    precachePaths: new Set(deps.config.precachePaths),
  });
  const names = buildCacheNames(deps.config.version);

  switch (strategy) {
    case 'NETWORK_ONLY':
      return { response: await deps.fetchFn(request) };

    case 'CACHE_FIRST_PRECACHE': {
      const precache = await deps.caches.open(names.precache);
      const hit = await precache.match(request.url);
      return { response: hit ?? (await deps.fetchFn(request)) };
    }

    case 'NETWORK_FIRST_NAVIGATION': {
      try {
        return { response: await deps.fetchFn(request) };
      } catch {
        const precache = await deps.caches.open(names.precache);
        const shell = await precache.match(absolute(deps, deps.config.shellPath));
        return { response: shell ?? new Response('Hors ligne : la coquille de la caisse n’est pas encore installée.', { status: 503 }) };
      }
    }

    case 'STALE_WHILE_REVALIDATE': {
      const runtime = await deps.caches.open(names.runtime);
      const hit = await runtime.match(request.url);
      if (hit !== undefined && !isCacheEntryExpired(cachedAtOf(hit), deps.nowMs())) {
        const background = deps
          .fetchFn(request.clone())
          .then((fresh) => storeRuntime(deps, request, fresh))
          .catch(() => undefined);
        return { response: hit, background };
      }
      if (hit !== undefined) {
        await runtime.delete(request.url);
      }
      try {
        const fresh = await deps.fetchFn(request);
        await storeRuntime(deps, request, fresh.clone());
        return { response: fresh };
      } catch {
        return { response: new Response('Ressource indisponible hors ligne.', { status: 504 }) };
      }
    }
  }
}

/* --- Câblage sur la portée du Service Worker (types structurels minimaux, sans lib WebWorker) --- */

export interface SwExtendableEvent {
  waitUntil(promise: Promise<unknown>): void;
}
export interface SwFetchEvent extends SwExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
export type SwListener = (event: SwExtendableEvent & Partial<SwFetchEvent>) => void;

export interface SwScope {
  addEventListener(type: string, listener: SwListener): void;
  skipWaiting(): Promise<void>;
  readonly clients: { claim(): Promise<void> };
}

export function installServiceWorker(scope: SwScope, deps: SwDeps): void {
  scope.addEventListener('install', (event) => {
    event.waitUntil(handleInstall(deps).then(() => scope.skipWaiting()));
  });
  scope.addEventListener('activate', (event) => {
    event.waitUntil(handleActivate(deps).then(() => scope.clients.claim()));
  });
  scope.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request === undefined || event.respondWith === undefined) return;
    const facts: RequestFacts = {
      method: request.method,
      url: request.url,
      mode: request.mode,
      destination: request.destination,
    };
    const work = handleFetch(request, facts, deps);
    event.respondWith(work.then((outcome) => outcome.response));
    event.waitUntil(work.then((outcome) => outcome.background ?? undefined));
  });
}
