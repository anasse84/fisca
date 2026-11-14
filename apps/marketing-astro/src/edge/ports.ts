/**
 * Ports du Worker de marketing : tout ce qui sort du processus (KV, cache edge, réseau sortant, horloge, hasard) est injecté.
 * Les tests utilisent des pilotes mémoire ou simulés ; aucun appel réseau réel n'y est possible.
 */

/** Sous-ensemble de l'API KV de Cloudflare utilisé ici (https://developers.cloudflare.com/kv/api/). */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { readonly expirationTtl?: number }): Promise<void>;
}

/** Purge d'une entrée du cache edge (Cache API : `cache.delete(url)`, limité au centre de données courant). */
export interface EdgeCachePort {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
}

export interface OutboundRequest {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** Accès réseau sortant (IndexNow, ping de sitemap). Le pilote réel est `fetchOutbound` ; les tests injectent un pilote simulé. */
export interface OutboundPort {
  send(request: OutboundRequest): Promise<{ readonly status: number }>;
}

/** Secondes depuis l'epoch. Injectée : aucune horloge codée dans la logique. */
export type NowSeconds = () => number;

export type RandomBytes = (length: number) => Uint8Array;

export type WaitUntil = (promise: Promise<unknown>) => void;
