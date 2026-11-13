import { UblSignatureError } from './errors.ts';
import { parseXml, XML_NS, type XmlAttribute, type XmlDocument, type XmlElement, type XmlNode } from './xml-parser.ts';

/**
 * Canonisation XML sans commentaires, TypeScript pur (aucune API DOM, aucun import node:*).
 *  - Canonical XML 1.1 : http://www.w3.org/2006/12/xml-c14n11 (https://www.w3.org/TR/xml-c14n11/)
 *  - Exclusive XML Canonicalization 1.0 : http://www.w3.org/2001/10/xml-exc-c14n#
 * Sélection de sous-ensemble : `omit` (sous-arbres retirés, ex. transformation enveloped-signature) et `include`
 * (équivalent d'un node-set XPath sur éléments, texte, PI) ; les attributs et espaces de noms suivent leur élément.
 */

export const C14N11_ALGORITHM = 'http://www.w3.org/2006/12/xml-c14n11';
export const EXC_C14N_ALGORITHM = 'http://www.w3.org/2001/10/xml-exc-c14n#';

export interface C14nOptions {
  readonly algorithm?: 'c14n11' | 'exc-c14n';
  /** Exclusive seulement : préfixes de l'InclusiveNamespaces PrefixList (« #default » pour l'espace par défaut). */
  readonly inclusivePrefixes?: readonly string[];
  /** Sous-arbres exclus entièrement. */
  readonly omit?: ReadonlySet<XmlElement>;
  /** Sous-ensemble : élément / texte / PI retenu ou non (défaut : tout). Un élément écarté laisse ses descendants candidats. */
  readonly include?: (node: XmlNode) => boolean;
}

const encoder = new TextEncoder();

function escapeText(value: string): string {
  return value.replace(/[&<>\r]/g, (character) => (character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;' : '&#xD;'));
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<"\t\n\r]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '"':
        return '&quot;';
      case '\t':
        return '&#x9;';
      case '\n':
        return '&#xA;';
      default:
        return '&#xD;';
    }
  });
}

/** Comparaison par points de code Unicode (UTF-8 ordonné), pas par unités UTF-16. */
function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const common = Math.min(a.length, b.length);
  for (let index = 0; index < common; index += 1) {
    const delta = (a[index]?.codePointAt(0) ?? 0) - (b[index]?.codePointAt(0) ?? 0);
    if (delta !== 0) return delta;
  }
  return a.length - b.length;
}

// --- Jointure d'URI pour la correction de xml:base (C14N 1.1 § 2.4, RFC 3986 § 5.2 modifié) ---

interface UriParts {
  readonly scheme: string | undefined;
  readonly authority: string | undefined;
  readonly path: string;
  readonly query: string | undefined;
}

function parseUri(uri: string): UriParts {
  const withoutFragment = uri.split('#')[0] ?? '';
  const match = /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?:\/\/([^/?]*))?([^?]*)(?:\?(.*))?$/.exec(withoutFragment);
  return { scheme: match?.[1], authority: match?.[2], path: match?.[3] ?? '', query: match?.[4] };
}

function removeDotSegments(path: string): string {
  const absolute = path.startsWith('/');
  const segments = path.split('/');
  if (absolute) segments.shift();
  const output: string[] = [];
  let trailing = false;
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '') {
      if (last) trailing = true;
    } else if (segment === '.') {
      if (last) trailing = true;
    } else if (segment === '..') {
      const top = output[output.length - 1];
      if (top !== undefined && top !== '..') output.pop();
      else if (!absolute) output.push('..');
      if (last) trailing = true;
    } else {
      output.push(segment);
    }
  });
  return `${absolute ? '/' : ''}${output.join('/')}${trailing && output.length > 0 ? '/' : ''}`;
}

