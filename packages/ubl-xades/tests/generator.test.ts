import { describe, expect, it } from 'vitest';
import {
  computeInvoiceTotals,
  generateUblInvoiceXml,
  UblGeneratorError,
  type UblInvoiceInput,
} from '../src/index.ts';
import { buildInput, CUSTOMER_ICE, EXPECTED_TOTALS, SUPPLIER_ICE, TYPE_CODES, XHUB_UUID } from './support/fixtures.ts';

function expectCode(action: () => unknown, code: string): UblGeneratorError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(UblGeneratorError);
    const typed = error as UblGeneratorError;
    expect(typed.code).toBe(code);
    return typed;
  }
  throw new Error(`Aucune erreur levée, ${code} attendu`);
}

describe('types de document', () => {
  it.each([
    ['380', 'Invoice', 'InvoiceTypeCode', 'InvoiceLine', 'LegalMonetaryTotal'],
    ['381', 'CreditNote', 'CreditNoteTypeCode', 'CreditNoteLine', 'LegalMonetaryTotal'],
    ['383', 'DebitNote', undefined, 'DebitNoteLine', 'RequestedMonetaryTotal'],
    ['386', 'Invoice', 'InvoiceTypeCode', 'InvoiceLine', 'LegalMonetaryTotal'],
    ['389', 'Invoice', 'InvoiceTypeCode', 'InvoiceLine', 'LegalMonetaryTotal'],
  ] as const)('%s → racine %s, %s', (code, root, typeElement, lineElement, totalElement) => {
    const xml = generateUblInvoiceXml(buildInput(code));
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain(`<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2"`);
    if (typeElement === undefined) {
      // OASIS UBL 2.1 DebitNote ne définit pas d'élément de code de type : le type 383 est porté par la racine et le numéro NDB.
      expect(xml).not.toContain('TypeCode');
      expect(xml).toContain('<cbc:ID>NDB-2026-000001</cbc:ID>');
    } else {
      expect(xml).toContain(`<cbc:${typeElement}>${code}</cbc:${typeElement}>`);
    }
    expect(xml).toContain(`<cac:${lineElement}>`);
    expect(xml).toContain(`<cac:${totalElement}>`);
    expect(xml).toContain('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>');
    expect(xml).toContain('<cbc:CustomizationID>ma:cius-ma-provisional:1.0</cbc:CustomizationID>');
    expect(xml).toContain('<cbc:ProfileID>ma:cius-ma-provisional:1.0</cbc:ProfileID>');
  });

  it('la devise et les montants sont en MAD avec deux décimales', () => {
    const xml = generateUblInvoiceXml(buildInput('380'));
    expect(xml).toContain('<cbc:DocumentCurrencyCode>MAD</cbc:DocumentCurrencyCode>');
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="MAD">1100.00</cbc:LineExtensionAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="MAD">1310.00</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="MAD">1310.00</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="C62">2.5</cbc:InvoicedQuantity>');
  });

  it('refuse buyerReference sur une note de débit (absent du schéma DebitNote)', () => {
    const input: UblInvoiceInput = { ...buildInput('383'), buyerReference: 'REF' };
    expectCode(() => generateUblInvoiceXml(input), 'UBL_INPUT_INVALID');
  });

  it('un numéro dont le préfixe ne correspond pas au type est rejeté', () => {
    const input: UblInvoiceInput = { ...buildInput('380'), number: 'AVO-2026-000001' };
    expectCode(() => generateUblInvoiceXml(input), 'UBL_NUMBER_TYPE_MISMATCH');
  });

  it('un numéro mal formé est rejeté', () => {
    const input: UblInvoiceInput = { ...buildInput('380'), number: 'FA-2026-1' };
    expectCode(() => generateUblInvoiceXml(input), 'UBL_INVOICE_NUMBER_INVALID');
  });
});

describe('BillingReference de l’avoir 381', () => {
  it('porte l’UUID xHub initial et le numéro de la facture d’origine', () => {
    const xml = generateUblInvoiceXml(buildInput('381'));
    expect(xml).toContain(
      `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>FAC-2026-000001</cbc:ID><cbc:UUID>${XHUB_UUID}</cbc:UUID><cbc:IssueDate>2026-11-01</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>`,
    );
  });

  it('rejette un avoir sans BillingReference par une erreur typée', () => {
    const withoutReference = { ...buildInput('381'), billingReference: undefined } as unknown as UblInvoiceInput;
    const error = expectCode(() => generateUblInvoiceXml(withoutReference), 'UBL_BILLING_REFERENCE_REQUIRED');
    expect(error.message).toContain('381');
  });

  it('rejette un UUID xHub mal formé', () => {
    const input: UblInvoiceInput = {
      ...buildInput('381'),
      billingReference: { originInvoiceNumber: 'FAC-2026-000001', xhubUuid: 'pas-un-uuid' },
    };
    expectCode(() => generateUblInvoiceXml(input), 'UBL_INPUT_INVALID');
  });
});

