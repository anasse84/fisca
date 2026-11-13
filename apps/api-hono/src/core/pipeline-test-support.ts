/**
 * Doubles de test du pipeline de requêtes (code de test uniquement, jamais importé par le code de production) :
 * KV en mémoire, résolveurs d'appartenance et de droits modifiables, fournisseur de base, JWT EdDSA réels.
 */
import {
  issueAccessToken,
  loadSessionSigningKeys,
  verifyAccessToken,
  type AccessTokenClaims,
  type RoleCode,
  type SessionSigningKeys,
} from '@fisca/auth-rbac';
import type { BatchResult, TenantSqlDriver } from '@fisca/shared-types';
import type { EntitlementRows, EntitlementSource, FastKv } from './entitlement-guard.ts';
import type { MandateAccess, MandateResolver } from './mandate-resolver.ts';
import type { MembershipAccess, MembershipResolver, TenantDatabaseProvider } from './tenant-router.ts';

/** Doc_07 § 01 : `X-Fisca-Company-Id` est un UUIDv7 (validé à la frontière HTTP). */
export const COMPANY_A = '018f3b5e-7c2a-7d3e-8a1b-00000000a001';
export const COMPANY_B = '018f3b5e-7c2a-7d3e-8a1b-00000000b002';
export const COMPANY_C = '018f3b5e-7c2a-7d3e-8a1b-00000000c003';
export const ORG_1 = 'org-1';
export const USER_1 = 'user-1';
export const USER_2 = 'user-2';
export const JWT_ISSUER = 'https://fisca.test';
export const JWT_AUDIENCE = 'fisca-api';
export const T0_MS = 1_800_000_000_000;

export interface TestClock {
  nowMs(): number;
  advanceMs(delta: number): void;
}

export function createTestClock(startMs: number = T0_MS): TestClock {
  let current = startMs;
  return {
    nowMs: () => current,
    advanceMs: (delta) => {
      current += delta;
    },
  };
}

export interface FakeKv extends FastKv {
  readonly store: Map<string, { value: string; expiresAtMs: number | null }>;
  readonly counters: { gets: number; puts: number; deletes: number };
  failGets: boolean;
  failPuts: boolean;
}

