/**
 * Auditeur et réparateur d'ICE (Doc_18 S06 et S11, ERRATA E).
 *
 * La divisibilité des 15 chiffres par 97 est un CONTRÔLE DE COHÉRENCE établi par constat sur des numéros réels, pas par
 * un texte officiel publié (ERRATA E) : un ICE qui passe le contrôle n'est pas prouvé existant, un ICE qui l'échoue peut
 * seulement être une faute de saisie. L'existence d'un ICE se vérifie dans le référentiel officiel.
 *
 * Écart assumé avec le code de référence de Doc_18 S11, qui accepte 12 à 14 chiffres : Doc_18 S06 et le ticket
 * T-P2C-06 limitent la réparation aux ICE de 13 ou 14 chiffres (zéro ou deux zéros initiaux supprimés par Excel).
 * Une cellule de 12 chiffres est signalée, jamais « réparée » (trois zéros perdus : aucune règle publiée).
 */
import { datedValue } from '../content/dated-values.ts';

export type IceStatus = 'VALID_15' | 'AUTO_REPAIRED_EXCEL_LEADING_ZEROS' | 'INVALID_CHECKSUM_OR_FORMAT' | 'EMPTY';

export type IceInvalidReason =
  | 'NON_DIGIT'
  | 'BAD_LENGTH'
  | 'ZERO_ENTERPRISE_ROOT'
  | 'CHECKSUM'
  | 'REPAIR_CHECKSUM'
  | 'SCIENTIFIC_NOTATION';

export interface IceAuditResult {
  readonly rawInput: string;
  readonly status: IceStatus;
  readonly reason?: IceInvalidReason;
  readonly normalizedIce15?: string;
  readonly enterpriseRoot9?: string;
  readonly establishmentCode4?: string;
  readonly controlKey2?: string;
}

/** Diviseur du contrôle de cohérence : donnée datée du contenu (`ice_key_modulus`, état NON RECOUPÉ, ERRATA E). */
const ICE_KEY_MODULUS = BigInt(datedValue('ice_key_modulus').value);

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** Chiffres arabes orientaux (٠-٩, ۰-۹) -> ASCII : une cellule saisie sur un clavier arabe reste lisible. */
function toAsciiDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= EXTENDED_ARABIC_INDIC_ZERO ? code - EXTENDED_ARABIC_INDIC_ZERO : code - ARABIC_INDIC_ZERO);
  });
}

/** Séparateurs usuels retirés (espaces, points, tirets, soulignés) ; apostrophe de texte Excel en tête retirée. */
export function normalizeIceCell(raw: string): string {
  return toAsciiDigits(raw)
    .trim()
    .replace(/^['\u2018\u2019]/, '')
    .replace(/[\s\u00a0\u202f.\-_]/g, '');
}

/** Contrôle de cohérence : les 15 chiffres, lus comme un entier, sont divisibles par 97. */
export function isDivisibleBy97(digits15: string): boolean {
  return /^\d{15}$/.test(digits15) && BigInt(digits15) % ICE_KEY_MODULUS === 0n;
}

function parts(ice15: string): Pick<IceAuditResult, 'enterpriseRoot9' | 'establishmentCode4' | 'controlKey2'> {
  return { enterpriseRoot9: ice15.slice(0, 9), establishmentCode4: ice15.slice(9, 13), controlKey2: ice15.slice(13, 15) };
}

const SCIENTIFIC = /^\d+(?:[.,]\d+)?[eE][+-]?\d+$/;

export function auditAndRepairIce(rawCell: string): IceAuditResult {
  const digits = normalizeIceCell(rawCell);
  if (digits === '') return { rawInput: rawCell, status: 'EMPTY' };
  if (SCIENTIFIC.test(digits)) {
    // Excel a converti l'ICE en notation scientifique : les chiffres de queue sont perdus, aucune réparation possible.
    return { rawInput: rawCell, status: 'INVALID_CHECKSUM_OR_FORMAT', reason: 'SCIENTIFIC_NOTATION' };
  }
  if (!/^\d+$/.test(digits)) return { rawInput: rawCell, status: 'INVALID_CHECKSUM_OR_FORMAT', reason: 'NON_DIGIT' };

  if (digits.length === 15) {
    if (digits.startsWith('000000000')) return { rawInput: rawCell, status: 'INVALID_CHECKSUM_OR_FORMAT', reason: 'ZERO_ENTERPRISE_ROOT' };
    if (!isDivisibleBy97(digits)) return { rawInput: rawCell, status: 'INVALID_CHECKSUM_OR_FORMAT', reason: 'CHECKSUM' };
    return { rawInput: rawCell, status: 'VALID_15', normalizedIce15: digits, ...parts(digits) };
  }

  if (digits.length === 13 || digits.length === 14) {
    const padded = digits.padStart(15, '0');
    if (padded.startsWith('000000000') || !isDivisibleBy97(padded)) {
      return { rawInput: rawCell, status: 'INVALID_CHECKSUM_OR_FORMAT', reason: 'REPAIR_CHECKSUM' };
    }
    return { rawInput: rawCell, status: 'AUTO_REPAIRED_EXCEL_LEADING_ZEROS', normalizedIce15: padded, ...parts(padded) };
  }

  return { rawInput: rawCell, status: 'INVALID_CHECKSUM_OR_FORMAT', reason: 'BAD_LENGTH' };
}
