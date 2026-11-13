import {
  CentimesIntSchema,
  BpsIntSchema,
  Ice15Schema,
  MilliIntSchema,
  VatRate2026BpsSchema,
  isReadableIsoDate,
} from '@fisca/shared-types';
import { z } from 'zod';
import { containsXmlForbiddenCharacter } from './xml.ts';
import { isValidInvoiceNumber } from './invoice-number.ts';

const safeText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !containsXmlForbiddenCharacter(value), { message: 'Caractère interdit en XML 1.0.' });

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isReadableIsoDate, { message: 'Date calendaire AAAA-MM-JJ inexistante.' });

/** Identifiants additionnels (RC, TP, CNSS) : alphanumériques, tirets et barres ; format de saisie provisoire. */
const AdditionalId = z.string().regex(/^[0-9A-Za-z/-]{1,20}$/);

/** Identifiant Fiscal : chiffres seuls ; longueur 5 à 15 = hypothèse de travail, non publiée par la DGI. */
const IdentifiantFiscal = z.string().regex(/^\d{5,15}$/);

export const UblAddressSchema = z.strictObject({
  street: safeText(200),
  city: safeText(100),
  postalZone: safeText(20).optional(),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default('MA'),
});

export const UblPartySchema = z.strictObject({
  name: safeText(200),
  ice: Ice15Schema.optional(),
  identifiantFiscal: IdentifiantFiscal.optional(),
  legalForm: safeText(60).optional(),
  shareCapitalCents: CentimesIntSchema.nonnegative().optional(),
  rc: AdditionalId.optional(),
  taxeProfessionnelle: AdditionalId.optional(),
  cnss: AdditionalId.optional(),
  address: UblAddressSchema,
});

export const UblLineSchema = z
  .strictObject({
    descriptionFr: safeText(500),
    descriptionAr: safeText(500).optional(),
    quantityMilli: MilliIntSchema,
    unitCode: z
      .string()
      .regex(/^[A-Z0-9]{2,3}$/)
      .default('C62'),
    unitPriceCents: CentimesIntSchema.nonnegative(),
    discountBps: BpsIntSchema.default(0),
    vatRateBps: VatRate2026BpsSchema,
    vatExemptionReasonCode: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,40}$/)
      .optional(),
    isDisbursementDebours: z.boolean().default(false),
  })
  .superRefine((line, context) => {
    if (line.isDisbursementDebours && line.vatRateBps !== 0) {
      context.addIssue({ code: 'custom', path: ['isDisbursementDebours'], message: 'Un débours est hors champ de TVA.' });
    }
  });

export const UblBillingReferenceSchema = z.strictObject({
  originInvoiceNumber: z.string().refine(isValidInvoiceNumber, { message: 'Numéro de facture d’origine invalide.' }),
  xhubUuid: z.uuid(),
  issueDate: IsoDate.optional(),
});

export const UblDeclaredTotalsSchema = z.strictObject({
  lineExtensionCents: CentimesIntSchema.optional(),
  taxExclusiveCents: CentimesIntSchema.optional(),
  taxTotalCents: CentimesIntSchema.optional(),
  taxInclusiveCents: CentimesIntSchema.optional(),
  payableCents: CentimesIntSchema.optional(),
});

export const UblInvoiceInputSchema = z
  .strictObject({
    typeCode: z.enum(['380', '381', '383', '386', '389']),
    number: z.string().min(1).max(64),
    issueDate: IsoDate,
    dueDate: IsoDate.optional(),
    currencyCode: z.literal('MAD').default('MAD'),
    buyerReference: safeText(100).optional(),
    note: safeText(500).optional(),
    paymentMeansCode: z
      .string()
      .regex(/^\d{1,3}$/)
      .optional(),
    billingReference: UblBillingReferenceSchema.optional(),
    supplier: UblPartySchema,
    customer: UblPartySchema,
    lines: z.array(UblLineSchema).min(1).max(999),
    declaredTotals: UblDeclaredTotalsSchema.optional(),
  })
  .superRefine((invoice, context) => {
    if (invoice.dueDate !== undefined && invoice.dueDate < invoice.issueDate) {
      context.addIssue({ code: 'custom', path: ['dueDate'], message: 'Échéance antérieure à l’émission.' });
    }
  });

/** Entrée publique (avant application des valeurs par défaut). */
export type UblInvoiceInput = z.input<typeof UblInvoiceInputSchema>;
/** Entrée validée, valeurs par défaut appliquées. */
export type ParsedUblInvoiceInput = z.output<typeof UblInvoiceInputSchema>;
export type UblPartyInput = z.input<typeof UblPartySchema>;
export type UblLineInput = z.input<typeof UblLineSchema>;
