import { describe, expect, it } from 'vitest';
import {
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GoogleOAuthError,
  PENDING_LINK_MAX_ATTEMPTS,
  OAUTH_TRANSACTION_TTL_SEC,
  base64UrlEncode,
  beginGoogleAuthorization,
  completeGoogleAuthorization,
  computeCodeChallengeS256,
  confirmPendingLink,
  createJwksProvider,
  generateCodeVerifier,
  isValidCodeVerifier,
  verifyGoogleIdToken,
} from '../src/index.ts';
import { createLowCostPasswordService } from '../src/testing.ts';
import type {
  GoogleOAuthDeps,
  GoogleOAuthErrorCode,
  JwksProvider,
  OAuthAccountRepository,
  OAuthHttpClient,
  OAuthTransaction,
  PendingLink,
} from '../src/index.ts';

// Valeurs factices de test uniquement.
const CLIENT_ID = 'client-id-factice.apps.googleusercontent.com';
const CLIENT_SECRET = 'secret-factice-de-test';
const REDIRECT_URI = 'https://auth.fisca.ma/api/v1/auth/google/callback';
const TEST_PEPPER = 'pepper-factice-de-test-uniquement';
// Coût PBKDF2 bas réservé aux tests (fabrique hors index public).
const LOW = createLowCostPasswordService();
const PASSWORD = 'Correct-Horse-Battery-42';
const NOW = 1_800_000_000;
const KID = 'kid-de-test-1';

const textEncoder = new TextEncoder();

async function expectOAuthError(promise: Promise<unknown>, code: GoogleOAuthErrorCode): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GoogleOAuthError);
    expect((error as GoogleOAuthError).code).toBe(code);
    return;
  }
  throw new Error(`erreur ${code} attendue`);
}

// ---------------------------------------------------------------------------
// Doubles de test : dépôts et stockage en mémoire, clé RSA de test
// ---------------------------------------------------------------------------

interface UserRow {
  readonly userId: string;
  readonly email: string;
  readonly passwordHash: string | null;
}
interface LinkRow {
  readonly userId: string;
  readonly subject: string;
  readonly providerEmail: string;
}

function createWorld() {
  const transactions = new Map<string, OAuthTransaction>();
  const pending = new Map<string, PendingLink>();
  const users: UserRow[] = [];
  const links: LinkRow[] = [];
  const sentProofs: { email: string; token: string }[] = [];
  let counter = 0;

  const accounts: OAuthAccountRepository = {
    findOAuthAccount: async (provider, subject) => {
      const row = links.find((link) => provider === 'GOOGLE' && link.subject === subject);
      return row === undefined ? null : { userId: row.userId };
    },
    findUserByEmailNormalized: async (email) => {
      const row = users.find((user) => user.email === email);
      return row === undefined ? null : { userId: row.userId, passwordHash: row.passwordHash };
    },
    createUserWithOAuthAccount: async (input) => {
      counter += 1;
      const userId = `user-${counter}`;
      users.push({ userId, email: input.emailNormalized, passwordHash: null });
      links.push({ userId, subject: input.subject, providerEmail: input.providerEmail });
      return { userId };
    },
    linkOAuthAccount: async (input) => {
      links.push({ userId: input.userId, subject: input.subject, providerEmail: input.providerEmail });
    },
  };

  return { transactions, pending, users, links, sentProofs, accounts };
}

type World = ReturnType<typeof createWorld>;

async function createSigner() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const jwks = { keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] };

  async function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>): Promise<string> {
    const head = base64UrlEncode(textEncoder.encode(JSON.stringify(header)));
    const body = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, textEncoder.encode(`${head}.${body}`));
    return `${head}.${body}.${base64UrlEncode(new Uint8Array(signature))}`;
  }
  return { jwks, signJwt };
}

type Signer = Awaited<ReturnType<typeof createSigner>>;

