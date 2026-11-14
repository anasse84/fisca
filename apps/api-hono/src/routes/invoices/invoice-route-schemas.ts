/**
 * Schémas Zod et contrats des trois routes de T-P2A-09 (CTR-API-14, CTR-API-15, CTR-API-18). Définis ICI car `src/core/api-v1-contracts.ts`
 * (S1B) et `packages/shared-types` (gelé) ne les portent pas : voir SEAM_REQUEST du rapport (enregistrement dans openapi:gen).
 * Registre : statut PROVISIONAL, conformité officielle non vérifiée (B-13) ; aucune mention de certification DGI.
 */
import { z } from 'zod';

const IDENTIFIER = /^[A-Za-z0-9._-]{1,128}$/;
/** UUID v4 ou v7 strict (RFC 9562) : version 4 ou 7, variante 10xx. */
export const XHUB_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DISPLAY_STATE_SIMULATED = 'Validation simulée' as const;

export const InvoiceParamSchema = z.strictObject({ id: z.string().regex(IDENTIFIER) });
export const XhubUuidParamSchema = z.strictObject({ xhubUuid: z.string().regex(XHUB_UUID_PATTERN) });

/** CTR-API-14 : corps strict `{}`. */
export const CertifyRequestSchema = z.strictObject({});
export const CertifyResponseSchema = z.strictObject({
  invoiceId: z.string(),
  clearanceState: z.literal('SIGNEE_LOI_43_20'),
  workflowInstanceId: z.string(),
  displayState: z.literal(DISPLAY_STATE_SIMULATED),
});
export type CertifyResponse = z.infer<typeof CertifyResponseSchema>;

/** CTR-API-15 : statuts CDV émis par Fisca (Doc_07 § 02 ligne 40). */
export const CDV_RESPONSE_STATUSES = ['APPROUVEE', 'EN_LITIGE_SUSPENDUE', 'ENCAISSEE'] as const;
export const CdvResponseRequestSchema = z.strictObject({
  status: z.enum(CDV_RESPONSE_STATUSES),
  reason: z.string().trim().min(1).max(500).optional(),
});
export const CdvResponseResponseSchema = z.strictObject({
  invoiceId: z.string(),
  previousStatus: z.string(),
  status: z.string(),
  applied: z.boolean(),
  displayState: z.literal(DISPLAY_STATE_SIMULATED),
});
export type CdvResponseBody = z.infer<typeof CdvResponseRequestSchema>;

/**
 * CTR-API-18 : champs publics MINIMAUX. Jamais d'identifiant du client, de montant ni de raison sociale (données personnelles possibles).
 * `pii_restricted_flag = 1` : la vue se réduit à l'état affiché et à l'empreinte.
 */
export const PublicVerifyFullSchema = z.strictObject({
  invoiceNumber: z.string(),
  issueDate: z.string(),
  displayState: z.literal(DISPLAY_STATE_SIMULATED),
  xmlSha256: z.string().regex(/^[0-9a-f]{64}$/),
  emitterIce: z.string().regex(/^\d{15}$/),
});
export const PublicVerifyRestrictedSchema = z.strictObject({
  displayState: z.literal(DISPLAY_STATE_SIMULATED),
  xmlSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export const PublicVerifyResponseSchema = z.union([PublicVerifyFullSchema, PublicVerifyRestrictedSchema]);

export interface InvoiceRouteContract {
  readonly registryId: 'CTR-API-14' | 'CTR-API-15' | 'CTR-API-18';
  readonly method: 'get' | 'post';
  readonly path: string;
  readonly summary: string;
  readonly tag: 'invoices' | 'public';
  readonly auth: 'BEARER' | 'NONE';
  readonly companyHeader: boolean;
  readonly idempotencyKey: boolean;
  readonly params: z.ZodType;
  readonly body?: z.ZodType;
  readonly success: readonly { readonly status: number; readonly description: string; readonly schema: z.ZodType }[];
  readonly errorStatuses: readonly number[];
}

/** Même forme que `ApiRouteContract` (core) : à fusionner dans `API_V1_ROUTE_CONTRACTS` par le propriétaire du core (SEAM_REQUEST). */
export const INVOICE_ROUTE_CONTRACTS: readonly InvoiceRouteContract[] = [
  {
    registryId: 'CTR-API-14',
    method: 'post',
    path: '/api/v1/invoices/:id/certify',
    summary: 'Numérote, génère l’UBL, signe (XAdES), archive puis démarre la clearance xHub simulée.',
    tag: 'invoices',
    auth: 'BEARER',
    companyHeader: true,
    idempotencyKey: true,
    params: InvoiceParamSchema,
    body: CertifyRequestSchema,
    success: [{ status: 202, description: 'Clearance démarrée (état affiché : Validation simulée).', schema: CertifyResponseSchema }],
    errorStatuses: [400, 401, 403, 404, 409, 422, 503],
  },
  {
    registryId: 'CTR-API-15',
    method: 'post',
    path: '/api/v1/invoices/:id/cdv-response',
    summary: 'Émet un statut CDV (APPROUVEE, EN_LITIGE_SUSPENDUE, ENCAISSEE) vers xHub (pilote simulé).',
    tag: 'invoices',
    auth: 'BEARER',
    companyHeader: true,
    idempotencyKey: true,
    params: InvoiceParamSchema,
    body: CdvResponseRequestSchema,
    success: [{ status: 200, description: 'Statut CDV émis et appliqué.', schema: CdvResponseResponseSchema }],
    errorStatuses: [400, 401, 403, 404, 409, 422, 503],
  },
  {
    registryId: 'CTR-API-18',
    method: 'get',
    path: '/api/v1/public/verify/:xhubUuid',
    summary: 'Vérification publique minimale d’une facture par son UUID xHub (Turnstile, débit limité).',
    tag: 'public',
    auth: 'NONE',
    companyHeader: false,
    idempotencyKey: false,
    params: XhubUuidParamSchema,
    success: [{ status: 200, description: 'Champs publics minimaux.', schema: PublicVerifyResponseSchema }],
    errorStatuses: [400, 403, 404, 429],
  },
];
