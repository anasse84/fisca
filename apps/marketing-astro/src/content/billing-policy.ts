/**
 * Politique de facturation fiduciaire : UNIQUE source du choix de prorata.
 *
 * Décision du propriétaire du 2026-11-14 : prorata journalier exact en centimes entiers, plancher d'un jour si le
 * dossier est activé et désactivé le même jour, SANS mois minimum. La question « mois minimum facturé » est tranchée
 * (elle l'emporte sur la phrase « durée minimale d'un mois complet » de Doc_03 S04). Le mode `MINIMUM_BILLED_MONTH`
 * n'est conservé que pour prouver par test que le champ `fiduciaryProrata` pilote la grille tarifaire
 * (src/i18n/pricing-copy.ts) et le Silo 4 : il n'est jamais la valeur de production.
 */
import type { CopyLocale } from '../i18n/copy-locale.ts';
import { divRoundHalfUpBigInt } from '../lib/money.ts';

export type FiduciaryProrataMode = 'DAILY' | 'MINIMUM_BILLED_MONTH';

export interface BillingPolicy {
  readonly fiduciaryProrata: FiduciaryProrataMode;
}

export const BILLING_POLICY: BillingPolicy = { fiduciaryProrata: 'DAILY' };

/** Plancher de jours facturés : un dossier activé puis désactivé le même jour est facturé un jour entier. */
export const MIN_BILLED_DAYS = 1;

/**
 * Prorata journalier exact en centimes entiers (Doc_03 S11 `computeDailyProrataCents`, ERRATA D-09 : division demi
 * supérieur en BigInt, aucun flottant). `activatedOnDay` et `deactivatedOnDay` sont des jours du mois (1 à `daysInMonth`) ;
 * sans `deactivatedOnDay`, le dossier reste actif jusqu'à la fin du mois. Jours actifs = fin - début + 1 (bornes incluses),
 * jamais moins de `MIN_BILLED_DAYS` : le même jour d'activation et de désactivation donne un jour.
 */
export function computeDailyProrataCents(
  monthlyRateHtCents: number,
  activatedOnDay: number,
  daysInMonth: number,
  deactivatedOnDay?: number,
): number {
  const last = deactivatedOnDay ?? daysInMonth;
  const invalid =
    !Number.isSafeInteger(monthlyRateHtCents) ||
    monthlyRateHtCents < 0 ||
    !Number.isInteger(activatedOnDay) ||
    !Number.isInteger(daysInMonth) ||
    !Number.isInteger(last) ||
    daysInMonth < 28 ||
    daysInMonth > 31 ||
    activatedOnDay < 1 ||
    activatedOnDay > daysInMonth ||
    last < activatedOnDay ||
    last > daysInMonth;
  if (invalid) {
    throw new RangeError(
      `BILLING_INVALID_PRORATA_DATES: day=${String(activatedOnDay)}, end=${String(last)}, daysInMonth=${String(daysInMonth)}`,
    );
  }
  const activeDays = Math.max(MIN_BILLED_DAYS, last - activatedOnDay + 1);
  return Number(divRoundHalfUpBigInt(BigInt(monthlyRateHtCents) * BigInt(activeDays), BigInt(daysInMonth)));
}

/** Fragments de texte de la grille tarifaire : `intro` complète une phrase, `faq` aussi (tournure de la FAQ). */
export interface ProrataClause {
  readonly intro: string;
  readonly faq: string;
}

const CLAUSES: Readonly<Record<FiduciaryProrataMode, Readonly<Record<CopyLocale, ProrataClause>>>> = {
  DAILY: {
    fr: {
      intro: 'calculé au prorata journalier exact pour un dossier ajouté en cours de mois (plancher d’un jour, sans mois minimum)',
      faq: 'au prorata journalier exact pour un dossier ajouté en cours de mois (plancher d’un jour, sans mois minimum)',
    },
    ar: {
      intro: 'يُحتسب بالتناسب اليومي الدقيق للملف المضاف خلال الشهر (حد أدنى يوم واحد، دون شهر أدنى)',
      faq: 'بالتناسب اليومي الدقيق للملف المضاف خلال الشهر (حد أدنى يوم واحد، دون شهر أدنى)',
    },
    ary: {
      intro: 'كيتحسب باليوم بالضبط إيلا تزاد الدوسي فوسط الشهر (على الأقل نهار واحد، بلا شهر أدنى)',
      faq: 'باليوم بالضبط إيلا تزاد الدوسي فوسط الشهر (على الأقل نهار واحد، بلا شهر أدنى)',
    },
    en: {
      intro: 'prorated exactly by day for a file added mid-month (one-day floor, no minimum month)',
      faq: 'prorated exactly by day for a file added mid-month (one-day floor, no minimum month)',
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
    fr: 'prorata journalier exact sur les jours actifs restants, plancher d’un jour, sans mois minimum',
    en: 'exact daily proration over the remaining active days, one-day floor, no minimum month',
    ar: 'تناسب يومي دقيق على الأيام النشطة المتبقية، بحد أدنى يوم واحد ودون شهر أدنى',
    ary: 'حساب باليوم بالضبط على الأيام النشيطة اللي بقاو، على الأقل نهار واحد وبلا شهر أدنى',
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
