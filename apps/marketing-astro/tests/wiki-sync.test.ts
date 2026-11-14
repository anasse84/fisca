import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_EDITORIAL_PAGES, canonicalUrlOf, findEditorialPage, mirrorPathOf } from '../src/content/pages.ts';
import { MemoryFreshnessStore, KvFreshnessStore, isIsoUtcDate, pageKeyOf } from '../src/edge/freshness.ts';
import { hmacSha256Hex } from '../src/edge/hmac.ts';
import { INDEXNOW_ENDPOINT, buildIndexNowPayloads, indexNowKeyLocation, parsePingTargets } from '../src/edge/indexnow.ts';
import { cacheKeyOf, isEdgeCacheablePath, serveWithEdgeCache } from '../src/edge/edge-cache.ts';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, WIKI_EVENT_PATH, handleWikiEvent, indexNowUrlsFor, parseWikiEvent, purgeUrlsFor } from '../src/edge/wiki-sync.ts';
import type { WikiSyncDeps } from '../src/edge/wiki-sync.ts';
import { handleLlmsTxt, handleMirrorRequest } from '../src/seo/handlers.ts';
import { buildLlmsTxt } from '../src/seo/llms.ts';
import { buildFiscaJsonLdObject } from '../src/seo/jsonld.ts';
import { PRICING_CATALOG_OFFERS, PRICING_PLANS } from '../src/content/pricing.ts';
import { MemoryEdgeCache, MemoryKv, RecordingOutbound } from './helpers/edge-fakes.ts';

/** Valeurs d'essai fabriquées pour les tests : ce ne sont ni des secrets ni des clés réels. */
const TEST_SECRET = 'secret-de-test-uniquement';
const TEST_INDEXNOW_KEY = 'cle-de-test-indexnow-0001';
const NOW = 1_789_000_000;
const OCCURRED_AT = '2026-11-14T10:00:00Z';

interface Harness {
  readonly deps: WikiSyncDeps;
  readonly cache: MemoryEdgeCache;
  readonly freshness: MemoryFreshnessStore;
  readonly outbound: RecordingOutbound;
  readonly kv: MemoryKv;
}

function harness(overrides: Partial<WikiSyncDeps> = {}, outbound = new RecordingOutbound()): Harness {
  const cache = new MemoryEdgeCache();
  const freshness = new MemoryFreshnessStore();
  const kv = new MemoryKv();
  const deps: WikiSyncDeps = {
    secret: TEST_SECRET,
    nowSeconds: () => NOW,
    cache,
    freshness,
    outbound,
    indexNowKey: TEST_INDEXNOW_KEY,
    sitemapPingTargets: ['https://ping.example.test/ping?sitemap={sitemap}'],
    processedEvents: kv,
    ...overrides,
  };
  return { deps, cache, freshness, outbound, kv };
}

