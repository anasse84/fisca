import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import rawDataset from '../src/content/cgnc-core-accounts-v2.json';
import { CGNC_ACCOUNTS, CGNC_DATASET, STATEMENT_RUBRICS, VAT_ENCAISSEMENT_RULES, entryIntegrity, findCgncAccount, parseCgncDataset } from '../src/content/cgnc/dataset.ts';
import { RUBRIC_TEXT, VAT_RULE_TEXT } from '../src/content/cgnc/copy.ts';
import { ENTRY_DESCRIPTIONS } from '../src/content/cgnc/entry-descriptions.ts';

const DATASET_PATH = join(import.meta.dirname, '..', 'src', 'content', 'cgnc-core-accounts-v2.json');
/** Empreinte SHA-256 de la V2 fournie par le propriétaire (2026-11-14, remplace la V1 dont l'empreinte n'est plus épinglée) : la donnée ne se modifie pas (un changement exige une décision du propriétaire). */
const DATASET_SHA256 = '923f74f940bcb805e6aee186ba3a2c47641edaf7456c2980814613aa1409ba77';

function mutate(edit: (root: Record<string, unknown>, first: Record<string, unknown>) => void): unknown {
  const clone: unknown = JSON.parse(JSON.stringify(rawDataset));
  const root = clone as Record<string, unknown>;
  const accounts = root['accounts'] as Record<string, unknown>[];
  edit(root, accounts[0] as Record<string, unknown>);
  return clone;
}

describe('jeu FISCA_CGNC_CORE_V2 : intégrité', () => {
  it('le fichier fourni est intact (empreinte SHA-256)', () => {
    expect(createHash('sha256').update(readFileSync(DATASET_PATH)).digest('hex')).toBe(DATASET_SHA256);
  });

  it('61 comptes, classes 7/8/11/12/3/12/6/2, numéros uniques, 183 URL indexables', () => {
    expect(CGNC_DATASET.dataset_id).toBe('FISCA_CGNC_CORE_V2');
    expect(CGNC_ACCOUNTS).toHaveLength(61);
    expect(CGNC_DATASET.accounts_count).toBe(61);
    expect(CGNC_DATASET.indexed_urls_count).toBe(183);
    expect(CGNC_DATASET.indexed_urls_count).toBe(CGNC_DATASET.accounts_count * CGNC_DATASET.locales.length);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((c) => CGNC_ACCOUNTS.filter((a) => a.cgnc_class === c).length)).toEqual([7, 8, 11, 12, 3, 12, 6, 2]);
    expect(new Set(CGNC_ACCOUNTS.map((a) => a.account_number)).size).toBe(61);
    for (const a of CGNC_ACCOUNTS) expect(a.account_number.startsWith(String(a.cgnc_class)), a.account_number).toBe(true);
  });

  it('chaque écriture d’exemple est équilibrée en centimes entiers et son total égale total_cents', () => {
    for (const a of CGNC_ACCOUNTS) {
      const e = a.sample_entry;
      const r = entryIntegrity(e);
      expect(r.balanced, a.account_number).toBe(true);
      expect(r.totalMatches, a.account_number).toBe(true);
      expect(r.debitCents, a.account_number).toBe(e.total_cents);
      expect(r.creditCents, a.account_number).toBe(e.total_cents);
      expect(Number.isSafeInteger(e.total_cents)).toBe(true);
      for (const l of e.lines) expect(Number.isSafeInteger(l.amount_cents) && l.amount_cents > 0, `${a.account_number}/${l.account_number}`).toBe(true);
      expect(e.lines.some((l) => l.account_number === a.account_number), `${a.account_number} figure dans son écriture`).toBe(true);
    }
  });

  it('aucun flottant dans le fichier : tout nombre hors chaînes est un entier', () => {
    const text = readFileSync(DATASET_PATH, 'utf8');
    const withoutStrings = text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    expect(withoutStrings).not.toMatch(/\d\.\d|\d[eE][+-]?\d/);
  });

  it('codeEdi SIMPL-IS : null partout, statut en attente du XSD officiel DGI', () => {
    for (const a of CGNC_ACCOUNTS) {
      expect(a.simpl_is_code_edi, a.account_number).toBeNull();
      expect(a.simpl_is_code_edi_status).toBe('PENDING_OFFICIAL_DGI_SIMPL_IS_XSD');
    }
  });

  it('base CGNC : 58 comptes true ; 34558, 44551 et 44558 sont des subdivisions analytiques Fisca (parents 3455 et 4455) ; 44525 porte son libellé historique', () => {
    const analytic = CGNC_ACCOUNTS.filter((a) => !a.is_official_cgnc_base);
    expect(analytic.map((a) => [a.account_number, a.parent_cgnc_account])).toEqual([
      ['34558', '3455'],
      ['44551', '4455'],
      ['44558', '4455'],
    ]);
    expect(CGNC_ACCOUNTS.filter((a) => a.is_official_cgnc_base)).toHaveLength(58);
    expect(CGNC_ACCOUNTS.filter((a) => a.official_historical_label_fr !== undefined).map((a) => [a.account_number, a.official_historical_label_fr])).toEqual([['44525', 'État, IGR']]);
  });

  it('34551 = immobilisations (règle RECOVERABLE_IMMOB_34551), 34552 = charges (règle RECOVERABLE_CHARGES_34552), 1181 en instance d’affectation, 1161 report à nouveau', () => {
    const at = (n: string) => findCgncAccount(n);
    expect(at('34551')?.vat_encaissement_rule).toBe('RECOVERABLE_IMMOB_34551');
    expect(at('34551')?.label_fr).toBe('État - TVA récupérable sur immobilisations');
    expect(at('34552')?.vat_encaissement_rule).toBe('RECOVERABLE_CHARGES_34552');
    expect(at('34552')?.label_fr).toBe('État - TVA récupérable sur charges');
    expect(at('1181')?.label_fr).toBe('Résultats nets en instance d\'affectation (solde créditeur)');
    expect(at('1161')?.label_fr).toBe('Report à nouveau (solde créditeur)');
    expect(VAT_ENCAISSEMENT_RULES).toHaveLength(8);
  });

  it('6 comptes cités par les écritures n’ont pas de fiche : 4481, 6114, 6193, 6195, 6701, 8600', () => {
    const missing = new Set<string>();
    for (const a of CGNC_ACCOUNTS) for (const l of a.sample_entry.lines) if (findCgncAccount(l.account_number) === undefined) missing.add(l.account_number);
    expect([...missing].sort()).toEqual(['4481', '6114', '6193', '6195', '6701', '8600']);
  });

  it('chaque code de règle de TVA et chaque rubrique du jeu a un libellé fr, ar et en', () => {
    for (const code of VAT_ENCAISSEMENT_RULES) {
      for (const loc of ['fr', 'ar', 'en'] as const) {
        expect(VAT_RULE_TEXT[code].short[loc].length, `${code}/${loc}`).toBeGreaterThan(5);
        expect(VAT_RULE_TEXT[code].description[loc].length).toBeGreaterThan(20);
      }
    }
    for (const code of STATEMENT_RUBRICS) for (const loc of ['fr', 'ar', 'en'] as const) expect(RUBRIC_TEXT[code][loc].length, code).toBeGreaterThan(5);
    expect(new Set(CGNC_ACCOUNTS.map((a) => a.cgnc_statement_rubric)).size).toBe(24);
    expect(new Set(CGNC_ACCOUNTS.map((a) => a.vat_encaissement_rule)).size).toBe(8);
  });

  it('chaque écriture a son intitulé fr, ar et en, sans taux chiffré', () => {
    expect(Object.keys(ENTRY_DESCRIPTIONS).sort()).toEqual(CGNC_ACCOUNTS.map((a) => a.account_number).sort());
    for (const [n, d] of Object.entries(ENTRY_DESCRIPTIONS)) {
      for (const loc of ['fr', 'ar', 'en'] as const) {
        expect(d[loc].length, `${n}/${loc}`).toBeGreaterThan(10);
        expect(d[loc], `${n}/${loc}`).not.toMatch(/\d\s?%/);
      }
    }
  });
});

