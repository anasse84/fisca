/**
 * EntitlementGuard (ticket T-S1B-11 ; Doc_03 § 07, § 09, § 10 ; Doc_09 § 07 « Sanctuarisation légale »).
 *
 * Aucun plan, prix ni seuil n'est codé ici : le verdict vient des lignes lues (`subscriptions`, `plan_entitlements`) via le port
 * `EntitlementSource`, avec un cache sur le binding FISCA_FAST_KV (CTR-BND-03) de durée bornée et invalidable
 * (`invalidateEntitlementCache`, appelé par le webhook de réactivation Payzone / SIMT).
 *
 * Lecture seule : RESTRICTED_READ_ONLY, CANCELED_WORM_PRESERVED, et PAST_DUE_GRACE_14D une fois `grace_ends_at` dépassé (ou
 * illisible : échec fermé) bloquent POST/PUT/PATCH/DELETE et tout appel IA/MCP, SAUF les routes marquées `legalExport`
 * (export décennal Art. 211 CGI). Les lectures restent ouvertes.
 */
import { createMiddleware } from 'hono/factory';
import { SUBSCRIPTION_STATUSES } from '@fisca/db-schema';
import { respondProblem, type ProblemInput } from './problem-details.ts';
import type { PipelineEnv } from './tenant-router.ts';

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface EntitlementRow {
  readonly featureKey: string;
  readonly boolValue: boolean;
  readonly numericLimit: number | null;
}

/** Lignes lues pour une organisation : `subscriptions` joint à `plan_entitlements` sur `plan_code`. */
export interface EntitlementRows {
  readonly planCode: string;
  readonly subscriptionStatus: SubscriptionStatus;
  /** `subscriptions.grace_ends_at` (ISO 8601 ou AAAA-MM-JJ), tel que lu. */
  readonly graceEndsAt: string | null;
  readonly entitlements: readonly EntitlementRow[];
}

export interface EntitlementSource {
  /** null si l'organisation n'a aucun abonnement. */
  load(organizationId: string): Promise<EntitlementRows | null>;
}

/** Sous-ensemble minimal de KVNamespace (Cloudflare Workers) : le binding FISCA_FAST_KV le satisfait. */
export interface FastKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { readonly expirationTtl: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Plancher d'`expirationTtl` imposé par Cloudflare KV ; plafond technique du cache de droits. */
export const ENTITLEMENT_CACHE_MIN_TTL_SEC = 60 as const;
export const ENTITLEMENT_CACHE_MAX_TTL_SEC = 3600 as const;
const CACHE_VERSION = 1;
const MUTATION_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function entitlementCacheKey(organizationId: string): string {
  return `entitlements:v${CACHE_VERSION}:${organizationId}`;
}

/** Invalidation prévue : à appeler quand l'abonnement ou la matrice du plan change (réactivation, changement de plan). */
export async function invalidateEntitlementCache(kv: FastKv, organizationId: string): Promise<void> {
  await kv.delete(entitlementCacheKey(organizationId));
}

interface EntitlementSnapshot {
  readonly planCode: string;
  readonly subscriptionStatus: SubscriptionStatus;
  readonly graceEndsAtMs: number | null;
  readonly enabledFeatures: readonly string[];
}

interface CachedSnapshot {
  readonly v: number;
  readonly cachedAtMs: number;
  readonly snapshot: EntitlementSnapshot;
}

function isStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === 'string' && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCached(raw: string): CachedSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['v'] !== CACHE_VERSION || typeof parsed['cachedAtMs'] !== 'number' || !Number.isFinite(parsed['cachedAtMs'])) {
    return null;
  }
  const snapshot = parsed['snapshot'];
  if (!isRecord(snapshot)) {
    return null;
  }
  const { planCode, subscriptionStatus, graceEndsAtMs, enabledFeatures } = snapshot;
  const graceValid = graceEndsAtMs === null || (typeof graceEndsAtMs === 'number' && Number.isFinite(graceEndsAtMs));
  if (
    typeof planCode !== 'string' ||
    !isStatus(subscriptionStatus) ||
    !graceValid ||
    !Array.isArray(enabledFeatures) ||
    !enabledFeatures.every((item): item is string => typeof item === 'string')
  ) {
    return null;
  }
  return {
    v: CACHE_VERSION,
    cachedAtMs: parsed['cachedAtMs'],
    snapshot: { planCode, subscriptionStatus, graceEndsAtMs: graceEndsAtMs === null ? null : Number(graceEndsAtMs), enabledFeatures },
  };
}

function toSnapshot(rows: EntitlementRows): EntitlementSnapshot {
  const grace = rows.graceEndsAt === null ? Number.NaN : Date.parse(rows.graceEndsAt);
  return {
    planCode: rows.planCode,
    subscriptionStatus: rows.subscriptionStatus,
    graceEndsAtMs: Number.isNaN(grace) ? null : grace,
    enabledFeatures: rows.entitlements.filter((row) => row.boolValue).map((row) => row.featureKey),
  };
}

/** Lecture seule effective à l'instant `nowMs` ; une date de grâce absente ou illisible bloque (échec fermé). */
export function isReadOnlyAt(snapshot: Pick<EntitlementSnapshot, 'subscriptionStatus' | 'graceEndsAtMs'>, nowMs: number): boolean {
  switch (snapshot.subscriptionStatus) {
    case 'RESTRICTED_READ_ONLY':
    case 'CANCELED_WORM_PRESERVED':
      return true;
    case 'PAST_DUE_GRACE_14D':
      return snapshot.graceEndsAtMs === null || nowMs > snapshot.graceEndsAtMs;
    case 'TRIAL_SANDBOX_14D':
    case 'ACTIVE_PAID':
      return false;
  }
}

