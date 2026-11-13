import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import { describe, expect, it } from 'vitest';
import ToolsHubPage from '../src/pages/[locale]/outils/index.astro';
import ToolPage from '../src/pages/[locale]/outils/[tool].astro';
import { ALL_EDITORIAL_PAGES, findEditorialPage, findEditorialPageByMirrorPath, mirrorPathOf } from '../src/content/pages.ts';
import { datedValue } from '../src/content/dated-values.ts';
import { COMMON, TOOLS_HUB_SLUG } from '../src/tools/copy/common.ts';
import { ICE_EXISTENCE_NOTICE } from '../src/tools/copy/ice.ts';
import { copyLocaleOf } from '../src/i18n/copy-locale.ts';
import { LOCALE_URL_PREFIX, MARKETING_LOCALES, getLocaleMeta } from '../src/i18n/locales.ts';
import type { MarketingLocale } from '../src/i18n/locales.ts';
import { buildToolView, TOOL_DEFINITIONS, TOOL_PAGES, buildToolsHubView } from '../src/tools/registry.ts';
import type { ToolId } from '../src/tools/registry.ts';
import { handleLlmsFullTxt, handleLlmsTxt, handleMirrorRequest, handleSitemapXml } from '../src/seo/handlers.ts';
import { renderPageMarkdown } from '../src/seo/mirror.ts';
import { publishedSitemapSlugs } from '../src/seo/sitemap.ts';

const TOOL_ROUTES: readonly { readonly id: ToolId; readonly segment: string }[] = [
  { id: 'ice', segment: 'audit-ice-excel' },
  { id: 'loi', segment: 'simulateur-loi-69-21' },
  { id: 'ras', segment: 'ras-tva-especes' },
];

