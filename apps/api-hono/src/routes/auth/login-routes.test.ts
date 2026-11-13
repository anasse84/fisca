import { describe, expect, it } from 'vitest';
import type { LoginRouterDeps, MfaRouterDeps } from '@fisca/auth-rbac';
import { createAuthRoutes, createLoginRoutes } from './index.ts';
import { PASSWORD, PEPPER, buildGoogleKit, buildKit } from './test-kit.ts';

const LOGIN = '/api/v1/auth/login';
const VERIFY = '/api/v1/auth/2fa/verify';

async function build(options: { turnstileOk?: boolean; rateOk?: boolean } = {}) {
  const kit = await buildKit();
  const rateKeys: string[] = [];
  const turnstileCalls: { token: string | null; remoteIp: string | null }[] = [];
  const deps: LoginRouterDeps = {
    accounts: kit.accounts,
    pepper: PEPPER,
    flow: kit.flow,
    turnstile: {
      verify: async (input) => {
        turnstileCalls.push(input);
        return options.turnstileOk ?? true;
      },
    },
    rateLimiter: {
      allow: async (key) => {
        rateKeys.push(key);
        return options.rateOk ?? true;
      },
    },
  };
  return { kit, deps, app: createLoginRoutes(deps), rateKeys, turnstileCalls };
}

