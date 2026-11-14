import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import rawDataset from '../src/content/cgnc-core-60-accounts.json';
import { CGNC_ACCOUNTS, CGNC_DATASET, STATEMENT_RUBRICS, VAT_ENCAISSEMENT_RULES, entryIntegrity, findCgncAccount, parseCgncDataset } from '../src/content/cgnc/dataset.ts';
import { RUBRIC_TEXT, VAT_RULE_TEXT } from '../src/content/cgnc/copy.ts';
import { ENTRY_DESCRIPTIONS } from '../src/content/cgnc/entry-descriptions.ts';

const DATASET_PATH = join(import.meta.dirname, '..', 'src', 'content', 'cgnc-core-60-accounts.json');
/** Empreinte du fichier fourni par le propriétaire : la donnée ne se modifie pas (un changement exige une décision du propriétaire). */
const DATASET_SHA256 = '6ca92bcf1aa3f983a2b07d8df150144de363f89f25b787d9b05557c940749cb5';

function mutate(edit: (root: Record<string, unknown>, first: Record<string, unknown>) => void): unknown {
  const clone: unknown = JSON.parse(JSON.stringify(rawDataset));
  const root = clone as Record<string, unknown>;
  const accounts = root['accounts'] as Record<string, unknown>[];
  edit(root, accounts[0] as Record<string, unknown>);
  return clone;
}

describe('jeu FISCA_CGNC_CORE_60_V1 : intégrité', () => {
  it('le fichier fourni est intact (empreinte SHA-256)', () => {
    expect(createHash('sha256').update(readFileSync(DATASET_PATH)).digest('hex')).toBe(DATASET_SHA256);
  });

  it('60 comptes, classes 6/8/11/12/3/12/6/2, numéros uniques', () => {
    expect(CGNC_DATASET.dataset_id).toBe('FISCA_CGNC_CORE_60_V1');
    expect(CGNC_ACCOUNTS).toHaveLength(60);
    expect(CGNC_DATASET.accounts_count).toBe(60);
    expect(CGNC_DATASET.indexed_urls_count).toBe(180);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((c) => CGNC_ACCOUNTS.filter((a) => a.cgnc_class === c).length)).toEqual([6, 8, 11, 12, 3, 12, 6, 2]);
    expect(new Set(CGNC_ACCOUNTS.map((a) => a.account_number)).size).toBe(60);
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
    expect(parseCgncDataset(rawDataset).accounts).toHaveLength(60);
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
    expect(() => parseCgncDataset(mutate((r) => { r['accounts_count'] = 61; }))).toThrow(/accounts_count/);
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
