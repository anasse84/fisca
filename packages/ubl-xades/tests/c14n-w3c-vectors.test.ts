import { describe, expect, it } from 'vitest';
import { canonicalizeC14n11, canonicalizeExclusive, joinXmlBase, parseXml, UblSignatureError } from '../src/index.ts';

/**
 * Vecteurs OFFICIELS de la recommandation W3C « Canonical XML Version 1.1 » (https://www.w3.org/TR/xml-c14n11/, § 3 « Examples »).
 * Adaptation commune et assumée : le parseur refuse tout DOCTYPE (anti-XXE), donc les exemples qui s'appuient sur une DTD
 * (§ 3.3 attribut par défaut, § 3.4 attributs ID/NMTOKENS, § 3.5 entités, § 3.7 et § 3.8 xml:space par défaut) sont repris SANS DTD :
 *   - le défaut d'attribut devient explicite ou disparaît de la sortie attendue (documenté test par test) ;
 *   - le § 3.5 (entités) est testé en refus : DOCTYPE et entités nommées rejetés.
 * Les sorties attendues sont celles de la recommandation, octet pour octet, hors ces adaptations.
 */
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('W3C xml-c14n11 § 3 — exemples officiels', () => {
  it('§ 3.1 PIs, commentaires, hors élément document (sans DOCTYPE ; forme sans commentaires)', () => {
    const input = `<?xml version="1.0"?>

<?xml-stylesheet   href="doc.xsl"
   type="text/xsl"   ?>

<doc>Hello, world!<!-- Comment 1 --></doc>

<?pi-without-data     ?>

<!-- Comment 2 -->

<!-- Comment 3 -->`;
    expect(decode(canonicalizeC14n11(input))).toBe(`<?xml-stylesheet href="doc.xsl"
   type="text/xsl"   ?>
<doc>Hello, world!</doc>
<?pi-without-data?>`);
  });

  it('§ 3.2 espaces dans le contenu : entrée identique à la sortie', () => {
    const input = `<doc>
   <clean>   </clean>
   <dirty>   A   B   </dirty>
   <mixed>
      A
      <clean>   </clean>
      B
      <dirty>   A   B   </dirty>
      C
   </mixed>
</doc>`;
    expect(decode(canonicalizeC14n11(input))).toBe(input);
  });

  it('§ 3.3 balises ouvrantes et fermantes (sans DTD : pas d’attribut par défaut sur e9)', () => {
    const input = `<doc>
   <e1   />
   <e2   ></e2>
   <e3   name = "elem3"   id="elem3"   />
   <e4   name="elem4"   id="elem4"   ></e4>
   <e5 a:attr="out" b:attr="sorted" attr2="all" attr="I'm"
      xmlns:b="http://www.ietf.org"
      xmlns:a="http://www.w3.org"
      xmlns="http://example.org"/>
   <e6 xmlns="" xmlns:a="http://www.w3.org">
      <e7 xmlns="http://www.ietf.org">
         <e8 xmlns="" xmlns:a="http://www.w3.org">
            <e9 xmlns="" xmlns:a="http://www.ietf.org"/>
         </e8>
      </e7>
   </e6>
</doc>`;
    const expected = `<doc>
   <e1></e1>
   <e2></e2>
   <e3 id="elem3" name="elem3"></e3>
   <e4 id="elem4" name="elem4"></e4>
   <e5 xmlns="http://example.org" xmlns:a="http://www.w3.org" xmlns:b="http://www.ietf.org" attr="I'm" attr2="all" b:attr="sorted" a:attr="out"></e5>
   <e6 xmlns:a="http://www.w3.org">
      <e7 xmlns="http://www.ietf.org">
         <e8 xmlns="">
            <e9 xmlns:a="http://www.ietf.org"></e9>
         </e8>
      </e7>
   </e6>
</doc>`;
    expect(decode(canonicalizeC14n11(input))).toBe(expected);
  });

  it('§ 3.4 modifications de caractères et références (sans DTD : pas de normalisation ID / NMTOKENS)', () => {
    const input = `<doc>
   <text>First line&#x0d;&#10;Second line</text>
   <value>&#x32;</value>
   <compute><![CDATA[value>"0" && value<"10" ?"valid":"error"]]></compute>
   <compute expr='value>"0" &amp;&amp; value&lt;"10" ?"valid":"error"'>valid</compute>
   <norm attr=' &apos;   &#x20;&#13;&#xa;&#9;   &apos;
'/>
</doc>`;
    const expected = `<doc>
   <text>First line&#xD;
Second line</text>
   <value>2</value>
   <compute>value&gt;"0" &amp;&amp; value&lt;"10" ?"valid":"error"</compute>
   <compute expr="value>&quot;0&quot; &amp;&amp; value&lt;&quot;10&quot; ?&quot;valid&quot;:&quot;error&quot;">valid</compute>
   <norm attr=" '    &#xD;&#xA;&#x9;   ' "></norm>
</doc>`;
    expect(decode(canonicalizeC14n11(input))).toBe(expected);
  });

  it('§ 3.4 (fins de ligne) : CRLF et CR littéraux deviennent LF avant canonisation ; &#xD; est conservé', () => {
    expect(decode(canonicalizeC14n11('<a>x\r\ny\rz&#xD;</a>'))).toBe('<a>x\ny\nz&#xD;</a>');
  });

  it('§ 3.5 entités : tout DOCTYPE et toute entité nommée sont REFUSÉS (anti-XXE) au lieu d’être développés', () => {
    const codeOf = (xml: string): string | undefined => {
      try {
        parseXml(xml);
        return undefined;
      } catch (error) {
        return error instanceof UblSignatureError ? error.code : 'AUTRE';
      }
    };
    expect(codeOf('<!DOCTYPE doc [<!ENTITY ent1 "Hello">]><doc>&ent1;</doc>')).toBe('XML_DOCTYPE_FORBIDDEN');
    expect(codeOf('<!DOCTYPE doc SYSTEM "file:///etc/passwd"><doc/>')).toBe('XML_DOCTYPE_FORBIDDEN');
    expect(codeOf('<?xml version="1.0"?>\n<!DOCTYPE doc><doc/>')).toBe('XML_DOCTYPE_FORBIDDEN');
    expect(codeOf('<doc>&ent1;</doc>')).toBe('XML_ENTITY_FORBIDDEN');
    expect(codeOf('<doc a="&xxe;"/>')).toBe('XML_ENTITY_FORBIDDEN');
  });

  it('§ 3.6 encodage UTF-8 : le caractère © sort sur les deux octets C2 A9', () => {
    const bytes = canonicalizeC14n11('<?xml version="1.0" encoding="UTF-8"?>\n<doc>&#169;</doc>');
    expect(Array.from(bytes)).toEqual([...new TextEncoder().encode('<doc>'), 0xc2, 0xa9, ...new TextEncoder().encode('</doc>')]);
  });

  const isE1OrE3 = (node: { kind: string; local?: string }): boolean => node.kind === 'element' && (node.local === 'e1' || node.local === 'e3');

  it('§ 3.7 sous-ensemble de document (xml:space explicite sur e2 à la place du défaut DTD)', () => {
    const input = `<doc xmlns="http://www.ietf.org" xmlns:w3c="http://www.w3.org">
   <e1>
      <e2 xmlns="" xml:space="preserve">
         <e3 id="E3"/>
      </e2>
   </e1>
</doc>`;
    const out = canonicalizeC14n11(parseXml(input), { include: (node) => isE1OrE3(node) });
    expect(decode(out)).toBe(
      '<e1 xmlns="http://www.ietf.org" xmlns:w3c="http://www.w3.org"><e3 xmlns="" id="E3" xml:space="preserve"></e3></e1>',
    );
  });

  it('§ 3.8 sous-ensemble et attributs xml:* : xml:id non hérité, xml:space hérité, xml:base corrigé', () => {
    const input = `<doc xmlns="http://www.ietf.org" xmlns:w3c="http://www.w3.org" xml:base="something/else">
   <e1>
      <e2 xmlns="" xml:id="abc" xml:base="bar/" xml:space="preserve">
         <e3 id="E3" xml:base="foo"/>
      </e2>
   </e1>
</doc>`;
    const out = canonicalizeC14n11(parseXml(input), { include: (node) => isE1OrE3(node) });
    expect(decode(out)).toBe(
      '<e1 xmlns="http://www.ietf.org" xmlns:w3c="http://www.w3.org" xml:base="something/else"><e3 xmlns="" id="E3" xml:base="something/bar/foo" xml:space="preserve"></e3></e1>',
    );
  });

  it('§ 2.4 join-URI-References : exemples de la recommandation', () => {
    expect(joinXmlBase('abc/', '../')).toBe('');
    expect(joinXmlBase('../', '../')).toBe('../../');
    expect(joinXmlBase('..', '..')).toBe('../../');
  });
});

