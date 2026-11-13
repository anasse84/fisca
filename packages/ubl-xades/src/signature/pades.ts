import { concatBytes, sha256, toHex, utf8 } from './bytes.ts';
import { OID, parseCertificate } from './certificate.ts';
import { assembleCms, buildSignedAttributes, signCmsAttributes } from './cms.ts';
import { UblSignatureError } from './errors.ts';
import { parseTimeStampToken } from './timestamp.ts';
import type { DigestSigner, TimestampProvider } from './types.ts';

/**
 * PAdES-Baseline-T pour le PDF/A-3b Factur-X : mise à jour incrémentale (champ /Sig, /ByteRange, /Contents réservé), CMS détaché
 * (CAdES) avec attribut non signé id-aa-timeStampToken. PROFIL PROVISOIRE ; aucune clé privée ici (DigestSigner).
 * Limites assumées (échec fermé) : xref classique seulement (pas de flux xref ni de flux d'objets pour le catalogue, la page),
 * pas de /AcroForm préexistant, /Annots direct ou absent. Aucune dépendance Node.
 */

export interface PreparePadesOptions {
  readonly signingTime?: Date;
  /** Octets réservés à la signature CMS (défaut 16384 → 32768 hexadécimaux). */
  readonly signatureReserveBytes?: number;
  readonly fieldName?: string;
}

export interface PreparedPadesSignature {
  /** PDF avec l'incrément et la réserve /Contents à zéro. */
  readonly pdf: Uint8Array;
  readonly byteRange: readonly [number, number, number, number];
  /** Offset du « < » du champ /Contents et nombre de caractères hexadécimaux réservés. */
  readonly contentsOffset: number;
  readonly contentsHexLength: number;
  /** SHA-256 des plages signées (ByteRange). */
  readonly digestSha256: Uint8Array;
}

const unsupported = (message: string): UblSignatureError => new UblSignatureError('PDF_UNSUPPORTED_STRUCTURE', message);

function toLatin1(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) out += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return out;
}

function fromLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

/** Fin (exclue) du dictionnaire `<< … >>` commençant à `start` (équilibré, chaînes littérales et hexadécimales ignorées). */
function dictionaryEnd(text: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const two = text.slice(index, index + 2);
    if (two === '<<') {
      depth += 1;
      index += 2;
    } else if (two === '>>') {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
    } else if (text[index] === '(') {
      let level = 1;
      index += 1;
      while (index < text.length && level > 0) {
        if (text[index] === '\\') index += 1;
        else if (text[index] === '(') level += 1;
        else if (text[index] === ')') level -= 1;
        index += 1;
      }
    } else if (text[index] === '<') {
      index = text.indexOf('>', index) + 1;
      if (index === 0) throw unsupported('Chaîne hexadécimale PDF non terminée.');
    } else index += 1;
  }
  throw unsupported('Dictionnaire PDF non terminé.');
}

interface Trailer {
  readonly size: number;
  readonly root: { readonly number: number; readonly generation: number };
  readonly id: string | undefined;
  readonly info: string | undefined;
}

function parseTrailerDictionary(text: string, afterKeyword: number): string {
  const start = text.indexOf('<<', afterKeyword);
  if (start < 0) throw unsupported('Trailer PDF introuvable.');
  return text.slice(start, dictionaryEnd(text, start));
}