async function signedRequest(body: unknown, options: { secret?: string; ts?: number; method?: string; rawBody?: string } = {}): Promise<Request> {
  const raw = options.rawBody ?? JSON.stringify(body);
  const ts = String(options.ts ?? NOW);
  const signature = await hmacSha256Hex(options.secret ?? TEST_SECRET, `${ts}.${raw}`);
  return new Request(`https://fisca.ma${WIKI_EVENT_PATH}`, {
    method: options.method ?? 'POST',
    headers: { [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: signature, 'Content-Type': 'application/json' },
    ...((options.method ?? 'POST') === 'POST' ? { body: raw } : {}),
  });
}

const EVENT = {
  eventId: 'evt-2026-11-14-0001',
  kind: 'AST_RULE_ACTIVATED',
  occurredAt: OCCURRED_AT,
  pages: [{ locale: 'fr', slug: 'tarifs' }],
};

describe('événement Wiki signé : authentification', () => {
  it('signature valide : 200 et effets enchaînés', async () => {
    const h = harness();
    const url = canonicalUrlOf(findEditorialPage('fr', 'tarifs') ?? ALL_EDITORIAL_PAGES[0]!);
    h.cache.entries.set(url, new Response('stale'));
    h.cache.entries.set('https://fisca.ma/llms.txt', new Response('stale'));
    const response = await handleWikiEvent(await signedRequest(EVENT), h.deps);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, scope: 'PAGES', pages: 1, indexNow: 'SUBMITTED', sitemapPing: 'SUBMITTED' });
    expect(h.cache.entries.has(url)).toBe(false);
    expect(h.cache.entries.has('https://fisca.ma/llms.txt')).toBe(false);
    expect(await h.freshness.get(pageKeyOf('fr', 'tarifs'))).toBe(OCCURRED_AT);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('IndexNow : un POST JSON vers le point d’accès partagé, clé et emplacement de clé, URL canoniques seulement', async () => {
    const h = harness();
    await handleWikiEvent(await signedRequest(EVENT), h.deps);
    const [indexNow, ping] = h.outbound.requests;
    expect(indexNow?.method).toBe('POST');
    expect(indexNow?.url).toBe(INDEXNOW_ENDPOINT);
    expect(JSON.parse(indexNow?.body ?? '{}')).toEqual({
      host: 'fisca.ma',
      key: TEST_INDEXNOW_KEY,
      keyLocation: `https://fisca.ma/${TEST_INDEXNOW_KEY}.txt`,
      urlList: ['https://fisca.ma/fr/tarifs'],
    });
    expect(ping?.method).toBe('GET');
    expect(ping?.url).toBe(`https://ping.example.test/ping?sitemap=${encodeURIComponent('https://fisca.ma/sitemap.xml')}`);
  });

  it('corps altéré, signature altérée, signature non hexadécimale, mauvais secret : 401 sans aucun effet', async () => {
    const h = harness();
    const genuine = await signedRequest(EVENT);
    const tamperedBody = new Request(genuine.url, { method: 'POST', headers: genuine.headers, body: JSON.stringify({ ...EVENT, occurredAt: '2026-12-01T00:00:00Z' }) });
    const badSig = new Request(genuine.url, { method: 'POST', headers: { ...Object.fromEntries(genuine.headers), [SIGNATURE_HEADER]: 'z'.repeat(64) }, body: JSON.stringify(EVENT) });
    const wrongSecret = await signedRequest(EVENT, { secret: 'autre-secret' });
    const noHeaders = new Request(genuine.url, { method: 'POST', body: JSON.stringify(EVENT) });
    for (const req of [tamperedBody, badSig, wrongSecret, noHeaders]) {
      const res = await handleWikiEvent(req, h.deps);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'UNAUTHORIZED' });
    }
    expect(h.outbound.requests).toHaveLength(0);
    expect(h.cache.deleted).toHaveLength(0);
    expect(await h.freshness.get(pageKeyOf('fr', 'tarifs'))).toBeUndefined();
  });

  it('horodatage anti-rejeu : trop ancien, futur, absent, non numérique ; limite incluse', async () => {
    const h = harness();
    const edge = (ts: number) => signedRequest(EVENT, { ts });
    expect((await handleWikiEvent(await edge(NOW - 301), h.deps)).status).toBe(401);
    expect((await handleWikiEvent(await edge(NOW + 301), h.deps)).status).toBe(401);
    expect((await handleWikiEvent(await edge(NOW - 300), harness().deps)).status).toBe(200);
    expect((await handleWikiEvent(await edge(NOW + 300), harness().deps)).status).toBe(200);
    const nan = await signedRequest(EVENT, { ts: 0 });
    const headers = Object.fromEntries(nan.headers);
    const sig = await hmacSha256Hex(TEST_SECRET, `abc.${JSON.stringify(EVENT)}`);
    const res = await handleWikiEvent(new Request(nan.url, { method: 'POST', headers: { ...headers, [TIMESTAMP_HEADER]: 'abc', [SIGNATURE_HEADER]: sig }, body: JSON.stringify(EVENT) }), h.deps);
    expect(res.status).toBe(401);
    expect(h.outbound.requests).toHaveLength(0);
  });

  it('tolérance d’horloge : paramètre', async () => {
    const h = harness({ maxSkewSeconds: 10 });
    expect((await handleWikiEvent(await signedRequest(EVENT, { ts: NOW - 11 }), h.deps)).status).toBe(401);
    expect((await handleWikiEvent(await signedRequest(EVENT, { ts: NOW - 10 }), h.deps)).status).toBe(200);
  });

  it('secret absent : 503 ; méthode autre que POST : 405 ; corps trop gros : 413', async () => {
    expect((await handleWikiEvent(await signedRequest(EVENT), harness({ secret: undefined }).deps)).status).toBe(503);
    const get = await handleWikiEvent(new Request(`https://fisca.ma${WIKI_EVENT_PATH}`), harness().deps);
    expect(get.status).toBe(405);
    expect(get.headers.get('Allow')).toBe('POST');
    const big = await signedRequest(null, { rawBody: ' '.repeat(70000) });
    expect((await handleWikiEvent(big, harness().deps)).status).toBe(413);
  });

  it('événement rejoué (même eventId) : accepté une fois, ensuite doublon sans effet', async () => {
    const h = harness();
    expect((await (await handleWikiEvent(await signedRequest(EVENT), h.deps)).json()) as Record<string, unknown>).not.toHaveProperty('duplicate');
    const sent = h.outbound.requests.length;
    const again = await handleWikiEvent(await signedRequest(EVENT), h.deps);
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true });
    expect(h.outbound.requests).toHaveLength(sent);
    expect(h.kv.ttls.get(`evt:${EVENT.eventId}`)).toBe(86400);
  });
});

