import { describe, expect, it } from 'vitest';
import { buildFiscaJsonLdGraph, buildFiscaJsonLdObject } from '../src/seo/jsonld.ts';
import type { JsonLdInput } from '../src/seo/jsonld.ts';
import { PRICING_PLANS } from '../src/content/pricing.ts';
import { centsToDecimalString } from '../src/lib/money.ts';

const FULL: JsonLdInput = {
  pageUrl: 'https://fisca.ma/fr/guides/exemple',
  locale: 'fr',
  title: 'Guide exemple',
  description: 'Résumé factuel de la page.',
  dateModifiedIso: '2026-11-13',
  legislation: { name: 'Code Général des Impôts, article cité', identifier: 'CGI' },
  howTo: {
    name: 'Procédure exemple',
    steps: [
      { name: 'Étape 1', text: 'Faire la première chose.' },
      { name: 'Étape 2', text: 'Faire la seconde chose.' },
    ],
  },
  faqs: [{ question: 'Une question ?', answer: 'Une réponse.' }],
};

const MINIMAL: JsonLdInput = {
  pageUrl: 'https://fisca.ma/fr/',
  locale: 'fr',
  title: 'Accueil',
  description: 'Accueil.',
};

type Node = Record<string, unknown>;

function nodesOf(input: JsonLdInput): Node[] {
  const parsed = JSON.parse(buildFiscaJsonLdGraph(input)) as { '@context': string; '@graph': Node[] };
  expect(parsed['@context']).toBe('https://schema.org');
  return parsed['@graph'];
}

function byType(nodes: Node[], type: string): Node {
  const found = nodes.find((n) => n['@type'] === type);
  if (found === undefined) throw new Error(`type absent : ${type}`);
  return found;
}

function collectIds(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((v) => collectIds(v, out));
  } else if (value !== null && typeof value === 'object') {
    const rec = value as Node;
    const keys = Object.keys(rec);
    if (keys.length === 1 && keys[0] === '@id') out.push(String(rec['@id']));
    else keys.forEach((k) => collectIds(rec[k], out));
  }
}

function hasEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0 || value.some(hasEmpty);
  if (typeof value === 'object') {
    const rec = value as Node;
    const keys = Object.keys(rec);
    return keys.length === 0 || keys.some((k) => hasEmpty(rec[k]));
  }
  return false;
}

describe('buildFiscaJsonLdGraph', () => {
  it('produit un JSON valide avec toutes les entités quand la page les fournit', () => {
    const nodes = nodesOf(FULL);
    const types = nodes.map((n) => n['@type']);
    for (const t of ['Organization', 'SoftwareApplication', 'WebPage', 'Legislation', 'HowTo', 'FAQPage']) {
      expect(types).toContain(t);
    }
  });

  it('n’émet que Organization, SoftwareApplication et WebPage sans legislation/howTo/faqs', () => {
    const types = nodesOf(MINIMAL).map((n) => n['@type']);
    expect(types).toEqual(['Organization', 'SoftwareApplication', 'WebPage']);
  });

  it('Organization : SYNAPTIC SYSTEMS SARL AU à Rabat', () => {
    const org = byType(nodesOf(MINIMAL), 'Organization');
    expect(org['@id']).toBe('https://fisca.ma/#organization');
    expect(org['name']).toBe('SYNAPTIC SYSTEMS SARL AU');
    expect(org['address']).toMatchObject({ addressLocality: 'Rabat', addressCountry: 'MA' });
  });

  it('chaque référence {"@id"} pointe vers un nœud du graphe', () => {
    const nodes = nodesOf(FULL);
    const known = new Set(nodes.map((n) => String(n['@id'])));
    const refs: string[] = [];
    collectIds(nodes, refs);
    expect(refs.length).toBeGreaterThan(4);
    for (const ref of refs) expect(known.has(ref)).toBe(true);
  });

  it('les @id sont uniques et la page relie logiciel et législation', () => {
    const nodes = nodesOf(FULL);
    const ids = nodes.map((n) => String(n['@id']));
    expect(new Set(ids).size).toBe(ids.length);
    const page = byType(nodes, 'WebPage');
    expect(page['publisher']).toEqual({ '@id': 'https://fisca.ma/#organization' });
    expect(JSON.stringify(page['about'])).toContain('#software');
    expect(JSON.stringify(page['about'])).toContain('#legislation');
  });

  it('les offres reprennent exactement pricing.ts, en MAD, sans flottant', () => {
    const software = byType(nodesOf(MINIMAL), 'SoftwareApplication');
    const offers = software['offers'] as Node[];
    expect(offers).toHaveLength(4);
    expect(PRICING_PLANS).toHaveLength(4);
    PRICING_PLANS.forEach((plan, i) => {
      const offer = offers[i];
      if (offer === undefined) throw new Error('offre manquante');
      expect(offer['sku']).toBe(plan.code);
      expect(offer['priceCurrency']).toBe('MAD');
      const cents = plan.kind === 'RECURRING' ? plan.monthly_ht_cents : plan.one_off_ht_cents;
      expect(offer['price']).toBe(centsToDecimalString(cents));
    });
    expect(offers.map((o) => o['price'])).toEqual(['129.00', '390.00', '890.00', '18000.00']);
  });

  it('les prix annuels sont publiés pour les offres récurrentes', () => {
    const software = byType(nodesOf(MINIMAL), 'SoftwareApplication');
    const offers = software['offers'] as Node[];
    const solo = offers[0];
    expect(JSON.stringify(solo)).toContain('1290.00');
  });

  it('aucun champ vide ni nul', () => {
    expect(hasEmpty(buildFiscaJsonLdObject(FULL))).toBe(false);
    expect(hasEmpty(buildFiscaJsonLdObject(MINIMAL))).toBe(false);
  });

  it('échappe < pour ne jamais fermer la balise script', () => {
    const json = buildFiscaJsonLdGraph({ ...MINIMAL, title: 'a </script><b>' });
    expect(json).not.toContain('</script>');
    expect((JSON.parse(json) as { '@graph': Node[] })['@graph']).toBeDefined();
  });

  it('HowTo et FAQPage portent leurs étapes et questions', () => {
    const nodes = nodesOf(FULL);
    expect((byType(nodes, 'HowTo')['step'] as Node[]).length).toBe(2);
    expect((byType(nodes, 'FAQPage')['mainEntity'] as Node[]).length).toBe(1);
  });

  it('ne contient aucune formulation interdite par B-13', () => {
    const json = buildFiscaJsonLdGraph(MINIMAL);
    expect(json).not.toMatch(/conforme|homologu|certifi/i);
  });
});
