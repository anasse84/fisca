import { describe, expect, it } from 'vitest';
import { ALL_EDITORIAL_PAGES, findEditorialPage } from '../src/content/pages.ts';
import { buildCanonicalUrl, buildMultilingualAlternates } from '../src/i18n/hreflang.ts';
import { handleSitemapXml } from '../src/seo/handlers.ts';

/** Les alternates émis par le layout : `indexLocales` de la page quand il existe, sinon les 6 langues (BaseLayout.astro). */
function emittedAlternates(locale: Parameters<typeof findEditorialPage>[0], slug: string) {
  return buildMultilingualAlternates(slug, true, findEditorialPage(locale, slug)?.indexLocales);
}

describe('hreflang : une page indexable ne référence jamais une URL noindex ou hors sitemap', () => {
  it('toutes les pages indexables du registre', async () => {
    const xml = await handleSitemapXml().text();
    const locs = new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? ''));
    let checked = 0;
    for (const page of ALL_EDITORIAL_PAGES) {
      if (page.noindex === true) continue;
      for (const alt of emittedAlternates(page.locale, page.slug)) {
        const id = `${page.locale}/${page.slug} -> ${alt.hreflang}`;
        expect(locs.has(alt.href), `${id} absent du sitemap`).toBe(true);
        const target = ALL_EDITORIAL_PAGES.find((p) => alt.href === buildCanonicalUrl(p.locale, p.slug));
        expect(target, `${id} sans page`).toBeDefined();
        expect(target?.noindex, `${id} en noindex`).not.toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('une fiche de compte n’émet que fr, ar, en et x-default', () => {
    const hreflangs = emittedAlternates('fr', 'dictionnaire-cgnc/compte-1111').map((a) => a.hreflang);
    expect(hreflangs).toEqual(['fr', 'ar', 'en', 'x-default']);
  });

  it('le sitemap porte les mêmes alternates que la page (jamais ary ni zgh pour une fiche)', async () => {
    const xml = await handleSitemapXml().text();
    const block = xml.split('<url>').find((b) => b.includes('<loc>https://fisca.ma/en/dictionnaire-cgnc/compte-1111</loc>')) ?? '';
    expect(block).not.toBe('');
    expect(block).not.toMatch(/hreflang="(ary|zgh-Latn|zgh-Tfng)"/);
  });
});