describe('événement Wiki : contenu', () => {
  it('rejets 400 / 422 : JSON, identifiant, nature, date, pages, page inconnue', async () => {
    const cases: ReadonlyArray<readonly [unknown, number, string]> = [
      [{ ...EVENT, eventId: 'x' }, 400, 'INVALID_EVENT_ID'],
      [{ ...EVENT, kind: 'AUTRE' }, 400, 'INVALID_KIND'],
      [{ ...EVENT, occurredAt: '2026-11-14' }, 400, 'INVALID_OCCURRED_AT'],
      [{ ...EVENT, occurredAt: '2026-13-45T00:00:00Z' }, 400, 'INVALID_OCCURRED_AT'],
      [{ ...EVENT, pages: 'tarifs' }, 400, 'INVALID_PAGES'],
      [{ ...EVENT, pages: [{ locale: 'fr' }] }, 400, 'INVALID_PAGE'],
      [{ ...EVENT, pages: [{ locale: 'fr', slug: 'inconnue' }] }, 422, 'UNKNOWN_PAGE'],
      [{ ...EVENT, pages: [{ locale: 'xx', slug: 'tarifs' }] }, 422, 'UNKNOWN_PAGE'],
      [[], 400, 'INVALID_EVENT'],
    ];
    for (const [body, status, error] of cases) {
      const h = harness();
      const res = await handleWikiEvent(await signedRequest(body), h.deps);
      expect(res.status, error).toBe(status);
      expect(await res.json(), error).toEqual({ error });
      expect(h.outbound.requests).toHaveLength(0);
    }
    const bad = await handleWikiEvent(await signedRequest(null, { rawBody: '{pas du json' }), harness().deps);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'INVALID_JSON' });
  });

  it('sans liste de pages : portée ALL = tout le registre, purge plafonnée et signalée', async () => {
    const h = harness({ maxPurgeUrls: 50 });
    const res = await handleWikiEvent(await signedRequest({ eventId: EVENT.eventId, kind: 'WIKI_PAGE_PUBLISHED', occurredAt: OCCURRED_AT }), h.deps);
    const body = (await res.json()) as { scope: string; pages: number; purge: { requested: number; truncated: boolean } };
    expect(body.scope).toBe('ALL');
    expect(body.pages).toBe(ALL_EDITORIAL_PAGES.length);
    expect(body.purge).toMatchObject({ requested: 50, truncated: true });
    expect(h.cache.deleted.slice(0, 3)).toEqual(['https://fisca.ma/llms.txt', 'https://fisca.ma/llms-full.txt', 'https://fisca.ma/sitemap.xml']);
  });

  it('URL purgées : points de terminaison dynamiques, HTML avec et sans « / », miroir .md', () => {
    const page = findEditorialPage('fr', 'tarifs');
    const home = findEditorialPage('fr', '');
    expect(page && home).toBeTruthy();
    const urls = purgeUrlsFor([page!, home!]);
    for (const expected of ['https://fisca.ma/llms.txt', 'https://fisca.ma/llms-full.txt', 'https://fisca.ma/sitemap.xml', 'https://fisca.ma/fr/tarifs', 'https://fisca.ma/fr/tarifs/', 'https://fisca.ma/fr/tarifs.md', 'https://fisca.ma/fr/', 'https://fisca.ma/fr', 'https://fisca.ma/fr/index.md']) {
      expect(urls).toContain(expected);
    }
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every((u) => mirrorPathOf(page!) === '/fr/tarifs.md' && u.startsWith('https://fisca.ma/'))).toBe(true);
  });

  it('IndexNow : aucune page noindex, aucune page hors sitemap', () => {
    const noindex = ALL_EDITORIAL_PAGES.find((p) => p.noindex === true);
    expect(noindex).toBeDefined();
    const normal = findEditorialPage('fr', 'tarifs');
    const urls = indexNowUrlsFor([noindex!, normal!]);
    expect(urls).toEqual(['https://fisca.ma/fr/tarifs']);
    const all = indexNowUrlsFor(ALL_EDITORIAL_PAGES);
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThan(ALL_EDITORIAL_PAGES.length);
  });

  it('parseWikiEvent : pages dédupliquées', () => {
    const parsed = parseWikiEvent(JSON.stringify({ ...EVENT, pages: [{ locale: 'fr', slug: 'tarifs' }, { locale: 'fr', slug: '/tarifs/' }] }));
    expect(parsed.ok && parsed.event.pages.length).toBe(1);
  });
});