describe('validateur d’exécution', () => {
  it('accepte le jeu fourni', () => {
    expect(parseCgncDataset(rawDataset).accounts).toHaveLength(61);
  });

  it('is_official_cgnc_base est obligatoire et booléen ; parent_cgnc_account est requis s’il vaut false ; libellé historique non vide', () => {
    expect(() => parseCgncDataset(mutate((_r, a) => { delete a['is_official_cgnc_base']; }))).toThrow(/is_official_cgnc_base/);
    expect(() => parseCgncDataset(mutate((_r, a) => { a['is_official_cgnc_base'] = 'true'; }))).toThrow(/is_official_cgnc_base/);
    expect(() => parseCgncDataset(mutate((_r, a) => { a['is_official_cgnc_base'] = false; }))).toThrow(/parent_cgnc_account/);
    expect(() => parseCgncDataset(mutate((_r, a) => { a['is_official_cgnc_base'] = false; a['parent_cgnc_account'] = 'abc'; }))).toThrow(/parent_cgnc_account/);
    expect(() => parseCgncDataset(mutate((_r, a) => { a['official_historical_label_fr'] = ''; }))).toThrow(/official_historical_label_fr/);
    const ok = parseCgncDataset(mutate((_r, a) => { a['is_official_cgnc_base'] = false; a['parent_cgnc_account'] = '4455'; }));
    expect(ok.accounts[0]?.parent_cgnc_account).toBe('4455');
  });

  it('refuse un codeEdi non null (aucun codeEdi inventé)', () => {
    expect(() => parseCgncDataset(mutate((_r, a) => { a['simpl_is_code_edi'] = 'X12'; }))).toThrow(/codeEdi/);
  });

  it('refuse un montant flottant, négatif ou nul', () => {
    for (const bad of [100.5, -1, 0]) {
      expect(() =>
        parseCgncDataset(mutate((_r, a) => {
          const entry = a['sample_entry'] as { total_cents: number };
          entry.total_cents = bad;
        })),
      ).toThrow(/centimes/);
    }
  });

  it('refuse une énumération inconnue, une classe hors 1-8 et un compte annoncé mais absent', () => {
    expect(() => parseCgncDataset(mutate((_r, a) => { a['vat_encaissement_rule'] = 'AUTRE'; }))).toThrow(/vat_encaissement_rule/);
    expect(() => parseCgncDataset(mutate((_r, a) => { a['normal_balance'] = 'DEBITEUR'; }))).toThrow(/normal_balance/);
    expect(() => parseCgncDataset(mutate((_r, a) => { a['cgnc_class'] = 9; }))).toThrow(/cgnc_class/);
    expect(() => parseCgncDataset(mutate((_r, a) => { a['cgnc_statement_rubric'] = 'INCONNUE'; }))).toThrow(/rubric/);
    expect(() => parseCgncDataset(mutate((r) => { r['accounts_count'] = 62; }))).toThrow(/accounts_count/);
    expect(() => parseCgncDataset(null)).toThrow(TypeError);
    expect(() => parseCgncDataset({ accounts: 'x' })).toThrow(TypeError);
  });

  it('entryIntegrity détecte un déséquilibre et un total divergent', () => {
    const base = CGNC_ACCOUNTS[0]?.sample_entry;
    expect(base).toBeDefined();
    if (base === undefined) return;
    const unbalanced = { ...base, lines: base.lines.map((l, i) => (i === 0 ? { ...l, amount_cents: l.amount_cents + 1 } : l)) };
    expect(entryIntegrity(unbalanced).balanced).toBe(false);
    expect(entryIntegrity({ ...base, total_cents: base.total_cents + 1 }).totalMatches).toBe(false);
  });
});

