import { FiscaIntegerError } from './errors.ts';

declare const brand: unique symbol;

/** Entier sûr portant une marque d'unité : les unités ne se mélangent pas à la compilation. */
export type Branded<Unit extends string> = number & { readonly [brand]: Unit };

/** Montant en centimes de dirham (100,00 MAD = 10000). */
export type Centimes = Branded<'centimes'>;
/** Taux en points de base (20 % = 2000). */
export type Bps = Branded<'bps'>;
/** Quantité en milli-unités. */
export type Milli = Branded<'milli'>;
/** Cours en micro-unités. */
export type Micro = Branded<'micro'>;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = -MAX_SAFE;

/** Retourne la valeur si c'est un entier sûr, sinon lève FiscaIntegerError. */
export function ensureSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw new FiscaIntegerError('NOT_A_NUMBER', label, `type ${typeof value} reçu`);
  }
  if (Number.isNaN(value)) {
    throw new FiscaIntegerError('NOT_A_NUMBER', label, 'NaN reçu');
  }
  if (!Number.isFinite(value)) {
    throw new FiscaIntegerError('NOT_FINITE', label, `${value} reçu`);
  }
  if (!Number.isInteger(value)) {
    throw new FiscaIntegerError('NOT_INTEGER', label, `${value} n'est pas un entier`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new FiscaIntegerError('UNSAFE_INTEGER', label, `${value} dépasse Number.MAX_SAFE_INTEGER`);
  }
  return value;
}

export function centimes(value: number): Centimes {
  return ensureSafeInteger(value, 'centimes') as Centimes;
}

export function bps(value: number): Bps {
  return ensureSafeInteger(value, 'bps') as Bps;
}

export function milli(value: number): Milli {
  return ensureSafeInteger(value, 'milli') as Milli;
}

export function micro(value: number): Micro {
  return ensureSafeInteger(value, 'micro') as Micro;
}

function bigintToSafeNumber(value: bigint, label: string): number {
  if (value > MAX_SAFE || value < MIN_SAFE) {
    throw new FiscaIntegerError('UNSAFE_INTEGER', label, `${value} dépasse Number.MAX_SAFE_INTEGER`);
  }
  return Number(value);
}

export function addInt<T extends number>(a: T, b: T): T {
  const left = ensureSafeInteger(a, 'addInt.a');
  const right = ensureSafeInteger(b, 'addInt.b');
  return bigintToSafeNumber(BigInt(left) + BigInt(right), 'addInt') as T;
}

export function subInt<T extends number>(a: T, b: T): T {
  const left = ensureSafeInteger(a, 'subInt.a');
  const right = ensureSafeInteger(b, 'subInt.b');
  return bigintToSafeNumber(BigInt(left) - BigInt(right), 'subInt') as T;
}

/** Multiplie une quantité par un facteur entier sans unité. */
export function mulInt<T extends number>(a: T, factor: number): T {
  const left = ensureSafeInteger(a, 'mulInt.a');
  const right = ensureSafeInteger(factor, 'mulInt.factor');
  return bigintToSafeNumber(BigInt(left) * BigInt(right), 'mulInt') as T;
}

/**
 * Division entière arrondie au demi supérieur : le demi va vers +∞ (-2,5 → -2 ; 2,5 → 3),
 * ce qui reproduit Math.round des vecteurs d'origine (ERRATA D-09) sans passer par un flottant.
 */
export function divRoundHalfUpBigInt(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new FiscaIntegerError('DIVISION_BY_ZERO', 'divRoundHalfUpBigInt', 'diviseur nul');
  }
  const num = denominator < 0n ? -numerator : numerator;
  const den = denominator < 0n ? -denominator : denominator;
  // floor((2·num + den) / (2·den)) avec den > 0
  const scaledNum = 2n * num + den;
  const scaledDen = 2n * den;
  let quotient = scaledNum / scaledDen;
  if (scaledNum % scaledDen < 0n) {
    quotient -= 1n;
  }
  return quotient;
}

/** Applique un taux en bps à un montant : divRoundHalfUpBigInt(montant × bps, 10000). */
export function applyBps(amount: Centimes, rate: Bps): Centimes {
  const left = ensureSafeInteger(amount, 'applyBps.amount');
  const right = ensureSafeInteger(rate, 'applyBps.rate');
  const result = divRoundHalfUpBigInt(BigInt(left) * BigInt(right), 10000n);
  return bigintToSafeNumber(result, 'applyBps') as Centimes;
}
