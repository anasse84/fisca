import { describe, expect, it } from 'vitest';
import { createJwtSessionAuthenticator } from '@fisca/auth-rbac';
import type { PasskeyRouterDeps, SessionRouterDeps } from '@fisca/auth-rbac';
import { createAuthRoutes, createPasskeyRoutes } from './index.ts';
import { CALLBACK_PATH, PASSWORD, PEPPER, buildGoogleKit, buildKit } from './test-kit.ts';

const OK = { verify: async () => true };
const OPEN = { allow: async () => true };

async function build() {
  const kit = await buildKit();
  const google = await buildGoogleKit();
  const session: SessionRouterDeps = { sessions: kit.sessions, turnstile: OK, rateLimiter: OPEN };
  const passkeys: PasskeyRouterDeps = {
    passkeys: {
      config: { rpId: 'fisca.ma', rpName: 'Fisca', allowedOrigins: ['https://app.fisca.ma'] },
      challenges: { save: async () => undefined, consume: async () => null },
      credentials: {
        listByUser: async () => [],
        findByCredentialId: async () => null,
        insert: async () => true,
        updateSignCount: async () => false,
      },
      nowEpochSec: () => kit.now(),
    },
    sessions: kit.sessions,
    authenticator: createJwtSessionAuthenticator({ sessions: kit.sessions, resolveAccountLabel: async (id) => `${id}@example.ma` }),
    turnstile: OK,
    rateLimiter: OPEN,
  };
  const app = createAuthRoutes(
    { oauth: google.oauth, turnstile: OK, rateLimiter: OPEN, login: kit.flow },
    { ...kit.mfa, authenticator: passkeys.authenticator, turnstile: OK, rateLimiter: OPEN },
    { accounts: kit.accounts, pepper: PEPPER, flow: kit.flow, turnstile: OK, rateLimiter: OPEN },
    { session, passkeys },
  );
  return { kit, app, passkeys };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://fisca.test${path}?cf-turnstile-response=tok`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('colle : les 6 routes CTR-API-35 à 40 sont montées sans casser les existantes', () => {
  it('refresh et logout répondent (401 sans cookie / 200 idempotent)', async () => {
    const { app } = await build();
    expect((await app.request(post('/api/v1/auth/refresh', {}))).status).toBe(401);
    const logout = await app.request(post('/api/v1/auth/logout', {}));
    expect(logout.status).toBe(200);
    expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('les quatre routes passkeys répondent', async () => {
    const { app } = await build();
    expect((await app.request(post('/api/v1/auth/passkeys/register/options', {}))).status).toBe(401);
    expect((await app.request(post('/api/v1/auth/passkeys/register/verify', {}))).status).toBe(401);
    expect((await app.request(post('/api/v1/auth/passkeys/authenticate/options', {}))).status).toBe(200);
    expect((await app.request(post('/api/v1/auth/passkeys/authenticate/verify', {}))).status).toBe(400);
  });

  it('les routes existantes restent montées (login, Google, 2FA)', async () => {
    const { kit, app } = await build();
    await kit.addPasswordUser('u-colle', 'colle@example.ma');
    const login = await app.request(post('/api/v1/auth/login', { email: 'colle@example.ma', password: PASSWORD }));
    expect(login.status).toBe(200);
    expect((await app.request(post('/api/v1/auth/2fa/totp/setup', {}))).status).toBe(401);
    expect((await app.request(post('/api/v1/auth/2fa/verify', {}))).status).toBe(400);
    expect((await app.request(`https://fisca.test${CALLBACK_PATH}`)).status).not.toBe(404);
  });

  it('createPasskeyRoutes expose le routeur passkeys seul', async () => {
    const { passkeys } = await build();
    const app = createPasskeyRoutes(passkeys);
    expect((await app.request(post('/api/v1/auth/passkeys/authenticate/options', {}))).status).toBe(200);
    expect((await app.request(post('/api/v1/auth/refresh', {}))).status).toBe(404);
  });
});
