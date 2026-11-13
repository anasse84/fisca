/** Construction XML par chaîne : échappement strict, aucune dépendance. */

const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Échappe &, <, >, " et ' (contenu comme attribut). */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character] ?? character);
}

/** Production Char de XML 1.0 : tab, LF, CR, U+0020–U+D7FF, U+E000–U+FFFD, U+10000–U+10FFFF. */
function isXmlChar(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

export function containsXmlForbiddenCharacter(value: string): boolean {
  for (const character of value) {
    if (!isXmlChar(character.codePointAt(0) ?? 0)) return true;
  }
  return false;
}

export type XmlAttributes = Readonly<Record<string, string>>;

/** `<name a="v">texte</name>` ; attributs dans l'ordre fourni. */
export function element(name: string, content: string, attributes: XmlAttributes = {}): string {
  const rendered = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('');
  return `<${name}${rendered}>${content}</${name}>`;
}

/** Élément feuille : le texte est échappé. */
export function textElement(name: string, text: string, attributes: XmlAttributes = {}): string {
  return element(name, escapeXml(text), attributes);
}
