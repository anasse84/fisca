import { describe, expect, it } from 'vitest';
import type { GoogleOAuthRouterDeps, MfaRouterDeps } from '@fisca/auth-rbac';
import { createAuthRoutes, createMfaRoutes } from './index.ts';

// Valeurs factices de test uniquement.
const NOW = 1_800_000_000;
const SETUP = '/api/v1/auth/2fa/totp/setup';
const ENABLE = '/api/v1/auth/2fa/totp/enable';
const VERIFY = '/api/v1/auth/2fa/verify';
const GOOGLE_START = '/api/v1/auth/google/start';
const GOOGLE_CALLBACK = '/api/v1/auth/google/callback';

function unused(name: string): never {
  throw new Error(`port non utilisé dans ce test : ${name}`);
}

const googleDeps: GoogleOAuthRouterDeps = {
  turnstile: { verify: async () => true },
  rateLimiter: { allow: async () => true },
  oauth: {
    config: { clientId: 'client-factice', clientSecret: 'secret-factice', redirectUri: `https://auth.fisca.ma${GOOGLE_CALLBACK}` },
    transactions: { save: async () => undefined, consume: async () => null },
    http: { postForm: async () => unused('http') },
    jwks: { getVerificationKey: async () => null },
    accounts: {
      findOAuthAccount: async () => null,
      findUserByEmailNormalized: async () => null,
      createUserWithOAuthAccount: async () => unused('create'),
      linkOAuthAccount: async () => undefined,
    },
    pendingLinks: { save: async () => undefined, take: async () => null },
    emailProof: { sendLinkProof: async () => undefined },
    nowEpochSec: () => NOW,
  },
};

const mfaDeps: MfaRouterDeps = {
  authenticator: { authenticate: async () => null },
  turnstile: { verify: async () => true },
  rateLimiter: { allow: async () => true },
  factors: {
    getFactor: async () => null,
    savePendingTotpSecret: async () => undefined,
    activateTotp: async () => undefined,
    consumeRecoveryCodeHash: async () => false,
  },
  secretVault: { seal: async () => unused('seal'), open: async () => unused('open') },
  replay: { getLastUsedStep: async () => null, advanceLastUsedStep: async () => false },
  challenges: {
    isConsumed: async () => false,
    consume: async () => false,
    failureCount: async () => 0,
    recordFailure: async () => 1,
  },
  sessions: { issueSession: async () => unused('issueSession') },
  signingKey: 'cle-de-signature-factice-de-test-32-octets-minimum',
  issuerName: 'Fisca',
  nowEpochSec: () => NOW,
};

function post(path: string, body: unknown): Request {
  return new Request(`https://fisca.test${path}?cf-turnstile-response=tok`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('colle des routes d’authentification', () => {
  it('createAuthRoutes(google, mfa) monte les routes Google ET les trois routes 2FA', async () => {
    const app = createAuthRoutes(googleDeps, mfaDeps);
    const start = await app.request(`${GOOGLE_START}?cf-turnstile-response=tok`);
    expect(start.status).toBe(302);
    expect((await app.request(`${GOOGLE_CALLBACK}?error=access_denied`)).status).toBe(400);
    expect((await app.request(post(SETUP, {}))).status).toBe(401);
    expect((await app.request(post(ENABLE, { code: '123456' }))).status).toBe(401);
    expect((await app.request(post(VERIFY, {}))).status).toBe(400);
  });

  it('étanchéité à la colle : un jeton de défi forgé ne produit aucune session (issueSession jamais appelé)', async () => {
    const app = createAuthRoutes(googleDeps, mfaDeps);
    const response = await app.request(post(VERIFY, { mfa_challenge_token: 'fmc1.e30.AAAA', method: 'TOTP', code: '123456' }));
    expect(response.status).toBe(401);
  });

  it('createAuthRoutes(google) seul ne monte pas les routes 2FA ; createMfaRoutes les monte seules', async () => {
    const googleOnly = createAuthRoutes(googleDeps);
    expect((await googleOnly.request(post(SETUP, {}))).status).toBe(404);
    const mfaOnly = createMfaRoutes(mfaDeps);
    expect((await mfaOnly.request(post(SETUP, {}))).status).toBe(401);
    expect((await mfaOnly.request(`${GOOGLE_START}?cf-turnstile-response=tok`)).status).toBe(404);
  });
});
