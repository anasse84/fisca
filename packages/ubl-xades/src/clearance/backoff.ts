/**
 * Barème de réessais de la clearance xHub (Doc_17 § 07 : « 8 tentatives à recul exponentiel jusqu'à 6 heures » ; Doc_02 § 12).
 * Fonction PURE, entiers uniquement (secondes) : aucune horloge, aucun flottant.
 *
 * Choix du barème (hypothèse de conception, les documents ne fixent ni la base ni le facteur) : 8 attentes, base 84 s, facteur 2 :
 * 84, 168, 336, 672, 1344, 2688, 5376, 10752 → somme 21 420 s (5 h 57 min), soit ≤ 21 600 s (6 h) sans la dépasser.
 * La base 85 donnerait 21 675 s (> 6 h) : 84 est la plus grande base entière admissible.
 */
export const CLEARANCE_MAX_RETRIES = 8;
export const CLEARANCE_BACKOFF_BASE_SECONDS = 84;
export const CLEARANCE_BACKOFF_FACTOR = 2;
export const CLEARANCE_TOTAL_BUDGET_SECONDS = 21_600;

export interface ClearanceBackoffOptions {
  readonly retries?: number;
  readonly baseSeconds?: number;
  readonly factor?: number;
  readonly budgetSeconds?: number;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`CLEARANCE_BACKOFF_INVALID: ${name} doit être un entier strictement positif.`);
  }
}

/** Délai (en secondes) à attendre AVANT chaque réessai : `schedule[k]` précède le réessai k + 1. */
export function computeClearanceBackoffSchedule(options: ClearanceBackoffOptions = {}): readonly number[] {
  const retries = options.retries ?? CLEARANCE_MAX_RETRIES;
  const baseSeconds = options.baseSeconds ?? CLEARANCE_BACKOFF_BASE_SECONDS;
  const factor = options.factor ?? CLEARANCE_BACKOFF_FACTOR;
  const budgetSeconds = options.budgetSeconds ?? CLEARANCE_TOTAL_BUDGET_SECONDS;
  assertPositiveInteger('retries', retries);
  assertPositiveInteger('baseSeconds', baseSeconds);
  assertPositiveInteger('factor', factor);
  assertPositiveInteger('budgetSeconds', budgetSeconds);
  const schedule: number[] = [];
  let delay = baseSeconds;
  let total = 0;
  for (let retry = 0; retry < retries; retry += 1) {
    schedule.push(delay);
    total += delay;
    delay *= factor;
  }
  if (!Number.isSafeInteger(total) || total > budgetSeconds) {
    throw new RangeError(`CLEARANCE_BACKOFF_OVER_BUDGET: la somme des attentes (${total} s) dépasse ${budgetSeconds} s.`);
  }
  return schedule;
}

/** Somme des attentes d'un barème, en secondes entières. */
export function sumBackoffSeconds(schedule: readonly number[]): number {
  return schedule.reduce((sum, seconds) => sum + seconds, 0);
}
