import { amountInWords } from '../amount-in-words/index.ts';
import { computeInvoiceTotals, parseUblInvoiceInput } from '../generator/generate.ts';
import type { ParsedUblInvoiceInput, UblInvoiceInput } from '../generator/input.ts';
import { toBase64, utf8 } from '../signature/bytes.ts';
import { FacturXRequestSchema, type FacturXRequest } from './schema.ts';

export class FacturXRequestError extends Error {
  readonly code: 'FACTURX_REQUEST_INVALID' | 'FACTURX_AMOUNT_UNSAFE';

  constructor(code: 'FACTURX_REQUEST_INVALID' | 'FACTURX_AMOUNT_UNSAFE', message: string) {
    super(message);
    this.name = 'FacturXRequestError';
    this.code = code;
  }
}

export interface BuildFacturXRequestOptions {
  /** Entrée du générateur UBL (la même que pour `generateUblInvoiceXml`) : lignes, parties, totaux recalculés. */
  readonly input: UblInvoiceInput;
  /** XML UBL 2.1 à embarquer (texte UTF-8 ou octets), déjà validé et éventuellement signé. */
  readonly xml: string | Uint8Array;
  /** UUID xHub propre à CETTE facture (pas celui de la facture d'origine d'un avoir) : contenu du QR de vérification. */
  readonly xhubUuid: string;
  /** Domaine public de vérification (paramètre de configuration, HTTPS) ; jamais une constante du paquet. */
  readonly verificationBaseUrl: string;
  readonly supplierNameAr?: string;
  readonly customerNameAr?: string;
  readonly legalMentionsFr?: readonly string[];
  readonly legalMentionsAr?: readonly string[];
  readonly attachmentRelationship?: 'Alternative' | 'Data';
  /** Par défaut `true` : joint les arrêtés calculés ici ; le conteneur les recalcule et refuse toute divergence. */
  readonly includeExpectedAmountInWords?: boolean;
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new FacturXRequestError('FACTURX_AMOUNT_UNSAFE', 'Montant au-delà de l’entier sûr JSON.');
  }
  return Number(value);
}

function partyOf(party: ParsedUblInvoiceInput['supplier'], nameAr: string | undefined): FacturXRequest['presentation']['supplier'] {
  const address = party.address;
  return {
    name: party.name,
    ...(nameAr === undefined ? {} : { nameAr }),
    ...(party.ice === undefined ? {} : { ice: party.ice }),
    ...(party.identifiantFiscal === undefined ? {} : { identifiantFiscal: party.identifiantFiscal }),
    ...(party.rc === undefined ? {} : { rc: party.rc }),
    ...(party.taxeProfessionnelle === undefined ? {} : { taxeProfessionnelle: party.taxeProfessionnelle }),
    ...(party.cnss === undefined ? {} : { cnss: party.cnss }),
    ...(party.legalForm === undefined ? {} : { legalForm: party.legalForm }),
    ...(party.shareCapitalCents === undefined ? {} : { shareCapitalCents: safeNumber(BigInt(party.shareCapitalCents)) }),
    addressLines: [address.street, `${address.postalZone === undefined ? '' : `${address.postalZone} `}${address.city}, ${address.countryCode}`],
  };
}

/**
 * Construit le corps de `POST /facturx` depuis l'entrée du générateur UBL : même source que le XML, totaux recalculés par
 * `computeInvoiceTotals` (Loi 1, entiers). Les arrêtés en lettres FR et AR sont calculés ici (fonctions pures de
 * `amount-in-words`) et joints comme garde-fou ; le conteneur les recalcule et reste le producteur du texte du PDF.
 * Lève `UblGeneratorError` (entrée invalide), `AmountInWordsError` (TTC au-delà du plafond) ou `FacturXRequestError`.
 */
export function buildFacturXRequest(options: BuildFacturXRequestOptions): FacturXRequest {
  const parsed = parseUblInvoiceInput(options.input);
  const totals = computeInvoiceTotals(options.input);
  // Le plafond est contrôlé même sans arrêtés joints : un TTC hors plafond ne produit jamais de requête.
  const computedWords = amountInWords(totals.taxInclusiveCents);
  const words = options.includeExpectedAmountInWords === false ? undefined : computedWords;
  const xmlBytes = typeof options.xml === 'string' ? utf8(options.xml) : options.xml;
  const candidate = {
    xmlBase64: toBase64(xmlBytes),
    ...(options.attachmentRelationship === undefined ? {} : { attachmentRelationship: options.attachmentRelationship }),
    presentation: {
      typeCode: parsed.typeCode,
      invoiceNumber: parsed.number,
      issueDate: parsed.issueDate,
      ...(parsed.dueDate === undefined ? {} : { dueDate: parsed.dueDate }),
      currencyCode: parsed.currencyCode,
      supplier: partyOf(parsed.supplier, options.supplierNameAr),
      customer: partyOf(parsed.customer, options.customerNameAr),
      lines: parsed.lines.map((line, index) => ({
        descriptionFr: line.descriptionFr,
        ...(line.descriptionAr === undefined ? {} : { descriptionAr: line.descriptionAr }),
        quantityMilli: line.quantityMilli,
        unitCode: line.unitCode,
        unitPriceCents: line.unitPriceCents,
        discountBps: line.discountBps,
        vatRateBps: line.vatRateBps,
        lineTotalCents: safeNumber(totals.lines[index]?.lineExtensionCents ?? 0n),
      })),
      vatBreakdown: totals.taxSubtotals.map((subtotal) => ({
        vatRateBps: subtotal.vatRateBps,
        taxableCents: safeNumber(subtotal.taxableCents),
        taxCents: safeNumber(subtotal.taxCents),
      })),
      totals: {
        lineExtensionCents: safeNumber(totals.lineExtensionCents),
        taxTotalCents: safeNumber(totals.taxTotalCents),
        stampDutyCents: safeNumber(totals.stampDutyCents),
        taxExclusiveCents: safeNumber(totals.taxExclusiveCents),
        taxInclusiveCents: safeNumber(totals.taxInclusiveCents),
        retentionCents: safeNumber(totals.retentionCents),
        payableCents: safeNumber(totals.payableCents),
      },
      ...(options.legalMentionsFr === undefined ? {} : { legalMentionsFr: [...options.legalMentionsFr] }),
      ...(options.legalMentionsAr === undefined ? {} : { legalMentionsAr: [...options.legalMentionsAr] }),
    },
    verification: { baseUrl: options.verificationBaseUrl, xhubUuid: options.xhubUuid },
    ...(words === undefined ? {} : { expectedAmountInWords: { fr: words.fr, ar: words.ar } }),
  };
  const result = FacturXRequestSchema.safeParse(candidate);
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join('.') || '(racine)');
    throw new FacturXRequestError('FACTURX_REQUEST_INVALID', `Requête /facturx invalide : ${paths.join(', ')}.`);
  }
  return result.data;
}