/** Combine une valeur xml:base relative `reference` avec la base `base` (fonction « join-URI-References » de C14N 1.1). */
export function joinXmlBase(base: string, reference: string): string {
  const baseParts = parseUri(base.endsWith('..') && !base.endsWith('/..') ? `${base}/` : base === '..' ? '../' : base);
  const normalizedReference = reference === '..' || reference.endsWith('/..') ? `${reference}/` : reference;
  const ref = parseUri(normalizedReference);
  let path: string;
  let query: string | undefined;
  let authority: string | undefined;
  let scheme: string | undefined;
  if (ref.scheme !== undefined) {
    scheme = ref.scheme;
    authority = ref.authority;
    path = removeDotSegments(ref.path);
    query = ref.query;
  } else {
    scheme = baseParts.scheme;
    if (ref.authority !== undefined) {
      authority = ref.authority;
      path = removeDotSegments(ref.path);
      query = ref.query;
    } else {
      authority = baseParts.authority;
      if (ref.path === '') {
        path = baseParts.path;
        query = ref.query ?? baseParts.query;
      } else {
        if (ref.path.startsWith('/')) path = removeDotSegments(ref.path);
        else {
          const lastSlash = baseParts.path.lastIndexOf('/');
          const merged =
            baseParts.authority !== undefined && baseParts.path === ''
              ? `/${ref.path}`
              : `${lastSlash >= 0 ? baseParts.path.slice(0, lastSlash + 1) : ''}${ref.path}`;
          path = removeDotSegments(merged);
        }
        query = ref.query;
      }
    }
  }
  return `${scheme !== undefined ? `${scheme}:` : ''}${authority !== undefined ? `//${authority}` : ''}${path}${query !== undefined ? `?${query}` : ''}`;
}

// --- Canonisation ---

interface RenderContext {
  readonly options: C14nOptions;
  readonly exclusive: boolean;
  readonly includedElements: Set<XmlElement>;
}

function inScopeNamespaces(element: XmlElement): Map<string, string> {
  const chain: XmlElement[] = [];
  for (let current: XmlElement | null = element; current !== null; current = current.parent) chain.unshift(current);
  const scope = new Map<string, string>();
  for (const node of chain) for (const [prefix, uri] of node.nsDecls) scope.set(prefix, uri);
  return scope;
}

function xmlAttributeOf(element: XmlElement, local: string): XmlAttribute | undefined {
  return element.attributes.find((attribute) => attribute.ns === XML_NS && attribute.local === local);
}

function compareAttributes(left: XmlAttribute, right: XmlAttribute): number {
  return compareCodePoints(left.ns, right.ns) || compareCodePoints(left.local, right.local);
}

function attributesToRender(element: XmlElement, parentIncluded: boolean, context: RenderContext): XmlAttribute[] {
  const attributes = [...element.attributes];
  if (context.exclusive || parentIncluded) return attributes.sort(compareAttributes);
  // C14N 1.1 § 2.4 : parent omis → héritage de xml:lang / xml:space ; xml:id jamais hérité ; xml:base corrigé.
  const ancestors: XmlElement[] = [];
  for (let current = element.parent; current !== null; current = current.parent) ancestors.push(current);
  for (const local of ['lang', 'space']) {
    if (xmlAttributeOf(element, local) !== undefined) continue;
    for (const ancestor of ancestors) {
      const inherited = xmlAttributeOf(ancestor, local);
      if (inherited !== undefined) {
        attributes.push(inherited);
        break;
      }
    }
  }
  const omittedContiguous: XmlElement[] = [];
  for (const ancestor of ancestors) {
    if (context.includedElements.has(ancestor)) break;
    omittedContiguous.push(ancestor);
  }
  if (omittedContiguous.some((ancestor) => xmlAttributeOf(ancestor, 'base') !== undefined)) {
    const chain = [element, ...ancestors]
      .map((node) => xmlAttributeOf(node, 'base')?.value)
      .filter((value): value is string => value !== undefined);
    // chain : du plus interne au plus externe ; réduction de l'intérieur vers l'extérieur.
    let joined = chain[0] ?? '';
    for (const outer of chain.slice(1)) joined = joinXmlBase(outer, joined);
    const index = attributes.findIndex((attribute) => attribute.ns === XML_NS && attribute.local === 'base');
    if (index >= 0) attributes.splice(index, 1);
    if (joined !== '') attributes.push({ name: 'xml:base', prefix: 'xml', local: 'base', ns: XML_NS, value: joined });
  }
  return attributes.sort(compareAttributes);
}

