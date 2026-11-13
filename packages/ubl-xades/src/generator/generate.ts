import { CIUS_MA_PROVISIONAL, MA_SCHEME_IDS } from '../profile.ts';
import { UblGeneratorError, type UblInputIssueDetail } from '../errors.ts';
import type { UblDocumentKind } from '../schema-resolver.ts';
import { formatCentsDecimal, formatMilliQuantity, formatVatPercent } from './format.ts';
import { UblInvoiceInputSchema, type ParsedUblInvoiceInput, type UblInvoiceInput } from './input.ts';
import { INVOICE_NUMBER_PREFIX_BY_TYPE, parseInvoiceNumber, type UblTypeCode } from './invoice-number.ts';
import {
  assertDeclaredTotals,
  computeTotals,
  type ComputedLine,
  type ComputedTaxSubtotal,
  type ComputedTotals,
} from './totals.ts';
import { element, textElement } from './xml.ts';

interface DocumentLayout {
  readonly kind: UblDocumentKind;
  readonly root: string;
  /** Le schéma OASIS UBL 2.1 DebitNote ne définit aucun élément de code de type : undefined (aucune balise inventée). */
  readonly typeElement: string | undefined;
  readonly lineElement: string;
  readonly quantityElement: string;
  readonly totalElement: string;
  /** DueDate n'existe que dans le schéma Invoice ; sinon l'échéance passe par PaymentMeans/PaymentDueDate. */
  readonly hasDueDate: boolean;
}

const LAYOUT_BY_TYPE: Readonly<Record<UblTypeCode, DocumentLayout>> = {
  '380': invoiceLayout(),
  '381': {
    kind: 'credit-note',
    root: 'CreditNote',
    typeElement: 'CreditNoteTypeCode',
    lineElement: 'CreditNoteLine',
    quantityElement: 'CreditedQuantity',
    totalElement: 'LegalMonetaryTotal',
    hasDueDate: false,
  },
  '383': {
    kind: 'debit-note',
    root: 'DebitNote',
    typeElement: undefined,
    lineElement: 'DebitNoteLine',
    quantityElement: 'DebitedQuantity',
    totalElement: 'RequestedMonetaryTotal',
    hasDueDate: false,
  },
  '386': invoiceLayout(),
  '389': invoiceLayout(),
};

function invoiceLayout(): DocumentLayout {
  return {
    kind: 'invoice',
    root: 'Invoice',
    typeElement: 'InvoiceTypeCode',
    lineElement: 'InvoiceLine',
    quantityElement: 'InvoicedQuantity',
    totalElement: 'LegalMonetaryTotal',
    hasDueDate: true,
  };
}

/** Type de document UBL (schéma à utiliser) pour un code de type. */
export function documentKindOf(typeCode: UblTypeCode): UblDocumentKind {
  return LAYOUT_BY_TYPE[typeCode].kind;
}

/** Valide l'entrée (Zod strict). Les erreurs ne portent que des chemins et des codes, jamais les valeurs saisies. */
export function parseUblInvoiceInput(input: UblInvoiceInput): ParsedUblInvoiceInput {
  const result = UblInvoiceInputSchema.safeParse(input);
  if (result.success) return result.data;
  const details: UblInputIssueDetail[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
  }));
  const vatRateIssue = result.error.issues.some(
    (issue) => issue.path[issue.path.length - 1] === 'vatRateBps' && issue.code !== 'custom',
  );
  if (vatRateIssue) {
    throw new UblGeneratorError(
      'UBL_VAT_RATE_INVALID',
      'Taux de TVA hors {2000, 1000, 0} points de base (ERRATA D-04).',
      details,
    );
  }
  throw new UblGeneratorError(
    'UBL_INPUT_INVALID',
    `Entrée invalide : ${details.map((detail) => detail.path || '(racine)').join(', ')}.`,
    details,
  );
}

/** Totaux recalculés à partir des lignes (entrée validée d'abord). */
export function computeInvoiceTotals(input: UblInvoiceInput): ComputedTotals {
  return computeTotals(parseUblInvoiceInput(input));
}

const amount = (cents: bigint): string => formatCentsDecimal(cents);
const money = (name: string, cents: bigint): string => element(name, amount(cents), { currencyID: 'MAD' });

