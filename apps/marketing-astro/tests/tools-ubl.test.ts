import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkUblXml, UBL_NS, UBL_PROFILE_ID, UBL_TYPE_CODES } from '../src/tools/ubl-check.ts';
import type { UblCheckResult } from '../src/tools/ubl-check.ts';
import { childrenNamed, descendantsNamed, parseXml } from '../src/tools/xml-lite.ts';

interface UblVector {
  readonly id: string;
  readonly source: string;
  readonly state: string;
  readonly rule_date: string;
  readonly input: { readonly xml: string };
  readonly expected: { readonly ok: boolean; readonly failed: readonly string[]; readonly warnings?: readonly string[]; readonly found?: string; readonly detail?: string };
}
const GOLD = JSON.parse(readFileSync(new URL('./golden/validateur-ubl-fec.vectors.json', import.meta.url), 'utf8')) as { readonly ubl_vectors: readonly UblVector[] };

function failed(r: UblCheckResult): string[] {
  return r.checks.filter((c) => !c.ok && c.severity === 'error').map((c) => c.id);
}
function warned(r: UblCheckResult): string[] {
  return r.checks.filter((c) => !c.ok && c.severity === 'warning').map((c) => c.id);
}
function vector(id: string): UblVector {
  const v = GOLD.ubl_vectors.find((x) => x.id === id);
  if (v === undefined) throw new Error(`vecteur absent : ${id}`);
  return v;
}

