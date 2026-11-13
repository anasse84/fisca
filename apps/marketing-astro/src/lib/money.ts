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

/** Division entière arrondie au demi supérieur, en BigInt (ERRATA D-09 : jamais `Math.round(a / b)`). */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

const BPS_SCALE = 10000;

/** Montant après remise : `cents x (10 000 - bps) / 10 000`, demi supérieur, entiers uniquement. */
export function applyDiscountBps(cents: number, discountBps: number): number {
  assertIntegerCents(cents);
  if (!Number.isSafeInteger(discountBps) || discountBps < 0 || discountBps > BPS_SCALE) {
    throw new RangeError(`Remise en points de base invalide : ${String(discountBps)}`);
  }
  const result = divRoundHalfUp(BigInt(cents) * BigInt(BPS_SCALE - discountBps), BigInt(BPS_SCALE));
  return Number(result);
}

/** 1500 -> "15 %" ; 25 -> "0,25 %" (affichage seulement, Math.trunc et % sur entiers). */
export function formatBpsPercent(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps < 0) {
    throw new RangeError(`Points de base invalides : ${String(bps)}`);
  }
  // Affichage seulement (AGENTS.md Loi 1) : les points de base sont des entiers, la division est exacte au centième.
  const display = bps;
  const whole = Math.trunc(display / 100);
  const remainder = display % 100;
  return remainder === 0 ? `${String(whole)} %` : `${String(whole)},${String(remainder).padStart(2, '0')} %`;
}
