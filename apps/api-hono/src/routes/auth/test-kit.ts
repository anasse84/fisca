/**
 * Outillage des tests de routes d'authentification : ports en mémoire, session JWT EdDSA réelle, clé générée à la
 * volée (jamais de clé en dur, CTR-SEC-02). N'est importé que par les fichiers *.test.ts.
 */
/// <reference lib="dom" />
import {
  base64UrlEncode,
  createJwksProvider,
  createSessionService,
  enableTotp,
  generateTotpCodeRfc6238,
  setupTotp,
} from '@fisca/auth-rbac';
import { createLowCostPasswordService } from '@fisca/auth-rbac/testing';
import type {
  FirstFactorDeps,
  GoogleOAuthDeps,
  LockoutState,
  MfaEngineDeps,
  MfaFactorRecord,
  OAuthAccountRepository,
  OAuthTransaction,
  PasswordAccount,
  PasswordAccountStore,
  RefreshTokenRecord,
  RefreshTokenStore,
  SessionService,
} from '@fisca/auth-rbac';

export const NOW = 1_800_000_000;
export const PEPPER = 'pepper-factice-de-test';
/** Coût PBKDF2 bas réservé aux tests (fabrique hors index public ; la production reste à 100 000 itérations). */
export const LOW_COST_PASSWORD_SERVICE = createLowCostPasswordService();
/** Format du hash au coût bas : même schéma que la production, itérations du service de test. */
export const LOW_COST_HASH_FORMAT = new RegExp(
  `^pbkdf2_sha512\\$${LOW_COST_PASSWORD_SERVICE.iterations}\\$[0-9a-f]{32}\\$[0-9a-f]{64}$`,
);
export const PASSWORD = 'mot-de-passe-factice-12';
export const CLIENT_ID = 'client-id-factice.apps.googleusercontent.com';
export const CALLBACK_PATH = '/api/v1/auth/google/callback';
const SIGNING_KEY = 'cle-de-signature-factice-de-test-32-octets-minimum';
const KID = 'kid-kit-1';
const encoder = new TextEncoder();

export interface Kit {
  readonly flow: FirstFactorDeps;
  readonly mfa: MfaEngineDeps;
  readonly sessions: SessionService;
  readonly accounts: PasswordAccountStore;
  readonly accountRows: Map<string, { email: string; account: PasswordAccount }>;
  readonly issuedSessions: string[];
  readonly refreshRows: Map<string, RefreshTokenRecord>;
  /** Le magasin de refresh qui alimente `sessions` : même table mémoire, pour révoquer par famille. */
  readonly refreshStore: RefreshTokenStore;
  now(): number;
  advance(seconds: number): void;
  enrollTotp(userId: string): Promise<string>;
  addPasswordUser(userId: string, email: string): Promise<void>;
  totpCode(secret: string): Promise<string>;
}

