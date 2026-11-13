import { getLocaleMeta } from './locales.ts';
import type { MarketingLocale } from './locales.ts';

export interface HomeCopy {
  readonly title: string;
  readonly description: string;
  readonly heading: string;
  readonly lead: string;
}

const FR: HomeCopy = {
  title: 'Fisca — Facturation et comptabilité pour les entreprises marocaines',
  description: 'Fisca simplifie la facturation, la TVA et la comptabilité CGNC des PME, TPE et indépendants au Maroc.',
  heading: 'Facturation et comptabilité pour les entreprises marocaines',
  lead: 'Le contenu complet de cette page arrive prochainement.',
};

const AR: HomeCopy = {
  title: 'فيسكا — الفوترة والمحاسبة للمقاولات المغربية',
  description: 'تبسّط فيسكا الفوترة والضريبة على القيمة المضافة والمحاسبة وفق المخطط المحاسبي المغربي للمقاولات الصغيرة والمتوسطة.',
  heading: 'الفوترة والمحاسبة للمقاولات المغربية',
  lead: 'سيتوفر المحتوى الكامل لهذه الصفحة قريبا.',
};

const ARY: HomeCopy = {
  title: 'فيسكا — الفاتورة والمحاسبة للمقاولات فالمغرب',
  description: 'فيسكا كتسهّل عليك الفاتورة والـTVA والمحاسبة ديال الشركة الصغيرة والمتوسطة فالمغرب.',
  heading: 'الفاتورة والمحاسبة للمقاولات فالمغرب',
  lead: 'المحتوى الكامل ديال هاد الصفحة جاي قريب.',
};

const EN: HomeCopy = {
  title: 'Fisca — Invoicing and accounting for Moroccan businesses',
  description: 'Fisca simplifies invoicing, VAT and CGNC accounting for small and medium businesses and freelancers in Morocco.',
  heading: 'Invoicing and accounting for Moroccan businesses',
  lead: 'The full content of this page is coming soon.',
};

/**
 * Repli terminologique de Doc_08 S07 : zgh-Latn et zgh-Tfng retombent sur le français
 * tant que la rédaction IRCAM n'est pas livrée (T-P2C-03).
 */
export function getHomeCopy(locale: MarketingLocale): HomeCopy {
  switch (locale) {
    case 'ar':
      return AR;
    case 'ary':
      return ARY;
    case 'en':
      return EN;
    case 'fr':
    case 'zgh-Latn':
    case 'zgh-Tfng':
      return FR;
  }
}

export function isFallbackCopy(locale: MarketingLocale): boolean {
  return getHomeCopy(locale) === FR && getLocaleMeta(locale).code !== 'fr';
}
