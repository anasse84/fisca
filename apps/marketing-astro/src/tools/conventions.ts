/**
 * Conventions de calcul des outils publics et leur rattachement légal (T-P2C-07, reprise).
 *
 * Règle : une convention n'est rattachée qu'à un texte de loi que les spécifications du dépôt NOMMENT (ERRATA section E,
 * Doc_03, Doc_14, Doc_18). Tout le reste porte la mention « à confirmer par l'expert-comptable ». Aucun numéro d'article
 * n'est inventé : la loi 69-21 est citée sans article parce qu'aucune spécification n'en nomme un.
 *
 * Note de développement (non affichée aux visiteurs, aucun script) : Cloudflare Turnstile : à brancher en P4 (secret côté serveur).
 */
import type { VerificationState } from '../content/dated-values.ts';
import type { CopyLocale } from '../i18n/copy-locale.ts';
import type { L4 } from '../content/silos/types.ts';
import type { ToolSection } from './copy/page-types.ts';
import { t } from './copy/common.ts';

export const TURNSTILE_DEV_NOTE = 'Cloudflare Turnstile : à brancher en P4 (secret côté serveur)';

export type ConventionTool = 'loi' | 'ras' | 'ae' | 'mowakaba';

export type ConventionId =
  | 'late-started-months'
  | 'late-director-rate-plus-increment'
  | 'ras-attestation-six-months'
  | 'ras-threshold-inclusive'
  | 'ae-ir-rates'
  | 'ae-client-threshold-withholding'
  | 'mowakaba-eligibility-and-coverage';

export type LegalBasis =
  | { readonly kind: 'LAW'; readonly reference: L4; /** Vrai si les spécifications nomment un numéro d'article. */ readonly articleNamed: boolean }
  | { readonly kind: 'TO_CONFIRM' };

export interface ToolConvention {
  readonly id: ConventionId;
  readonly tools: readonly ConventionTool[];
  readonly label: L4;
  readonly basis: LegalBasis;
  /** Vrai : même rattachée à un texte, l'application exacte reste à faire confirmer par l'expert-comptable. */
  readonly confirmDetail: boolean;
  /** Où les spécifications du dépôt posent cette convention (données internes, non affichées). */
  readonly specSources: readonly string[];
  readonly state: VerificationState;
}

const LAW_69_21: L4 = t('Loi 69-21', 'Law 69-21', 'القانون 69-21', 'القانون 69-21');
const ART_117_CGI: L4 = t('Art. 117 du CGI', 'Article 117 of the CGI (General Tax Code)', 'المادة 117 من المدونة العامة للضرائب', 'المادة 117 د المدونة العامة للضرائب');

