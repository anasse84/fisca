import { containsXmlForbiddenCharacter } from '../generator/xml.ts';
import { UblSignatureError } from './errors.ts';

/**
 * Analyseur XML minimal et strict pour les documents que produit ubl-xades (UBL 2.1 + XML-DSig/XAdES).
 * Accepte : éléments, attributs, espaces de noms, texte, CDATA, les cinq entités prédéfinies, références numériques, commentaires, PI.
 * Refuse (anti-XXE) : toute déclaration DOCTYPE (donc toute entité interne ou externe), toute entité nommée non prédéfinie,
 * les attributs en double, les préfixes non liés, les caractères hors production Char, les profondeurs/tailles excessives.
 * Les messages d'erreur ne reprennent jamais le contenu du document.
 */

export const XML_NS = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

export interface XmlAttribute {
  readonly name: string;
  readonly prefix: string;
  readonly local: string;
  readonly ns: string;
  readonly value: string;
}

export interface XmlElement {
  readonly kind: 'element';
  readonly name: string;
  readonly prefix: string;
  readonly local: string;
  readonly ns: string;
  /** Attributs hors déclarations xmlns. */
  readonly attributes: readonly XmlAttribute[];
  /** Déclarations de ce nœud : clé '' = espace par défaut. */
  readonly nsDecls: ReadonlyMap<string, string>;
  readonly children: XmlNode[];
  parent: XmlElement | null;
  /** Offset du « < » de la balise ouvrante, et de la balise fermante (ou fin de balise vide), dans le texte normalisé. */
  readonly start: number;
  contentStart: number;
  contentEnd: number;
  selfClosing: boolean;
}

export interface XmlText {
  readonly kind: 'text';
  value: string;
  parent: XmlElement | null;
}
export interface XmlComment {
  readonly kind: 'comment';
  readonly value: string;
  parent: XmlElement | null;
}
export interface XmlProcessingInstruction {
  readonly kind: 'pi';
  readonly target: string;
  readonly data: string;
  parent: XmlElement | null;
}

export type XmlNode = XmlElement | XmlText | XmlComment | XmlProcessingInstruction;

export interface XmlDocument {
  readonly prolog: readonly (XmlComment | XmlProcessingInstruction)[];
  readonly root: XmlElement;
  readonly epilog: readonly (XmlComment | XmlProcessingInstruction)[];
  /** Texte normalisé (fins de ligne LF, BOM retiré) sur lequel portent les offsets. */
  readonly source: string;
}

const MAX_INPUT_LENGTH = 8_000_000;
const MAX_DEPTH = 128;
const MAX_ATTRIBUTES = 256;
const NAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_.\-\u00B7]*(?::[\p{L}_][\p{L}\p{N}_.\-\u00B7]*)?$/u;
const NCNAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_.\-\u00B7]*$/u;
const PREDEFINED: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function fail(code: 'XML_MALFORMED' | 'XML_DOCTYPE_FORBIDDEN' | 'XML_ENTITY_FORBIDDEN' | 'XML_LIMIT_EXCEEDED', offset: number): never {
  const messages = {
    XML_MALFORMED: 'XML mal formé',
    XML_DOCTYPE_FORBIDDEN: 'Déclaration DOCTYPE refusée (entités et DTD interdites)',
    XML_ENTITY_FORBIDDEN: 'Entité non prédéfinie refusée',
    XML_LIMIT_EXCEEDED: 'Limite de taille ou de profondeur dépassée',
  } as const;
  throw new UblSignatureError(code, `${messages[code]} (position ${offset}).`);
}

function isXmlWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\n';
}

function decodeReferences(raw: string, offset: number): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&([^;&<]{1,12});/g, (_match, body: string) => {
    const predefined = PREDEFINED[body];
    if (predefined !== undefined) return predefined;
    const numeric = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(body);
    if (numeric === null) return fail('XML_ENTITY_FORBIDDEN', offset);
    const codePoint = numeric[1] !== undefined ? Number.parseInt(numeric[1], 16) : Number.parseInt(numeric[2] ?? '0', 10);
    const character = codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '\uffff';
    if (containsXmlForbiddenCharacter(character)) return fail('XML_MALFORMED', offset);
    return character;
  });
}