/** KV en mémoire à expiration : met en œuvre `expirationTtl` avec l'horloge de test. */
export function createFakeKv(clock: TestClock): FakeKv {
  const store = new Map<string, { value: string; expiresAtMs: number | null }>();
  const counters = { gets: 0, puts: 0, deletes: 0 };
  const kv: FakeKv = {
    store,
    counters,
    failGets: false,
    failPuts: false,
    get: async (key) => {
      counters.gets += 1;
      if (kv.failGets) {
        throw new Error('KV indisponible (secret-kv-detail)');
      }
      const entry = store.get(key);
      if (entry === undefined) {
        return null;
      }
      if (entry.expiresAtMs !== null && clock.nowMs() >= entry.expiresAtMs) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    put: async (key, value, options) => {
      counters.puts += 1;
      if (kv.failPuts) {
        throw new Error('KV écriture refusée');
      }
      store.set(key, { value, expiresAtMs: clock.nowMs() + options.expirationTtl * 1000 });
    },
    delete: async (key) => {
      counters.deletes += 1;
      store.delete(key);
    },
  };
  return kv;
}

export interface FakeMemberships extends MembershipResolver {
  readonly grants: Map<string, MembershipAccess>;
  readonly calls: { userId: string; companyId: string }[];
  failing: boolean;
}

export function membershipKey(userId: string, companyId: string): string {
  return `${userId}|${companyId}`;
}

export function createFakeMemberships(): FakeMemberships {
  const grants = new Map<string, MembershipAccess>();
  const calls: { userId: string; companyId: string }[] = [];
  const resolver: FakeMemberships = {
    grants,
    calls,
    failing: false,
    resolveAccess: async (query) => {
      calls.push({ userId: query.userId, companyId: query.companyId });
      if (resolver.failing) {
        throw new Error('plan de contrôle injoignable (select * from organization_memberships)');
      }
      return grants.get(membershipKey(query.userId, query.companyId)) ?? null;
    },
  };
  return resolver;
}

export function grant(
  memberships: FakeMemberships,
  userId: string,
  companyId: string,
  role: RoleCode = 'OWNER_GERANT',
  overrides: Partial<MembershipAccess> = {},
): void {
  memberships.grants.set(membershipKey(userId, companyId), {
    organizationId: ORG_1,
    role,
    accessKind: 'MEMBERSHIP',
    planCode: 'PLAN_TEST',
    ...overrides,
  });
}

/**
 * Pilote SIMULÉ du port `MandateResolver` (tests uniquement) : mandats actifs en mémoire, révocation par suppression.
 * Jamais câblé en production, où l'absence de résolveur refuse tout accès cabinet.
 */
export interface FakeMandates extends MandateResolver {
  readonly mandates: Map<string, MandateAccess>;
  readonly calls: { userId: string; companyId: string }[];
  failing: boolean;
}

export function createFakeMandates(): FakeMandates {
  const mandates = new Map<string, MandateAccess>();
  const calls: { userId: string; companyId: string }[] = [];
  const resolver: FakeMandates = {
    mandates,
    calls,
    failing: false,
    resolveMandate: async (query) => {
      calls.push({ userId: query.userId, companyId: query.companyId });
      if (resolver.failing) {
        throw new Error('tenant_key_grants injoignable (select * from tenant_key_grants)');
      }
      return mandates.get(membershipKey(query.userId, query.companyId)) ?? null;
    },
  };
  return resolver;
}

export function grantMandate(mandates: FakeMandates, userId: string, companyId: string, role: RoleCode = 'EXPERT_COMPTABLE_OEC', overrides: Partial<MandateAccess> = {}): void {
  mandates.mandates.set(membershipKey(userId, companyId), { organizationId: 'org-client', role, planCode: 'PLAN_TEST', ...overrides });
}

export interface FakeTenants extends TenantDatabaseProvider {
  readonly requested: string[];
  readonly drivers: Map<string, TenantSqlDriver>;
  failWith: Error | null;
}

export function createFakeDriver(tenantId: string): TenantSqlDriver {
  return {
    tenantId,
    query: async <TRow>(): Promise<readonly TRow[]> => [],
    executeBatchAtomically: async (): Promise<BatchResult> => ({ totalChanges: 0 }),
  };
}

export function createFakeTenants(companyIds: readonly string[]): FakeTenants {
  const drivers = new Map<string, TenantSqlDriver>(companyIds.map((id) => [id, createFakeDriver(id)]));
  const requested: string[] = [];
  const provider: FakeTenants = {
    requested,
    drivers,
    failWith: null,
    getTenantDbUpToDate: async (companyId) => {
      requested.push(companyId);
      if (provider.failWith !== null) {
        throw provider.failWith;
      }
      const driver = drivers.get(companyId);
      if (driver === undefined) {
        throw new Error('base inconnue');
      }
      return driver;
    },
  };
  return provider;
}

export interface FakeEntitlements extends EntitlementSource {
  rows: EntitlementRows | null;
  loads: number;
  failing: boolean;
}

export function createFakeEntitlements(rows: EntitlementRows | null): FakeEntitlements {
  const source: FakeEntitlements = {
    rows,
    loads: 0,
    failing: false,
    load: async () => {
      source.loads += 1;
      if (source.failing) {
        throw new Error('select * from subscriptions : panne');
      }
      return source.rows;
    },
  };
  return source;
}

export function activeRows(featureKeys: readonly string[], overrides: Partial<EntitlementRows> = {}): EntitlementRows {
  return {
    planCode: 'PLAN_TEST',
    subscriptionStatus: 'ACTIVE_PAID',
    graceEndsAt: null,
    entitlements: featureKeys.map((featureKey) => ({ featureKey, boolValue: true, numericLimit: null })),
    ...overrides,
  };
}

export interface TestJwt {
  readonly keys: SessionSigningKeys;
  issue(userId: string, nowEpochSec: number): Promise<string>;
  verify(token: string, nowEpochSec: number): Promise<AccessTokenClaims>;
}

export async function createTestJwt(): Promise<TestJwt> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  if (!('privateKey' in pair)) {
    throw new Error('paire de clés Ed25519 attendue');
  }
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const keys = await loadSessionSigningKeys(JSON.stringify(jwk));
  return {
    keys,
    issue: async (userId, nowEpochSec) =>
      (
        await issueAccessToken({
          keys,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          userId,
          sessionId: 'sid-1',
          amr: ['pwd', 'otp'],
          mfaVerifiedAtEpochSec: nowEpochSec,
          nowEpochSec,
        })
      ).token,
    verify: (token, nowEpochSec) =>
      verifyAccessToken({ token, keys, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, nowEpochSec }),
  };
}
