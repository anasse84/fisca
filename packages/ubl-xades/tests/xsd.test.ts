import { describe, expect, it } from 'vitest';
import { generateUblInvoiceXml, resolveSchema, type UblDocumentKind } from '../src/index.ts';
import { buildInput, TYPE_CODES } from './support/fixtures.ts';
import { validateWithXmllint } from './support/xmllint.ts';

const KIND_BY_TYPE: Record<(typeof TYPE_CODES)[number], UblDocumentKind> = {
  '380': 'invoice',
  '381': 'credit-note',
  '383': 'debit-note',
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

  it('xmllint rejette bien un document hors schéma (le test détecte les échecs)', () => {
    const xml = generateUblInvoiceXml(buildInput('380')).replace('<cbc:IssueDate>', '<cbc:BaliseInconnue>x</cbc:BaliseInconnue><cbc:IssueDate>');
    expect(validateWithXmllint(xml, resolveSchema('invoice', '2.1').path).valid).toBe(false);
  });
});