describe('notifications sortantes : simulées, jamais réelles', () => {
  it('sans clé IndexNow : ignoré ; sans cible de ping : ignoré ; clé invalide : ignorée', async () => {
    const a = harness({ indexNowKey: undefined, sitemapPingTargets: [] });
    expect(await (await handleWikiEvent(await signedRequest(EVENT), a.deps)).json()).toMatchObject({ indexNow: 'SKIPPED_NO_KEY', sitemapPing: 'SKIPPED_NO_TARGET' });
    expect(a.outbound.requests).toHaveLength(0);
    const b = harness({ indexNowKey: 'court' });
    expect(await (await handleWikiEvent(await signedRequest(EVENT), b.deps)).json()).toMatchObject({ indexNow: 'SKIPPED_NO_KEY' });
  });

  it('un échec réseau (statut 500, 429 ou exception) est rapporté sans faire échouer l’événement', async () => {
    for (const outcome of [500, 429, new Error('réseau coupé')] as const) {
      const h = harness({}, new RecordingOutbound(() => outcome));
      const res = await handleWikiEvent(await signedRequest(EVENT), h.deps);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ indexNow: 'FAILED', sitemapPing: 'FAILED' });
      expect(h.cache.deleted.length).toBeGreaterThan(0);
    }
  });

  it('statut 202 d’IndexNow = succès ; page uniquement noindex : rien à notifier', async () => {
    const h = harness({}, new RecordingOutbound((r) => (r.url === INDEXNOW_ENDPOINT ? 202 : 200)));
    expect(await (await handleWikiEvent(await signedRequest(EVENT), h.deps)).json()).toMatchObject({ indexNow: 'SUBMITTED' });
    const noindex = ALL_EDITORIAL_PAGES.find((p) => p.noindex === true);
    const h2 = harness();
    const res = await handleWikiEvent(await signedRequest({ ...EVENT, eventId: 'evt-noindex-0001', pages: [{ locale: noindex!.locale, slug: noindex!.slug }] }), h2.deps);
    expect(await res.json()).toMatchObject({ indexNow: 'SKIPPED_NO_URL' });
  });

  it('ports absents (pas de KV, pas de cache) : l’événement est accepté, étapes ignorées', async () => {
    const h = harness({ cache: undefined, freshness: undefined, processedEvents: undefined });
    const body = (await (await handleWikiEvent(await signedRequest(EVENT), h.deps)).json()) as Record<string, Record<string, unknown>>;
    expect(body['freshness']?.['status']).toBe('SKIPPED');
    expect(body['purge']?.['status']).toBe('SKIPPED');
  });

  it('panne du cache ou du magasin de fraîcheur : étape FAILED, événement tout de même traité', async () => {
    const failing = {
      match: () => Promise.reject(new Error('x')),
      put: () => Promise.reject(new Error('x')),
      delete: () => Promise.reject(new Error('x')),
    };
    const store = { get: () => Promise.reject(new Error('x')), set: () => Promise.reject(new Error('x')) };
    const h = harness({ cache: failing, freshness: store });
    const body = (await (await handleWikiEvent(await signedRequest(EVENT), h.deps)).json()) as Record<string, Record<string, unknown>>;
    expect(body['freshness']?.['status']).toBe('FAILED');
    expect(body['purge']?.['status']).toBe('FAILED');
    expect(h.outbound.requests.length).toBeGreaterThan(0);
  });

  it('charge IndexNow : 10 000 URL au plus par envoi, clé invalide refusée, URL étrangères écartées', () => {
    const urls = Array.from({ length: 10001 }, (_, i) => `https://fisca.ma/fr/p${String(i)}`);
    const payloads = buildIndexNowPayloads(TEST_INDEXNOW_KEY, [...urls, 'https://autre.example/x']);
    expect(payloads.map((p) => p.urlList.length)).toEqual([10000, 1]);
    expect(() => buildIndexNowPayloads('court', urls)).toThrow(RangeError);
    expect(indexNowKeyLocation(TEST_INDEXNOW_KEY)).toBe(`https://fisca.ma/${TEST_INDEXNOW_KEY}.txt`);
    expect(parsePingTargets(' https://a.test/{sitemap} , ,https://b.test/{sitemap}')).toEqual(['https://a.test/{sitemap}', 'https://b.test/{sitemap}']);
    expect(parsePingTargets(undefined)).toEqual([]);
  });
});

