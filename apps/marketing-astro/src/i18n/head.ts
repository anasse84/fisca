import { buildCanonicalUrl, buildMultilingualAlternates } from './hreflang.ts';
import type { HreflangLink } from './hreflang.ts';
import { getLocaleMeta, localeFromPrefix } from './locales.ts';
import type { MarketingLocale, TextDirection } from './locales.ts';

export interface PageHead {
  readonly htmlLang: string;
  readonly dir: TextDirection;
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
  readonly alternates: readonly HreflangLink[];
}

export interface PageHeadInput {
  readonly title: string;
  readonly description: string;
  /** Langues indexables de la page (hreflang réciproques) ; absent = les 6 langues. */
  readonly alternateLocales?: readonly MarketingLocale[];
}

export function buildPageHead(locale: MarketingLocale, slug: string, input: PageHeadInput): PageHead {
  const meta = getLocaleMeta(locale);
  return {
    htmlLang: meta.hreflang,
    dir: meta.dir,
    title: input.title,
    description: input.description,
    canonical: buildCanonicalUrl(locale, slug),
    alternates: buildMultilingualAlternates(slug, true, input.alternateLocales),
  };
}

export interface LocalizedPath {
  readonly locale: MarketingLocale;
  readonly slug: string;
}

export function splitLocalizedPath(pathname: string): LocalizedPath | null {
  const segments = pathname.split('/').filter((s) => s.length > 0);
  const locale = localeFromPrefix(segments[0]);
  if (locale === null) return null;
  return { locale, slug: segments.slice(1).join('/') };
}
