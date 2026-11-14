/** Saisie de l'ICE : contrôle de FORME seulement (15 chiffres). La clé modulo 97 et l'existence relèvent de l'API (annuaire). */
export const ICE_LENGTH = 15 as const;

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** Chiffres arabo-indiens → occidentaux, retire tout caractère non numérique, borne à 15. */
export function normalizeIceInput(raw: string): string {
  let out = '';
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x30 && code <= 0x39) {
      out += char;
    } else if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    }
  }
  return out.slice(0, ICE_LENGTH);
}

export function isIceShapeValid(value: string): boolean {
  return /^\d{15}$/.test(value);
}