export async function buildKit(): Promise<Kit> {
  let now = NOW;
  const factors = new Map<string, MfaFactorRecord>();
  const lastSteps = new Map<string, number>();
  const consumed = new Set<string>();
  const failures = new Map<string, number>();
  const refreshRows = new Map<string, RefreshTokenRecord>();
  const accountRows = new Map<string, { email: string; account: PasswordAccount }>();
  const issuedSessions: string[] = [];

  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  if (!('privateKey' in pair)) {
    throw new Error('génération Ed25519 impossible');
  }
  const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
  const refreshStore: RefreshTokenStore = {
    insert: async (record) => {
      refreshRows.set(record.tokenHash, record);
    },
    findByHash: async (hash) => refreshRows.get(hash) ?? null,
    markRotated: async (hash, at) => {
      const row = refreshRows.get(hash);
      if (row === undefined || row.rotatedAtEpochSec !== null) {
        return false;
      }
      refreshRows.set(hash, { ...row, rotatedAtEpochSec: at });
      return true;
    },
    revokeFamily: async (familyId, at) => {
      for (const [hash, row] of refreshRows) {
        if (row.familyId === familyId) {
          refreshRows.set(hash, { ...row, revokedAtEpochSec: at });
        }
      }
    },
  };
  const sessions = await createSessionService({
    privateJwk,
    issuer: 'https://api.fisca.ma',
    audience: 'fisca-api',
    nowEpochSec: () => now,
    refresh: {
      ttlSec: 30 * 24 * 3600,
      nowEpochSec: () => now,
      store: refreshStore,
    },
  });
  const recording: SessionService = {
    ...sessions,
    issueSession: async (grant) => {
      issuedSessions.push(`mfa:${grant.userId}`);
      return sessions.issueSession(grant);
    },
    issueFirstFactorSession: async (input) => {
      issuedSessions.push(`first:${input.userId}`);
      return sessions.issueFirstFactorSession(input);
    },
  };
  const mfa: MfaEngineDeps = {
    factors: {
      getFactor: async (userId) => factors.get(userId) ?? null,
      savePendingTotpSecret: async (userId, sealed) => {
        factors.set(userId, { sealedTotpSecret: sealed, totpVerifiedAtEpochSec: null, recoveryCodeHashes: [] });
      },
      activateTotp: async (userId, input) => {
        factors.set(userId, {
          sealedTotpSecret: factors.get(userId)?.sealedTotpSecret ?? null,
          totpVerifiedAtEpochSec: input.verifiedAtEpochSec,
          recoveryCodeHashes: input.recoveryCodeHashes,
        });
      },
      consumeRecoveryCodeHash: async () => false,
    },
    secretVault: { seal: async (_userId, secret) => `scelle:${secret}`, open: async (_userId, sealed) => sealed.replace('scelle:', '') },
    replay: {
      getLastUsedStep: async (userId) => lastSteps.get(userId) ?? null,
      advanceLastUsedStep: async (userId, step) => {
        const previous = lastSteps.get(userId);
        if (previous !== undefined && step <= previous) {
          return false;
        }
        lastSteps.set(userId, step);
        return true;
      },
    },
    challenges: {
      isConsumed: async (jti) => consumed.has(jti),
      consume: async (jti) => {
        if (consumed.has(jti)) {
          return false;
        }
        consumed.add(jti);
        return true;
      },
      failureCount: async (jti) => failures.get(jti) ?? 0,
      recordFailure: async (jti) => {
        const total = (failures.get(jti) ?? 0) + 1;
        failures.set(jti, total);
        return total;
      },
    },
    sessions: recording,
    signingKey: SIGNING_KEY,
    issuerName: 'Fisca',
    nowEpochSec: () => now,
  };
  const accounts: PasswordAccountStore = {
    findByEmailNormalized: async (email) => {
      for (const entry of accountRows.values()) {
        if (entry.email === email) {
          return entry.account;
        }
      }
      return null;
    },
    saveLockoutState: async (userId, state: LockoutState) => {
      const entry = accountRows.get(userId);
      if (entry !== undefined) {
        accountRows.set(userId, { email: entry.email, account: { ...entry.account, lockout: state } });
      }
    },
  };
  return {
    flow: { mfa, sessions: recording },
    mfa,
    sessions: recording,
    accounts,
    accountRows,
    issuedSessions,
    refreshRows,
    refreshStore,
    now: () => now,
    advance: (seconds) => {
      now += seconds;
    },
    totpCode: (secret) => generateTotpCodeRfc6238({ base32Secret: secret, nowEpochSec: now }),
    enrollTotp: async (userId) => {
      const setup = await setupTotp(mfa, { userId, accountLabel: `${userId}@example.ma` });
      await enableTotp(mfa, {
        userId,
        code: await generateTotpCodeRfc6238({ base32Secret: setup.secret, nowEpochSec: now }),
      });
      return setup.secret;
    },
    addPasswordUser: async (userId, email) => {
      accountRows.set(userId, {
        email,
        account: {
          userId,
          passwordHash: await LOW_COST_PASSWORD_SERVICE.hash(PASSWORD, PEPPER),
          lockout: { consecutiveFailures: 0, lockedUntilEpochMs: null },
        },
      });
    },
  };
}

export interface GoogleKit {
  readonly oauth: GoogleOAuthDeps;
  readonly transactions: Map<string, OAuthTransaction>;
  /** Associe le sub Google de test à un utilisateur existant (compte déjà lié). */
  linkSub(subject: string, userId: string): void;
}

export async function buildGoogleKit(): Promise<GoogleKit> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const transactions = new Map<string, OAuthTransaction>();
  const linked = new Map<string, string>();
  let created = 0;
  let lastNonce = '';
  const accounts: OAuthAccountRepository = {
    findOAuthAccount: async (_provider, subject) => {
      const userId = linked.get(subject);
      return userId === undefined ? null : { userId };
    },
    findUserByEmailNormalized: async () => null,
    createUserWithOAuthAccount: async () => {
      created += 1;
      return { userId: `nouveau-${created}` };
    },
    linkOAuthAccount: async () => undefined,
  };
  const oauth: GoogleOAuthDeps = {
    config: { clientId: CLIENT_ID, clientSecret: 'secret-factice', redirectUri: `https://auth.fisca.ma${CALLBACK_PATH}` },
    transactions: {
      save: async (tx) => {
        transactions.set(tx.state, tx);
        lastNonce = tx.nonce;
      },
      consume: async (state) => {
        const tx = transactions.get(state) ?? null;
        transactions.delete(state);
        if (tx !== null) {
          lastNonce = tx.nonce;
        }
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
              sub: 'sub-kit-1',
              email: 'nadia@example.ma',
              email_verified: true,
              name: 'Nadia',
              exp: NOW + 600,
              nonce: lastNonce,
            }),
          ),
        );
        const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(`${head}.${body}`));
        return { status: 200, body: { id_token: `${head}.${body}.${base64UrlEncode(new Uint8Array(sig))}` } };
      },
    },
    jwks: createJwksProvider(async () => ({ keys: [{ ...jwk, kid: KID }] })),
    accounts,
    pendingLinks: { save: async () => undefined, take: async () => null },
    emailProof: { sendLinkProof: async () => undefined },
    nowEpochSec: () => NOW,
  };
  return { oauth, transactions, linkSub: (subject, userId) => linked.set(subject, userId) };
}
