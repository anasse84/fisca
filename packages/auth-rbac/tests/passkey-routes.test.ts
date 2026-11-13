import { describe, expect, it } from 'vitest';
import {
  PASSKEY_AUTHENTICATE_OPTIONS_PATH,
  PASSKEY_AUTHENTICATE_VERIFY_PATH,
  PASSKEY_REGISTER_OPTIONS_PATH,
  PASSKEY_REGISTER_VERIFY_PATH,
  createJwtSessionAuthenticator,
  createPasskeyRouter,
  createSessionService,
} from '../src/index.ts';
import type { PasskeyChallengeRecord, PasskeyCredentialRecord, PasskeyRouterDeps, RefreshTokenRecord } from '../src/index.ts';
import { generateEd25519PrivateJwkJson } from './jwt-fixtures.ts';
import { ORIGIN, RP_ID, createAuthenticator, makeAssertionResponse, makeRegistrationResponse } from './webauthn-fixtures.ts';
import type { FakeAuthenticator } from './webauthn-fixtures.ts';

const NOW = 1_800_000_000;
const USER = 'user-passkey-1';

interface Problem {
  readonly status: number;
  readonly errorCode: string;
  readonly traceId: string;
}

async function harness(options: { turnstileOk?: boolean; rateOk?: boolean; failStore?: boolean } = {}) {
  const challenges = new Map<string, PasskeyChallengeRecord>();
  const credentials = new Map<string, PasskeyCredentialRecord>();
  const refreshRows = new Map<string, RefreshTokenRecord>();
  const issued: string[] = [];
  const turnstileCalls: { token: string | null; remoteIp: string | null }[] = [];
  const rateKeys: string[] = [];
  const base = await createSessionService({
    privateJwk: await generateEd25519PrivateJwkJson(),
    issuer: 'https://api.fisca.ma',
    audience: 'fisca-api',
    nowEpochSec: () => NOW,
    refresh: {
      ttlSec: 3600,
      nowEpochSec: () => NOW,
      store: {
        insert: async (record) => {
          refreshRows.set(record.tokenHash, record);
        },
        findByHash: async (hash) => refreshRows.get(hash) ?? null,
        markRotated: async () => true,
        revokeFamily: async () => undefined,
      },
    },
  });
  const sessions = {
    ...base,
    issuePasskeySession: async (input: { readonly userId: string }) => {
      issued.push(input.userId);
      return base.issuePasskeySession(input);
    },
  };
  const deps: PasskeyRouterDeps = {
    passkeys: {
      config: { rpId: RP_ID, rpName: 'Fisca', allowedOrigins: [ORIGIN] },
      challenges: {
        save: async (record) => {
          if (options.failStore === true) {
            throw new Error('détail interne confidentiel');
          }
          challenges.set(record.challenge, record);
        },
        consume: async (challenge) => {
          const record = challenges.get(challenge) ?? null;
          challenges.delete(challenge);
          return record;
        },
      },
      credentials: {
        listByUser: async (userId) => [...credentials.values()].filter((row) => row.userId === userId),
        findByCredentialId: async (id) => credentials.get(id) ?? null,
        insert: async (record) => {
          if (credentials.has(record.credentialId)) {
            return false;
          }
          credentials.set(record.credentialId, record);
          return true;
        },
        updateSignCount: async (id, expectedPrevious, next, backupState) => {
          const row = credentials.get(id);
          if (row === undefined || row.signCount !== expectedPrevious) {
            return false;
          }
          credentials.set(id, { ...row, signCount: next, backupState });
          return true;
        },
      },
      nowEpochSec: () => NOW,
    },
    sessions,
    authenticator: createJwtSessionAuthenticator({ sessions, resolveAccountLabel: async (id) => `${id}@example.ma` }),
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
  const app = createPasskeyRouter(deps);
  const bearer = async (userId: string): Promise<string> => `Bearer ${(await base.issueFirstFactorSession({ userId, firstFactor: 'PASSWORD' })).accessToken}`;
  return { app, deps, verify: base.verify, challenges, credentials, issued, turnstileCalls, rateKeys, bearer, refreshRows };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}, turnstile = 'tok'): Request {
  return new Request(`https://fisca.test${path}?cf-turnstile-response=${turnstile}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...headers },
    body: JSON.stringify(body),
  });
}

async function readProblem(response: Response): Promise<Problem> {
  expect(response.headers.get('Content-Type')).toContain('application/problem+json');
  const parsed: unknown = await response.json();
  return parsed as Problem;
}

async function registerPasskey(h: Awaited<ReturnType<typeof harness>>, authenticator: FakeAuthenticator): Promise<Response> {
  const auth = await h.bearer(USER);
  const options = await h.app.request(post(PASSKEY_REGISTER_OPTIONS_PATH, {}, { Authorization: auth }));
  const body = (await options.json()) as { challenge: string };
  const credential = await makeRegistrationResponse(authenticator, body.challenge);
  return h.app.request(post(PASSKEY_REGISTER_VERIFY_PATH, { credential }, { Authorization: auth }));
}

describe('routes passkeys : enregistrement', () => {
  it('exige une session JWT valide pour les options (401 sans jeton, 401 avec jeton falsifié)', async () => {
    const h = await harness();
    const anonymous = await h.app.request(post(PASSKEY_REGISTER_OPTIONS_PATH, {}));
    expect(anonymous.status).toBe(401);
    expect((await readProblem(anonymous)).errorCode).toBe('AUTH_REQUIRED');
    const forged = await h.app.request(post(PASSKEY_REGISTER_OPTIONS_PATH, {}, { Authorization: 'Bearer abc.def.ghi' }));
    expect(forged.status).toBe(401);
    expect(h.challenges.size).toBe(0);
  });

  it('renvoie les options WebAuthn (challenge, rp, PRF) pour une session valide', async () => {
    const h = await harness();
    const response = await h.app.request(post(PASSKEY_REGISTER_OPTIONS_PATH, {}, { Authorization: await h.bearer(USER) }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as { challenge: string; rp: { id: string }; user: { name: string }; extensions: { prf: unknown } };
    expect(body.rp.id).toBe(RP_ID);
    expect(body.user.name).toBe(`${USER}@example.ma`);
    expect(body.extensions.prf).toBeDefined();
    expect(h.challenges.get(body.challenge)?.userId).toBe(USER);
  });

  it('refuse verify sans session (401) et sans credential (400)', async () => {
    const h = await harness();
    expect((await h.app.request(post(PASSKEY_REGISTER_VERIFY_PATH, { credential: {} }))).status).toBe(401);
    const missing = await h.app.request(post(PASSKEY_REGISTER_VERIFY_PATH, {}, { Authorization: await h.bearer(USER) }));
    expect(missing.status).toBe(400);
    expect((await readProblem(missing)).errorCode).toBe('REQUEST_INVALID');
    const malformed = await h.app.request(post(PASSKEY_REGISTER_VERIFY_PATH, { credential: { id: 'x' } }, { Authorization: await h.bearer(USER) }));
    expect(malformed.status).toBe(400);
    expect((await readProblem(malformed)).errorCode).toBe('PASSKEY_REQUEST_MALFORMED');
  });

  it('enregistre la passkey et ne pose aucun cookie ni jeton de session', async () => {
    const h = await harness();
    const authenticator = await createAuthenticator('ES256');
    const response = await registerPasskey(h, authenticator);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['status']).toBe('REGISTERED');
    expect(body['prfEnabled']).toBe(true);
    expect(body['accessToken']).toBeUndefined();
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(h.credentials.size).toBe(1);
    expect(h.issued).toEqual([]);
  });

  it('refuse (403) un challenge émis pour un autre utilisateur et (409) un identifiant déjà enregistré', async () => {
    const h = await harness();
    const authenticator = await createAuthenticator('ES256');
    const optionsA = await h.app.request(post(PASSKEY_REGISTER_OPTIONS_PATH, {}, { Authorization: await h.bearer(USER) }));
    const challenge = ((await optionsA.json()) as { challenge: string }).challenge;
    const credential = await makeRegistrationResponse(authenticator, challenge);
    const stolen = await h.app.request(post(PASSKEY_REGISTER_VERIFY_PATH, { credential }, { Authorization: await h.bearer('autre-utilisateur') }));
    expect(stolen.status).toBe(403);
    expect((await readProblem(stolen)).errorCode).toBe('PASSKEY_USER_MISMATCH');
    expect(h.credentials.size).toBe(0);
    expect((await registerPasskey(h, authenticator)).status).toBe(200);
    expect((await registerPasskey(h, authenticator)).status).toBe(409);
  });
});

describe('routes passkeys : authentification', () => {
  it('délivre des options sans session ni identifiant (aucune énumération de passkeys)', async () => {
    const h = await harness();
    const authenticator = await createAuthenticator('EdDSA');
    expect((await registerPasskey(h, authenticator)).status).toBe(200);
    const response = await h.app.request(post(PASSKEY_AUTHENTICATE_OPTIONS_PATH, { userId: USER }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { challenge: string; allowCredentials: unknown[]; userVerification: string };
    expect(body.allowCredentials).toEqual([]);
    expect(body.userVerification).toBe('required');
    expect(h.challenges.get(body.challenge)?.userId).toBeNull();
  });

  async function authenticateFlow(h: Awaited<ReturnType<typeof harness>>, authenticator: FakeAuthenticator, tamper = false): Promise<Response> {
    const options = await h.app.request(post(PASSKEY_AUTHENTICATE_OPTIONS_PATH, {}));
    const challenge = ((await options.json()) as { challenge: string }).challenge;
    const credential = await makeAssertionResponse(authenticator, challenge, { tamperSignature: tamper });
    return h.app.request(post(PASSKEY_AUTHENTICATE_VERIFY_PATH, { credential }));
  }

  it('émet la session par issuePasskeySession : JWT amr=passkey, mfa_verified_at posé, cookie de refresh', async () => {
    const h = await harness();
    const authenticator = await createAuthenticator('ES256');
    await registerPasskey(h, authenticator);
    const response = await authenticateFlow(h, authenticator);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const cookie = response.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('__Host-fisca_refresh=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    const body = (await response.json()) as { status: string; accessToken: string; expiresInSec: number };
    expect(body.status).toBe('AUTHENTICATED');
    const claims = await h.verify(body.accessToken);
    expect(claims.sub).toBe(USER);
    expect(claims.amr).toEqual(['passkey']);
    expect(claims.mfaVerifiedAtEpochSec).toBe(NOW);
    expect(h.issued).toEqual([USER]);
  });

  it('n’émet aucune session sur signature invalide, rejeu de challenge, identifiant inconnu ou JSON invalide', async () => {
    const h = await harness();
    const authenticator = await createAuthenticator('ES256');
    await registerPasskey(h, authenticator);
    const tampered = await authenticateFlow(h, authenticator, true);
    expect(tampered.status).toBe(401);
    expect((await readProblem(tampered)).errorCode).toBe('PASSKEY_AUTHENTICATION_FAILED');
    expect(tampered.headers.get('Set-Cookie')).toBeNull();

    const options = await h.app.request(post(PASSKEY_AUTHENTICATE_OPTIONS_PATH, {}));
    const challenge = ((await options.json()) as { challenge: string }).challenge;
    const credential = await makeAssertionResponse(authenticator, challenge);
    expect((await h.app.request(post(PASSKEY_AUTHENTICATE_VERIFY_PATH, { credential }))).status).toBe(200);
    const replay = await h.app.request(post(PASSKEY_AUTHENTICATE_VERIFY_PATH, { credential }));
    expect(replay.status).toBe(401);

    const stranger = await createAuthenticator('ES256');
    expect((await authenticateFlow(h, stranger)).status).toBe(401);

    const notJson = await h.app.request(
      new Request(`https://fisca.test${PASSKEY_AUTHENTICATE_VERIFY_PATH}?cf-turnstile-response=tok`, { method: 'POST', body: 'pas du json' }),
    );
    expect(notJson.status).toBe(400);
    expect(h.issued).toEqual([USER]);
  });

  it('refuse un challenge d’enregistrement présenté à l’authentification (aucune session)', async () => {
    const h = await harness();
    const authenticator = await createAuthenticator('ES256');
    await registerPasskey(h, authenticator);
    const options = await h.app.request(post(PASSKEY_REGISTER_OPTIONS_PATH, {}, { Authorization: await h.bearer(USER) }));
    const challenge = ((await options.json()) as { challenge: string }).challenge;
    const credential = await makeAssertionResponse(authenticator, challenge);
    const response = await h.app.request(post(PASSKEY_AUTHENTICATE_VERIFY_PATH, { credential }));
    expect(response.status).toBe(401);
    expect(h.issued).toEqual([]);
  });
});