function partyXml(party: ParsedUblInvoiceInput['supplier']): string {
  const identifications = [
    party.rc === undefined ? '' : partyIdentification(MA_SCHEME_IDS.rc, party.rc),
    party.taxeProfessionnelle === undefined ? '' : partyIdentification(MA_SCHEME_IDS.taxeProfessionnelle, party.taxeProfessionnelle),
    party.cnss === undefined ? '' : partyIdentification(MA_SCHEME_IDS.cnss, party.cnss),
  ].join('');

  const address = party.address;
  const postal = element(
    'cac:PostalAddress',
    textElement('cbc:StreetName', address.street) +
      textElement('cbc:CityName', address.city) +
      (address.postalZone === undefined ? '' : textElement('cbc:PostalZone', address.postalZone)) +
      element('cac:Country', textElement('cbc:IdentificationCode', address.countryCode)),
  );

  const taxScheme =
    party.identifiantFiscal === undefined
      ? ''
      : element(
          'cac:PartyTaxScheme',
          textElement('cbc:CompanyID', party.identifiantFiscal, { schemeID: MA_SCHEME_IDS.identifiantFiscal }) +
            element('cac:TaxScheme', textElement('cbc:ID', 'VAT')),
        );

  const legalForm = legalFormText(party);
  const legalEntity = element(
    'cac:PartyLegalEntity',
    textElement('cbc:RegistrationName', party.name) +
      (party.ice === undefined ? '' : textElement('cbc:CompanyID', party.ice, { schemeID: MA_SCHEME_IDS.ice })) +
      (legalForm === undefined ? '' : textElement('cbc:CompanyLegalForm', legalForm)),
  );

  return element(
    'cac:Party',
    identifications + element('cac:PartyName', textElement('cbc:Name', party.name)) + postal + taxScheme + legalEntity,
  );
}

function partyIdentification(schemeId: string, value: string): string {
  return element('cac:PartyIdentification', textElement('cbc:ID', value, { schemeID: schemeId }));
}

/** Forme juridique et capital social dans CompanyLegalForm (Doc_07), ex. « SARL AU, capital 100000.00 MAD ». */
function legalFormText(party: ParsedUblInvoiceInput['supplier']): string | undefined {
  const capital = party.shareCapitalCents === undefined ? undefined : `capital ${amount(BigInt(party.shareCapitalCents))} MAD`;
  const parts = [party.legalForm, capital].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(', ');
}

function taxCategoryXml(
  categoryCode: string,
  vatRateBps: number,
  exemptionReasonCode: string | undefined,
  withExemptionReason: boolean,
): string {
  return element(
    'cac:TaxCategory',
    textElement('cbc:ID', categoryCode) +
      (categoryCode === 'O' ? '' : element('cbc:Percent', formatVatPercent(vatRateBps))) +
      (withExemptionReason && exemptionReasonCode !== undefined ? textElement('cbc:TaxExemptionReasonCode', exemptionReasonCode) : '') +
      (withExemptionReason && categoryCode === 'O' ? textElement('cbc:TaxExemptionReason', 'Débours : hors champ de la TVA') : '') +
      element('cac:TaxScheme', textElement('cbc:ID', 'VAT')),
  );
}

function taxTotalXml(totals: ComputedTotals): string {
  const subtotals = totals.taxSubtotals
    .map((subtotal: ComputedTaxSubtotal) =>
      element(
        'cac:TaxSubtotal',
        money('cbc:TaxableAmount', subtotal.taxableCents) +
          money('cbc:TaxAmount', subtotal.taxCents) +
          taxCategoryXml(subtotal.categoryCode, subtotal.vatRateBps, subtotal.exemptionReasonCode, true),
      ),
    )
    .join('');
  return element('cac:TaxTotal', money('cbc:TaxAmount', totals.taxTotalCents) + subtotals);
}

function monetaryTotalXml(layout: DocumentLayout, totals: ComputedTotals): string {
  return element(
    `cac:${layout.totalElement}`,
    money('cbc:LineExtensionAmount', totals.lineExtensionCents) +
      money('cbc:TaxExclusiveAmount', totals.taxExclusiveCents) +
      money('cbc:TaxInclusiveAmount', totals.taxInclusiveCents) +
      money('cbc:PayableAmount', totals.payableCents),
  );
}

function lineXml(
  layout: DocumentLayout,
  line: ParsedUblInvoiceInput['lines'][number],
  computed: ComputedLine,
  position: number,
): string {
  const allowance =
    computed.discountCents > 0n
      ? element(
          'cac:AllowanceCharge',
          element('cbc:ChargeIndicator', 'false') +
            textElement('cbc:AllowanceChargeReason', 'Remise') +
            money('cbc:Amount', computed.discountCents) +
            money('cbc:BaseAmount', computed.grossCents),
        )
      : '';
  const item = element(
    'cac:Item',
    (line.descriptionAr === undefined ? '' : textElement('cbc:Description', line.descriptionAr)) +
      textElement('cbc:Name', line.descriptionFr) +
      element(
        'cac:ClassifiedTaxCategory',
        textElement('cbc:ID', computed.categoryCode) +
          (computed.categoryCode === 'O' ? '' : element('cbc:Percent', formatVatPercent(line.vatRateBps))) +
          element('cac:TaxScheme', textElement('cbc:ID', 'VAT')),
      ),
  );
  return element(
    `cac:${layout.lineElement}`,
    element('cbc:ID', String(position)) +
      element(`cbc:${layout.quantityElement}`, formatMilliQuantity(BigInt(line.quantityMilli)), { unitCode: line.unitCode }) +
      money('cbc:LineExtensionAmount', computed.lineExtensionCents) +
      allowance +
      item +
      element('cac:Price', money('cbc:PriceAmount', BigInt(line.unitPriceCents))),
  );
}

