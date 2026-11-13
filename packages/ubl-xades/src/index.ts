export const PACKAGE_NAME = '@fisca/ubl-xades' as const;

export * from './errors.ts';
export * from './profile.ts';
export * from './schema-resolver.ts';
export * from './generator/format.ts';
export * from './generator/input.ts';
export * from './generator/invoice-number.ts';
export * from './generator/pih.ts';
export * from './generator/totals.ts';
export {
  computeInvoiceTotals,
  computeUblInvoicePih,
  documentKindOf,
  generateUblInvoiceXml,
  parseUblInvoiceInput,
  pihFieldsOfInvoice,
} from './generator/generate.ts';
export * from './known-phive-deviations.ts';
export * from './signature/errors.ts';
export * from './signature/types.ts';
export { canonicalizeC14n11, canonicalizeExclusive, canonicalizeTree, joinXmlBase, C14N11_ALGORITHM, EXC_C14N_ALGORITHM } from './signature/c14n.ts';
export { parseXml } from './signature/xml-parser.ts';
export type { XmlDocument, XmlElement } from './signature/xml-parser.ts';
export { signUblXades, verifyUblXades, NS_DS, NS_XADES, NS_UBL_EXT } from './signature/xades.ts';
export type { SignUblXadesOptions, SignedUblXades, SignaturePolicyHypothesis, VerifyUblXadesOptions, VerifyUblXadesResult } from './signature/xades.ts';
export { buildTimeStampRequest, parseTimeStampToken, extractTimeStampTokenFromResponse } from './signature/timestamp.ts';
export type { ParsedTimeStampToken, TimeStampRequest, TimeStampRequestOptions } from './signature/timestamp.ts';
export { preparePadesSignature, finalizePadesSignature, signPades } from './signature/pades.ts';
export type { PreparedPadesSignature, PreparePadesOptions, SignPadesOptions, SignedPades } from './signature/pades.ts';