describe('totaux recalculés et comparés', () => {
  it('recalcule les totaux à partir des lignes', () => {
    expect(computeInvoiceTotals(buildInput('380'))).toMatchObject({
      lineExtensionCents: 110000n,
      taxExclusiveCents: 110000n,
      taxTotalCents: 21000n,
      taxInclusiveCents: 131000n,
      payableCents: 131000n,
    });
  });

  it('accepte des totaux déclarés cohérents', () => {
    const input: UblInvoiceInput = { ...buildInput('380'), declaredTotals: { ...EXPECTED_TOTALS } };
    expect(() => generateUblInvoiceXml(input)).not.toThrow();
  });

  it('rejette un total incohérent en nommant le champ', () => {
    const input: UblInvoiceInput = {
      ...buildInput('380'),
      declaredTotals: { ...EXPECTED_TOTALS, payableCents: EXPECTED_TOTALS.payableCents + 1 },
    };
    const error = expectCode(() => generateUblInvoiceXml(input), 'UBL_TOTALS_MISMATCH');
    expect(error.details).toEqual([{ field: 'payableCents', expectedCents: '131000', declaredCents: '131001' }]);
  });

  it('arrondit au demi supérieur une ligne à quantité en milli-unités', () => {
    // 0,333 × 1,50 = 0,4995 → 0,50 ; TVA 20 % de 0,50 = 0,10
    const input: UblInvoiceInput = {
      ...buildInput('380'),
      lines: [{ descriptionFr: 'Fraction', quantityMilli: 333, unitPriceCents: 150, vatRateBps: 2000 }],
    };
    const totals = computeInvoiceTotals(input);
    expect(totals.lines[0]?.lineExtensionCents).toBe(50n);
    expect(totals.taxTotalCents).toBe(10n);
    // 0,001 × 0,50 = 0,0005 → 0,00 ; 0,003 × 1,50 = 0,0045 → 0,00 ; 0,500 × 0,05 = 0,025 → 0,03
    const half: UblInvoiceInput = {
      ...buildInput('380'),
      lines: [{ descriptionFr: 'Demi', quantityMilli: 500, unitPriceCents: 5, vatRateBps: 0 }],
    };
    expect(computeInvoiceTotals(half).lines[0]?.lineExtensionCents).toBe(3n);
  });

  it('arrondit la TVA par catégorie (demi supérieur) et non ligne par ligne', () => {
    // deux lignes de 0,05 à 10 % : TVA catégorie = 0,10 × 10 % = 0,01 ; ligne par ligne on aurait 0,01 + 0,01
    const input: UblInvoiceInput = {
      ...buildInput('380'),
      lines: [
        { descriptionFr: 'Un', quantityMilli: 1000, unitPriceCents: 5, vatRateBps: 1000 },
        { descriptionFr: 'Deux', quantityMilli: 1000, unitPriceCents: 5, vatRateBps: 1000 },
      ],
    };
    const totals = computeInvoiceTotals(input);
    expect(totals.taxTotalCents).toBe(1n);
    expect(totals.taxSubtotals).toHaveLength(1);
  });

  it('applique la remise de ligne en bps avec arrondi demi supérieur', () => {
    // 3 × 10,01 = 30,03 ; remise 10 % = 3,003 → 3,00 ; net 27,03
    const input: UblInvoiceInput = {
      ...buildInput('380'),
      lines: [{ descriptionFr: 'Remisé', quantityMilli: 3000, unitPriceCents: 1001, discountBps: 1000, vatRateBps: 0 }],
    };
    const totals = computeInvoiceTotals(input);
    expect(totals.lines[0]).toMatchObject({ grossCents: 3003n, discountCents: 300n, lineExtensionCents: 2703n });
    const xml = generateUblInvoiceXml(input);
    expect(xml).toContain('<cbc:ChargeIndicator>false</cbc:ChargeIndicator>');
    expect(xml).toContain('<cbc:Amount currencyID="MAD">3.00</cbc:Amount><cbc:BaseAmount currencyID="MAD">30.03</cbc:BaseAmount>');
  });

  it('gère de grands montants sans perte (bigint)', () => {
    const input: UblInvoiceInput = {
      ...buildInput('380'),
      lines: [{ descriptionFr: 'Gros', quantityMilli: 1000000, unitPriceCents: 9007199254740, vatRateBps: 2000 }],
    };
    expect(computeInvoiceTotals(input).lineExtensionCents).toBe(9007199254740000n);
  });
});