function claimsFor(nonce: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'google-sub-111',
    email: 'Amina@Example.ma',
    email_verified: true,
    name: 'Amina Alaoui',
    picture: 'https://example.ma/a.png',
    iat: NOW - 10,
    exp: NOW + 3000,
    nonce,
    ...overrides,
  };
}

function buildDeps(world: World, signer: Signer, idTokenFor: (tx: OAuthTransaction) => Promise<string>): {
  deps: GoogleOAuthDeps;
  exchanges: Record<string, string>[];
} {
  const exchanges: Record<string, string>[] = [];
  const http: OAuthHttpClient = {
    postForm: async (_url, form) => {
      exchanges.push({ ...form });
      const tx = [...world.transactions.values()].find((candidate) => candidate.codeVerifier === form['code_verifier']);
      const source = tx ?? lastConsumed;
      return { status: 200, body: { id_token: await idTokenFor(source) } };
    },
  };
  let lastConsumed: OAuthTransaction = { state: '', nonce: '', codeVerifier: '', turnstileVerified: true, expiresAtEpochSec: 0 };
  const jwks: JwksProvider = createJwksProvider(async () => signer.jwks);
  const deps: GoogleOAuthDeps = {
    config: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI },
    transactions: {
      save: async (tx) => {
        world.transactions.set(tx.state, tx);
      },
      consume: async (state) => {
        const tx = world.transactions.get(state) ?? null;
        world.transactions.delete(state);
        if (tx !== null) lastConsumed = tx;
        return tx;
      },
    },
    http,
    jwks,
    accounts: world.accounts,
    pendingLinks: {
      save: async (link) => {
        world.pending.set(link.id, link);
      },
      take: async (id) => {
        const link = world.pending.get(id) ?? null;
        world.pending.delete(id);
        return link;
      },
    },
    emailProof: {
      sendLinkProof: async (message) => {
        world.sentProofs.push({ email: message.emailNormalized, token: message.token });
      },
    },
    nowEpochSec: () => NOW,
  };
  return { deps, exchanges };
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

describe('PKCE S256 (RFC 7636)', () => {
  it("reproduit le vecteur de l'annexe B de la RFC 7636", async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await computeCodeChallengeS256(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('refuse de calculer un challenge pour un verifier invalide', async () => {
    await expectOAuthError(computeCodeChallengeS256('trop-court'), 'PKCE_VERIFIER_INVALID');
  });

  it('génère des verifiers de 43 à 128 caractères du jeu non réservé, distincts', () => {
    const first = generateCodeVerifier();
    const second = generateCodeVerifier();
    expect(first).not.toBe(second);
    for (const verifier of [first, second]) {
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
      expect(isValidCodeVerifier(verifier)).toBe(true);
    }
  });

  it('valide les bornes 43 et 128 caractères et refuse les autres', () => {
    expect(isValidCodeVerifier('a'.repeat(42))).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(128))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(129))).toBe(false);
    expect(isValidCodeVerifier(`${'a'.repeat(42)}+`)).toBe(false);
  });

  it('encode en base64url sans remplissage', () => {
    expect(base64UrlEncode(new Uint8Array([251, 255, 254]))).toBe('-__-');
    expect(base64UrlEncode(new Uint8Array([1]))).toBe('AQ');
  });
});

// ---------------------------------------------------------------------------
// URL d'autorisation, state et nonce
// ---------------------------------------------------------------------------