function paymentMeansXml(layout: DocumentLayout, invoice: ParsedUblInvoiceInput): string {
  const dueInPayment = !layout.hasDueDate && invoice.dueDate !== undefined;
  if (invoice.paymentMeansCode === undefined && !dueInPayment) return '';
  return element(
    'cac:PaymentMeans',
    element('cbc:PaymentMeansCode', invoice.paymentMeansCode ?? '1') +
      (dueInPayment && invoice.dueDate !== undefined ? element('cbc:PaymentDueDate', invoice.dueDate) : ''),
  );
}

function billingReferenceXml(invoice: ParsedUblInvoiceInput): string {
  const reference = invoice.billingReference;
  if (reference === undefined) return '';
  return element(
    'cac:BillingReference',
    element(
      'cac:InvoiceDocumentReference',
      textElement('cbc:ID', reference.originInvoiceNumber) +
        element('cbc:UUID', reference.xhubUuid) +
        (reference.issueDate === undefined ? '' : element('cbc:IssueDate', reference.issueDate)),
    ),
  );
}

/**
 * Génère un document OASIS UBL 2.1 (profil provisoire cius-ma-provisional) pour les types 380, 381, 383, 386, 389.
 * Pur et déterministe : aucune horloge, aucun aléa, aucune E/S. Mode de secours TypeScript (ADR-09).
 * Ordre de contrôle : entrée Zod stricte, format et cohérence du numéro, BillingReference du 381, totaux recalculés.
 */
export function generateUblInvoiceXml(input: UblInvoiceInput): string {
  const invoice = parseUblInvoiceInput(input);
  const layout = LAYOUT_BY_TYPE[invoice.typeCode];

  const parsedNumber = parseInvoiceNumber(invoice.number);
  if (parsedNumber === undefined) {
    throw new UblGeneratorError('UBL_INVOICE_NUMBER_INVALID', 'Numéro attendu : {FAC|AVO|NDB|ACO|AUT}-{AAAA}-{SEQ6}.');
  }
  if (parsedNumber.typeCode !== invoice.typeCode) {
    throw new UblGeneratorError(
      'UBL_NUMBER_TYPE_MISMATCH',
      `Le préfixe du numéro doit être ${INVOICE_NUMBER_PREFIX_BY_TYPE[invoice.typeCode]} pour le type ${invoice.typeCode}.`,
    );
  }
  if (invoice.typeCode === '383' && invoice.buyerReference !== undefined) {
    // Le schéma OASIS UBL 2.1 DebitNote ne définit pas cbc:BuyerReference : refus plutôt que perte silencieuse.
    throw new UblGeneratorError('UBL_INPUT_INVALID', 'buyerReference n’existe pas dans le schéma DebitNote.', [
      { path: 'buyerReference', code: 'custom' },
    ]);
  }
  if (invoice.typeCode === '381' && invoice.billingReference === undefined) {
    throw new UblGeneratorError(
      'UBL_BILLING_REFERENCE_REQUIRED',
      'Un avoir (381) référence obligatoirement l’UUID xHub de la facture initiale (BillingReference).',
    );
  }

  const totals = computeTotals(invoice);
  assertDeclaredTotals(invoice, totals);

  const header =
    element('cbc:UBLVersionID', CIUS_MA_PROVISIONAL.ublVersionId) +
    element('cbc:CustomizationID', CIUS_MA_PROVISIONAL.customizationId) +
    element('cbc:ProfileID', CIUS_MA_PROVISIONAL.profileId) +
    textElement('cbc:ID', invoice.number) +
    element('cbc:IssueDate', invoice.issueDate) +
    (layout.hasDueDate && invoice.dueDate !== undefined ? element('cbc:DueDate', invoice.dueDate) : '') +
    (layout.typeElement === undefined ? '' : element(`cbc:${layout.typeElement}`, invoice.typeCode)) +
    (invoice.note === undefined ? '' : textElement('cbc:Note', invoice.note)) +
    element('cbc:DocumentCurrencyCode', invoice.currencyCode) +
    (invoice.buyerReference === undefined ? '' : textElement('cbc:BuyerReference', invoice.buyerReference)) +
    billingReferenceXml(invoice) +
    element('cac:AccountingSupplierParty', partyXml(invoice.supplier)) +
    element('cac:AccountingCustomerParty', partyXml(invoice.customer)) +
    paymentMeansXml(layout, invoice) +
    taxTotalXml(totals) +
    monetaryTotalXml(layout, totals);

  const lines = invoice.lines.map((line, index) => lineXml(layout, line, totals.lines[index] as ComputedLine, index + 1)).join('');

  const namespaces: Readonly<Record<string, string>> = {
    xmlns: `urn:oasis:names:specification:ubl:schema:xsd:${layout.root}-2`,
    'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${element(layout.root, header + lines, namespaces)}\n`;
}
