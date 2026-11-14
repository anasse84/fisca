/** Indicateur de robustesse : aide à la saisie uniquement. La politique du mot de passe (12 à 128) est appliquée par l'API. */
export const PASSWORD_HINT_MIN = 12 as const;
export const PASSWORD_HINT_MAX = 128 as const;

export type StrengthLevel = 'empty' | 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordStrength {
  readonly score: 0 | 1 | 2 | 3 | 4;
  readonly level: StrengthLevel;
  /** Longueur en points de code. */
  readonly length: number;
  readonly meetsLengthHint: boolean;
}

const LEVELS: readonly StrengthLevel[] = ['empty', 'weak', 'fair', 'good', 'strong'];

function classCount(chars: readonly string[]): number {
  const joined = chars.join('');
  const tests = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{Nd}]/u];
  const hasLetterWithoutCase = /[\p{Lo}]/u.test(joined);
  return tests.filter((re) => re.test(joined)).length + (hasLetterWithoutCase ? 1 : 0);
}

export function assessPasswordStrength(password: string): PasswordStrength {
  const chars = Array.from(password);
  const length = chars.length;
  const meetsLengthHint = length >= PASSWORD_HINT_MIN && length <= PASSWORD_HINT_MAX;
  if (length === 0) {
    return { score: 0, level: 'empty', length, meetsLengthHint };
  }
  const unique = new Set(chars).size;
  const variety = Math.min(classCount(chars), 4);
  // Entropie grossière : caractères distincts et classes ; un mot de passe très répétitif ou court reste faible.
  const effective = Math.min(length, unique * 2);
  let score: 1 | 2 | 3 | 4 = 1;
  if (effective >= 12 && variety >= 2) {
    score = 2;
  }
  if (effective >= 12 && variety >= 3) {
    score = 3;
  }
  if (effective >= 18 && variety >= 3 && length >= 16) {
    score = 4;
  }
  if (length < 8) {
    score = 1;
  }
  return { score, level: LEVELS[score] ?? 'weak', length, meetsLengthHint };
}