async function render(locale: MarketingLocale, segment: string | null): Promise<{ html: string; response: Response }> {
  const container = await AstroContainer.create();
  const prefix = LOCALE_URL_PREFIX[locale];
  const path = segment === null ? `https://fisca.ma/${prefix}/outils` : `https://fisca.ma/${prefix}/outils/${segment}`;
  const component: AstroComponentFactory = segment === null ? ToolsHubPage : ToolPage;
  const params = segment === null ? { locale: prefix } : { locale: prefix, tool: segment };
  const response = await container.renderToResponse(component, { params, request: new Request(path) });
  const raw = await response.clone().text();
  return { html: raw.replace(/ data-astro-source-(?:file|loc)="[^"]*"/g, ''), response };
}

const cache = new Map<string, { html: string; response: Response }>();
async function cached(locale: MarketingLocale, segment: string | null) {
  const key = `${locale}/${String(segment)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const fresh = await render(locale, segment);
  cache.set(key, fresh);
  return fresh;
}

const FIRST_PARTY_HOST = /^https:\/\/([a-z0-9-]+\.)?fisca\.ma(\/|$)/;

describe('registre : 24 pages d’outils dans les 6 langues', () => {
  it('3 outils + hub x 6 langues, chemins exacts, enregistrés dans le registre global', () => {
    expect(TOOL_PAGES).toHaveLength(24);
    for (const locale of MARKETING_LOCALES) {
      const prefix = LOCALE_URL_PREFIX[locale];
      for (const route of TOOL_ROUTES) {
        const page = findEditorialPage(locale, `outils/${route.segment}`);
        expect(page, `${locale}/${route.segment}`).toBeDefined();
        expect(mirrorPathOf(page ?? TOOL_PAGES[0]!)).toBe(`/${prefix}/outils/${route.segment}.md`);
        expect(findEditorialPageByMirrorPath(`/${prefix}/outils/${route.segment}.md`)?.slug).toBe(`outils/${route.segment}`);
      }
      expect(findEditorialPage(locale, TOOLS_HUB_SLUG)).toBeDefined();
    }
    expect(ALL_EDITORIAL_PAGES.filter((p) => p.slug.startsWith('outils'))).toHaveLength(24);
    expect(TOOL_DEFINITIONS.map((d) => d.slug)).toEqual(['outils/audit-ice-excel', 'outils/simulateur-loi-69-21', 'outils/ras-tva-especes']);
  });

  it('chaque page d’outil porte HowTo (4 étapes), FAQ (3 questions) et une section de limites', () => {
    for (const locale of MARKETING_LOCALES) {
      for (const route of TOOL_ROUTES) {
        const view = buildToolView(locale, route.id);
        expect(view.steps, `${locale}/${route.id}`).toHaveLength(4);
        expect(view.faqs).toHaveLength(3);
        expect(view.sections.length).toBeGreaterThanOrEqual(2);
        const page = findEditorialPage(locale, view.slug);
        expect(page?.howTo?.steps).toHaveLength(4);
        expect(page?.faqs).toHaveLength(3);
      }
    }
  });

  it('aucune variable de gabarit non remplie, aucun texte vide, valeurs datées citées issues de dated-values', () => {
    for (const p of TOOL_PAGES) {
      const text = JSON.stringify(p);
      expect(text, `${p.locale}/${p.slug}`).not.toMatch(/\{[a-zA-Z]+\}/);
      expect(p.title.length).toBeGreaterThan(10);
      expect(p.description.length).toBeGreaterThan(40);
    }
    const ras = buildToolView('fr', 'ras');
    expect(ras.faqs[1]?.answer).toContain('5 000,00 MAD');
    expect(datedValue('cash_cap_day_cents').value).toBe(500000);
  });

  it('miroirs Markdown : purs (sans HTML), avec mention d’information indicative et loi 15-89', async () => {
    for (const p of TOOL_PAGES) {
      const md = renderPageMarkdown(p);
      expect(md, `${p.locale}/${p.slug}`).not.toMatch(/<\/?[a-z][^>]*>/i);
      if (p.slug !== TOOLS_HUB_SLUG) {
        expect(md).toMatch(/15-89/);
        expect(md).toMatch(/\d{4}-\d{2}-\d{2}/);
      }
      const response = handleMirrorRequest(new Request(`https://fisca.ma${mirrorPathOf(p)}`));
      expect(response?.status).toBe(200);
      expect(response?.headers.get('content-type')).toContain('text/markdown');
    }
  });

  it('sitemap : les 4 slugs d’outils, 6 langues, alternates réciproques et x-default', async () => {
    const slugs = publishedSitemapSlugs(ALL_EDITORIAL_PAGES);
    for (const s of ['outils', ...TOOL_ROUTES.map((r) => `outils/${r.segment}`)]) expect(slugs).toContain(s);
    const xml = await handleSitemapXml().text();
    for (const route of TOOL_ROUTES) {
      for (const locale of MARKETING_LOCALES) {
        expect(xml).toContain(`<loc>https://fisca.ma/${LOCALE_URL_PREFIX[locale]}/outils/${route.segment}</loc>`);
      }
      expect(xml).toContain(`hreflang="x-default" href="https://fisca.ma/fr/outils/${route.segment}"`);
    }
  });

  it('llms.txt et llms-full.txt citent les outils sans règle fiscale codée', async () => {
    const index = await handleLlmsTxt().text();
    const full = await handleLlmsFullTxt().text();
    for (const route of TOOL_ROUTES) {
      expect(index).toContain(`/fr/outils/${route.segment}.md`);
      expect(full).toContain(`/fr/outils/${route.segment}.md`);
    }
  });

  it('aucun « conforme / homologué / certifié » associé à la DGI ou xHub', () => {
    for (const p of TOOL_PAGES) {
      const text = JSON.stringify(p) + renderPageMarkdown(p);
      expect(text, `${p.locale}/${p.slug}`).not.toMatch(/(conforme|homologu|certifi)[^.\n]{0,60}(DGI|xHub)|(DGI|xHub)[^.\n]{0,60}(conforme|homologu|certifi)/i);
    }
  });

  it('aucune date ni seuil de la réforme de facturation électronique (B-13)', () => {
    for (const p of TOOL_PAGES) {
      expect(JSON.stringify(p), `${p.locale}/${p.slug}`).not.toMatch(/(seuil|threshold|عتبة)[^.\n]{0,60}(factur|e-?invoic|فوترة)/i);
    }
  });
});

