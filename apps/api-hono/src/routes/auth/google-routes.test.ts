import { describe, expect, it } from 'vitest';
import { base64UrlEncode, createJwksProvider } from '@fisca/auth-rbac';
import type {
  GoogleOAuthRouterDeps,
  OAuthAccountRepository,
  OAuthTransaction,
  PendingLink,
  RateLimiter,
  TurnstileVerifier,
} from '@fisca/auth-rbac';
import { createAuthRoutes } from './index.ts';

// Valeurs factices de test uniquement.
const CLIENT_ID = 'client-id-factice.apps.googleusercontent.com';
const NOW = 1_800_000_000;
const KID = 'kid-routes-1';
const START = '/api/v1/auth/google/start';
const CALLBACK = '/api/v1/auth/google/callback';
const encoder = new TextEncoder();

async function buildHarness(options: { claims?: Record<string, unknown>; turnstileOk?: boolean; rateOk?: boolean } = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const transactions = new Map<string, OAuthTransaction>();
  const pending = new Map<string, PendingLink>();
  const existingEmails = new Map<string, string | null>();
  const turnstileCalls: { token: string | null; remoteIp: string | null }[] = [];
  const rateKeys: string[] = [];
  let created = 0;

  const accounts: OAuthAccountRepository = {
    findOAuthAccount: async () => null,
    findUserByEmailNormalized: async (email) =>
      existingEmails.has(email) ? { userId: 'u-existant', passwordHash: existingEmails.get(email) ?? null } : null,
    createUserWithOAuthAccount: async () => {
      created += 1;
      return { userId: `nouveau-${created}` };
    },
    linkOAuthAccount: async () => undefined,
  };
  const turnstile: TurnstileVerifier = {
    verify: async (input) => {
      turnstileCalls.push(input);
      return options.turnstileOk ?? true;
    },
  };
  const rateLimiter: RateLimiter = {
    allow: async (key) => {
      rateKeys.push(key);
      return options.rateOk ?? true;
    },
  };
  let lastNonce = '';
  const deps: GoogleOAuthRouterDeps = {
    turnstile,
    rateLimiter,
    oauth: {
      config: { clientId: CLIENT_ID, clientSecret: 'secret-factice', redirectUri: `https://auth.fisca.ma${CALLBACK}` },
      transactions: {
        save: async (tx) => {
          transactions.set(tx.state, tx);
          lastNonce = tx.nonce;
        },
        consume: async (state) => {
          const tx = transactions.get(state) ?? null;
          transactions.delete(state);
          if (tx !== null) lastNonce = tx.nonce;
          return tx;
        },
      },
      http: {
        postForm: async () => {
          const head = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'RS256', kid: KID })));
          const body = base64UrlEncode(
            encoder.encode(
              JSON.stringify({
                iss: 'https://accounts.google.com',
                aud: CLIENT_ID,
                sub: 'sub-routes-1',
                email: 'nadia@example.ma',
                email_verified: true,
                name: 'Nadia',
                exp: NOW + 600,
                nonce: lastNonce,
                ...options.claims,
              }),
            ),
          );
          const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(`${head}.${body}`));
          return { status: 200, body: { id_token: `${head}.${body}.${base64UrlEncode(new Uint8Array(sig))}` } };
        },
      },
      jwks: createJwksProvider(async () => ({ keys: [{ ...jwk, kid: KID }] })),
      accounts,
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
      emailProof: { sendLinkProof: async () => undefined },
      nowEpochSec: () => NOW,
    },
  };
  return { app: createAuthRoutes(deps), transactions, existingEmails, turnstileCalls, rateKeys };
}

async function startFlow(harness: Awaited<ReturnType<typeof buildHarness>>): Promise<string> {
  const response = await harness.app.request(`${START}?cf-turnstile-response=jeton-turnstile`, {
    headers: { 'CF-Connecting-IP': '203.0.113.7' },
  });
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get('Location') ?? '');
  const state = location.searchParams.get('state');
  expect(state).not.toBeNull();
  return state ?? '';
}

