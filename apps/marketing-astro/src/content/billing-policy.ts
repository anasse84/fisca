/**
 * Politique de facturation fiduciaire : UNIQUE source du choix de prorata (décision du pilote).
 *
 * Question ouverte du propriétaire : « prorata journalier ou mois minimum facturé ».
 * Doc_03 S04 décrit les deux à la fois (prorata temporis journalier à la création d'un dossier, et durée
 * minimale de facturation d'un mois complet) ; le pilote retient provisoirement le prorata journalier, qui
 * est aussi celui des vecteurs de Doc_03 S12 (7 450 et 12 450 centimes pour 15 jours sur 30).
 * Changer le champ `fiduciaryProrata` change la grille tarifaire (src/i18n/pricing-copy.ts) et le Silo 4.
 * Le propriétaire n'a pas encore tranché : tant qu'il ne l'a pas fait, la page publique le dit.
 */
import type { CopyLocale } from '../i18n/copy-locale.ts';

export type FiduciaryProrataMode = 'DAILY' | 'MINIMUM_BILLED_MONTH';

export interface BillingPolicy {
  readonly fiduciaryProrata: FiduciaryProrataMode;
}

export const BILLING_POLICY: BillingPolicy = { fiduciaryProrata: 'DAILY' };

/** Fragments de texte de la grille tarifaire : `intro` complète une phrase, `faq` aussi (tournure de la FAQ). */
export interface ProrataClause {
  readonly intro: string;
  readonly faq: string;
}

const CLAUSES: Readonly<Record<FiduciaryProrataMode, Readonly<Record<CopyLocale, ProrataClause>>>> = {
  DAILY: {
    fr: {
      intro: 'calculé au prorata journalier pour un dossier ajouté en cours de mois',
      faq: 'au prorata journalier pour un dossier ajouté en cours de mois',
    },
    ar: {
      intro: 'يُحتسب بالتناسب اليومي للملف المضاف خلال الشهر',
      faq: 'بالتناسب اليومي للملف المضاف خلال الشهر',
    },
    ary: {
      intro: 'كيتحسب باليوم إيلا تزاد الدوسي فوسط الشهر',
      faq: 'باليوم إيلا تزاد الدوسي فوسط الشهر',
    },
    en: {
      intro: 'prorated by day for a file added mid-month',
      faq: 'prorated by day for a file added mid-month',
    },
  },
  MINIMUM_BILLED_MONTH: {
    fr: {
      intro: 'facturé pour le mois entier dès son ajout en cours de mois (mois minimum facturé, sans prorata au jour)',
      faq: 'pour le mois entier dès son ajout en cours de mois (mois minimum facturé, sans prorata au jour)',
    },
    ar: {
      intro: 'يُفوتر عن الشهر كاملا بمجرد إضافته خلال الشهر (شهر أدنى مفوتر، بدون تناسب يومي)',
      faq: 'عن الشهر كاملا بمجرد إضافته خلال الشهر (شهر أدنى مفوتر، بدون تناسب يومي)',
    },
    ary: {
      intro: 'كيتفوتر على الشهر كامل بمجرد ما كيتزاد فوسط الشهر (شهر أدنى مفوتر، بلا حساب باليوم)',
      faq: 'على الشهر كامل بمجرد ما كيتزاد فوسط الشهر (شهر أدنى مفوتر، بلا حساب باليوم)',
    },
    en: {
      intro: 'billed for the whole month as soon as it is added mid-month (minimum billed month, no daily proration)',
      faq: 'for the whole month as soon as it is added mid-month (minimum billed month, no daily proration)',
    },
  },
};

/** Règle de prorata en une phrase, pour les tableaux et verdicts du Silo 4. */
const PRORATA_RULE: Readonly<Record<FiduciaryProrataMode, Readonly<Record<CopyLocale, string>>>> = {
  DAILY: {
    fr: 'prorata journalier sur les jours actifs restants du mois',
    en: 'daily proration over the remaining active days of the month',
    ar: 'تناسب يومي: الأيام النشطة المتبقية من الشهر على عدد أيام الشهر',
    ary: 'حساب باليوم: الأيام النشيطة اللي بقاو فالشهر على عدد أيام الشهر',
  },
  MINIMUM_BILLED_MONTH: {
    fr: 'mois minimum facturé : mois entier dû dès la création, sans prorata au jour',
    en: 'minimum billed month: full month due from creation, no daily proration',
    ar: 'شهر أدنى مفوتر: الشهر كاملا مستحق منذ إنشاء الملف، بدون تناسب يومي',
    ary: 'شهر أدنى مفوتر: الشهر كامل خاصو يتخلص من نهار تصاوب الدوسي، بلا حساب باليوم',
  },
};

export function prorataRule(locale: CopyLocale, policy: BillingPolicy = BILLING_POLICY): string {
  return PRORATA_RULE[policy.fiduciaryProrata][locale];
}

export function prorataClause(locale: CopyLocale, policy: BillingPolicy = BILLING_POLICY): ProrataClause {
  return CLAUSES[policy.fiduciaryProrata][locale];
}

export const PRORATA_INTRO_TOKEN = '{fiduciary_prorata_intro}';
export const PRORATA_FAQ_TOKEN = '{fiduciary_prorata_faq}';
