import { z } from 'zod';

/**
 * RIB marocain à 24 chiffres (décision du propriétaire, qui tranche la SPEC_AMBIGUITY de Doc_04 § 03) :
 * positions 1-3 code banque (≠ 000), 4-6 code localité, 7-22 numéro de compte sur 16 chiffres (≠ seize zéros),
 * 23-24 clé comprise entre 01 et 97. Clé = 97 − ((base22 × 100) mod 97), équivalent sur les 24 chiffres à
 * N mod 97 = 0 avec 1 ≤ clé ≤ 97. Arithmétique entière BigInt : aucun flottant.
 * Statut : formule décidée par le propriétaire et recoupée arithmétiquement ; NON RECOUPÉE auprès de Bank Al-Maghrib.
 */

export type MoroccanRibErrorCode =
  | 'RIB_INVALID_FORMAT_OR_LENGTH'
  | 'RIB_INVALID_MA_IBAN_CHECK_DIGITS'
  | 'RIB_ZERO_BANK_OR_ACCOUNT'
  | 'RIB_KEY_OUT_OF_RANGE'
  | 'RIB_MOD97_CHECKSUM_MISMATCH';

export interface MoroccanRibValid {
  readonly valid: true;
  readonly canonicalRib24: string;
  readonly canonicalIbanMa28: string;
  readonly bankCode3: string;
  readonly localityCode3: string;
  readonly accountNumber16: string;
  readonly ribKey2: string;
}

export interface MoroccanRibInvalid {
  readonly valid: false;
  readonly errorCode: MoroccanRibErrorCode;
}

export type MoroccanRib24Parsed = MoroccanRibValid | MoroccanRibInvalid;

/**
 * Chiffres de contrôle de l'IBAN marocain pour tout RIB valide (ISO 13616) : RIB × 10^6 + 221000 (« MA00 »),
 * RIB étant multiple de 97, le reste est 221000 mod 97 = 34 et 98 − 34 = 64.
 */
export const MOROCCAN_IBAN_CHECK_DIGITS = '64' as const;

const BASE22_PATTERN = /^[0-9]{22}$/;
const RIB24_PATTERN = /^[0-9]{24}$/;
const MA_IBAN_PATTERN = /^MA[0-9]{26}$/;
const SEPARATORS = /[\s.\-_]/g;
const ZERO_ACCOUNT = '0000000000000000';

/** Clé RIB sur deux chiffres « 01 » à « 97 ». Lève RIB_BASE22_INVALID_FORMAT si la base n'est pas exactement 22 chiffres ASCII. */
export function computeMoroccanRibKey2(base22: string): string {
  if (typeof base22 !== 'string' || !BASE22_PATTERN.test(base22)) {
    throw new Error('RIB_BASE22_INVALID_FORMAT: 22 chiffres ASCII exactement attendus.');
  }
  return (97n - ((BigInt(base22) * 100n) % 97n)).toString().padStart(2, '0');
}

/** Contrôle de somme seul : 24 chiffres, clé entre 01 et 97, N mod 97 = 0. Ne contrôle ni banque ni compte nuls. */
export function isValidRibChecksum(rib24: string): boolean {
  if (typeof rib24 !== 'string' || !RIB24_PATTERN.test(rib24)) {
    return false;
  }
  const key = Number(rib24.slice(22, 24));
  return key >= 1 && key <= 97 && BigInt(rib24) % 97n === 0n;
}

const invalid = (errorCode: MoroccanRibErrorCode): MoroccanRibInvalid => ({ valid: false, errorCode });

/**
 * Valide et normalise un RIB marocain (24 chiffres ou IBAN MA64 de 28 caractères ; séparateurs espace . - _ tolérés).
 * Ne lève jamais : toute entrée, même non textuelle, donne un résultat typé. Le préfixe « MA » est exigé en majuscules.
 */
export function validateMoroccanRib24(rawInput: string): MoroccanRib24Parsed {
  if (typeof rawInput !== 'string') {
    return invalid('RIB_INVALID_FORMAT_OR_LENGTH');
  }
  const compact = rawInput.replace(SEPARATORS, '');

  let rib24 = compact;
  if (compact.startsWith('MA')) {
    if (!MA_IBAN_PATTERN.test(compact)) {
      return invalid('RIB_INVALID_FORMAT_OR_LENGTH');
    }
    if (compact.slice(2, 4) !== MOROCCAN_IBAN_CHECK_DIGITS) {
      return invalid('RIB_INVALID_MA_IBAN_CHECK_DIGITS');
    }
    rib24 = compact.slice(4);
  }
  // Format validé AVANT toute conversion numérique.
  if (!RIB24_PATTERN.test(rib24)) {
    return invalid('RIB_INVALID_FORMAT_OR_LENGTH');
  }

  const bankCode3 = rib24.slice(0, 3);
  const localityCode3 = rib24.slice(3, 6);
  const accountNumber16 = rib24.slice(6, 22);
  const ribKey2 = rib24.slice(22, 24);

  if (bankCode3 === '000' || accountNumber16 === ZERO_ACCOUNT) {
    return invalid('RIB_ZERO_BANK_OR_ACCOUNT');
  }
  const key = Number(ribKey2);
  if (key < 1 || key > 97) {
    return invalid('RIB_KEY_OUT_OF_RANGE');
  }
  if (BigInt(rib24) % 97n !== 0n) {
    return invalid('RIB_MOD97_CHECKSUM_MISMATCH');
  }
  return {
    valid: true,
    canonicalRib24: rib24,
    canonicalIbanMa28: `MA${MOROCCAN_IBAN_CHECK_DIGITS}${rib24}`,
    bankCode3,
    localityCode3,
    accountNumber16,
    ribKey2,
  };
}

/** Schéma Zod 4 : chaîne libre → RIB canonique à 24 chiffres, sinon issue « custom » portant le code d'erreur. */
export const MoroccanRib24Schema = z.string().transform((value, ctx) => {
  const parsed = validateMoroccanRib24(value);
  if (!parsed.valid) {
    ctx.addIssue({ code: 'custom', message: `RIB marocain invalide (${parsed.errorCode}).` });
    return z.NEVER;
  }
  return parsed.canonicalRib24;
});