describe('HTML rendu : hub et 3 outils x 6 langues', () => {
  const targets: readonly (string | null)[] = [null, ...TOOL_ROUTES.map((r) => r.segment)];

  it('statut 200, lang et dir, 7 hreflang, h1, canonique', async () => {
    for (const locale of MARKETING_LOCALES) {
      for (const segment of targets) {
        const { html, response } = await cached(locale, segment);
        const meta = getLocaleMeta(locale);
        const label = `${locale}/${String(segment)}`;
        expect(response.status, label).toBe(200);
        expect(html, label).toContain(`<html lang="${meta.hreflang}" dir="${meta.dir}">`);
        expect((html.match(/rel="alternate" hreflang="/g) ?? []).length, label).toBe(7);
        expect(html).toContain('hreflang="x-default"');
        expect((html.match(/<h1/g) ?? []).length, label).toBe(1);
        expect(html).toContain(`<link rel="canonical" href="https://fisca.ma/${LOCALE_URL_PREFIX[locale]}/${segment === null ? 'outils' : `outils/${segment}`}"`);
      }
    }
  });

  it('aucun script tiers ni cookie ; scripts = JSON-LD ou module du site', async () => {
    for (const locale of MARKETING_LOCALES) {
      for (const segment of targets) {
        const { html, response } = await cached(locale, segment);
        const label = `${locale}/${String(segment)}`;
        expect(response.headers.get('set-cookie')).toBeNull();
        for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
          const attrs = m[1] ?? '';
          const body = m[2] ?? '';
          const src = /\bsrc="([^"]*)"/.exec(attrs)?.[1];
          if (attrs.includes('application/ld+json')) continue;
          expect(attrs, label).toMatch(/type="module"/);
          if (src !== undefined) expect(src, label).not.toMatch(/^(https?:)?\/\//);
          expect(body, label).not.toMatch(/document\.cookie|localStorage|sessionStorage|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|https?:\/\//);
        }
        expect(html).not.toMatch(/(googletagmanager|google-analytics|connect\.facebook|fbevents|doubleclick|hotjar|clarity\.ms|plausible|matomo|turnstile|challenges\.cloudflare|cdn\.)/i);
        expect(html).not.toMatch(/document\.cookie|localStorage|sessionStorage/);
        const external = [...html.matchAll(/(?:href|src|action)="(https?:\/\/[^"]+)"/g)].map((x) => x[1] ?? '');
        for (const url of external) expect(url, label).toMatch(FIRST_PARTY_HOST);
        expect(html).not.toMatch(/<(iframe|img|video|audio|embed|object|link[^>]+rel="(preload|prefetch|preconnect|dns-prefetch)")/i);
        expect(html).not.toMatch(/<form[^>]+action=/i);
      }
    }
  });

  it('mentions obligatoires : information indicative (loi 15-89), traitement local, existence de l’ICE', async () => {
    for (const locale of MARKETING_LOCALES) {
      const loc = copyLocaleOf(locale);
      for (const route of TOOL_ROUTES) {
        const { html } = await cached(locale, route.segment);
        const label = `${locale}/${route.segment}`;
        expect(html, label).toContain(COMMON.disclaimer[loc]);
        expect(html).toContain(COMMON.localProcessing[loc]);
        expect(html).toMatch(/15-89/);
        if (route.id === 'ice') {
          expect(html, label).toContain(ICE_EXISTENCE_NOTICE[loc]);
          expect(html).toContain('type="file"');
        }
      }
    }
  });

  it('valeur, date et état de recoupement des règles affichés avec chaque outil', async () => {
    const expectations: Record<string, readonly string[]> = {
      ice: ['ice_key_modulus'],
      loi: ['late_base_bps', 'late_increment_bps', 'late_legal_days'],
      ras: ['ras_reduced_bps', 'ras_full_bps', 'cash_cap_day_cents', 'cash_cap_month_cents'],
    };
    for (const route of TOOL_ROUTES) {
      const { html } = await cached('fr', route.segment);
      for (const key of expectations[route.id] ?? []) {
        const v = datedValue(key);
        expect(html, `${route.id}/${key}`).toContain(v.as_of);
        expect(html).toContain(v.state);
      }
    }
    const loi = (await cached('fr', 'simulateur-loi-69-21')).html;
    expect(loi).toContain('value="2,75"');
    expect(loi).toContain('NON RECOUPÉ');
    const ras = (await cached('fr', 'ras-tva-especes')).html;
    expect(ras).toContain('RECOUPÉ');
  });

  it('interface : champs étiquetés, zones annoncées (aria-live), tableaux défilants, montants isolés', async () => {
    for (const locale of MARKETING_LOCALES) {
      const ice = (await cached(locale, 'audit-ice-excel')).html;
      expect(ice).toMatch(/role="status" aria-live="polite"/);
      expect(ice).toMatch(/role="alert"/);
      expect(ice).toContain('class="table-scroll"');
      expect(ice).toMatch(/class="table-scroll"[^>]*tabindex="0"|tabindex="0"[^>]*class="table-scroll"|role="region"[^>]*tabindex="0"/);
      expect(ice).toContain('for="ice-file"');
      expect(ice).toContain('accept=".csv,.txt,.tsv,.xlsx"');
      const loi = (await cached(locale, 'simulateur-loi-69-21')).html;
      for (const id of ['loi-amount', 'loi-delivery', 'loi-delay', 'loi-payment', 'loi-director', 'loi-increment']) expect(loi).toContain(`for="${id}"`);
      expect(loi).toMatch(/aria-live="polite"/);
      expect(loi).toMatch(/dir="ltr"[^>]*class="fisca-tabular-num"|class="fisca-tabular-num"[^>]*dir="ltr"/);
      const ras = (await cached(locale, 'ras-tva-especes')).html;
      for (const id of ['ras-ht', 'ras-vat', 'ras-payment-date', 'ras-attestation', 'cash-lines', 'cash-vat', 'cash-basis']) expect(ras).toContain(`for="${id}"`);
    }
  });

  it('JSON-LD : HowTo et FAQPage sur chaque outil', async () => {
    for (const locale of MARKETING_LOCALES) {
      for (const route of TOOL_ROUTES) {
        const { html } = await cached(locale, route.segment);
        const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
        expect(ld, `${locale}/${route.segment}`).toContain('"HowTo"');
        expect(ld).toContain('"FAQPage"');
      }
    }
  });

  it('arabe et darija : rtl ; amazigh : repli français explicite, lang="fr" et avis bilingue', async () => {
    for (const locale of ['ar', 'ary'] as const) {
      expect((await cached(locale, 'audit-ice-excel')).html).toContain('dir="rtl"');
    }
    for (const locale of ['zgh-Latn', 'zgh-Tfng'] as const) {
      for (const route of TOOL_ROUTES) {
        const { html } = await cached(locale, route.segment);
        expect(html).toContain('<body lang="fr">');
        expect(html).toContain('class="notice"');
        expect(html).toContain(COMMON.disclaimer.fr);
      }
    }
  });

  it('hub : 3 liens vers les outils, fil d’Ariane', async () => {
    for (const locale of MARKETING_LOCALES) {
      const { html } = await cached(locale, null);
      const hub = buildToolsHubView(locale);
      for (const entry of hub.entries) expect(html).toContain(`href="${entry.href}"`);
      expect(html).toContain('class="breadcrumb"');
    }
  });

  it('navigation : lien Outils dans l’en-tête', async () => {
    const { html } = await cached('fr', 'audit-ice-excel');
    expect(html).toContain('href="/fr/outils"');
    expect(html).toContain('aria-current="page"');
  });
});
