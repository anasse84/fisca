import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ToolPage from '../src/pages/[locale]/outils/[tool].astro';
import { POST as handoffPost } from '../src/pages/api/handoff.ts';
import { POST as wikiPost } from '../src/pages/api/internal/wiki-events.ts';
import { GET as indexNowKeyGet } from '../src/pages/[indexNowKey].txt.ts';
import { BINDING_NAMES } from '../src/edge/env.ts';
import { hmacSha256Hex } from '../src/edge/hmac.ts';
import { APP_ORIGIN, HANDOFF_QUERY_PARAM, MemoryNonceStore, verifyHandoffToken } from '../src/edge/handoff.ts';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../src/edge/wiki-sync.ts';
import { copyLocaleOf } from '../src/i18n/copy-locale.ts';
import { LOCALE_URL_PREFIX, MARKETING_LOCALES } from '../src/i18n/locales.ts';
import { handoffCopy } from '../src/tools/copy/handoff.ts';
import { prepareHandoffIce } from '../src/tools/handoff-ice.ts';
import { MemoryKv } from './helpers/edge-fakes.ts';

/** Valeurs fabriquées pour les tests : ni secrets ni clés réels. */
const ENV = {
  [BINDING_NAMES.wikiWebhookSecret]: 'secret-wiki-de-test',
  [BINDING_NAMES.handoffSecret]: 'secret-handoff-de-test',
  [BINDING_NAMES.indexNowKey]: 'cle-indexnow-de-test-0001',
};

function context(request: Request, runtime: unknown, params: Record<string, string> = {}): never {
  return { request, params, locals: { runtime } } as never;
}

describe('routes API : colle Astro', () => {
  it('wiki-events : 503 sans secret, 401 sans signature, 200 signé (sans clé IndexNow ni cible de ping : aucun appel sortant)', async () => {
    const url = 'https://fisca.ma/api/internal/wiki-events';
    expect((await wikiPost(context(new Request(url, { method: 'POST', body: '{}' }), undefined))).status).toBe(503);
    expect((await wikiPost(context(new Request(url, { method: 'POST', body: '{}' }), { env: ENV }))).status).toBe(401);
    const kv = new MemoryKv();
    const raw = JSON.stringify({ eventId: 'evt-route-0001', kind: 'WIKI_PAGE_PUBLISHED', occurredAt: '2026-11-14T10:00:00Z', pages: [{ locale: 'fr', slug: 'tarifs' }] });
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = await hmacSha256Hex(ENV[BINDING_NAMES.wikiWebhookSecret], `${ts}.${raw}`);
    const env = { [BINDING_NAMES.wikiWebhookSecret]: ENV[BINDING_NAMES.wikiWebhookSecret], [BINDING_NAMES.kv]: kv };
    const res = await wikiPost(context(new Request(url, { method: 'POST', body: raw, headers: { [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: signature } }), { env }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, indexNow: 'SKIPPED_NO_KEY', sitemapPing: 'SKIPPED_NO_TARGET', freshness: { status: 'DONE', updated: 1 } });
    expect(kv.data.get('fresh:fr|tarifs')).toBe('2026-11-14T10:00:00Z');
  });

  it('handoff : 503 sans secret, 200 avec secret, lien vérifiable', async () => {
    const make = (body: unknown) => new Request('https://fisca.ma/api/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await handoffPost(context(make({ ice: '001234567000045' }), { env: {} }))).status).toBe(503);
    const res = await handoffPost(context(make({ ice: '001234567000045' }), { env: { ...ENV, [BINDING_NAMES.handoffTtlSeconds]: '60' } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expiresInSeconds: number };
    expect(body.expiresInSeconds).toBe(60);
    expect(body.url.startsWith(`${APP_ORIGIN}/?${HANDOFF_QUERY_PARAM}=`)).toBe(true);
    const token = new URL(body.url).searchParams.get(HANDOFF_QUERY_PARAM) ?? '';
    const verified = await verifyHandoffToken(token, { secret: ENV[BINDING_NAMES.handoffSecret], nowSeconds: () => Math.floor(Date.now() / 1000), nonces: new MemoryNonceStore() });
    expect(verified).toMatchObject({ ok: true, ice: '001234567000045' });
  });

  it('fichier de clé IndexNow : servi depuis la liaison, 404 pour toute autre clé ou sans liaison', async () => {
    const key = ENV[BINDING_NAMES.indexNowKey];
    const ok = await indexNowKeyGet(context(new Request(`https://fisca.ma/${key}.txt`), { env: ENV }, { indexNowKey: key }));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe(key);
    expect(ok.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect((await indexNowKeyGet(context(new Request('https://fisca.ma/autre.txt'), { env: ENV }, { indexNowKey: 'autre' }))).status).toBe(404);
    expect((await indexNowKeyGet(context(new Request(`https://fisca.ma/${key}.txt`), { env: {} }, { indexNowKey: key }))).status).toBe(404);
    expect((await indexNowKeyGet(context(new Request(`https://fisca.ma/${key}.txt`), undefined, { indexNowKey: key }))).status).toBe(404);
    expect((await indexNowKeyGet(context(new Request('https://fisca.ma/court.txt'), { env: { [BINDING_NAMES.indexNowKey]: 'court' } }, { indexNowKey: 'court' }))).status).toBe(404);
  });
});

async function renderTool(prefix: string, segment: string): Promise<string> {
  const container = await AstroContainer.create();
  const response = await container.renderToResponse(ToolPage, { params: { locale: prefix, tool: segment }, request: new Request(`https://fisca.ma/${prefix}/outils/${segment}`) });
  return response.text();
}

describe('lien « Démarrer l’essai gratuit 14 jours » sur les outils ICE et Loi 69-21', () => {
  it('présent dans les 6 langues sur les deux outils, absent des autres ; lien vers app.fisca.ma, aucune donnée en dur dans la page', async () => {
    for (const locale of MARKETING_LOCALES) {
      const prefix = LOCALE_URL_PREFIX[locale];
      const copy = handoffCopy(copyLocaleOf(locale));
      for (const segment of ['audit-ice-excel', 'simulateur-loi-69-21']) {
        const html = await renderTool(prefix, segment);
        expect(html, `${prefix}/${segment}`).toContain(copy.cta);
        expect(html).toContain('href="https://app.fisca.ma/"');
        expect(html).toContain('data-handoff');
        expect(html).not.toContain(HANDOFF_QUERY_PARAM);
        expect(html).not.toMatch(/fisca_handoff|v1\.[A-Za-z0-9_-]{20,}\./);
      }
      expect(await renderTool(prefix, 'ras-tva-especes'), prefix).not.toContain('data-handoff');
    }
  });

  it('texte exact en français et en anglais', () => {
    expect(handoffCopy('fr').cta).toBe('Démarrer l’essai gratuit 14 jours');
    expect(handoffCopy('en').cta).toBe('Start the 14-day free trial');
  });

  it('ICE à joindre : 15 chiffres, saisie normalisée, 13 ou 14 chiffres réparés, le reste refusé', () => {
    expect(prepareHandoffIce('001234567000045')).toBe('001234567000045');
    expect(prepareHandoffIce(' 001 234 567 000 045 ')).toBe('001234567000045');
    expect(prepareHandoffIce('٠٠١٢٣٤٥٦٧٠٠٠٠٤٥')).toBe('001234567000045');
    for (const bad of ['', '123', '00123456700004A', '1234567890123456', '1.2345E+14']) expect(prepareHandoffIce(bad), bad).toBeNull();
  });
});