function renderElement(element: XmlElement, parentOut: ReadonlyMap<string, string>, parentIncluded: boolean, context: RenderContext): string {
  if (context.options.omit?.has(element) === true) return '';
  const isIncluded = context.options.include === undefined || context.options.include(element);
  let out = parentOut;
  let text = '';
  if (isIncluded) {
    context.includedElements.add(element);
    const scope = inScopeNamespaces(element);
    const declarations: [string, string][] = [];
    if (context.exclusive) {
      const utilized = new Set<string>([element.prefix]);
      for (const attribute of element.attributes) if (attribute.prefix !== '' && attribute.prefix !== 'xml') utilized.add(attribute.prefix);
      for (const listed of context.options.inclusivePrefixes ?? []) utilized.add(listed === '#default' ? '' : listed);
      for (const prefix of utilized) {
        if (prefix !== '' && !scope.has(prefix)) continue;
        const uri = scope.get(prefix) ?? '';
        if ((parentOut.get(prefix) ?? '') !== uri) declarations.push([prefix, uri]);
      }
    } else {
      for (const [prefix, uri] of scope) {
        if ((parentOut.get(prefix) ?? '') !== uri) declarations.push([prefix, uri]);
      }
      if (!scope.has('') && (parentOut.get('') ?? '') !== '') declarations.push(['', '']);
    }
    declarations.sort((left, right) => compareCodePoints(left[0], right[0]));
    const next = new Map(parentOut);
    let tag = `<${element.name}`;
    for (const [prefix, uri] of declarations) {
      tag += prefix === '' ? ` xmlns="${escapeAttribute(uri)}"` : ` xmlns:${prefix}="${escapeAttribute(uri)}"`;
      next.set(prefix, uri);
    }
    for (const attribute of attributesToRender(element, parentIncluded, context)) {
      tag += ` ${attribute.name}="${escapeAttribute(attribute.value)}"`;
    }
    out = next;
    text = `${tag}>`;
  }
  for (const child of element.children) {
    if (child.kind === 'element') text += renderElement(child, out, isIncluded, context);
    else if (child.kind === 'text') {
      if (context.options.include?.(child) ?? true) text += escapeText(child.value);
    } else if (child.kind === 'pi') {
      if (context.options.include?.(child) ?? true) text += renderPi(child.target, child.data);
    }
  }
  if (isIncluded) text += `</${element.name}>`;
  return text;
}

function renderPi(target: string, data: string): string {
  return data === '' ? `<?${target}?>` : `<?${target} ${data}?>`;
}

/** Canonicalise un document entier, ou un sous-arbre (élément : contexte d'espaces de noms et xml:* hérité des ancêtres). */
export function canonicalizeTree(target: XmlDocument | XmlElement, options: C14nOptions = {}): Uint8Array {
  const algorithm = options.algorithm ?? 'c14n11';
  if (algorithm !== 'c14n11' && algorithm !== 'exc-c14n') {
    throw new UblSignatureError('C14N_ALGORITHM_UNSUPPORTED', 'Algorithme de canonisation non supporté.');
  }
  const context: RenderContext = { options, exclusive: algorithm === 'exc-c14n', includedElements: new Set() };
  if (!('root' in target)) return encoder.encode(renderElement(target, new Map(), false, context));
  const pis = (nodes: XmlDocument['prolog']): string[] =>
    nodes.flatMap((node) => (node.kind === 'pi' && (options.include?.(node) ?? true) ? [renderPi(node.target, node.data)] : []));
  const before = pis(target.prolog).map((item) => `${item}\n`).join('');
  const after = pis(target.epilog).map((item) => `\n${item}`).join('');
  return encoder.encode(`${before}${renderElement(target.root, new Map(), false, context)}${after}`);
}

/** Canonical XML 1.1 sans commentaires. Accepte du texte XML, un document ou un élément ; retourne les octets UTF-8. */
export function canonicalizeC14n11(input: string | XmlDocument | XmlElement, options: Omit<C14nOptions, 'algorithm' | 'inclusivePrefixes'> = {}): Uint8Array {
  const target = typeof input === 'string' ? parseXml(input) : input;
  return canonicalizeTree(target, { ...options, algorithm: 'c14n11' });
}

/** Exclusive XML Canonicalization 1.0 sans commentaires. */
export function canonicalizeExclusive(input: string | XmlDocument | XmlElement, options: Omit<C14nOptions, 'algorithm'> = {}): Uint8Array {
  const target = typeof input === 'string' ? parseXml(input) : input;
  return canonicalizeTree(target, { ...options, algorithm: 'exc-c14n' });
}