function post(app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }, body: unknown, query = '?cf-turnstile-response=ok') {
  return app.request(`${LOGIN}${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/auth/login (CTR-API-03)', () => {
  it('compte sans second facteur : 200, JWT 15 min et cookie de refresh HttpOnly Secure SameSite=Strict', async () => {
    const { kit, app, rateKeys, turnstileCalls } = await build();
    await kit.addPasswordUser('u-1', 'nadia@example.ma');
    const response = await post(app, { email: 'Nadia@Example.ma', password: PASSWORD });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const cookie = response.headers.get('Set-Cookie') ?? '';
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict']) {
      expect(cookie).toContain(attribute);
    }
    const body = (await response.json()) as { status: string; accessToken: string; expiresInSec: number };
    expect(body.status).toBe('AUTHENTICATED');
    expect(body.expiresInSec).toBe(900);
    expect((await kit.sessions.verify(body.accessToken)).sub).toBe('u-1');
    expect(rateKeys).toEqual(['auth:login:203.0.113.9']);
    expect(turnstileCalls).toEqual([{ token: 'ok', remoteIp: '203.0.113.9' }]);
  });

  it('compte avec second facteur : 200 MFA_REQUIRED, mfa_challenge_token, ni JWT ni cookie', async () => {
    const { kit, app } = await build();
    await kit.addPasswordUser('u-2', 'b@example.ma');
    const secret = await kit.enrollTotp('u-2');
    const response = await post(app, { email: 'b@example.ma', password: PASSWORD });
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    const text = await response.text();
    expect(text).not.toContain('accessToken');
    const body = JSON.parse(text) as { status: string; mfa_challenge_token: string; methods: string[]; userId?: string };
    expect(body.status).toBe('MFA_REQUIRED');
    expect(body.methods).toContain('TOTP');
    expect(body.userId).toBeUndefined();
    expect(kit.issuedSessions).toEqual([]);
    expect(kit.refreshRows.size).toBe(0);

    kit.advance(30);
    // Le second facteur valide ensuite la session via la route 2FA du registre.
    const mfaDeps: MfaRouterDeps = {
      ...kit.mfa,
      authenticator: { authenticate: async () => null },
      turnstile: { verify: async () => true },
      rateLimiter: { allow: async () => true },
    };
    const googleKit = await buildGoogleKit();
    const full = createAuthRoutes(
      { oauth: googleKit.oauth, turnstile: mfaDeps.turnstile, rateLimiter: mfaDeps.rateLimiter },
      mfaDeps,
      undefined,
    );
    const verified = await full.request(`${VERIFY}?cf-turnstile-response=ok`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfa_challenge_token: body.mfa_challenge_token, method: 'TOTP', code: await kit.totpCode(secret) }),
    });
    expect(verified.status).toBe(200);
    const done = (await verified.json()) as { accessToken: string };
    expect((await kit.sessions.verify(done.accessToken)).mfaVerifiedAtEpochSec).toBe(kit.now());
    expect(verified.headers.get('Set-Cookie')).toContain('SameSite=Strict');
  });

  it('refuse (401) identiques un mauvais mot de passe et un e-mail inconnu', async () => {
    const { kit, app } = await build();
    await kit.addPasswordUser('u-3', 'c@example.ma');
    const wrong = await post(app, { email: 'c@example.ma', password: 'mauvais-mot-de-passe-1' });
    const unknown = await post(app, { email: 'zz@example.ma', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const a = (await wrong.json()) as { errorCode: string; detail: string };
    const b = (await unknown.json()) as { errorCode: string; detail: string };
    expect(a.errorCode).toBe('LOGIN_INVALID_CREDENTIALS');
    expect({ errorCode: a.errorCode, detail: a.detail }).toEqual({ errorCode: b.errorCode, detail: b.detail });
    expect(wrong.headers.get('Set-Cookie')).toBeNull();
    expect(kit.issuedSessions).toEqual([]);
  });

  it('verrouille (429 + Retry-After) après 5 échecs', async () => {
    const { kit, app } = await build();
    await kit.addPasswordUser('u-4', 'd@example.ma');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await post(app, { email: 'd@example.ma', password: 'mauvais-mot-de-passe-1' })).status).toBe(401);
    }
    const locked = await post(app, { email: 'd@example.ma', password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.headers.get('Retry-After')).toBe('900');
    expect(((await locked.json()) as { errorCode: string }).errorCode).toBe('LOGIN_ACCOUNT_LOCKED');
    expect(kit.issuedSessions).toEqual([]);
  });

  it('refuse sans Turnstile (403) et au-delà de la limite de débit (429), avant tout calcul de mot de passe', async () => {
    const noTurnstile = await build({ turnstileOk: false });
    await noTurnstile.kit.addPasswordUser('u-5', 'e@example.ma');
    expect((await post(noTurnstile.app, { email: 'e@example.ma', password: PASSWORD }, '')).status).toBe(403);
    expect(noTurnstile.kit.issuedSessions).toEqual([]);
    const limited = await build({ rateOk: false });
    expect((await post(limited.app, { email: 'e@example.ma', password: PASSWORD })).status).toBe(429);
    expect(limited.turnstileCalls).toHaveLength(0);
  });

  it('refuse (400) un corps invalide', async () => {
    const { app } = await build();
    for (const body of [{}, { email: 1, password: 'x' }, { email: 'a@b.ma' }, [], 'texte']) {
      const response = await post(app, body);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { errorCode: string }).errorCode).toBe('REQUEST_INVALID');
    }
    const broken = await app.request(`${LOGIN}?cf-turnstile-response=ok`, { method: 'POST', body: '{pas json' });
    expect(broken.status).toBe(400);
  });

  it('refuse (409) sans session quand la politique impose un second facteur non inscrit', async () => {
    const { kit, deps } = await build();
    await kit.addPasswordUser('u-6', 'f@example.ma');
    const app = createLoginRoutes({
      ...deps,
      flow: { ...kit.flow, policy: { isSecondFactorRequired: async () => true } },
    });
    const response = await post(app, { email: 'f@example.ma', password: PASSWORD });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { errorCode: string }).errorCode).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(kit.issuedSessions).toEqual([]);
  });

  it("n'expose que POST sur la route du registre", async () => {
    const { app } = await build();
    expect((await app.request(LOGIN)).status).toBe(404);
    expect((await app.request('/api/v1/auth/refresh', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/v1/auth/logout', { method: 'POST' })).status).toBe(404);
  });
});
