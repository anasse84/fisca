/**
 * Erreurs du module de signature Loi 43-20 (XAdES / PAdES, profil provisoire).
 * Les messages sont constants : jamais de contenu de document, de DN, d'ICE ni de valeur saisie (donnée personnelle).
 */
export type UblSignatureErrorCode =
  | 'XML_MALFORMED'
  | 'XML_DOCTYPE_FORBIDDEN'
  | 'XML_ENTITY_FORBIDDEN'
  | 'XML_LIMIT_EXCEEDED'
  | 'XML_NOT_UBL_DOCUMENT'
  | 'XML_ALREADY_SIGNED'
  | 'C14N_ALGORITHM_UNSUPPORTED'
  | 'DER_MALFORMED'
  | 'CERTIFICATE_INVALID'
  | 'CERTIFICATE_KEY_UNSUPPORTED'
  | 'SIGNER_RESULT_INVALID'
  | 'TIMESTAMP_RESPONSE_INVALID'
  | 'TIMESTAMP_TOKEN_INVALID'
  | 'TIMESTAMP_IMPRINT_MISMATCH'
  | 'TIMESTAMP_NONCE_MISMATCH'
  | 'PDF_UNSUPPORTED_STRUCTURE'
  | 'PDF_SIGNATURE_TOO_LARGE'
  | 'PDF_NOT_PREPARED'
  | 'XADES_STRUCTURE_INVALID'
  | 'XADES_DIGEST_MISMATCH'
  | 'XADES_SIGNATURE_INVALID'
  | 'XADES_CERTIFICATE_MISMATCH'
  | 'XADES_TIMESTAMP_MISSING'
  | 'XADES_ALGORITHM_REFUSED'
  | 'XADES_REFERENCE_AMBIGUOUS';

export class UblSignatureError extends Error {
  readonly code: UblSignatureErrorCode;

  constructor(code: UblSignatureErrorCode, message: string) {
    super(message);
    this.name = 'UblSignatureError';
    this.code = code;
  }
}
