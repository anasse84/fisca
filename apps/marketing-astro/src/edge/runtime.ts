/**
 * Colle entre Astro (adaptateur Cloudflare 12, `locals.runtime`) et les modules purs de `src/edge/`. C'est le seul fichier qui
 * lit l'horloge, le générateur aléatoire et les liaisons de l'environnement.
 * Doc consultée : https://docs.astro.build/en/guides/integrations-guide/cloudflare/ (la page décrit Astro 6 et `cfContext` ;
 * ce dépôt est en Astro 5.18 + @astrojs/cloudflare 12.6, où l'accès reste `Astro.locals.runtime.{env, ctx, caches}`).
 */
import { BINDING_NAMES, readKv, readPositiveInt, readString } from './env.ts';
import type { EdgeEnv } from './env.ts';
import { KvFreshnessStore } from './freshness.ts';
import type { FreshnessStore } from './freshness.ts';
import { fetchOutbound, parsePingTargets } from './indexnow.ts';
import type { EdgeCachePort, KvLike, NowSeconds, RandomBytes, WaitUntil } from './ports.ts';
import { KvTelemetryStore } from './telemetry.ts';
import type { TelemetryStore } from './telemetry.ts';
import type { HandoffEndpointDeps } from './handoff-endpoint.ts';
import type { WikiSyncDeps } from './wiki-sync.ts';

/** Sous-ensemble structurel de `locals.runtime` : aucun type Cloudflare importé. */
export interface EdgeRuntime {
  readonly env?: EdgeEnv;
  readonly ctx?: { waitUntil(promise: Promise<unknown>): void };
  readonly caches?: { readonly default?: CacheLike };
}

interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
  delete(request: string): Promise<boolean>;
}

export const systemNowSeconds: NowSeconds = () => Math.floor(Date.now() / 1000);

export const systemRandomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

export function edgeCacheOf(runtime: EdgeRuntime | undefined): EdgeCachePort | undefined {
  const cache = runtime?.caches?.default;
  if (cache === undefined) return undefined;
  return {
    match: (url) => cache.match(url),
    put: (url, response) => cache.put(url, response),
    delete: (url) => cache.delete(url),
  };
}

export function waitUntilOf(runtime: EdgeRuntime | undefined): WaitUntil | undefined {
  const ctx = runtime?.ctx;
  return ctx === undefined ? undefined : (promise) => ctx.waitUntil(promise);
}

export function kvOf(runtime: EdgeRuntime | undefined): KvLike | undefined {
  return readKv(runtime?.env);
}

export function telemetryStoreOf(runtime: EdgeRuntime | undefined): TelemetryStore | undefined {
  const kv = kvOf(runtime);
  return kv === undefined ? undefined : new KvTelemetryStore(kv);
}

export function freshnessStoreOf(runtime: EdgeRuntime | undefined): FreshnessStore | undefined {
  const kv = kvOf(runtime);
  return kv === undefined ? undefined : new KvFreshnessStore(kv);
}

export function wikiSyncDepsOf(runtime: EdgeRuntime | undefined): WikiSyncDeps {
  const env = runtime?.env;
  return {
    secret: readString(env, BINDING_NAMES.wikiWebhookSecret),
    nowSeconds: systemNowSeconds,
    cache: edgeCacheOf(runtime),
    freshness: freshnessStoreOf(runtime),
    outbound: fetchOutbound,
    indexNowKey: readString(env, BINDING_NAMES.indexNowKey),
    sitemapPingTargets: parsePingTargets(readString(env, BINDING_NAMES.sitemapPingTargets)),
    processedEvents: kvOf(runtime),
  };
}

export function handoffDepsOf(runtime: EdgeRuntime | undefined): HandoffEndpointDeps {
  const env = runtime?.env;
  return {
    secret: readString(env, BINDING_NAMES.handoffSecret),
    ttlSeconds: readPositiveInt(env, BINDING_NAMES.handoffTtlSeconds),
    nowSeconds: systemNowSeconds,
    randomBytes: systemRandomBytes,
  };
}
