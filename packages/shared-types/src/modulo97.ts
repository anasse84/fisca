const DIGITS_ONLY = /^[0-9]+$/;
const ICE_PATTERN = /^[0-9]{15}$/;

/** Reste modulo 97 d'une chaîne de chiffres ASCII, calculé par BigInt (aucun flottant). */
export function mod97OfDigits(digits: string): number {
  if (!DIGITS_ONLY.test(digits)) {
    throw new Error('MOD97_INVALID_INPUT: chaîne de chiffres ASCII non vide attendue.');
  }
  return Number(BigInt(digits) % 97n);
}

/**
 * Contrôle de cohérence de l'ICE : 15 chiffres, divisibles par 97.
 * Ce n'est PAS une preuve d'existence : aucune publication officielle de l'algorithme (ERRATA section E).
 */
export function isValidIceChecksum(ice: string): boolean {
  return ICE_PATTERN.test(ice) && mod97OfDigits(ice) === 0;
}
