/**
 * Saisie et arrondis des outils publics : chaînes décimales -> entiers (centimes, points de base), sans flottant
 * (AGENTS.md loi 1, ERRATA D-09). Aucune de ces fonctions ne passe par une conversion décimale flottante.
 */
import { divRoundHalfUpBigInt } from '../lib/money.ts';

const MAX_CENTS = 9_000_000_000_000_00; // 9 000 milliards de MAD : borne de sûreté des entiers JS

function stripSpaces(text: string): string {
  return text.replace(/[\s\u00a0\u202f]/g, '');
}

/** "12 345,67" | "12345.67" | "12345" -> 1234567 centimes ; null si invalide (3 décimales, signe, lettres...). */
export function parseMadToCents(text: string): number | null {
  const clean = stripSpaces(text).replace(',', '.');
  const m = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(clean);
  if (m === null) return null;
  const whole = BigInt(m[1] ?? '0');
  const fraction = BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  const total = whole * 100n + fraction;
  if (total > BigInt(MAX_CENTS)) return null;
  return Number(total);
}

/** "2,75" -> 275 points de base ; "3.6" -> 360 ; jusqu'à 2 décimales ; null sinon. */
export function parsePercentToBps(text: string): number | null {
  const clean = stripSpaces(text).replace(',', '.').replace(/%$/, '');
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(clean);
  if (m === null) return null;
  const total = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return total > 100000 ? null : total;
}

/** Division entière arrondie à l'entier supérieur (numérateur >= 0, diviseur > 0), BigInt uniquement. */
export function ceilDivBigInt(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('ceilDivBigInt : diviseur positif attendu');
  if (numerator < 0n) throw new RangeError('ceilDivBigInt : numérateur positif ou nul attendu');
  return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n;
}

/** `cents x bps / 10 000` arrondi au demi supérieur (ERRATA D-09), entiers de bout en bout. */
export function proportionHalfUp(amountCents: number, rateBps: number): number {
  return Number(divRoundHalfUpBigInt(BigInt(amountCents) * BigInt(rateBps), 10000n));
}

/** Part hors taxe d'un montant TTC : `ttc x 10 000 / (10 000 + taux)`, demi supérieur. */
export function htFromTtc(ttcCents: number, vatRateBps: number): number {
  return Number(divRoundHalfUpBigInt(BigInt(ttcCents) * 10000n, BigInt(10000 + vatRateBps)));
}

/** Vrai pour un entier sûr, positif ou nul. */
export function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** 275 -> "2,75" ; 85 -> "0,85" : pré-remplissage d'un champ de taux en pourcentage (affichage, entiers uniquement). */
export function formatBpsAsPercentInput(bps: number): string {
  if (!isNonNegativeSafeInteger(bps)) throw new RangeError('Points de base invalides');
  const digits = String(bps).padStart(3, '0');
  return `${digits.slice(0, -2)},${digits.slice(-2)}`;
}
