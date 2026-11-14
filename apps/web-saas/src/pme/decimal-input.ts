/** Saisie décimale → entier mis à l'échelle, par analyse de chaîne : aucun flottant n'intervient (ADR-03). */

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

function normalizeDigits(raw: string): string {
  let out = '';
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    } else if (char === '٫') {
      out += ',';
    } else if (/[\s\u00a0\u202f٬]/u.test(char)) {
      continue;
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * « 2,5 » à l'échelle 3 → 2500n. Accepte la virgule ou le point, les espaces de groupement, les chiffres arabo-indiens.
 * Renvoie `null` si la saisie est vide, signée, non numérique ou porte plus de `scale` décimales.
 */
export function parseScaledDecimal(text: string, scale: number): bigint | null {
  const normalized = normalizeDigits(text);
  const match = /^(\d*)(?:[.,](\d*))?$/.exec(normalized);
  if (match === null) {
    return null;
  }
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (whole === '' && fraction === '') {
    return null;
  }
  if (fraction.length > scale) {
    return null;
  }
  const digits = `${whole === '' ? '0' : whole}${fraction.padEnd(scale, '0')}`;
  return BigInt(digits);
}

/** Affichage d'un entier mis à l'échelle (« 2500n », 3 → « 2,5 »), sans zéros inutiles. */
export function formatScaledDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `,${fraction}`}`;
}

/** Taux en points de base pour l'affichage : 2000 → « 20 % », 1050 → « 10,5 % ». */
export function formatBps(rate: number): string {
  if (!Number.isSafeInteger(rate) || rate < 0) {
    throw new Error(`UI_FLOAT_FORBIDDEN: taux non entier (${rate}).`);
  }
  return `${formatScaledDecimal(BigInt(rate), 2)} %`;
}
