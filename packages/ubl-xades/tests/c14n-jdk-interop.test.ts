import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalizeC14n11, canonicalizeExclusive, generateUblInvoiceXml, parseXml, type XmlElement } from '../src/index.ts';
import { buildFullInput, TYPE_CODES } from './support/fixtures.ts';
import { guardTool, javaAvailability, runJavaSource } from './support/java-tools.ts';

/**
 * Interopérabilité : la canonisation TypeScript est comparée OCTET POUR OCTET à l'implémentation de référence du JDK
 * (javax.xml.crypto.dsig / Apache Santuario) via tests/java-verifier/C14nReference.java (`java C14nReference.java`).
 */
const documents: Record<string, string> = {};
for (const code of TYPE_CODES) {
  const input = buildFullInput(code);
  documents[`ubl-${code}`] = generateUblInvoiceXml({
    ...input,
    lines: input.lines.map((line, index) => (index === 0 ? { ...line, descriptionAr: 'خدمات استشارية — فاتورة & <اختبار>' } : line)),
  });
}
documents['arabe-utf8'] = '<?xml version="1.0" encoding="UTF-8"?>\n<م:وثيقة xmlns:م="urn:اختبار" لغة="ar" xml:lang="ar"><م:نص>مرحبا بالعالم &amp; &lt;أهلاً&gt; ٣٠٠٫٥٠ د.م.</م:نص><م:قيمة قيمة="a&#x9;b&#xA;c"/>\n</م:وثيقة>';
documents['namespaces-imbriques'] =
  '<a:root xmlns:a="urn:a" xmlns="urn:def"><x Id="sub" xmlns:b="urn:b" b:z="1" a:y="2" w="3"><y xmlns="" xmlns:a="urn:a2"><a:z b:q="4" xmlns:b="urn:b2"/></y><z xmlns="urn:inner"><a:k xmlns:a="urn:a"/></z></x><!-- commentaire --><?pi données  ?></a:root>';
documents['texte-et-references'] =
  '<doc xml:lang="fr" xml:space="preserve">\r\n  <t>a&#x0d;b&#10;c &gt; d &amp; e &lt; f "g" \'h\'</t><![CDATA[x < y && z > w]]><e a=\' x\ty\nz &quot;q&quot; &apos;r&apos; &#xD; \'/>\r\n</doc>\r\n';
documents['signature-like'] =
  '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:ext="urn:ext"><ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="s1"><ds:SignedInfo><ds:Reference URI=""/></ds:SignedInfo><ds:Object Id="sub"><q:P xmlns:q="urn:q"/></ds:Object></ds:Signature></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions></Invoice>';

const enabled = guardTool('Canonisation de référence JDK (Santuario)', javaAvailability);

describe.runIf(enabled)('canonisation TypeScript == JDK/Santuario (octet pour octet)', { timeout: 120_000 }, () => {
  let dir = '';
  let outDir = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fisca-c14n-'));
    outDir = join(dir, 'out');
    for (const [name, xml] of Object.entries(documents)) writeFileSync(join(dir, `${name}.xml`), xml, 'utf8');
    runJavaSource('C14nReference.java', [dir, outDir]);
  });
  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  it('au moins 5 documents dont un généré pour chacun des 5 types, de l’arabe UTF-8 et des espaces de noms imbriqués', () => {
    expect(Object.keys(documents).length).toBeGreaterThanOrEqual(5);
    expect(readdirSync(outDir).filter((name) => name.endsWith('.c14n11')).length).toBeGreaterThanOrEqual(10);
  });

  it.each(Object.keys(documents))('%s : c14n11 identique au JDK', (name) => {
    const expected = readFileSync(join(outDir, `${name}.c14n11`));
    const actual = canonicalizeC14n11(documents[name] ?? '');
    expect(Buffer.from(actual).equals(expected)).toBe(true);
    expect(actual.length).toBeGreaterThan(0);
  });

  it.each(Object.keys(documents))('%s : exclusive 1.0 identique au JDK', (name) => {
    const expected = readFileSync(join(outDir, `${name}.exc`));
    expect(Buffer.from(canonicalizeExclusive(documents[name] ?? '')).equals(expected)).toBe(true);
  });

  it.each(['namespaces-imbriques', 'signature-like'])('%s : sous-arbre Id="sub" (inclusif c14n11) identique au JDK', (name) => {
    const expected = readFileSync(join(outDir, `${name}.sub.c14n11`));
    const doc = parseXml(documents[name] ?? '');
    const find = (element: XmlElement): XmlElement | undefined =>
      element.attributes.some((attribute) => attribute.name === 'Id' && attribute.value === 'sub')
        ? element
        : element.children.flatMap((child) => (child.kind === 'element' ? [find(child)] : [])).find((found) => found !== undefined);
    const target = find(doc.root);
    expect(target).toBeDefined();
    expect(Buffer.from(canonicalizeC14n11(target as XmlElement)).equals(expected)).toBe(true);
  });
});
