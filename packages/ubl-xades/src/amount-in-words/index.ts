import type { UblTypeCode } from '../generator/invoice-number.ts';
import { amountInWordsAr } from './ar.ts';
import { amountInWordsFr } from './fr.ts';

export { AMOUNT_IN_WORDS_MAX_CENTS, AmountInWordsError } from './common.ts';
export type { AmountInWordsErrorCode } from './common.ts';
export { amountInWordsAr } from './ar.ts';
export { amountInWordsFr } from './fr.ts';

/** Double arrêté : texte du montant seul, français et arabe. */
export interface AmountInWords {
  readonly fr: string;
  readonly ar: string;
}

/** Phrases complètes (préfixe d'arrêté + montant) : le préfixe suit le type de document UBL. */
export interface ArreteSentences {
  readonly fr: string;
  readonly ar: string;
}

const PREFIX_FR: Readonly<Record<UblTypeCode, string>> = {
  '380': 'Arrêtée la présente facture à la somme de : ',
  '381': 'Arrêté le présent avoir à la somme de : ',
  '383': 'Arrêtée la présente note de débit à la somme de : ',
  '386': 'Arrêtée la présente facture d’acompte à la somme de : ',
  '389': 'Arrêtée la présente autofacture à la somme de : ',
};

const PREFIX_AR: Readonly<Record<UblTypeCode, string>> = {
  '380': 'أوقفت هذه الفاتورة عند مبلغ: ',
  '381': 'أوقف هذا الإشعار الدائن عند مبلغ: ',
  '383': 'أوقف هذا الإشعار المدين عند مبلغ: ',
  '386': 'أوقفت فاتورة الدفعة المقدمة هذه عند مبلغ: ',
  '389': 'أوقفت هذه الفاتورة الذاتية عند مبلغ: ',
};

/** Montant en centimes entiers (bigint) en toutes lettres, FR et AR : fonction pure et déterministe. PROVISOIRE (relecture native). */
export function amountInWords(totalCents: bigint): AmountInWords {
  return { fr: amountInWordsFr(totalCents), ar: amountInWordsAr(totalCents) };
}

/** Double arrêté complet pour un type de document : « Arrêtée la présente facture à la somme de : … ». */
export function buildArreteSentences(typeCode: UblTypeCode, totalCents: bigint): ArreteSentences {
  const words = amountInWords(totalCents);
  return { fr: `${PREFIX_FR[typeCode]}${words.fr}`, ar: `${PREFIX_AR[typeCode]}${words.ar}` };
}

/** Préfixes d'arrêté (même table que le conteneur Java ; vérifiée par test). */
export const ARRETE_PREFIXES = { fr: PREFIX_FR, ar: PREFIX_AR } as const;
