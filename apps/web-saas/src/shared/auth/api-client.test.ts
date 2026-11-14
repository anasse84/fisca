// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createAuthApi } from './api-client.ts';
import { fakeFetch, problemBody } from './auth-test-kit.ts';

const OK_SESSION = { status: 'AUTHENTICATED', accessToken: 'jwt-en-memoire', expiresInSec: 900 };

describe('client API d’authentification : routes du registre', () => {
  it('login : POST /api/v1/auth/login {email, password}, Turnstile en paramètre cf-turnstile-response', async () => {
    const { fetch, calls } = fakeFetch({ 'POST /api/v1/auth/login': { status: 200, body: OK_SESSION } });
    const api = createAuthApi({ fetch, getTurnstileToken: async () => 'tok 1&x' });
    const result = await api.login({ email: 'a@b.ma', password: 'motdepasse-long-12' });
    expect(result).toEqual({ ok: true, data: { kind: 'AUTHENTICATED', accessToken: 'jwt-en-memoire', expiresInSec: 900 } });
    expect(calls[0]?.url).toBe('/api/v1/auth/login?cf-turnstile-response=tok%201%26x');
    expect(calls[0]?.body).toEqual({ email: 'a@b.ma', password: 'motdepasse-long-12' });
    expect(calls[0]?.headers['content-type']).toBe('application/json');
  });

  it('login : MFA_REQUIRED rend le jeton de défi et les méthodes, sans accessToken', async () => {
    const { fetch } = fakeFetch({
      'POST /api/v1/auth/login': { status: 200, body: { status: 'MFA_REQUIRED', mfa_challenge_token: 'chal', expiresAtEpochSec: 1900000000, methods: ['TOTP', 'RECOVERY_CODE'] } },
    });
    const result = await createAuthApi({ fetch }).login({ email: 'a@b.ma', password: 'x' });
    expect(result).toEqual({ ok: true, data: { kind: 'MFA_REQUIRED', mfaChallengeToken: 'chal', expiresAtEpochSec: 1900000000, methods: ['TOTP', 'RECOVERY_CODE'] } });
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });

  it('2fa/verify : corps {mfa_challenge_token, method, code}', async () => {
    const { fetch, calls } = fakeFetch({ 'POST /api/v1/auth/2fa/verify': { status: 200, body: OK_SESSION } });
    const result = await createAuthApi({ fetch }).verifyMfa({ mfaChallengeToken: 'chal', method: 'TOTP', code: '123456' });
    expect(result.ok).toBe(true);
    expect(calls[0]?.body).toEqual({ mfa_challenge_token: 'chal', method: 'TOTP', code: '123456' });
  });

  it('register {email, password, full_name}, verify-email {token}, forgot {email}, reset {token, newPassword}', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /api/v1/auth/register': { status: 202, body: { status: 'VERIFICATION_PENDING' } },
      'POST /api/v1/auth/verify-email': { status: 200, body: { status: 'EMAIL_VERIFIED' } },
      'POST /api/v1/auth/password/forgot': { status: 202, body: { status: 'RESET_REQUESTED' } },
      'POST /api/v1/auth/password/reset': { status: 200, body: { status: 'PASSWORD_RESET' } },
    });
    const api = createAuthApi({ fetch });
    expect((await api.register({ email: 'a@b.ma', password: 'p'.repeat(12), fullName: 'Amina B.' })).ok).toBe(true);
    expect((await api.verifyEmail({ token: '123456' })).ok).toBe(true);
    expect((await api.forgotPassword({ email: 'a@b.ma' })).ok).toBe(true);
    expect((await api.resetPassword({ token: 'tk', newPassword: 'n'.repeat(12) })).ok).toBe(true);
    expect(calls.map((c) => c.body)).toEqual([
      { email: 'a@b.ma', password: 'p'.repeat(12), full_name: 'Amina B.' },
      { token: '123456' },
      { email: 'a@b.ma' },
      { token: 'tk', newPassword: 'n'.repeat(12) },
    ]);
  });

  it('google/start : URL de navigation GET avec le jeton Turnstile (jamais un fetch : la réponse est une redirection 302)', async () => {
    const { fetch, calls } = fakeFetch({});
    const api = createAuthApi({ fetch, getTurnstileToken: async () => 'ts-1' });
    expect(await api.googleStartUrl()).toBe('/api/v1/auth/google/start?cf-turnstile-response=ts-1');
    expect(calls).toHaveLength(0);
  });

  it('annuaire ICE : GET /api/v1/directory/ice/:ice avec Authorization Bearer, sans X-Fisca-Company-Id', async () => {
    const body = {
      ice: '000000000000097', identifiantFiscal: '12345678', rcNumber: '45678', rcTribunal: 'Rabat', raisonSocialeFr: 'Société Test SARL',
      raisonSocialeAr: null, legalForm: 'SARL', shareCapitalCents: 10000000, addressAdc450: '12 avenue Mohammed V, Rabat', verifiedCount: 3,
    };
    const { fetch, calls } = fakeFetch({ 'GET /api/v1/directory/ice/000000000000097': { status: 200, body } });
    const api = createAuthApi({ fetch, getAccessToken: () => 'jwt-en-memoire' });
    const result = await api.lookupIce('000000000000097');
    expect(result).toEqual({ ok: true, data: body });
    expect(calls[0]?.headers['authorization']).toBe('Bearer jwt-en-memoire');
    expect(calls[0]?.headers['x-fisca-company-id']).toBeUndefined();
  });

  it('annuaire ICE : refuse de partir sans jeton en mémoire, et n’envoie jamais autre chose que 15 chiffres dans le chemin', async () => {
    const { fetch, calls } = fakeFetch({});
    const noToken = await createAuthApi({ fetch, getAccessToken: () => null }).lookupIce('000000000000097');
    expect(noToken.ok).toBe(false);
    const bad = await createAuthApi({ fetch, getAccessToken: () => 't' }).lookupIce('../../etc');
    expect(bad.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('format de réponse inattendu : erreur RESPONSE_INVALID, pas d’exception', async () => {
    const { fetch } = fakeFetch({ 'POST /api/v1/auth/login': { status: 200, body: { status: 'AUTHENTICATED' } } });
    const result = await createAuthApi({ fetch }).login({ email: 'a', password: 'b' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.errorCode).toBe('RESPONSE_INVALID');
    }
  });
});

describe('ProblemDetails RFC 9457', () => {
  it('lit errorCode, traceId, instance, legalRef et Retry-After', async () => {
    const { fetch } = fakeFetch({
      'POST /api/v1/auth/login': {
        status: 429,
        headers: { 'Retry-After': '900' },
        body: problemBody(429, 'LOGIN_ACCOUNT_LOCKED', { instance: '/api/v1/auth/login', legalRef: 'Doc_09' }),
      },
    });
    const result = await createAuthApi({ fetch }).login({ email: 'a', password: 'b' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toMatchObject({ status: 429, errorCode: 'LOGIN_ACCOUNT_LOCKED', traceId: 'trace-1', instance: '/api/v1/auth/login', legalRef: 'Doc_09', retryAfterSec: 900 });
    }
  });

  it('issues[] devient des erreurs par champ (premier segment du chemin), sans reprendre le texte serveur', async () => {
    const { fetch } = fakeFetch({
      'POST /api/v1/auth/register': {
        status: 400,
        body: problemBody(400, 'REQUEST_VALIDATION_FAILED', {
          issues: [
            { path: 'email', message: 'Adresse invalide', code: 'invalid_format' },
            { path: 'password.length', message: 'Trop court' },
            { path: 'email', message: 'Autre' },
          ],
        }),
      },
    });
    const result = await createAuthApi({ fetch }).register({ email: 'x', password: 'y', fullName: 'z' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.problem.fieldErrors).sort()).toEqual(['email', 'password']);
      expect(result.problem.fieldErrors['email']).toEqual([{ code: 'invalid_format' }, { code: undefined }]);
      expect(JSON.stringify(result.problem.fieldErrors)).not.toContain('invalide');
    }
  });

  it('corps non JSON ou sans errorCode : UNKNOWN_ERROR avec le statut HTTP', async () => {
    const { fetch } = fakeFetch({ 'POST /api/v1/auth/login': { status: 502, body: { foo: 1 } } });
    const result = await createAuthApi({ fetch }).login({ email: 'a', password: 'b' });
    expect(result.ok === false && result.problem.errorCode).toBe('UNKNOWN_ERROR');
    expect(result.ok === false && result.problem.status).toBe(502);
  });

  it('erreur réseau : NETWORK_ERROR, statut 0, sans fuite du message d’exception', async () => {
    const api = createAuthApi({
      fetch: async () => {
        throw new TypeError('secret-interne');
      },
    });
    const result = await api.login({ email: 'a', password: 'b' });
    expect(result.ok === false && result.problem.errorCode).toBe('NETWORK_ERROR');
    expect(JSON.stringify(result)).not.toContain('secret-interne');
  });
});

describe('zero-trust', () => {
  it('aucun jeton, mot de passe ni secret dans localStorage, sessionStorage, console', async () => {
    const stores = [Storage.prototype.setItem];
    const writes: string[] = [];
    Storage.prototype.setItem = function (key: string, value: string) {
      writes.push(`${key}=${value}`);
    };
    const logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    try {
      const { fetch } = fakeFetch({ 'POST /api/v1/auth/login': { status: 200, body: OK_SESSION }, 'POST /api/v1/auth/2fa/verify': { status: 401, body: problemBody(401, 'MFA_CODE_INVALID') } });
      const api = createAuthApi({ fetch });
      await api.login({ email: 'a@b.ma', password: 'motdepasse-long-12' });
      await api.verifyMfa({ mfaChallengeToken: 'chal', method: 'TOTP', code: '000000' });
    } finally {
      Storage.prototype.setItem = stores[0] ?? Storage.prototype.setItem;
    }
    expect(writes).toEqual([]);
    expect(logSpies.flatMap((spy) => spy.mock.calls)).toEqual([]);
    logSpies.forEach((spy) => spy.mockRestore());
  });

  it('n’écrit jamais X-Fisca-Company-Id : l’en-tête est réservé aux routes de dossier, vérifié côté serveur', async () => {
    const { fetch, calls } = fakeFetch({ 'POST /api/v1/auth/login': { status: 200, body: OK_SESSION } });
    await createAuthApi({ fetch }).login({ email: 'a', password: 'b' });
    expect(Object.keys(calls[0]?.headers ?? {})).not.toContain('x-fisca-company-id');
  });
});
