/** Formats d'affichage par manipulation de chaînes : aucun flottant, aucune division. */

/** Quantité en milli-unités → « 1 », « 1,5 », « 0,25 », « 2,005 ». */
export function formatMilli(quantityMilli: number): string {
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli < 0) throw new RangeError('Quantité : entier de milli-unités positif ou nul exigé.');
  const digits = String(quantityMilli).padStart(4, '0');
  const whole = digits.slice(0, -3);
  const fraction = digits.slice(-3).replace(/0+$/u, '');
  return fraction === '' ? whole : `${whole},${fraction}`;
}

/** Taux en points de base → « 20 », « 10 », « 5,5 » (100 bps = 1 %). */
export function formatBps(rateBps: number): string {
  if (!Number.isSafeInteger(rateBps) || rateBps < 0) throw new RangeError('Taux : entier de bps positif ou nul exigé.');
  const digits = String(rateBps).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2).replace(/0+$/u, '');
  return fraction === '' ? whole : `${whole},${fraction}`;
}
