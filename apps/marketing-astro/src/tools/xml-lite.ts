/**
 * Lecteur XML minimal et strict, sans dépendance, identique dans le navigateur et dans les tests (Node n'a pas de DOMParser).
 *
 * Il vérifie la forme (balises appariées, attributs entre guillemets et uniques, un seul élément racine, références d'entité
 * limitées aux 5 entités prédéfinies et aux références numériques, préfixes d'espace de noms déclarés, caractères de contrôle)
 * et REJETTE toute déclaration DOCTYPE ou ENTITY : aucune entité externe ni expansion d'entité n'est jamais traitée.
 * Ce n'est pas une validation de schéma.
 */
export interface XmlElement {
  readonly local: string;
  readonly prefix: string;
  readonly namespace: string | null;
  /** Attributs par nom qualifié tel qu'écrit (les déclarations xmlns sont conservées). */
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  /** Texte direct de l'élément (hors descendants), espaces conservés. */
  readonly text: string;
}

export type XmlParseError = 'EMPTY' | 'DOCTYPE' | 'MALFORMED';

export type XmlParseResult = { readonly ok: true; readonly root: XmlElement } | { readonly ok: false; readonly error: XmlParseError; readonly offset: number };

interface MutableElement {
  local: string;
  prefix: string;
  namespace: string | null;
  attributes: Record<string, string>;
  children: MutableElement[];
  text: string;
  scope: Map<string, string>;
  qname: string;
}

const NAME = /[\p{L}_:][\p{L}\p{N}_:.-]*/uy;
const MAX_DEPTH = 256;
const PREDEFINED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

class Fail extends Error {
  constructor(
    readonly kind: XmlParseError,
    readonly offset: number,
  ) {
    super(kind);
  }
}

function decodeReferences(raw: string, offset: number): string {
  return raw.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (_whole, ref: string) => {
    if (ref.startsWith('#')) {
      const code = ref.startsWith('#x') ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code < 0x20 && code !== 9 && code !== 10 && code !== 13) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) {
        throw new Fail('MALFORMED', offset);
      }
      return String.fromCodePoint(code);
    }
    const value = PREDEFINED[ref];
    if (value === undefined) throw new Fail('MALFORMED', offset);
    return value;
  });
}

