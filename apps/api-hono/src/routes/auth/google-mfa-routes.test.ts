import { describe, expect, it } from 'vitest';
import type { GoogleOAuthRouterDeps } from '@fisca/auth-rbac';
import { createAuthRoutes } from './index.ts';
import { CALLBACK_PATH, buildGoogleKit, buildKit } from './test-kit.ts';

const START = '/api/v1/auth/google/start';

async function build() {
  const kit = await buildKit();
  const google = await buildGoogleKit();
  const deps: GoogleOAuthRouterDeps = {
    oauth: google.oauth,
    turnstile: { verify: async () => true },
    rateLimiter: { allow: async () => true },
    login: kit.flow,
  };
  const app = createAuthRoutes(deps);
  const callback = async (): Promise<Response> => {
    const started = await app.request(`${START}?cf-turnstile-response=ok`);
    const state = new URL(started.headers.get('Location') ?? '').searchParams.get('state') ?? '';
    return app.request(`${CALLBACK_PATH}?code=code-1&state=${state}`);
  };
  return { kit, google, app, callback };
}

describe('GET /api/v1/auth/google/callback — raccordement MFA (CTR-API-05)', () => {
  it('nouveau compte (aucun second facteur) : session directe, cookie de refresh Strict', async () => {
    const { kit, callback } = await build();
    const response = await callback();
    expect(response.status).toBe(200);
    const cookie = response.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    const body = (await response.json()) as { status: string; userId: string; isNewUser: boolean; accessToken: string };
    expect(body).toMatchObject({ status: 'AUTHENTICATED', userId: 'nouveau-1', isNewUser: true });
    const claims = await kit.sessions.verify(body.accessToken);
    expect(claims.sub).toBe('nouveau-1');
    expect(claims.mfaVerifiedAtEpochSec).toBeNull();
  });

  it('compte lié avec second facteur actif : mfa_challenge_token et JAMAIS de session avant validation', async () => {
    const { kit, google, callback } = await build();
    google.linkSub('sub-kit-1', 'u-mfa');
    await kit.enrollTotp('u-mfa');
    const response = await callback();
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    const text = await response.text();
    expect(text).not.toContain('accessToken');
    expect(text).not.toContain('userId');
    const body = JSON.parse(text) as { status: string; mfa_challenge_token: string; methods: string[]; expiresAtEpochSec: number };
    expect(body.status).toBe('MFA_REQUIRED');
    expect(body.methods).toContain('TOTP');
    expect(body.expiresAtEpochSec).toBe(kit.now() + 300);
    expect(kit.issuedSessions).toEqual([]);
    expect(kit.refreshRows.size).toBe(0);
  });

  it('le jeton de défi émis par Google se valide par la route 2FA, puis seulement une session existe', async () => {
    const { kit, google, callback } = await build();
    google.linkSub('sub-kit-1', 'u-mfa2');
    const secret = await kit.enrollTotp('u-mfa2');
    kit.advance(30);
    const challenge = (await (await callback()).json()) as { mfa_challenge_token: string };
    const mfaApp = createAuthRoutes(
      { oauth: google.oauth, turnstile: { verify: async () => true }, rateLimiter: { allow: async () => true }, login: kit.flow },
      {
        ...kit.mfa,
        authenticator: { authenticate: async () => null },
        turnstile: { verify: async () => true },
        rateLimiter: { allow: async () => true },
      },
    );
    const wrong = await mfaApp.request('/api/v1/auth/2fa/verify?cf-turnstile-response=ok', {
      method: 'POST',
      body: JSON.stringify({ mfa_challenge_token: challenge.mfa_challenge_token, method: 'TOTP', code: '000000' }),
    });
    expect(wrong.status).toBe(401);
    expect(kit.issuedSessions).toEqual([]);
    const right = await mfaApp.request('/api/v1/auth/2fa/verify?cf-turnstile-response=ok', {
      method: 'POST',
      body: JSON.stringify({
        mfa_challenge_token: challenge.mfa_challenge_token,
        method: 'TOTP',
        code: await kit.totpCode(secret),
      }),
    });
    expect(right.status).toBe(200);
    expect(kit.issuedSessions).toEqual(['mfa:u-mfa2']);
  });

  it('politique imposant un second facteur non inscrit : 409 MFA_ENROLLMENT_REQUIRED, aucune session', async () => {
    const kit = await buildKit();
    const google = await buildGoogleKit();
    const app = createAuthRoutes({
      oauth: google.oauth,
      turnstile: { verify: async () => true },
      rateLimiter: { allow: async () => true },
      login: { ...kit.flow, policy: { isSecondFactorRequired: async () => true } },
    });
    const started = await app.request(`${START}?cf-turnstile-response=ok`);
    const state = new URL(started.headers.get('Location') ?? '').searchParams.get('state') ?? '';
    const response = await app.request(`${CALLBACK_PATH}?code=c&state=${state}`);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { errorCode: string }).errorCode).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(kit.issuedSessions).toEqual([]);
  });
});
