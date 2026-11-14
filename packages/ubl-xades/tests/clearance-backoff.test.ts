import { describe, expect, it } from 'vitest';
import {
  CLEARANCE_MAX_RETRIES,
  CLEARANCE_TOTAL_BUDGET_SECONDS,
  computeClearanceBackoffSchedule,
  decideNextAction,
  sumBackoffSeconds,
  type AttemptOutcome,
} from '../src/index.ts';

describe('computeClearanceBackoffSchedule', () => {
  const schedule = computeClearanceBackoffSchedule();

  it('compte exactement 8 réessais, en secondes entières', () => {
    expect(schedule).toHaveLength(8);
    expect(CLEARANCE_MAX_RETRIES).toBe(8);
    expect(schedule.every((seconds) => Number.isSafeInteger(seconds) && seconds > 0)).toBe(true);
  });

  it('barème retenu : 84, 168, 336, 672, 1344, 2688, 5376, 10752', () => {
    expect(schedule).toEqual([84, 168, 336, 672, 1344, 2688, 5376, 10752]);
  });

  it('croît exponentiellement (facteur 2)', () => {
    for (let index = 1; index < schedule.length; index += 1) {
      expect(schedule[index]).toBe((schedule[index - 1] ?? 0) * 2);
    }
  });

  it('somme des attentes ≤ 21 600 s et proche de 6 h', () => {
    const total = sumBackoffSeconds(schedule);
    expect(total).toBe(21_420);
    expect(total).toBeLessThanOrEqual(CLEARANCE_TOTAL_BUDGET_SECONDS);
    expect(total).toBeGreaterThan(21_000);
  });

  it('est déterministe et refuse un barème qui dépasse le budget ou des paramètres non entiers', () => {
    expect(computeClearanceBackoffSchedule()).toEqual(schedule);
    expect(() => computeClearanceBackoffSchedule({ baseSeconds: 85 })).toThrow(/OVER_BUDGET/);
    expect(() => computeClearanceBackoffSchedule({ baseSeconds: 1.5 })).toThrow(/INVALID/);
    expect(() => computeClearanceBackoffSchedule({ retries: 0 })).toThrow(/INVALID/);
  });
});

describe('decideNextAction', () => {
  const transient: AttemptOutcome = { kind: 'TRANSIENT', code: 'X' };
  it('succès et rejet permanent : fin immédiate, aucun réessai', () => {
    expect(decideNextAction({ kind: 'CLEARED', xhubUuid: 'u', receivedAt: 't', replayed: false }, 0)).toEqual({ action: 'FINISH' });
    expect(decideNextAction({ kind: 'REJECTED', code: 'R' }, 0)).toEqual({ action: 'FINISH' });
  });
  it('panne transitoire : attend le barème, 8 fois, puis épuisement', () => {
    const schedule = computeClearanceBackoffSchedule();
    schedule.forEach((seconds, retryIndex) => {
      expect(decideNextAction(transient, retryIndex)).toEqual({ action: 'SLEEP_THEN_RETRY', sleepSeconds: seconds });
    });
    expect(decideNextAction(transient, 8)).toEqual({ action: 'EXHAUSTED' });
  });
});
