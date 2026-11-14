import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCKOUT, emptyLockout, lockRemainingSec, registerFailure, releaseIfElapsed } from './lockout.ts';

describe('verrouillage d’interface après échecs', () => {
  it('verrouille au N-ième échec consécutif pour la durée de refroidissement', () => {
    let s = emptyLockout();
    for (let i = 0; i < DEFAULT_LOCKOUT.maxFailures - 1; i += 1) {
      s = registerFailure(s, { nowMs: 1000, retryAfterSec: null, countsAsFailure: true }, DEFAULT_LOCKOUT);
      expect(s.lockedUntilMs).toBeNull();
    }
    s = registerFailure(s, { nowMs: 1000, retryAfterSec: null, countsAsFailure: true }, DEFAULT_LOCKOUT);
    expect(s.lockedUntilMs).toBe(1000 + DEFAULT_LOCKOUT.cooldownSec * 1000);
    expect(lockRemainingSec(s, 1000)).toBe(DEFAULT_LOCKOUT.cooldownSec);
  });
  it('un Retry-After du serveur prime, même au premier échec', () => {
    const s = registerFailure(emptyLockout(), { nowMs: 0, retryAfterSec: 900, countsAsFailure: false }, DEFAULT_LOCKOUT);
    expect(s.lockedUntilMs).toBe(900_000);
  });
  it('un échec qui ne compte pas (réseau, validation) n’avance pas le compteur', () => {
    const s = registerFailure(emptyLockout(), { nowMs: 0, retryAfterSec: null, countsAsFailure: false }, DEFAULT_LOCKOUT);
    expect(s.failures).toBe(0);
  });
  it('déverrouille à l’échéance et remet le compteur à zéro ; arrondi par excès du temps restant', () => {
    const s = registerFailure(emptyLockout(), { nowMs: 0, retryAfterSec: 10, countsAsFailure: false }, DEFAULT_LOCKOUT);
    expect(lockRemainingSec(s, 9_001)).toBe(1);
    expect(releaseIfElapsed(s, 9_999).lockedUntilMs).toBe(10_000);
    expect(releaseIfElapsed(s, 10_000)).toEqual(emptyLockout());
  });
  it('un Retry-After absurde est borné', () => {
    const s = registerFailure(emptyLockout(), { nowMs: 0, retryAfterSec: 10 ** 9, countsAsFailure: false }, DEFAULT_LOCKOUT);
    expect(s.lockedUntilMs).toBeLessThanOrEqual(DEFAULT_LOCKOUT.maxLockSec * 1000);
  });
});
