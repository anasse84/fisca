import { describe, expect, it } from 'vitest';
import type { SessionRouterDeps } from '@fisca/auth-rbac';
import { createSessionRoutes } from './index.ts';
import { buildKit } from './test-kit.ts';

const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const COOKIE_NAME = '__Host-fisca_refresh';

async function build(options: { turnstileOk?: boolean; rateOk?: boolean } = {}) {
  const kit = await buildKit();
  const rateKeys: string[] = [];
  const turnstileCalls: { token: string | null; remoteIp: string | null }[] = [];
  const deps: SessionRouterDeps = {
    sessions: kit.sessions,
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
  return { kit, app: createSessionRoutes(deps), rateKeys, turnstileCalls };
}

function pair(setCookie: string | null): string {
  return (setCookie ?? '').split(';')[0] ?? '';
}

function post(path: string, cookie: string | null, turnstile = 'tok'): Request {
  const headers: Record<string, string> = { 'CF-Connecting-IP': '203.0.113.7' };
  if (cookie !== null) {
    headers['Cookie'] = cookie;
  }
  return new Request(`https://fisca.test${path}?cf-turnstile-response=${turnstile}`, { method: 'POST', headers });
}

async function login(kit: Awaited<ReturnType<typeof buildKit>>, userId = 'u-1'): Promise<string> {
  const session = await kit.sessions.issuePasskeySession({ userId });
  return pair(session.setCookie);
}

async function errorCode(response: Response): Promise<string> {
  expect(response.headers.get('Content-Type')).toContain('application/problem+json');
  const body = (await response.json()) as { errorCode: string };
  return body.errorCode;
}

describe('POST /api/v1/auth/refresh', () => {
  it('lit le cookie, fait tourner le jeton et pose un nouveau cookie durci', async () => {
    const { kit, app } = await build();
    const first = await login(kit);
    kit.advance(60);
    const response = await app.request(post(REFRESH, first));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const setCookie = response.headers.get('Set-Cookie') ?? '';
    expect(setCookie.startsWith(`${COOKIE_NAME}=`)).toBe(true);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Domain=/i);
    expect(pair(setCookie)).not.toBe(first);
    const body = (await response.json()) as { status: string; accessToken: string; expiresInSec: number };
    expect(body.status).toBe('AUTHENTICATED');
    expect(body.expiresInSec).toBe(900);
    const claims = await kit.sessions.verify(body.accessToken);
    expect(claims.sub).toBe('u-1');
    expect(claims.mfaVerifiedAtEpochSec).toBe(1_800_000_000);
  });

  it('le rejeu d’un refresh tourné révoque la famille et répond 401 en effaçant le cookie', async () => {
    const { kit, app } = await build();
    const first = await login(kit);
    const rotated = await app.request(post(REFRESH, first));
    const second = pair(rotated.headers.get('Set-Cookie'));
    const replay = await app.request(post(REFRESH, first));
    expect(replay.status).toBe(401);
    expect(await errorCode(replay)).toBe('REFRESH_TOKEN_REUSED');
    expect(replay.headers.get('Set-Cookie')).toContain('Max-Age=0');
    const successor = await app.request(post(REFRESH, second));
    expect(successor.status).toBe(401);
    expect(await errorCode(successor)).toBe('REFRESH_TOKEN_REVOKED');
  });

  it('401 sans cookie, avec cookie illisible ou expiré', async () => {
    const { kit, app } = await build();
    const missing = await app.request(post(REFRESH, null));
    expect(missing.status).toBe(401);
    expect(await errorCode(missing)).toBe('REFRESH_TOKEN_MISSING');
    const garbage = await app.request(post(REFRESH, `${COOKIE_NAME}=nimportequoi`));
    expect(garbage.status).toBe(401);
    expect(await errorCode(garbage)).toBe('REFRESH_TOKEN_INVALID');
    const cookie = await login(kit);
    kit.advance(31 * 24 * 3600);
    const expired = await app.request(post(REFRESH, cookie));
    expect(expired.status).toBe(401);
    expect(await errorCode(expired)).toBe('REFRESH_TOKEN_EXPIRED');
  });

  it('limitation de débit (429) puis Turnstile (403) avant toute rotation', async () => {
    const limited = await build({ rateOk: false });
    const cookie = await login(limited.kit);
    const rows = JSON.stringify([...limited.kit.refreshRows.values()]);
    const response = await limited.app.request(post(REFRESH, cookie));
    expect(response.status).toBe(429);
    expect(await errorCode(response)).toBe('RATE_LIMITED');
    expect(limited.turnstileCalls).toEqual([]);
    expect(limited.rateKeys[0]).toContain('203.0.113.7');
    expect(JSON.stringify([...limited.kit.refreshRows.values()])).toBe(rows);

    const blocked = await build({ turnstileOk: false });
    const blockedCookie = await login(blocked.kit);
    const denied = await blocked.app.request(post(REFRESH, blockedCookie, 'jeton-xyz'));
    expect(denied.status).toBe(403);
    expect(await errorCode(denied)).toBe('TURNSTILE_REQUIRED');
    expect(blocked.turnstileCalls).toEqual([{ token: 'jeton-xyz', remoteIp: '203.0.113.7' }]);
    expect([...blocked.kit.refreshRows.values()].every((row) => row.rotatedAtEpochSec === null)).toBe(true);
  });

  it('ne répond qu’en POST', async () => {
    const { app } = await build();
    expect((await app.request(`https://fisca.test${REFRESH}`)).status).toBe(404);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('révoque la famille et efface le cookie', async () => {
    const { kit, app } = await build();
    const cookie = await login(kit);
    const response = await app.request(post(LOGOUT, cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const cleared = response.headers.get('Set-Cookie') ?? '';
    expect(cleared.startsWith(`${COOKIE_NAME}=;`)).toBe(true);
    expect(cleared).toContain('Max-Age=0');
    expect([...kit.refreshRows.values()].every((row) => row.revokedAtEpochSec !== null)).toBe(true);
    const afterwards = await app.request(post(REFRESH, cookie));
    expect(afterwards.status).toBe(401);
    expect(await errorCode(afterwards)).toBe('REFRESH_TOKEN_REVOKED');
  });

  it('est idempotent : sans cookie ou avec cookie inconnu, le cookie est quand même effacé', async () => {
    const { app } = await build();
    for (const cookie of [null, `${COOKIE_NAME}=nimportequoi`]) {
      const response = await app.request(post(LOGOUT, cookie));
      expect(response.status).toBe(200);
      expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    }
  });

  it('applique limitation de débit et Turnstile sans révoquer', async () => {
    const limited = await build({ rateOk: false });
    const cookie = await login(limited.kit);
    expect((await limited.app.request(post(LOGOUT, cookie))).status).toBe(429);
    const blocked = await build({ turnstileOk: false });
    const blockedCookie = await login(blocked.kit);
    expect((await blocked.app.request(post(LOGOUT, blockedCookie))).status).toBe(403);
    expect([...blocked.kit.refreshRows.values()].every((row) => row.revokedAtEpochSec === null)).toBe(true);
  });
});
