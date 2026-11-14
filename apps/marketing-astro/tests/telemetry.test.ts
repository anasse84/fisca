import { describe, expect, it } from 'vitest';
import {
  GENERATIVE_ENGINE_HOSTS,
  KvTelemetryStore,
  MemoryTelemetryStore,
  classifyProvenance,
  isBotUserAgent,
  isTechnicalPath,
  recordPageView,
  telemetryKeyFor,
} from '../src/edge/telemetry.ts';
import type { TelemetryStore } from '../src/edge/telemetry.ts';
import { MemoryKv } from './helpers/edge-fakes.ts';

const NOW = 1_789_000_000; // 2026-09-10 UTC
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function page(path: string, headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request(`https://fisca.ma${path}`, { method, headers: { 'user-agent': BROWSER_UA, ...headers } });
}

const HTML = (): Response => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const classOf = (referer: string | null, url = 'https://fisca.ma/fr/tarifs') => classifyProvenance(referer, new URL(url));

describe('classifieur de provenance', () => {
  it('moteurs génératifs : les 5 hôtes de Doc_18 S09, sous-domaines compris', () => {
    expect(GENERATIVE_ENGINE_HOSTS).toEqual(['chatgpt.com', 'perplexity.ai', 'gemini.google.com', 'claude.ai', 'copilot.microsoft.com']);
    for (const ref of ['https://chatgpt.com/', 'https://www.perplexity.ai/search?q=x', 'https://gemini.google.com/app', 'https://claude.ai/chat/abc', 'https://copilot.microsoft.com/', 'https://chat.chatgpt.com/']) {
      expect(classOf(ref), ref).toBe('generative_ai');
    }
  });

  it('Gemini n’est pas du Google organique ; Google et Bing le sont', () => {
    expect(classOf('https://gemini.google.com/')).toBe('generative_ai');
    for (const ref of ['https://www.google.com/', 'https://www.google.co.ma/search?q=ice', 'https://google.fr/', 'https://www.bing.com/search?q=x']) {
      expect(classOf(ref), ref).toBe('organic_search');
    }
  });

  it('direct, interne, autre, mal formé', () => {
    expect(classOf(null)).toBe('direct');
    expect(classOf('')).toBe('direct');
    expect(classOf('https://fisca.ma/fr/')).toBe('direct');
    expect(classOf('https://duckduckgo.com/')).toBe('other');
    expect(classOf('https://t.co/abc')).toBe('other');
    expect(classOf('pas une url')).toBe('other');
  });

  it('usurpation d’hôte : un domaine qui contient seulement le nom ne compte pas', () => {
    for (const ref of ['https://chatgpt.com.evil.example/', 'https://notchatgpt.com/', 'https://google.com.evil.example/', 'https://fisca.ma.evil.example/']) {
      expect(classOf(ref), ref).toBe('other');
    }
  });

  it('utm_source sert de repli quand le Referer est absent ; le Referer prime', () => {
    expect(classOf(null, 'https://fisca.ma/fr/tarifs?utm_source=chatgpt.com')).toBe('generative_ai');
    expect(classOf(null, 'https://fisca.ma/fr/tarifs?utm_source=newsletter')).toBe('other');
    expect(classOf('https://www.google.com/', 'https://fisca.ma/fr/tarifs?utm_source=chatgpt.com')).toBe('organic_search');
  });
});