describe('/llms.txt, miroirs .md et JSON-LD : dynamiques, pas d’horloge codée', () => {
  it('llms.txt est une fonction du registre : une page ajoutée change la sortie, sans rien régénérer', () => {
    const base = ALL_EDITORIAL_PAGES.filter((p) => p.locale === 'fr' && p.noindex !== true).slice(0, 3);
    const extra = { ...base[0]!, slug: 'page-ajoutee-par-wiki', heading: 'Page ajoutée par le Wiki' };
    const before = buildLlmsTxt(PRICING_PLANS, base, PRICING_CATALOG_OFFERS);
    const after = buildLlmsTxt(PRICING_PLANS, [...base, extra], PRICING_CATALOG_OFFERS);
    expect(after).not.toBe(before);
    expect(after).toContain('Page ajoutée par le Wiki');
    expect(handleLlmsTxt().status).toBe(200);
  });

  it('aucune route de contenu dynamique n’est préparée à la compilation (prerender)', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else out.push(p);
      }
      return out;
    };
    const files = walk(join(import.meta.dirname, '..', 'src', 'pages'));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/export\s+const\s+prerender\s*=\s*true/);
    expect(readFileSync(join(import.meta.dirname, '..', 'astro.config.mjs'), 'utf8')).toContain("output: 'server'");
  });

  it('miroir .md : la date de l’événement apparaît après mise à jour de la fraîcheur, et seulement alors', async () => {
    const request = new Request('https://fisca.ma/fr/tarifs.md');
    const before = await handleMirrorRequest(request)?.text();
    expect(before).not.toContain('Dernière modification');
    const h = harness();
    await handleWikiEvent(await signedRequest(EVENT), h.deps);
    const date = await h.freshness.get(pageKeyOf('fr', 'tarifs'));
    const after = await handleMirrorRequest(request, date)?.text();
    expect(after).toContain(`- Dernière modification : ${OCCURRED_AT}`);
  });

  it('JSON-LD : dateModified = la donnée injectée ; absente sinon (jamais une date du jour)', () => {
    const input = { pageUrl: 'https://fisca.ma/fr/tarifs', locale: 'fr', title: 'Tarifs', description: 'D' } as const;
    const without = JSON.stringify(buildFiscaJsonLdObject(input));
    expect(without).not.toContain('dateModified');
    const withDate = JSON.stringify(buildFiscaJsonLdObject({ ...input, dateModifiedIso: OCCURRED_AT }));
    expect(withDate).toContain(`"dateModified":"${OCCURRED_AT}"`);
  });

  it('aucune horloge, aucun secret ni identifiant de ressource dans src/edge (hors runtime.ts)', () => {
    const dir = join(import.meta.dirname, '..', 'src', 'edge');
    for (const name of readdirSync(dir)) {
      const text = readFileSync(join(dir, name), 'utf8');
      if (name !== 'runtime.ts') expect(text, name).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random/);
      expect(text, name).not.toMatch(/[0-9a-f]{32,}/);
    }
    const wrangler = readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8');
    expect(wrangler).not.toMatch(/kv_namespaces|secret|"id"/i);
  });

  it('fraîcheur : dates ISO valides seulement ; pilote KV', async () => {
    expect(isIsoUtcDate('2026-11-14T10:00:00Z')).toBe(true);
    expect(isIsoUtcDate('2026-11-14T10:00:00.250Z')).toBe(true);
    expect(isIsoUtcDate('2026-02-31T10:00:00Z')).toBe(false);
    expect(isIsoUtcDate('hier')).toBe(false);
    const kv = new MemoryKv();
    const store = new KvFreshnessStore(kv);
    await store.set('fr|tarifs', OCCURRED_AT);
    expect(await store.get('fr|tarifs')).toBe(OCCURRED_AT);
    kv.data.set('fresh:fr|x', 'pas une date');
    expect(await store.get('fr|x')).toBeUndefined();
  });
});

