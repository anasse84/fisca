import { getHomeCopy, isFallbackCopy } from '../i18n/home-copy.ts';
import { LOCALE_URL_PREFIX, MARKETING_LOCALES, localeFromPrefix } from '../i18n/locales.ts';
import type { MarketingLocale } from '../i18n/locales.ts';
import { buildCanonicalUrl } from '../i18n/hreflang.ts';

export interface EditorialSection {
  readonly heading: string;
  readonly body: string;
}

/** Page éditoriale : source unique du HTML, du miroir Markdown, de llms.txt et du graphe JSON-LD. */
export interface EditorialPage {
  readonly locale: MarketingLocale;
  /** Sans préfixe de langue ; chaîne vide pour l'accueil. */
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly heading: string;
  readonly lead: string;
  /** Langue réelle du texte (repli français tant que la rédaction IRCAM n'est pas livrée). */
  readonly contentLanguage: 'fr' | 'ar' | 'ary' | 'en';
  readonly sections: readonly EditorialSection[];
}

function contentLanguageOf(locale: MarketingLocale): EditorialPage['contentLanguage'] {
  if (isFallbackCopy(locale)) return 'fr';
  switch (locale) {
    case 'ar':
      return 'ar';
    case 'ary':
      return 'ary';
    case 'en':
      return 'en';
    case 'fr':
    case 'zgh-Latn':
    case 'zgh-Tfng':
      return 'fr';
  }
}

function homePage(locale: MarketingLocale): EditorialPage {
  const copy = getHomeCopy(locale);
  return {
    locale,
    slug: '',
    title: copy.title,
    description: copy.description,
    heading: copy.heading,
    lead: copy.lead,
    contentLanguage: contentLanguageOf(locale),
    sections: [],
  };
}

/** T-P2C-02 : l'accueil des 6 langues ; les silos s'ajoutent aux tickets suivants. */
export const EDITORIAL_PAGES: readonly EditorialPage[] = MARKETING_LOCALES.map(homePage);

export function findEditorialPage(locale: MarketingLocale, slug: string): EditorialPage | undefined {
  const clean = slug.replace(/^\/+|\/+$/g, '');
  return EDITORIAL_PAGES.find((p) => p.locale === locale && p.slug === clean);
}

/** `/fr/`, `/fr`, `/fr/guides/x/` -> page du registre (chemin HTML, pas le jumeau .md). */
export function findEditorialPageByPath(pathname: string): EditorialPage | undefined {
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const locale = localeFromPrefix(segments[0]);
  if (locale === null) return undefined;
  return findEditorialPage(locale, segments.slice(1).join('/'));
}

/** Chemin du jumeau Markdown : `/fr/index.md` pour l'accueil, `/fr/<slug>.md` sinon. */
export function mirrorPathOf(page: EditorialPage): string {
  const prefix = LOCALE_URL_PREFIX[page.locale];
  return page.slug === '' ? `/${prefix}/index.md` : `/${prefix}/${page.slug}.md`;
}

/** `/fr/index.md` -> accueil fr ; `/fr/guides/x.md` -> slug `guides/x`. */
export function findEditorialPageByMirrorPath(pathname: string): EditorialPage | undefined {
  if (!pathname.endsWith('.md')) return undefined;
  const segments = pathname.slice(0, -3).split('/').filter((s) => s.length > 0);
  const locale = localeFromPrefix(segments[0]);
  if (locale === null) return undefined;
  const rest = segments.slice(1);
  if (rest.length === 1 && rest[0] === 'index') return findEditorialPage(locale, '');
  if (rest.length === 0) return undefined;
  return findEditorialPage(locale, rest.join('/'));
}

export function canonicalUrlOf(page: EditorialPage): string {
  return buildCanonicalUrl(page.locale, page.slug);
}
