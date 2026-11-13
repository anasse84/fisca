import { E2eeError } from './e2ee-errors.ts';

/** Contexte de liaison d'une cellule chiffrée (Doc_10 § 04 ; ERRATA section C). */
export interface FieldAadContext {
  readonly companyId: string;
  readonly tableName: string;
  readonly recordId: string;
  readonly columnName: string;
}

const AAD_SEPARATOR = '|';
const TEXT_ENCODER = new TextEncoder();

function assertComponent(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.includes(AAD_SEPARATOR)) {
    throw new E2eeError('INVALID_INPUT');
  }
}

/**
 * AAD canonique UTF-8 : `${companyId}|${tableName}|${recordId}|${columnName}`.
 * Un composant vide ou contenant « | » est refusé : sinon deux contextes distincts partageraient la même AAD.
 */
export function buildCanonicalAadBytes(context: FieldAadContext): Uint8Array<ArrayBuffer> {
  assertComponent(context.companyId);
  assertComponent(context.tableName);
  assertComponent(context.recordId);
  assertComponent(context.columnName);
  const encoded = TEXT_ENCODER.encode(
    `${context.companyId}${AAD_SEPARATOR}${context.tableName}${AAD_SEPARATOR}${context.recordId}${AAD_SEPARATOR}${context.columnName}`,
  );
  const out = new Uint8Array(encoded.length);
  out.set(encoded);
  return out;
}