export const TOOL_CONVENTIONS: readonly ToolConvention[] = [
  {
    id: 'late-started-months',
    tools: ['loi'],
    label: t(
      'Mois entamés : chaque mois commencé compte pour un mois entier.',
      'Started months: every month begun counts as a whole month.',
      'الأشهر المبتدأة: كل شهر بدأ يُحتسب شهرا كاملا.',
      'الشهور اللي بداو: كل شهر بدا كيتحسب شهر كامل.',
    ),
    basis: { kind: 'LAW', reference: LAW_69_21, articleNamed: false },
    confirmDetail: true,
    specSources: ['ERRATA E', 'Doc_02 S06', 'Doc_07 S08', 'Doc_14 S03 VEC-CGI-02'],
    state: 'NON RECOUPÉ',
  },
  {
    id: 'late-director-rate-plus-increment',
    tools: ['loi'],
    label: t(
      'Taux directeur de Bank Al-Maghrib, majoré de 85 points de base par mois supplémentaire.',
      'Bank Al-Maghrib policy rate, plus 85 basis points per additional month.',
      'سعر الفائدة الرئيسي لبنك المغرب، مضافا إليه 85 نقطة أساس عن كل شهر إضافي.',
      'سعر الفائدة د بنك المغرب، زائد 85 نقطة أساس على كل شهر زايد.',
    ),
    basis: { kind: 'LAW', reference: LAW_69_21, articleNamed: false },
    confirmDetail: true,
    specSources: ['ERRATA E', 'Doc_02 S06', 'Doc_14 S03 VEC-CGI-02'],
    state: 'NON RECOUPÉ',
  },
  {
    id: 'ras-attestation-six-months',
    tools: ['ras'],
    label: t(
      'Attestation de régularité fiscale de moins de 6 mois au jour du règlement : retenue de 75 % ; sinon 100 %.',
      'Tax-compliance attestation under 6 months old on the payment day: 75% withheld; otherwise 100%.',
      'شهادة الوضعية الجبائية التي يقل عمرها عن 6 أشهر يوم الأداء: اقتطاع 75 %؛ وإلا 100 %.',
      'شهادة الوضعية الجبائية اللي عمرها قل من 6 شهور نهار الأداء: اقتطاع 75 %؛ وإلا 100 %.',
    ),
    basis: { kind: 'LAW', reference: ART_117_CGI, articleNamed: true },
    confirmDetail: false,
    specSources: ['ERRATA E', 'Doc_07 S08', 'Doc_14 S03 VEC-CGI-03'],
    state: 'NON RECOUPÉ',
  },
  {
    id: 'ras-threshold-inclusive',
    tools: ['ras'],
    label: t(
      'Seuil d’exclusion inclusif : un règlement dont le TTC est égal au seuil n’est pas retenu ; la retenue ne s’applique qu’au-dessus.',
      'Inclusive exclusion threshold: a payment whose VAT-inclusive amount equals the threshold is not withheld; withholding applies only above it.',
      'عتبة الاستثناء شاملة: لا يُقتطع من أداء مبلغه شامل الرسوم يساوي العتبة؛ ولا يطبق الاقتطاع إلا فوقها.',
      'عتبة الاستثناء داخلة فيها: الأداء اللي المبلغ ديالو بالضريبة كيساوي العتبة ما كيتقتطعش منو؛ والاقتطاع كيتطبق غير فوقها.',
    ),
    basis: { kind: 'LAW', reference: ART_117_CGI, articleNamed: true },
    confirmDetail: true,
    specSources: ['ERRATA E (seuils d’exclusion à faire valider)', 'Doc_07 S08 (« supérieure à 5 000 MAD TTC »)', 'Doc_14 S11'],
    state: 'NON RECOUPÉ',
  },
  {
    id: 'ae-ir-rates',
    tools: ['ae'],
    label: t(
      'Impôt sur le revenu trimestriel de l’auto-entrepreneur : 0,5 % ou 1 % du chiffre d’affaires encaissé.',
      'Auto-entrepreneur quarterly income tax: 0.5% or 1% of the revenue collected.',
      'الضريبة الفصلية على الدخل للمقاول الذاتي: 0,5 % أو 1 % من رقم المعاملات المحصَّل.',
      'الضريبة الفصلية على الدخل د المقاول الذاتي: 0,5 % ولا 1 % من رقم المعاملات اللي تحصل.',
    ),
    basis: { kind: 'TO_CONFIRM' },
    confirmDetail: true,
    specSources: ['Doc_18 S06', 'ERRATA E (rattachement du taux à l’activité non posé)'],
    state: 'NON RECOUPÉ',
  },
  {
    id: 'ae-client-threshold-withholding',
    tools: ['ae'],
    label: t(
      'Retenue de 30 % sur la part de chiffre d’affaires d’un même client qui dépasse 80 000 MAD.',
      '30% withholding on the part of one client’s revenue above 80,000 MAD.',
      'اقتطاع 30 % من الجزء الذي يتجاوز 80 000 درهم من رقم المعاملات مع الزبون نفسه.',
      'اقتطاع 30 % من الجزء اللي كيفوت 80 000 درهم من رقم المعاملات مع نفس الكليان.',
    ),
    basis: { kind: 'TO_CONFIRM' },
    confirmDetail: true,
    specSources: ['ERRATA E (assiette exacte de la retenue à faire valider)', 'Doc_14 S03 VEC-CGI-04', 'Doc_18 S06'],
    state: 'NON RECOUPÉ',
  },
  {
    id: 'mowakaba-eligibility-and-coverage',
    tools: ['mowakaba'],
    label: t(
      'Mowakaba : éligibilité jusqu’au plafond de chiffre d’affaires HT (borne incluse), prise en charge en fourchette.',
      'Mowakaba: eligibility up to the revenue ceiling excl. VAT (bound included), coverage as a range.',
      'مواكبة: الأهلية إلى حدود سقف رقم المعاملات دون الرسوم (الحد مشمول)، والتكفل في مجال.',
      'مواكبة: الأهلية حتى سقف رقم المعاملات بلا الضريبة (الحد داخل)، والتكفل فمجال.',
    ),
    basis: { kind: 'TO_CONFIRM' },
    confirmDetail: true,
    specSources: ['Doc_03 S05', 'Doc_03 S06', 'ERRATA C'],
    state: 'NON RECOUPÉ',
  },
];

