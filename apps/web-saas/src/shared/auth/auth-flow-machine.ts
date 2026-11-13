/** Machine à états pure du parcours Signup / Login / défi 2FA / mot de passe oublié. Aucun secret n'y transite. */
import type { ApiProblem, FieldIssue, SecondFactorMethod } from './api-client.ts';
import { MFA_CHALLENGE_TERMINAL_CODES, countsAsCredentialFailure, problemMessageKey } from './error-keys.ts';
import type { AuthErrorKey } from './error-keys.ts';
import { DEFAULT_LOCKOUT, lockRemainingSec, registerFailure, releaseIfElapsed } from './lockout.ts';
import type { LockoutConfig } from './lockout.ts';

export type AuthStep = 'login' | 'signup' | 'verify-email' | 'mfa' | 'forgot' | 'forgot-sent' | 'reset' | 'reset-done' | 'authenticated';
export type NavigableStep = 'login' | 'signup' | 'forgot' | 'reset';

export interface MfaChallenge {
  readonly token: string;
  readonly expiresAtEpochSec: number;
  readonly methods: readonly SecondFactorMethod[];
}

export interface AuthFlowState {
  readonly step: AuthStep;
  readonly history: readonly AuthStep[];
  readonly busy: boolean;
  readonly failures: number;
  readonly lockedUntilMs: number | null;
  readonly challenge: MfaChallenge | null;
  readonly errorKey: AuthErrorKey | null;
  readonly fieldErrors: Readonly<Record<string, readonly FieldIssue[]>>;
  readonly pendingEmail: string | null;
}

export type AuthFlowEvent =
  | { readonly type: 'NAVIGATE'; readonly to: NavigableStep }
  | { readonly type: 'BACK' }
  | { readonly type: 'SUBMIT'; readonly nowMs: number }
  | { readonly type: 'FAILED'; readonly problem: ApiProblem; readonly nowMs: number }
  | { readonly type: 'MFA_REQUIRED'; readonly challenge: MfaChallenge }
  | { readonly type: 'REGISTERED'; readonly email: string }
  | { readonly type: 'EMAIL_VERIFIED' }
  | { readonly type: 'FORGOT_SENT' }
  | { readonly type: 'RESET_DONE' }
  | { readonly type: 'AUTHENTICATED' }
  | { readonly type: 'TICK'; readonly nowMs: number }
  | { readonly type: 'DISMISS_ERROR' };

export function initialAuthFlow(step: NavigableStep = 'login'): AuthFlowState {
  return { step, history: [], busy: false, failures: 0, lockedUntilMs: null, challenge: null, errorKey: null, fieldErrors: {}, pendingEmail: null };
}

const lockOf = (state: AuthFlowState) => ({ failures: state.failures, lockedUntilMs: state.lockedUntilMs });

export function lockRemainingSecOf(state: AuthFlowState, nowMs: number): number {
  return lockRemainingSec(lockOf(state), nowMs);
}

/** Change d'étape : compteur d'échecs et erreurs remis à zéro, historique poussé. */
function enter(state: AuthFlowState, step: AuthStep, patch: Partial<AuthFlowState> = {}): AuthFlowState {
  return {
    ...state,
    step,
    history: [...state.history, state.step],
    busy: false,
    failures: 0,
    lockedUntilMs: null,
    errorKey: null,
    fieldErrors: {},
    ...patch,
  };
}

function resetToLogin(state: AuthFlowState, patch: Partial<AuthFlowState> = {}): AuthFlowState {
  return { ...state, step: 'login', history: [], busy: false, failures: 0, lockedUntilMs: null, challenge: null, errorKey: null, fieldErrors: {}, pendingEmail: null, ...patch };
}

export function createAuthFlowReducer(config: LockoutConfig): (state: AuthFlowState, event: AuthFlowEvent) => AuthFlowState {
  return (state, event) => reduce(state, event, config);
}

function reduce(state: AuthFlowState, event: AuthFlowEvent, config: LockoutConfig): AuthFlowState {
  switch (event.type) {
    case 'NAVIGATE':
      return enter(state, event.to);
    case 'BACK': {
      const previous = state.history[state.history.length - 1];
      return {
        ...state,
        step: previous ?? 'login',
        history: state.history.slice(0, -1),
        busy: false,
        failures: 0,
        lockedUntilMs: null,
        challenge: state.step === 'mfa' ? null : state.challenge,
        errorKey: null,
        fieldErrors: {},
      };
    }
    case 'SUBMIT':
      if (lockRemainingSec(lockOf(state), event.nowMs) > 0) {
        return { ...state, busy: false, errorKey: 'errors.accountLocked' };
      }
      return { ...state, busy: true, errorKey: null, fieldErrors: {} };
    case 'FAILED': {
      const counts = countsAsCredentialFailure(event.problem);
      const lock = registerFailure(lockOf(state), { nowMs: event.nowMs, retryAfterSec: event.problem.retryAfterSec, countsAsFailure: counts }, config);
      const errorKey = problemMessageKey(event.problem);
      if (state.step === 'mfa' && MFA_CHALLENGE_TERMINAL_CODES.has(event.problem.errorCode)) {
        return resetToLogin(state, { errorKey });
      }
      return { ...state, busy: false, failures: lock.failures, lockedUntilMs: lock.lockedUntilMs, errorKey, fieldErrors: event.problem.fieldErrors };
    }
    case 'MFA_REQUIRED':
      return enter(state, 'mfa', { challenge: event.challenge });
    case 'REGISTERED':
      return enter(state, 'verify-email', { pendingEmail: event.email });
    case 'EMAIL_VERIFIED':
      return resetToLogin(state);
    case 'FORGOT_SENT':
      return enter(state, 'forgot-sent');
    case 'RESET_DONE':
      return enter(state, 'reset-done');
    case 'AUTHENTICATED':
      return enter(state, 'authenticated', { challenge: null, pendingEmail: null });
    case 'TICK': {
      const released = releaseIfElapsed(lockOf(state), event.nowMs);
      const base = released.lockedUntilMs === state.lockedUntilMs ? state : { ...state, failures: released.failures, lockedUntilMs: released.lockedUntilMs };
      if (base.step === 'mfa' && base.challenge !== null && base.challenge.expiresAtEpochSec * 1000 <= event.nowMs) {
        return resetToLogin(base, { errorKey: 'errors.challengeExpired' });
      }
      return base;
    }
    case 'DISMISS_ERROR':
      return { ...state, errorKey: null };
  }
}


/** Réducteur à deux arguments (compatible `useReducer` et `Array.reduce`) avec le verrouillage par défaut. */
export const authFlowReducer = createAuthFlowReducer(DEFAULT_LOCKOUT);
