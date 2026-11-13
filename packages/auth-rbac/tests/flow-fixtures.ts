/** Fixtures de flux de connexion : ports en mémoire, session JWT EdDSA réelle, clés générées à la volée. */
import {
  createSessionService,
  enableTotp,
  generateTotpCodeRfc6238,
  hashPasswordWorkerSafe,
  setupTotp,
} from '../src/index.ts';
import type {
  FirstFactorDeps,
  LockoutState,
  MfaEngineDeps,
  MfaFactorRecord,
  PasswordAccount,
  PasswordAccountStore,
  RefreshTokenRecord,
  SessionService,
} from '../src/index.ts';
import { generateEd25519PrivateJwkJson } from './jwt-fixtures.ts';

export const NOW = 1_800_000_000;
export const PEPPER = 'pepper-factice-de-test';
export const PASSWORD = 'mot-de-passe-factice-12';
const SIGNING_KEY = 'cle-de-signature-factice-de-test-32-octets-minimum';

export interface FlowHarness {
  readonly flow: FirstFactorDeps;
  readonly sessions: SessionService;
  readonly accounts: PasswordAccountStore;
  readonly accountRows: Map<string, { email: string; account: PasswordAccount }>;
  readonly refreshRows: Map<string, RefreshTokenRecord>;
  readonly factors: Map<string, MfaFactorRecord>;
  readonly issuedSessions: string[];
  readonly requiredUsers: Set<string>;
  advance(seconds: number): void;
  now(): number;
  enrollTotp(userId: string): Promise<string>;
  addPasswordUser(userId: string, email: string, password?: string): Promise<void>;
}

export async function buildFlowHarness(): Promise<FlowHarness> {
  let now = NOW;
  const factors = new Map<string, MfaFactorRecord>();
  const lastSteps = new Map<string, number>();
  const consumed = new Set<string>();
  const failures = new Map<string, number>();
  const refreshRows = new Map<string, RefreshTokenRecord>();
  const accountRows = new Map<string, { email: string; account: PasswordAccount }>();
  const requiredUsers = new Set<string>();
  const issuedSessions: string[] = [];

  const sessions = await createSessionService({
    privateJwk: await generateEd25519PrivateJwkJson(),
    issuer: 'https://api.fisca.ma',
    audience: 'fisca-api',
    nowEpochSec: () => now,
    refresh: {
      ttlSec: 30 * 24 * 3600,
      nowEpochSec: () => now,
      store: {
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
      },
    },
  });

  const recordingSessions: SessionService = {
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
        const current = factors.get(userId);
        factors.set(userId, {
          sealedTotpSecret: current?.sealedTotpSecret ?? null,
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
    sessions: recordingSessions,
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

  const flow: FirstFactorDeps = {
    mfa,
    sessions: recordingSessions,
    policy: { isSecondFactorRequired: async (userId) => requiredUsers.has(userId) },
  };

  return {
    flow,
    sessions: recordingSessions,
    accounts,
    accountRows,
    refreshRows,
    factors,
    issuedSessions,
    requiredUsers,
    advance: (seconds) => {
      now += seconds;
    },
    now: () => now,
    enrollTotp: async (userId) => {
      const setup = await setupTotp(mfa, { userId, accountLabel: `${userId}@example.ma` });
      const code = await generateTotpCodeRfc6238({ base32Secret: setup.secret, nowEpochSec: now });
      await enableTotp(mfa, { userId, code });
      return setup.secret;
    },
    addPasswordUser: async (userId, email, password = PASSWORD) => {
      accountRows.set(userId, {
        email: email.trim().toLowerCase(),
        account: {
          userId,
          passwordHash: await hashPasswordWorkerSafe(password, PEPPER),
          lockout: { consecutiveFailures: 0, lockedUntilEpochMs: null },
        },
      });
    },
  };
}