describe('GET /api/v1/auth/google/start (CTR-API-04)', () => {
  it('redirige vers Google avec PKCE S256 après Turnstile et limitation de débit', async () => {
    const harness = await buildHarness();
    const response = await harness.app.request(`${START}?cf-turnstile-response=jeton-turnstile`, {
      headers: { 'CF-Connecting-IP': '203.0.113.7' },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.search).not.toContain('secret-factice');
    expect(harness.turnstileCalls).toEqual([{ token: 'jeton-turnstile', remoteIp: '203.0.113.7' }]);
    expect(harness.rateKeys).toEqual(['auth:google:start:203.0.113.7']);
    expect(harness.transactions.size).toBe(1);
  });

  it('refuse (403) sans Turnstile valide et ne crée aucune transaction', async () => {
    const harness = await buildHarness({ turnstileOk: false });
    const response = await harness.app.request(START);
    expect(response.status).toBe(403);
    expect(response.headers.get('Content-Type')).toContain('application/problem+json');
    const body = (await response.json()) as { errorCode: string };
    expect(body.errorCode).toBe('TURNSTILE_REQUIRED');
    expect(harness.transactions.size).toBe(0);
    expect(harness.turnstileCalls).toEqual([{ token: null, remoteIp: null }]);
  });

  it('refuse (429) au-delà de la limite de débit, avant tout appel Turnstile', async () => {
    const harness = await buildHarness({ rateOk: false });
    const response = await harness.app.request(`${START}?cf-turnstile-response=x`);
    expect(response.status).toBe(429);
    expect(harness.turnstileCalls).toHaveLength(0);
  });
});

describe('GET /api/v1/auth/google/callback (CTR-API-05)', () => {
  it('authentifie et inscrit un nouvel utilisateur, puis refuse le rejeu du state', async () => {
    const harness = await buildHarness();
    const state = await startFlow(harness);
    const ok = await harness.app.request(`${CALLBACK}?code=code-1&state=${state}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: 'AUTHENTICATED', userId: 'nouveau-1', isNewUser: true });
    const replay = await harness.app.request(`${CALLBACK}?code=code-1&state=${state}`);
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { errorCode: string }).errorCode).toBe('STATE_INVALID');
  });

  it("exige une preuve (409) pour un e-mail déjà utilisé par un compte non lié", async () => {
    const harness = await buildHarness();
    harness.existingEmails.set('nadia@example.ma', null);
    const state = await startFlow(harness);
    const response = await harness.app.request(`${CALLBACK}?code=c&state=${state}`);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { status: string; methods: string[]; userId?: string };
    expect(body.status).toBe('LINK_PROOF_REQUIRED');
    expect(body.methods).toEqual(['EMAIL_LINK']);
    expect(body.userId).toBeUndefined();
  });

  it('refuse (403) un e-mail Google non vérifié', async () => {
    const harness = await buildHarness({ claims: { email_verified: false } });
    const state = await startFlow(harness);
    const response = await harness.app.request(`${CALLBACK}?code=c&state=${state}`);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { errorCode: string }).errorCode).toBe('EMAIL_NOT_VERIFIED');
  });

  it('refuse (401) un id_token expiré ou au mauvais aud', async () => {
    for (const claims of [{ exp: NOW - 1 }, { aud: 'autre' }]) {
      const harness = await buildHarness({ claims });
      const state = await startFlow(harness);
      const response = await harness.app.request(`${CALLBACK}?code=c&state=${state}`);
      expect(response.status).toBe(401);
    }
  });

  it('refuse (400) un state inconnu, un state absent et une erreur renvoyée par Google', async () => {
    const harness = await buildHarness();
    expect((await harness.app.request(`${CALLBACK}?code=c&state=inconnu`)).status).toBe(400);
    expect((await harness.app.request(`${CALLBACK}?code=c`)).status).toBe(400);
    const state = await startFlow(harness);
    const denied = await harness.app.request(`${CALLBACK}?error=access_denied&state=${state}`);
    expect(denied.status).toBe(400);
    expect(((await denied.json()) as { errorCode: string }).errorCode).toBe('PROVIDER_ERROR');
  });

  it('refuse (429) au-delà de la limite de débit', async () => {
    const harness = await buildHarness({ rateOk: false });
    const response = await harness.app.request(`${CALLBACK}?code=c&state=s`);
    expect(response.status).toBe(429);
  });

  it("n'expose que les deux routes du registre", async () => {
    const harness = await buildHarness();
    expect((await harness.app.request('/api/v1/auth/google/autre')).status).toBe(404);
    expect((await harness.app.request(START, { method: 'POST' })).status).toBe(404);
  });
});
