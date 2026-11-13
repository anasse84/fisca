import { describe, expect, it } from 'vitest';
import {
  computeInvoiceTotals,
  formatBpsPercent,
  generateUblInvoiceXml,
  UblGeneratorError,
  type UblInvoiceInput,
} from '../src/index.ts';
import { buildFullInput, buildInput, EXPECTED_FULL, retentionRule, stampDutyRule } from './support/fixtures.ts';

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof UblGeneratorError) return error.code;
    throw error;
  }
  return 'AUCUNE_ERREUR';
}

const SERVICE = { descriptionFr: 'Travaux', quantityMilli: 1000, unitPriceCents: 100000, vatRateBps: 2000 } as const;
const DEBOURS = { descriptionFr: 'Débours', quantityMilli: 1000, unitPriceCents: 50000, vatRateBps: 0, isDisbursementDebours: true } as const;

describe('A. débours hors TVA', () => {
  it('comptés dans le TTC et le net à payer, pas dans la base de TVA', () => {
    const totals = computeInvoiceTotals({ ...buildInput('380'), lines: [SERVICE, DEBOURS] });
    expect(totals.vatBaseCents).toBe(100000n);
    expect(totals.disbursementsCents).toBe(50000n);
    expect(totals.taxTotalCents).toBe(20000n);
    expect(totals.taxInclusiveCents).toBe(170000n);
    expect(totals.payableCents).toBe(170000n);
    expect(totals.taxSubtotals.map((subtotal) => [subtotal.categoryCode, subtotal.taxableCents, subtotal.taxCents])).toEqual([
      ['S', 100000n, 20000n],
      ['O', 50000n, 0n],
    ]);
  });

  it('XML : ligne en catégorie O sans pourcentage ; sous-total O sans pourcentage', () => {
    const xml = generateUblInvoiceXml({ ...buildInput('380'), lines: [SERVICE, DEBOURS] });
    expect(xml).toContain('<cac:ClassifiedTaxCategory><cbc:ID>O</cbc:ID><cac:TaxScheme>');
    expect(xml).toContain('<cbc:ID>O</cbc:ID><cbc:TaxExemptionReason>Débours : hors champ de la TVA</cbc:TaxExemptionReason>');
    expect(xml).not.toMatch(/<cbc:ID>O<\/cbc:ID><cbc:Percent>/);
  });
});

describe('B. retenue de garantie BTP', () => {
  it.each([
    [700, 'LINE_EXTENSION', 86420n, 1395060n],
    [1000, 'LINE_EXTENSION', 123457n, 1358023n],
    [700, 'TAX_INCLUSIVE', 103704n, 1377776n],
  ] as const)('%i bps sur %s : retenue %s, net à payer %s', (rateBps, basis, retention, payable) => {
    const totals = computeInvoiceTotals({
      ...buildInput('380'),
      lines: [{ descriptionFr: 'Décompte', quantityMilli: 1000, unitPriceCents: 1234567, vatRateBps: 2000 }],
      retention: retentionRule(rateBps, basis),
    });
    expect(totals.retentionCents).toBe(retention);
    expect(totals.payableCents).toBe(payable);
    expect(totals.taxTotalCents).toBe(246913n);
    expect(totals.vatBaseCents).toBe(1234567n);
    expect(totals.taxInclusiveCents).toBe(1481480n);
  });

  it('demi supérieur : 703,5 → 704', () => {
    const totals = computeInvoiceTotals({
      ...buildInput('380'),
      lines: [{ descriptionFr: 'Décompte', quantityMilli: 1000, unitPriceCents: 10050, vatRateBps: 2000 }],
      retention: retentionRule(700),
    });
    expect(totals.retentionCents).toBe(704n);
  });

  it('XML : WithholdingTaxTotal avant LegalMonetaryTotal, PayableAmount réduit, TaxTotal intact', () => {
    const xml = generateUblInvoiceXml(buildFullInput('380'));
    expect(xml).toContain(
      '<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="MAD">105.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="MAD">1500.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="MAD">105.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>7</cbc:Percent>',
    );
    expect(xml.indexOf('</cac:TaxTotal><cac:WithholdingTaxTotal>')).toBeGreaterThan(0);
    expect(xml.indexOf('<cac:WithholdingTaxTotal>')).toBeLessThan(xml.indexOf('<cac:LegalMonetaryTotal>'));
    expect(xml).toContain('<cbc:PayableAmount currencyID="MAD">1599.25</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="MAD">1704.25</cbc:TaxInclusiveAmount>');
  });

  it('le taux doit appartenir à l’ensemble fourni par l’appelant', () => {
    const input: UblInvoiceInput = { ...buildInput('380'), retention: { ...retentionRule(700), rateBps: 500 } };
    expect(codeOf(() => generateUblInvoiceXml(input))).toBe('UBL_RETENTION_INVALID');
    const custom: UblInvoiceInput = { ...buildInput('380'), retention: { ...retentionRule(500), allowedRatesBps: [500] } };
    expect(computeInvoiceTotals(custom).retentionCents).toBe(5500n);
  });

  it('règle datée postérieure à l’émission refusée', () => {
    const input: UblInvoiceInput = { ...buildInput('380'), retention: { ...retentionRule(700), ruleDate: '2026-12-01' } };
    expect(codeOf(() => generateUblInvoiceXml(input))).toBe('UBL_RETENTION_INVALID');
  });

  it('pas d’emplacement dans CreditNote ni DebitNote : refus explicite', () => {
    expect(codeOf(() => generateUblInvoiceXml({ ...buildInput('381'), retention: retentionRule(700) }))).toBe('UBL_RETENTION_INVALID');
    expect(codeOf(() => generateUblInvoiceXml({ ...buildInput('383'), retention: retentionRule(700) }))).toBe('UBL_RETENTION_INVALID');
  });

  it('les totaux déclarés de retenue sont contrôlés', () => {
    const input: UblInvoiceInput = { ...buildFullInput('380'), declaredTotals: { retentionCents: 10501 } };
    expect(codeOf(() => generateUblInvoiceXml(input))).toBe('UBL_TOTALS_MISMATCH');
    expect(codeOf(() => generateUblInvoiceXml({ ...buildFullInput('380'), declaredTotals: { retentionCents: 10500, payableCents: 159925 } }))).toBe('AUCUNE_ERREUR');
  });
});

