import { DATA_CONTROLLER } from '../content/cndp.ts';
import type { CopyLocale } from './copy-locale.ts';

/**
 * Mention exacte de la décision du propriétaire du 2026-11-14, à la place de « à renseigner par le propriétaire » :
 * pied de page et page confidentialité. Aucun numéro de récépissé n'est inventé. zgh-Latn et zgh-Tfng retombent sur le français.
 */
const WHO = `${DATA_CONTROLLER.legalName} (${DATA_CONTROLLER.contactEmail})`;

const NOTICE: Readonly<Record<CopyLocale, string>> = {
  fr: `Dossiers F115, F211, F112 et F118 en cours d'enregistrement auprès de la CNDP par ${WHO}`,
  en: `Files F115, F211, F112 and F118 are being registered with the CNDP by ${WHO}`,
  ar: `ملفات F115 وF211 وF112 وF118 قيد التسجيل لدى اللجنة الوطنية لمراقبة حماية المعطيات ذات الطابع الشخصي (CNDP) من طرف ${WHO}`,
  ary: `الملفات F115 وF211 وF112 وF118 كيتسجلو دابا عند CNDP من طرف ${WHO}`,
};

export function cndpRegistrationNotice(locale: CopyLocale): string {
  return NOTICE[locale];
}
