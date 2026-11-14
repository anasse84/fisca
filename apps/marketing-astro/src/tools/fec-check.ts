/**
 * Contrôle de structure local d'un fichier FEC-MA à 24 colonnes (Doc_07 S10 ; Doc_14 S05).
 *
 * Ce contrôle n'est PAS une validation DGI : il vérifie la forme du fichier contre le profil provisoire de
 * `fec-profile.ts`. Il vérifie : UTF-8, fins de ligne CRLF, séparateur pipe, première ligne = en-tête du profil,
 * exactement 24 colonnes par ligne, journal AN présent, en tête et équilibré, équilibre débit = crédit par écriture
 * (journal + numéro d'écriture) et sur le fichier, en centimes entiers (aucun flottant), nom de fichier {IF}FEC{YYYYMMDD}.txt.
 *
 * Continuité des empreintes SHA-256 : NON vérifiée. Les spécifications nomment les colonnes EntryHashSHA256 et
 * PrevHashSHA256 mais ne documentent aucune formule de calcul ; le contrôle le dit au lieu de l'inventer.
 */
import { parseIsoDate } from './civil-date.ts';
import { parseFecAmountToCents } from './fec-amount.ts';
import { FEC_MA_PROVISIONAL_PROFILE, fecColumnIndex } from './fec-profile.ts';

export type FecIssueCode =
  | 'EMPTY_FILE'
  | 'NOT_UTF8'
  | 'BOM'
  | 'LINE_ENDING_LF'
  | 'LINE_ENDING_CR'
  | 'EMPTY_LINE'
  | 'WRONG_SEPARATOR'
  | 'HEADER_COLUMN_COUNT'
  | 'HEADER_MISMATCH'
  | 'COLUMN_COUNT'
  | 'AMOUNT_INVALID'
  | 'AMOUNT_TOO_LARGE'
  | 'EMPTY_ENTRY_NUM'
  | 'AN_ABSENT'
  | 'AN_NOT_FIRST'
  | 'AN_UNBALANCED'
  | 'ENTRY_UNBALANCED'
  | 'FILE_UNBALANCED'
  | 'FILE_NAME';

export interface FecIssue {
  readonly code: FecIssueCode;
  /** Numéro de ligne du fichier (base 1) ; absent si l'anomalie concerne tout le fichier. */
  readonly line?: number;
  /** Nombre de colonnes trouvées (COLUMN_COUNT, HEADER_COLUMN_COUNT) ou nombre de lignes concernées. */
  readonly found?: number;
  readonly column?: string;
  readonly entryNum?: string;
  readonly debitCents?: number;
  readonly creditCents?: number;
  /** Séparateur soupçonné (WRONG_SEPARATOR) ou positions d'en-tête différentes (HEADER_MISMATCH). */
  readonly detail?: string;
}

export interface FecHashChainNote {
  /** Toujours faux : la formule n'est pas documentée dans les spécifications. */
  readonly verified: false;
  readonly reason: 'FORMULA_NOT_DOCUMENTED';
  /** Nombre de lignes dont au moins une des deux colonnes d'empreinte est renseignée. */
  readonly filledLines: number;
}

export interface FecStats {
  readonly lineCount: number;
  readonly dataLineCount: number;
  readonly entryCount: number;
  readonly totalDebitCents: number;
  readonly totalCreditCents: number;
}

export interface FecCheckResult {
  readonly profileId: string;
  readonly profileState: string;
  readonly ok: boolean;
  /** Anomalies listées (20 au plus par code) ; `issueTotals` donne le total réel par code. */
  readonly issues: readonly FecIssue[];
  readonly issueTotals: Readonly<Record<string, number>>;
  readonly fileNameChecked: boolean;
  /** Faux si une ligne illisible (mauvais nombre de colonnes, montant invalide) rend les totaux incomplets : aucun écart n'est alors annoncé. */
  readonly balanceChecked: boolean;
  readonly hashChain: FecHashChainNote;
  readonly stats: FecStats;
}

export interface FecCheckOptions {
  /** Nom du fichier, si connu ; absent : le contrôle du nom est omis. */
  readonly fileName?: string | null;
}