describe("construction de l'URL d'autorisation", () => {
  it('contient PKCE S256, state, nonce, scopes openid email profile et mémorise la transaction', async () => {
    const world = createWorld();
    const signer = await createSigner();
    const { deps } = buildDeps(world, signer, async () => 'x');
    const { authorizationUrl, state } = await beginGoogleAuthorization(deps, { turnstileVerified: true });
    const url = new URL(authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTHORIZATION_ENDPOINT);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(state);
    const tx = world.transactions.get(state);
    expect(tx).toBeDefined();
    expect(tx?.expiresAtEpochSec).toBe(NOW + OAUTH_TRANSACTION_TTL_SEC);
    expect(url.searchParams.get('nonce')).toBe(tx?.nonce);
    expect(url.searchParams.get('code_challenge')).toBe(await computeCodeChallengeS256(tx?.codeVerifier ?? ''));
    expect(url.search).not.toContain(CLIENT_SECRET);
    expect(url.search).not.toContain(tx?.codeVerifier ?? 'absent');
  });

  it('refuse de démarrer sans preuve Turnstile', async () => {
    const world = createWorld();
    const signer = await createSigner();
    const { deps } = buildDeps(world, signer, async () => 'x');
    await expectOAuthError(beginGoogleAuthorization(deps, { turnstileVerified: false }), 'TURNSTILE_REQUIRED');
    expect(world.transactions.size).toBe(0);
  });

  it('tire un state et un nonce distincts à chaque démarrage', async () => {
    const world = createWorld();
    const signer = await createSigner();
    const { deps } = buildDeps(world, signer, async () => 'x');
    const a = await beginGoogleAuthorization(deps, { turnstileVerified: true });
    const b = await beginGoogleAuthorization(deps, { turnstileVerified: true });
    expect(a.state).not.toBe(b.state);
    const nonces = [...world.transactions.values()].map((tx) => tx.nonce);
    expect(new Set(nonces).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Validation de l'id_token
// ---------------------------------------------------------------------------

describe("validation de l'id_token", () => {
  const NONCE = 'nonce-attendu-0123456789';

  async function verify(signer: Signer, token: string, overrides?: { nonce?: string; now?: number }) {
    return verifyGoogleIdToken({
      idToken: token,
      expectedNonce: overrides?.nonce ?? NONCE,
      clientId: CLIENT_ID,
      nowEpochSec: overrides?.now ?? NOW,
      jwks: createJwksProvider(async () => signer.jwks),
    });
  }

  it('accepte un jeton valide et normalise les claims', async () => {
    const signer = await createSigner();
    const token = await signer.signJwt({ alg: 'RS256', kid: KID, typ: 'JWT' }, claimsFor(NONCE));
    const claims = await verify(signer, token);
    expect(claims.sub).toBe('google-sub-111');
    expect(claims.email).toBe('Amina@Example.ma');
    expect(claims.emailVerified).toBe(true);
  });

  it('accepte iss sans schéma et aud sous forme de tableau avec azp', async () => {
    const signer = await createSigner();
    const token = await signer.signJwt(
      { alg: 'RS256', kid: KID },
      claimsFor(NONCE, { iss: 'accounts.google.com', aud: [CLIENT_ID, 'autre'], azp: CLIENT_ID }),
    );
    expect((await verify(signer, token)).sub).toBe('google-sub-111');
  });

  it.each([
    ['sans trois segments', 'abc.def'],
    ['vide', ''],
    ['segments non base64url', 'a$b.c$d.e$f'],
  ])('refuse un jeton mal formé (%s)', async (_label, token) => {
    const signer = await createSigner();
    await expectOAuthError(verify(signer, token), 'ID_TOKEN_MALFORMED');
  });

  it("refuse un en-tête ou une charge utile qui n'est pas du JSON objet", async () => {
    const signer = await createSigner();
    const bad = base64UrlEncode(textEncoder.encode('pas-du-json'));
    await expectOAuthError(verify(signer, `${bad}.${bad}.${bad}`), 'ID_TOKEN_MALFORMED');
  });

  it('refuse alg none et tout algorithme autre que RS256', async () => {
    const signer = await createSigner();
    const none = await signer.signJwt({ alg: 'none', kid: KID }, claimsFor(NONCE));
    await expectOAuthError(verify(signer, none), 'ID_TOKEN_MALFORMED');
    const hs = await signer.signJwt({ alg: 'HS256', kid: KID }, claimsFor(NONCE));
    await expectOAuthError(verify(signer, hs), 'ID_TOKEN_MALFORMED');
  });

  it('refuse une signature falsifiée ou un kid inconnu', async () => {
    const signer = await createSigner();
    const token = await signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor(NONCE));
    const [head, body, sig] = token.split('.');
    const forgedBody = base64UrlEncode(textEncoder.encode(JSON.stringify(claimsFor(NONCE, { sub: 'pirate' }))));
    await expectOAuthError(verify(signer, `${head}.${forgedBody}.${sig}`), 'ID_TOKEN_SIGNATURE_INVALID');
    const unknownKid = await signer.signJwt({ alg: 'RS256', kid: 'inconnu' }, claimsFor(NONCE));
    await expectOAuthError(verify(signer, unknownKid), 'ID_TOKEN_SIGNATURE_INVALID');
    expect(body).toBeDefined();
  });

  it('refuse une signature faite avec une autre clé', async () => {
    const signer = await createSigner();
    const other = await createSigner();
    const token = await other.signJwt({ alg: 'RS256', kid: KID }, claimsFor(NONCE));
    await expectOAuthError(verify(signer, token), 'ID_TOKEN_SIGNATURE_INVALID');
  });

  it('refuse un mauvais émetteur', async () => {
    const signer = await createSigner();
    const token = await signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor(NONCE, { iss: 'https://evil.example' }));
    await expectOAuthError(verify(signer, token), 'ID_TOKEN_ISSUER_INVALID');
  });

  it('refuse un mauvais aud (chaîne, tableau, absent)', async () => {
    const signer = await createSigner();
    for (const aud of ['autre-client', ['autre-client'], undefined]) {
      const token = await signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor(NONCE, { aud }));
      await expectOAuthError(verify(signer, token), 'ID_TOKEN_AUDIENCE_INVALID');
    }
  });

  it('refuse un jeton expiré (exp <= maintenant) ou sans exp', async () => {
    const signer = await createSigner();
    const expired = await signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor(NONCE, { exp: NOW }));
    await expectOAuthError(verify(signer, expired), 'ID_TOKEN_EXPIRED');
    const missing = await signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor(NONCE, { exp: undefined }));
    await expectOAuthError(verify(signer, missing), 'ID_TOKEN_EXPIRED');
  });

  it('refuse un mauvais nonce ou un nonce absent', async () => {
    const signer = await createSigner();
    const wrong = await signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor('autre-nonce'));
    await expectOAuthError(verify(signer, wrong), 'ID_TOKEN_NONCE_INVALID');
    const missing = await signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor(NONCE, { nonce: undefined }));
    await expectOAuthError(verify(signer, missing), 'ID_TOKEN_NONCE_INVALID');
  });

  it('refuse un e-mail Google non vérifié (booléen faux, absent ou chaîne "false")', async () => {
    const signer = await createSigner();
    for (const email_verified of [false, undefined, 'false']) {
      const token = await signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor(NONCE, { email_verified }));
      await expectOAuthError(verify(signer, token), 'EMAIL_NOT_VERIFIED');
    }
  });

  it('accepte email_verified sous forme de chaîne "true" (usage de Google)', async () => {
    const signer = await createSigner();
    const token = await signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor(NONCE, { email_verified: 'true' }));
    expect((await verify(signer, token)).emailVerified).toBe(true);
  });

  it('refuse un sub ou un e-mail absent', async () => {
    const signer = await createSigner();
    const noSub = await signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor(NONCE, { sub: undefined }));
    await expectOAuthError(verify(signer, noSub), 'ID_TOKEN_MALFORMED');
    const noEmail = await signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor(NONCE, { email: undefined }));
    await expectOAuthError(verify(signer, noEmail), 'ID_TOKEN_MALFORMED');
  });
});

