import { OFFLINE_WINDOW_MS } from '../offline/offline-window.ts';

/** Politique de cache du Service Worker : fonctions pures, sans accès à l'API Cache. */

export const SW_CACHE_PREFIX = 'fisca-pos';
export const CACHED_AT_HEADER = 'x-fisca-cached-at';
/** Les routes serveur vivent sous /api/ : jamais mises en cache (données fiscales, jetons). */
export const API_PATH_PREFIX = '/api/';

export type CacheStrategy = 'CACHE_FIRST_PRECACHE' | 'NETWORK_FIRST_NAVIGATION' | 'STALE_WHILE_REVALIDATE' | 'NETWORK_ONLY';

export interface RequestFacts {
  readonly method: string;
  readonly url: string;
  readonly mode: string;
  readonly destination: string;
}

export interface PolicyContext {
  readonly origin: string;
  readonly precachePaths: ReadonlySet<string>;
}

const STATIC_DESTINATIONS: ReadonlySet<string> = new Set(['script', 'style', 'font', 'image', 'worker', 'sharedworker', 'manifest']);

export function decideCacheStrategy(request: RequestFacts, context: PolicyContext): CacheStrategy {
  if (request.method.toUpperCase() !== 'GET') return 'NETWORK_ONLY';
  const url = new URL(request.url);
  if (url.origin !== context.origin) return 'NETWORK_ONLY';
  if (url.pathname.startsWith(API_PATH_PREFIX)) return 'NETWORK_ONLY';
  if (request.mode === 'navigate') return 'NETWORK_FIRST_NAVIGATION';
  if (context.precachePaths.has(url.pathname)) return 'CACHE_FIRST_PRECACHE';
  if (STATIC_DESTINATIONS.has(request.destination) || url.pathname.endsWith('.wasm')) return 'STALE_WHILE_REVALIDATE';
  return 'NETWORK_ONLY';
}

/**
 * Une entrée du cache d'exécution expire au-delà de 72 h. Les entrées du précache n'expirent pas :
 * la coquille doit s'ouvrir hors ligne ; le refus des ventes relève de `offline-window`.
 */
export function isCacheEntryExpired(cachedAtMs: number | null, nowMs: number, maxAgeMs: number = OFFLINE_WINDOW_MS): boolean {
  if (cachedAtMs === null || Number.isNaN(cachedAtMs)) return true;
  return nowMs - cachedAtMs > maxAgeMs;
}

export interface CacheNames {
  readonly precache: string;
  readonly runtime: string;
}

export function buildCacheNames(version: string): CacheNames {
  return {
    precache: `${SW_CACHE_PREFIX}-precache-v${version}`,
    runtime: `${SW_CACHE_PREFIX}-runtime-v${version}`,
  };
}

/** Noms de caches Fisca POS à supprimer : tous ceux du préfixe qui ne sont pas de la version courante. */
export function planCacheCleanup(existingNames: readonly string[], currentVersion: string): string[] {
  const keep = buildCacheNames(currentVersion);
  return existingNames.filter((name) => name.startsWith(`${SW_CACHE_PREFIX}-`) && name !== keep.precache && name !== keep.runtime);
}

export function isCacheableResponse(status: number, type: string): boolean {
  return status === 200 && (type === 'basic' || type === 'default');
}
