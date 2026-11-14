export const PACKAGE_NAME = '@fisca/ubl-xades' as const;

export * from './errors.ts';
export * from './profile.ts';
export * from './schema-resolver.ts';
export * from './amount-in-words/index.ts';
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
export { signUblXades, verifyUblXades, XMLLINT_MAX_SERIAL_DIGITS, NS_DS, NS_XADES, NS_UBL_EXT } from './signature/xades.ts';
export type { SignUblXadesOptions, SignedUblXades, SignaturePolicyHypothesis, VerifyUblXadesOptions, VerifyUblXadesResult } from './signature/xades.ts';
export {
  CSC_DEFAULT_TIMEOUT_MS,
  CSC_HASH_ALGORITHM_OID,
  CSC_MAX_LOGIN_RETRIES,
  CSC_SIGN_ALGO_OID,
  CscSignerError,
  fetchBaridEsignCscV2Certificate,
  normalizeCscSignature,
  signDigestViaBaridEsignCscV2,
} from './signature/csc-client.ts';
export type {
  BaridEsignCscV2Config,
  CscAuthObject,
  CscHttpClient,
  CscPhase,
  CscRequestInit,
  CscResponse,
  CscSignerErrorCode,
  NormalizeCscSignatureOptions,
} from './signature/csc-client.ts';
export { subjectDistinguishedNameForEmitterCheck } from './signature/certificate.ts';
export { buildTimeStampRequest, parseTimeStampToken, extractTimeStampTokenFromResponse } from './signature/timestamp.ts';
export type { ParsedTimeStampToken, TimeStampRequest, TimeStampRequestOptions } from './signature/timestamp.ts';
export { preparePadesSignature, finalizePadesSignature, signPades } from './signature/pades.ts';
export type { PreparedPadesSignature, PreparePadesOptions, SignPadesOptions, SignedPades } from './signature/pades.ts';
export * from './facturx/schema.ts';
export { FacturXRequestError, buildFacturXRequest } from './facturx/build-request.ts';
export type { BuildFacturXRequestOptions } from './facturx/build-request.ts';
export { FiscalJavaClient, FiscalJavaClientError, ValidationReportSchema } from './facturx/client.ts';
export type {
  FiscalJavaClientConfig,
  FiscalJavaClientErrorCode,
  FiscalJavaHttpClient,
  FiscalJavaHttpResponse,
  FiscalJavaRequestInit,
  FiscalJavaValidationReport,
} from './facturx/client.ts';
