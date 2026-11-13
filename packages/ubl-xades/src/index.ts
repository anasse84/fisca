export const PACKAGE_NAME = '@fisca/ubl-xades' as const;

export * from './errors.ts';
export * from './profile.ts';
export * from './schema-resolver.ts';
export * from './generator/format.ts';
export * from './generator/input.ts';
export * from './generator/invoice-number.ts';
export * from './generator/totals.ts';
export { computeInvoiceTotals, documentKindOf, generateUblInvoiceXml, parseUblInvoiceInput } from './generator/generate.ts';
