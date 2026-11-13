/**
 * Colle des routes du socle comptable (ERRATA B-02) : aucune logique métier, aucune dépendance tierce hors Hono.
 * Routes du registre `fisca_contracts_registry` :
 * - GET /api/v1/directory/ice/:ice (CTR-API-10) ;
 * - POST /api/v1/ledger/entries/:id/post (CTR-API-11) ;
 * - POST /api/v1/banking/reconcile (CTR-API-12) ;
 * - GET /api/v1/health/deep (CTR-API-13, logique dans src/core/health-deep.ts, route publique montée avant le pipeline).
 * Le pipeline (authentification, TenantRouter, EntitlementGuard, Idempotency, RFC 9457) s'applique à `/api/v1/*`.
 */
import { Hono } from 'hono';
import { contractOf } from '../../core/api-v1-contracts.ts';
import {
  IceLookupResponseSchema,
  IceParamSchema,
  LedgerEntryParamSchema,
  PostEntryRequestSchema,
  PostEntryResponseSchema,
  ReconcileRequestSchema,
  ReconcileResponseSchema,
} from '../../core/api-v1-schemas.ts';
import type { CompanyDirectory } from '../../core/company-directory.ts';
import { createHealthDeepRoute, type HealthDeepDeps } from '../../core/health-deep.ts';
import { IDEMPOTENCY_KEY_HEADER } from '../../core/idempotency.ts';
import type { LedgerApi, LedgerCall } from '../../core/ledger-api.ts';
import { ProblemError } from '../../core/problem-details.ts';
import { createRequestPipeline, type RequestPipelineDeps } from '../../core/request-pipeline.ts';
import { parseWithSchema, readJsonBody } from '../../core/request-validation.ts';
import type { PipelineEnv } from '../../core/tenant-router.ts';
import { resolveV1RoutePolicy } from '../../core/v1-route-policies.ts';

export interface LedgerRoutesDeps {
  /** Tout le pipeline sauf la politique de route, fixée par `resolveV1RoutePolicy`. */
  readonly pipeline: Omit<RequestPipelineDeps, 'routePolicy'>;
  readonly directory: CompanyDirectory;
  readonly ledger: LedgerApi;
  readonly health: HealthDeepDeps;
}

const ICE_NOT_FOUND = {
  status: 404,
  errorCode: 'DIRECTORY_ICE_NOT_FOUND',
  title: 'ICE introuvable',
  detail: "Cet ICE n'est pas présent dans l'annuaire.",
} as const;

export function createLedgerRoutes(deps: LedgerRoutesDeps): Hono<PipelineEnv> {
  const app = new Hono<PipelineEnv>();
  app.route('/', createHealthDeepRoute(deps.health));
  createRequestPipeline({ ...deps.pipeline, routePolicy: resolveV1RoutePolicy }).applyTo(app, '/api/v1/*');

  const icePath = contractOf('CTR-API-10').path;
  const postPath = contractOf('CTR-API-11').path;
  const reconcilePath = contractOf('CTR-API-12').path;

  function callOf(c: { get(key: 'tenant'): LedgerCall['tenant'] | undefined; get(key: 'auth'): LedgerCall['auth'] | undefined; get(key: 'entitlements'): { readonly readOnly: boolean } | undefined }): LedgerCall {
    const tenant = c.get('tenant');
    const auth = c.get('auth');
    if (tenant === undefined || auth === undefined) {
      throw new Error('contexte de requête incomplet : le pipeline doit précéder la route.');
    }
    return { tenant, auth, subscriptionReadOnly: c.get('entitlements')?.readOnly ?? true };
  }

  function idempotencyKeyOf(header: string | undefined): string {
    if (header === undefined) {
      throw new Error('Idempotency-Key absent : le middleware d\'idempotence doit précéder la route.');
    }
    return header;
  }

  app.get(icePath, async (c) => {
    const { ice: iceValue } = parseWithSchema(IceParamSchema, c.req.param());
    const company = await deps.directory.findByIce(iceValue);
    if (company === null) {
      throw new ProblemError(ICE_NOT_FOUND);
    }
    return c.json(IceLookupResponseSchema.parse(company));
  });

  app.post(postPath, async (c) => {
    const params = parseWithSchema(LedgerEntryParamSchema, c.req.param());
    const body = parseWithSchema(PostEntryRequestSchema, await readJsonBody(() => c.req.text()));
    const result = PostEntryResponseSchema.parse(
      await deps.ledger.postEntry(callOf(c), { entryId: params.id, body, idempotencyKey: idempotencyKeyOf(c.req.header(IDEMPOTENCY_KEY_HEADER)) }),
    );
    return c.json(result, result.action === 'REVERSE' ? 201 : 200);
  });

  app.post(reconcilePath, async (c) => {
    const body = parseWithSchema(ReconcileRequestSchema, await readJsonBody(() => c.req.text()));
    const result = ReconcileResponseSchema.parse(await deps.ledger.reconcile(callOf(c), body));
    return c.json(result, result.outcome === 'MATCHED_FULL' || result.outcome === 'MATCHED_PARTIAL' ? 201 : 200);
  });

  return app;
}
