/** Formats décimaux par arithmétique entière : jamais de flottant, jamais Number.toFixed. */

/** Centimes → décimal à 2 chiffres (`123456n` → `1234.56`). */
export function formatCentsDecimal(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Milli-unités → décimal sans zéros inutiles (`2500n` → `2.5`, `1000n` → `1`). */
export function formatMilliQuantity(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(4, '0');
  const whole = digits.slice(0, -3);
  const fraction = digits.slice(-3).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}

const VAT_PERCENT_BY_RATE = new Map<number, string>([
  [2000, '20'],
  [1000, '10'],
  [0, '0'],
]);

/** Taux D-04 (points de base) → pourcentage entier. Tout autre taux est refusé. */
export function formatVatPercent(rate: number): string {
  const percent = VAT_PERCENT_BY_RATE.get(rate);
  if (percent === undefined) {
    throw new RangeError('Taux de TVA hors {2000, 1000, 0} points de base (ERRATA D-04).');
  }
  return percent;
}
