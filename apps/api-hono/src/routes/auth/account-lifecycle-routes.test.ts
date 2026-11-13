import { describe, expect, it } from 'vitest';
import type {
  AccountLifecycleRouterDeps,
  AccountRegistrationStore,
  OneTimeTokenRecord,
  RegistrationInsertResult,
} from '@fisca/auth-rbac';
import { createAccountLifecycleRoutes, createAuthRoutes } from './index.ts';
import { PASSWORD, PEPPER, buildGoogleKit, buildKit } from './test-kit.ts';

const REGISTER = '/api/v1/auth/register';
const VERIFY = '/api/v1/auth/verify-email';
const FORGOT = '/api/v1/auth/password/forgot';
const NOW = 1_800_000_000;

interface UserRow {
  userId: string;
  emailNormalized: string;
  passwordHash: string;
  emailVerified: boolean;
}

interface SentMail {
  kind: 'verification' | 'reset';
  emailNormalized: string;
  token: string;
}

function build(options: { turnstileOk?: boolean; blockedKeys?: readonly string[]; sendFails?: boolean } = {}) {
  let now = NOW;
  let counter = 0;
  const users = new Map<string, UserRow>();
  const verificationRows = new Map<string, OneTimeTokenRecord>();
  const resetRows = new Map<string, OneTimeTokenRecord>();
  const mails: SentMail[] = [];
  const failures: string[] = [];
  const rateKeys: string[] = [];
  const turnstileCalls: { token: string | null; remoteIp: string | null }[] = [];

  const accounts: AccountRegistrationStore = {
    createUnverifiedAccount: async (input): Promise<RegistrationInsertResult> => {
      for (const row of users.values()) {
        if (row.emailNormalized === input.emailNormalized) {
          return { kind: 'EMAIL_TAKEN', userId: row.userId, emailVerified: row.emailVerified };
        }
      }
      users.set(input.userId, { userId: input.userId, emailNormalized: input.emailNormalized, passwordHash: input.passwordHash, emailVerified: false });
      return { kind: 'CREATED' };
    },
    findByEmailNormalized: async (email) => {
      for (const row of users.values()) {
        if (row.emailNormalized === email) {
          return { userId: row.userId, emailVerified: row.emailVerified };
        }
      }
      return null;
    },
    markEmailVerified: async (userId) => {
      const row = users.get(userId);
      if (row === undefined) {
        return false;
      }
      row.emailVerified = true;
      return true;
    },
  };
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
  const deps: AccountLifecycleRouterDeps = {
    accounts,
    verificationTokens: tokenStore(verificationRows),
    resetTokens: tokenStore(resetRows),
    email: {
      sendLinkProof: async () => undefined,
      sendVerificationEmail: async (message) => {
        if (options.sendFails === true) {
          throw new Error('SES indisponible');
        }
        mails.push({ kind: 'verification', ...message });
      },
      sendPasswordResetEmail: async (message) => {
        if (options.sendFails === true) {
          throw new Error('SES indisponible');
        }
        mails.push({ kind: 'reset', ...message });
      },
    },
    pepper: PEPPER,
    nowEpochSec: () => now,
    newUserId: () => {
      counter += 1;
      return `user-${counter}`;
    },
    reportDeliveryFailure: (kind) => {
      failures.push(kind);
    },
    turnstile: {
      verify: async (input) => {
        turnstileCalls.push(input);
        return options.turnstileOk ?? true;
      },
    },
    rateLimiter: {
      allow: async (key) => {
        rateKeys.push(key);
        return !(options.blockedKeys ?? []).some((blocked) => key.startsWith(blocked));
      },
    },
  };
  return {
    deps,
    app: createAccountLifecycleRoutes(deps),
    users,
    verificationRows,
    resetRows,
    mails,
    failures,
    rateKeys,
    turnstileCalls,
    advance: (seconds: number) => {
      now += seconds;
    },
  };
}

type App = ReturnType<typeof build>['app'];

