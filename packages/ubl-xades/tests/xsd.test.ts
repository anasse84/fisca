import { describe, expect, it } from 'vitest';
import { documentKindOf, generateUblInvoiceXml, resolveSchema, schemaKindOfTypeCode, type UblDocumentKind } from '../src/index.ts';
import { buildFullInput, buildInput, TYPE_CODES } from './support/fixtures.ts';
import { validateWithXmllint } from './support/xmllint.ts';

const KIND_BY_TYPE: Record<(typeof TYPE_CODES)[number], UblDocumentKind> = {
  '380': 'invoice',
  '381': 'credit-note',
  '383': 'invoice',
  '386': 'invoice',
  '389': 'invoice',
};

describe('XML généré valide contre le XSD OASIS UBL 2.1 officiel (xmllint)', () => {
  it.each(TYPE_CODES)('type %s', (code) => {
    const xml = generateUblInvoiceXml(buildInput(code));
    const result = validateWithXmllint(xml, resolveSchema(KIND_BY_TYPE[code], '2.1').path);
    expect(result.output).toContain('validates');
    expect(result.valid).toBe(true);
  });

  it.each(['380', '381', '383', '386', '389'] as const)(
    'type %s avec débours, timbre, PIH/ICV (et retenue hors 381) : valide',
    (code) => {
      const xml = generateUblInvoiceXml(buildFullInput(code));
      const result = validateWithXmllint(xml, resolveSchema(KIND_BY_TYPE[code], '2.1').path);
      expect(result.output).toContain('validates');
      expect(result.valid).toBe(true);
      expect(xml.includes('<cac:WithholdingTaxTotal>')).toBe(code !== '381');
    },
  );

  it('type 383 : racine Invoice, InvoiceTypeCode 383, DueDate et retenue de garantie valides XSD (UBL-Invoice-2.1.xsd)', () => {
    const xml = generateUblInvoiceXml(buildFullInput('383'));
    expect(xml).toContain('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
    expect(xml).toContain('<cbc:InvoiceTypeCode>383</cbc:InvoiceTypeCode>');
    expect(xml).toContain('<cbc:DueDate>2026-12-13</cbc:DueDate>');
    expect(xml).not.toContain('DebitNote');
    expect(documentKindOf('383')).toBe('invoice');
    expect(schemaKindOfTypeCode('383')).toBe('invoice');
    expect(schemaKindOfTypeCode('381')).toBe('credit-note');
    const schema = resolveSchema(schemaKindOfTypeCode('383'), '2.1');
    expect(schema.path.endsWith('/UBL-Invoice-2.1.xsd')).toBe(true);
    expect(validateWithXmllint(xml, schema.path).valid).toBe(true);
  });

  it('un WithholdingTaxTotal hors schéma (CreditNote) est bien rejeté par xmllint', () => {
    const xml = generateUblInvoiceXml(buildFullInput('380')).replace('<Invoice ', '<CreditNote ').replace('</Invoice>', '</CreditNote>');
    expect(validateWithXmllint(xml, resolveSchema('credit-note', '2.1').path).valid).toBe(false);
  });

  it('xmllint rejette bien un document hors schéma (le test détecte les échecs)', () => {
    const xml = generateUblInvoiceXml(buildInput('380')).replace('<cbc:IssueDate>', '<cbc:BaliseInconnue>x</cbc:BaliseInconnue><cbc:IssueDate>');
    expect(validateWithXmllint(xml, resolveSchema('invoice', '2.1').path).valid).toBe(false);
  });
});