describe('C. droit de timbre sur espèces', () => {
  it.each([
    [12600, 32n, 12632n],
    [10000, 25n, 12025n],
  ] as const)('espèces %i c : timbre %s, TTC %s', (cash, stamp, ttc) => {
    const unit = cash === 12600 ? 10500 : 10000;
    const totals = computeInvoiceTotals({
      ...buildInput('380'),
      lines: [{ descriptionFr: 'Vente', quantityMilli: 1000, unitPriceCents: unit, vatRateBps: 2000 }],
      stampDuty: stampDutyRule(cash),
    });
    expect(totals.stampDutyCents).toBe(stamp);
    expect(totals.taxInclusiveCents).toBe(ttc);
    expect(totals.vatBaseCents).toBe(BigInt(unit));
  });

  it('XML : AllowanceCharge ChargeIndicator true, raison « Droit de timbre », catégorie O, ChargeTotalAmount', () => {
    const xml = generateUblInvoiceXml(buildFullInput('380'));
    expect(xml).toContain(
      '<cac:AllowanceCharge><cbc:ChargeIndicator>true</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Droit de timbre</cbc:AllowanceChargeReason><cbc:MultiplierFactorNumeric>0.25</cbc:MultiplierFactorNumeric><cbc:Amount currencyID="MAD">4.25</cbc:Amount><cbc:BaseAmount currencyID="MAD">1700.00</cbc:BaseAmount><cac:TaxCategory><cbc:ID>O</cbc:ID>',
    );
    expect(xml).toContain('<cbc:ChargeTotalAmount currencyID="MAD">4.25</cbc:ChargeTotalAmount>');
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="MAD">1504.25</cbc:TaxExclusiveAmount>');
  });

  it('DebitNote : AllowanceCharge avant PaymentMeans (ordre du schéma)', () => {
    const xml = generateUblInvoiceXml({ ...buildInput('383'), paymentMeansCode: '10', stampDuty: stampDutyRule(1000) });
    expect(xml.indexOf('<cac:AllowanceCharge>')).toBeLessThan(xml.indexOf('<cac:PaymentMeans>'));
    const invoice = generateUblInvoiceXml({ ...buildInput('380'), paymentMeansCode: '10', stampDuty: stampDutyRule(1000) });
    expect(invoice.indexOf('<cac:AllowanceCharge>')).toBeGreaterThan(invoice.indexOf('</cac:PaymentMeans>'));
  });

  it('timbre sans débours : sous-total O créé avec raison dédiée', () => {
    const xml = generateUblInvoiceXml({ ...buildInput('380'), stampDuty: stampDutyRule(1000) });
    expect(xml).toContain('Droit de timbre : hors champ de la TVA');
  });

  it('taux hors ensemble, espèces supérieures au TTC, espèces nulles : refus typés', () => {
    const base = buildInput('380');
    expect(codeOf(() => generateUblInvoiceXml({ ...base, stampDuty: { ...stampDutyRule(1000), rateBps: 30 } }))).toBe('UBL_STAMP_DUTY_INVALID');
    expect(codeOf(() => generateUblInvoiceXml({ ...base, stampDuty: stampDutyRule(131001) }))).toBe('UBL_STAMP_DUTY_INVALID');
    expect(codeOf(() => generateUblInvoiceXml({ ...base, stampDuty: stampDutyRule(0) }))).toBe('UBL_STAMP_DUTY_INVALID');
    expect(codeOf(() => generateUblInvoiceXml({ ...base, stampDuty: stampDutyRule(131000) }))).toBe('AUCUNE_ERREUR');
  });
});

describe('document complet', () => {
  it('totaux : débours + retenue + timbre', () => {
    const totals = computeInvoiceTotals(buildFullInput('380'));
    const expected = EXPECTED_FULL;
    expect({
      lineExtensionCents: Number(totals.lineExtensionCents),
      vatBaseCents: Number(totals.vatBaseCents),
      disbursementsCents: Number(totals.disbursementsCents),
      taxTotalCents: Number(totals.taxTotalCents),
      stampDutyCents: Number(totals.stampDutyCents),
      taxExclusiveCents: Number(totals.taxExclusiveCents),
      taxInclusiveCents: Number(totals.taxInclusiveCents),
      retentionCents: Number(totals.retentionCents),
      payableCents: Number(totals.payableCents),
    }).toEqual(expected);
  });

  it('formatBpsPercent', () => {
    expect([700n, 1000n, 25n, 5n, 2050n].map(formatBpsPercent)).toEqual(['7', '10', '0.25', '0.05', '20.5']);
  });
});
