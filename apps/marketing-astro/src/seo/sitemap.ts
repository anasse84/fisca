import type { EditorialPage } from '../content/pages.ts';
import { buildCanonicalUrl, buildMultilingualAlternates } from '../i18n/hreflang.ts';
import { MARKETING_LOCALES } from '../i18n/locales.ts';
import type { MarketingLocale } from '../i18n/locales.ts';

function xmlEscape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Langues listées au sitemap pour un slug : les 6 par défaut, ou `indexLocales` (Silo 3 : fr, ar, en). */
export function sitemapLocalesOf(page: EditorialPage): readonly MarketingLocale[] {
  return page.indexLocales ?? MARKETING_LOCALES;
}

/**
 * Routes publiées : un slug dont les 6 langues existent et ne sont pas en noindex (seuil de qualité Doc_18 S10).
 * Aucun `lastmod` : aucune date de modification n'est fabriquée.
 */
export function publishedSitemapSlugs(pages: readonly EditorialPage[]): readonly string[] {
  const slugs: string[] = [];
  for (const page of pages) {
    if (page.locale !== 'fr' || slugs.includes(page.slug)) continue;
    const siblings = sitemapLocalesOf(page).map((loc) => pages.find((p) => p.locale === loc && p.slug === page.slug));
    if (siblings.every((p) => p !== undefined && p.noindex !== true)) slugs.push(page.slug);
  }
  return slugs;
}

/** /sitemap.xml : chaque URL des 6 langues porte les alternates hreflang des 6 langues et x-default. */
export function buildSitemapXml(pages: readonly EditorialPage[]): string {
  const entries: string[] = [];
  for (const slug of publishedSitemapSlugs(pages)) {
    const alternates = buildMultilingualAlternates(slug)
      .map((alt) => `    <xhtml:link rel="alternate" hreflang="${xmlEscape(alt.hreflang)}" href="${xmlEscape(alt.href)}" />`)
      .join('\n');
    const first = pages.find((p) => p.slug === slug && p.locale === 'fr');
    const locales = first === undefined ? MARKETING_LOCALES : sitemapLocalesOf(first);
    for (const locale of locales) {
      entries.push(`  <url>\n    <loc>${xmlEscape(buildCanonicalUrl(locale, slug))}</loc>\n${alternates}\n  </url>`);
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}
