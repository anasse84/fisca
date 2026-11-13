import { describe, expect, it } from 'vitest';
import type { AccountLifecycleRouterDeps, OneTimeTokenRecord, PasswordResetRouterDeps } from '@fisca/auth-rbac';
import { createAccountLifecycleRoutes, createAuthRoutes, createPasswordResetRoutes } from './index.ts';
import { LOW_COST_HASH_FORMAT, LOW_COST_PASSWORD_SERVICE, PASSWORD, PEPPER, buildGoogleKit, buildKit } from './test-kit.ts';

const FORGOT = '/api/v1/auth/password/forgot';
const REGISTER = '/api/v1/auth/register';
const RESET = '/api/v1/auth/password/reset';
const NEW_PASSWORD = 'nouveau-mot-de-passe-factice-34';

async function build(options: { turnstileOk?: boolean; rateOk?: boolean; credentialsOk?: boolean } = {}) {
  const kit = await buildKit();
  const hashes = new Map<string, string>();
  const verificationRows = new Map<string, OneTimeTokenRecord>();
  const resetRows = new Map<string, OneTimeTokenRecord>();
  const mails: { kind: 'verification' | 'reset'; token: string }[] = [];
  const rateKeys: string[] = [];
  const turnstileCalls: { token: string | null; remoteIp: string | null }[] = [];
  const users = [
    { userId: 'u-1', email: 'nadia@example.ma' },
    { userId: 'u-2', email: 'omar@example.ma' },
  ];
  const tokenStore = (rows: Map<string, OneTimeTokenRecord>) => ({
    save: async (record: OneTimeTokenRecord) => {
      for (const [hash, row] of rows) {
        if (row.userId === record.userId) {
          rows.delete(hash);
        }
      }
      rows.set(record.tokenHash, record);
    },
    consume: async (tokenHash: string) => {
      const row = rows.get(tokenHash) ?? null;
      rows.delete(tokenHash);
      return row;
    },
  });
  const guard = {
    turnstile: {
      verify: async (input: { token: string | null; remoteIp: string | null }) => {
        turnstileCalls.push(input);
        return options.turnstileOk ?? true;
      },
    },
    rateLimiter: {
      allow: async (key: string) => {
        rateKeys.push(key);
        return options.rateOk ?? true;
      },
    },
  };
  const lifecycle: AccountLifecycleRouterDeps = {
    accounts: {
      createUnverifiedAccount: async () => ({ kind: 'CREATED' }),
      findByEmailNormalized: async (email) => {
        const user = users.find((entry) => entry.email === email);
        return user === undefined ? null : { userId: user.userId, emailVerified: true };
      },
      markEmailVerified: async () => true,
    },
    verificationTokens: tokenStore(verificationRows),
    resetTokens: tokenStore(resetRows),
    email: {
      sendLinkProof: async () => undefined,
      sendVerificationEmail: async (message) => {
        mails.push({ kind: 'verification', token: message.token });
      },
      sendPasswordResetEmail: async (message) => {
        mails.push({ kind: 'reset', token: message.token });
      },
    },
    pepper: PEPPER, passwordService: LOW_COST_PASSWORD_SERVICE,
    nowEpochSec: () => kit.now(),
    turnstile: { verify: async () => true },
    rateLimiter: { allow: async () => true },
  };
  const reset: PasswordResetRouterDeps = {
    resetTokens: lifecycle.resetTokens,
    credentials: {
      setPasswordHash: async (userId, passwordHash) => {
        if (options.credentialsOk === false) {
          return false;
        }
        hashes.set(userId, passwordHash);
        return true;
      },
    },
    refreshFamilies: {
      listFamilyIds: async (userId) => [...new Set([...kit.refreshRows.values()].filter((row) => row.userId === userId).map((row) => row.familyId))],
    },
    refreshStore: kit.refreshStore,
    pepper: PEPPER, passwordService: LOW_COST_PASSWORD_SERVICE,
    nowEpochSec: () => kit.now(),
    ...guard,
  };
  return {
    kit,
    reset,
    lifecycle,
    app: createPasswordResetRoutes(reset),
    forgotApp: createAccountLifecycleRoutes(lifecycle),
    hashes,
    mails,
    rateKeys,
    turnstileCalls,
  };
}

type Ctx = Awaited<ReturnType<typeof build>>;

