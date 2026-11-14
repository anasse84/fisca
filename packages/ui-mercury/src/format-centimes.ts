/**
 * Formate des centimes entiers (nombre sûr ou bigint) en « 1 234,56 MAD ».
 * Arithmétique exclusivement entière (BigInt) : aucun flottant, aucun arrondi (affichage seul, ERRATA D-09 et section C).
 */
export function formatCentimesMad(amount: number | bigint, currency = 'MAD'): string {
  if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
    throw new Error(`UI_FLOAT_FORBIDDEN: Montant non entier détecté (${amount}).`);
  }
  const exact = BigInt(amount);
  const isNegative = exact < 0n;
  const magnitude = isNegative ? -exact : exact;
  const wholeDirhams = magnitude / 100n;
  const centimesPart = String(magnitude % 100n).padStart(2, '0');
  const groupedWhole = wholeDirhams.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const signPrefix = isNegative ? '-' : '';
  return `${signPrefix}${groupedWhole},${centimesPart} ${currency}`;
}
