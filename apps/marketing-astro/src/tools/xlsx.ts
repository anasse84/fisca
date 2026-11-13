/**
 * Lecteur .xlsx sans dépendance et sans réseau : archive ZIP lue en mémoire, décompression par `DecompressionStream`
 * (API standard du navigateur et de Node), XML lu par balayage. Première feuille du classeur seulement, valeurs de
 * cellule telles que stockées (une cellule numérique reste la chaîne de ses chiffres : c'est là que se perdent les zéros).
 * Limites : ZIP64 et chiffrement non pris en charge (message d'erreur explicite), 40 Mo décompressés par partie.
 */
export class XlsxError extends Error {
  readonly code: 'NOT_ZIP' | 'ZIP64' | 'ENCRYPTED' | 'METHOD' | 'TOO_LARGE' | 'NO_SHEET' | 'CORRUPT';
  constructor(code: XlsxError['code'], message: string) {
    super(message);
    this.name = 'XlsxError';
    this.code = code;
  }
}

const MAX_PART_BYTES = 40 * 1024 * 1024;
const MAX_COLUMNS = 16384;
const MAX_ROWS = 1_048_576;

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
  readonly flags: number;
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}
function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readEntries(bytes: Uint8Array): ReadonlyMap<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= lowest; i -= 1) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('NOT_ZIP', 'Archive ZIP introuvable : ce fichier n’est pas un classeur .xlsx.');
  const count = u16(view, eocd + 10);
  const centralOffset = u32(view, eocd + 16);
  if (count === 0xffff || centralOffset === 0xffffffff) throw new XlsxError('ZIP64', 'Archive ZIP64 non prise en charge.');
  const entries = new Map<string, ZipEntry>();
  let p = centralOffset;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > bytes.length || u32(view, p) !== 0x02014b50) throw new XlsxError('CORRUPT', 'Répertoire central ZIP illisible.');
    const flags = u16(view, p + 8);
    const method = u16(view, p + 10);
    const compressedSize = u32(view, p + 20);
    const uncompressedSize = u32(view, p + 24);
    const nameLength = u16(view, p + 28);
    const extraLength = u16(view, p + 30);
    const commentLength = u16(view, p + 32);
    const localOffset = u32(view, p + 42);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLength));
    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset, flags });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PART_BYTES) {
      await reader.cancel();
      throw new XlsxError('TOO_LARGE', 'Partie du classeur trop volumineuse une fois décompressée.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function readPart(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  if ((entry.flags & 1) !== 0) throw new XlsxError('ENCRYPTED', 'Classeur chiffré non pris en charge.');
  if (entry.uncompressedSize > MAX_PART_BYTES) throw new XlsxError('TOO_LARGE', 'Partie du classeur trop volumineuse.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = entry.localOffset;
  if (p + 30 > bytes.length || u32(view, p) !== 0x04034b50) throw new XlsxError('CORRUPT', 'En-tête local ZIP illisible.');
  const start = p + 30 + u16(view, p + 26) + u16(view, p + 28);
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (raw.length !== entry.compressedSize) throw new XlsxError('CORRUPT', 'Données ZIP tronquées.');
  if (entry.method === 0) return new TextDecoder('utf-8').decode(raw);
  if (entry.method === 8) return new TextDecoder('utf-8').decode(await inflateRaw(raw));
  throw new XlsxError('METHOD', `Méthode de compression ZIP ${String(entry.method)} non prise en charge.`);
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** Texte des balises `<t>` d'un fragment, hors phonétique (`<rPh>`). */
function textOfRuns(fragment: string): string {
  const withoutPhonetic = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of withoutPhonetic.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += decodeXmlEntities(m[1] ?? '');
  return out;
}

export function parseSharedStrings(xml: string): readonly string[] {
  return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => textOfRuns(m[1] ?? ''));
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m === null ? undefined : decodeXmlEntities(m[1] ?? '');
}

/** "AB12" -> 27 (colonne, base 0). */
export function columnIndexOfRef(ref: string): number {
  const m = /^([A-Za-z]+)\d*$/.exec(ref);
  if (m === null) return -1;
  let index = 0;
  for (const ch of (m[1] ?? '').toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function storedValue(body: string, type: string | undefined, sharedStrings: readonly string[]): string {
  const v = /<v\b[^>]*?>([\s\S]*?)<\/v>/.exec(body);
  const stored = v === null ? '' : decodeXmlEntities(v[1] ?? '');
  return type === 's' ? (sharedStrings[Number(stored)] ?? '') : stored;
}

export function parseSheetRows(xml: string, sharedStrings: readonly string[]): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let rowCursor = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const declared = attr(rowMatch[1] ?? '', 'r');
    const rowIndex = declared === undefined ? rowCursor : Number(declared) - 1;
    rowCursor = rowIndex + 1;
    if (rowIndex < 0 || rowIndex >= MAX_ROWS) throw new XlsxError('CORRUPT', 'Numéro de ligne hors limites.');
    const cells: string[] = [];
    let columnCursor = 0;
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const ref = attr(attrs, 'r');
      const column = ref === undefined ? columnCursor : columnIndexOfRef(ref);
      if (column < 0 || column >= MAX_COLUMNS) throw new XlsxError('CORRUPT', 'Colonne hors limites.');
      columnCursor = column + 1;
      const body = cellMatch[2] ?? '';
      const type = attr(attrs, 't');
      const value = type === 'inlineStr' ? textOfRuns(body) : storedValue(body, type, sharedStrings);
      while (cells.length < column) cells.push('');
      cells[column] = value;
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows;
}

function firstSheetPath(workbookXml: string, relsXml: string | undefined): string | undefined {
  const sheet = /<sheet\b[^>]*>/.exec(workbookXml);
  const relId = sheet === null ? undefined : /(?:^|\s)r:id="([^"]*)"/.exec(sheet[0])?.[1];
  if (relId === undefined || relsXml === undefined) return undefined;
  for (const rel of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    if (attr(rel[0], 'Id') === relId) {
      const target = attr(rel[0], 'Target');
      if (target === undefined) return undefined;
      return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    }
  }
  return undefined;
}

/** Lit la première feuille d'un .xlsx : lignes de chaînes, les lignes vides intermédiaires restent vides. */
export async function readXlsxRows(bytes: Uint8Array): Promise<readonly (readonly string[])[]> {
  const entries = readEntries(bytes);
  const part = async (name: string): Promise<string | undefined> => {
    const entry = entries.get(name);
    return entry === undefined ? undefined : readPart(bytes, entry);
  };
  const workbook = await part('xl/workbook.xml');
  if (workbook === undefined) throw new XlsxError('NO_SHEET', 'Classeur sans feuille (xl/workbook.xml absent).');
  const sheetPath = firstSheetPath(workbook, await part('xl/_rels/workbook.xml.rels')) ?? 'xl/worksheets/sheet1.xml';
  const sheetXml = await part(sheetPath);
  if (sheetXml === undefined) throw new XlsxError('NO_SHEET', 'Première feuille introuvable.');
  const sharedXml = await part('xl/sharedStrings.xml');
  return parseSheetRows(sheetXml, sharedXml === undefined ? [] : parseSharedStrings(sharedXml));
}