const MAX_LISTED_PER_CODE = 20;
const COLUMNS = FEC_MA_PROVISIONAL_PROFILE.columns;
const COLUMN_TOTAL = COLUMNS.length;
const IDX_JOURNAL = fecColumnIndex('JournalCode');
const IDX_ENTRY = fecColumnIndex('EcritureNum');
const IDX_DEBIT = fecColumnIndex('Debit');
const IDX_CREDIT = fecColumnIndex('Credit');
const IDX_HASH = fecColumnIndex('EntryHashSHA256');
const IDX_PREV = fecColumnIndex('PrevHashSHA256');
const FILE_NAME_PATTERN = /^(\d+)FEC(\d{4})(\d{2})(\d{2})\.txt$/;

/** Vrai si `{IF}FEC{YYYYMMDD}.txt` avec un IF numérique et une date de calendrier valide. */
export function isValidFecFileName(name: string): boolean {
  const m = FILE_NAME_PATTERN.exec(name);
  if (m === null) return false;
  return parseIsoDate(`${m[2] ?? ''}-${m[3] ?? ''}-${m[4] ?? ''}`) !== null;
}

function finish(issues: FecIssue[], base: Omit<FecCheckResult, 'issues' | 'issueTotals' | 'ok' | 'balanceChecked'> & { readonly balanceChecked?: boolean }): FecCheckResult {
  const totals: Record<string, number> = {};
  const listed: FecIssue[] = [];
  for (const issue of issues) {
    const seen = totals[issue.code] ?? 0;
    totals[issue.code] = seen + 1;
    if (seen < MAX_LISTED_PER_CODE) listed.push(issue);
  }
  return { ...base, balanceChecked: base.balanceChecked ?? true, ok: issues.length === 0, issues: listed, issueTotals: totals };
}

function emptyStats(lineCount: number): FecStats {
  return { lineCount, dataLineCount: 0, entryCount: 0, totalDebitCents: 0, totalCreditCents: 0 };
}

