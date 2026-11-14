/**
 * Colle des routes invoices (ERRATA B-02) : authentification, base de la société et Idempotency-Key par le pipeline du socle ;
 * ici RBAC/ABAC + Step-Up (`evaluateAccessPolicy`), validation Zod, appel de la logique du paquet @fisca/ubl-xades/certify,
 * traduction des erreurs typées en ProblemDetails. Toutes les dépendances externes sont des ports injectés (`InvoicesRoutesDeps`).
 *
 * - POST /api/v1/invoices/:id/certify (CTR-API-14) ; POST /api/v1/invoices/:id/cdv-response (CTR-API-15) ;
 * - GET /api/v1/public/verify/:xhubUuid (CTR-API-18) : publique, montée AVANT le pipeline (aucun JWT, aucun abonnement lu).
 * Permission : `INVOICE_CERTIFY_XHUB` (Gérant, Commercial facturation, Step-Up 300 s) pour certify ET cdv-response (aucune permission
 * dédiée au CDV dans auth-rbac, gelé : la plus proche est utilisée, SEAM_REQUEST au rapport).
 */
import {
  evaluateAccessPolicy,
  type AuthorizationContext,
  type PermissionAction,
} from '@fisca/auth-rbac';
import { emitCdvResponse, certifyInvoice, createSqlCertificationRepository, CertifyError, type CertifyPorts, type CertifyErrorCode } from '@fisca/ubl-xades/certify';
import type { ClearanceGateway } from '@fisca/ubl-xades/clearance';
import { Hono } from 'hono';
import { effectivePayrollPiiClearance, type LedgerActorProfileSource } from '../../core/ledger-api.ts';
import { IDEMPOTENCY_KEY_HEADER } from '../../core/idempotency.ts';
import { PolicyDenialError, ProblemError, type ProblemInput } from '../../core/problem-details.ts';
import { createRequestPipeline, type RequestPipelineDeps } from '../../core/request-pipeline.ts';
import { parseWithSchema, readJsonBody } from '../../core/request-validation.ts';
import type { PipelineEnv, TenantContext } from '../../core/tenant-router.ts';
import { resolveV1RoutePolicy } from '../../core/v1-route-policies.ts';
import {
  CdvResponseRequestSchema,
  CdvResponseResponseSchema,
  CertifyRequestSchema,
  CertifyResponseSchema,
  DISPLAY_STATE_SIMULATED,
  InvoiceParamSchema,
} from './invoice-route-schemas.ts';
import { createPublicVerifyRoute, type PublicVerifyDeps } from './public-verify.ts';

/** Ports externes de certification d'UNE société (séquenceur, signataire, Factur-X, coffre, Workflow) : résolus par le pilote depuis `c.env`. */
export type CertifyExternalPorts = Pick<CertifyPorts, 'allocator' | 'ublSource' | 'signer' | 'facturX' | 'archive' | 'workflow'>;

export interface InvoicesRoutesDeps {
  /** Tout le pipeline sauf la politique de route, fixée par `resolveV1RoutePolicy`. */
  readonly pipeline: Omit<RequestPipelineDeps, 'routePolicy'>;
  /** Ports externes pour la société de la requête (la base `tenant.tenantDb` est déjà résolue côté serveur, D-16). */
  readonly externalPortsFor: (tenant: TenantContext) => CertifyExternalPorts | Promise<CertifyExternalPorts>;
  /** Passerelle xHub (pilote `simulated` seul, B-13). */
  readonly gatewayFor: (tenant: TenantContext) => ClearanceGateway | Promise<ClearanceGateway>;
  readonly actorProfiles: LedgerActorProfileSource;
  readonly clock: { nowMs(): number; nowIso(): string };
  readonly ids: { newId(): string };
  readonly publicVerify: PublicVerifyDeps;
}

const fixed = (status: number, errorCode: string, title: string, detail: string): ProblemInput => ({ status, errorCode, title, detail });