describe('ce qui est compté', () => {
  it('robots, User-Agent absent, chemins techniques, méthodes, statuts et types : ignorés', () => {
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
    for (const ua of ['Googlebot/2.1', 'GPTBot/1.0', 'PerplexityBot', 'ClaudeBot/1.0', 'bingbot/2.0', 'Mozilla/5.0 HeadlessChrome/130', 'curl/8.0', 'ChatGPT-User/1.0', 'Lighthouse']) {
      expect(isBotUserAgent(ua), ua).toBe(true);
    }
    expect(isBotUserAgent(BROWSER_UA)).toBe(false);
    for (const path of ['/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt', '/.well-known/mcp.json', '/fonts/a.woff2', '/_astro/x.js', '/api/handoff', '/fr/tarifs.md', '/favicon.svg', '/cle.txt']) {
      expect(isTechnicalPath(path), path).toBe(true);
    }
    expect(isTechnicalPath('/fr/tarifs')).toBe(false);
    expect(telemetryKeyFor(page('/fr/tarifs', {}, 'HEAD'), HTML(), NOW)).toBeNull();
    expect(telemetryKeyFor(page('/fr/tarifs', { 'user-agent': 'Googlebot/2.1' }), HTML(), NOW)).toBeNull();
    expect(telemetryKeyFor(new Request('https://fisca.ma/fr/tarifs'), HTML(), NOW)).toBeNull();
    expect(telemetryKeyFor(page('/robots.txt'), HTML(), NOW)).toBeNull();
    expect(telemetryKeyFor(page('/fr/tarifs'), new Response('x', { status: 404, headers: { 'content-type': 'text/html' } }), NOW)).toBeNull();
    expect(telemetryKeyFor(page('/fr/tarifs'), new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }), NOW)).toBeNull();
    expect(telemetryKeyFor(page('/fr/page-inconnue'), HTML(), NOW)).toBeNull();
    expect(telemetryKeyFor(page('/xx/tarifs'), HTML(), NOW)).toBeNull();
  });

  it('clé : (page_slug, locale, tool_id, referring_class) et jour UTC ; accueil = index ; outil identifié', () => {
    expect(telemetryKeyFor(page('/fr/tarifs', { referer: 'https://claude.ai/' }), HTML(), NOW)).toEqual({
      day: '2026-09-10',
      page_slug: 'tarifs',
      locale: 'fr',
      tool_id: '',
      referring_class: 'generative_ai',
    });
    expect(telemetryKeyFor(page('/ar/'), HTML(), NOW)).toMatchObject({ page_slug: 'index', locale: 'ar', referring_class: 'direct' });
    expect(telemetryKeyFor(page('/zgh-tfng/tarifs'), HTML(), NOW)?.locale).toBe('zgh-Tfng');
    expect(telemetryKeyFor(page('/en/outils/audit-ice-excel', { referer: 'https://www.google.com/' }), HTML(), NOW)).toMatchObject({
      page_slug: 'outils/audit-ice-excel',
      tool_id: 'ice',
      referring_class: 'organic_search',
    });
    expect(telemetryKeyFor(page('/fr/outils/simulateur-loi-69-21'), HTML(), NOW)?.tool_id).toBe('loi');
    expect(telemetryKeyFor(page('/fr/tarifs'), HTML(), NOW + 86400)?.day).toBe('2026-09-11');
  });
});