function toSafeNumber(value: bigint): number | null {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

interface EntryTotals {
  debit: bigint;
  credit: bigint;
  firstLine: number;
  entryNum: string;
}

/** Contrôle le texte d'un FEC déjà décodé (UTF-8 supposé ; voir `checkFecBytes` pour le contrôle d'encodage). */
export function checkFecText(rawText: string, options: FecCheckOptions = {}): FecCheckResult {
  const profile = FEC_MA_PROVISIONAL_PROFILE;
  const issues: FecIssue[] = [];
  const hashChain: FecHashChainNote = { verified: false, reason: 'FORMULA_NOT_DOCUMENTED', filledLines: 0 };
  const fileName = options.fileName ?? null;
  if (fileName !== null && !isValidFecFileName(fileName)) issues.push({ code: 'FILE_NAME', detail: fileName });
  const base = { profileId: profile.id, profileState: profile.state, fileNameChecked: fileName !== null };

  let text = rawText;
  if (text.charCodeAt(0) === 0xfeff) {
    issues.push({ code: 'BOM' });
    text = text.slice(1);
  }
  if (text === '') {
    issues.push({ code: 'EMPTY_FILE' });
    return finish(issues, { ...base, hashChain, stats: emptyStats(0) });
  }

  const bareLf = (text.match(/(?<!\r)\n/g) ?? []).length;
  const bareCr = (text.match(/\r(?!\n)/g) ?? []).length;
  if (bareLf > 0) issues.push({ code: 'LINE_ENDING_LF', found: bareLf });
  if (bareCr > 0) issues.push({ code: 'LINE_ENDING_CR', found: bareCr });

  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const header = lines[0] ?? '';

  // Séparateur : un en-tête sans pipe mais avec un autre séparateur courant.
  if (!header.includes(profile.separator)) {
    const guess = [';', '\t', ','].find((c) => header.includes(c));
    if (guess !== undefined) {
      issues.push({ code: 'WRONG_SEPARATOR', line: 1, detail: guess === '\t' ? 'TAB' : guess });
      return finish(issues, { ...base, hashChain, stats: emptyStats(lines.length) });
    }
  }

  const headerCells = header.split(profile.separator);
  if (headerCells.length !== COLUMN_TOTAL) {
    issues.push({ code: 'HEADER_COLUMN_COUNT', line: 1, found: headerCells.length });
  } else {
    const differing: number[] = [];
    headerCells.forEach((cell, i) => {
      if (cell !== COLUMNS[i]) differing.push(i + 1);
    });
    if (differing.length > 0) issues.push({ code: 'HEADER_MISMATCH', line: 1, detail: differing.join(',') });
  }

  const entries = new Map<string, EntryTotals>();
  let fileDebit = 0n;
  let fileCredit = 0n;
  let anDebit = 0n;
  let anCredit = 0n;
  let anSeen = false;
  let anBroken = false;
  let nonAnSeen = false;
  let dataLines = 0;
  let hashFilled = 0;
  let tooLarge = false;
  let unreadable = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const line = lines[i] ?? '';
    dataLines += 1;
    if (line === '') {
      issues.push({ code: 'EMPTY_LINE', line: lineNo });
      continue;
    }
    const cells = line.split(profile.separator);
    if (cells.length !== COLUMN_TOTAL) {
      issues.push({ code: 'COLUMN_COUNT', line: lineNo, found: cells.length });
      unreadable += 1;
      continue;
    }
    if ((cells[IDX_HASH] ?? '') !== '' || (cells[IDX_PREV] ?? '') !== '') hashFilled += 1;
    const debit = parseFecAmountToCents(cells[IDX_DEBIT] ?? '');
    const credit = parseFecAmountToCents(cells[IDX_CREDIT] ?? '');
    if (debit === null) issues.push({ code: 'AMOUNT_INVALID', line: lineNo, column: 'Debit' });
    if (credit === null) issues.push({ code: 'AMOUNT_INVALID', line: lineNo, column: 'Credit' });
    if (debit === null || credit === null) unreadable += 1;
    const journal = cells[IDX_JOURNAL] ?? '';
    const isAn = journal === profile.openingJournalCode;
    if (isAn) {
      if (nonAnSeen && !anBroken) {
        anBroken = true;
        issues.push({ code: 'AN_NOT_FIRST', line: lineNo });
      }
      anSeen = true;
    } else {
      nonAnSeen = true;
    }
    if (debit === null || credit === null) continue;
    fileDebit += debit;
    fileCredit += credit;
    if (isAn) {
      anDebit += debit;
      anCredit += credit;
    }
    const entryNum = cells[IDX_ENTRY] ?? '';
    if (entryNum === '') {
      issues.push({ code: 'EMPTY_ENTRY_NUM', line: lineNo });
      continue;
    }
    const key = `${journal}\u0000${entryNum}`;
    const current = entries.get(key);
    if (current === undefined) entries.set(key, { debit, credit, firstLine: lineNo, entryNum });
    else {
      current.debit += debit;
      current.credit += credit;
    }
  }

  if (!anSeen) issues.push({ code: 'AN_ABSENT' });
  const balanceChecked = unreadable === 0;
  const totalDebit = toSafeNumber(fileDebit);
  const totalCredit = toSafeNumber(fileCredit);
  if (balanceChecked) {
    if (anSeen && anDebit !== anCredit) {
      const d = toSafeNumber(anDebit);
      const c = toSafeNumber(anCredit);
      if (d === null || c === null) tooLarge = true;
      else issues.push({ code: 'AN_UNBALANCED', debitCents: d, creditCents: c });
    }
    for (const entry of entries.values()) {
      if (entry.debit === entry.credit) continue;
      const d = toSafeNumber(entry.debit);
      const c = toSafeNumber(entry.credit);
      if (d === null || c === null) tooLarge = true;
      else issues.push({ code: 'ENTRY_UNBALANCED', line: entry.firstLine, entryNum: entry.entryNum, debitCents: d, creditCents: c });
    }
    if (totalDebit === null || totalCredit === null) tooLarge = true;
    else if (totalDebit !== totalCredit) issues.push({ code: 'FILE_UNBALANCED', debitCents: totalDebit, creditCents: totalCredit });
  }
  if (tooLarge) issues.push({ code: 'AMOUNT_TOO_LARGE' });

  return finish(issues, {
    ...base,
    balanceChecked,
    hashChain: { ...hashChain, filledLines: hashFilled },
    stats: { lineCount: lines.length, dataLineCount: dataLines, entryCount: entries.size, totalDebitCents: totalDebit ?? 0, totalCreditCents: totalCredit ?? 0 },
  });
}

/** Contrôle un fichier lu en octets : l'encodage doit être de l'UTF-8 valide, sinon le contrôle s'arrête. */
export function checkFecBytes(bytes: Uint8Array, options: FecCheckOptions = {}): FecCheckResult {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    const profile = FEC_MA_PROVISIONAL_PROFILE;
    return finish([{ code: 'NOT_UTF8' }], {
      profileId: profile.id,
      profileState: profile.state,
      fileNameChecked: false,
      hashChain: { verified: false, reason: 'FORMULA_NOT_DOCUMENTED', filledLines: 0 },
      stats: emptyStats(0),
    });
  }
  return checkFecText(text, options);
}