function post(app: { request: (input: string, init: RequestInit) => Response | Promise<Response> }, path: string, body: unknown, query = '?cf-turnstile-response=ok') {
  return app.request(`${path}${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function issueResetToken(ctx: Ctx, email = 'nadia@example.ma'): Promise<string> {
  ctx.mails.length = 0;
  const response = await post(ctx.forgotApp, FORGOT, { email });
  expect(response.status).toBe(202);
  const mail = ctx.mails.find((entry) => entry.kind === 'reset');
  if (mail === undefined) {
    throw new Error('jeton de réinitialisation attendu');
  }
  return mail.token;
}

async function problem(response: Response): Promise<{ status: number; errorCode: string; title: string; detail: string }> {
  expect(response.headers.get('Content-Type')).toContain('application/problem+json');
  const body = (await response.json()) as { status: number; errorCode: string; title: string; detail: string };
  return { status: body.status, errorCode: body.errorCode, title: body.title, detail: body.detail };
}

describe('POST /api/v1/auth/password/reset (CTR-API-41)', () => {
  it('consomme le jeton, enregistre un hash PBKDF2 du nouveau mot de passe, ne crée aucune session', async () => {
    const ctx = await build();
    const token = await issueResetToken(ctx);
    const response = await post(ctx.app, RESET, { token, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: 'PASSWORD_RESET' });
    const stored = ctx.hashes.get('u-1');
    expect(stored).toMatch(LOW_COST_HASH_FORMAT);
    expect(stored).not.toContain(NEW_PASSWORD);
    expect(await LOW_COST_PASSWORD_SERVICE.verify(NEW_PASSWORD, PEPPER, stored ?? '')).toBe(true);
    expect(await LOW_COST_PASSWORD_SERVICE.verify(PASSWORD, PEPPER, stored ?? '')).toBe(false);
    expect(ctx.kit.issuedSessions).toEqual([]);
    expect(ctx.kit.refreshRows.size).toBe(0);
  });

  it('révoque toutes les familles de refresh de l’utilisateur, et seulement les siennes', async () => {
    const ctx = await build();
    const first = await ctx.kit.sessions.issuePasskeySession({ userId: 'u-1' });
    const second = await ctx.kit.sessions.issueFirstFactorSession({ userId: 'u-1', firstFactor: 'PASSWORD' });
    const other = await ctx.kit.sessions.issuePasskeySession({ userId: 'u-2' });
    expect(first.setCookie).not.toBeNull();
    expect(second.setCookie).not.toBeNull();
    expect(other.setCookie).not.toBeNull();
    const before = ctx.kit.issuedSessions.length;
    const token = await issueResetToken(ctx);
    const response = await post(ctx.app, RESET, { token, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(200);
    const rows = [...ctx.kit.refreshRows.values()];
    const mine = rows.filter((row) => row.userId === 'u-1');
    expect(new Set(mine.map((row) => row.familyId)).size).toBe(2);
    expect(mine.every((row) => row.revokedAtEpochSec === ctx.kit.now())).toBe(true);
    expect(rows.filter((row) => row.userId === 'u-2').every((row) => row.revokedAtEpochSec === null)).toBe(true);
    expect(ctx.kit.issuedSessions.length).toBe(before);
    const refreshed = await ctx.kit.sessions.refresh({ cookie: first.setCookie }).catch((error: unknown) => error);
    expect(refreshed).toMatchObject({ code: 'REFRESH_TOKEN_REVOKED' });
  });

  it('refuse le jeton rejoué, expiré, falsifié, inconnu ou d’un autre usage avec une réponse identique', async () => {
    const ctx = await build();
    const seen: { status: number; errorCode: string; title: string; detail: string }[] = [];

    const replayed = await issueResetToken(ctx);
    expect((await post(ctx.app, RESET, { token: replayed, newPassword: NEW_PASSWORD })).status).toBe(200);
    seen.push(await problem(await post(ctx.app, RESET, { token: replayed, newPassword: NEW_PASSWORD })));

    const expired = await issueResetToken(ctx);
    ctx.kit.advance(901);
    seen.push(await problem(await post(ctx.app, RESET, { token: expired, newPassword: NEW_PASSWORD })));

    const forged = await issueResetToken(ctx);
    seen.push(await problem(await post(ctx.app, RESET, { token: `${forged.slice(0, -2)}AA`, newPassword: NEW_PASSWORD })));
    seen.push(await problem(await post(ctx.app, RESET, { token: 'x'.repeat(300), newPassword: NEW_PASSWORD })));
    seen.push(await problem(await post(ctx.app, RESET, { token: '', newPassword: NEW_PASSWORD })));

    expect(seen).toHaveLength(5);
    for (const entry of seen) {
      expect(entry).toEqual(seen[0]);
    }
    expect(seen[0]?.status).toBe(400);
    expect(seen[0]?.errorCode).toBe('PASSWORD_RESET_TOKEN_INVALID');
    expect(ctx.hashes.size).toBe(1);
  });

  it('un jeton de vérification d’e-mail, même présent dans la table des jetons de réinitialisation, ne réinitialise rien', async () => {
    const ctx = await build();
    const registerApp = createAccountLifecycleRoutes({
      ...ctx.lifecycle,
      // Les deux usages partagent ici la même table : seul le préfixe d'usage du hachage les sépare.
      verificationTokens: ctx.lifecycle.resetTokens,
      newUserId: () => 'u-1',
    });
    await post(registerApp, REGISTER, { email: 'nadia@example.ma', password: PASSWORD, full_name: 'Nadia El Idrissi' });
    const mail = ctx.mails.find((entry) => entry.kind === 'verification');
    expect(mail).toBeDefined();
    const response = await post(ctx.app, RESET, { token: mail?.token, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(400);
    expect(await problem(response)).toEqual(await problem(await post(ctx.app, RESET, { token: 'inconnu', newPassword: NEW_PASSWORD })));
    expect(ctx.hashes.size).toBe(0);
  });

  it('applique la politique : mot de passe hors 12 à 128 refusé sans brûler le jeton ni révoquer', async () => {
    const ctx = await build();
    await ctx.kit.sessions.issuePasskeySession({ userId: 'u-1' });
    const token = await issueResetToken(ctx);
    for (const newPassword of ['court', 'x'.repeat(129), '']) {
      const response = await post(ctx.app, RESET, { token, newPassword });
      expect(response.status).toBe(400);
      expect((await problem(response)).errorCode).toBe('PASSWORD_RESET_INPUT_INVALID');
    }
    expect(ctx.hashes.size).toBe(0);
    expect([...ctx.kit.refreshRows.values()].every((row) => row.revokedAtEpochSec === null)).toBe(true);
    expect((await post(ctx.app, RESET, { token, newPassword: 'a'.repeat(12) })).status).toBe(200);
    expect(ctx.hashes.size).toBe(1);
  });

  it('compte disparu au moment de l’écriture : même réponse que pour un jeton invalide', async () => {
    const ctx = await build({ credentialsOk: false });
    const token = await issueResetToken(ctx);
    const response = await post(ctx.app, RESET, { token, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(400);
    expect((await problem(response)).errorCode).toBe('PASSWORD_RESET_TOKEN_INVALID');
  });

  it('corps invalide : 400 REQUEST_INVALID', async () => {
    const ctx = await build();
    for (const body of [{}, { token: 'a' }, { newPassword: NEW_PASSWORD }, { token: 1, newPassword: NEW_PASSWORD }, [], '{pas du json']) {
      const response = await post(ctx.app, RESET, body);
      expect(response.status).toBe(400);
      expect((await problem(response)).errorCode).toBe('REQUEST_INVALID');
    }
  });

  it('limitation de débit (429) puis Turnstile (403) avant de toucher au jeton', async () => {
    const limited = await build({ rateOk: false });
    const token = await issueResetToken(limited);
    const tooMany = await post(limited.app, RESET, { token, newPassword: NEW_PASSWORD });
    expect(tooMany.status).toBe(429);
    expect(limited.turnstileCalls).toEqual([]);
    expect(limited.rateKeys).toEqual(['auth:password-reset:203.0.113.7']);

    const blocked = await build({ turnstileOk: false });
    const blockedToken = await issueResetToken(blocked);
    blocked.turnstileCalls.length = 0;
    const denied = await post(blocked.app, RESET, { token: blockedToken, newPassword: NEW_PASSWORD }, '?cf-turnstile-response=jeton-xyz');
    expect(denied.status).toBe(403);
    expect((await problem(denied)).errorCode).toBe('TURNSTILE_REQUIRED');
    expect(blocked.turnstileCalls).toEqual([{ token: 'jeton-xyz', remoteIp: '203.0.113.7' }]);
    expect(blocked.hashes.size).toBe(0);
  });

  it('une erreur interne répond 500 problem+json sans détail', async () => {
    const ctx = await build();
    const token = await issueResetToken(ctx);
    const broken = createPasswordResetRoutes({
      ...ctx.reset,
      credentials: {
        setPasswordHash: async () => {
          throw new Error('D1 indisponible');
        },
      },
    });
    const response = await post(broken, RESET, { token, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await problem(response))).not.toContain('D1');
  });

  it('createAuthRoutes monte la route sans casser les autres', async () => {
    const ctx = await build();
    const google = await buildGoogleKit();
    const open = { verify: async () => true };
    const rate = { allow: async () => true };
    const app = createAuthRoutes(
      { oauth: google.oauth, turnstile: open, rateLimiter: rate, login: ctx.kit.flow },
      { ...ctx.kit.mfa, authenticator: { authenticate: async () => null }, turnstile: open, rateLimiter: rate },
      undefined,
      undefined,
      ctx.lifecycle,
      { passwordReset: ctx.reset },
    );
    const token = await issueResetToken(ctx);
    expect((await post(app, RESET, { token, newPassword: NEW_PASSWORD })).status).toBe(200);
    expect((await post(app, FORGOT, { email: 'nadia@example.ma' })).status).toBe(202);
    const unmounted = createAuthRoutes(
      { oauth: google.oauth, turnstile: open, rateLimiter: rate },
      { ...ctx.kit.mfa, authenticator: { authenticate: async () => null }, turnstile: open, rateLimiter: rate },
    );
    expect((await post(unmounted, RESET, { token, newPassword: NEW_PASSWORD })).status).toBe(404);
  });
});
