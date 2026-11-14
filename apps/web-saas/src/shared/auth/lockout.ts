/**
 * Verrouillage d'INTERFACE après échecs (confort, pas une règle de sécurité : le serveur reste l'autorité, 5 échecs
 * puis 15 minutes pour le mot de passe). Un Retry-After du serveur prime toujours sur le refroidissement local.
 */
export interface LockoutConfig {
  readonly maxFailures: number;
  readonly cooldownSec: number;
  readonly maxLockSec: number;
}

export const DEFAULT_LOCKOUT: LockoutConfig = { maxFailures: 5, cooldownSec: 30, maxLockSec: 3600 };

export interface LockoutState {
  readonly failures: number;
  readonly lockedUntilMs: number | null;
}

export const emptyLockout = (): LockoutState => ({ failures: 0, lockedUntilMs: null });

export interface FailureInput {
  readonly nowMs: number;
  readonly retryAfterSec: number | null;
  readonly countsAsFailure: boolean;
}

export function registerFailure(state: LockoutState, input: FailureInput, config: LockoutConfig): LockoutState {
  const failures = input.countsAsFailure ? state.failures + 1 : state.failures;
  if (input.retryAfterSec !== null && input.retryAfterSec > 0) {
    const seconds = Math.min(input.retryAfterSec, config.maxLockSec);
    return { failures, lockedUntilMs: input.nowMs + seconds * 1000 };
  }
  if (input.countsAsFailure && failures >= config.maxFailures) {
    return { failures, lockedUntilMs: input.nowMs + config.cooldownSec * 1000 };
  }
  return { failures, lockedUntilMs: state.lockedUntilMs };
}

/** Secondes restantes, arrondies par excès (0 si aucun verrou ou échu). */
export function lockRemainingSec(state: LockoutState, nowMs: number): number {
  if (state.lockedUntilMs === null || nowMs >= state.lockedUntilMs) {
    return 0;
  }
  return Math.ceil((state.lockedUntilMs - nowMs) / 1000);
}

export function releaseIfElapsed(state: LockoutState, nowMs: number): LockoutState {
  return state.lockedUntilMs !== null && nowMs >= state.lockedUntilMs ? emptyLockout() : state;
}