const READ_ONLY_PROBLEM: ProblemInput = {
  status: 403,
  errorCode: 'ENTITLEMENT_READ_ONLY_MODE',
  title: 'Abonnement en lecture seule',
  detail: 'Régularisez votre abonnement pour créer ou modifier des pièces. La consultation et l’export décennal restent ouverts.',
  legalRef: 'CGI art. 211',
};
const UPGRADE_PROBLEM: ProblemInput = {
  status: 403,
  errorCode: 'ENTITLEMENT_UPGRADE_REQUIRED',
  title: 'Forfait insuffisant',
  detail: "La fonctionnalité demandée requiert un forfait supérieur.",
};
const SUBSCRIPTION_MISSING_PROBLEM: ProblemInput = {
  status: 403,
  errorCode: 'ENTITLEMENT_SUBSCRIPTION_MISSING',
  title: 'Abonnement introuvable',
  detail: "Aucun abonnement actif n'est associé à ce dossier.",
};
const UNAVAILABLE_PROBLEM: ProblemInput = {
  status: 503,
  errorCode: 'ENTITLEMENT_UNAVAILABLE',
  title: 'Droits momentanément indisponibles',
  detail: 'Les droits du forfait ne peuvent pas être vérifiés pour le moment, réessayez plus tard.',
};

export interface EntitlementGuardDeps {
  readonly source: EntitlementSource;
  readonly kv: FastKv;
  /** Horloge injectée (millisecondes epoch). */
  readonly nowMs: () => number;
  /** Durée de vie du cache, en secondes, entre ENTITLEMENT_CACHE_MIN_TTL_SEC et ENTITLEMENT_CACHE_MAX_TTL_SEC. */
  readonly cacheTtlSec: number;
}

async function readCache(kv: FastKv, organizationId: string, nowMs: number, ttlSec: number): Promise<EntitlementSnapshot | null> {
  let raw: string | null;
  try {
    raw = await kv.get(entitlementCacheKey(organizationId));
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  const cached = parseCached(raw);
  if (cached === null) {
    return null;
  }
  const ageMs = nowMs - cached.cachedAtMs;
  return ageMs >= 0 && ageMs < ttlSec * 1000 ? cached.snapshot : null;
}

async function writeCache(kv: FastKv, organizationId: string, nowMs: number, ttlSec: number, snapshot: EntitlementSnapshot): Promise<void> {
  const entry: CachedSnapshot = { v: CACHE_VERSION, cachedAtMs: nowMs, snapshot };
  try {
    await kv.put(entitlementCacheKey(organizationId), JSON.stringify(entry), { expirationTtl: ttlSec });
  } catch {
    // le cache est un accélérateur : la source reste la vérité.
  }
}

export function createEntitlementGuard(deps: EntitlementGuardDeps) {
  const ttlSec = deps.cacheTtlSec;
  if (!Number.isInteger(ttlSec) || ttlSec < ENTITLEMENT_CACHE_MIN_TTL_SEC || ttlSec > ENTITLEMENT_CACHE_MAX_TTL_SEC) {
    throw new RangeError(`cacheTtlSec doit être un entier entre ${ENTITLEMENT_CACHE_MIN_TTL_SEC} et ${ENTITLEMENT_CACHE_MAX_TTL_SEC}.`);
  }
  return createMiddleware<PipelineEnv>(async (c, next) => {
    const policy = c.get('routePolicy');
    if (policy === undefined) {
      throw new Error('EntitlementGuard : routePolicy absent, TenantRouter doit le précéder.');
    }
    if (policy.tenantScope === 'NONE') {
      await next();
      return undefined;
    }
    const tenant = c.get('tenant');
    if (tenant === undefined) {
      throw new Error('EntitlementGuard : tenant absent, TenantRouter doit le précéder.');
    }

    const now = deps.nowMs();
    let snapshot = await readCache(deps.kv, tenant.organizationId, now, ttlSec);
    if (snapshot === null) {
      let rows: EntitlementRows | null;
      try {
        rows = await deps.source.load(tenant.organizationId);
      } catch {
        return respondProblem(c, UNAVAILABLE_PROBLEM);
      }
      if (rows === null) {
        return respondProblem(c, SUBSCRIPTION_MISSING_PROBLEM);
      }
      snapshot = toSnapshot(rows);
      await writeCache(deps.kv, tenant.organizationId, now, ttlSec, snapshot);
    }

    const readOnly = isReadOnlyAt(snapshot, now);
    c.set('entitlements', Object.freeze({ planCode: snapshot.planCode, subscriptionStatus: snapshot.subscriptionStatus, readOnly }));
    if (policy.legalExport) {
      await next();
      return undefined;
    }
    const isMutation = MUTATION_METHODS.has(c.req.method.toUpperCase()) || policy.audience === 'AI_MCP';
    if (readOnly && isMutation) {
      return respondProblem(c, READ_ONLY_PROBLEM);
    }
    if (policy.featureKey !== null && !snapshot.enabledFeatures.includes(policy.featureKey)) {
      return respondProblem(c, UPGRADE_PROBLEM);
    }
    await next();
    return undefined;
  });
}