export function conventionsFor(tool: ConventionTool): readonly ToolConvention[] {
  return TOOL_CONVENTIONS.filter((c) => c.tools.includes(tool));
}

const TO_CONFIRM_TEXT: L4 = t(
  'à confirmer par l’expert-comptable',
  'to be confirmed by your chartered accountant',
  'يجب أن يؤكده الخبير المحاسب',
  'خاصو يتأكد من الخبير المحاسب',
);

const BASIS_LABEL: L4 = t('Base légale', 'Legal basis', 'السند القانوني', 'السند القانوني');
const ARTICLE_UNNAMED: L4 = t(
  'article non précisé dans les spécifications de Fisca',
  'article not specified in Fisca’s specifications',
  'لم تحدد مواصفات Fisca المادة',
  'مواصفات Fisca ما حددتش المادة',
);
const APPLICATION: L4 = t('application exacte', 'exact application', 'التطبيق الدقيق', 'التطبيق الدقيق');

export const CONVENTIONS_HEADING: L4 = t('Conventions de calcul et base légale', 'Calculation conventions and legal basis', 'اصطلاحات الحساب والسند القانوني', 'اصطلاحات الحساب والسند القانوني');
export const CONVENTIONS_INTRO: L4 = t(
  'Chaque convention est rattachée au texte de loi que nomment les spécifications de Fisca ; à défaut, elle reste « à confirmer par l’expert-comptable ».',
  'Each convention is tied to the statute named in Fisca’s specifications; failing that, it stays “to be confirmed by your chartered accountant”.',
  'ترتبط كل اصطلاح بالنص القانوني الذي تذكره مواصفات Fisca؛ وإلا يبقى «يجب أن يؤكده الخبير المحاسب».',
  'كل اصطلاح مربوط بالنص القانوني اللي كتذكرو مواصفات Fisca؛ وإلا كيبقى «خاصو يتأكد من الخبير المحاسب».',
);

/** Phrase de rattachement d'une convention, dans la langue demandée ; jamais un article non nommé par les spécifications. */
export function basisSentence(c: ToolConvention, loc: CopyLocale): string {
  const label = BASIS_LABEL[loc];
  if (c.basis.kind === 'TO_CONFIRM') return `${label} : ${TO_CONFIRM_TEXT[loc]}.`;
  const reference = c.basis.reference[loc];
  const unnamed = c.basis.articleNamed ? '' : ` (${ARTICLE_UNNAMED[loc]} : ${TO_CONFIRM_TEXT[loc]})`;
  const detail = c.confirmDetail && c.basis.articleNamed ? ` ; ${APPLICATION[loc]} : ${TO_CONFIRM_TEXT[loc]}` : '';
  return `${label} : ${reference}${unnamed}${detail}.`;
}

/** Section « conventions de calcul et base légale » ajoutée à la copie de chaque outil concerné. */
export function conventionSection(tool: ConventionTool, loc: CopyLocale): ToolSection {
  return {
    heading: CONVENTIONS_HEADING[loc],
    paragraphs: [CONVENTIONS_INTRO[loc]],
    bullets: conventionsFor(tool).map((c) => `${c.label[loc]} ${basisSentence(c, loc)}`),
  };
}
