/**
 * Socle commun des montants en toutes lettres (Loi 1 : entiers uniquement).
 * Les fonctions travaillent sur des CENTIMES ENTIERS (bigint) ; seul `divmod` entier est employé.
 */

/** Plafond technique : 999 999 999 999,99 MAD (999 milliards) = 99 999 999 999 999 centimes. Ce n'est pas une règle fiscale. */
export const AMOUNT_IN_WORDS_MAX_CENTS = 99_999_999_999_999n;

export type AmountInWordsErrorCode = 'AMOUNT_OUT_OF_RANGE';

export class AmountInWordsError extends Error {
  readonly code: AmountInWordsErrorCode;

  constructor(code: AmountInWordsErrorCode, message: string) {
    super(message);
    this.name = 'AmountInWordsError';
    this.code = code;
  }
}

export interface SplitAmount {
  /** Dirhams entiers. */
  readonly dirhams: bigint;
  /** Centimes restants, 0 à 99. */
  readonly centimes: bigint;
}

/**
 * Valide le montant en centimes (entier, 0 ≤ montant ≤ plafond) et le sépare par divmod entier : `/` et `%` sur bigint
 * sont une division euclidienne exacte (valeurs positives), jamais une division flottante.
 */
export function splitAmount(amount: bigint): SplitAmount {
  if (typeof amount !== 'bigint' || amount < 0n || amount > AMOUNT_IN_WORDS_MAX_CENTS) {
    throw new AmountInWordsError('AMOUNT_OUT_OF_RANGE', 'Montant hors de l’intervalle admis pour la mise en toutes lettres.');
  }
  return { dirhams: amount / 100n, centimes: amount % 100n };
}

/** Groupes de trois chiffres : milliards, millions, milliers, unités (0 à 999 chacun). */
export interface ThousandGroups {
  readonly billions: number;
  readonly millions: number;
  readonly thousands: number;
  readonly units: number;
}

export function splitGroups(dirhams: bigint): ThousandGroups {
  return {
    billions: Number((dirhams / 1_000_000_000n) % 1000n),
    millions: Number((dirhams / 1_000_000n) % 1000n),
    thousands: Number((dirhams / 1000n) % 1000n),
    units: Number(dirhams % 1000n),
  };
}
