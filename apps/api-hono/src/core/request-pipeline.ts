/**
 * Composition du pipeline de requêtes de apps/api-hono (ticket T-S1B-11).
 *
 * Ordre : id de trace → onError → authentification → TenantRouter → EntitlementGuard → Idempotency. La colle des routes
 * (T-S1B-12) appelle `pipeline.applyTo(app, '/api/v1/*')` ; les routes publiques (login, santé) se montent hors de ce préfixe.
 */
import type { Hono, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createEntitlementGuard, type EntitlementSource, type FastKv } from './entitlement-guard.ts';
import { createIdempotencyMiddleware, type IdempotencyStore } from './idempotency.ts';
import {
  createProblemErrorHandler,
  createProblemNotFoundHandler,
  newTraceId,
  traceIdFromRequest,
  type InternalErrorReport,
  type TraceContext,
} from './problem-details.ts';
import type { CpaMandatePresence, MandateResolver, TenantKeyGrantReader } from './mandate-resolver.ts';
import {
  createAuthenticationMiddleware,
  createTenantRouter,
  type MembershipResolver,
  type PipelineEnv,
  type RoutePolicyResolver,
  type SessionAuthenticator,
  type TenantDatabaseProvider,
} from './tenant-router.ts';

export interface RequestPipelineDeps {
  readonly authenticator: SessionAuthenticator;
  readonly routePolicy: RoutePolicyResolver;
  readonly memberships: MembershipResolver;
  /** Absent : échec fermé, aucun accès cabinet (mandat OEC). */
  readonly mandates?: MandateResolver;
  readonly tenants: TenantDatabaseProvider;
  /** Absent : échec fermé, tout accès par mandat à un dossier ZERO_KNOWLEDGE_E2EE est refusé (voie C). */
  readonly keyGrants?: TenantKeyGrantReader;
  /** Absent : présence d'un mandat cabinet inconnue pour une appartenance directe (défaut sûr : visa du chef exigé). */
  readonly cpaMandatePresence?: CpaMandatePresence;
  readonly entitlements: { readonly source: EntitlementSource; readonly kv: FastKv; readonly cacheTtlSec: number };
  readonly idempotencyStore: IdempotencyStore;
  readonly nowMs: () => number;
  readonly newTraceId?: () => string;
  /** Reçoit seulement (traceId, nom de classe) d'une erreur interne : jamais de message ni de pile. */
  readonly reportInternalError?: (report: InternalErrorReport) => void;
}

export type PipelineStageName = 'trace' | 'authentication' | 'tenant-router' | 'entitlement-guard' | 'idempotency';

export interface PipelineStage {
  readonly name: PipelineStageName;
  readonly handler: MiddlewareHandler<PipelineEnv>;
}

export interface RequestPipeline {
  /** Middlewares dans l'ordre d'exécution (onError est enregistré à part par `applyTo`). */
  readonly stages: readonly PipelineStage[];
  readonly onError: (error: Error, c: TraceContext) => Response;
  readonly notFound: (c: TraceContext) => Response;
  applyTo(app: Hono<PipelineEnv>, path: string): void;
}

export function createRequestPipeline(deps: RequestPipelineDeps): RequestPipeline {
  const generate = deps.newTraceId ?? newTraceId;
  const stages: readonly PipelineStage[] = [
    {
      name: 'trace',
      handler: createMiddleware<PipelineEnv>(async (c, next) => {
        c.set('traceId', traceIdFromRequest(c.req.header('traceparent'), generate));
        await next();
      }),
    },
    { name: 'authentication', handler: createAuthenticationMiddleware({ authenticator: deps.authenticator }) },
    {
      name: 'tenant-router',
      handler: createTenantRouter({
        routePolicy: deps.routePolicy,
        memberships: deps.memberships,
        ...(deps.mandates === undefined ? {} : { mandates: deps.mandates }),
        tenants: deps.tenants,
        ...(deps.keyGrants === undefined ? {} : { keyGrants: deps.keyGrants }),
        ...(deps.cpaMandatePresence === undefined ? {} : { cpaMandatePresence: deps.cpaMandatePresence }),
      }),
    },
    {
      name: 'entitlement-guard',
      handler: createEntitlementGuard({
        source: deps.entitlements.source,
        kv: deps.entitlements.kv,
        nowMs: deps.nowMs,
        cacheTtlSec: deps.entitlements.cacheTtlSec,
      }),
    },
    { name: 'idempotency', handler: createIdempotencyMiddleware({ store: deps.idempotencyStore, nowMs: deps.nowMs }) },
  ];
  const onError = createProblemErrorHandler(deps.reportInternalError === undefined ? {} : { reportInternalError: deps.reportInternalError });
  const notFound = createProblemNotFoundHandler();
  return {
    stages,
    onError,
    notFound,
    applyTo: (app, path) => {
      app.onError(onError);
      app.notFound(notFound);
      for (const stage of stages) {
        app.use(path, stage.handler);
      }
    },
  };
}
