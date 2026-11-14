/**
 * Montants d'un FEC : décimal textuel -> centimes entiers, sans flottant (AGENTS.md loi 1).
 * Virgule ou point comme séparateur décimal ; deux décimales au plus ; ni signe, ni séparateur de milliers, ni exposant.
 * Une cellule vide vaut zéro (Debit ou Credit non utilisé sur la ligne).
 */
const MAX_WHOLE_DIGITS = 13;

export function parseFecAmountToCents(text: string): bigint | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0n;
  const match = /^(\d{1,13})(?:[.,](\d{1,2}))?$/.exec(trimmed);
  if (match === null || (match[1] ?? '').length > MAX_WHOLE_DIGITS) return null;
  const fraction = (match[2] ?? '').padEnd(2, '0') || '00';
  return BigInt(match[1] ?? '0') * 100n + BigInt(fraction);
}
