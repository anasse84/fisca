/**
 * Cache edge (Cache API) des réponses TEXTE calculées depuis le registre : /llms.txt, /llms-full.txt, /sitemap.xml et miroirs .md.
 * Ce sont ces copies que `wiki-sync.ts` purge. Les pages HTML ne sont pas mises en cache par le Worker.
 * `cache.delete` ne purge que le centre de données courant (https://developers.cloudflare.com/workers/runtime-apis/cache/) :
 * la purge mondiale par API de zone est un chantier P4, et `max-age=300` borne la péremption entre-temps.
 */
import { findEditorialPageByMirrorPath } from '../content/pages.ts';
import type { EdgeCachePort, WaitUntil } from './ports.ts';

const DYNAMIC_TEXT_PATHS: readonly string[] = ['/llms.txt', '/llms-full.txt', '/sitemap.xml'];

export function isEdgeCacheablePath(pathname: string): boolean {
  return DYNAMIC_TEXT_PATHS.includes(pathname) || findEditorialPageByMirrorPath(pathname) !== undefined;
}

/** Clé de cache : l'URL sans paramètre de requête (les `utm_*` ne créent pas d'entrées). */
export function cacheKeyOf(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

export async function serveWithEdgeCache(
  request: Request,
  cache: EdgeCachePort,
  produce: () => Promise<Response>,
  waitUntil: WaitUntil | undefined,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' || !isEdgeCacheablePath(url.pathname)) return produce();
  const key = cacheKeyOf(url);
  const hit = await cache.match(key);
  if (hit !== undefined) return hit;
  const response = await produce();
  if (response.status === 200 && waitUntil !== undefined) waitUntil(cache.put(key, response.clone()));
  return response;
}