/** Marqueurs interdits par la constitution (Loi 10), assemblés pour que ce test ne se signale pas lui-même au harnais. */
const BANNED_MARKERS: readonly string[] = [['TO', 'DO'].join(''), ['FIX', 'ME'].join(''), ['@ts', 'ignore'].join('-'), ['eslint', 'disable'].join('-'), ['.sk', 'ip('].join(''), ['.on', 'ly('].join('')];

describe('hygiène du code du Silo 3', () => {
  it('ni any, ni marqueur interdit, ni taux ou montant chiffré en dur dans src/content/cgnc', () => {
    const dir = join(import.meta.dirname, '..', 'src', 'content', 'cgnc');
    const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const marker of BANNED_MARKERS) expect(src, `${f} : ${marker}`).not.toContain(marker);
      expect(src, f).not.toMatch(new RegExp(`:\\s*${'an'}y\\b|\\bas ${'an'}y\\b|<${'an'}y>`));
      expect(src, f).not.toMatch(/\d\s?%/);
      expect(src, f).not.toMatch(/\d[\d  ]*,\d{2}\s?MAD/);
    }
  });
});

/** Anciens codes de règle et nom de la V1, assemblés pour que ce test ne se signale pas lui-même. */
const OLD_TOKENS: readonly string[] = [['RECOVERABLE_CHARGES', '34551'].join('_'), ['RECOVERABLE_IMMOB', '34552'].join('_'), ['FISCA_CGNC_CORE', '60_V1'].join('_'), ['cgnc-core', '60-accounts'].join('-')];
const ROOT = join(import.meta.dirname, '..');
const TEXT_FILE = /\.(ts|astro|json|md|css|mjs)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }) as Dirent[]) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (TEXT_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

describe('plus aucune trace de l’ancien code de règle ni de l’inversion 34551/34552 (src et tests)', () => {
  it('aucun ancien code de règle, ni ancien nom de jeu, ni fichier V1 dans src, tests et e2e', () => {
    const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'tests')), ...walk(join(ROOT, 'e2e'))];
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const token of OLD_TOKENS) expect(text, `${f} : ${token}`).not.toContain(token);
    }
    expect(readdirSync(join(ROOT, 'src', 'content'))).not.toContain(OLD_TOKENS[3] + '.json');
  });

  it('aucune ligne de src ne rapproche 34551 de « charges » ni 34552 d’« immobilisations » (inversion V1), en fr, en et ar', () => {
    const inverted34551 = /34551[^\n]{0,90}(charges|expenses|التحملات)/i;
    const inverted34552 = /34552[^\n]{0,90}(immobilisation|fixed asset|المستقرات|التثبيتات)/i;
    // Le fichier JSON du propriétaire est une donnée intacte (son revision_note décrit l'inversion corrigée) : seuls les .ts et .astro sont lus.
    for (const f of walk(join(ROOT, 'src')).filter((file) => !file.endsWith('.json'))) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        expect(line, f).not.toMatch(inverted34551);
        expect(line, f).not.toMatch(inverted34552);
      }
    }
  });
});
