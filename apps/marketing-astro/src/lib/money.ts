/** Affichage uniquement (ADR-03) : Math.trunc(x / 100) et % sur entiers de centimes, aucun flottant. */

function assertIntegerCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Montant en centimes non entier : ${String(cents)}`);
  }
}

function splitCents(cents: number): { readonly negative: boolean; readonly whole: number; readonly fraction: string } {
  assertIntegerCents(cents);
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return { negative: cents < 0, whole, fraction };
}

/** 12900 -> "129.00" (valeur machine, point décimal : JSON-LD, schema.org). */
export function centsToDecimalString(cents: number): string {
  const { negative, whole, fraction } = splitCents(cents);
  return `${negative ? '-' : ''}${String(whole)}.${fraction}`;
}

/** 1800000 -> "18 000,00 MAD" (valeur lisible, Doc_08 S11 `formatCentimesMad`). */
export function formatCentsMad(cents: number): string {
  const { negative, whole, fraction } = splitCents(cents);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negative ? '-' : ''}${grouped},${fraction} MAD`;
}