describe('canonisation : propriétés complémentaires', () => {
  it('sous-arbre : les espaces de noms hérités des ancêtres sont portés par l’apex', () => {
    const doc = parseXml('<a xmlns="urn:a" xmlns:p="urn:p"><b><c p:x="1"/></b></a>');
    const b = doc.root.children.find((child) => child.kind === 'element');
    expect(b?.kind).toBe('element');
    if (b?.kind !== 'element') throw new Error('élément attendu');
    expect(decode(canonicalizeC14n11(b))).toBe('<b xmlns="urn:a" xmlns:p="urn:p"><c p:x="1"></c></b>');
  });

  it('sous-arbre : xml:lang hérité d’un ancêtre omis (C14N 1.1 § 2.4)', () => {
    const doc = parseXml('<a xml:lang="ar"><b/></a>');
    const b = doc.root.children[0];
    if (b?.kind !== 'element') throw new Error('élément attendu');
    expect(decode(canonicalizeC14n11(b))).toBe('<b xml:lang="ar"></b>');
  });

  it('exclusive 1.0 : seuls les préfixes utilisés visiblement sont déclarés', () => {
    const doc = parseXml('<a xmlns="urn:a" xmlns:p="urn:p" xmlns:q="urn:q"><p:b/></a>');
    expect(decode(canonicalizeExclusive(doc))).toBe('<a xmlns="urn:a"><p:b xmlns:p="urn:p"></p:b></a>');
    expect(decode(canonicalizeExclusive(doc, { inclusivePrefixes: ['q'] }))).toBe(
      '<a xmlns="urn:a" xmlns:q="urn:q"><p:b xmlns:p="urn:p"></p:b></a>',
    );
  });

  it('refus : attribut en double, préfixe non lié, < dans un attribut, balise non fermée, caractère interdit', () => {
    for (const bad of ['<a x="1" x="2"/>', '<p:a/>', '<a x="<"/>', '<a><b></a>', '<a>\u0001</a>', '<a>&#0;</a>', '<a>&amp</a>', '<a/><b/>']) {
      expect(() => parseXml(bad), bad).toThrow(UblSignatureError);
    }
  });

  it('les messages d’erreur ne reprennent pas le contenu du document', () => {
    expect(() => parseXml('<a>secret-ICE-000970000000097&nope;</a>')).toThrow(/Entité non prédéfinie/);
    expect(() => parseXml('<a>secret-ICE-000970000000097&nope;</a>')).not.toThrow(/000970000000097/);
  });
});
