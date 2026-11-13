import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATED_VALUES, datedValue } from '../src/content/dated-values.ts';
import { CASE_IDS, buildCase, ceilToDirhamCents } from '../src/content/silos/cases.ts';
import type { CaseId } from '../src/content/silos/cases.ts';
import { FACTS } from '../src/content/silos/facts.ts';
import { SILO_ROUTES, buildSiloViewBySlug } from '../src/content/silos/registry.ts';
import { SOURCES, getSource } from '../src/content/silos/sources.ts';
import type { SiloPageView } from '../src/content/silos/build.ts';
import { divRoundHalfUpBigInt, mulBps } from '../src/lib/money.ts';
import { MARKETING_LOCALES } from '../src/i18n/locales.ts';
import type { MarketingLocale } from '../src/i18n/locales.ts';

const WRITTEN: readonly MarketingLocale[] = ['fr', 'en', 'ar', 'ary'];
/** `certifi(?!cat)` : « certificat » (X.509) n'est pas une revendication de certification. */
const FORBIDDEN_WORDS = /conforme|homologu|certifi(?!cat)|certified|compliant|approved by/i;
const FORBIDDEN_NEAR_PLATFORM = /(conforme|homologu|certifi(?!cat))[^.\n]{0,60}(DGI|xHub)|(DGI|xHub)[^.\n]{0,60}(conforme|homologu|certifi(?!cat))/i;
const YEAR = /\b20(2[5-9]|3\d)\b/;
const E_INVOICE = /(facture électronique|e-?facture|e-?invoic|electronic invoic|الفوترة الإلكترونية)/i;
const OBLIGATION = /(obligation|obligatoire|seuil|échéance|calendrier|threshold|mandatory|deadline|calendar|إلزام|عتبة|جدول)/i;

function view(locale: MarketingLocale, slug: string): SiloPageView {
  const v = buildSiloViewBySlug(locale, slug);
  if (v === undefined) throw new Error(`vue absente : ${locale}/${slug}`);
  return v;
}

function allViews(): SiloPageView[] {
  return SILO_ROUTES.flatMap((r) => MARKETING_LOCALES.map((l) => view(l, r.slug)));
}

function line(id: CaseId, lineId: string): number {
  const found = buildCase(id).lines.find((l) => l.id === lineId);
  if (found?.cents === undefined) throw new Error(`ligne absente : ${id}/${lineId}`);
  return found.cents;
}

interface VectorCase {
  readonly expected: Readonly<Record<string, unknown>>;
}
interface Vector {
  readonly id: string;
  readonly cases: readonly VectorCase[];
}
const vectors: readonly Vector[] = (
  JSON.parse(readFileSync(new URL('../../../packages/qa-harness/tests/golden/cgi.vectors.json', import.meta.url), 'utf8')) as { vectors: Vector[] }
).vectors;
function expectedOf(id: string, index = 0): Readonly<Record<string, unknown>> {
  const vec = vectors.find((v) => v.id === id);
  const c = vec?.cases[index];
  if (c === undefined) throw new Error(`vecteur absent : ${id}`);
  return c.expected;
}

describe('verdict Answer-First : 40 à 60 mots', () => {
  it('chaque route, dans chacune des 4 langues rédigées', () => {
    for (const route of SILO_ROUTES) {
      for (const locale of WRITTEN) {
        const v = view(locale, route.slug);
        expect(v.verdictWords, `${locale}/${route.slug}`).toBeGreaterThanOrEqual(40);
        expect(v.verdictWords, `${locale}/${route.slug}`).toBeLessThanOrEqual(60);
      }
    }
  });

  it('zgh-Latn et zgh-Tfng reprennent le français (repli déclaré)', () => {
    for (const route of SILO_ROUTES) {
      const fr = view('fr', route.slug);
      for (const locale of ['zgh-Latn', 'zgh-Tfng'] as const) {
        const v = view(locale, route.slug);
        expect(v.verdict).toBe(fr.verdict);
        expect(v.contentLanguage).toBe('fr');
        expect(v.verdictWords).toBeGreaterThanOrEqual(40);
        expect(v.verdictWords).toBeLessThanOrEqual(60);
      }
    }
  });

  it('aucune variable de gabarit non remplie dans le texte rendu', () => {
    for (const v of allViews()) {
      const text = [v.title, v.description, v.verdict, ...v.table.rows.flat(), ...v.faqs.flatMap((f) => [f.question, f.answer]), v.case?.title ?? '', v.case?.scenario ?? ''].join('\n');
      expect(text, `${v.locale}/${v.slug}`).not.toMatch(/\{[a-z_0-9]+\}/);
    }
  });
});

