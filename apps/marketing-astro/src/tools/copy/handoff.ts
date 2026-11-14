import type { L4 } from '../../content/silos/types.ts';
import type { CopyLocale } from '../../i18n/copy-locale.ts';
import { t } from './common.ts';

/** Bloc « Démarrer l'essai gratuit 14 jours » des outils ICE et Loi 69-21 (Doc_18 S09, Zero-Drop Handoff). */
export interface HandoffCopy {
  readonly heading: string;
  readonly cta: string;
  readonly iceLabel: string;
  readonly iceHint: string;
  readonly note: string;
  readonly invalidIce: string;
  readonly fallback: string;
  readonly opening: string;
}

const RAW = {
  heading: t('Continuer dans Fisca', 'Continue in Fisca', 'تابع في Fisca', 'كمّل فـ Fisca'),
  cta: t('Démarrer l’essai gratuit 14 jours', 'Start the 14-day free trial', 'ابدأ التجربة المجانية 14 يوما', 'ابدا التجربة المجانية 14 يوم'),
  iceLabel: t('Votre ICE (facultatif)', 'Your ICE (optional)', 'رقم ICE الخاص بك (اختياري)', 'ICE ديالك (اختياري)'),
  iceHint: t(
    'Saisissez l’ICE de votre entreprise pour pré-remplir votre dossier ; laissez vide pour ouvrir simplement l’application.',
    'Enter your company’s ICE to pre-fill your file; leave it empty to simply open the application.',
    'أدخل رقم ICE لشركتك لملء ملفك مسبقا؛ واتركه فارغا لفتح التطبيق فقط.',
    'دخل ICE د الشركة ديالك باش يتعمر الدوسي مسبقا؛ وخليه خاوي باش تفتح التطبيق غير.',
  ),
  note: t(
    'L’ICE saisi est joint à l’adresse de l’application dans un paramètre signé qui expire rapidement ; ce site ne le conserve pas.',
    'The ICE you enter is attached to the application address in a signed parameter that expires quickly; this site does not keep it.',
    'يُرفق رقم ICE المدخل بعنوان التطبيق ضمن معامل موقّع تنتهي صلاحيته بسرعة؛ ولا يحتفظ هذا الموقع به.',
    'ICE اللي دخلتي كيتزاد لعنوان التطبيق فمعامل موقّع كيسالي بسرعة؛ وهاد الموقع ما كيحتافظش بيه.',
  ),
  invalidIce: t(
    'Saisissez un ICE de 15 chiffres, ou laissez le champ vide.',
    'Enter a 15-digit ICE, or leave the field empty.',
    'أدخل رقم ICE من 15 رقما، أو اترك الحقل فارغا.',
    'دخل ICE من 15 رقم، ولا خلي الخانة خاوية.',
  ),
  fallback: t(
    'Le lien signé n’a pas pu être créé : ouverture de l’application sans pré-remplissage.',
    'The signed link could not be created: opening the application without pre-filling.',
    'تعذر إنشاء الرابط الموقّع: سيُفتح التطبيق دون ملء مسبق.',
    'ما قدرناش نصاوبو الرابط الموقّع: غادي يتفتح التطبيق بلا تعمير مسبق.',
  ),
  opening: t('Ouverture de l’application…', 'Opening the application…', 'جارٍ فتح التطبيق…', 'كيتفتح التطبيق…'),
} satisfies Record<keyof HandoffCopy, L4>;

export function handoffCopy(locale: CopyLocale): HandoffCopy {
  return {
    heading: RAW.heading[locale],
    cta: RAW.cta[locale],
    iceLabel: RAW.iceLabel[locale],
    iceHint: RAW.iceHint[locale],
    note: RAW.note[locale],
    invalidIce: RAW.invalidIce[locale],
    fallback: RAW.fallback[locale],
    opening: RAW.opening[locale],
  };
}