describe('cache edge des réponses texte', () => {
  it('chemins éligibles : llms, sitemap, miroirs ; pas les pages HTML', () => {
    for (const p of ['/llms.txt', '/llms-full.txt', '/sitemap.xml', '/fr/tarifs.md', '/fr/index.md']) expect(isEdgeCacheablePath(p), p).toBe(true);
    for (const p of ['/fr/tarifs', '/robots.txt', '/api/handoff', '/fr/inconnue.md']) expect(isEdgeCacheablePath(p), p).toBe(false);
    expect(cacheKeyOf(new URL('https://fisca.ma/llms.txt?utm_source=x'))).toBe('https://fisca.ma/llms.txt');
  });

  it('mise en cache puis purge : la requête suivante recalcule', async () => {
    const cache = new MemoryEdgeCache();
    const pending: Promise<unknown>[] = [];
    let calls = 0;
    const produce = (): Promise<Response> => {
      calls += 1;
      return Promise.resolve(new Response(`v${String(calls)}`, { status: 200 }));
    };
    const req = new Request('https://fisca.ma/llms.txt?utm_source=x');
    expect(await (await serveWithEdgeCache(req, cache, produce, (p) => pending.push(p))).text()).toBe('v1');
    await Promise.all(pending);
    expect(await (await serveWithEdgeCache(req, cache, produce, (p) => pending.push(p))).text()).toBe('v1');
    expect(calls).toBe(1);
    await cache.delete('https://fisca.ma/llms.txt');
    expect(await (await serveWithEdgeCache(req, cache, produce, (p) => pending.push(p))).text()).toBe('v2');
    const post = new Request('https://fisca.ma/llms.txt', { method: 'POST' });
    await serveWithEdgeCache(post, cache, produce, undefined);
    expect(calls).toBe(3);
  });
});
