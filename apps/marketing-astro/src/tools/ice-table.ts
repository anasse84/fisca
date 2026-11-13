/** Audit d'une colonne d'ICE dans un tableau (CSV ou .xlsx) et construction du CSV corrigé. */
import { serializeCsv } from './csv.ts';
import type { Delimiter } from './csv.ts';
import { auditAndRepairIce, normalizeIceCell } from './ice.ts';
import type { IceAuditResult, IceStatus } from './ice.ts';

export interface IceTableRow {
  /** Numéro de ligne dans le fichier d'origine (1 = première ligne, en-têtes compris). */
  readonly rowNumber: number;
  readonly result: IceAuditResult;
}

export interface IceTableSummary {
  readonly total: number;
  readonly valid: number;
  readonly repaired: number;
  readonly invalid: number;
  readonly empty: number;
}

export interface IceTableAudit {
  readonly rows: readonly IceTableRow[];
  readonly summary: IceTableSummary;
}

export function summarize(results: readonly IceAuditResult[]): IceTableSummary {
  const count = (status: IceStatus): number => results.filter((r) => r.status === status).length;
  return {
    total: results.length,
    valid: count('VALID_15'),
    repaired: count('AUTO_REPAIRED_EXCEL_LEADING_ZEROS'),
    invalid: count('INVALID_CHECKSUM_OR_FORMAT'),
    empty: count('EMPTY'),
  };
}

/** Colonne la plus probable : en-tête contenant « ICE », sinon la colonne dont le plus de cellules ont 12 à 15 chiffres. */
export function detectIceColumn(rows: readonly (readonly string[])[]): { readonly column: number; readonly hasHeader: boolean } {
  const first = rows[0] ?? [];
  const byHeader = first.findIndex((cell) => /\bICE\b/i.test(cell));
  if (byHeader >= 0) return { column: byHeader, hasHeader: true };
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  let best = 0;
  let bestScore = -1;
  for (let c = 0; c < width; c += 1) {
    const score = rows.slice(0, 200).filter((r) => /^\d{12,15}$/.test(normalizeIceCell(r[c] ?? ''))).length;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  const firstCell = normalizeIceCell(first[best] ?? '');
  const hasHeader = firstCell !== '' && !/^\d+$/.test(firstCell);
  return { column: best, hasHeader };
}

export function auditIceColumn(rows: readonly (readonly string[])[], column: number, hasHeader: boolean): IceTableAudit {
  if (!Number.isInteger(column) || column < 0) throw new RangeError('Colonne invalide');
  const out: IceTableRow[] = [];
  rows.forEach((row, index) => {
    if (hasHeader && index === 0) return;
    out.push({ rowNumber: index + 1, result: auditAndRepairIce(row[column] ?? '') });
  });
  return { rows: out, summary: summarize(out.map((r) => r.result)) };
}

export const EXPORT_COLUMN_ICE = 'ICE_corrige';
export const EXPORT_COLUMN_STATUS = 'ICE_statut';

/**
 * CSV corrigé : toutes les colonnes d'origine, plus `ICE_corrige` (15 chiffres si valide ou réparé, vide sinon) et
 * `ICE_statut` (code stable). L'ICE d'origine n'est jamais écrasé. Les deux colonnes ajoutées sont écrites telles quelles.
 */
export function buildCorrectedCsv(
  rows: readonly (readonly string[])[],
  audit: IceTableAudit,
  hasHeader: boolean,
  delimiter: Delimiter,
): string {
  const byRow = new Map(audit.rows.map((r) => [r.rowNumber, r.result]));
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const out: string[][] = [];
  rows.forEach((row, index) => {
    const padded = [...row];
    while (padded.length < width) padded.push('');
    if (hasHeader && index === 0) {
      out.push([...padded, EXPORT_COLUMN_ICE, EXPORT_COLUMN_STATUS]);
      return;
    }
    const result = byRow.get(index + 1);
    out.push([...padded, result?.normalizedIce15 ?? '', result?.status ?? '']);
  });
  return serializeCsv(out, delimiter, new Set([width, width + 1]));
}
