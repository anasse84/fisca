import { describe, expect, it } from 'vitest';
import { PENDING_LINK_MAX_ATTEMPTS, base64UrlEncode, hashPasswordWorkerSafe } from '@fisca/auth-rbac';
import type { FirstFactorDeps, GoogleLinkRouterDeps, LinkOAuthAccountInput, PendingLink } from '@fisca/auth-rbac';
import { createAuthRoutes, createGoogleLinkRoutes } from './index.ts';
import { NOW, PASSWORD, PEPPER, buildGoogleKit, buildKit } from './test-kit.ts';

const CONFIRM = '/api/v1/auth/google/link/confirm';
const EMAIL_TOKEN = 'jeton-de-lien-email-factice';
const encoder = new TextEncoder();

async function build(options: { turnstileOk?: boolean; rateOk?: boolean; policy?: boolean; linkedSub?: string } = {}) {
  const kit = await buildKit();
  const passwordHash = await hashPasswordWorkerSafe(PASSWORD, PEPPER);
  const pending = new Map<string, PendingLink>();
  const linked: LinkOAuthAccountInput[] = [];
  const rateKeys: string[] = [];
  const turnstileCalls: { token: string | null; remoteIp: string | null }[] = [];
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(EMAIL_TOKEN));
  const base: PendingLink = {
    id: 'pl-1',
    userId: 'u-1',
    provider: 'GOOGLE',
    subject: 'sub-google-1',
    providerEmail: 'nadia@example.ma',
    hasPassword: true,
    emailProofTokenSha256: base64UrlEncode(new Uint8Array(digest)),
    attemptsLeft: PENDING_LINK_MAX_ATTEMPTS,
    expiresAtEpochSec: NOW + 900,
  };
  pending.set(base.id, base);
  const login: FirstFactorDeps =
    options.policy === true ? { ...kit.flow, policy: { isSecondFactorRequired: async () => true } } : kit.flow;
  const deps: GoogleLinkRouterDeps = {
    accounts: {
      findOAuthAccount: async (_provider, subject) => (subject === options.linkedSub ? { userId: 'u-other' } : null),
      findUserByEmailNormalized: async (email) => (email === 'nadia@example.ma' ? { userId: 'u-1', passwordHash } : null),
      createUserWithOAuthAccount: async () => {
        throw new Error('création interdite dans la confirmation de liaison');
      },
      linkOAuthAccount: async (input) => {
        linked.push(input);
      },
    },
    pendingLinks: {
      save: async (link) => {
        pending.set(link.id, link);
      },
      take: async (id) => {
        const link = pending.get(id) ?? null;
        pending.delete(id);
        return link;
      },
    },
    pepper: PEPPER,
    nowEpochSec: () => kit.now(),
    login,
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
  return { kit, deps, app: createGoogleLinkRoutes(deps), pending, linked, rateKeys, turnstileCalls };
}

