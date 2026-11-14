import type { MarketingLocale } from './locales.ts';

/** Langues pour lesquelles un texte est réellement rédigé. */
export type CopyLocale = 'fr' | 'ar' | 'ary' | 'en';

/**
 * Doc_08 S07 : zgh-Latn et zgh-Tfng retombent sur le français (chaîne de repli terminologique fiscal)
 * tant que la rédaction IRCAM n'est pas livrée et relue : le repli est explicite, jamais silencieux.
 */
export function copyLocaleOf(locale: MarketingLocale): CopyLocale {
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

export function usesFrenchFallback(locale: MarketingLocale): boolean {
  return (locale === 'zgh-Latn' || locale === 'zgh-Tfng') && copyLocaleOf(locale) === 'fr';
}

/** Remplace `{nom}` par la valeur ; une variable absente lève une erreur (pas de texte à trous publié). */
export function fill(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new RangeError(`Variable de gabarit manquante : ${name}`);
    return value;
  });
}