describe('tableau comparatif : moins de 5 colonnes', () => {
  it('3 colonnes, au moins 3 lignes, cellules non vides', () => {
    for (const v of allViews()) {
      expect(v.table.columns.length, `${v.locale}/${v.slug}`).toBeLessThan(5);
      expect(v.table.columns).toHaveLength(3);
      expect(v.table.rows.length, `${v.locale}/${v.slug}`).toBeGreaterThanOrEqual(3);
      for (const row of v.table.rows) {
        expect(row).toHaveLength(3);
        for (const cell of row) expect(cell.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('cas chiffré : centimes entiers issus des vecteurs d’or', () => {
  it('chaque montant est un entier sûr, jamais un flottant', () => {
    for (const id of CASE_IDS) {
      for (const l of buildCase(id).lines) {
        if (l.cents !== undefined) expect(Number.isSafeInteger(l.cents), `${id}/${l.id}`).toBe(true);
      }
    }
  });

  it('VEC-CGI-01 : plafond d’espèces', () => {
    const e = expectedOf('VEC-CGI-01');
    expect(line('cash', 'cap')).toBe(e['allowedTtcCents']);
    expect(line('cash', 'deductible_ht')).toBe(e['deductibleHtCents']);
    expect(line('cash', 'recoverable_vat')).toBe(e['recoverableVatCents']);
    expect(line('cash', 'reintegrated')).toBe(e['reintegratedTable3HtCents']);
    expect(line('cash', 'lost_vat')).toBe(e['nonRecoverableVatCents']);
  });

  it('VEC-CGI-02 : loi 69-21, 44 500 centimes', () => {
    expect(line('late', 'penalty')).toBe(expectedOf('VEC-CGI-02')['penaltyCents']);
    expect(datedValue('late_total_two_months_bps').value).toBe(expectedOf('VEC-CGI-02')['totalPenaltyBps']);
    expect(datedValue('late_base_bps').value + datedValue('late_increment_bps').value).toBe(datedValue('late_total_two_months_bps').value);
  });

  it('VEC-CGI-03 : RAS-TVA, attestation valide puis expirée', () => {
    expect(line('ras', 'ras_valid')).toBe(expectedOf('VEC-CGI-03', 0)['rasVatCents']);
    expect(line('ras', 'ras_expired')).toBe(expectedOf('VEC-CGI-03', 1)['rasVatCents']);
  });

  it('VEC-CGI-04 : auto-entrepreneur', () => {
    expect(line('ae', 'surplus')).toBe(expectedOf('VEC-CGI-04')['surplusCents']);
    expect(line('ae', 'withholding')).toBe(expectedOf('VEC-CGI-04')['withholdingCents']);
  });

  it('VEC-CGI-05 : le code de rejet du taux non admis', () => {
    const rejected = buildCase('vat_admit').lines.find((l) => l.id === 'rejected_code');
    expect(rejected?.text?.fr).toBe('ADR_04_LF2026_VAT_VIOLATION');
    expect(expectedOf('VEC-CGI-05', 0)['errorCode']).toBe('ADR_04_LF2026_VAT_VIOLATION');
    expect(line('vat_admit', 'vat_standard')).toBe(200000);
    expect(line('vat_admit', 'vat_zero')).toBe(0);
  });

  it('VEC-CGI-06 : décompte BTP', () => {
    const e = expectedOf('VEC-CGI-06');
    expect(line('btp', 'retention')).toBe(e['retentionCents']);
    expect(line('btp', 'debours_vat')).toBe(e['deboursVatCents']);
    expect(line('btp', 'deferred_vat')).toBe(e['deferredVatOnRetentionCents']);
    expect(line('btp', 'vat_due_now')).toBe(e['vatDueNowCents']);
  });

  it('ERRATA D-20 : onze factures de 4 800 MAD TTC', () => {
    expect(line('cash_month', 'cumul_ten')).toBe(4800000);
    expect(line('cash_month', 'cumul_eleven')).toBe(5280000);
    expect(line('cash_month', 'excess')).toBe(280000);
  });

  it('Doc_03 S12 : prorata, facture cabinet moyen, remise de 100 dossiers', () => {
    expect(line('prorata', 'tpe_billed')).toBe(7450);
    expect(line('prorata', 'pme_billed')).toBe(12450);
    expect(line('meter_mid', 'ht')).toBe(1032800);
    expect(line('meter_mid', 'vat')).toBe(206560);
    expect(line('meter_mid', 'ttc')).toBe(1239360);
    expect(line('volume', 'discount')).toBe(244500);
    expect(line('volume', 'net')).toBe(1434500);
    expect(line('volume', 'ttc')).toBe(1721400);
  });

  it('Doc_03 S06 : reste à charge Mowakaba entre 1 800 et 3 600 MAD (TPME), 4 500 et 9 000 MAD (cabinet)', () => {
    expect(line('mowakaba', 'tpme_high_out')).toBe(180000);
    expect(line('mowakaba', 'tpme_low_out')).toBe(360000);
    expect(line('mowakaba', 'cabinet_high_out')).toBe(450000);
    expect(line('mowakaba', 'cabinet_low_out')).toBe(900000);
  });

  it('arithmétique : demi supérieur en BigInt, arrondi au dirham supérieur sans flottant', () => {
    expect(divRoundHalfUpBigInt(1n, 2n)).toBe(1n);
    expect(divRoundHalfUpBigInt(1n, 3n)).toBe(0n);
    expect(mulBps(500000, 7500)).toBe(375000);
    expect(ceilToDirhamCents(44442)).toBe(44500);
    expect(ceilToDirhamCents(44400)).toBe(44400);
    expect(ceilToDirhamCents(44401)).toBe(44500);
    expect(ceilToDirhamCents(0)).toBe(0);
    expect(() => ceilToDirhamCents(1.5)).toThrow(RangeError);
  });

  it('chaque cas rendu a une seule ligne de résultat et des lignes en centimes', () => {
    for (const v of allViews()) {
      if (v.case === null) continue;
      expect(v.case.lines.some((l) => l.cents !== null), `${v.locale}/${v.slug}`).toBe(true);
      expect(v.case.lines.filter((l) => l.isResult)).toHaveLength(1);
    }
  });

  it('les montants écrits dans le scénario français sont des lignes du cas', () => {
    for (const route of SILO_ROUTES) {
      const id = route.spec.caseId;
      if (id === null) continue;
      const rendered = view('fr', route.slug).case;
      if (rendered === null) continue;
      const cents = new Set(buildCase(id as CaseId).lines.map((l) => l.cents));
      for (const m of rendered.scenario.matchAll(/(\d[\d ]*),(\d{2}) MAD/g)) {
        const value = Number((m[1] ?? '').replaceAll(' ', '')) * 100 + Number(m[2]);
        expect(cents.has(value), `${route.slug} : ${m[0]}`).toBe(true);
      }
    }
  });
});

describe('sources primaires : uniquement celles que les spécifications nomment', () => {
  it('chaque page cite au moins deux sources connues', () => {
    for (const v of allViews()) {
      expect(v.sources.length, `${v.locale}/${v.slug}`).toBeGreaterThanOrEqual(2);
      for (const s of v.sources) expect(() => getSource(s.id)).not.toThrow();
    }
  });

  it('chaque source porte la référence de spécification qui la nomme', () => {
    for (const s of SOURCES) expect(s.specRef, s.id).toMatch(/Doc_\d{2}|ERRATA/);
  });

  it('chaque fait du glossaire renvoie à une source existante', () => {
    for (const f of FACTS) expect(() => getSource(f.ref), f.id).not.toThrow();
  });

  it('articles du CGI cités : seulement ceux que les spécifications nomment', () => {
    const allowed = new Set(['art. 11-II', 'art. 106-II', 'art. 117', 'art. 145', 'art. 211', 'art. 20-I', 'art. 15 et 115', 'art. 104 et 113', 'art. 204 bis', 'art. 144']);
    for (const s of SOURCES) {
      const m = s.label.fr.match(/Code général des impôts \(CGI\), (.+)$/);
      if (m !== null) expect(allowed.has(m[1] ?? ''), s.id).toBe(true);
    }
  });
});

describe('règles de contenu non négociables', () => {
  it('aucune formulation « conforme », « homologué », « certifié » (même niée)', () => {
    for (const v of allViews()) {
      const text = JSON.stringify([v.title, v.description, v.verdict, v.table, v.case, v.faqs, v.sources, v.labels, v.cta]);
      expect(text, `${v.locale}/${v.slug}`).not.toMatch(FORBIDDEN_WORDS);
      expect(text).not.toMatch(FORBIDDEN_NEAR_PLATFORM);
    }
  });

  it('aucune date ni aucun seuil d’obligation de la réforme e-facture (B-13)', () => {
    for (const v of allViews()) {
      const text = [v.title, v.verdict, ...v.table.rows.flat(), ...v.faqs.flatMap((f) => [f.question, f.answer])].join('\n');
      for (const sentence of text.split(/(?<=[.。؟!?\n])\s*/)) {
        if (E_INVOICE.test(sentence) && OBLIGATION.test(sentence)) {
          expect(sentence, `${v.locale}/${v.slug} : une date ou un seuil de la réforme`).not.toMatch(/\d|\{/);
        }
      }
      expect(`${v.title}\n${v.description}`, `${v.locale}/${v.slug}`).not.toMatch(YEAR);
    }
  });

  it('les pages de clearance disent « non publié à ce jour » et « Validation simulée »', () => {
    const page = view('fr', 'clearance-xhub/facture-electronique-maroc-etat-des-lieux');
    expect(page.verdict).toContain('ne sont pas publiés');
    expect(page.verdict).toContain('Validation simulée');
    expect(view('en', 'clearance-xhub/validation-simulee-xhub').verdict).toContain('Simulated validation');
    expect(view('ar', 'clearance-xhub/validation-simulee-xhub').verdict).toContain('تحقق بالمحاكاة');
    const table = view('fr', 'clearance-xhub/architecture-clearance-fisca').table.rows.flat().join(' ');
    expect(table).toContain('cius-ma-provisional');
    expect(table).toContain('Non publiés à ce jour');
  });

  it('mention informative sur chaque page : ni conseil réservé (loi 15-89) ni promesse de résultat', () => {
    for (const v of allViews()) {
      expect(v.labels.disclaimer, `${v.locale}/${v.slug}`).toMatch(/15-89/);
    }
  });

  it('les valeurs fiscales citées sont des données datées avec as_of et état de vérification (ERRATA E)', () => {
    for (const d of DATED_VALUES) {
      expect(d.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['RECOUPÉ', 'NON RECOUPÉ', 'PROVISOIRE']).toContain(d.state);
      expect(d.specRef.length).toBeGreaterThan(0);
    }
    expect(datedValue('cash_cap_day_cents').state).toBe('RECOUPÉ');
    expect(datedValue('late_base_bps').state).toBe('NON RECOUPÉ');
    for (const v of allViews()) {
      if (v.case?.id === 'ras' || v.case?.id === 'late' || v.case?.id === 'cash') {
        expect(v.datedValues.length, `${v.locale}/${v.slug}`).toBeGreaterThan(0);
        expect(v.labels.datedIntro).toMatch(/AST\/Wiki/);
      }
    }
  });

  it('aucune valeur fiscale n’est écrite en dur dans les textes : tout passe par des variables datées', () => {
    const dir = new URL('../src/content/silos/', import.meta.url).pathname;
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !['cases.ts', 'slots.ts', 'cases-copy.ts'].includes(f));
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, `${f} : pourcentage en dur`).not.toMatch(/\d\s?%/);
      expect(src, `${f} : points de base en dur`).not.toMatch(/\d[\d ,.]*\s?(bps|points de base|basis points|نقطة أساس)/);
      if (['clearance.ts', 'cgi-simpl.ts', 'metiers-pos.ts', 'regions.ts', 'facts.ts'].includes(f)) {
        expect(src, `${f} : montant en dur`).not.toMatch(/\d[\d  ]*,\d{2}\s?MAD/);
        expect(src, `${f} : montant en dur`).not.toMatch(/MAD [\d][\d,]*\.\d{2}/);
      }
    }
    const copy = readFileSync(join(dir, 'cases-copy.ts'), 'utf8');
    expect(copy).not.toMatch(/\d\s?%/);
    expect(copy).not.toMatch(/\d[\d ,.]*\s?(bps|points de base|basis points|نقطة أساس)/);
  });

  it('aucun flottant monétaire ni arrondi flottant dans le générateur et les cas', () => {
    const dir = new URL('../src/content/silos/', import.meta.url).pathname;
    for (const f of ['cases.ts', 'build.ts', 'slots.ts', 'registry.ts']) {
      const raw = readFileSync(join(dir, f), 'utf8');
      // Commentaires et littéraux de texte retirés : seul le code est scruté.
      const src = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
        .replace(/`(?:[^`\\]|\\.)*`/g, '``');
      expect(src, f).not.toMatch(/Math\.(round|floor|ceil|trunc)|parseFloat|toFixed|\b\d+\.\d+\b/);
    }
  });
});

describe('contenu propre à chaque page : aucun doublon de verdict', () => {
  it('aucun verdict identique entre deux routes, dans une même langue', () => {
    for (const locale of MARKETING_LOCALES) {
      const seen = new Map<string, string>();
      for (const route of SILO_ROUTES) {
        const key = view(locale, route.slug).verdict.toLowerCase().replace(/\s+/g, ' ').trim();
        expect(seen.has(key), `${locale} : ${route.slug} = ${seen.get(key) ?? ''}`).toBe(false);
        seen.set(key, route.slug);
      }
    }
  });

  it('hors régions, aucun verdict ne recoupe un autre à 85 % ou plus', () => {
    const tokens = (text: string): Set<string> => new Set(text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 2));
    const items = SILO_ROUTES.filter((r) => r.silo !== 'regions').map((r) => ({ slug: r.slug, set: tokens(view('fr', r.slug).verdict) }));
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        if (a === undefined || b === undefined) continue;
        let common = 0;
        for (const w of a.set) if (b.set.has(w)) common += 1;
        const ratio = common / Math.min(a.set.size, b.set.size);
        expect(ratio, `${a.slug} / ${b.slug}`).toBeLessThan(0.85);
      }
    }
  });

  it('les 12 pages de région diffèrent par la région et le chef-lieu, avec le même calcul Mowakaba', () => {
    const regions = SILO_ROUTES.filter((r) => r.silo === 'regions');
    const verdicts = new Set(regions.map((r) => view('fr', r.slug).verdict));
    expect(verdicts.size).toBe(12);
    for (const r of regions) {
      const v = view('fr', r.slug);
      expect(v.case?.id).toBe('mowakaba');
      expect(v.table.rows.flat().join(' ')).toContain('Non publiée à ce jour');
    }
  });

  it('le titre de chaque route est unique dans une langue', () => {
    for (const locale of MARKETING_LOCALES) {
      const titles = SILO_ROUTES.map((r) => view(locale, r.slug).title);
      expect(new Set(titles).size, locale).toBe(78);
    }
  });
});