function post(app: { request: (input: string, init: RequestInit) => Response | Promise<Response> }, body: unknown, query = '?cf-turnstile-response=ok') {
  return app.request(`${CONFIRM}${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const passwordProof = { pendingLinkId: 'pl-1', proof: { method: 'PASSWORD', password: PASSWORD } };
const emailProof = { pendingLinkId: 'pl-1', proof: { method: 'EMAIL_LINK', token: EMAIL_TOKEN } };

async function errorCode(response: Response): Promise<string> {
  expect(response.headers.get('Content-Type')).toContain('application/problem+json');
  return ((await response.json()) as { errorCode: string }).errorCode;
}

describe('POST /api/v1/auth/google/link/confirm (CTR-API-42)', () => {
  it('compte sans second facteur : lie l’identité et ouvre la session par completeFirstFactor', async () => {
    const ctx = await build();
    const response = await post(ctx.app, passwordProof);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as { status: string; userId: string; accessToken: string };
    expect(body.status).toBe('AUTHENTICATED');
    expect(body.userId).toBe('u-1');
    const claims = await ctx.kit.sessions.verify(body.accessToken);
    expect(claims.sub).toBe('u-1');
    expect(claims.amr).toEqual(['google']);
    expect(response.headers.get('Set-Cookie')).toContain('__Host-fisca_refresh=');
    expect(ctx.linked).toEqual([{ userId: 'u-1', provider: 'GOOGLE', subject: 'sub-google-1', providerEmail: 'nadia@example.ma' }]);
    expect(ctx.kit.issuedSessions).toEqual(['first:u-1']);
  });

  it('2FA active : aucune session, aucun cookie, seulement un mfa_challenge_token (preuve par mot de passe ou lien e-mail)', async () => {
    for (const proof of [passwordProof, emailProof]) {
      const ctx = await build();
      await ctx.kit.enrollTotp('u-1');
      const response = await post(ctx.app, proof);
      expect(response.status).toBe(200);
      expect(response.headers.get('Set-Cookie')).toBeNull();
      const body = (await response.json()) as Record<string, unknown>;
      expect(body['status']).toBe('MFA_REQUIRED');
      expect(typeof body['mfa_challenge_token']).toBe('string');
      expect(body['accessToken']).toBeUndefined();
      expect(ctx.kit.issuedSessions).toEqual([]);
      expect(ctx.kit.refreshRows.size).toBe(0);
      expect(ctx.linked).toHaveLength(1);
    }
  });

  it('second facteur imposé par la politique mais non inscrit : 409, aucune session', async () => {
    const ctx = await build({ policy: true });
    const response = await post(ctx.app, passwordProof);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(ctx.kit.issuedSessions).toEqual([]);
  });

  it('preuve invalide : 403, aucune liaison ni session, tentative décomptée', async () => {
    const ctx = await build();
    const response = await post(ctx.app, { pendingLinkId: 'pl-1', proof: { method: 'PASSWORD', password: 'mauvais-mot-de-passe-12' } });
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe('LINK_PROOF_INVALID');
    expect(ctx.linked).toEqual([]);
    expect(ctx.kit.issuedSessions).toEqual([]);
    expect(ctx.pending.get('pl-1')?.attemptsLeft).toBe(PENDING_LINK_MAX_ATTEMPTS - 1);
    const badEmail = await post(ctx.app, { pendingLinkId: 'pl-1', proof: { method: 'EMAIL_LINK', token: 'autre' } });
    expect(badEmail.status).toBe(403);
    expect(ctx.linked).toEqual([]);
  });

  it('liaison rejouée, inconnue ou expirée : 400 ; sub déjà lié : 403', async () => {
    const ctx = await build();
    expect((await post(ctx.app, passwordProof)).status).toBe(200);
    const replay = await post(ctx.app, passwordProof);
    expect(replay.status).toBe(400);
    expect(await errorCode(replay)).toBe('LINK_PENDING_NOT_FOUND');

    const expired = await build();
    expired.kit.advance(901);
    const late = await post(expired.app, passwordProof);
    expect(late.status).toBe(400);
    expect(await errorCode(late)).toBe('LINK_PENDING_EXPIRED');
    expect(expired.kit.issuedSessions).toEqual([]);

    const taken = await build({ linkedSub: 'sub-google-1' });
    const conflict = await post(taken.app, passwordProof);
    expect(conflict.status).toBe(403);
    expect(await errorCode(conflict)).toBe('SUB_ALREADY_LINKED');
    expect(taken.kit.issuedSessions).toEqual([]);
  });

  it('corps invalide : 400 REQUEST_INVALID sans consommer la liaison', async () => {
    const ctx = await build();
    for (const body of [
      {},
      { pendingLinkId: 'pl-1' },
      { pendingLinkId: 'pl-1', proof: {} },
      { pendingLinkId: 'pl-1', proof: { method: 'PASSWORD' } },
      { pendingLinkId: 'pl-1', proof: { method: 'EMAIL_LINK', token: 5 } },
      { pendingLinkId: 'pl-1', proof: { method: 'SMS', code: '123456' } },
      { pendingLinkId: 7, proof: { method: 'PASSWORD', password: PASSWORD } },
      [],
      '{pas du json',
    ]) {
      const response = await post(ctx.app, body);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe('REQUEST_INVALID');
    }
    expect(ctx.pending.has('pl-1')).toBe(true);
  });

  it('limitation de débit (429) puis Turnstile (403) avant de consommer la liaison', async () => {
    const limited = await build({ rateOk: false });
    expect((await post(limited.app, passwordProof)).status).toBe(429);
    expect(limited.turnstileCalls).toEqual([]);
    expect(limited.rateKeys).toEqual(['auth:google-link-confirm:203.0.113.7']);
    expect(limited.pending.has('pl-1')).toBe(true);

    const blocked = await build({ turnstileOk: false });
    const denied = await post(blocked.app, passwordProof, '?cf-turnstile-response=jeton-xyz');
    expect(denied.status).toBe(403);
    expect(await errorCode(denied)).toBe('TURNSTILE_REQUIRED');
    expect(blocked.turnstileCalls).toEqual([{ token: 'jeton-xyz', remoteIp: '203.0.113.7' }]);
    expect(blocked.pending.has('pl-1')).toBe(true);
    expect(blocked.linked).toEqual([]);
  });

  it('une erreur interne répond 500 problem+json sans détail', async () => {
    const ctx = await build();
    const broken = createGoogleLinkRoutes({
      ...ctx.deps,
      accounts: {
        ...ctx.deps.accounts,
        linkOAuthAccount: async () => {
          throw new Error('D1 indisponible');
        },
      },
    });
    const response = await post(broken, passwordProof);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('D1');
  });

  it('createAuthRoutes monte la route, absente sans le sixième argument', async () => {
    const ctx = await build();
    const google = await buildGoogleKit();
    const open = { verify: async () => true };
    const rate = { allow: async () => true };
    const mfa = { ...ctx.kit.mfa, authenticator: { authenticate: async () => null }, turnstile: open, rateLimiter: rate };
    const mounted = createAuthRoutes({ oauth: google.oauth, turnstile: open, rateLimiter: rate, login: ctx.kit.flow }, mfa, undefined, undefined, undefined, {
      googleLink: ctx.deps,
    });
    expect((await post(mounted, passwordProof)).status).toBe(200);
    const bare = createAuthRoutes({ oauth: google.oauth, turnstile: open, rateLimiter: rate }, mfa);
    expect((await post(bare, passwordProof)).status).toBe(404);
  });
});