function assertNoStrayAmpersand(raw: string, offset: number): void {
  if (/&(?!(?:#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);)/.test(raw)) throw new Fail('MALFORMED', offset);
}

function splitQName(qname: string): { readonly prefix: string; readonly local: string } {
  const at = qname.indexOf(':');
  return at < 0 ? { prefix: '', local: qname } : { prefix: qname.slice(0, at), local: qname.slice(at + 1) };
}

function resolve(prefix: string, scope: ReadonlyMap<string, string>, isAttribute: boolean): string | null {
  if (prefix === 'xml') return 'http://www.w3.org/XML/1998/namespace';
  if (prefix === '') return isAttribute ? null : (scope.get('') ?? null);
  return scope.get(prefix) ?? null;
}

function freeze(node: MutableElement): XmlElement {
  return { local: node.local, prefix: node.prefix, namespace: node.namespace, attributes: node.attributes, children: node.children.map(freeze), text: node.text };
}

function parseOrThrow(input: string): XmlElement {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (text.trim() === '') throw new Fail('EMPTY', 0);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) throw new Fail('MALFORMED', i);
  }
  let pos = 0;
  const n = text.length;
  const stack: MutableElement[] = [];
  let root: MutableElement | null = null;

  const skipSpace = (): void => {
    while (pos < n && /[ \t\r\n]/.test(text[pos] ?? '')) pos += 1;
  };

  if (/^<\?xml[ \t\r\n]/.test(text)) {
    const end = text.indexOf('?>');
    if (end < 0) throw new Fail('MALFORMED', 0);
    pos = end + 2;
  }

  while (pos < n) {
    if (text[pos] !== '<') {
      const next = text.indexOf('<', pos);
      const chunk = text.slice(pos, next < 0 ? n : next);
      const top = stack[stack.length - 1];
      if (top === undefined) {
        if (chunk.trim() !== '') throw new Fail('MALFORMED', pos);
      } else {
        assertNoStrayAmpersand(chunk, pos);
        if (chunk.includes(']]>')) throw new Fail('MALFORMED', pos);
        top.text += decodeReferences(chunk, pos);
      }
      pos = next < 0 ? n : next;
      continue;
    }
    if (text.startsWith('<!--', pos)) {
      const end = text.indexOf('-->', pos + 4);
      if (end < 0 || text.slice(pos + 4, end).includes('--')) throw new Fail('MALFORMED', pos);
      pos = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', pos)) {
      const top = stack[stack.length - 1];
      const end = text.indexOf(']]>', pos + 9);
      if (top === undefined || end < 0) throw new Fail('MALFORMED', pos);
      top.text += text.slice(pos + 9, end);
      pos = end + 3;
      continue;
    }
    if (/^<!(?:DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)/i.test(text.slice(pos, pos + 12))) throw new Fail('DOCTYPE', pos);
    if (text.startsWith('<!', pos)) throw new Fail('MALFORMED', pos);
    if (text.startsWith('<?', pos)) {
      const end = text.indexOf('?>', pos + 2);
      if (end < 0 || /^<\?xml[ \t\r\n?]/i.test(text.slice(pos, pos + 7))) throw new Fail('MALFORMED', pos);
      pos = end + 2;
      continue;
    }
    if (text.startsWith('</', pos)) {
      NAME.lastIndex = pos + 2;
      const m = NAME.exec(text);
      const top = stack[stack.length - 1];
      if (m === null || top === undefined || m[0] !== top.qname) throw new Fail('MALFORMED', pos);
      pos = NAME.lastIndex;
      skipSpace();
      if (text[pos] !== '>') throw new Fail('MALFORMED', pos);
      pos += 1;
      stack.pop();
      continue;
    }
    // Balise ouvrante.
    NAME.lastIndex = pos + 1;
    const nameMatch = NAME.exec(text);
    if (nameMatch === null) throw new Fail('MALFORMED', pos);
    const qname = nameMatch[0];
    pos = NAME.lastIndex;
    const raw: Record<string, string> = {};
    let selfClosing = false;
    for (;;) {
      const before = pos;
      skipSpace();
      const c = text[pos];
      if (c === '>') {
        pos += 1;
        break;
      }
      if (c === '/') {
        if (text[pos + 1] !== '>') throw new Fail('MALFORMED', pos);
        pos += 2;
        selfClosing = true;
        break;
      }
      if (pos === before || c === undefined) throw new Fail('MALFORMED', pos);
      NAME.lastIndex = pos;
      const attr = NAME.exec(text);
      if (attr === null) throw new Fail('MALFORMED', pos);
      pos = NAME.lastIndex;
      skipSpace();
      if (text[pos] !== '=') throw new Fail('MALFORMED', pos);
      pos += 1;
      skipSpace();
      const quote = text[pos];
      if (quote !== '"' && quote !== "'") throw new Fail('MALFORMED', pos);
      const close = text.indexOf(quote, pos + 1);
      if (close < 0) throw new Fail('MALFORMED', pos);
      const value = text.slice(pos + 1, close);
      if (value.includes('<')) throw new Fail('MALFORMED', pos);
      assertNoStrayAmpersand(value, pos);
      if (Object.hasOwn(raw, attr[0])) throw new Fail('MALFORMED', pos);
      raw[attr[0]] = decodeReferences(value, pos);
      pos = close + 1;
    }
    const parent = stack[stack.length - 1];
    if (parent === undefined && root !== null) throw new Fail('MALFORMED', pos);
    const scope = new Map<string, string>(parent?.scope ?? []);
    for (const [name, value] of Object.entries(raw)) {
      if (name === 'xmlns') scope.set('', value);
      else if (name.startsWith('xmlns:')) scope.set(name.slice(6), value);
    }
    const { prefix, local } = splitQName(qname);
    const namespace = resolve(prefix, scope, false);
    if (prefix !== '' && namespace === null) throw new Fail('MALFORMED', pos);
    for (const name of Object.keys(raw)) {
      const attrPrefix = splitQName(name).prefix;
      if (attrPrefix !== '' && attrPrefix !== 'xmlns' && resolve(attrPrefix, scope, true) === null) throw new Fail('MALFORMED', pos);
    }
    const element: MutableElement = { local, prefix, namespace, attributes: raw, children: [], text: '', scope, qname };
    if (parent === undefined) root = element;
    else parent.children.push(element);
    if (!selfClosing) {
      stack.push(element);
      if (stack.length > MAX_DEPTH) throw new Fail('MALFORMED', pos);
    }
  }
  if (stack.length > 0 || root === null) throw new Fail('MALFORMED', n);
  return freeze(root);
}

export function parseXml(text: string): XmlParseResult {
  try {
    return { ok: true, root: parseOrThrow(text) };
  } catch (error) {
    if (error instanceof Fail) return { ok: false, error: error.kind, offset: error.offset };
    throw error;
  }
}

/** Enfants directs portant ce nom local dans cet espace de noms. */
export function childrenNamed(parent: XmlElement, namespace: string, local: string): readonly XmlElement[] {
  return parent.children.filter((c) => c.local === local && c.namespace === namespace);
}

/** Tous les descendants (profondeur d'abord) portant ce nom local dans cet espace de noms. */
export function descendantsNamed(parent: XmlElement, namespace: string, local: string): readonly XmlElement[] {
  const found: XmlElement[] = [];
  const walk = (node: XmlElement): void => {
    for (const child of node.children) {
      if (child.local === local && child.namespace === namespace) found.push(child);
      walk(child);
    }
  };
  walk(parent);
  return found;
}
