/**
 * GET /api/v1/public/verify/:xhubUuid (CTR-API-18) : route PUBLIQUE, hors pipeline authentifié (aucun JWT, aucun TenantRouter, aucune
 * lecture d'abonnement : « sanctuarisée », Doc_07 § 02). Garde : limitation de débit puis Turnstile (`guardRequest` de auth-rbac, même
 * mécanisme que les routes publiques d'authentification), validation stricte de l'UUID (v4/v7), puis `PublicInvoiceLookup`.
 *
 * Minimisation : numéro, date, état affiché, empreinte SHA-256 du XML, ICE émetteur. Jamais de client, de montant ni de raison sociale.
 * `piiRestricted` : état affiché et empreinte seulement. UUID inconnu ou non vérifiable : 404 uniforme. Aucun journal d'IP ni de donnée.
 */
import { guardRequest, type EdgeGuardDeps } from '@fisca/auth-rbac';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createProblemErrorHandler, newTraceId, ProblemError, traceIdFromRequest, type TraceVariables } from '../../core/problem-details.ts';
import { parseWithSchema } from '../../core/request-validation.ts';
import {
  DISPLAY_STATE_SIMULATED,
  PublicVerifyFullSchema,
  PublicVerifyRestrictedSchema,
  XhubUuidParamSchema,
} from './invoice-route-schemas.ts';

/** Vue publique d'une facture, sans donnée personnelle : produite par l'index public (SEAM_REQUEST db-schema). */
export interface PublicInvoiceView {
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly xmlSha256: string;
  readonly emitterIce: string;
  /** `invoices.pii_restricted_flag = 1`. */
  readonly piiRestricted: boolean;
}

export interface PublicInvoiceLookup {
  /** `null` : UUID inconnu OU facture non vérifiable publiquement (aucune distinction n'est exposée). N'ouvre aucune base à partir d'un identifiant fourni par l'appelant. */
  findByXhubUuid(xhubUuid: string): Promise<PublicInvoiceView | null>;
}

export interface PublicVerifyDeps extends EdgeGuardDeps {
  readonly lookup: PublicInvoiceLookup;
}

export const PUBLIC_VERIFY_PATH = '/api/v1/public/verify/:xhubUuid' as const;
const ROUTE_KEY = 'public-verify';

const NOT_FOUND = { status: 404, errorCode: 'PUBLIC_VERIFY_NOT_FOUND', title: 'Facture introuvable', detail: 'Aucune facture ne correspond à cet identifiant.' } as const;

export const PUBLIC_VERIFY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Robots-Tag': 'noindex, nofollow',
  'Cross-Origin-Resource-Policy': 'same-site',
};

export function createPublicVerifyRoute(deps: PublicVerifyDeps): Hono<{ Variables: TraceVariables }> {
  const app = new Hono<{ Variables: TraceVariables }>();
  app.onError(createProblemErrorHandler({}));
  app.use(
    PUBLIC_VERIFY_PATH,
    createMiddleware<{ Variables: TraceVariables }>(async (c, next) => {
      c.set('traceId', traceIdFromRequest(c.req.header('traceparent'), newTraceId));
      await next();
      for (const [name, value] of Object.entries(PUBLIC_VERIFY_HEADERS)) c.res.headers.set(name, value);
    }),
  );
  app.get(PUBLIC_VERIFY_PATH, async (c) => {
    const refused = await guardRequest(deps, c, ROUTE_KEY);
    if (refused !== null) return refused;
    const { xhubUuid } = parseWithSchema(XhubUuidParamSchema, c.req.param());
    const view = await deps.lookup.findByXhubUuid(xhubUuid.toLowerCase());
    if (view === null) throw new ProblemError(NOT_FOUND);
    if (view.piiRestricted) {
      return c.json(PublicVerifyRestrictedSchema.parse({ displayState: DISPLAY_STATE_SIMULATED, xmlSha256: view.xmlSha256 }), 200);
    }
    return c.json(
      PublicVerifyFullSchema.parse({
        invoiceNumber: view.invoiceNumber,
        issueDate: view.issueDate,
        displayState: DISPLAY_STATE_SIMULATED,
        xmlSha256: view.xmlSha256,
        emitterIce: view.emitterIce,
      }),
      200,
    );
  });
  return app;
}