const CERTIFY_PROBLEMS: Readonly<Record<CertifyErrorCode, ProblemInput>> = {
  CERTIFY_INVOICE_NOT_FOUND: fixed(404, 'INVOICE_NOT_FOUND', 'Facture introuvable', 'Aucune facture ne correspond à cet identifiant.'),
  CERTIFY_STATE_INVALID: fixed(409, 'INVOICE_STATE_INVALID', 'État de facture invalide', "L'état de la facture ne permet pas cette opération."),
  CERTIFY_CONCURRENT_UPDATE: fixed(409, 'INVOICE_CONCURRENT_UPDATE', 'Conflit de modification', 'La facture a été modifiée en parallèle : réessayez.'),
  CERTIFY_INVOICE_DATA_INVALID: fixed(422, 'INVOICE_DATA_INVALID', 'Données de facture invalides', 'Les données de la facture ne permettent pas de générer le document.'),
  CERTIFY_EMITTER_CERTIFICATE_MISMATCH: fixed(422, 'EMITTER_CERTIFICATE_MISMATCH', 'Certificat inadapté', "Le certificat de signature ne correspond pas à l'ICE ou à l'IF de l'émetteur."),
  CERTIFY_SOURCE_UNAVAILABLE: fixed(503, 'INVOICE_SOURCE_UNAVAILABLE', 'Données indisponibles', 'Les données de la facture sont momentanément indisponibles.'),
  CERTIFY_NUMBERING_UNAVAILABLE: fixed(503, 'NUMBERING_UNAVAILABLE', 'Numérotation indisponible', 'Le séquenceur de numérotation est indisponible.'),
  CERTIFY_SIGNATURE_UNAVAILABLE: fixed(503, 'SIGNATURE_UNAVAILABLE', 'Signature indisponible', 'Le service de signature est indisponible.'),
  CERTIFY_FACTURX_UNAVAILABLE: fixed(503, 'FACTURX_UNAVAILABLE', 'Factur-X indisponible', 'Le service de production Factur-X est indisponible.'),
  CERTIFY_ARCHIVE_UNAVAILABLE: fixed(503, 'ARCHIVE_UNAVAILABLE', 'Archivage indisponible', "Le coffre d'archivage est indisponible."),
  CERTIFY_WORKFLOW_UNAVAILABLE: fixed(503, 'CLEARANCE_WORKFLOW_UNAVAILABLE', 'Clearance indisponible', 'Le démarrage de la clearance est indisponible.'),
  CDV_INVOICE_NOT_FOUND: fixed(404, 'INVOICE_NOT_FOUND', 'Facture introuvable', 'Aucune facture ne correspond à cet identifiant.'),
  CDV_NOT_CLEARED: fixed(409, 'INVOICE_NOT_SUBMITTED', 'Facture non déposée', "La facture n'est pas déposée auprès de xHub."),
  CDV_TRANSITION_INVALID: fixed(409, 'CDV_TRANSITION_INVALID', 'Transition CDV refusée', "Le statut demandé n'est pas atteignable depuis le statut courant."),
  CDV_GATEWAY_REJECTED: fixed(422, 'CDV_GATEWAY_REJECTED', 'Statut refusé par la passerelle', 'La passerelle a refusé le statut CDV.'),
  CDV_GATEWAY_UNAVAILABLE: fixed(503, 'CDV_GATEWAY_UNAVAILABLE', 'Passerelle indisponible', 'La passerelle xHub est indisponible.'),
};

function problemOf(error: CertifyError): ProblemError {
  const base = CERTIFY_PROBLEMS[error.code];
  return new ProblemError(error.issues.length === 0 ? base : { ...base, issues: error.issues.map((issue) => ({ path: issue.path, message: issue.code })) });
}

async function translated<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw error instanceof CertifyError ? problemOf(error) : error;
  }
}

export function createInvoicesRoutes(deps: InvoicesRoutesDeps): Hono<PipelineEnv> {
  const app = new Hono<PipelineEnv>();
  app.route('/', createPublicVerifyRoute(deps.publicVerify));
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

  function idempotencyKeyOf(header: string | undefined): string {
    if (header === undefined) throw new Error("Idempotency-Key absent : le middleware d'idempotence doit précéder la route.");
    return header;
  }

  app.post('/api/v1/invoices/:id/certify', async (c) => {
    const { id } = parseWithSchema(InvoiceParamSchema, c.req.param());
    parseWithSchema(CertifyRequestSchema, (await readJsonBody(() => c.req.text())) ?? {});
    const tenant = await authorize(c, 'INVOICE_CERTIFY_XHUB');
    const external = await deps.externalPortsFor(tenant);
    const ports: CertifyPorts = { ...external, repository: createSqlCertificationRepository(tenant.tenantDb), clock: deps.clock, ids: deps.ids };
    const result = await translated(() =>
      certifyInvoice(ports, { invoiceId: id, companyId: tenant.companyId, actorId: tenant.userId, idempotencyKey: idempotencyKeyOf(c.req.header(IDEMPOTENCY_KEY_HEADER)) }),
    );
    return c.json(CertifyResponseSchema.parse(result), 202);
  });

  app.post('/api/v1/invoices/:id/cdv-response', async (c) => {
    const { id } = parseWithSchema(InvoiceParamSchema, c.req.param());
    const body = parseWithSchema(CdvResponseRequestSchema, await readJsonBody(() => c.req.text()));
    const tenant = await authorize(c, 'INVOICE_CERTIFY_XHUB');
    const gateway = await deps.gatewayFor(tenant);
    const result = await translated(() =>
      emitCdvResponse(
        { db: tenant.tenantDb, gateway, clock: deps.clock, ids: deps.ids },
        { invoiceId: id, status: body.status, reason: body.reason, actorId: tenant.userId, idempotencyKey: idempotencyKeyOf(c.req.header(IDEMPOTENCY_KEY_HEADER)) },
      ),
    );
    return c.json(CdvResponseResponseSchema.parse({ invoiceId: result.invoiceId, previousStatus: result.from, status: result.to, applied: result.applied, displayState: DISPLAY_STATE_SIMULATED }), 200);
  });

  return app;
}
