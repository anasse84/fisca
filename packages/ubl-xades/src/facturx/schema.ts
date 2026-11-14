import { BpsIntSchema, CentimesIntSchema } from '@fisca/shared-types';
import { z } from 'zod';

/**
 * Corps JSON de `POST /facturx` (conteneur fiscal-java) : miroir strict du lecteur Java `FacturXRequest`.
 * Montants en centimes entiers (nombres JSON entiers sûrs), taux en points de base, quantités en milli-unités.
 * Aucune clé inconnue n'est tolérée (strictObject), comme côté Java.
 */

/** Contrôles C0 (hors tabulation) et DEL refusés, comme côté Java. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) return true;
  }
  return false;
}

const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !hasControlCharacter(value), { message: 'Caractère de contrôle interdit.' });

const IsoDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const AdditionalId = z.string().regex(/^[0-9A-Za-z/-]{1,20}$/);

export const FACTURX_MAX_CENTS = 99_999_999_999_999;
const Cents = CentimesIntSchema.min(0).max(FACTURX_MAX_CENTS);
const SignedCents = CentimesIntSchema.min(-FACTURX_MAX_CENTS).max(FACTURX_MAX_CENTS);

export const FacturXPartySchema = z.strictObject({
  name: text(200),
  nameAr: text(200).optional(),
  ice: z.string().regex(/^\d{15}$/).optional(),
  identifiantFiscal: z.string().regex(/^\d{5,15}$/).optional(),
  rc: AdditionalId.optional(),
  taxeProfessionnelle: AdditionalId.optional(),
  cnss: AdditionalId.optional(),
  legalForm: text(60).optional(),
  shareCapitalCents: Cents.optional(),
  addressLines: z.array(text(500)).min(1).max(4),
});

export const FacturXLineSchema = z.strictObject({
  descriptionFr: text(500),
  descriptionAr: text(500).optional(),
  quantityMilli: SignedCents,
  unitCode: z.string().regex(/^[A-Z0-9]{2,3}$/).optional(),
  unitPriceCents: Cents,
  discountBps: BpsIntSchema.optional(),
  vatRateBps: BpsIntSchema,
  lineTotalCents: SignedCents,
});

export const FacturXVatBreakdownSchema = z.strictObject({
  vatRateBps: BpsIntSchema,
  taxableCents: Cents,
  taxCents: Cents,
});

export const FacturXTotalsSchema = z.strictObject({
  lineExtensionCents: Cents,
  taxTotalCents: Cents,
  stampDutyCents: Cents.optional(),
  taxExclusiveCents: Cents,
  taxInclusiveCents: Cents,
  retentionCents: Cents.optional(),
  payableCents: Cents,
});

export const FacturXPresentationSchema = z.strictObject({
  typeCode: z.enum(['380', '381', '383', '386', '389']),
  invoiceNumber: text(64),
  issueDate: IsoDate,
  dueDate: IsoDate.optional(),
  currencyCode: z.literal('MAD').optional(),
  supplier: FacturXPartySchema,
  customer: FacturXPartySchema,
  lines: z.array(FacturXLineSchema).min(1).max(999),
  vatBreakdown: z.array(FacturXVatBreakdownSchema).max(20).optional(),
  totals: FacturXTotalsSchema,
  legalMentionsFr: z.array(text(500)).max(10).optional(),
  legalMentionsAr: z.array(text(500)).max(10).optional(),
});

/** Domaine de vérification : HTTPS, sans identifiants, requête ni fragment (paramètre de configuration, jamais une constante). */
export const FacturXVerificationSchema = z.strictObject({
  baseUrl: z
    .string()
    .max(200)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '' && url.search === '' && url.hash === '';
      } catch {
        return false;
      }
    }, { message: 'URL https sans identifiants, requête ni fragment attendue.' }),
  xhubUuid: z.uuid(),
});

export const FacturXRequestSchema = z.strictObject({
  /** XML UBL 2.1 de la facture (éventuellement signé XAdES), UTF-8, en base64 standard. */
  xmlBase64: z.string().min(4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  attachmentRelationship: z.enum(['Alternative', 'Data']).optional(),
  presentation: FacturXPresentationSchema,
  verification: FacturXVerificationSchema,
  /** Arrêtés calculés côté TypeScript : le conteneur les recalcule et répond 422 `AMOUNT_IN_WORDS_MISMATCH` si l'un diffère. */
  expectedAmountInWords: z.strictObject({ fr: text(2000), ar: text(2000) }).optional(),
});

export type FacturXRequest = z.output<typeof FacturXRequestSchema>;
export type FacturXRequestInput = z.input<typeof FacturXRequestSchema>;
