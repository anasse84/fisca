export type FiscaIntegerErrorCode =
  | 'NOT_A_NUMBER'
  | 'NOT_FINITE'
  | 'NOT_INTEGER'
  | 'UNSAFE_INTEGER'
  | 'DIVISION_BY_ZERO';

/** Erreur typée des primitives entières (ADR-03 : aucun flottant monétaire). */
export class FiscaIntegerError extends Error {
  readonly code: FiscaIntegerErrorCode;
  readonly label: string;

  constructor(code: FiscaIntegerErrorCode, label: string, detail: string) {
    super(`ADR_03_FLOAT_FORBIDDEN: [${label}] ${code} : ${detail}`);
    this.name = 'FiscaIntegerError';
    this.code = code;
    this.label = label;
  }
}
