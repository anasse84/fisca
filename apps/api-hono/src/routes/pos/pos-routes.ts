/**
 * Colle des routes POS (ERRATA B-02) : authentification, base de la société et Idempotency-Key par le pipeline du socle ; ici RBAC/ABAC
 * (`evaluateAccessPolicy`), validation Zod stricte, appel de la logique du paquet `@fisca/ubl-xades/pos`, traduction des erreurs typées
 * en ProblemDetails. Toutes les dépendances externes sont des ports injectés (`PosRoutesDeps`).
 *
 * - POST /api/v1/pos/sync-batch (CTR-API-16) : JWT + `X-Fisca-Company-Id` (D-16) + Idempotency-Key ; le terminal s'authentifie en
 *   outre par SA SIGNATURE ECDSA P-256 sur chaque ticket (clé publique de son certificat/licence, port `PosTerminalDirectory`).
 *   Réponse : 200 si tous les tickets sont acquittés (acceptés ou rejoués), 207 multi-statut si au moins un est rejeté (résultats
 *   par ticket avec code), 409 si conflit (rien d'écrit). Doc_07 § 03 ne fixe pas le code HTTP : choix du dépôt, à confirmer.
 * - POST /api/v1/public/pos-qr/:qrToken/convert-b2b (CTR-API-17) : publique, montée AVANT le pipeline (voir public-convert.ts).
 * Permission du lot : `POS_ENCASH_TICKET` (le plus proche de l'encaissement hors ligne ; aucune permission dédiée à la synchronisation
 * dans auth-rbac, gelé : SEAM_REQUEST au rapport).
 */
import { evaluateAccessPolicy, type AuthorizationContext, type PermissionAction } from '@fisca/auth-rbac';
import { createSqlPosSyncStore, syncPosBatch, type PosTerminalDirectory, type PosVatRulesPort } from '@fisca/ubl-xades/pos';
import { Hono } from 'hono';
import { effectivePayrollPiiClearance, type LedgerActorProfileSource } from '../../core/ledger-api.ts';
import { PolicyDenialError } from '../../core/problem-details.ts';
import { createRequestPipeline, type RequestPipelineDeps } from '../../core/request-pipeline.ts';
import { parseWithSchema, readJsonBody } from '../../core/request-validation.ts';
import type { PipelineEnv, TenantContext } from '../../core/tenant-router.ts';
import { resolveV1RoutePolicy } from '../../core/v1-route-policies.ts';
import { createSyncBatchRequestSchema, SyncBatchResponseSchema } from './pos-route-schemas.ts';
import { createPublicPosConvertRoute, type PublicPosConvertDeps } from './public-convert.ts';
import { translatedPos } from './problems.ts';

/** Ports externes de synchronisation pour la société de la requête (licence du terminal et règles fiscales datées). */
export interface PosSyncExternalPorts {
  readonly terminals: PosTerminalDirectory;
  readonly vatRules: PosVatRulesPort;
}

export interface PosRoutesDeps {
  /** Tout le pipeline sauf la politique de route, fixée par `resolveV1RoutePolicy`. */
  readonly pipeline: Omit<RequestPipelineDeps, 'routePolicy'>;
  readonly syncPortsFor: (tenant: TenantContext) => PosSyncExternalPorts | Promise<PosSyncExternalPorts>;
  readonly actorProfiles: LedgerActorProfileSource;
  readonly clock: { nowMs(): number; nowIso(): string };
  /** Taille maximale d'un lot (Doc_07 § 03 : 200) : paramètre de déploiement. */
  readonly maxBatchSize: number;
  readonly publicConvert: PublicPosConvertDeps;
}

export function createPosPublicRoutes(deps: PublicPosConvertDeps): Hono<PipelineEnv> {
  const app = new Hono<PipelineEnv>();
  app.route('/', createPublicPosConvertRoute(deps));
  return app;
}

export function createPosRoutes(deps: PosRoutesDeps): Hono<PipelineEnv> {
  if (!Number.isSafeInteger(deps.maxBatchSize) || deps.maxBatchSize < 1) throw new Error('maxBatchSize doit être un entier strictement positif.');
  const requestSchema = createSyncBatchRequestSchema(deps.maxBatchSize);
  const app = new Hono<PipelineEnv>();
  app.route('/', createPublicPosConvertRoute(deps.publicConvert));
  createRequestPipeline({ ...deps.pipeline, routePolicy: resolveV1RoutePolicy }).applyTo(app, '/api/v1/*');

  async function authorize(
    c: { get(key: 'tenant'): TenantContext | undefined; get(key: 'auth'): { readonly mfaVerifiedAtEpochSec?: number | null } | undefined; get(key: 'entitlements'): { readonly readOnly: boolean } | undefined },
    action: PermissionAction,
  ): Promise<TenantContext> {
    const tenant = c.get('tenant');
    const auth = c.get('auth');
    if (tenant === undefined || auth === undefined) throw new Error('contexte de requête incomplet : le pipeline doit précéder la route.');
    if (tenant.permissionCeiling !== null && !tenant.permissionCeiling.has(action)) throw new PolicyDenialError(`RBAC_FORBIDDEN_FOR_${tenant.role}`, tenant.role);
    const profile = await deps.actorProfiles.resolve(tenant);
    const mfa = auth.mfaVerifiedAtEpochSec;
    const context: AuthorizationContext = {
      actorId: tenant.userId,
      role: tenant.role,
      companyId: tenant.companyId,
      assignedCompanyIds: [tenant.companyId],
      orgPlanSegment: profile.orgPlanSegment,
      activeHumanMembersCount: profile.activeHumanMembersCount,
      subscriptionReadOnly: c.get('entitlements')?.readOnly ?? true,
      fiscalYearClosed: false,
      canAccessPayrollPii: effectivePayrollPiiClearance(tenant.canAccessPayrollPii, profile.canAccessPayrollPii),
      mfaVerifiedAtEpochSec: mfa === null || mfa === undefined ? undefined : mfa,
      nowEpochSec: Number(BigInt(deps.clock.nowMs()) / 1000n),
    };
    const decision = evaluateAccessPolicy(action, context);
    if (!decision.allowed) throw new PolicyDenialError(decision.denialCode, tenant.role);
    return tenant;
  }

  app.post('/api/v1/pos/sync-batch', async (c) => {
    const body = parseWithSchema(requestSchema, await readJsonBody(() => c.req.text()));
    const tenant = await authorize(c, 'POS_ENCASH_TICKET');
    const external = await deps.syncPortsFor(tenant);
    const result = await translatedPos(() =>
      syncPosBatch(
        { store: createSqlPosSyncStore(tenant.tenantDb), terminals: external.terminals, vatRules: external.vatRules, clock: deps.clock },
        { companyId: tenant.companyId, terminalId: body.terminalId, tickets: body.tickets },
      ),
    );
    const payload = SyncBatchResponseSchema.parse({
      terminalId: result.terminalId,
      syncedAt: result.syncedAtIso,
      accepted: result.accepted,
      replayed: result.replayed,
      rejected: result.rejected,
      results: result.results.map((r) => ({ ticketId: r.ticketId, terminalSeqNumber: r.terminalSeqNumber, outcome: r.outcome, ...(r.code === undefined ? {} : { code: r.code }) })),
    });
    return c.json(payload, result.rejected === 0 ? 200 : 207);
  });

  return app;
}