// ---------------------------------------------------------------------------
// Fournisseur JWKS
// ---------------------------------------------------------------------------

describe('fournisseur JWKS injectable', () => {
  it('renvoie null pour un document JWKS invalide ou un kid absent', async () => {
    expect(await createJwksProvider(async () => 'nimporte quoi').getVerificationKey(KID)).toBeNull();
    expect(await createJwksProvider(async () => ({ keys: [{ kid: KID, kty: 'EC' }] })).getVerificationKey(KID)).toBeNull();
  });

  it('renvoie null si la récupération échoue', async () => {
    const provider = createJwksProvider(async () => {
      throw new Error('réseau coupé');
    });
    expect(await provider.getVerificationKey(KID)).toBeNull();
  });

  it('met la clé en cache et ne recharge que sur kid inconnu', async () => {
    const signer = await createSigner();
    let fetches = 0;
    const provider = createJwksProvider(async () => {
      fetches += 1;
      return signer.jwks;
    });
    expect(await provider.getVerificationKey(KID)).not.toBeNull();
    expect(await provider.getVerificationKey(KID)).not.toBeNull();
    expect(fetches).toBe(1);
    expect(await provider.getVerificationKey('autre')).toBeNull();
    expect(fetches).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Flux complet : callback, anti-rejeu, Safe Account Linking sur sub
// ---------------------------------------------------------------------------

describe('callback Google : state, nonce et rejeu', () => {
  async function start(world: World, signer: Signer, claimOverrides: Record<string, unknown> = {}) {
    const harness = buildDeps(world, signer, async (tx) =>
      signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor(tx.nonce, claimOverrides)),
    );
    const { state } = await beginGoogleAuthorization(harness.deps, { turnstileVerified: true });
    return { ...harness, state };
  }

  it('échange le code avec le code_verifier et le secret fournis, puis crée le compte', async () => {
    const world = createWorld();
    const signer = await createSigner();
    const { deps, state, exchanges } = await start(world, signer);
    const outcome = await completeGoogleAuthorization({ code: 'code-1', state, providerError: null }, deps);
    expect(outcome).toEqual({ kind: 'SIGNED_UP', userId: 'user-1' });
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({
      grant_type: 'authorization_code',
      code: 'code-1',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });
    expect(isValidCodeVerifier(exchanges[0]?.['code_verifier'] ?? '')).toBe(true);
    expect(world.users[0]?.email).toBe('amina@example.ma');
    expect(world.links[0]?.subject).toBe('google-sub-111');
  });

  it('refuse le rejeu du même state (usage unique)', async () => {
    const world = createWorld();
    const signer = await createSigner();
    const { deps, state } = await start(world, signer);
    await completeGoogleAuthorization({ code: 'code-1', state, providerError: null }, deps);
    await expectOAuthError(
      completeGoogleAuthorization({ code: 'code-1', state, providerError: null }, deps),
      'STATE_INVALID',
    );
  });

  it('refuse un state inconnu, absent ou un code absent sans appeler Google', async () => {
    const world = createWorld();
    const signer = await createSigner();
    const { deps, state, exchanges } = await start(world, signer);
    await expectOAuthError(completeGoogleAuthorization({ code: 'c', state: 'inconnu', providerError: null }, deps), 'STATE_INVALID');
    await expectOAuthError(completeGoogleAuthorization({ code: 'c', state: null, providerError: null }, deps), 'STATE_INVALID');
    await expectOAuthError(completeGoogleAuthorization({ code: null, state, providerError: null }, deps), 'CODE_MISSING');
    expect(exchanges).toHaveLength(0);
  });

  it('refuse un state expiré', async () => {
    const world = createWorld();
    const signer = await createSigner();
    const { deps, state } = await start(world, signer);
    const late: GoogleOAuthDeps = { ...deps, nowEpochSec: () => NOW + OAUTH_TRANSACTION_TTL_SEC };
    await expectOAuthError(completeGoogleAuthorization({ code: 'c', state, providerError: null }, late), 'STATE_EXPIRED');
    await expectOAuthError(completeGoogleAuthorization({ code: 'c', state, providerError: null }, deps), 'STATE_INVALID');
  });

  it("consomme le state quand Google renvoie une erreur (access_denied) puis refuse", async () => {
    const world = createWorld();
    const signer = await createSigner();
    const { deps, state } = await start(world, signer);
    await expectOAuthError(
      completeGoogleAuthorization({ code: null, state, providerError: 'access_denied' }, deps),
      'PROVIDER_ERROR',
    );
    expect(world.transactions.has(state)).toBe(false);
  });

  it('refuse un id_token dont le nonce ne correspond pas à la transaction', async () => {
    const world = createWorld();
    const signer = await createSigner();
    const harness = buildDeps(world, signer, async () => signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor('nonce-rejoue')));
    const { state } = await beginGoogleAuthorization(harness.deps, { turnstileVerified: true });
    await expectOAuthError(
      completeGoogleAuthorization({ code: 'c', state, providerError: null }, harness.deps),
      'ID_TOKEN_NONCE_INVALID',
    );
    expect(world.users).toHaveLength(0);
  });

  it("refuse un id_token expiré, d'un mauvais aud ou d'un e-mail non vérifié sans créer de compte", async () => {
    const cases: readonly [Record<string, unknown>, GoogleOAuthErrorCode][] = [
      [{ exp: NOW - 1 }, 'ID_TOKEN_EXPIRED'],
      [{ aud: 'autre' }, 'ID_TOKEN_AUDIENCE_INVALID'],
      [{ email_verified: false }, 'EMAIL_NOT_VERIFIED'],
    ];
    for (const [overrides, code] of cases) {
      const world = createWorld();
      const signer = await createSigner();
      const { deps, state } = await start(world, signer, overrides);
      await expectOAuthError(completeGoogleAuthorization({ code: 'c', state, providerError: null }, deps), code);
      expect(world.users).toHaveLength(0);
      expect(world.links).toHaveLength(0);
    }
  });

  it("échoue en TOKEN_EXCHANGE_FAILED si Google répond hors 200, sans id_token ou si le réseau tombe", async () => {
    const world = createWorld();
    const signer = await createSigner();
    const { deps } = await start(world, signer);
    const variants: readonly OAuthHttpClient[] = [
      { postForm: async () => ({ status: 400, body: { error: 'invalid_grant' } }) },
      { postForm: async () => ({ status: 200, body: { access_token: 'x' } }) },
      {
        postForm: async () => {
          throw new Error('réseau coupé');
        },
      },
    ];
    for (const http of variants) {
      const { state } = await beginGoogleAuthorization(deps, { turnstileVerified: true });
      await expectOAuthError(
        completeGoogleAuthorization({ code: 'c', state, providerError: null }, { ...deps, http }),
        'TOKEN_EXCHANGE_FAILED',
      );
    }
  });

  it('refuse un callback dont la transaction ne porte pas la preuve Turnstile', async () => {
    const world = createWorld();
    const signer = await createSigner();
    const { deps } = await start(world, signer);
    world.transactions.set('sans-preuve', {
      state: 'sans-preuve',
      nonce: 'n',
      codeVerifier: generateCodeVerifier(),
      turnstileVerified: false,
      expiresAtEpochSec: NOW + 100,
    });
    await expectOAuthError(
      completeGoogleAuthorization({ code: 'c', state: 'sans-preuve', providerError: null }, deps),
      'TURNSTILE_REQUIRED',
    );
  });
});

describe('Safe Account Linking sur sub', () => {
  async function login(world: World, signer: Signer, overrides: Record<string, unknown> = {}) {
    const { deps } = buildDeps(world, signer, async (tx) =>
      signer.signJwt({ alg: 'RS256', kid: KID }, claimsFor(tx.nonce, overrides)),
    );
    const { state } = await beginGoogleAuthorization(deps, { turnstileVerified: true });
    const outcome = await completeGoogleAuthorization({ code: 'c', state, providerError: null }, deps);
    return { outcome, deps };
  }

  it('reconnaît un compte déjà lié par sub, même si l’e-mail Google a changé', async () => {
    const world = createWorld();
    const signer = await createSigner();
    world.users.push({ userId: 'u-existant', email: 'ancien@example.ma', passwordHash: null });
    world.links.push({ userId: 'u-existant', subject: 'google-sub-111', providerEmail: 'ancien@example.ma' });
    const { outcome } = await login(world, signer, { email: 'nouveau@example.ma' });
    expect(outcome).toEqual({ kind: 'SIGNED_IN', userId: 'u-existant' });
    expect(world.users).toHaveLength(1);
    expect(world.links).toHaveLength(1);
  });

  it("ne rattache jamais par l'e-mail seul : collision avec un compte non lié → preuve exigée", async () => {
    const world = createWorld();
    const signer = await createSigner();
    const hash = await LOW.hash(PASSWORD, TEST_PEPPER);
    world.users.push({ userId: 'u-victime', email: 'amina@example.ma', passwordHash: hash });
    const { outcome } = await login(world, signer);
    expect(outcome.kind).toBe('LINK_PROOF_REQUIRED');
    if (outcome.kind !== 'LINK_PROOF_REQUIRED') throw new Error('inattendu');
    expect(outcome.methods).toEqual(['PASSWORD', 'EMAIL_LINK']);
    expect(world.links).toHaveLength(0);
    expect(world.users).toHaveLength(1);
    expect(world.sentProofs).toHaveLength(1);
    expect(world.sentProofs[0]?.email).toBe('amina@example.ma');
  });

  it("propose seulement le lien e-mail quand le compte existant n'a pas de mot de passe", async () => {
    const world = createWorld();
    const signer = await createSigner();
    world.users.push({ userId: 'u-sans-mdp', email: 'amina@example.ma', passwordHash: null });
    const { outcome } = await login(world, signer);
    expect(outcome.kind === 'LINK_PROOF_REQUIRED' && outcome.methods).toEqual(['EMAIL_LINK']);
  });

  it('lie après une preuve par mot de passe correcte', async () => {
    const world = createWorld();
    const signer = await createSigner();
    const hash = await LOW.hash(PASSWORD, TEST_PEPPER);
    world.users.push({ userId: 'u-1', email: 'amina@example.ma', passwordHash: hash });
    const { outcome, deps } = await login(world, signer);
    if (outcome.kind !== 'LINK_PROOF_REQUIRED') throw new Error('inattendu');
    const result = await confirmPendingLink(
      { pendingLinkId: outcome.pendingLinkId, proof: { method: 'PASSWORD', password: PASSWORD } },
      { ...deps, pepper: TEST_PEPPER, passwordService: LOW },
    );
    expect(result).toEqual({ kind: 'LINKED', userId: 'u-1' });
    expect(world.links).toEqual([{ userId: 'u-1', subject: 'google-sub-111', providerEmail: 'Amina@Example.ma' }]);
  });

  it('refuse un mauvais mot de passe, borne les essais et ne lie rien', async () => {
    const world = createWorld();
    const signer = await createSigner();
    const hash = await LOW.hash(PASSWORD, TEST_PEPPER);
    world.users.push({ userId: 'u-1', email: 'amina@example.ma', passwordHash: hash });
    const { outcome, deps } = await login(world, signer);
    if (outcome.kind !== 'LINK_PROOF_REQUIRED') throw new Error('inattendu');
    const confirmDeps = { ...deps, pepper: TEST_PEPPER, passwordService: LOW };
    for (let attempt = 0; attempt < PENDING_LINK_MAX_ATTEMPTS; attempt += 1) {
      await expectOAuthError(
        confirmPendingLink({ pendingLinkId: outcome.pendingLinkId, proof: { method: 'PASSWORD', password: 'Mauvais-Mot-De-Passe-1' } }, confirmDeps),
        'LINK_PROOF_INVALID',
      );
    }
    await expectOAuthError(
      confirmPendingLink({ pendingLinkId: outcome.pendingLinkId, proof: { method: 'PASSWORD', password: PASSWORD } }, confirmDeps),
      'LINK_PENDING_NOT_FOUND',
    );
    expect(world.links).toHaveLength(0);
  });

  it('refuse la preuve par mot de passe pour un compte sans mot de passe', async () => {
    const world = createWorld();
    const signer = await createSigner();
    world.users.push({ userId: 'u-1', email: 'amina@example.ma', passwordHash: null });
    const { outcome, deps } = await login(world, signer);
    if (outcome.kind !== 'LINK_PROOF_REQUIRED') throw new Error('inattendu');
    await expectOAuthError(
      confirmPendingLink({ pendingLinkId: outcome.pendingLinkId, proof: { method: 'PASSWORD', password: PASSWORD } }, { ...deps, pepper: TEST_PEPPER, passwordService: LOW }),
      'LINK_PROOF_INVALID',
    );
    expect(world.links).toHaveLength(0);
  });

  it('lie après une preuve par lien e-mail, et seulement avec le bon jeton', async () => {
    const world = createWorld();
    const signer = await createSigner();
    world.users.push({ userId: 'u-1', email: 'amina@example.ma', passwordHash: null });
    const { outcome, deps } = await login(world, signer);
    if (outcome.kind !== 'LINK_PROOF_REQUIRED') throw new Error('inattendu');
    const confirmDeps = { ...deps, pepper: TEST_PEPPER, passwordService: LOW };
    await expectOAuthError(
      confirmPendingLink({ pendingLinkId: outcome.pendingLinkId, proof: { method: 'EMAIL_LINK', token: 'jeton-forge' } }, confirmDeps),
      'LINK_PROOF_INVALID',
    );
    const token = world.sentProofs[0]?.token ?? '';
    const result = await confirmPendingLink({ pendingLinkId: outcome.pendingLinkId, proof: { method: 'EMAIL_LINK', token } }, confirmDeps);
    expect(result).toEqual({ kind: 'LINKED', userId: 'u-1' });
    expect(world.links).toHaveLength(1);
  });

  it('refuse un lien en attente inconnu, expiré ou déjà utilisé', async () => {
    const world = createWorld();
    const signer = await createSigner();
    world.users.push({ userId: 'u-1', email: 'amina@example.ma', passwordHash: null });
    const { outcome, deps } = await login(world, signer);
    if (outcome.kind !== 'LINK_PROOF_REQUIRED') throw new Error('inattendu');
    const token = world.sentProofs[0]?.token ?? '';
    const proof = { method: 'EMAIL_LINK', token } as const;
    await expectOAuthError(confirmPendingLink({ pendingLinkId: 'inconnu', proof }, { ...deps, pepper: TEST_PEPPER, passwordService: LOW }), 'LINK_PENDING_NOT_FOUND');
    const late = { ...deps, pepper: TEST_PEPPER, passwordService: LOW, nowEpochSec: () => NOW + 24 * 3600 };
    await expectOAuthError(confirmPendingLink({ pendingLinkId: outcome.pendingLinkId, proof }, late), 'LINK_PENDING_EXPIRED');
    await expectOAuthError(confirmPendingLink({ pendingLinkId: outcome.pendingLinkId, proof }, late), 'LINK_PENDING_NOT_FOUND');
    expect(world.links).toHaveLength(0);
  });

  it('refuse de lier un sub déjà rattaché à un autre compte', async () => {
    const world = createWorld();
    const signer = await createSigner();
    world.users.push({ userId: 'u-1', email: 'amina@example.ma', passwordHash: null });
    const { outcome, deps } = await login(world, signer);
    if (outcome.kind !== 'LINK_PROOF_REQUIRED') throw new Error('inattendu');
    world.links.push({ userId: 'u-autre', subject: 'google-sub-111', providerEmail: 'x@example.ma' });
    const token = world.sentProofs[0]?.token ?? '';
    await expectOAuthError(
      confirmPendingLink({ pendingLinkId: outcome.pendingLinkId, proof: { method: 'EMAIL_LINK', token } }, { ...deps, pepper: TEST_PEPPER, passwordService: LOW }),
      'SUB_ALREADY_LINKED',
    );
    expect(world.links).toHaveLength(1);
  });
});
