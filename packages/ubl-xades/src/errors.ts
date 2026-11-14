export type UblGeneratorErrorCode =
  | 'UBL_INPUT_INVALID'
  | 'UBL_VAT_RATE_INVALID'
  | 'UBL_INVOICE_NUMBER_INVALID'
  | 'UBL_NUMBER_TYPE_MISMATCH'
  | 'UBL_BILLING_REFERENCE_REQUIRED'
  | 'UBL_TOTALS_MISMATCH'
  | 'UBL_RETENTION_INVALID'
  | 'UBL_STAMP_DUTY_INVALID'
  | 'UBL_PIH_INVALID';

/** Détail d'un écart de total : montants seuls, jamais de donnée personnelle. */
export interface UblTotalsMismatchDetail {
  readonly field: string;
  readonly expectedCents: string;
  readonly declaredCents: string;
}

/** Détail d'un champ d'entrée refusé : chemin et code Zod seulement, la valeur n'est jamais recopiée. */
export interface UblInputIssueDetail {
  readonly path: string;
  readonly code: string;
}

export class UblGeneratorError extends Error {
  readonly code: UblGeneratorErrorCode;
  readonly details: readonly (UblTotalsMismatchDetail | UblInputIssueDetail)[];

  constructor(
    code: UblGeneratorErrorCode,
    message: string,
    details: readonly (UblTotalsMismatchDetail | UblInputIssueDetail)[] = [],
  ) {
    super(message);
    this.name = 'UblGeneratorError';
    this.code = code;
    this.details = details;
  }
}

export type UblSchemaErrorCode = 'UBL_SCHEMA_KIND_UNKNOWN' | 'UBL_SCHEMA_VERSION_UNSUPPORTED';

export class UblSchemaError extends Error {
  readonly code: UblSchemaErrorCode;

  constructor(code: UblSchemaErrorCode, message: string) {
    super(message);
    this.name = 'UblSchemaError';
    this.code = code;
  }
}
