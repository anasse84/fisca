import { describe, expect, it } from 'vitest';
import {
  LOCKOUT_DEFAULT_POLICY,
  LoginError,
  completeFirstFactor,
  completeMfaChallenge,
  createJwtSessionAuthenticator,
  generateTotpCodeRfc6238,
  loginWithPassword,
} from '../src/index.ts';
import type { LoginDeps } from '../src/index.ts';
import { LOW_COST_PASSWORD_SERVICE, PASSWORD, PEPPER, buildFlowHarness } from './flow-fixtures.ts';

async function loginDeps() {
  const h = await buildFlowHarness();
  const deps: LoginDeps = { accounts: h.accounts, pepper: PEPPER, flow: h.flow, passwordService: LOW_COST_PASSWORD_SERVICE };
  return { h, deps };
}

async function loginCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LoginError) {
      return error.code;
    }
    throw error;
  }
  return 'AUCUNE_ERREUR';
}

describe('raccordement MFA — compte sans second facteur', () => {
  it('émet directement la session (JWT sans mfa_verified_at + cookie de refresh)', async () => {
    const { h } = await loginDeps();
    const outcome = await completeFirstFactor(h.flow, { userId: 'u-1', firstFactor: 'GOOGLE_OAUTH' });
    expect(outcome.kind).toBe('SESSION');
    if (outcome.kind !== 'SESSION') {
      return;
    }
    const claims = await h.sessions.verify(outcome.session.accessToken);
    expect(claims.sub).toBe('u-1');
    expect(claims.mfaVerifiedAtEpochSec).toBeNull();
    expect(outcome.session.setCookie).toContain('HttpOnly');
    expect(h.issuedSessions).toEqual(['first:u-1']);
  });
});

describe('raccordement MFA — compte avec second facteur actif', () => {
  it('n’émet AUCUNE session avant le second facteur, puis une session avec mfa_verified_at', async () => {
    const { h } = await loginDeps();
    const secret = await h.enrollTotp('u-2');
    const outcome = await completeFirstFactor(h.flow, { userId: 'u-2', firstFactor: 'GOOGLE_OAUTH' });
    expect(outcome.kind).toBe('MFA_REQUIRED');
    if (outcome.kind !== 'MFA_REQUIRED') {
      return;
    }
    expect(h.issuedSessions).toEqual([]);
    expect(h.refreshRows.size).toBe(0);
    expect(outcome.methods).toContain('TOTP');
    expect(JSON.stringify(outcome)).not.toContain('accessToken');
    h.advance(30);
    const code = await generateTotpCodeRfc6238({ base32Secret: secret, nowEpochSec: h.now() });
    const done = await completeMfaChallenge(h.flow.mfa, { token: outcome.mfaChallengeToken, method: 'TOTP', code });
    expect(h.issuedSessions).toEqual(['mfa:u-2']);
    const claims = await h.sessions.verify(done.session.accessToken);
    expect(claims.mfaVerifiedAtEpochSec).toBe(h.now());
    expect(claims.amr).toEqual(['google', 'otp']);
  });

  it('un code invalide n’émet toujours aucune session', async () => {
    const { h } = await loginDeps();
    await h.enrollTotp('u-3');
    const outcome = await completeFirstFactor(h.flow, { userId: 'u-3', firstFactor: 'PASSWORD' });
    if (outcome.kind !== 'MFA_REQUIRED') {
      throw new Error('défi attendu');
    }
    await expect(
      completeMfaChallenge(h.flow.mfa, { token: outcome.mfaChallengeToken, method: 'TOTP', code: '000000' }),
    ).rejects.toMatchObject({ code: 'MFA_CODE_INVALID' });
    expect(h.issuedSessions).toEqual([]);
  });

  it('le mfa_challenge_token n’est pas une session : le JWT de session le refuse', async () => {
    const { h } = await loginDeps();
    await h.enrollTotp('u-4');
    const outcome = await completeFirstFactor(h.flow, { userId: 'u-4', firstFactor: 'PASSWORD' });
    if (outcome.kind !== 'MFA_REQUIRED') {
      throw new Error('défi attendu');
    }
    const authenticator = createJwtSessionAuthenticator({ sessions: h.sessions, resolveAccountLabel: async () => 'u-4@example.ma' });
    expect(await authenticator.authenticate({ authorization: `Bearer ${outcome.mfaChallengeToken}`, cookie: null })).toBeNull();
    expect(await authenticator.authenticate({ authorization: null, cookie: null })).toBeNull();
    expect(await authenticator.authenticate({ authorization: 'Basic abc', cookie: null })).toBeNull();
  });

  it('l’authentificateur de session accepte un JWT valide et résout le libellé du compte', async () => {
    const { h } = await loginDeps();
    const outcome = await completeFirstFactor(h.flow, { userId: 'u-5', firstFactor: 'PASSWORD' });
    if (outcome.kind !== 'SESSION') {
      throw new Error('session attendue');
    }
    const authenticator = createJwtSessionAuthenticator({ sessions: h.sessions, resolveAccountLabel: async () => 'u-5@example.ma' });
    expect(await authenticator.authenticate({ authorization: `Bearer ${outcome.session.accessToken}`, cookie: null })).toEqual({
      userId: 'u-5',
      accountLabel: 'u-5@example.ma',
    });
    h.advance(901);
    expect(await authenticator.authenticate({ authorization: `Bearer ${outcome.session.accessToken}`, cookie: null })).toBeNull();
  });

  it('exige l’enrôlement (aucune session) quand la politique impose un second facteur non inscrit', async () => {
    const { h } = await loginDeps();
    h.requiredUsers.add('u-6');
    const outcome = await completeFirstFactor(h.flow, { userId: 'u-6', firstFactor: 'PASSWORD' });
    expect(outcome).toEqual({ kind: 'MFA_ENROLLMENT_REQUIRED' });
    expect(h.issuedSessions).toEqual([]);
  });
});

