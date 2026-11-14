/**
 * Machine à états pure de l'onboarding ICE en 90 s : deux étapes visibles (saisie de l'ICE, vérification du dossier
 * pré-rempli par l'annuaire), un seul champ. Le chronomètre est informatif : le dépassement est signalé, jamais bloquant.
 * Le contrôle de forme (15 chiffres) n'est PAS une preuve d'existence : seul l'annuaire (CTR-API-10) renseigne.
 */
import type { ApiProblem, IceDossier } from './api-client.ts';
import { isIceShapeValid, normalizeIceInput } from './ice.ts';
import { DEFAULT_LOCKOUT, registerFailure, releaseIfElapsed } from './lockout.ts';
import type { LockoutConfig } from './lockout.ts';
import { problemMessageKey } from './error-keys.ts';
import type { AuthErrorKey } from './error-keys.ts';

export const ICE_ONBOARDING_BUDGET_MS = 90_000 as const;
export const ICE_ONBOARDING_STEPS = ['ice', 'review'] as const;

export type IceOnboardingStep = 'ice' | 'searching' | 'review' | 'done';

export interface IceOnboardingState {
  readonly step: IceOnboardingStep;
  readonly ice: string;
  readonly dossier: IceDossier | null;
  readonly errorKey: AuthErrorKey | null;
  /** Vrai quand l'erreur porte sur le champ ICE (aria-invalid). */
  readonly fieldError: boolean;
  readonly startedAtMs: number;
  readonly finishedAtMs: number | null;
  readonly failures: number;
  readonly lockedUntilMs: number | null;
}

export type IceOnboardingEvent =
  | { readonly type: 'ICE_CHANGED'; readonly value: string }
  | { readonly type: 'SEARCH'; readonly nowMs: number }
  | { readonly type: 'FOUND'; readonly dossier: IceDossier }
  | { readonly type: 'FAILED'; readonly problem: ApiProblem; readonly nowMs: number }
  | { readonly type: 'CONFIRM'; readonly nowMs: number }
  | { readonly type: 'BACK' }
  | { readonly type: 'TICK'; readonly nowMs: number };

export function initialIceOnboarding(startedAtMs: number): IceOnboardingState {
  return { step: 'ice', ice: '', dossier: null, errorKey: null, fieldError: false, startedAtMs, finishedAtMs: null, failures: 0, lockedUntilMs: null };
}

export function elapsedMs(state: IceOnboardingState, nowMs: number): number {
  return Math.max(0, (state.finishedAtMs ?? nowMs) - state.startedAtMs);
}

export function isOverBudget(state: IceOnboardingState, nowMs: number): boolean {
  return elapsedMs(state, nowMs) > ICE_ONBOARDING_BUDGET_MS;
}

/** Index (1 ou 2) de l'étape visible, pour « étape x sur 2 ». */
export function visibleStepNumber(step: IceOnboardingStep): number {
  return step === 'review' || step === 'done' ? 2 : 1;
}

export function createIceOnboardingReducer(config: LockoutConfig): (state: IceOnboardingState, event: IceOnboardingEvent) => IceOnboardingState {
  return (state, event) => reduce(state, event, config);
}

function reduce(state: IceOnboardingState, event: IceOnboardingEvent, config: LockoutConfig): IceOnboardingState {
  switch (event.type) {
    case 'ICE_CHANGED':
      return state.step === 'ice' ? { ...state, ice: normalizeIceInput(event.value), errorKey: null, fieldError: false } : state;
    case 'SEARCH': {
      if (state.step !== 'ice') {
        return state;
      }
      if (state.lockedUntilMs !== null && event.nowMs < state.lockedUntilMs) {
        return { ...state, errorKey: 'errors.rateLimited', fieldError: false };
      }
      if (!isIceShapeValid(state.ice)) {
        return { ...state, errorKey: 'errors.iceShape', fieldError: true };
      }
      return { ...state, step: 'searching', errorKey: null, fieldError: false };
    }
    case 'FOUND':
      return state.step === 'searching' ? { ...state, step: 'review', dossier: event.dossier, errorKey: null, fieldError: false, failures: 0 } : state;
    case 'FAILED': {
      if (state.step !== 'searching') {
        return state;
      }
      const lock = registerFailure(
        { failures: state.failures, lockedUntilMs: state.lockedUntilMs },
        { nowMs: event.nowMs, retryAfterSec: event.problem.retryAfterSec, countsAsFailure: event.problem.status === 404 },
        config,
      );
      const iceRejected = event.problem.status === 400 && event.problem.fieldErrors['ice'] !== undefined;
      return {
        ...state,
        step: 'ice',
        errorKey: iceRejected ? 'errors.iceRejected' : problemMessageKey(event.problem),
        fieldError: iceRejected || event.problem.errorCode === 'DIRECTORY_ICE_NOT_FOUND',
        failures: lock.failures,
        lockedUntilMs: lock.lockedUntilMs,
      };
    }
    case 'CONFIRM':
      return state.step === 'review' ? { ...state, step: 'done', finishedAtMs: event.nowMs } : state;
    case 'BACK':
      return state.step === 'review' ? { ...state, step: 'ice', dossier: null, errorKey: null, fieldError: false } : state;
    case 'TICK': {
      const released = releaseIfElapsed({ failures: state.failures, lockedUntilMs: state.lockedUntilMs }, event.nowMs);
      return released.lockedUntilMs === state.lockedUntilMs ? state : { ...state, failures: released.failures, lockedUntilMs: released.lockedUntilMs };
    }
  }
}


/** Réducteur à deux arguments (compatible `useReducer` et `Array.reduce`) avec le verrouillage par défaut. */
export const iceOnboardingReducer = createIceOnboardingReducer(DEFAULT_LOCKOUT);
