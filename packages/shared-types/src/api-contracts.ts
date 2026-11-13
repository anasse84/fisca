import { z } from 'zod';
import { isReadableIsoDate } from './invariants.ts';
import { isValidIceChecksum } from './modulo97.ts';

// 1. Primitives monétaires entières et identifiants fiscaux marocains (zéro flottant, ADR-03)
export const CentimesIntSchema = z.number().int().safe();
export const BpsIntSchema = z.number().int().min(0).max(10000);
export const MilliIntSchema = z.number().int().safe().positive();
export const Ice15Schema = z
  .string()
  .regex(/^\d{15}$/, "L'ICE doit comporter exactement 15 chiffres.")
  .refine(isValidIceChecksum, { message: "La clé de contrôle modulo 97 de l'ICE est invalide." });
export const VatRate2026BpsSchema = z.union([z.literal(2000), z.literal(1000), z.literal(0)]);

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isReadableIsoDate, { message: "Date calendaire AAAA-MM-JJ inexistante." });

// 2. Contrat d'émission de facture électronique UBL 2.1 / clearance xHub (jamais de tenantId ni companyId, Loi 4)
const InvoiceLineSchema = z.strictObject({
  isDisbursementDebours: z.boolean().default(false),
  descriptionFr: z.string().min(2).max(500),
  descriptionAr: z.string().max(500).optional(),
  quantityMilli: MilliIntSchema,
  unitPriceCents: CentimesIntSchema.nonnegative(),
  discountBps: BpsIntSchema.default(0),
  vatRateBps: VatRate2026BpsSchema,
  vatExemptionReasonCode: z.string().optional(),
  pcgeAccountNumber: z.string().regex(/^\d{4,8}$/),
});

export const CreateInvoiceRequestSchema = z
  .strictObject({
    ublTypeCode: z.enum(['380_FACTURE', '381_AVOIR', '383_NOTE_DEBIT', '386_ACOMPTE', '389_AUTOFACTURATION']),
    originInvoiceId: z.uuid().optional(),
    isBtpProgressStatement: z.boolean().default(false),
    btpRetentionRateBps: z.union([z.literal(0), z.literal(700), z.literal(1000)]).default(0),
    partnerId: z.string().min(1),
    issueDate: IsoDateSchema,
    serviceDeliveryDate: IsoDateSchema,
    ublPaymentCode: z.enum(['10_ESPECES', '20_CHEQUE', '30_VIREMENT', '42_EFFET_LCN', '48_CARTE', '97_COMPENSATION']),
    lines: z.array(InvoiceLineSchema).min(1),
  })
  .superRefine((value, ctx) => {
    if ((value.ublTypeCode === '381_AVOIR' || value.ublTypeCode === '383_NOTE_DEBIT') && value.originInvoiceId === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'originInvoiceId est obligatoire pour un Avoir (381) ou une Note de Débit (383).',
        path: ['originInvoiceId'],
      });
    }
    value.lines.forEach((line, index) => {
      if (line.vatRateBps === 0 && !line.isDisbursementDebours && !line.vatExemptionReasonCode) {
        ctx.addIssue({
          code: 'custom',
          message: "Motif légal d'exonération (Art. 91 ou 92 CGI) obligatoire pour une ligne à 0 % hors débours.",
          path: ['lines', index, 'vatExemptionReasonCode'],
        });
      }
    });
  });

export type CreateInvoiceRequest = z.infer<typeof CreateInvoiceRequestSchema>;

// 3. Enveloppe d'erreur déterministe conforme RFC 9457
// issues[] (Doc_07 § 01) : membre d'extension RFC 9457. La spécification n'en fixe pas la forme ; forme minimale
// retenue (chemin du champ fautif + message, code optionnel), à confirmer à G1. instance : RFC 9457 § 3.1.5.
export const ProblemIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});

export const ProblemDetailsSchema = z.object({
  type: z.url(),
  title: z.string(),
  status: z.number().int().min(100).max(599),
  errorCode: z.string(),
  legalRef: z.string().optional(),
  traceId: z.string(),
  detail: z.string(),
  instance: z.string().optional(),
  issues: z.array(ProblemIssueSchema).optional(),
});

export type ProblemIssue = z.infer<typeof ProblemIssueSchema>;

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

// 4. Vérificateur cryptographique de webhooks (HMAC-SHA256, temps constant, anti-rejeu 300 s)
const TIMESTAMP_PATTERN = /^[0-9]{1,15}$/;
const SIGNATURE_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;
const DEFAULT_MAX_SKEW_SECONDS = 300;

export interface VerifySignedWebhookParams {
  readonly rawBodyText: string;
  readonly signatureHexHeader: string;
  readonly timestampSecHeader: string;
  readonly sharedSecret: string;
  readonly maxSkewSeconds?: number;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Retourne false (jamais d'exception) pour toute entrée invalide : l'appelant répond 401. */
export async function verifySignedWebhookPayload(params: VerifySignedWebhookParams): Promise<boolean> {
  const maxSkew = params.maxSkewSeconds ?? DEFAULT_MAX_SKEW_SECONDS;
  if (!Number.isSafeInteger(maxSkew) || maxSkew < 0 || params.sharedSecret.length === 0) {
    return false;
  }
  if (!TIMESTAMP_PATTERN.test(params.timestampSecHeader) || !SIGNATURE_HEX_PATTERN.test(params.signatureHexHeader)) {
    return false;
  }
  const timestampSec = Number(params.timestampSecHeader);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestampSec) > maxSkew) {
    return false;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(params.sharedSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  // ERRATA section C : message signé = `${timestampSecHeader}.${rawBodyText}`
  const signedMessage = `${params.timestampSecHeader}.${params.rawBodyText}`;
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(signedMessage)));
  const provided = hexToBytes(params.signatureHexHeader);

  let diff = expected.length ^ provided.length;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= (expected[index] ?? 0) ^ (provided[index] ?? 0);
  }
  return diff === 0;
}
