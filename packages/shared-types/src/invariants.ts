export type AdrId =
  | 'ADR-01' | 'ADR-02' | 'ADR-03' | 'ADR-04' | 'ADR-05' | 'ADR-06'
  | 'ADR-07' | 'ADR-08' | 'ADR-09' | 'ADR-10' | 'ADR-11' | 'ADR-12';

/**
 * DOC_05_SECTION_14 : fonction écrite telle quelle en Section 14 de Doc_05.
 * DERIVE_GARDE_FOU_ADR : Section 14 ne fournit aucun code pour cet ADR ; l'invariant est dérivé
 * du « Compromis & Garde-fous » explicite de l'ADR, à valider par le propriétaire.
 */
export type InvariantOrigin = 'DOC_05_SECTION_14' | 'DERIVE_GARDE_FOU_ADR';

export interface AdrInvariant {
  readonly id: string;
  readonly adr: AdrId;
  readonly statement: string;
  readonly origin: InvariantOrigin;
  readonly errorCode: string;
  /** Lève une Error dont le message commence par errorCode si l'entrée viole l'invariant. */
  readonly check: (input: unknown) => void;
  readonly conforming: readonly unknown[];
  readonly violating: readonly unknown[];
}

// ---------------------------------------------------------------- contrôles typés

export type AdrInvariantErrorCode =
  | 'ADR_02_10_TENANT_LEAK_RISK'
  | 'ADR_03_FLOAT_FORBIDDEN'
  | 'ADR_04_LF2026_VAT_VIOLATION'
  | 'ADR_04_UNREADABLE_ISSUE_DATE'
  | 'ADR_06_LOI4320_CERT_MISMATCH'
  | 'ADR_11_SAGE100_CORRUPTION_GUARD'
  | 'ADR_11_SAGE100_MISSING_NOLOCK'
  | 'ADR_11_SAGE100_EMPTY_TABLE_SOURCE';

/** Erreur typée des gardes ADR : le message commence toujours par le code. */
export class AdrInvariantError extends Error {
  readonly code: AdrInvariantErrorCode;

  constructor(code: AdrInvariantErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'AdrInvariantError';
    this.code = code;
  }
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Extrait l'année d'une date ISO `AAAA-MM-JJ` réelle (calendrier grégorien) ; undefined si illisible ou impossible. */
export function readIsoDateYear(isoDate: string): number | undefined {
  const match = ISO_DATE_PATTERN.exec(isoDate);
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    return undefined;
  }
  const monthLength = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day >= 1 && day <= monthLength ? year : undefined;
}

/** Vrai si la chaîne est une date calendaire ISO `AAAA-MM-JJ` existante. */
export function isReadableIsoDate(isoDate: string): boolean {
  return readIsoDateYear(isoDate) !== undefined;
}

export function assertSafeIntegerAmount(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new AdrInvariantError(
      'ADR_03_FLOAT_FORBIDDEN',
      `[${label}] doit être un entier exact en centimes/bps (reçu: ${value}).`,
    );
  }
  return value;
}

export function assertValidVatRateForIssueYear(vatRateBps: number, issueDateIso: string): void {
  const year = readIsoDateYear(issueDateIso);
  if (year === undefined) {
    throw new AdrInvariantError(
      'ADR_04_UNREADABLE_ISSUE_DATE',
      `date d'émission illisible ou impossible [${issueDateIso}] (format AAAA-MM-JJ d'un jour réel attendu) : le taux ${vatRateBps} bps ne peut pas être validé.`,
    );
  }
  if (year >= 2026 && vatRateBps !== 2000 && vatRateBps !== 1000 && vatRateBps !== 0) {
    throw new AdrInvariantError(
      'ADR_04_LF2026_VAT_VIOLATION',
      `Taux ${vatRateBps} bps interdit à partir de 2026 (seuls 2000, 1000 et 0 sont admis).`,
    );
  }
}

