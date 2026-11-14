/** Lecture et écriture CSV (RFC 4180 tolérant) : séparateur détecté (`;` `,` tabulation `|`), guillemets, BOM, CRLF. */
export type Delimiter = ',' | ';' | '\t' | '|';

const CANDIDATES: readonly Delimiter[] = [';', ',', '\t', '|'];

/** Compte, dans la première ligne logique, les occurrences de chaque séparateur hors guillemets ; `;` gagne les égalités. */
export function detectDelimiter(text: string): Delimiter {
  const counts = new Map<Delimiter, number>(CANDIDATES.map((d) => [d, 0]));
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes) {
      const delimiter = CANDIDATES.find((d) => d === ch);
      if (delimiter !== undefined) counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
    }
  }
  let best: Delimiter = ';';
  let bestCount = 0;
  for (const d of CANDIDATES) {
    const n = counts.get(d) ?? 0;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

export interface ParsedCsv {
  readonly delimiter: Delimiter;
  readonly rows: readonly (readonly string[])[];
}

export function parseCsv(input: string, forcedDelimiter?: Delimiter): ParsedCsv {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = forcedDelimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let touched = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      inQuotes = true;
      touched = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
      touched = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i += 1;
      if (touched || cell !== '') {
        row.push(cell);
        rows.push(row);
      }
      row = [];
      cell = '';
      touched = false;
    } else {
      cell += ch;
      touched = true;
    }
  }
  if (touched || cell !== '') {
    row.push(cell);
    rows.push(row);
  }
  return { delimiter, rows };
}

/** Une cellule qui commence par = + - @ tabulation ou retour chariot serait lue comme une formule : on la préfixe d'une apostrophe. */
export function neutralizeFormula(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

function quote(cell: string, delimiter: Delimiter): string {
  const needs = cell.includes('"') || cell.includes('\n') || cell.includes('\r') || cell.includes(delimiter);
  return needs ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/**
 * Sérialise en CSV. `trustedColumns` : colonnes écrites telles quelles (chiffres calculés par l'outil) ; toutes les autres
 * cellules, reprises du fichier de l'utilisateur, sont neutralisées contre l'injection de formule.
 */
export function serializeCsv(rows: readonly (readonly string[])[], delimiter: Delimiter, trustedColumns: ReadonlySet<number> = new Set()): string {
  const lines = rows.map((r) => r.map((cell, index) => quote(trustedColumns.has(index) ? cell : neutralizeFormula(cell), delimiter)).join(delimiter));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Décode des octets : UTF-8 strict, sinon windows-1252 (CSV enregistré par un Excel francophone). */
export function decodeCsvBytes(bytes: Uint8Array): { readonly text: string; readonly encoding: 'utf-8' | 'windows-1252' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}
