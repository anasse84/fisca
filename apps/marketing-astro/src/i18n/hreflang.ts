import { LOCALE_URL_PREFIX, DEFAULT_LOCALE, getLocaleMeta } from './locales.ts';
import type { MarketingLocale } from './locales.ts';

export const SITE_ORIGIN = 'https://fisca.ma';

export interface HreflangLink {
  readonly hreflang: string;
  readonly href: string;
}

const ALL_LOCALES: readonly MarketingLocale[] = ['fr', 'ar', 'ary', 'zgh-Latn', 'zgh-Tfng', 'en'];
const INSTITUTIONAL_LOCALES: readonly MarketingLocale[] = ['fr', 'ar', 'en'];

function cleanSlugOf(slug: string): string {
  return slug.replace(/^\/+/, '');
}

export function buildCanonicalUrl(locale: MarketingLocale, slug: string): string {
  return `${SITE_ORIGIN}/${LOCALE_URL_PREFIX[locale]}/${cleanSlugOf(slug)}`;
}

/** Alternates réciproques + x-default (Doc_18 S11, ERRATA § C). */
export function buildMultilingualAlternates(
  slug: string,
  allSixLocalesAvailable = true,
  onlyLocales?: readonly MarketingLocale[],
): readonly HreflangLink[] {
  const active = onlyLocales ?? (allSixLocalesAvailable ? ALL_LOCALES : INSTITUTIONAL_LOCALES);
  const links: HreflangLink[] = active.map((loc) => ({
    hreflang: getLocaleMeta(loc).hreflang,
    href: buildCanonicalUrl(loc, slug),
  }));
  links.push({ hreflang: 'x-default', href: buildCanonicalUrl(DEFAULT_LOCALE, slug) });
  return links;
}