/** Découpe un SubjectDN en couples (attribut, valeur) ; virgules échappées (\,) ou entre guillemets conservées dans la valeur. */
function parseSubjectDn(subjectDn: string): readonly (readonly [string, string])[] {
  const segments: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < subjectDn.length; index += 1) {
    const char = subjectDn.charAt(index);
    if (char === '\\') {
      current += char + subjectDn.charAt(index + 1);
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if ((char === ',' || char === '/' || char === '+') && !inQuotes) {
      segments.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  segments.push(current);

  const attributes: (readonly [string, string])[] = [];
  for (const segment of segments) {
    const separator = segment.indexOf('=');
    if (separator > 0) {
      const key = segment.slice(0, separator).trim().toUpperCase();
      const raw = segment.slice(separator + 1).trim();
      const unquoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
      attributes.push([key, unquoted.replace(/\\(.)/g, '$1').trim()]);
    }
  }
  return attributes;
}

/** Seuls attributs du SubjectDN lus : organizationIdentifier (2.5.4.97) et serialNumber (2.5.4.5). Le CN n'est jamais lu. */
const IDENTIFIER_ATTRIBUTES: readonly string[] = [
  '2.5.4.97', 'OID.2.5.4.97', 'ORGANIZATIONIDENTIFIER',
  '2.5.4.5', 'OID.2.5.4.5', 'SERIALNUMBER',
];
const ICE_VALUE_PATTERN = /^[0-9]{15}$/;
const IF_VALUE_PATTERN = /^[0-9]{6,12}$/;
/** Préfixe ETSI (EN 319 412-1) : un code pays autre que MA est refusé tout de suite. */
const ETSI_PREFIX_PATTERN = /^(VAT|NTR|PSD|LEI)([A-Z]{2})-(.+)$/;

/**
 * Compare le certificat à l'émetteur (Loi 43-20) : seuls organizationIdentifier (2.5.4.97) et serialNumber
 * (2.5.4.5) comptent, par correspondance exacte (casse ignorée, guillemets retirés) avec un jeton de l'ICE
 * (valeur nue, NTRMA-, ICEMA-, ICE:, ICE-) ou de l'IF (VATMA-, IFMA-, IF:, IF-). Un préfixe ETSI à code pays
 * autre que MA rejette le certificat, quel que soit l'autre attribut. Le CN ne suffit jamais. Échec fermé :
 * ICE de 15 chiffres exacts et IF de 6 à 12 chiffres, sinon refus.
 */
export function assertCertificateMatchesEmitter(certSubjectDn: string, emitterIce: string, emitterIf: string): void {
  const refuse = (detail: string): never => {
    throw new AdrInvariantError(
      'ADR_06_LOI4320_CERT_MISMATCH',
      `Le SubjectDN du certificat qualifié ne correspond pas à l'émetteur : ${detail}.`,
    );
  };
  if (!ICE_VALUE_PATTERN.test(emitterIce)) {
    return refuse("l'ICE de l'émetteur doit compter exactement 15 chiffres");
  }
  if (!IF_VALUE_PATTERN.test(emitterIf)) {
    return refuse("l'IF de l'émetteur doit compter de 6 à 12 chiffres");
  }
  const accepted: ReadonlySet<string> = new Set([
    emitterIce, `NTRMA-${emitterIce}`, `ICEMA-${emitterIce}`, `ICE:${emitterIce}`, `ICE-${emitterIce}`,
    `VATMA-${emitterIf}`, `IFMA-${emitterIf}`, `IF:${emitterIf}`, `IF-${emitterIf}`,
  ]);
  const values = parseSubjectDn(certSubjectDn)
    .filter(([key]) => IDENTIFIER_ATTRIBUTES.includes(key))
    .map(([, value]) => value.toUpperCase());
  for (const value of values) {
    const prefix = ETSI_PREFIX_PATTERN.exec(value);
    if (prefix !== null && prefix[2] !== 'MA') {
      return refuse(`préfixe ETSI étranger (${prefix[1] ?? ''}${prefix[2] ?? ''}-) dans un attribut identifiant`);
    }
  }
  if (!values.some((value) => accepted.has(value))) {
    return refuse('aucun attribut organizationIdentifier (2.5.4.97) ou serialNumber (2.5.4.5) ne porte exactement l\'ICE ou l\'IF');
  }
}

function normalizeToolKey(key: string): string {
  return key.normalize('NFKC').toLowerCase().replace(/[\s_.\-\p{Cf}]/gu, '');
}

const FORBIDDEN_TOOL_KEYS: readonly string[] = [
  'tenantid', 'companyid', 'd1databaseid', 'organizationid', 'dbid',
  'databaseid', 'orgid', 'd1id', 'tenantuuid', 'companyuuid',
];

export function assertSafeMcpToolSchema(toolName: string, parameterKeys: readonly string[]): void {
  for (const key of parameterKeys) {
    if (FORBIDDEN_TOOL_KEYS.includes(normalizeToolKey(key))) {
      throw new AdrInvariantError(
        'ADR_02_10_TENANT_LEAK_RISK',
        `L'outil IA [${toolName}] ne doit jamais accepter [${key}] depuis le modèle.`,
      );
    }
  }
}

const SAGE_FORBIDDEN_KEYWORDS =
  /\b(INTO|EXEC|EXECUTE|CREATE|GRANT|REVOKE|DENY|ALTER|DROP|TRUNCATE|MERGE|CALL|INSERT|UPDATE|DELETE|BULK|OPENROWSET|OPENQUERY|OPENDATASOURCE|OPENXML|DBCC|BACKUP|RESTORE|SHUTDOWN|WAITFOR|UPDLOCK|XLOCK|HOLDLOCK|TABLOCKX)\b/;
/** Mots qui terminent la clause FROM (la liste de tables s'arrête avant eux). */
const SAGE_FROM_CLAUSE_END: ReadonlySet<string> = new Set([
  'WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION', 'INTERSECT', 'EXCEPT', 'FOR', 'OPTION', 'OFFSET', 'FETCH',
]);

/**
 * Analyse (échec fermé) du code SQL déjà débarrassé de ses littéraux : renvoie 'comma' si une virgule sépare
 * deux tables dans une clause FROM (jointure implicite), 'unbalanced' si les parenthèses ou identifiants
 * délimités sont mal formés, null sinon. Chaque niveau de parenthèses a son propre état : les virgules de la
 * liste de colonnes, des arguments de fonction (REPLACE(a,b,c)) et de IN (1,2) ne sont pas dans une clause FROM.
 */
function findSageImplicitJoin(code: string): 'comma' | 'unbalanced' | null {
  const inFrom: boolean[] = [false];
  let index = 0;
  while (index < code.length) {
    const char = code.charAt(index);
    if (char === '[' || char === '"') {
      const close = code.indexOf(char === '[' ? ']' : '"', index + 1);
      if (close === -1) {
        return 'unbalanced';
      }
      index = close + 1;
    } else if (char === '(') {
      inFrom.push(false);
      index += 1;
    } else if (char === ')') {
      inFrom.pop();
      if (inFrom.length === 0) {
        return 'unbalanced';
      }
      index += 1;
    } else if (char === ',') {
      if (inFrom[inFrom.length - 1] === true) {
        return 'comma';
      }
      index += 1;
    } else if (/[A-Z_]/.test(char)) {
      let end = index + 1;
      while (end < code.length && /[A-Z0-9_$#@]/.test(code.charAt(end))) {
        end += 1;
      }
      const word = code.slice(index, end);
      if (word === 'FROM') {
        inFrom[inFrom.length - 1] = true;
      } else if (SAGE_FROM_CLAUSE_END.has(word)) {
        inFrom[inFrom.length - 1] = false;
      }
      index = end;
    } else {
      index += 1;
    }
  }
  return inFrom.length === 1 ? null : 'unbalanced';
}

type SageSanitized = { readonly code: string } | { readonly error: 'comment' | 'literal' };

/**
 * Passe unique : supprime les commentaires `--` et `/* *\/` (ces derniers imbriqués, comme SQL Server) et neutralise les
 * littéraux entre apostrophes (remplacés par ` 0 `). Les identifiants `[...]` et "..." sont recopiés tels quels : un
 * marqueur de commentaire ou une apostrophe à l'intérieur n'a aucun effet. Échec fermé si commentaire ou littéral non terminé.
 */
function sanitizeSageSql(sql: string): SageSanitized {
  let out = '';
  let index = 0;
  while (index < sql.length) {
    const char = sql.charAt(index);
    const next = sql.charAt(index + 1);
    if (char === "'") {
      let end = index + 1;
      while (end < sql.length && !(sql.charAt(end) === "'" && sql.charAt(end + 1) !== "'")) {
        end += sql.charAt(end) === "'" ? 2 : 1;
      }
      if (end >= sql.length) {
        return { error: 'literal' };
      }
      out += ' 0 ';
      index = end + 1;
    } else if (char === '[' || char === '"') {
      const closer = char === '[' ? ']' : '"';
      let end = index + 1;
      while (end < sql.length && !(sql.charAt(end) === closer && sql.charAt(end + 1) !== closer)) {
        end += sql.charAt(end) === closer ? 2 : 1;
      }
      const stop = Math.min(end + 1, sql.length);
      out += sql.slice(index, stop);
      index = stop;
    } else if (char === '-' && next === '-') {
      while (index < sql.length && sql.charAt(index) !== '\n' && sql.charAt(index) !== '\r') {
        index += 1;
      }
      out += ' ';
    } else if (char === '/' && next === '*') {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.charAt(index) === '/' && sql.charAt(index + 1) === '*') {
          depth += 1;
          index += 2;
        } else if (sql.charAt(index) === '*' && sql.charAt(index + 1) === '/') {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth > 0) {
        return { error: 'comment' };
      }
      out += ' ';
    } else {
      out += char;
      index += 1;
    }
  }
  return { code: out };
}

interface SageToken {
  readonly kind: 'word' | 'ident' | 'punct' | 'other';
  readonly text: string;
  readonly upper: string;
}

const SAGE_WORD_START = /[\p{L}_#@]/u;
const SAGE_WORD_PART = /[\p{L}\p{N}_$#@]/u;

/** Découpe le SQL (déjà sans commentaires ni littéraux, crochets équilibrés) en mots, identifiants délimités et ponctuation. */
function tokenizeSageSql(code: string): readonly SageToken[] {
  const tokens: SageToken[] = [];
  let index = 0;
  while (index < code.length) {
    const char = code.charAt(index);
    if (/\s/u.test(char)) {
      index += 1;
    } else if (char === '[' || char === '"') {
      const closer = char === '[' ? ']' : '"';
      let end = index + 1;
      while (end < code.length && !(code.charAt(end) === closer && code.charAt(end + 1) !== closer)) {
        end += code.charAt(end) === closer ? 2 : 1;
      }
      const inner = code.slice(index + 1, end).split(closer + closer).join(closer);
      tokens.push({ kind: 'ident', text: inner, upper: inner.toUpperCase() });
      index = end + 1;
    } else if (SAGE_WORD_START.test(char)) {
      let end = index + 1;
      while (end < code.length && SAGE_WORD_PART.test(code.charAt(end))) {
        end += 1;
      }
      const word = code.slice(index, end);
      tokens.push({ kind: 'word', text: word, upper: word.toUpperCase() });
      index = end;
    } else if (/\p{N}/u.test(char)) {
      let end = index + 1;
      while (end < code.length && /[\p{L}\p{N}_.]/u.test(code.charAt(end))) {
        end += 1;
      }
      tokens.push({ kind: 'other', text: code.slice(index, end), upper: code.slice(index, end).toUpperCase() });
      index = end;
    } else {
      tokens.push({ kind: 'punct', text: char, upper: char });
      index += 1;
    }
  }
  return tokens;
}

/** Mots qui ne peuvent pas être un alias de table : ils ouvrent la suite de la clause. */
const SAGE_NOT_AN_ALIAS: ReadonlySet<string> = new Set([
  'WITH', 'ON', 'WHERE', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'JOIN', 'APPLY', 'ORDER', 'GROUP',
  'HAVING', 'UNION', 'EXCEPT', 'INTERSECT', 'OPTION', 'FOR', 'OFFSET', 'FETCH', 'PIVOT', 'UNPIVOT', 'TABLESAMPLE',
  'SELECT', 'FROM', 'USING', 'NATURAL',
]);

interface SageTableAnalysis {
  readonly physicalCount: number;
  readonly missingNoLock: readonly string[];
}

const isIdentifierToken = (token: SageToken | undefined): token is SageToken =>
  token !== undefined && (token.kind === 'word' || token.kind === 'ident');
const isPunct = (token: SageToken | undefined, char: string): boolean => token?.kind === 'punct' && token.text === char;
const isWord = (token: SageToken | undefined, word: string): boolean => token?.kind === 'word' && token.upper === word;

/** Index du `)` qui ferme le `(` situé à `open` ; -1 si absent. */
function matchingParen(tokens: readonly SageToken[], open: number): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    if (isPunct(tokens[index], '(')) {
      depth += 1;
    } else if (isPunct(tokens[index], ')')) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** Vrai si la liste d'indices (entre parenthèses, entrées séparées par des virgules de niveau 1) contient l'entrée exacte NOLOCK. */
function hintListHasNoLock(tokens: readonly SageToken[], open: number, close: number): boolean {
  let depth = 0;
  let entry: SageToken[] = [];
  const entries: SageToken[][] = [];
  for (let index = open + 1; index < close; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }
    if (isPunct(token, '(')) {
      depth += 1;
    } else if (isPunct(token, ')')) {
      depth -= 1;
    }
    if (depth === 0 && isPunct(token, ',')) {
      entries.push(entry);
      entry = [];
    } else {
      entry.push(token);
    }
  }
  entries.push(entry);
  return entries.some((candidate) => candidate.length === 1 && isWord(candidate[0], 'NOLOCK'));
}

/**
 * Parcourt chaque FROM, JOIN ou APPLY et vérifie que chaque table physique (nom à 1 à 4 parties, crochets, alias avec
 * ou sans AS) porte sa propre clause WITH (...NOLOCK...). Les noms de CTE (une seule partie) sont exemptés, les
 * sous-requêtes en FROM sont analysées par la boucle principale (elles ont leur propre FROM).
 */
function analyzeSageTableSources(tokens: readonly SageToken[], cteNames: ReadonlySet<string>): SageTableAnalysis {
  let physicalCount = 0;
  const missing: string[] = [];

  const readSource = (start: number): number => {
    let cursor = start;
    while (isPunct(tokens[cursor], '(')) {
      if (isWord(tokens[cursor + 1], 'SELECT')) {
        return cursor; // table dérivée : le SELECT intérieur est traité par la boucle principale
      }
      cursor += 1; // jointure parenthésée : la première table est juste après
    }
    const first = tokens[cursor];
    if (!isIdentifierToken(first)) {
      physicalCount += 1;
      missing.push('(source de table illisible)');
      return cursor;
    }
    const parts: string[] = [first.text];
    cursor += 1;
    while (isPunct(tokens[cursor], '.')) {
      cursor += 1;
      const part = tokens[cursor];
      if (isIdentifierToken(part)) {
        parts.push(part.text);
        cursor += 1;
      } else {
        parts.push('');
      }
    }
    const callsFunction = isPunct(tokens[cursor], '(');
    if (!callsFunction) {
      if (isWord(tokens[cursor], 'AS')) {
        cursor += 1;
        if (isIdentifierToken(tokens[cursor])) {
          cursor += 1;
        }
      } else {
        const candidate = tokens[cursor];
        if (candidate?.kind === 'ident' || (candidate?.kind === 'word' && !SAGE_NOT_AN_ALIAS.has(candidate.upper))) {
          cursor += 1;
        }
      }
    }
    let hasNoLock = false;
    if (isWord(tokens[cursor], 'WITH') && isPunct(tokens[cursor + 1], '(')) {
      const close = matchingParen(tokens, cursor + 1);
      if (close !== -1) {
        hasNoLock = hintListHasNoLock(tokens, cursor + 1, close);
        cursor = close + 1;
      }
    }
    const isCte = parts.length === 1 && cteNames.has((parts[0] ?? '').toUpperCase());
    if (!isCte) {
      physicalCount += 1;
      if (!hasNoLock || callsFunction) {
        missing.push(parts.join('.'));
      }
    }
    return cursor;
  };

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token?.kind === 'word' && (token.upper === 'FROM' || token.upper === 'JOIN' || token.upper === 'APPLY')) {
      index = Math.max(readSource(index + 1), index + 1);
    } else {
      index += 1;
    }
  }
  return { physicalCount, missingNoLock: missing };
}

/**
 * Lit l'en-tête `WITH nom [(colonnes)] AS ( … ) [, nom AS ( … )]…` et renvoie les noms de CTE (majuscules) avec l'index
 * du premier jeton de la requête principale ; null si l'en-tête est mal formé.
 */
function readSageCteHeader(tokens: readonly SageToken[]): { readonly names: ReadonlySet<string>; readonly mainStart: number } | null {
  const names = new Set<string>();
  let cursor = 1;
  for (;;) {
    const name = tokens[cursor];
    if (!isIdentifierToken(name)) {
      return null;
    }
    cursor += 1;
    if (isPunct(tokens[cursor], '(')) {
      const closeColumns = matchingParen(tokens, cursor);
      if (closeColumns === -1) {
        return null;
      }
      cursor = closeColumns + 1;
    }
    if (!isWord(tokens[cursor], 'AS') || !isPunct(tokens[cursor + 1], '(')) {
      return null;
    }
    const closeBody = matchingParen(tokens, cursor + 1);
    if (closeBody === -1) {
      return null;
    }
    names.add(name.upper);
    cursor = closeBody + 1;
    if (isPunct(tokens[cursor], ',')) {
      cursor += 1;
    } else {
      break;
    }
  }
  return isWord(tokens[cursor], 'SELECT') ? { names, mainStart: cursor } : null;
}

export function assertReadOnlySageSql(sqlQuery: string): void {
  const refuse = (reason: string): never => {
    throw new AdrInvariantError(
      'ADR_11_SAGE100_CORRUPTION_GUARD',
      `Écriture SQL directe interdite sur Sage 100 (${reason}). Utilisez IPMEncoder ou l'export .PNM.`,
    );
  };
  // Commentaires supprimés et littéraux neutralisés avant l'analyse : un mot-clé, un « ; » ou un indice entre
  // apostrophes ou dans un commentaire n'est pas du SQL exécutable (et ne peut donc pas masquer un NOLOCK manquant).
  const sanitized = sanitizeSageSql(sqlQuery);
  if ('error' in sanitized) {
    return refuse(sanitized.error === 'literal' ? 'littéral non terminé' : 'commentaire SQL non terminé');
  }
  const trimmed = sanitized.code.trim();
  const statement = trimmed.endsWith(';') ? trimmed.slice(0, -1) : trimmed;
  const code = statement.toUpperCase();
  if (code.includes(';')) {
    return refuse('instructions multiples');
  }
  if (code.includes('*/')) {
    return refuse('fermeture de commentaire orpheline');
  }
  if (!/^(?:SELECT|WITH)\b/.test(code)) {
    return refuse('une instruction SELECT unique est requise');
  }
  const keyword = SAGE_FORBIDDEN_KEYWORDS.exec(code);
  if (keyword !== null) {
    return refuse(`mot-clé ${keyword[1] ?? ''}`);
  }
  if (/\bREPLACE\s+INTO\b/.test(code)) {
    return refuse('mot-clé REPLACE INTO');
  }
  const implicitJoin = findSageImplicitJoin(code);
  if (implicitJoin === 'comma') {
    return refuse('liste de tables séparée par une virgule : JOIN explicite requis, WITH (NOLOCK) sur chaque table');
  }
  if (implicitJoin === 'unbalanced') {
    return refuse('parenthèses ou identifiant délimité mal formés');
  }
  const tokens = tokenizeSageSql(statement);
  let cteNames: ReadonlySet<string> = new Set<string>();
  if (isWord(tokens[0], 'WITH')) {
    const header = readSageCteHeader(tokens);
    if (header === null) {
      return refuse('en-tête WITH … AS ( … ) mal formé ou requête principale non SELECT');
    }
    cteNames = header.names;
  }
  // AGENTS.md loi 9 / ADR-11 : lecture WITH (NOLOCK) seulement, sur CHAQUE table physique (FROM, JOIN, APPLY).
  const analysis = analyzeSageTableSources(tokens, cteNames);
  if (analysis.physicalCount === 0) {
    throw new AdrInvariantError('ADR_11_SAGE100_EMPTY_TABLE_SOURCE', 'aucune table physique détectée dans la requête Sage 100.');
  }
  if (analysis.missingNoLock.length > 0) {
    throw new AdrInvariantError(
      'ADR_11_SAGE100_MISSING_NOLOCK',
      `clause WITH (NOLOCK) manquante sur chaque table physique, absente de : ${analysis.missingNoLock.join(', ')}.`,
    );
  }
}

// ---------------------------------------------------------------- invariants dérivés

export function assertUniquePosPrefixes(prefixes: readonly string[]): void {
  const seen = new Set<string>();
  for (const prefix of prefixes) {
    if (prefix.length === 0 || seen.has(prefix)) {
      throw new Error(
        `ADR_01_POS_PREFIX_COLLISION: préfixe matériel de caisse vide ou dupliqué [${prefix}] (risque de collision de numérotation hors-ligne).`,
      );
    }
    seen.add(prefix);
  }
}

export function assertCashAccountNotCreditor(accountCode: string, balanceCents: number): void {
  const balance = assertSafeIntegerAmount(balanceCents, 'balanceCents');
  if (accountCode === '5161' && balance < 0) {
    throw new Error('ADR_05_CASH_5161_CREDITOR: tout décaissement rendant la caisse 5161 créditrice est bloqué.');
  }
}

export function assertSingleDailyTimestamp(documentCount: number, tsaTokenCount: number): void {
  const expected = documentCount > 0 ? 1 : 0;
  if (tsaTokenCount !== expected) {
    throw new Error(
      `ADR_07_ONE_TSA_TOKEN_PER_DAY: ${documentCount} pièce(s) doivent partager ${expected} jeton RFC 3161 quotidien (reçu: ${tsaTokenCount}).`,
    );
  }
}

export function assertShamirTwoOfThree(threshold: number, shares: number): void {
  if (threshold !== 2 || shares !== 3) {
    throw new Error(
      `ADR_08_SHAMIR_2_OF_3: le séquestre fiscal est un partage 2-sur-3 (reçu: ${threshold}-sur-${shares}).`,
    );
  }
}

const ALLOWED_CONTAINER_SERVICES: readonly string[] = ['fiscal-java', 'docling-python', 'camel-bridge'];

export function assertContainerPlanHasNativeFallback(services: readonly string[], nativeFallbackBuilder: boolean): void {
  const unknown = services.find((service) => !ALLOWED_CONTAINER_SERVICES.includes(service));
  if (unknown !== undefined) {
    throw new Error(`ADR_09_CONTAINER_PLAN: service conteneur [${unknown}] hors de fiscal-java, docling-python, camel-bridge.`);
  }
  if (!nativeFallbackBuilder) {
    throw new Error('ADR_09_CONTAINER_PLAN: le constructeur UBL natif TypeScript de secours doit rester déclaré.');
  }
}

export function assertAiCannotMutateLedger(canMutateLedgerDirectly: boolean): void {
  if (canMutateLedgerDirectly !== false) {
    throw new Error('ADR_10_AI_LEDGER_MUTATION: canMutateLedgerDirectly doit rester false.');
  }
}

const ALLOWED_ADAPTER_DRIVERS: readonly string[] = ['CLOUDFLARE_EDGE', 'SOVEREIGN_MOROCCO_VPS'];

export function assertKnownInfrastructureDriver(driver: string): void {
  if (!ALLOWED_ADAPTER_DRIVERS.includes(driver)) {
    throw new Error(`ADR_12_UNKNOWN_DRIVER: pilote [${driver}] inconnu (CLOUDFLARE_EDGE ou SOVEREIGN_MOROCCO_VPS).`);
  }
}

export function assertPortableSql(sqlQuery: string): void {
  if (/\b(JSONB|ILIKE|SERIAL|PRAGMA|AUTOINCREMENT)\b/i.test(sqlQuery)) {
    throw new Error(
      'ADR_12_NON_PORTABLE_SQL: extension SQL propriétaire interdite dans le cœur métier (SQLite D1 et PostgreSQL 16 doivent rester interchangeables).',
    );
  }
}

// ---------------------------------------------------------------- adaptateurs unknown → typé

type Fields = Readonly<Record<string, unknown>>;

function fields(input: unknown, code: string): Fields {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(`${code}: entrée de forme inattendue (objet attendu).`);
  }
  return input as Fields;
}