function post(app: App, path: string, body: unknown, query = '?cf-turnstile-response=ok'): Response | Promise<Response> {
  return app.request(`${path}${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function snapshot(response: Response): Promise<{ status: number; body: string }> {
  return { status: response.status, body: await response.text() };
}

describe('POST /api/v1/auth/register (CTR-API-01)', () => {
  it('crée un compte non vérifié, mot de passe haché PBKDF2, et envoie un jeton de vérification haché au stockage', async () => {
    const { app, users, verificationRows, mails } = build();
    const response = await post(app, REGISTER, { email: ' Nadia@Example.MA ', password: PASSWORD });
    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'VERIFICATION_PENDING' });
    const rows = [...users.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.emailNormalized).toBe('nadia@example.ma');
    expect(rows[0]?.emailVerified).toBe(false);
    expect(rows[0]?.passwordHash).toMatch(/^pbkdf2_sha512\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(rows[0]?.passwordHash).not.toContain(PASSWORD);
    expect(mails).toHaveLength(1);
    const mail = mails[0];
    expect(mail?.kind).toBe('verification');
    expect(mail?.emailNormalized).toBe('nadia@example.ma');
    expect(verificationRows.size).toBe(1);
    const stored = [...verificationRows.values()][0];
    expect(stored?.tokenHash).not.toBe(mail?.token);
    expect(JSON.stringify(stored)).not.toContain(mail?.token ?? '§');
    expect(stored?.expiresAtEpochSec).toBeGreaterThan(NOW);
  });

  it('anti-énumération : réponses identiques, e-mail nouveau, vérifié, ou déjà inscrit non vérifié', async () => {
    const ctx = build();
    const fresh = await snapshot(await post(ctx.app, REGISTER, { email: 'a@example.ma', password: PASSWORD }));
    const pending = await snapshot(await post(ctx.app, REGISTER, { email: 'a@example.ma', password: PASSWORD }));
    const row = [...ctx.users.values()][0];
    if (row === undefined) {
      throw new Error('compte attendu');
    }
    row.emailVerified = true;
    const verified = await snapshot(await post(ctx.app, REGISTER, { email: 'A@example.ma', password: 'un-autre-mot-de-passe-12' }));
    expect(pending).toEqual(fresh);
    expect(verified).toEqual(fresh);
    expect(ctx.users.size).toBe(1);
    expect(row.passwordHash).toContain('pbkdf2_sha512');
  });

  it('e-mail déjà vérifié : aucun mail, aucun jeton, compte inchangé', async () => {
    const ctx = build();
    await post(ctx.app, REGISTER, { email: 'v@example.ma', password: PASSWORD });
    const row = [...ctx.users.values()][0];
    if (row === undefined) {
      throw new Error('compte attendu');
    }
    row.emailVerified = true;
    const hash = row.passwordHash;
    ctx.mails.length = 0;
    ctx.verificationRows.clear();
    await post(ctx.app, REGISTER, { email: 'v@example.ma', password: 'un-autre-mot-de-passe-12' });
    expect(ctx.mails).toHaveLength(0);
    expect(ctx.verificationRows.size).toBe(0);
    expect(row.passwordHash).toBe(hash);
  });

  it('compte non vérifié réinscrit : nouveau jeton, mot de passe d’origine conservé', async () => {
    const ctx = build();
    await post(ctx.app, REGISTER, { email: 'p@example.ma', password: PASSWORD });
    const hash = [...ctx.users.values()][0]?.passwordHash;
    await post(ctx.app, REGISTER, { email: 'p@example.ma', password: 'un-autre-mot-de-passe-12' });
    expect(ctx.mails).toHaveLength(2);
    expect(ctx.mails[0]?.token).not.toBe(ctx.mails[1]?.token);
    expect([...ctx.users.values()][0]?.passwordHash).toBe(hash);
  });

  it('refuse un mot de passe hors politique (12 à 128), un e-mail invalide et un corps invalide en 400 problem+json', async () => {
    const { app, users } = build();
    for (const body of [
      { email: 'a@example.ma', password: 'court' },
      { email: 'a@example.ma', password: 'x'.repeat(129) },
      { email: 'pas-un-email', password: PASSWORD },
      { email: 'a@example.ma' },
      { password: PASSWORD },
      { email: 42, password: PASSWORD },
      [],
    ]) {
      const response = await post(app, REGISTER, body);
      expect(response.status).toBe(400);
      expect(response.headers.get('Content-Type')).toContain('application/problem+json');
    }
    expect((await post(app, REGISTER, '{pas du json')).status).toBe(400);
    expect(users.size).toBe(0);
  });

  it('accepte exactement 12 et 128 caractères', async () => {
    const { app, users } = build();
    expect((await post(app, REGISTER, { email: 'a@example.ma', password: 'a'.repeat(12) })).status).toBe(202);
    expect((await post(app, REGISTER, { email: 'b@example.ma', password: 'b'.repeat(128) })).status).toBe(202);
    expect(users.size).toBe(2);
  });

  it('Turnstile refusé : 403 sans effet ; débit dépassé : 429 sans effet ; ordre débit puis Turnstile', async () => {
    const denied = build({ turnstileOk: false });
    const forbidden = await post(denied.app, REGISTER, { email: 'a@example.ma', password: PASSWORD }, '');
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()) as { errorCode: string }).toMatchObject({ errorCode: 'TURNSTILE_REQUIRED' });
    expect(denied.turnstileCalls).toEqual([{ token: null, remoteIp: '203.0.113.7' }]);
    expect(denied.users.size).toBe(0);

    const limited = build({ blockedKeys: ['auth:register:'] });
    const tooMany = await post(limited.app, REGISTER, { email: 'a@example.ma', password: PASSWORD });
    expect(tooMany.status).toBe(429);
    expect(limited.turnstileCalls).toHaveLength(0);
    expect(limited.users.size).toBe(0);
    expect(limited.rateKeys).toEqual(['auth:register:203.0.113.7']);
  });

  it('transmet le jeton cf-turnstile-response au vérificateur', async () => {
    const ctx = build();
    await post(ctx.app, REGISTER, { email: 'a@example.ma', password: PASSWORD }, '?cf-turnstile-response=jeton-42');
    expect(ctx.turnstileCalls).toEqual([{ token: 'jeton-42', remoteIp: '203.0.113.7' }]);
  });

  it('échec d’envoi : réponse inchangée 202, échec signalé au port, aucune fuite', async () => {
    const ctx = build({ sendFails: true });
    const response = await post(ctx.app, REGISTER, { email: 'a@example.ma', password: PASSWORD });
    expect(response.status).toBe(202);
    expect(ctx.failures).toEqual(['verification']);
  });

  it('erreur de stockage inattendue : 500 problem+json sans détail interne', async () => {
    const ctx = build();
    const broken = createAccountLifecycleRoutes({
      ...ctx.deps,
      accounts: { ...ctx.deps.accounts, createUnverifiedAccount: async () => Promise.reject(new Error('D1 down: secret-interne')) },
    });
    const response = await post(broken, REGISTER, { email: 'a@example.ma', password: PASSWORD });
    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toContain('application/problem+json');
    expect(await response.text()).not.toContain('secret-interne');
  });
});

async function registerAndGetToken(ctx: ReturnType<typeof build>, email = 'v@example.ma'): Promise<string> {
  await post(ctx.app, REGISTER, { email, password: PASSWORD });
  const token = ctx.mails.at(-1)?.token;
  if (token === undefined) {
    throw new Error('jeton attendu');
  }
  return token;
}

describe('POST /api/v1/auth/verify-email (CTR-API-02)', () => {
  it('consomme le jeton : e-mail vérifié, 200', async () => {
    const ctx = build();
    const token = await registerAndGetToken(ctx);
    const response = await post(ctx.app, VERIFY, { token });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'EMAIL_VERIFIED' });
    expect([...ctx.users.values()][0]?.emailVerified).toBe(true);
    expect(ctx.verificationRows.size).toBe(0);
  });

  it('usage unique : le rejeu est refusé', async () => {
    const ctx = build();
    const token = await registerAndGetToken(ctx);
    expect((await post(ctx.app, VERIFY, { token })).status).toBe(200);
    const replay = await post(ctx.app, VERIFY, { token });
    expect(replay.status).toBe(400);
    expect((await replay.json()) as { errorCode: string }).toMatchObject({ errorCode: 'VERIFICATION_TOKEN_INVALID' });
  });

  it('jeton expiré : refusé au TTL exact, accepté une seconde avant ; le jeton expiré est consommé', async () => {
    const early = build();
    const tokenEarly = await registerAndGetToken(early);
    const ttl = [...early.verificationRows.values()][0]?.expiresAtEpochSec;
    if (ttl === undefined) {
      throw new Error('échéance attendue');
    }
    early.advance(ttl - NOW - 1);
    expect((await post(early.app, VERIFY, { token: tokenEarly })).status).toBe(200);

    const exact = build();
    const tokenExact = await registerAndGetToken(exact);
    exact.advance(ttl - NOW);
    const expired = await post(exact.app, VERIFY, { token: tokenExact });
    expect(expired.status).toBe(400);
    expect((await expired.json()) as { errorCode: string }).toMatchObject({ errorCode: 'VERIFICATION_TOKEN_EXPIRED' });
    expect([...exact.users.values()][0]?.emailVerified).toBe(false);
    expect(exact.verificationRows.size).toBe(0);
  });

  it('jeton falsifié, tronqué, vide ou d’un autre type refusé', async () => {
    const ctx = build();
    const token = await registerAndGetToken(ctx);
    for (const bad of [`${token}x`, token.slice(1), 'n-importe-quoi', '', 'A'.repeat(43)]) {
      expect((await post(ctx.app, VERIFY, { token: bad })).status).toBe(400);
    }
    expect([...ctx.users.values()][0]?.emailVerified).toBe(false);
    expect(ctx.verificationRows.size).toBe(1);
  });

  it('un jeton de réinitialisation ne vérifie pas un e-mail (séparation des usages)', async () => {
    const ctx = build();
    const token = await registerAndGetToken(ctx);
    await post(ctx.app, FORGOT, { email: 'v@example.ma' });
    const resetToken = ctx.mails.at(-1)?.token ?? '';
    expect(ctx.mails.at(-1)?.kind).toBe('reset');
    expect(resetToken).not.toBe(token);
    expect((await post(ctx.app, VERIFY, { token: resetToken })).status).toBe(400);
    expect([...ctx.users.values()][0]?.emailVerified).toBe(false);
  });

  it('corps invalide : 400 ; Turnstile : 403 ; débit : 429, sans consommer le jeton', async () => {
    const ctx = build();
    const token = await registerAndGetToken(ctx);
    expect((await post(ctx.app, VERIFY, {})).status).toBe(400);
    expect((await post(ctx.app, VERIFY, { token: 7 })).status).toBe(400);
    expect((await post(ctx.app, VERIFY, 'xx')).status).toBe(400);
    expect(ctx.verificationRows.size).toBe(1);

    const denied = build({ turnstileOk: false });
    expect((await post(denied.app, VERIFY, { token })).status).toBe(403);
    const limited = build({ blockedKeys: ['auth:verify-email:'] });
    expect((await post(limited.app, VERIFY, { token })).status).toBe(429);
  });

  it('compte disparu entre-temps : jeton refusé', async () => {
    const ctx = build();
    const token = await registerAndGetToken(ctx);
    ctx.users.clear();
    expect((await post(ctx.app, VERIFY, { token })).status).toBe(400);
  });
});

describe('POST /api/v1/auth/password/forgot (CTR-API-06)', () => {
  it('répond toujours 202 identique : compte existant, inconnu, e-mail mal formé', async () => {
    const ctx = build();
    await registerAndGetToken(ctx);
    const known = await snapshot(await post(ctx.app, FORGOT, { email: 'v@example.ma' }));
    const unknown = await snapshot(await post(ctx.app, FORGOT, { email: 'inconnu@example.ma' }));
    const malformed = await snapshot(await post(ctx.app, FORGOT, { email: 'pas-un-email' }));
    expect(known.status).toBe(202);
    expect(JSON.parse(known.body)).toEqual({ status: 'RESET_REQUESTED' });
    expect(unknown).toEqual(known);
    expect(malformed).toEqual(known);
  });

  it('émet un jeton de réinitialisation à usage unique, haché au stockage, valable 15 minutes (Doc_07 § 02)', async () => {
    const ctx = build();
    await registerAndGetToken(ctx);
    await post(ctx.app, FORGOT, { email: 'V@Example.ma' });
    const mail = ctx.mails.at(-1);
    expect(mail?.kind).toBe('reset');
    expect(mail?.emailNormalized).toBe('v@example.ma');
    const stored = [...ctx.resetRows.values()][0];
    expect(stored?.expiresAtEpochSec).toBe(NOW + 900);
    expect(stored?.tokenHash).not.toBe(mail?.token);
    expect(JSON.stringify(stored)).not.toContain(mail?.token ?? '§');
  });

  it('compte inconnu : aucun jeton, aucun mail', async () => {
    const ctx = build();
    await post(ctx.app, FORGOT, { email: 'inconnu@example.ma' });
    expect(ctx.mails).toHaveLength(0);
    expect(ctx.resetRows.size).toBe(0);
  });

  it('une nouvelle demande remplace le jeton précédent (un seul jeton actif)', async () => {
    const ctx = build();
    await registerAndGetToken(ctx);
    await post(ctx.app, FORGOT, { email: 'v@example.ma' });
    await post(ctx.app, FORGOT, { email: 'v@example.ma' });
    expect(ctx.resetRows.size).toBe(1);
  });

  it('limite par adresse : au-delà, 202 identique mais aucun mail (pas de bombardement)', async () => {
    const ctx = build({ blockedKeys: ['auth:password-forgot-email:'] });
    await registerAndGetToken(ctx);
    const before = ctx.mails.length;
    const response = await post(ctx.app, FORGOT, { email: 'v@example.ma' });
    expect(response.status).toBe(202);
    expect(ctx.mails).toHaveLength(before);
    expect(ctx.rateKeys.some((key) => key.startsWith('auth:password-forgot-email:') && !key.includes('@'))).toBe(true);
  });

  it('échec d’envoi : 202 inchangé et échec signalé', async () => {
    const ctx = build();
    await registerAndGetToken(ctx);
    const failing = createAccountLifecycleRoutes({
      ...ctx.deps,
      email: {
        ...ctx.deps.email,
        sendPasswordResetEmail: async () => Promise.reject(new Error('SES indisponible')),
      },
    });
    const response = await post(failing, FORGOT, { email: 'v@example.ma' });
    expect(response.status).toBe(202);
    expect(ctx.failures).toEqual(['reset']);
  });

  it('corps absent ou illisible : 400 ; Turnstile : 403 ; débit : 429, sans effet', async () => {
    const ctx = build();
    expect((await post(ctx.app, FORGOT, {})).status).toBe(400);
    expect((await post(ctx.app, FORGOT, 'xx')).status).toBe(400);
    expect((await post(ctx.app, FORGOT, { email: 3 })).status).toBe(400);
    const denied = build({ turnstileOk: false });
    expect((await post(denied.app, FORGOT, { email: 'v@example.ma' })).status).toBe(403);
    const limited = build({ blockedKeys: ['auth:password-forgot:'] });
    const response = await post(limited.app, FORGOT, { email: 'v@example.ma' });
    expect(response.status).toBe(429);
    expect(limited.resetRows.size).toBe(0);
    expect(limited.rateKeys).toEqual(['auth:password-forgot:203.0.113.7']);
  });

  it('ne crée aucune route de consommation du jeton ni autre route hors registre', async () => {
    const { app } = build();
    for (const path of ['/api/v1/auth/password/reset', '/api/v1/auth/password/forgot/confirm', '/api/v1/auth/resend-verification']) {
      expect((await post(app, path, {})).status).toBe(404);
    }
    expect((await app.request(REGISTER, { method: 'GET' })).status).toBe(404);
  });
});

describe('colle : montage par createAuthRoutes', () => {
  it('monte les trois routes à côté des existantes sans les casser, et seulement si fournies', async () => {
    const kit = await buildKit();
    const google = await buildGoogleKit();
    const ok = { verify: async () => true };
    const open = { allow: async () => true };
    const lifecycle = build().deps;
    const mfa = { ...kit.mfa, authenticator: { authenticate: async () => null }, turnstile: ok, rateLimiter: open };
    const login = { accounts: kit.accounts, pepper: PEPPER, flow: kit.flow, turnstile: ok, rateLimiter: open };
    const without = createAuthRoutes({ oauth: google.oauth, turnstile: ok, rateLimiter: open }, mfa, login);
    const withLifecycle = createAuthRoutes({ oauth: google.oauth, turnstile: ok, rateLimiter: open }, mfa, login, undefined, lifecycle);
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
    for (const path of [REGISTER, VERIFY, FORGOT]) {
      expect((await without.request(`${path}?cf-turnstile-response=t`, init)).status).toBe(404);
      expect((await withLifecycle.request(`${path}?cf-turnstile-response=t`, init)).status).toBe(400);
    }
    await kit.addPasswordUser('u-colle', 'colle@example.ma');
    const loginResponse = await withLifecycle.request('/api/v1/auth/login?cf-turnstile-response=t', {
      ...init,
      body: JSON.stringify({ email: 'colle@example.ma', password: PASSWORD }),
    });
    expect(loginResponse.status).toBe(200);
  });
});
