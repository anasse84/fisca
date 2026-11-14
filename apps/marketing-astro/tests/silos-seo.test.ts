import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import SiloRoute from '../src/pages/[locale]/[...slug].astro';
import { ALL_EDITORIAL_PAGES, findEditorialPage, mirrorPathOf } from '../src/content/pages.ts';
import { BILLING_POLICY } from '../src/content/billing-policy.ts';
import type { BillingPolicy } from '../src/content/billing-policy.ts';
import { assessQuality } from '../src/content/silos/build.ts';
import { SILOS, SILO_ROUTES, buildSiloViewBySlug } from '../src/content/silos/registry.ts';
import { buildPricingView } from '../src/content/pricing-view.ts';
import { buildCanonicalUrl } from '../src/i18n/hreflang.ts';
import { LOCALE_URL_PREFIX, MARKETING_LOCALES } from '../src/i18n/locales.ts';
import type { MarketingLocale } from '../src/i18n/locales.ts';
import { handleLlmsFullTxt, handleLlmsTxt, handleMirrorRequest, handleSitemapXml } from '../src/seo/handlers.ts';
import { publishedSitemapSlugs } from '../src/seo/sitemap.ts';

const INDEXABLE: readonly string[] = SILO_ROUTES.filter((r) => buildSiloViewBySlug('fr', r.slug)?.quality.indexable === true).map((r) => r.slug);
const NOINDEX: readonly string[] = SILO_ROUTES.filter((r) => buildSiloViewBySlug('fr', r.slug)?.quality.indexable !== true).map((r) => r.slug);

const MIN_POLICY: BillingPolicy = { fiduciaryProrata: 'MINIMUM_BILLED_MONTH' };

async function render(locale: MarketingLocale, slug: string): Promise<{ html: string; status: number }> {
  const container = await AstroContainer.create();
  const prefix = LOCALE_URL_PREFIX[locale];
  const response = await container.renderToResponse(SiloRoute, {
    params: { locale: prefix, slug },
    request: new Request(`https://fisca.ma/${prefix}/${slug}`),
  });
  return { html: await response.text(), status: response.status };
}

