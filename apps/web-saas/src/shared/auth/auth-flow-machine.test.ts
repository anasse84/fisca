import { describe, expect, it } from 'vitest';
import { authFlowReducer, initialAuthFlow, lockRemainingSecOf } from './auth-flow-machine.ts';
import type { AuthFlowEvent, AuthFlowState } from './auth-flow-machine.ts';
import type { ApiProblem } from './api-client.ts';

const problem = (errorCode: string, status: number, extra: Partial<ApiProblem> = {}): ApiProblem => ({ status, errorCode, retryAfterSec: null, fieldErrors: {}, ...extra });
const run = (events: readonly AuthFlowEvent[], from: AuthFlowState = initialAuthFlow()): AuthFlowState => events.reduce(authFlowReducer, from);
const challenge = { token: 'chal', expiresAtEpochSec: 2_000, methods: ['TOTP', 'RECOVERY_CODE'] as const };

describe('machine à états du parcours d’authentification', () => {
  it('démarre sur login, sans erreur ni verrou', () => {
    expect(initialAuthFlow()).toMatchObject({ step: 'login', busy: false, errorKey: null, challenge: null, history: [] });
    expect(initialAuthFlow('signup').step).toBe('signup');
  });

  it('login → MFA_REQUIRED → mfa → AUTHENTICATED, le jeton de défi n’existe que pendant le défi', () => {
    let s = run([{ type: 'SUBMIT', nowMs: 0 }]);
    expect(s.busy).toBe(true);
    s = run([{ type: 'MFA_REQUIRED', challenge: { ...challenge, methods: [...challenge.methods] } }], s);
    expect(s).toMatchObject({ step: 'mfa', busy: false, challenge: { token: 'chal' } });
    s = run([{ type: 'AUTHENTICATED' }], s);
    expect(s).toMatchObject({ step: 'authenticated', challenge: null });
  });

  it('retour arrière : mfa → login efface le défi ; signup → login ; forgot → login', () => {
    const inMfa = run([{ type: 'MFA_REQUIRED', challenge: { ...challenge, methods: [...challenge.methods] } }]);
    expect(run([{ type: 'BACK' }], inMfa)).toMatchObject({ step: 'login', challenge: null });
    expect(run([{ type: 'NAVIGATE', to: 'signup' }, { type: 'BACK' }]).step).toBe('login');
    expect(run([{ type: 'NAVIGATE', to: 'forgot' }, { type: 'BACK' }]).step).toBe('login');
    expect(run([{ type: 'BACK' }]).step).toBe('login');
  });

  it('un échec 401 de login compte, affiche la clé d’erreur et libère busy', () => {
    const s = run([{ type: 'SUBMIT', nowMs: 0 }, { type: 'FAILED', problem: problem('LOGIN_INVALID_CREDENTIALS', 401), nowMs: 5 }]);
    expect(s).toMatchObject({ busy: false, failures: 1, errorKey: 'errors.invalidCredentials' });
  });

  it('verrouillage : 5 échecs consécutifs bloquent SUBMIT jusqu’à l’échéance, TICK déverrouille', () => {
    let s = initialAuthFlow();
    for (let i = 0; i < 5; i += 1) {
      s = run([{ type: 'SUBMIT', nowMs: 100 }, { type: 'FAILED', problem: problem('LOGIN_INVALID_CREDENTIALS', 401), nowMs: 100 }], s);
    }
    expect(lockRemainingSecOf(s, 100)).toBeGreaterThan(0);
    const blocked = run([{ type: 'SUBMIT', nowMs: 200 }], s);
    expect(blocked.busy).toBe(false);
    expect(blocked.errorKey).toBe('errors.accountLocked');
    const later = run([{ type: 'TICK', nowMs: 100 + 24 * 3600 * 1000 }], s);
    expect(later.lockedUntilMs).toBeNull();
    expect(run([{ type: 'SUBMIT', nowMs: 100 + 24 * 3600 * 1000 }], later).busy).toBe(true);
  });

  it('429 avec Retry-After : verrou serveur dès le premier échec', () => {
    const s = run([{ type: 'SUBMIT', nowMs: 0 }, { type: 'FAILED', problem: problem('LOGIN_ACCOUNT_LOCKED', 429, { retryAfterSec: 900 }), nowMs: 0 }]);
    expect(s.errorKey).toBe('errors.accountLocked');
    expect(lockRemainingSecOf(s, 0)).toBe(900);
  });

  it('défi expiré, rejoué, essais épuisés ou invalide : retour à login, défi effacé, erreur affichée', () => {
    for (const [code, status, key] of [
      ['MFA_CHALLENGE_EXPIRED', 401, 'errors.challengeExpired'],
      ['MFA_CHALLENGE_REPLAYED', 401, 'errors.challengeExpired'],
      ['MFA_CHALLENGE_ATTEMPTS_EXHAUSTED', 429, 'errors.attemptsExhausted'],
      ['MFA_CHALLENGE_SIGNATURE_INVALID', 401, 'errors.challengeExpired'],
    ] as const) {
      const s = run([{ type: 'MFA_REQUIRED', challenge: { ...challenge, methods: [...challenge.methods] } }, { type: 'SUBMIT', nowMs: 0 }, { type: 'FAILED', problem: problem(code, status), nowMs: 0 }]);
      expect(s, code).toMatchObject({ step: 'login', challenge: null, errorKey: key });
    }
  });

  it('code MFA faux : reste sur mfa, défi conservé, compteur d’échecs', () => {
    const s = run([{ type: 'MFA_REQUIRED', challenge: { ...challenge, methods: [...challenge.methods] } }, { type: 'SUBMIT', nowMs: 0 }, { type: 'FAILED', problem: problem('MFA_CODE_INVALID', 401), nowMs: 0 }]);
    expect(s).toMatchObject({ step: 'mfa', challenge: { token: 'chal' }, failures: 1, errorKey: 'errors.mfaCodeInvalid' });
  });

  it('le défi expire côté client à l’échéance (TICK)', () => {
    const s = run([{ type: 'MFA_REQUIRED', challenge: { ...challenge, methods: [...challenge.methods] } }, { type: 'TICK', nowMs: 2_000_000 }]);
    expect(s).toMatchObject({ step: 'login', challenge: null, errorKey: 'errors.challengeExpired' });
  });

  it('MFA_ENROLLMENT_REQUIRED : message dédié, reste sur login', () => {
    const s = run([{ type: 'SUBMIT', nowMs: 0 }, { type: 'FAILED', problem: problem('MFA_ENROLLMENT_REQUIRED', 409), nowMs: 0 }]);
    expect(s).toMatchObject({ step: 'login', errorKey: 'errors.enrollmentRequired' });
  });

  it('inscription → vérification e-mail → login ; erreurs de champ conservées par champ', () => {
    let s = run([{ type: 'NAVIGATE', to: 'signup' }, { type: 'SUBMIT', nowMs: 0 }, { type: 'FAILED', problem: problem('REQUEST_VALIDATION_FAILED', 400, { fieldErrors: { email: [{ code: 'x' }] } }), nowMs: 0 }]);
    expect(s.fieldErrors).toEqual({ email: [{ code: 'x' }] });
    expect(s.failures).toBe(0);
    s = run([{ type: 'SUBMIT', nowMs: 0 }, { type: 'REGISTERED', email: 'a@b.ma' }], s);
    expect(s).toMatchObject({ step: 'verify-email', pendingEmail: 'a@b.ma', fieldErrors: {} });
    expect(run([{ type: 'EMAIL_VERIFIED' }], s)).toMatchObject({ step: 'login', history: [] });
  });

  it('mot de passe oublié → envoyé ; reset → terminé ; une nouvelle SUBMIT efface l’erreur', () => {
    let s = run([{ type: 'NAVIGATE', to: 'forgot' }, { type: 'SUBMIT', nowMs: 0 }, { type: 'FORGOT_SENT' }]);
    expect(s.step).toBe('forgot-sent');
    s = run([{ type: 'NAVIGATE', to: 'reset' }, { type: 'SUBMIT', nowMs: 0 }, { type: 'FAILED', problem: problem('PASSWORD_RESET_TOKEN_INVALID', 400), nowMs: 0 }]);
    expect(s.errorKey).toBe('errors.tokenInvalid');
    s = run([{ type: 'SUBMIT', nowMs: 0 }], s);
    expect(s.errorKey).toBeNull();
    expect(run([{ type: 'RESET_DONE' }], s).step).toBe('reset-done');
  });

  it('un changement d’étape remet le compteur d’échecs à zéro', () => {
    const s = run([{ type: 'SUBMIT', nowMs: 0 }, { type: 'FAILED', problem: problem('LOGIN_INVALID_CREDENTIALS', 401), nowMs: 0 }, { type: 'NAVIGATE', to: 'signup' }]);
    expect(s.failures).toBe(0);
  });

  it('la machine ne retient jamais de mot de passe, de code ni de jeton d’accès', () => {
    const s = run([{ type: 'SUBMIT', nowMs: 0 }, { type: 'MFA_REQUIRED', challenge: { ...challenge, methods: [...challenge.methods] } }, { type: 'AUTHENTICATED' }]);
    expect(JSON.stringify(s)).not.toMatch(/password|accessToken|code"/i);
  });
});