describe('routes passkeys : Turnstile, débit, erreurs', () => {
  const paths = [
    PASSKEY_REGISTER_OPTIONS_PATH,
    PASSKEY_REGISTER_VERIFY_PATH,
    PASSKEY_AUTHENTICATE_OPTIONS_PATH,
    PASSKEY_AUTHENTICATE_VERIFY_PATH,
  ];

  it.each(paths)('%s : 429 si débit dépassé, avant Turnstile', async (path) => {
    const h = await harness({ rateOk: false });
    const response = await h.app.request(post(path, {}));
    expect(response.status).toBe(429);
    expect((await readProblem(response)).errorCode).toBe('RATE_LIMITED');
    expect(h.turnstileCalls).toEqual([]);
    expect(h.rateKeys[0]).toContain('203.0.113.9');
  });

  it.each(paths)('%s : 403 si Turnstile refuse, jeton lu dans cf-turnstile-response', async (path) => {
    const h = await harness({ turnstileOk: false });
    const response = await h.app.request(post(path, {}, {}, 'jeton-xyz'));
    expect(response.status).toBe(403);
    expect((await readProblem(response)).errorCode).toBe('TURNSTILE_REQUIRED');
    expect(h.turnstileCalls).toEqual([{ token: 'jeton-xyz', remoteIp: '203.0.113.9' }]);
  });

  it('répond en problem+json 500 sans divulguer l’erreur interne', async () => {
    const h = await harness({ failStore: true });
    const response = await h.app.request(post(PASSKEY_AUTHENTICATE_OPTIONS_PATH, {}));
    expect(response.status).toBe(500);
    const problem = await readProblem(response);
    expect(problem.errorCode).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(problem)).not.toContain('confidentiel');
  });

  it('ne répond qu’en POST', async () => {
    const h = await harness();
    expect((await h.app.request(`https://fisca.test${PASSKEY_AUTHENTICATE_OPTIONS_PATH}`)).status).toBe(404);
  });
});
