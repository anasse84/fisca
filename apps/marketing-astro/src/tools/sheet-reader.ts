/** Point d'entrée de lecture d'un fichier de tiers : .csv/.txt (texte) ou .xlsx (classeur), tout en mémoire. */
import { decodeCsvBytes, parseCsv } from './csv.ts';
import type { Delimiter } from './csv.ts';
import { XlsxError, readXlsxRows } from './xlsx.ts';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type SheetFormat = 'csv' | 'xlsx';

export interface SheetData {
  readonly format: SheetFormat;
  readonly rows: readonly (readonly string[])[];
  /** Séparateur du CSV d'origine ; `;` par défaut pour un .xlsx (export CSV francophone). */
  readonly delimiter: Delimiter;
  readonly encoding: 'utf-8' | 'windows-1252' | 'xlsx';
}

export type SheetReadErrorCode = 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_EXTENSION' | 'XLSX' | 'NO_ROWS';

export class SheetReadError extends Error {
  readonly code: SheetReadErrorCode;
  /** Code technique stable (ex. `NOT_ZIP`), indépendant de la langue du message. */
  readonly detail: string;
  constructor(code: SheetReadErrorCode, message: string, detail: string = code) {
    super(message);
    this.name = 'SheetReadError';
    this.code = code;
    this.detail = detail;
  }
}

export function sheetFormatOfName(fileName: string): SheetFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) return 'csv';
  return null;
}

export async function readSheet(fileName: string, bytes: Uint8Array): Promise<SheetData> {
  if (bytes.length === 0) throw new SheetReadError('EMPTY', 'Fichier vide.');
  if (bytes.length > MAX_FILE_BYTES) throw new SheetReadError('TOO_LARGE', 'Fichier trop volumineux.');
  const format = sheetFormatOfName(fileName);
  if (format === null) throw new SheetReadError('UNSUPPORTED_EXTENSION', 'Extension non prise en charge (.csv ou .xlsx).');
  if (format === 'xlsx') {
    try {
      const rows = await readXlsxRows(bytes);
      if (rows.length === 0) throw new SheetReadError('NO_ROWS', 'Aucune ligne dans la première feuille.');
      return { format, rows, delimiter: ';', encoding: 'xlsx' };
    } catch (error) {
      if (error instanceof XlsxError) throw new SheetReadError('XLSX', error.message, error.code);
      throw error;
    }
  }
  const { text, encoding } = decodeCsvBytes(bytes);
  const parsed = parseCsv(text);
  if (parsed.rows.length === 0) throw new SheetReadError('NO_ROWS', 'Aucune ligne dans le fichier.');
  return { format, rows: parsed.rows, delimiter: parsed.delimiter, encoding };
}