function readXrefChain(text: string, startOffset: number): { readonly offsets: Map<number, number>; readonly trailer: Trailer; readonly firstXrefOffset: number } {
  const offsets = new Map<number, number>();
  let trailer: Trailer | undefined;
  let position: number | undefined = startOffset;
  const visited = new Set<number>();
  while (position !== undefined) {
    if (visited.has(position)) throw unsupported('Chaîne /Prev cyclique.');
    visited.add(position);
    if (!text.startsWith('xref', position)) throw unsupported('Flux xref (PDF 1.5+) non supporté : xref classique requis.');
    let cursor = position + 4;
    for (;;) {
      const header = /^\s*(\d+)[ ]+(\d+)\s*\r?\n/.exec(text.slice(cursor, cursor + 40));
      if (header === null) break;
      const first = Number(header[1]);
      const count = Number(header[2]);
      cursor += header[0].length;
      for (let index = 0; index < count; index += 1) {
        const entry = /^(\d{10}) (\d{5}) ([nf])\s{1,2}/.exec(text.slice(cursor, cursor + 22));
        if (entry === null) throw unsupported('Entrée xref illisible.');
        if (entry[3] === 'n' && !offsets.has(first + index)) offsets.set(first + index, Number(entry[1]));
        cursor += 20;
      }
    }
    const keyword = text.indexOf('trailer', cursor);
    if (keyword < 0) throw unsupported('Mot-clé trailer introuvable.');
    const dictionary = parseTrailerDictionary(text, keyword + 7);
    if (/\/XRefStm\b/.test(dictionary)) throw unsupported('Xref hybride non supporté.');
    if (trailer === undefined) {
      const size = /\/Size\s+(\d+)/.exec(dictionary);
      const root = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(dictionary);
      if (size === null || root === null) throw unsupported('Trailer sans /Size ou /Root.');
      const id = /\/ID\s*(\[[^\]]*\])/.exec(dictionary)?.[1];
      const info = /\/Info\s+(\d+\s+\d+\s+R)/.exec(dictionary)?.[1];
      trailer = { size: Number(size[1]), root: { number: Number(root[1]), generation: Number(root[2]) }, id, info };
    }
    const previous = /\/Prev\s+(\d+)/.exec(dictionary);
    position = previous === null ? undefined : Number(previous[1]);
  }
  if (trailer === undefined) throw unsupported('Trailer introuvable.');
  return { offsets, trailer, firstXrefOffset: startOffset };
}

interface ObjectText {
  readonly generation: number;
  /** Dictionnaire `<< … >>` de l'objet. */
  readonly dictionary: string;
}

function readDictionaryObject(text: string, offsets: ReadonlyMap<number, number>, number: number): ObjectText {
  const offset = offsets.get(number);
  if (offset === undefined) throw unsupported('Objet absent de la table xref (flux d’objets non supporté).');
  const header = new RegExp(`^${number}\\s+(\\d+)\\s+obj\\s*`).exec(text.slice(offset, offset + 40));
  if (header === null) throw unsupported('En-tête d’objet PDF illisible.');
  const start = offset + header[0].length;
  if (!text.startsWith('<<', start)) throw unsupported('Objet PDF non dictionnaire.');
  const end = dictionaryEnd(text, start);
  const rest = text.slice(end, end + 30);
  if (/^\s*stream/.test(rest)) throw unsupported('Objet à flux non supporté pour le catalogue ou la page.');
  return { generation: Number(header[1]), dictionary: text.slice(start, end) };
}

function insertIntoDictionary(dictionary: string, addition: string): string {
  return `${dictionary.slice(0, dictionary.length - 2)}${addition}>>`;
}