/** Après décodage des références, aucun « & » brut ne doit subsister (référence mal formée). */
function assertNoBareAmpersand(raw: string, offset: number): void {
  const stripped = raw.replace(/&(?:lt|gt|amp|quot|apos|#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7});/g, '');
  if (/&[\p{L}_][\p{L}\p{N}_.-]*;/u.test(stripped)) fail('XML_ENTITY_FORBIDDEN', offset);
  if (stripped.includes('&')) fail('XML_MALFORMED', offset);
}

export function parseXml(input: string): XmlDocument {
  if (input.length > MAX_INPUT_LENGTH) fail('XML_LIMIT_EXCEEDED', 0);
  const withoutBom = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (containsXmlForbiddenCharacter(withoutBom)) fail('XML_MALFORMED', 0);
  const source = withoutBom.replace(/\r\n?/g, '\n');
  let position = 0;

  const peek = (text: string): boolean => source.startsWith(text, position);
  const skipWhitespace = (): void => {
    while (isXmlWhitespace(source[position])) position += 1;
  };
  const readName = (): string => {
    const begin = position;
    while (position < source.length && !/[\s=/>]/.test(source[position] ?? ' ')) position += 1;
    const name = source.slice(begin, position);
    if (!NAME_PATTERN.test(name)) fail('XML_MALFORMED', begin);
    return name;
  };

  // Déclaration XML éventuelle.
  if (/^<\?xml[ \t\n]/.test(source)) {
    const close = source.indexOf('?>');
    if (close < 0) fail('XML_MALFORMED', 0);
    const declaration = source.slice(5, close);
    if (!/^[ \t\n]+version[ \t\n]*=[ \t\n]*(?:"1\.0"|'1\.0')/.test(declaration)) fail('XML_MALFORMED', 0);
    const encoding = /encoding[ \t\n]*=[ \t\n]*(?:"([^"]*)"|'([^']*)')/.exec(declaration);
    const encodingName = encoding?.[1] ?? encoding?.[2];
    if (encodingName !== undefined && encodingName.toUpperCase() !== 'UTF-8') fail('XML_MALFORMED', 0);
    position = close + 2;
  }

  const parseMisc = (target: (XmlComment | XmlProcessingInstruction)[]): void => {
    if (peek('<!--')) {
      const close = source.indexOf('-->', position + 4);
      if (close < 0) fail('XML_MALFORMED', position);
      const value = source.slice(position + 4, close);
      if (value.includes('--')) fail('XML_MALFORMED', position);
      target.push({ kind: 'comment', value, parent: null });
      position = close + 3;
      return;
    }
    const piStart = position;
    position += 2;
    const name = readName();
    if (name.toLowerCase() === 'xml' || name.includes(':')) fail('XML_MALFORMED', piStart);
    const close = source.indexOf('?>', position);
    if (close < 0) fail('XML_MALFORMED', piStart);
    const raw = source.slice(position, close);
    if (raw.length > 0 && !isXmlWhitespace(raw[0])) fail('XML_MALFORMED', piStart);
    target.push({ kind: 'pi', target: name, data: raw.replace(/^[ \t\n]+/, ''), parent: null });
    position = close + 2;
  };

  const prolog: (XmlComment | XmlProcessingInstruction)[] = [];
  for (;;) {
    skipWhitespace();
    if (peek('<!DOCTYPE') || peek('<!doctype')) fail('XML_DOCTYPE_FORBIDDEN', position);
    if (peek('<!--') || peek('<?')) parseMisc(prolog);
    else break;
  }
  if (source[position] !== '<') fail('XML_MALFORMED', position);

  const parseElement = (parent: XmlElement | null, scope: ReadonlyMap<string, string>, depth: number): XmlElement => {
    if (depth > MAX_DEPTH) fail('XML_LIMIT_EXCEEDED', position);
    const start = position;
    position += 1;
    const name = readName();
    const rawAttributes: { readonly name: string; readonly value: string }[] = [];
    let selfClosing = false;
    for (;;) {
      const before = position;
      skipWhitespace();
      if (peek('/>')) {
        selfClosing = true;
        position += 2;
        break;
      }
      if (source[position] === '>') {
        position += 1;
        break;
      }
      if (position === before) fail('XML_MALFORMED', position);
      const attributeName = readName();
      skipWhitespace();
      if (source[position] !== '=') fail('XML_MALFORMED', position);
      position += 1;
      skipWhitespace();
      const quote = source[position];
      if (quote !== '"' && quote !== "'") fail('XML_MALFORMED', position);
      const valueStart = position + 1;
      const valueEnd = source.indexOf(quote, valueStart);
      if (valueEnd < 0) fail('XML_MALFORMED', position);
      const raw = source.slice(valueStart, valueEnd);
      if (raw.includes('<')) fail('XML_MALFORMED', valueStart);
      assertNoBareAmpersand(raw, valueStart);
      // Normalisation des valeurs d'attributs CDATA : TAB/LF littéraux → espace, puis références (qui restent telles quelles).
      const value = decodeReferences(raw.replace(/[\t\n]/g, ' '), valueStart);
      if (rawAttributes.some((existing) => existing.name === attributeName)) fail('XML_MALFORMED', valueStart);
      rawAttributes.push({ name: attributeName, value });
      position = valueEnd + 1;
      if (rawAttributes.length > MAX_ATTRIBUTES) fail('XML_LIMIT_EXCEEDED', position);
    }

    const declarations = new Map<string, string>();
    for (const attribute of rawAttributes) {
      if (attribute.name === 'xmlns') declarations.set('', attribute.value);
      else if (attribute.name.startsWith('xmlns:')) {
        const prefix = attribute.name.slice(6);
        if (prefix === 'xmlns' || prefix === 'xml' || attribute.value === '' || !NCNAME_PATTERN.test(prefix)) fail('XML_MALFORMED', start);
        declarations.set(prefix, attribute.value);
      }
    }
    const inScope = new Map(scope);
    for (const [prefix, uri] of declarations) inScope.set(prefix, uri);

    const resolve = (qualified: string, isAttribute: boolean): { readonly prefix: string; readonly local: string; readonly ns: string } => {
      const colon = qualified.indexOf(':');
      if (colon < 0) return { prefix: '', local: qualified, ns: isAttribute ? '' : (inScope.get('') ?? '') };
      const prefix = qualified.slice(0, colon);
      const local = qualified.slice(colon + 1);
      if (prefix === 'xml') return { prefix, local, ns: XML_NS };
      const ns = inScope.get(prefix);
      if (ns === undefined) fail('XML_MALFORMED', start);
      return { prefix, local, ns };
    };

    const attributes: XmlAttribute[] = [];
    for (const attribute of rawAttributes) {
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue;
      const resolved = resolve(attribute.name, true);
      attributes.push({ name: attribute.name, ...resolved, value: attribute.value });
    }
    // Deux attributs de même (ns, local) sous des préfixes différents : mal formé.
    const seen = new Set<string>();
    for (const attribute of attributes) {
      const key = `${attribute.ns}\u0000${attribute.local}`;
      if (seen.has(key)) fail('XML_MALFORMED', start);
      seen.add(key);
    }
    const elementName = resolve(name, false);
    const element: XmlElement = {
      kind: 'element',
      name,
      ...elementName,
      attributes,
      nsDecls: declarations,
      children: [],
      parent,
      start,
      contentStart: position,
      contentEnd: position,
      selfClosing,
    };
    if (selfClosing) return element;

    for (;;) {
      if (position >= source.length) fail('XML_MALFORMED', position);
      if (peek('</')) {
        element.contentEnd = position;
        position += 2;
        const closing = readName();
        if (closing !== name) fail('XML_MALFORMED', position);
        skipWhitespace();
        if (source[position] !== '>') fail('XML_MALFORMED', position);
        position += 1;
        return element;
      }
      if (peek('<!--') || peek('<?')) {
        const holder: (XmlComment | XmlProcessingInstruction)[] = [];
        parseMisc(holder);
        for (const node of holder) {
          node.parent = element;
          element.children.push(node);
        }
        continue;
      }
      if (peek('<!DOCTYPE') || peek('<!doctype')) fail('XML_DOCTYPE_FORBIDDEN', position);
      if (peek('<![CDATA[')) {
        const close = source.indexOf(']]>', position + 9);
        if (close < 0) fail('XML_MALFORMED', position);
        appendText(element, source.slice(position + 9, close));
        position = close + 3;
        continue;
      }
      if (source[position] === '<') {
        const child = parseElement(element, inScope, depth + 1);
        child.parent = element;
        element.children.push(child);
        continue;
      }
      const next = source.indexOf('<', position);
      const end = next < 0 ? source.length : next;
      const raw = source.slice(position, end);
      if (raw.includes(']]>')) fail('XML_MALFORMED', position);
      assertNoBareAmpersand(raw, position);
      appendText(element, decodeReferences(raw, position));
      position = end;
    }
  };

  const appendText = (element: XmlElement, value: string): void => {
    const last = element.children[element.children.length - 1];
    if (last !== undefined && last.kind === 'text') last.value += value;
    else element.children.push({ kind: 'text', value, parent: element });
  };

  const root = parseElement(null, new Map(), 0);
  const epilog: (XmlComment | XmlProcessingInstruction)[] = [];
  for (;;) {
    skipWhitespace();
    if (position >= source.length) break;
    if (peek('<!--') || peek('<?')) parseMisc(epilog);
    else fail('XML_MALFORMED', position);
  }
  return { prolog, root, epilog, source };
}

/** Décodage UTF-8 strict d'un document (échec sur séquence invalide). */
export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new UblSignatureError('XML_MALFORMED', 'Document non UTF-8.');
  }
}

/** Parcours en profondeur des éléments descendants (ou soi-même), dans l'ordre du document. */
export function* descendantElements(element: XmlElement): Generator<XmlElement> {
  yield element;
  for (const child of element.children) {
    if (child.kind === 'element') yield* descendantElements(child);
  }
}

export function childElements(element: XmlElement): XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.kind === 'element');
}

export function textContent(element: XmlElement): string {
  return element.children.map((child) => (child.kind === 'text' ? child.value : child.kind === 'element' ? textContent(child) : '')).join('');
}

export function attributeValue(element: XmlElement, localName: string): string | undefined {
  return element.attributes.find((attribute) => attribute.ns === '' && attribute.local === localName)?.value;
}
