import { copyLocaleOf } from './copy-locale.ts';
import type { CopyLocale } from './copy-locale.ts';
import type { MarketingLocale } from './locales.ts';

/** Textes partagés par l'en-tête, le pied de page et le sélecteur de langue. */
export interface SiteCopy {
  readonly skipLink: string;
  readonly navLabel: string;
  readonly navHome: string;
  readonly navPricing: string;
  readonly navPrivacy: string;
  readonly languageLabel: string;
  readonly footerPublisherLabel: string;
  readonly footerContactLabel: string;
  readonly footerLawLabel: string;
  readonly footerLawValue: string;
  readonly footerNoTracking: string;
  readonly footerPriceNote: string;
  readonly cndpReferenceLabel: string;
  readonly cndpPending: string;
  /** Texte alternatif de la marque. */
  readonly brandLabel: string;
}

const FR: SiteCopy = {
  skipLink: 'Aller au contenu',
  navLabel: 'Navigation principale',
  navHome: 'Accueil',
  navPricing: 'Tarifs',
  navPrivacy: 'Confidentialité',
  languageLabel: 'Langue',
  footerPublisherLabel: 'Éditeur',
  footerContactLabel: 'Données personnelles',
  footerLawLabel: 'Cadre légal',
  footerLawValue: 'Loi n° 09-08 (CNDP)',
  footerNoTracking: 'Aucun cookie, aucun pixel ni script tiers sur ce site.',
  footerPriceNote: 'Prix en dirhams (MAD), hors taxes.',
  cndpReferenceLabel: 'Référence CNDP',
  cndpPending: 'à renseigner par le propriétaire',
  brandLabel: 'Fisca, accueil',
};

const AR: SiteCopy = {
  skipLink: 'انتقل إلى المحتوى',
  navLabel: 'التنقل الرئيسي',
  navHome: 'الرئيسية',
  navPricing: 'الأسعار',
  navPrivacy: 'الخصوصية',
  languageLabel: 'اللغة',
  footerPublisherLabel: 'الناشر',
  footerContactLabel: 'المعطيات الشخصية',
  footerLawLabel: 'الإطار القانوني',
  footerLawValue: 'القانون رقم 09-08 (اللجنة الوطنية CNDP)',
  footerNoTracking: 'لا ملفات تعريف ارتباط ولا بكسلات ولا سكريبتات تابعة لأطراف ثالثة في هذا الموقع.',
  footerPriceNote: 'الأسعار بالدرهم (MAD) دون احتساب الضريبة.',
  cndpReferenceLabel: 'مرجع اللجنة الوطنية CNDP',
  cndpPending: 'يملؤه مالك المشروع',
  brandLabel: 'فيسكا، الصفحة الرئيسية',
};

const ARY: SiteCopy = {
  skipLink: 'سير للمحتوى',
  navLabel: 'التنقل الرئيسي',
  navHome: 'الرئيسية',
  navPricing: 'الأثمنة',
  navPrivacy: 'الخصوصية',
  languageLabel: 'اللغة',
  footerPublisherLabel: 'الناشر',
  footerContactLabel: 'المعطيات الشخصية',
  footerLawLabel: 'الإطار القانوني',
  footerLawValue: 'القانون 09-08 (CNDP)',
  footerNoTracking: 'ما كاين حتى كوكي ولا بيكسل ولا سكريبت ديال طرف تالت فهاد الموقع.',
  footerPriceNote: 'الأثمنة بالدرهم (MAD) وبلا TVA.',
  cndpReferenceLabel: 'مرجع CNDP',
  cndpPending: 'خاص المالك يعمرو',
  brandLabel: 'فيسكا، الصفحة الرئيسية',
};

const EN: SiteCopy = {
  skipLink: 'Skip to content',
  navLabel: 'Main navigation',
  navHome: 'Home',
  navPricing: 'Pricing',
  navPrivacy: 'Privacy',
  languageLabel: 'Language',
  footerPublisherLabel: 'Publisher',
  footerContactLabel: 'Personal data',
  footerLawLabel: 'Legal framework',
  footerLawValue: 'Law No. 09-08 (CNDP)',
  footerNoTracking: 'No cookies, no third-party pixels or scripts on this site.',
  footerPriceNote: 'Prices in Moroccan dirhams (MAD), excluding tax.',
  cndpReferenceLabel: 'CNDP reference',
  cndpPending: 'to be filled in by the owner',
  brandLabel: 'Fisca, home',
};

const SITE_COPY: Readonly<Record<CopyLocale, SiteCopy>> = { fr: FR, ar: AR, ary: ARY, en: EN };

export function getSiteCopy(locale: MarketingLocale): SiteCopy {
  return SITE_COPY[copyLocaleOf(locale)];
}

/** Avis affiché en tête de page quand le texte est en français faute de version amazighe publiée. */
export const FALLBACK_NOTICE = {
  fr: 'Cette page est affichée en français : la version amazighe (IRCAM) n’est pas encore publiée.',
  ar: 'تُعرض هذه الصفحة بالفرنسية: النسخة الأمازيغية (IRCAM) غير منشورة بعد.',
} as const;

/** Noms des langues dans leur propre langue (sélecteur de langue). */
export const LANGUAGE_NATIVE_NAMES: Readonly<Record<MarketingLocale, string>> = {
  fr: 'Français',
  ar: 'العربية',
  ary: 'الدارجة',
  'zgh-Latn': 'Tamaziɣt',
  'zgh-Tfng': 'ⵜⴰⵎⴰⵣⵉⵖⵜ',
  en: 'English',
};