describe('lecteur XML strict', () => {
  it('lit un document avec espaces de noms, attributs, CDATA et références prédéfinies', () => {
    const r = parseXml('<?xml version="1.0"?><a:r xmlns:a="urn:x" k=\'v&amp;w\'><a:c>un &lt; deux<![CDATA[ <brut> ]]></a:c><a:e/></a:r>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.root.local).toBe('r');
    expect(r.root.namespace).toBe('urn:x');
    expect(r.root.attributes['k']).toBe('v&w');
    expect(childrenNamed(r.root, 'urn:x', 'c')[0]?.text).toBe('un < deux <brut> ');
    expect(descendantsNamed(r.root, 'urn:x', 'e')).toHaveLength(1);
  });
  it('rejette DOCTYPE, ENTITY et toute entité non prédéfinie sans jamais les développer', () => {
    for (const xml of ['<!DOCTYPE a><a/>', '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>', '<!doctype a><a/>']) {
      const r = parseXml(xml);
      expect(r.ok, xml).toBe(false);
      if (!r.ok) expect(r.error).toBe('DOCTYPE');
    }
    const undefinedEntity = parseXml('<a>&x;</a>');
    expect(undefinedEntity.ok).toBe(false);
    expect(parseXml('<a>a & b</a>').ok).toBe(false);
  });
  it('rejette les documents mal formés', () => {
    const bad = [
      '', '   ', '<a>', '<a></b>', '<a><b></a></b>', '<a/><b/>', 'texte<a/>', '<a x=1/>', '<a x="1" x="2"/>', '<a x="<"/>', '<p:a/>', '<a/>fin', '<a><!-- x -- y --></a>',
      '<a>\u0001</a>', '<a>]]></a>', '<1a/>', '<a b="1"c="2"/>', ' <?xml version="1.0"?><a/>',
    ];
    for (const xml of bad) {
      const r = parseXml(xml);
      if (xml.startsWith(' <?xml')) expect(r.ok, 'déclaration XML hors tête').toBe(false);
      else expect(r.ok, JSON.stringify(xml)).toBe(false);
    }
  });
  it('limite la profondeur', () => {
    const deep = `${'<a>'.repeat(300)}${'</a>'.repeat(300)}`;
    expect(parseXml(deep).ok).toBe(false);
  });
});

describe('UBL : contrôle de structure local', () => {
  it('profil : identifiant et types admis', () => {
    expect(UBL_PROFILE_ID).toBe('cius-ma-provisional');
    expect([...UBL_TYPE_CODES]).toEqual(['380', '381', '383', '386', '389']);
    expect(UBL_NS.invoice).toBe('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
  });

  it('chaque vecteur d’or rend le verdict attendu', () => {
    for (const v of GOLD.ubl_vectors) {
      expect(v.rule_date, v.id).toBe('2026-11-13');
      expect(['RECOUPÉ', 'NON RECOUPÉ', 'PROVISOIRE'], v.id).toContain(v.state);
      const r = checkUblXml(v.input.xml);
      expect(r.ok, v.id).toBe(v.expected.ok);
      expect(failed(r), v.id).toEqual(v.expected.failed);
      if (v.expected.warnings !== undefined) expect(warned(r), v.id).toEqual(v.expected.warnings);
      if (v.expected.found !== undefined) expect(r.checks.find((c) => !c.ok)?.found, v.id).toBe(v.expected.found);
      if (v.expected.detail !== undefined) expect(r.checks.find((c) => !c.ok)?.detail, v.id).toBe(v.expected.detail);
    }
  });

  it('bien formé / mal formé', () => {
    expect(checkUblXml(vector('UBL-OK-380').input.xml).ok).toBe(true);
    const bad = checkUblXml(vector('UBL-NOT-WELL-FORMED').input.xml);
    expect(bad.ok).toBe(false);
    expect(bad.checks).toHaveLength(1);
    expect(bad.checks[0]?.detail).toBe('NOT_WELL_FORMED');
    expect(checkUblXml('').checks[0]?.detail).toBe('EMPTY_DOCUMENT');
  });

  it('DOCTYPE rejeté : le contrôle s’arrête avant toute lecture du contenu', () => {
    const r = checkUblXml(vector('UBL-DOCTYPE').input.xml);
    expect(r.ok).toBe(false);
    expect(r.checks.map((c) => c.id)).toEqual(['WELL_FORMED', 'NO_DOCTYPE']);
    expect(r.checks[1]?.detail).toBe('DOCTYPE_REJECTED');
    expect(r.rootName).toBeNull();
  });

  it('racine invalide : autre racine, autre espace de noms ; CreditNote accepté avec ses propres éléments UBL', () => {
    expect(failed(checkUblXml(vector('UBL-BAD-ROOT').input.xml))).toEqual(['ROOT']);
    expect(failed(checkUblXml(vector('UBL-WRONG-NAMESPACE').input.xml))).toEqual(['ROOT']);
    const credit = vector('UBL-OK-381').input.xml
      .replace('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"', 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"')
      .replace(/<(\/?)Invoice>/g, '<$1CreditNote>')
      .replace(/<(\/?)Invoice /g, '<$1CreditNote ')
      .replace(/InvoiceTypeCode/g, 'CreditNoteTypeCode')
      .replace(/<cac:InvoiceLine>/g, '<cac:CreditNoteLine>')
      .replace(/<\/cac:InvoiceLine>/g, '</cac:CreditNoteLine>');
    const r = checkUblXml(credit);
    expect(r.rootName).toBe('CreditNote');
    expect(failed(r)).toEqual([]);
    expect(r.typeCode).toBe('381');
  });

  it('InvoiceTypeCode hors liste ou absent', () => {
    expect(failed(checkUblXml(vector('UBL-TYPE-OUT-OF-LIST').input.xml))).toEqual(['TYPE_CODE']);
    expect(checkUblXml(vector('UBL-TYPE-MISSING').input.xml).checks.find((c) => c.id === 'TYPE_CODE')?.detail).toBe('TYPE_CODE_MISSING');
    for (const code of UBL_TYPE_CODES) {
      const xml = vector('UBL-OK-380').input.xml.replace('>380<', `>${code}<`);
      expect(checkUblXml(xml).checks.find((c) => c.id === 'TYPE_CODE')?.ok, code).toBe(true);
    }
  });

  it('381 sans BillingReference : échec ; 380 : sans objet', () => {
    expect(failed(checkUblXml(vector('UBL-381-NO-BILLING').input.xml))).toEqual(['BILLING_REFERENCE']);
    expect(checkUblXml(vector('UBL-OK-380').input.xml).checks.find((c) => c.id === 'BILLING_REFERENCE')?.detail).toBe('NOT_APPLICABLE');
  });

  it('schemeID absent, faux ; ICE à 15 chiffres ; côté acheteur : avertissement seulement', () => {
    expect(checkUblXml(vector('UBL-ICE-NO-SCHEME').input.xml).checks.find((c) => c.id === 'ICE_SUPPLIER')?.detail).toBe('SCHEME_ID_MISSING');
    expect(checkUblXml(vector('UBL-IF-NO-SCHEME').input.xml).checks.find((c) => c.id === 'IF_SUPPLIER')?.detail).toBe('SCHEME_ID_MISSING');
    const wrong = checkUblXml(vector('UBL-ICE-WRONG-SCHEME').input.xml).checks.find((c) => c.id === 'ICE_SUPPLIER');
    expect(wrong?.detail).toBe('SCHEME_ID_WRONG');
    expect(wrong?.found).toBe('MA:IF');
    expect(checkUblXml(vector('UBL-ICE-14-DIGITS').input.xml).checks.find((c) => c.id === 'ICE_SUPPLIER')?.detail).toBe('ICE_FORMAT');
    const customer = checkUblXml(vector('UBL-CUSTOMER-NO-IDS').input.xml);
    expect(customer.ok).toBe(true);
    expect(warned(customer)).toEqual(['ICE_CUSTOMER', 'IF_CUSTOMER']);
  });

  it('chaque contrôle est rattaché à son origine ; les éléments de base sont marqués hors profil marocain', () => {
    const r = checkUblXml(vector('UBL-OK-380').input.xml);
    const basis = Object.fromEntries(r.checks.map((c) => [c.id, c.basis]));
    for (const id of ['BASE_ID', 'BASE_ISSUE_DATE', 'BASE_SUPPLIER', 'BASE_CUSTOMER', 'BASE_MONETARY_TOTAL', 'BASE_LINE']) expect(basis[id], id).toBe('OASIS_UBL21');
    for (const id of ['TYPE_CODE', 'BILLING_REFERENCE', 'ICE_SUPPLIER', 'IF_SUPPLIER']) expect(basis[id], id).toBe('DOC07_S07');
    expect(r.profileId).toBe('cius-ma-provisional');
    expect(r.profileState).toBe('PROVISOIRE');
    expect(r.checks).toHaveLength(15);
  });

  it('second avis de forme du navigateur : peut durcir le verdict, jamais l’assouplir', () => {
    const xml = vector('UBL-OK-380').input.xml;
    expect(checkUblXml(xml, { domWellFormed: () => true }).ok).toBe(true);
    const hardened = checkUblXml(xml, { domWellFormed: () => false });
    expect(hardened.ok).toBe(false);
    expect(hardened.checks[0]?.detail).toBe('NOT_WELL_FORMED');
    expect(checkUblXml(vector('UBL-NOT-WELL-FORMED').input.xml, { domWellFormed: () => true }).ok).toBe(false);
  });

  it('aucun flottant dans les sorties ; aucune affirmation de validation de schéma', () => {
    const walk = (value: unknown): void => {
      if (typeof value === 'number') expect(Number.isInteger(value)).toBe(true);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
    };
    for (const v of GOLD.ubl_vectors) {
      const r = checkUblXml(v.input.xml);
      walk(r);
      expect(JSON.stringify(r)).not.toMatch(/xsd|schematron|valid(e|ated)?\b/i);
    }
  });
});
