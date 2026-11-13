import { divRoundHalfUpBigInt, ensureSafeInteger } from '@fisca/shared-types';
import { FiscalAstError } from './errors.ts';

/** Échelle des points de base : 10 000 bps = 100 %. Unité de mesure, pas une règle fiscale. */
export const BPS_SCALE = 10000n;
/** 100 centimes par dirham × 10 000 bps : dénominateur d'une pénalité exprimée en dirhams entiers. */
export const CENTS_BPS_PER_DIRHAM = 1000000n;
/** Centimes par dirham. */
export const CENTS_PER_DIRHAM = 100n;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Convertit un BigInt en entier sûr, sinon ARITHMETIC_OVERFLOW (jamais de perte silencieuse). */
export function toSafeNumber(value: bigint, label: string): number {
  if (value > MAX_SAFE || value < -MAX_SAFE) {
    throw new FiscalAstError('ARITHMETIC_OVERFLOW', `${label} : ${value.toString()} dépasse Number.MAX_SAFE_INTEGER.`);
  }
  const converted = Number(value);
  ensureSafeInteger(converted, label);
  return converted;
}

/** Montant × taux en bps, divisé par 10 000, au demi supérieur (D-09). */
export function applyBpsExact(amount: bigint, rateBps: bigint): bigint {
  return divRoundHalfUpBigInt(amount * rateBps, BPS_SCALE);
}

export function minBig(...values: readonly bigint[]): bigint {
  let best = values[0];
  if (best === undefined) {
    throw new FiscalAstError('INPUT_INVALID', 'minBig : au moins une valeur attendue.');
  }
  for (const value of values) {
    if (value < best) {
      best = value;
    }
  }
  return best;
}

export function maxBig(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

/** Moitié du dénominateur en dirhams (CENTS_BPS_PER_DIRHAM ÷ 2) : constante d'unité. */
const CENTS_BPS_PER_DIRHAM_HALF = 500000n;

/**
 * Nombre de dirhams entiers au plafond : ceil(produit ÷ 1 000 000) = demi-supérieur de (produit + 500 000 − 1) ÷ 1 000 000.
 * La seule division passe par divRoundHalfUpBigInt (Loi 1).
 */
export function ceilDirhams(productCentsBps: bigint): bigint {
  return divRoundHalfUpBigInt(productCentsBps + CENTS_BPS_PER_DIRHAM_HALF - 1n, CENTS_BPS_PER_DIRHAM);
}