describe('seuil de qualité Doc_18 S10 : noindex et sitemap', () => {
  it('78 routes : indexable <=> seuil atteint <=> dans le sitemap, noindex sinon, dans les 6 langues', () => {
    const slugs = new Set(publishedSitemapSlugs(ALL_EDITORIAL_PAGES));
    let indexable = 0;
    for (const route of SILO_ROUTES) {
      const view = buildSiloViewBySlug('fr', route.slug);
      expect(view, route.slug).toBeDefined();
      const ok = view?.quality.indexable === true;
      expect(view?.quality.missing.length === 0, route.slug).toBe(ok);
      expect(slugs.has(route.slug), route.slug).toBe(ok);
      if (ok) indexable += 1;
      for (const locale of MARKETING_LOCALES) expect(findEditorialPage(locale, route.slug)?.noindex, `${locale}/${route.slug}`).toBe(!ok);
    }
    expect(indexable).toBe(INDEXABLE.length);
    expect(indexable + NOINDEX.length).toBe(78);
  });

  it('une page sans information propre (cas chiffré, sources, FAQ absents) est noindex', () => {
    const base = buildSiloViewBySlug('fr', SILO_ROUTES[0]?.slug ?? '');
    expect(base).toBeDefined();
    if (base === undefined) return;
    const poor = assessQuality({ ...base, case: null, sources: [], faqs: [] });
    expect(poor.indexable).toBe(false);
    expect(poor.missing).toEqual(expect.arrayContaining(['cas chiffré', 'sources', 'faq']));
  });

  it('une page sous le seuil sort du sitemap et du llms-full', () => {
    const target = SILO_ROUTES[0]?.slug ?? '';
    const degraded = ALL_EDITORIAL_PAGES.map((p) => (p.slug === target && p.locale === 'ar' ? { ...p, noindex: true } : p));
    expect(publishedSitemapSlugs(degraded)).not.toContain(target);
    expect(publishedSitemapSlugs(ALL_EDITORIAL_PAGES)).toContain(target);
  });

  it('/sitemap.xml : pages indexables x 6 langues, alternates hreflang des 6 langues et x-default', async () => {
    const xml = await handleSitemapXml().text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const indexableRoutes = SILO_ROUTES.filter((r) => buildSiloViewBySlug('fr', r.slug)?.quality.indexable === true).length;
    // 3 pages du socle + 4 hubs de silo + 7 pages d'outils (hub + 6 outils, T-P2C-06 et T-P2C-07) + les routes de silos indexables.
    expect(locs).toHaveLength(6 * (3 + 4 + 7 + indexableRoutes));
    for (const route of SILO_ROUTES.filter((r) => buildSiloViewBySlug('fr', r.slug)?.quality.indexable !== true)) expect(xml).not.toContain(`/${route.slug}`);
    expect(new Set(locs).size).toBe(locs.length);
    const siloPage = xml.split('<url>').find((b) => b.includes(`<loc>${buildCanonicalUrl('en', INDEXABLE[0] ?? '')}</loc>`)) ?? '';
    expect((siloPage.match(/hreflang="/g) ?? []).length).toBe(7);
    for (const hreflang of ['fr', 'ar', 'x-default']) expect(siloPage).toContain(`hreflang="${hreflang}"`);
  });
});

describe('miroirs Markdown et llms', () => {
  it('chaque page de silo a son miroir .md servi (468 + 24)', async () => {
    const pages = ALL_EDITORIAL_PAGES.filter((p) => SILOS.some((s) => p.slug === s.slug || p.slug.startsWith(`${s.slug}/`)));
    expect(pages).toHaveLength(492);
    for (const page of pages) {
      const res = handleMirrorRequest(new Request(`https://fisca.ma${mirrorPathOf(page)}`));
      expect(res?.status, mirrorPathOf(page)).toBe(200);
    }
    const sample = findEditorialPage('fr', SILO_ROUTES[0]?.slug ?? '');
    const body = await handleMirrorRequest(new Request(`https://fisca.ma${sample === undefined ? '' : mirrorPathOf(sample)}`))?.text();
    expect(body).toContain(`# ${sample?.heading ?? ''}`);
  });

  it('llms.txt liste les 4 hubs et l’arbre des guides indexables (les noindex en sont absents) ; llms-full contient les 6 langues', async () => {
    const short = await handleLlmsTxt().text();
    for (const silo of SILOS) expect(short).toContain(`/fr/${silo.slug}`);
    for (const slug of INDEXABLE) expect(short, slug).toContain(`/fr/${slug}`);
    for (const slug of NOINDEX) expect(short, slug).not.toContain(slug);
    const full = await handleLlmsFullTxt().text();
    for (const slug of INDEXABLE) expect(full, slug).toContain(`/fr/${slug}`);
    for (const slug of NOINDEX) expect(full, slug).not.toContain(slug);
    for (const prefix of ['ar', 'ary', 'zgh', 'zgh-tfng', 'en']) expect(full).toContain(`/${prefix}/${INDEXABLE[0] ?? ''}`);
  });
});

describe('HTML rendu d’une page par silo et d’un hub, en fr et ar', () => {
  const samples = SILOS.flatMap((s) => [s.slug, INDEXABLE.find((x) => x.startsWith(`${s.slug}/`)) ?? '']);
  it('une page noindex porte robots noindex dans le HTML et X-Robots-Tag dans le miroir', async () => {
    const slug = NOINDEX[0] ?? '';
    expect(slug).not.toBe('');
    const { html } = await render('fr', slug);
    expect(html).toContain('<meta name="robots" content="noindex, follow"');
    const page = findEditorialPage('fr', slug);
    const res = handleMirrorRequest(new Request(`https://fisca.ma${page === undefined ? '' : mirrorPathOf(page)}`));
    expect(res?.headers.get('x-robots-tag')).toBe('noindex, follow');
  });

  it('200, h1, canonical, 6 hreflang + x-default, JSON-LD valide, aucun script ni cookie tiers', async () => {
    for (const locale of ['fr', 'ar', 'ary', 'zgh-Latn', 'zgh-Tfng', 'en'] as const) {
      for (const slug of samples) {
        const { html, status } = await render(locale, slug);
        const id = `${locale}/${slug}`;
        expect(status, id).toBe(200);
        expect(html, id).toContain('<h1');
        expect(html, id).toContain(`rel="canonical" href="${buildCanonicalUrl(locale, slug)}"`);
        expect((html.match(/rel="alternate" hreflang="/g) ?? []).length, id).toBe(7);
        expect(html, id).not.toContain('noindex');
        const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
        expect(scripts.length, id).toBeGreaterThan(0);
        for (const m of scripts) {
          expect(m[1], id).toContain('application/ld+json');
          expect(m[1], id).not.toMatch(/\bsrc=/i);
          expect(() => JSON.parse(m[2] ?? '')).not.toThrow();
        }
        expect(html, id).not.toMatch(/document\.cookie|googletagmanager|google-analytics|doubleclick|hotjar|plausible|fonts\.googleapis/i);
      }
    }
  });

  it('RTL pour ar et ary, montants en dir=ltr', async () => {
    for (const locale of ['ar', 'ary'] as const) {
      const { html } = await render(locale, INDEXABLE.find((x) => x.startsWith(`${SILOS[2]?.slug ?? ''}/`)) ?? '');
      expect(html).toContain('dir="rtl"');
      expect(html).toMatch(/dir="ltr"[^>]*class="[^"]*fisca-tabular-num|class="[^"]*fisca-tabular-num[^"]*"[^>]*dir="ltr"/);
    }
  });
});

describe('prorata fiduciaire : source unique billing-policy.ts', () => {
  it('par défaut : prorata journalier', () => {
    expect(BILLING_POLICY.fiduciaryProrata).toBe('DAILY');
  });

  it('changer le champ change la grille tarifaire et les pages du Silo 4 qui le portent', () => {
    const daily = buildPricingView('fr', BILLING_POLICY);
    const monthly = buildPricingView('fr', MIN_POLICY);
    expect(JSON.stringify(daily)).toContain('prorata journalier');
    expect(JSON.stringify(monthly)).not.toContain('prorata journalier');
    const oec = SILOS[2]?.pages ?? [];
    let changed = 0;
    for (const spec of oec) {
      const a = buildSiloViewBySlug('fr', `${SILOS[2]?.slug ?? ''}/${spec.slug}`, BILLING_POLICY);
      const b = buildSiloViewBySlug('fr', `${SILOS[2]?.slug ?? ''}/${spec.slug}`, MIN_POLICY);
      if (JSON.stringify(a) !== JSON.stringify(b)) changed += 1;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('« prorata journalier » n’est écrit que dans billing-policy.ts', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|astro)$/.test(name) && /prorata journalier/i.test(readFileSync(p, 'utf8'))) hits.push(p);
      }
    };
    walk(join(import.meta.dirname, '..', 'src'));
    expect(hits.map((h) => h.split('/').slice(-1)[0])).toEqual(['billing-policy.ts']);
  });
});