describe('taux de TVA (D-04)', () => {
  it.each([700, 1400, 500, 2001, -1, 10000])('rejette %s bps', (rate) => {
    const base = buildInput('380');
    const input = {
      ...base,
      lines: [{ descriptionFr: 'Taux interdit', quantityMilli: 1000, unitPriceCents: 100, vatRateBps: rate }],
    } as unknown as UblInvoiceInput;
    expectCode(() => generateUblInvoiceXml(input), 'UBL_VAT_RATE_INVALID');
  });

  it.each([2000, 1000, 0])('accepte %s bps', (rate) => {
    const input: UblInvoiceInput = {
      ...buildInput('380'),
      lines: [{ descriptionFr: 'Taux admis', quantityMilli: 1000, unitPriceCents: 100, vatRateBps: rate as 2000 | 1000 | 0 }],
    };
    expect(() => generateUblInvoiceXml(input)).not.toThrow();
  });

  it('formate le taux en pourcentage entier et choisit la catégorie', () => {
    const xml = generateUblInvoiceXml({
      ...buildInput('380'),
      lines: [
        { descriptionFr: 'Normal', quantityMilli: 1000, unitPriceCents: 100, vatRateBps: 2000 },
        { descriptionFr: 'Nul', quantityMilli: 1000, unitPriceCents: 100, vatRateBps: 0 },
      ],
    });
    expect(xml).toContain('<cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent>');
    expect(xml).toContain('<cbc:ID>Z</cbc:ID><cbc:Percent>0</cbc:Percent>');
  });

  it('un débours est hors champ (catégorie O, sans pourcentage) et exige un taux nul', () => {
    const debours: UblInvoiceInput = {
      ...buildInput('380'),
      lines: [{ descriptionFr: 'Débours', quantityMilli: 1000, unitPriceCents: 5000, vatRateBps: 0, isDisbursementDebours: true }],
    };
    const xml = generateUblInvoiceXml(debours);
    expect(xml).toContain('<cbc:ID>O</cbc:ID><cbc:TaxExemptionReason>');
    const taxed: UblInvoiceInput = {
      ...buildInput('380'),
      lines: [{ descriptionFr: 'Débours', quantityMilli: 1000, unitPriceCents: 5000, vatRateBps: 2000, isDisbursementDebours: true }],
    };
    expectCode(() => generateUblInvoiceXml(taxed), 'UBL_INPUT_INVALID');
  });
});

describe('validation stricte des entrées', () => {
  it('refuse une clé inconnue (schéma strict)', () => {
    const input = { ...buildInput('380'), companyId: 'x' } as unknown as UblInvoiceInput;
    expectCode(() => generateUblInvoiceXml(input), 'UBL_INPUT_INVALID');
  });

  it('refuse un montant non entier ou non sûr', () => {
    const base = buildInput('380');
    const fractional = {
      ...base,
      lines: [{ descriptionFr: 'Flottant', quantityMilli: 1000, unitPriceCents: Number('10.5'), vatRateBps: 0 }],
    } as unknown as UblInvoiceInput;
    expectCode(() => generateUblInvoiceXml(fractional), 'UBL_INPUT_INVALID');
    const unsafe = {
      ...base,
      lines: [{ descriptionFr: 'Énorme', quantityMilli: 1000, unitPriceCents: Number.MAX_SAFE_INTEGER + 2, vatRateBps: 0 }],
    } as unknown as UblInvoiceInput;
    expectCode(() => generateUblInvoiceXml(unsafe), 'UBL_INPUT_INVALID');
  });

  it.each([
    ['ICE à 14 chiffres', { ice: '00097000000009' }],
    ['ICE avec clé modulo 97 fausse', { ice: '000970000000098' }],
    ['ICE alphabétique', { ice: '00097000000009A' }],
    ['IF non numérique', { identifiantFiscal: '12AB5678' }],
  ])('refuse %s sans recopier la valeur dans l’erreur', (_label, patch) => {
    const base = buildInput('380');
    const input = { ...base, supplier: { ...base.supplier, ...patch } } as unknown as UblInvoiceInput;
    const error = expectCode(() => generateUblInvoiceXml(input), 'UBL_INPUT_INVALID');
    const serialized = `${error.message} ${JSON.stringify(error.details)}`;
    for (const value of Object.values(patch)) {
      expect(serialized).not.toContain(value);
    }
  });

  it('refuse une date inexistante et une échéance antérieure à l’émission', () => {
    expectCode(() => generateUblInvoiceXml({ ...buildInput('380'), issueDate: '2026-02-30' }), 'UBL_INPUT_INVALID');
    expectCode(() => generateUblInvoiceXml({ ...buildInput('380'), dueDate: '2026-11-01' }), 'UBL_INPUT_INVALID');
  });

  it('refuse un caractère interdit en XML 1.0 dans un texte', () => {
    const input: UblInvoiceInput = {
      ...buildInput('380'),
      lines: [{ descriptionFr: 'Texte\u0000NUL', quantityMilli: 1000, unitPriceCents: 100, vatRateBps: 0 }],
    };
    expectCode(() => generateUblInvoiceXml(input), 'UBL_INPUT_INVALID');
  });
});

