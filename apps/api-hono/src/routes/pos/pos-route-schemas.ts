/**
 * Schémas Zod et contrats des deux routes de T-P2A-10 (CTR-API-16, CTR-API-17). Définis ICI car `src/core/api-v1-contracts.ts` (S1B) et
 * `packages/shared-types` (gelé) ne les portent pas : voir SEAM_REQUEST du rapport. Registre : statut PROVISIONAL, conformité officielle
 * non vérifiée (B-13) ; aucune mention de certification DGI. Corps stricts : toute clé inconnue est refusée.
 */
import { z } from 'zod';

const IDENTIFIER = /^[A-Za-z0-9._-]{1,128}$/;
const TERMINAL_ID = /^[A-Za-z0-9._-]{1,64}$/;
const QR_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const cents = z.number().int().safe().min(0);

export const QrTokenParamSchema = z.strictObject({ qrToken: z.string().regex(QR_TOKEN) });

export const PosSyncTicketSchema = z.strictObject({
  ticketId: z.string().regex(IDENTIFIER),
  sessionId: z.string().regex(IDENTIFIER),
  terminalSeqNumber: z.number().int().safe().min(1),
  issuedAtIso: z.string().regex(ISO_INSTANT),
  ticketKind: z.enum(['SALE_B2C', 'RETURN_REFUND']),
  originTicketId: z.string().regex(IDENTIFIER).nullable(),
  ht20Cents: cents,
  vat20Cents: cents,
  ht10Cents: cents,
  vat10Cents: cents,
  ht0Cents: cents,
  stampDutyCents: cents,
  totalTtcCents: cents,
  paidCashCents: cents,
  paidCardTpeCents: cents,
  paidDeliveryAppCents: cents,
  qrConversionToken: z.string().regex(QR_TOKEN),
  prevTicketSha256: z.string().regex(HEX64),
  ticketSha256: z.string().regex(HEX64),
  ecdsaSignatureB64: z.string().min(1).max(512),
});

/** CTR-API-16 : lot de tickets d'UN terminal ; la limite (Doc_07 § 03 : 200) est un paramètre de déploiement. */
export function createSyncBatchRequestSchema(maxTickets: number) {
  return z.strictObject({
    terminalId: z.string().regex(TERMINAL_ID),
    tickets: z.array(PosSyncTicketSchema).min(1).max(maxTickets),
  });
}

export const SyncBatchResponseSchema = z.strictObject({
  terminalId: z.string(),
  syncedAt: z.string(),
  accepted: z.number().int().min(0),
  replayed: z.number().int().min(0),
  rejected: z.number().int().min(0),
  results: z.array(
    z.strictObject({
      ticketId: z.string(),
      terminalSeqNumber: z.number().int(),
      outcome: z.enum(['ACCEPTED', 'REPLAYED', 'REJECTED']),
      code: z.string().optional(),
    }),
  ),
});

/** CTR-API-17 : corps minimal. La clé de contrôle de l'ICE est vérifiée par le moteur (422), le format seul ici. */
export const ConvertB2bRequestSchema = z.strictObject({
  clientIce: z.string().regex(/^\d{15}$/),
  clientLegalName: z.string().trim().min(1).max(200).optional(),
});

/** Réponse minimale : aucun montant, aucune donnée du client. */
export const ConvertB2bResponseSchema = z.strictObject({
  conversionState: z.enum(['CONVERTI_B2B_AVANT_Z', 'CONVERTI_B2B_POST_Z_NEUTRALISE']),
  invoiceRef: z.string(),
  certificationPending: z.boolean(),
});
export type ConvertB2bResponse = z.infer<typeof ConvertB2bResponseSchema>;

export interface PosRouteContract {
  readonly registryId: 'CTR-API-16' | 'CTR-API-17';
  readonly method: 'post';
  readonly path: string;
  readonly summary: string;
  readonly request: z.ZodType;
  readonly response: z.ZodType;
  readonly publicRoute: boolean;
  readonly statuses: readonly number[];
  readonly status: 'PROVISIONAL';
  readonly docSectionRef: string;
}

export function posRouteContracts(maxTickets: number): readonly PosRouteContract[] {
  return [
    {
      registryId: 'CTR-API-16',
      method: 'post',
      path: '/api/v1/pos/sync-batch',
      summary: "Synchronisation d'un lot de tickets POS signés hors ligne (ECDSA P-256, chaîne SHA-256).",
      request: createSyncBatchRequestSchema(maxTickets),
      response: SyncBatchResponseSchema,
      publicRoute: false,
      statuses: [200, 207, 400, 401, 403, 409, 429, 503],
      status: 'PROVISIONAL',
      docSectionRef: 'Doc_07 § 03 ; Doc_10 § 08 ; conformité officielle non vérifiée',
    },
    {
      registryId: 'CTR-API-17',
      method: 'post',
      path: '/api/v1/public/pos-qr/:qrToken/convert-b2b',
      summary: "Conversion d'un ticket B2C en facture B2B par QR (extourne B2C atomique après Ticket Z).",
      request: ConvertB2bRequestSchema,
      response: ConvertB2bResponseSchema,
      publicRoute: true,
      statuses: [200, 400, 403, 404, 409, 422, 429, 503],
      status: 'PROVISIONAL',
      docSectionRef: 'Doc_07 § 03 ; Doc_02 § 13 ; conformité officielle non vérifiée',
    },
  ];
}