describe('aucune donnée personnelle', () => {
  it('enregistrements : 6 champs seulement, ni IP, ni User-Agent, ni URL de provenance, ni paramètre ; aucun Set-Cookie', async () => {
    const store = new MemoryTelemetryStore();
    const request = new Request('https://fisca.ma/fr/outils/audit-ice-excel?ice=001234567000045&utm_source=chatgpt.com', {
      headers: {
        'user-agent': BROWSER_UA,
        referer: 'https://www.google.com/search?q=mon+ice+001234567000045&sca_esv=abc',
        'cf-connecting-ip': '203.0.113.77',
        'x-forwarded-for': '198.51.100.23, 10.0.0.1',
        'accept-language': 'fr-MA,fr;q=0.9',
        cookie: 'sid=abc123',
      },
    });
    const response = HTML();
    await recordPageView(request, response, store, () => NOW);
    await recordPageView(request, response, store, () => NOW);
    const records = store.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({ day: '2026-09-10', page_slug: 'outils/audit-ice-excel', locale: 'fr', tool_id: 'ice', referring_class: 'organic_search', count: 2 });
    expect(Object.keys(records[0] ?? {}).sort()).toEqual(['count', 'day', 'locale', 'page_slug', 'referring_class', 'tool_id']);
    const dump = JSON.stringify(records);
    for (const forbidden of ['203.0.113.77', '198.51.100', 'Mozilla', 'Chrome', 'google.com', 'q=mon', '001234567000045', 'abc123', 'fr-MA', 'sca_esv']) {
      expect(dump, forbidden).not.toContain(forbidden);
    }
    expect(dump).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('pilote KV : un compteur numérique par clé, rien d’autre dans les valeurs ni les clés', async () => {
    const kv = new MemoryKv();
    const store = new KvTelemetryStore(kv);
    const key = telemetryKeyFor(page('/fr/tarifs', { referer: 'https://chatgpt.com/', 'cf-connecting-ip': '203.0.113.77' }), HTML(), NOW);
    expect(key).not.toBeNull();
    await store.increment(key!);
    await store.increment(key!);
    expect([...kv.data.entries()]).toEqual([['tel:2026-09-10|tarifs|fr||generative_ai', '2']]);
    kv.data.set('tel:2026-09-10|tarifs|fr||generative_ai', 'corrompu');
    await store.increment(key!);
    expect(kv.data.get('tel:2026-09-10|tarifs|fr||generative_ai')).toBe('1');
    expect(JSON.stringify([...kv.data.entries()])).not.toContain('203.0.113.77');
  });

  it('ne bloque jamais : un magasin qui échoue ne lève rien', async () => {
    const failing: TelemetryStore = { increment: () => Promise.reject(new Error('KV indisponible')) };
    await expect(recordPageView(page('/fr/tarifs'), HTML(), failing, () => NOW)).resolves.toBeUndefined();
  });
});

describe('middleware : waitUntil, jamais dans le chemin de la réponse', () => {
  it('la réponse part sans attendre le magasin ; aucun cookie ajouté ; robots et chemins techniques non comptés', async () => {
    const { onRequest } = await import('../src/middleware.ts');
    const kv = new MemoryKv();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowKv = {
      get: async (k: string) => {
        if (k.startsWith('tel:')) await gate;
        return kv.get(k);
      },
      put: (k: string, v: string) => kv.put(k, v),
    };
    const pending: Promise<unknown>[] = [];
    const runtime = { env: { MARKETING_EDGE_KV: slowKv }, ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) } };
    const run = async (path: string, headers: Record<string, string> = {}): Promise<Response> => {
      const request = page(path, headers);
      const next = (): Promise<Response> => Promise.resolve(HTML());
      const context = { request, url: new URL(request.url), locals: { runtime } };
      return (await onRequest(context as never, next)) as Response;
    };

    const response = await run('/fr/tarifs', { referer: 'https://chatgpt.com/' });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('vary')).toContain('Accept');
    expect(pending).toHaveLength(1);
    expect(kv.data.size).toBe(0);
    release();
    await Promise.all(pending);
    const counters = [...kv.data.entries()].filter(([k]) => k.startsWith('tel:'));
    expect(counters).toHaveLength(1);
    expect(counters[0]?.[0]).toMatch(/^tel:\d{4}-\d{2}-\d{2}\|tarifs\|fr\|\|generative_ai$/);

    const before = kv.data.size;
    const calls = pending.length;
    await run('/robots.txt');
    await run('/fr/tarifs', { 'user-agent': 'GPTBot/1.0' });
    await Promise.all(pending);
    expect(pending.length).toBe(calls + 2);
    expect(kv.data.size).toBe(before);
  });

  it('sans KV ni contexte (développement local) : la réponse passe sans télémétrie', async () => {
    const { onRequest } = await import('../src/middleware.ts');
    const request = page('/fr/tarifs');
    const response = (await onRequest({ request, url: new URL(request.url), locals: {} } as never, () => Promise.resolve(HTML()))) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