function str(source: Fields, key: string, code: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new Error(`${code}: champ [${key}] de type string attendu.`);
  }
  return value;
}

function num(source: Fields, key: string, code: string): number {
  const value = source[key];
  if (typeof value !== 'number') {
    throw new Error(`${code}: champ [${key}] de type number attendu.`);
  }
  return value;
}

function strings(source: Fields, key: string, code: string): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    throw new Error(`${code}: champ [${key}] de type string[] attendu.`);
  }
  return value;
}

function bool(source: Fields, key: string, code: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${code}: champ [${key}] de type boolean attendu.`);
  }
  return value;
}

function entry(spec: AdrInvariant): AdrInvariant {
  Object.freeze(spec.conforming);
  Object.freeze(spec.violating);
  return Object.freeze(spec);
}

const ICE_SAMPLE = '003976749000084';

/**
 * Catalogue des 13 invariants exécutables des 12 ADR. Chaque entrée porte une fonction de contrôle réelle
 * et des cas conformes/violants que la suite de tests rejoue. (Ne pas confondre avec l'objet de gardes
 * FISCA_ADR_INVARIANTS de Doc_05 §14, exporté en fin de fichier.)
 */
export const FISCA_ADR_INVARIANT_CATALOG: readonly AdrInvariant[] = Object.freeze([
  entry({
    id: 'INV-ADR-01-01', adr: 'ADR-01', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_01_POS_PREFIX_COLLISION',
    statement: 'Chaque caisse POS porte un préfixe matériel unique et non vide, pour exclure toute collision de numérotation hors-ligne.',
    check: (input) => assertUniquePosPrefixes(strings(fields(input, 'ADR_01_POS_PREFIX_COLLISION'), 'prefixes', 'ADR_01_POS_PREFIX_COLLISION')),
    conforming: [{ prefixes: ['POS-A1', 'POS-B2'] }],
    violating: [{ prefixes: ['POS-A1', 'POS-A1'] }, { prefixes: [''] }],
  }),
  entry({
    id: 'INV-ADR-02-01', adr: 'ADR-02', origin: 'DOC_05_SECTION_14', errorCode: 'ADR_02_10_TENANT_LEAK_RISK',
    statement: 'Aucun schéma d\'outil exposé au LLM ou à MCP n\'accepte tenantId, tenant_id, companyId, company_id ni d1DatabaseId.',
    check: (input) => {
      const code = 'ADR_02_10_TENANT_LEAK_RISK';
      const source = fields(input, code);
      assertSafeMcpToolSchema(str(source, 'toolName', code), strings(source, 'parameterKeys', code));
    },
    conforming: [{ toolName: 'listInvoices', parameterKeys: ['status', 'page'] }],
    violating: [{ toolName: 'listInvoices', parameterKeys: ['companyId'] }, { toolName: 'x', parameterKeys: ['d1DatabaseId'] }],
  }),
  entry({
    id: 'INV-ADR-03-01', adr: 'ADR-03', origin: 'DOC_05_SECTION_14', errorCode: 'ADR_03_FLOAT_FORBIDDEN',
    statement: 'Tout montant en centimes et tout taux en bps est un entier sûr strict (aucun flottant, NaN ni dépassement).',
    check: (input) => {
      const code = 'ADR_03_FLOAT_FORBIDDEN';
      const source = fields(input, code);
      assertSafeIntegerAmount(num(source, 'value', code), str(source, 'label', code));
    },
    conforming: [{ value: 12450, label: 'montant' }, { value: -1, label: 'avoir' }],
    violating: [{ value: 12.5, label: 'montant' }, { value: Number.NaN, label: 'montant' }, { value: Number.MAX_SAFE_INTEGER + 1, label: 'montant' }],
  }),
  entry({
    id: 'INV-ADR-04-01', adr: 'ADR-04', origin: 'DOC_05_SECTION_14', errorCode: 'ADR_04_LF2026_VAT_VIOLATION',
    statement: 'À partir de 2026 seuls les taux de TVA 2000, 1000 et 0 bps sont admis ; les millésimes antérieurs restent à la charge du moteur AST.',
    check: (input) => {
      const code = 'ADR_04_LF2026_VAT_VIOLATION';
      const source = fields(input, code);
      assertValidVatRateForIssueYear(num(source, 'vatRateBps', code), str(source, 'issueDateIso', code));
    },
    conforming: [{ vatRateBps: 2000, issueDateIso: '2026-02-01' }, { vatRateBps: 1400, issueDateIso: '2025-06-30' }],
    violating: [{ vatRateBps: 1400, issueDateIso: '2026-02-01' }, { vatRateBps: 700, issueDateIso: '2030-01-01' }],
  }),
  entry({
    id: 'INV-ADR-05-01', adr: 'ADR-05', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_05_CASH_5161_CREDITOR',
    statement: 'Un décaissement qui rend la caisse 5161 créditrice est bloqué.',
    check: (input) => {
      const code = 'ADR_05_CASH_5161_CREDITOR';
      const source = fields(input, code);
      assertCashAccountNotCreditor(str(source, 'accountCode', code), num(source, 'balanceCents', code));
    },
    conforming: [{ accountCode: '5161', balanceCents: 0 }, { accountCode: '5141', balanceCents: -500 }],
    violating: [{ accountCode: '5161', balanceCents: -1 }],
  }),
  entry({
    id: 'INV-ADR-06-01', adr: 'ADR-06', origin: 'DOC_05_SECTION_14', errorCode: 'ADR_06_LOI4320_CERT_MISMATCH',
    statement: 'Le SubjectDN du certificat qualifié porte l\'ICE (15 chiffres) ou l\'IF de la société émettrice avant tout appel HSM.',
    check: (input) => {
      const code = 'ADR_06_LOI4320_CERT_MISMATCH';
      const source = fields(input, code);
      assertCertificateMatchesEmitter(str(source, 'certSubjectDn', code), str(source, 'emitterIce', code), str(source, 'emitterIf', code));
    },
    conforming: [{ certSubjectDn: `CN=Emetteur, 2.5.4.97=${ICE_SAMPLE}`, emitterIce: ICE_SAMPLE, emitterIf: '1234567' }],
    violating: [{ certSubjectDn: 'CN=Autre', emitterIce: ICE_SAMPLE, emitterIf: '1234567' }],
  }),
  entry({
    id: 'INV-ADR-07-01', adr: 'ADR-07', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_07_ONE_TSA_TOKEN_PER_DAY',
    statement: 'Toutes les pièces d\'une journée partagent un seul jeton RFC 3161 (racine de Merkle quotidienne), et aucun jeton sans pièce.',
    check: (input) => {
      const code = 'ADR_07_ONE_TSA_TOKEN_PER_DAY';
      const source = fields(input, code);
      assertSingleDailyTimestamp(num(source, 'documentCount', code), num(source, 'tsaTokenCount', code));
    },
    conforming: [{ documentCount: 50000, tsaTokenCount: 1 }, { documentCount: 0, tsaTokenCount: 0 }],
    violating: [{ documentCount: 3, tsaTokenCount: 3 }, { documentCount: 3, tsaTokenCount: 0 }, { documentCount: 0, tsaTokenCount: 1 }],
  }),
  entry({
    id: 'INV-ADR-08-01', adr: 'ADR-08', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_08_SHAMIR_2_OF_3',
    statement: 'Le séquestre fiscal est un partage de secret de Shamir 2-sur-3.',
    check: (input) => {
      const code = 'ADR_08_SHAMIR_2_OF_3';
      const source = fields(input, code);
      assertShamirTwoOfThree(num(source, 'threshold', code), num(source, 'shares', code));
    },
    conforming: [{ threshold: 2, shares: 3 }],
    violating: [{ threshold: 3, shares: 3 }, { threshold: 1, shares: 3 }, { threshold: 2, shares: 5 }],
  }),
  entry({
    id: 'INV-ADR-09-01', adr: 'ADR-09', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_09_CONTAINER_PLAN',
    statement: 'Seuls fiscal-java, docling-python et camel-bridge sont des conteneurs, et le constructeur UBL natif TypeScript de secours reste déclaré.',
    check: (input) => {
      const code = 'ADR_09_CONTAINER_PLAN';
      const source = fields(input, code);
      assertContainerPlanHasNativeFallback(strings(source, 'services', code), bool(source, 'nativeFallbackBuilder', code));
    },
    conforming: [{ services: ['fiscal-java', 'docling-python', 'camel-bridge'], nativeFallbackBuilder: true }],
    violating: [{ services: ['fiscal-java'], nativeFallbackBuilder: false }, { services: ['mystery-box'], nativeFallbackBuilder: true }],
  }),
  entry({
    id: 'INV-ADR-10-01', adr: 'ADR-10', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_10_AI_LEDGER_MUTATION',
    statement: 'Toute sortie IA reste une proposition : canMutateLedgerDirectly vaut false.',
    check: (input) => {
      const code = 'ADR_10_AI_LEDGER_MUTATION';
      assertAiCannotMutateLedger(bool(fields(input, code), 'canMutateLedgerDirectly', code));
    },
    conforming: [{ canMutateLedgerDirectly: false }],
    violating: [{ canMutateLedgerDirectly: true }],
  }),
  entry({
    id: 'INV-ADR-11-01', adr: 'ADR-11', origin: 'DOC_05_SECTION_14', errorCode: 'ADR_11_SAGE100_CORRUPTION_GUARD',
    statement: 'Aucune requête SQL d\'écriture directe vers les tables internes de Sage 100 ; passage par IPMEncoder ou export .PNM.',
    check: (input) => {
      const code = 'ADR_11_SAGE100_CORRUPTION_GUARD';
      assertReadOnlySageSql(str(fields(input, code), 'sqlQuery', code));
    },
    conforming: [{ sqlQuery: 'SELECT cbMarq FROM F_ECRITUREC WITH (NOLOCK)' }],
    violating: [{ sqlQuery: 'INSERT INTO F_ECRITUREC VALUES (1)' }, { sqlQuery: 'delete from F_ECRITUREC' }],
  }),
  entry({
    id: 'INV-ADR-12-01', adr: 'ADR-12', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_12_UNKNOWN_DRIVER',
    statement: 'Le FiscaInfrastructureAdapter n\'admet que les pilotes CLOUDFLARE_EDGE et SOVEREIGN_MOROCCO_VPS.',
    check: (input) => {
      const code = 'ADR_12_UNKNOWN_DRIVER';
      assertKnownInfrastructureDriver(str(fields(input, code), 'driver', code));
    },
    conforming: [{ driver: 'CLOUDFLARE_EDGE' }, { driver: 'SOVEREIGN_MOROCCO_VPS' }],
    violating: [{ driver: 'AWS_LAMBDA' }],
  }),
  entry({
    id: 'INV-ADR-12-02', adr: 'ADR-12', origin: 'DERIVE_GARDE_FOU_ADR', errorCode: 'ADR_12_NON_PORTABLE_SQL',
    statement: 'Le cœur métier n\'emploie aucune extension SQL propriétaire non portable entre SQLite D1 et PostgreSQL 16.',
    check: (input) => {
      const code = 'ADR_12_NON_PORTABLE_SQL';
      assertPortableSql(str(fields(input, code), 'sqlQuery', code));
    },
    conforming: [{ sqlQuery: 'SELECT id FROM invoices WHERE status = ?' }],
    violating: [{ sqlQuery: 'SELECT data::jsonb FROM t' }, { sqlQuery: 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)' }],
  }),
]);

/** Rejoue tous les cas embarqués ; retourne la liste des écarts (vide = harnais sain). */
export function runAdrInvariantSelfCheck(): readonly string[] {
  const failures: string[] = [];
  for (const invariant of FISCA_ADR_INVARIANT_CATALOG) {
    for (const input of invariant.conforming) {
      try {
        invariant.check(input);
      } catch {
        failures.push(`${invariant.id}: un cas conforme est refusé`);
      }
    }
    for (const input of invariant.violating) {
      try {
        invariant.check(input);
        failures.push(`${invariant.id}: un cas violant est accepté`);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith(invariant.errorCode)) {
          failures.push(`${invariant.id}: mauvais code d'erreur`);
        }
      }
    }
  }
  return failures;
}

/**
 * Objet de gardes tel que Doc_05 §14, Doc_14 §05 et Doc_17 §11 l'appellent :
 * `FISCA_ADR_INVARIANTS.assertSafeMcpToolSchema(...)`.
 */
export const FISCA_ADR_INVARIANTS = Object.freeze({
  assertSafeIntegerAmount,
  assertValidVatRateForIssueYear,
  assertCertificateMatchesEmitter,
  assertSafeMcpToolSchema,
  assertReadOnlySageSql,
});