function firstPageNumber(text: string, offsets: ReadonlyMap<number, number>, catalog: ObjectText): number {
  const pages = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(catalog.dictionary);
  if (pages === null) throw unsupported('Catalogue sans /Pages.');
  let current = Number(pages[1]);
  for (let depth = 0; depth < 16; depth += 1) {
    const node = readDictionaryObject(text, offsets, current);
    const kids = /\/Kids\s*\[\s*(\d+)\s+\d+\s+R/.exec(node.dictionary);
    if (kids === null) {
      if (!/\/Type\s*\/Page\b/.test(node.dictionary)) throw unsupported('Première page introuvable.');
      return current;
    }
    current = Number(kids[1]);
  }
  throw unsupported('Arbre de pages trop profond.');
}

const pad10 = (value: number): string => value.toString().padStart(10, '0');
const pad2 = (value: number): string => value.toString().padStart(2, '0');

function pdfDate(date: Date): string {
  return `D:${date.getUTCFullYear().toString().padStart(4, '0')}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}

/** Prépare l'incrément de signature (champ /Sig avec /ByteRange exact et /Contents réservé) et calcule le SHA-256 des plages signées. */
export async function preparePadesSignature(pdf: Uint8Array, options: PreparePadesOptions = {}): Promise<PreparedPadesSignature> {
  const text = toLatin1(pdf);
  if (!text.startsWith('%PDF-')) throw unsupported('Fichier non PDF.');
  const tail = text.slice(Math.max(0, text.length - 2048));
  const startxrefs = [...tail.matchAll(/startxref\s+(\d+)\s*%%EOF\s*$/g)];
  const startxref = startxrefs[startxrefs.length - 1]?.[1];
  if (startxref === undefined) throw unsupported('startxref introuvable.');
  const { offsets, trailer } = readXrefChain(text, Number(startxref));
  const catalog = readDictionaryObject(text, offsets, trailer.root.number);
  if (/\/AcroForm\b/.test(catalog.dictionary)) throw unsupported('/AcroForm préexistant non supporté.');
  const pageNumber = firstPageNumber(text, offsets, catalog);
  const page = readDictionaryObject(text, offsets, pageNumber);
  if (/\/Annots\s+\d+\s+\d+\s+R/.test(page.dictionary)) throw unsupported('/Annots indirect non supporté.');

  const signatureNumber = trailer.size;
  const widgetNumber = trailer.size + 1;
  const reserveBytes = options.signatureReserveBytes ?? 16384;
  const signingTime = options.signingTime ?? new Date();
  const fieldName = (options.fieldName ?? 'Signature1').replace(/[^A-Za-z0-9_-]/g, '');

  const newCatalog = insertIntoDictionary(catalog.dictionary, ` /AcroForm << /Fields [ ${widgetNumber} 0 R ] /SigFlags 3 >> `);
  const annotsArray = /\/Annots\s*\[([^\]]*)\]/.exec(page.dictionary);
  const newPage =
    annotsArray === null
      ? insertIntoDictionary(page.dictionary, ` /Annots [ ${widgetNumber} 0 R ] `)
      : page.dictionary.replace(annotsArray[0], `/Annots [${annotsArray[1] ?? ''} ${widgetNumber} 0 R ]`);

  const separator = text.endsWith('\n') || text.endsWith('\r') ? '' : '\n';
  let body = separator;
  const base = text.length;
  const entries = new Map<number, number>();
  const append = (number: number, generation: number, content: string): void => {
    entries.set(number, base + body.length);
    body += `${number} ${generation} obj\n${content}\nendobj\n`;
  };
  append(trailer.root.number, catalog.generation, newCatalog);
  if (pageNumber !== trailer.root.number) append(pageNumber, page.generation, newPage);
  const byteRangeReserve = `[0 ${pad10(0)} ${pad10(0)} ${pad10(0)}]`;
  const contentsReserve = `<${'0'.repeat(reserveBytes * 2)}>`;
  const signatureObjectStart = base + body.length;
  entries.set(signatureNumber, signatureObjectStart);
  const signatureHead = `${signatureNumber} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange `;
  const signatureMiddle = ` /Contents `;
  const signatureTail = ` /M (${pdfDate(signingTime)}) >>\nendobj\n`;
  body += signatureHead + byteRangeReserve + signatureMiddle + contentsReserve + signatureTail;
  append(widgetNumber, 0, `<< /Type /Annot /Subtype /Widget /FT /Sig /T (${fieldName}) /V ${signatureNumber} 0 R /F 132 /Rect [0 0 0 0] /P ${pageNumber} 0 R >>`);

  const xrefOffset = base + body.length;
  let xref = 'xref\n';
  for (const [number, offset] of [...entries].sort((left, right) => left[0] - right[0])) {
    xref += `${number} 1\n${pad10(offset)} ${number === signatureNumber || number === widgetNumber ? '00000' : pad5(generationOf(number, trailer, catalog, page, pageNumber))} n \n`;
  }
  xref += `trailer\n<< /Size ${widgetNumber + 1} /Root ${trailer.root.number} ${trailer.root.generation} R /Prev ${startxref}${trailer.info === undefined ? '' : ` /Info ${trailer.info}`}${trailer.id === undefined ? '' : ` /ID ${trailer.id}`} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const update = body + xref;

  // ByteRange définitif : [0, début de <Contents>, fin de <Contents>, reste].
  const contentsOffset = base + body.indexOf(contentsReserve, signatureObjectStart - base);
  const afterContents = contentsOffset + contentsReserve.length;
  const total = base + update.length;
  const byteRange = [0, contentsOffset, afterContents, total - afterContents] as const;
  const finalUpdate = update.replace(byteRangeReserve, `[0 ${pad10(byteRange[1])} ${pad10(byteRange[2])} ${pad10(byteRange[3])}]`);
  const output = concatBytes(pdf, fromLatin1(finalUpdate));
  const digestSha256 = await sha256(concatBytes(output.subarray(0, byteRange[1]), output.subarray(byteRange[2])));
  return { pdf: output, byteRange, contentsOffset, contentsHexLength: reserveBytes * 2, digestSha256 };
}

const pad5 = (value: number): string => value.toString().padStart(5, '0');
function generationOf(number: number, trailer: Trailer, catalog: ObjectText, page: ObjectText, pageNumber: number): number {
  if (number === trailer.root.number) return catalog.generation;
  if (number === pageNumber) return page.generation;
  return 0;
}

/** Réinjecte le CMS DER dans /Contents (complété par des zéros) ; échoue si la réserve est trop petite. */
export function finalizePadesSignature(prepared: PreparedPadesSignature, cmsDer: Uint8Array): Uint8Array {
  const hex = toHex(cmsDer);
  if (hex.length > prepared.contentsHexLength) {
    throw new UblSignatureError('PDF_SIGNATURE_TOO_LARGE', 'La signature CMS dépasse la réserve /Contents ; augmenter signatureReserveBytes.');
  }
  const check = toLatin1(prepared.pdf.subarray(prepared.contentsOffset, prepared.contentsOffset + 1));
  if (check !== '<') throw new UblSignatureError('PDF_NOT_PREPARED', 'Le PDF fourni n’est pas un résultat de preparePadesSignature.');
  const out = new Uint8Array(prepared.pdf);
  out.set(utf8(hex.padEnd(prepared.contentsHexLength, '0')), prepared.contentsOffset + 1);
  return out;
}

export interface SignPadesOptions extends PreparePadesOptions {
  readonly certificateDer: Uint8Array;
  readonly signer: DigestSigner;
  readonly timestampProvider: TimestampProvider;
}

export interface SignedPades {
  readonly pdf: Uint8Array;
  readonly cms: Uint8Array;
  readonly byteRange: readonly [number, number, number, number];
  readonly timestampGenTime: Date;
}

/**
 * Chaîne complète : préparation → attributs signés → signature distante du condensé SHA-256 des attributs DER → jeton RFC 3161
 * sur la valeur de signature → CMS détaché → réinjection dans /Contents.
 */
export async function signPades(pdf: Uint8Array, options: SignPadesOptions): Promise<SignedPades> {
  const certificate = parseCertificate(options.certificateDer);
  const signingTime = options.signingTime ?? new Date();
  const prepared = await preparePadesSignature(pdf, { ...options, signingTime });
  const attributes = await buildSignedAttributes({ certificate, signingTime, contentDigestSha256: prepared.digestSha256, contentTypeOid: OID.data });
  const signatureValue = await signCmsAttributes(options.signer, certificate.algorithm, attributes);
  const token = await options.timestampProvider.timestamp(await sha256(signatureValue));
  const parsed = parseTimeStampToken(token, { expectedImprintSha256: await sha256(signatureValue) });
  const cms = assembleCms({ certificate, algorithm: certificate.algorithm, signedAttributesSet: attributes, signatureValue, timeStampToken: token });
  return { pdf: finalizePadesSignature(prepared, cms), cms, byteRange: prepared.byteRange, timestampGenTime: parsed.genTime };
}
