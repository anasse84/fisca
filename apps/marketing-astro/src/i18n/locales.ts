export type MarketingLocale = 'fr' | 'ar' | 'ary' | 'zgh-Latn' | 'zgh-Tfng' | 'en';
export type TextDirection = 'ltr' | 'rtl';
export type LocaleScript = 'Latn' | 'Arab' | 'Tfng';

export interface LocaleMeta {
  readonly code: MarketingLocale;
  /** Segment d'URL : https://fisca.ma/<prefix>/... (Doc_18 S02 et S11) */
  readonly prefix: string;
  readonly dir: TextDirection;
  /** Tag BCP 47 utilisé pour hreflang et <html lang> */
  readonly hreflang: string;
  readonly script: LocaleScript;
}

export const MARKETING_LOCALES: readonly MarketingLocale[] = ['fr', 'ar', 'ary', 'zgh-Latn', 'zgh-Tfng', 'en'];

export const DEFAULT_LOCALE: MarketingLocale = 'fr';

export const LOCALE_URL_PREFIX: Readonly<Record<MarketingLocale, string>> = {
  fr: 'fr',
  ar: 'ar',
  ary: 'ary',
  'zgh-Latn': 'zgh',
  'zgh-Tfng': 'zgh-tfng',
  en: 'en',
};

/** Doc_08 S07 : RTL pour ar et ary uniquement ; le Tifinagh s'écrit de gauche à droite. */
const LOCALE_META: Readonly<Record<MarketingLocale, LocaleMeta>> = {
  fr: { code: 'fr', prefix: 'fr', dir: 'ltr', hreflang: 'fr', script: 'Latn' },
  ar: { code: 'ar', prefix: 'ar', dir: 'rtl', hreflang: 'ar', script: 'Arab' },
  ary: { code: 'ary', prefix: 'ary', dir: 'rtl', hreflang: 'ary', script: 'Arab' },
  'zgh-Latn': { code: 'zgh-Latn', prefix: 'zgh', dir: 'ltr', hreflang: 'zgh-Latn', script: 'Latn' },
  'zgh-Tfng': { code: 'zgh-Tfng', prefix: 'zgh-tfng', dir: 'ltr', hreflang: 'zgh-Tfng', script: 'Tfng' },
  en: { code: 'en', prefix: 'en', dir: 'ltr', hreflang: 'en', script: 'Latn' },
};

export function getLocaleMeta(locale: MarketingLocale): LocaleMeta {
  return LOCALE_META[locale];
}

export function localeFromPrefix(prefix: string | undefined): MarketingLocale | null {
  if (prefix === undefined) return null;
  for (const loc of MARKETING_LOCALES) {
    if (LOCALE_URL_PREFIX[loc] === prefix) return loc;
  }
  return null;
}