describe('connexion par mot de passe (CTR-API-03, Doc_09 § 02)', () => {
  it('sans second facteur : session directe', async () => {
    const { h, deps } = await loginDeps();
    await h.addPasswordUser('u-10', 'Nadia@Example.ma');
    const outcome = await loginWithPassword(deps, { email: ' nadia@example.ma ', password: PASSWORD });
    expect(outcome.kind).toBe('SESSION');
    expect(h.issuedSessions).toEqual(['first:u-10']);
  });

  it('avec second facteur : défi MFA, aucune session', async () => {
    const { h, deps } = await loginDeps();
    await h.addPasswordUser('u-11', 'a@example.ma');
    await h.enrollTotp('u-11');
    const outcome = await loginWithPassword(deps, { email: 'a@example.ma', password: PASSWORD });
    expect(outcome.kind).toBe('MFA_REQUIRED');
    expect(h.issuedSessions).toEqual([]);
  });

  it('refuse un mauvais mot de passe, un e-mail inconnu et un compte sans mot de passe avec la même erreur', async () => {
    const { h, deps } = await loginDeps();
    await h.addPasswordUser('u-12', 'b@example.ma');
    h.accountRows.set('u-13', {
      email: 'google@example.ma',
      account: { userId: 'u-13', passwordHash: null, lockout: { consecutiveFailures: 0, lockedUntilEpochMs: null } },
    });
    for (const attempt of [
      { email: 'b@example.ma', password: 'mauvais-mot-de-passe-1' },
      { email: 'inconnu@example.ma', password: PASSWORD },
      { email: 'google@example.ma', password: PASSWORD },
    ]) {
      expect(await loginCode(loginWithPassword(deps, attempt))).toBe('LOGIN_INVALID_CREDENTIALS');
    }
    expect(h.issuedSessions).toEqual([]);
  });

  it('verrouille 15 minutes après 5 échecs, même avec le bon mot de passe, puis déverrouille', async () => {
    const { h, deps } = await loginDeps();
    await h.addPasswordUser('u-14', 'c@example.ma');
    for (let attempt = 0; attempt < LOCKOUT_DEFAULT_POLICY.maxConsecutiveFailures; attempt += 1) {
      expect(await loginCode(loginWithPassword(deps, { email: 'c@example.ma', password: 'mauvais-mot-de-passe-1' }))).toBe(
        'LOGIN_INVALID_CREDENTIALS',
      );
    }
    let locked: unknown;
    try {
      await loginWithPassword(deps, { email: 'c@example.ma', password: PASSWORD });
    } catch (error) {
      locked = error;
    }
    expect(locked).toBeInstanceOf(LoginError);
    expect(locked).toMatchObject({ code: 'LOGIN_ACCOUNT_LOCKED', retryAfterSec: 900 });
    expect(h.issuedSessions).toEqual([]);
    h.advance(900);
    const outcome = await loginWithPassword(deps, { email: 'c@example.ma', password: PASSWORD });
    expect(outcome.kind).toBe('SESSION');
  });

  it('remet le compteur d’échecs à zéro après un succès', async () => {
    const { h, deps } = await loginDeps();
    await h.addPasswordUser('u-15', 'd@example.ma');
    await loginCode(loginWithPassword(deps, { email: 'd@example.ma', password: 'mauvais-mot-de-passe-1' }));
    expect(h.accountRows.get('u-15')?.account.lockout.consecutiveFailures).toBe(1);
    await loginWithPassword(deps, { email: 'd@example.ma', password: PASSWORD });
    expect(h.accountRows.get('u-15')?.account.lockout.consecutiveFailures).toBe(0);
  });
});