describe('identifiants marocains (profil provisoire)', () => {
  const xml = generateUblInvoiceXml(buildInput('380'));

  it('ICE → PartyLegalEntity/CompanyID schemeID="MA:ICE"', () => {
    expect(xml).toContain(`<cbc:CompanyID schemeID="MA:ICE">${SUPPLIER_ICE}</cbc:CompanyID>`);
    expect(xml).toContain(`<cbc:CompanyID schemeID="MA:ICE">${CUSTOMER_ICE}</cbc:CompanyID>`);
  });

  it('IF → PartyTaxScheme/CompanyID schemeID="MA:IF"', () => {
    expect(xml).toContain('<cac:PartyTaxScheme><cbc:CompanyID schemeID="MA:IF">12345678</cbc:CompanyID>');
  });

  it('forme juridique et capital → CompanyLegalForm', () => {
    expect(xml).toContain('<cbc:CompanyLegalForm>SARL AU, capital 100000.00 MAD</cbc:CompanyLegalForm>');
  });

  it('RC, Taxe Professionnelle et CNSS → identifiants additionnels de la partie', () => {
    expect(xml).toContain('<cac:PartyIdentification><cbc:ID schemeID="MA:RC">123456</cbc:ID></cac:PartyIdentification>');
    expect(xml).toContain('<cbc:ID schemeID="MA:TP">98765432</cbc:ID>');
    expect(xml).toContain('<cbc:ID schemeID="MA:CNSS">1234567</cbc:ID>');
  });
});

describe('échappement XML et UTF-8', () => {
  it('échappe &, <, >, guillemets et apostrophes dans le contenu et les attributs', () => {
    const base = buildInput('380');
    const xml = generateUblInvoiceXml({
      ...base,
      buyerReference: 'A&B <x> "q" \'a\'',
      supplier: { ...base.supplier, name: 'Dupont & Fils <SARL> "Premium"' },
    });
    expect(xml).toContain('A&amp;B &lt;x&gt; &quot;q&quot; &apos;a&apos;');
    expect(xml).toContain('Dupont &amp; Fils &lt;SARL&gt; &quot;Premium&quot;');
    expect(xml).not.toContain('Dupont & Fils');
  });

  it('conserve l’arabe en UTF-8 (description et raison sociale)', () => {
    const base = buildInput('380');
    const xml = generateUblInvoiceXml({
      ...base,
      customer: { ...base.customer, name: 'شركة الاختبار ش.م.م' },
      lines: [{ descriptionFr: 'Service', descriptionAr: 'خدمة استشارية', quantityMilli: 1000, unitPriceCents: 100, vatRateBps: 0 }],
    });
    expect(xml).toContain('شركة الاختبار ش.م.م');
    expect(xml).toContain('<cbc:Description>خدمة استشارية</cbc:Description>');
    expect(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(xml))).toBe(xml);
  });
});

describe('déterminisme', () => {
  it.each(TYPE_CODES)('deux générations du type %s sont identiques octet pour octet', (code) => {
    const first = new TextEncoder().encode(generateUblInvoiceXml(buildInput(code)));
    const second = new TextEncoder().encode(generateUblInvoiceXml(buildInput(code)));
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it('ne dépend pas de l’ordre des clés de l’entrée', () => {
    const input = buildInput('380');
    const reordered = Object.fromEntries(Object.entries(input).reverse()) as UblInvoiceInput;
    expect(generateUblInvoiceXml(reordered)).toBe(generateUblInvoiceXml(input));
  });
});
