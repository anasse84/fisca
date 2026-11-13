import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { GOLDEN_STATES } from '../../qa-harness/src/fiscal-golden-suite.ts';
import {
  DynamicFiscalAstEngine,
  RULE_STATUS_TRANSITIONS,
  VERIFICATION_STATES,
  WikiCompilerError,
  assertRuleTransitionAllowed,
  canonicalJson,
  compileWikiRule,
  type CompiledRuleCandidate,
  type RuleRowStatus,
  type WikiCompilerErrorCode,
} from '../src/index.ts';
import { CODES, GOLDEN_FILE, firstCase, readNumber, readText } from './helpers/rule-fixtures.ts';
import {
  FIXTURE_CREATED_AT,
  FIXTURE_EFFECTIVE_FROM,
  aeSource,
  asText,
  btpSource,
  cashSource,
  delaySource,
  rasSource,
  vatSource,
  withRule,
  withoutKey,
  type WikiSourceObject,
} from './helpers/wiki-fixtures.ts';

function compile(source: WikiSourceObject, ruleId = 'R-TEST-1'): Promise<CompiledRuleCandidate> {
  return compileWikiRule({ wikiSourceText: asText(source), ruleId, createdAtIso: FIXTURE_CREATED_AT });
}

function engineOf(candidate: CompiledRuleCandidate): DynamicFiscalAstEngine {
  return DynamicFiscalAstEngine.fromRows([{ ...candidate.row, status: 'ACTIVE' }]);
}

async function expectCompileError(text: string, code: WikiCompilerErrorCode): Promise<void> {
  const error = await compileWikiRule({ wikiSourceText: text, ruleId: 'R-BAD', createdAtIso: FIXTURE_CREATED_AT }).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error, `une erreur ${code} est attendue`).toBeInstanceOf(WikiCompilerError);
  if (error instanceof WikiCompilerError) {
    expect(error.code).toBe(code);
    expect(error.message.startsWith(`${code}:`)).toBe(true);
  }
}

function expectedOf(id: string, index = 0): Record<string, unknown> {
  const found = GOLDEN_FILE.vectors.find((vector) => vector.id === id)?.cases[index];
  if (found === undefined) {
    throw new Error(`cas d'or absent : ${id}`);
  }
  return Object.fromEntries(Object.entries(found.expected));
}

function expectValues(actual: object, expected: Record<string, unknown>): void {
  const lookup = new Map<string, unknown>(Object.entries(actual));
  for (const [key, value] of Object.entries(expected)) {
    expect(lookup.get(key), `clé ${key}`).toBe(value);
  }
}

describe('compilation nominale : une source wiki par type de règle, évaluée par le moteur = vecteurs d\'or', () => {
  it('espèces Art. 11-II (VEC-CGI-01)', async () => {
    const candidate = await compile(cashSource());
    const input = firstCase('VEC-CGI-01').input;
    const result = engineOf(candidate).evaluateCashCeiling({
      ruleCode: CODES.CASH,
      paymentDateIso: GOLDEN_FILE.ruleDate,
      invoiceHtCents: readNumber(input, 'invoiceHtCents'),
      invoiceVatCents: readNumber(input, 'invoiceVatCents'),
      vatRateBps: readNumber(input, 'vatRateBps'),
      alreadyPaidCashTodayCents: readNumber(input, 'alreadyPaidCashTodayTtcCents'),
      alreadyPaidCashMonthCents: readNumber(input, 'alreadyPaidCashMonthTtcCents'),
    });
    expectValues(result, expectedOf('VEC-CGI-01'));
    expect(candidate.row.cgi_article_ref).toBe('CGI art. 11-II');
  });

  it('Loi 69-21 (VEC-CGI-02)', async () => {
    const candidate = await compile(delaySource());
    const input = firstCase('VEC-CGI-02').input;
    const result = engineOf(candidate).evaluatePaymentDelayPenalty({
      ruleCode: CODES.DELAY,
      asOfDateIso: GOLDEN_FILE.ruleDate,
      unpaidTtcCents: readNumber(input, 'unpaidTtcCents'),
      startedMonthsOfDelay: readNumber(input, 'startedMonthsOfDelay'),
      hasDocumentedDispute: false,
    });
    expectValues(result, expectedOf('VEC-CGI-02'));
  });

  it('RAS-TVA Art. 117 (VEC-CGI-03, deux cas)', async () => {
    const candidate = await compile(rasSource());
    for (const index of [0, 1]) {
      const goldenCase = GOLDEN_FILE.vectors.find((vector) => vector.id === 'VEC-CGI-03')?.cases[index];
      if (goldenCase === undefined) {
        throw new Error('cas VEC-CGI-03 absent');
      }
      const result = engineOf(candidate).evaluateRasTva({
        ruleCode: CODES.RAS,
        paymentDateIso: readText(goldenCase.input, 'paymentDateIso'),
        invoiceTtcCents: readNumber(goldenCase.input, 'invoiceTtcCents'),
        invoiceVatCents: readNumber(goldenCase.input, 'invoiceVatCents'),
        taxClearanceIssuedDateIso: readText(goldenCase.input, 'taxClearanceIssuedDateIso'),
      });
      expectValues(result, expectedOf('VEC-CGI-03', index));
    }
  });

  it('auto-entrepreneur (VEC-CGI-04)', async () => {
    const candidate = await compile(aeSource());
    const input = firstCase('VEC-CGI-04').input;
    const result = engineOf(candidate).evaluateAutoEntrepreneurThreshold({
      ruleCode: CODES.AE,
      invoiceDateIso: GOLDEN_FILE.ruleDate,
      cumulBeforeInvoiceCents: readNumber(input, 'cumulBeforeInvoiceCents'),
      invoiceCents: readNumber(input, 'invoiceCents'),
    });
    expectValues(result, expectedOf('VEC-CGI-04'));
  });

  it('liste de taux de TVA (VEC-CGI-05) : 1400 bps refusé, taux listés admis', async () => {
    const candidate = await compile(vatSource());
    const engine = engineOf(candidate);
    const rejected = firstCase('VEC-CGI-05');
    expect(() => engine.evaluateVatRate({ ruleCode: CODES.VAT, issueDateIso: readText(rejected.input, 'issueDateIso'), vatRateBps: readNumber(rejected.input, 'vatRateBps') })).toThrow(
      readText(rejected.expected, 'errorCode'),
    );
    const accepted = GOLDEN_FILE.vectors.find((vector) => vector.id === 'VEC-CGI-05')?.cases.filter((c) => c.expected['accepted'] === true) ?? [];
    expect(accepted.length).toBeGreaterThan(0);
    for (const goldenCase of accepted) {
      const result = engine.evaluateVatRate({
        ruleCode: CODES.VAT,
        issueDateIso: readText(goldenCase.input, 'issueDateIso'),
        vatRateBps: readNumber(goldenCase.input, 'vatRateBps'),
      });
      expect(result.vatRateBps).toBe(readNumber(goldenCase.input, 'vatRateBps'));
    }
  });

  it('décompte BTP (VEC-CGI-06)', async () => {
    const candidate = await compile(btpSource());
    const input = firstCase('VEC-CGI-06').input;
    const result = engineOf(candidate).evaluateBtpSettlement({
      ruleCode: CODES.BTP,
      settlementDateIso: GOLDEN_FILE.ruleDate,
      worksHtCents: readNumber(input, 'worksHtCents'),
      deboursCents: readNumber(input, 'deboursCents'),
      vatRateBps: readNumber(input, 'vatRateBps'),
    });
    expectValues(result, expectedOf('VEC-CGI-06'));
  });
});

describe('ligne candidate : statut, traçabilité, état de vérification', () => {
  it('naît en PENDING_ADMIN_APPROVAL, jamais ACTIVE, avec les colonnes de dynamic_fiscal_rules', async () => {
    for (const source of [vatSource(), cashSource(), rasSource(), aeSource(), delaySource(), btpSource()]) {
      const candidate = await compile(source);
      expect(candidate.row.status).toBe('PENDING_ADMIN_APPROVAL');
      expect(candidate.row.rule_id).toBe('R-TEST-1');
      expect(candidate.row.created_at).toBe(FIXTURE_CREATED_AT);
      expect(candidate.row.effective_from).toBe(FIXTURE_EFFECTIVE_FROM);
      expect(candidate.row.effective_to).toBeNull();
      expect(candidate.row.target_scope).toBe('INVOICE_GLOBAL');
      expect(candidate.row.wiki_source_slug).toBe(source['wiki_source_slug']);
      expect(Object.keys(candidate.row).sort()).toEqual(
        ['cgi_article_ref', 'created_at', 'effective_from', 'effective_to', 'rule_ast_json', 'rule_id', 'status', 'target_scope', 'wiki_source_slug'],
      );
    }
  });

  it('empreinte SHA-256 de la source (64 hexa minuscules) qui change si un octet change', async () => {
    const first = await compile(cashSource());
    expect(first.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    const other = await compile(withRule(cashSource(), { daily_cap_cents: 1 }));
    expect(other.sourceSha256).not.toBe(first.sourceSha256);
  });

  it('empreinte = SHA-256 des octets UTF-8 du texte fourni (calcul indépendant)', async () => {
    const text = asText(cashSource());
    const candidate = await compileWikiRule({ wikiSourceText: text, ruleId: 'R-1', createdAtIso: FIXTURE_CREATED_AT });
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(candidate.sourceSha256).toBe(hex);
  });

  it('porte l\'état de vérification de la source (ERRATA section E)', async () => {
    expect((await compile(cashSource())).verificationState).toBe('RECOUPÉ');
    expect((await compile(rasSource())).verificationState).toBe('NON RECOUPÉ');
    expect((await compile(btpSource())).verificationState).toBe('PROVISOIRE');
    expect([...VERIFICATION_STATES]).toEqual([...GOLDEN_STATES]);
  });

  it('refuse un état de vérification absent ou inconnu (aucune valeur par défaut)', async () => {
    await expectCompileError(asText(withoutKey(cashSource(), 'verification_state')), 'WIKI_SOURCE_SCHEMA_INVALID');
    await expectCompileError(asText({ ...cashSource(), verification_state: 'VÉRIFIÉ' }), 'WIKI_SOURCE_SCHEMA_INVALID');
  });
});

describe('FSM du cycle de vie (Doc_02 § 10 / ERD dynamic_fiscal_rules)', () => {
  const ALL: readonly RuleRowStatus[] = ['PENDING_ADMIN_APPROVAL', 'SHADOW_OBSERVE', 'ACTIVE', 'SUPERSEDED'];
  const LEGAL: readonly (readonly [RuleRowStatus, RuleRowStatus])[] = [
    ['PENDING_ADMIN_APPROVAL', 'SHADOW_OBSERVE'],
    ['SHADOW_OBSERVE', 'ACTIVE'],
    ['ACTIVE', 'SUPERSEDED'],
  ];

  it('seules trois transitions existent', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const legal = LEGAL.some(([a, b]) => a === from && b === to);
        if (legal) {
          expect(() => assertRuleTransitionAllowed(from, to)).not.toThrow();
        } else {
          expect(() => assertRuleTransitionAllowed(from, to), `${from} -> ${to}`).toThrow(/FSM_TRANSITION_REFUSED/);
        }
      }
    }
    expect(Object.keys(RULE_STATUS_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it('une règle compilée ne saute jamais à ACTIVE', () => {
    expect(() => assertRuleTransitionAllowed('PENDING_ADMIN_APPROVAL', 'ACTIVE')).toThrow(WikiCompilerError);
    expect(() => assertRuleTransitionAllowed('PENDING_ADMIN_APPROVAL', 'SUPERSEDED')).toThrow(WikiCompilerError);
  });
});

describe('validation Zod stricte de la source : échec fermé, erreurs typées', () => {
  it('texte non JSON, vide, non objet', async () => {
    await expectCompileError('', 'WIKI_SOURCE_MALFORMED');
    await expectCompileError('{pas du json', 'WIKI_SOURCE_MALFORMED');
    await expectCompileError('[1,2]', 'WIKI_SOURCE_SCHEMA_INVALID');
    await expectCompileError(`${asText(cashSource())} suite`, 'WIKI_SOURCE_MALFORMED');
  });

  it('article de loi absent, vide ou blanc', async () => {
    await expectCompileError(asText(withoutKey(cashSource(), 'cgi_article_ref')), 'WIKI_ARTICLE_MISSING');
    await expectCompileError(asText({ ...cashSource(), cgi_article_ref: '' }), 'WIKI_ARTICLE_MISSING');
    await expectCompileError(asText({ ...cashSource(), cgi_article_ref: '   ' }), 'WIKI_ARTICLE_MISSING');
  });

  it('date d\'effet absente, illisible ou impossible, et fin avant début', async () => {
    await expectCompileError(asText(withoutKey(cashSource(), 'effective_from')), 'WIKI_DATE_INVALID');
    await expectCompileError(asText({ ...cashSource(), effective_from: 'abc' }), 'WIKI_DATE_INVALID');
    await expectCompileError(asText({ ...cashSource(), effective_from: '2026-02-30' }), 'WIKI_DATE_INVALID');
    await expectCompileError(asText({ ...cashSource(), effective_from: '26-01-01' }), 'WIKI_DATE_INVALID');
    await expectCompileError(asText({ ...cashSource(), effective_to: '2025-12-31' }), 'WIKI_DATE_INVALID');
    await expectCompileError(asText(withoutKey(cashSource(), 'effective_to')), 'WIKI_DATE_INVALID');
  });

  it('taux de TVA hors liste 2026 (D-04)', async () => {
    await expectCompileError(asText(withRule(vatSource(), { allowed_rates_bps: [2000, 1400] })), 'WIKI_VAT_RATE_NOT_ALLOWED');
    await expectCompileError(asText(withRule(vatSource(), { allowed_rates_bps: [700] })), 'WIKI_VAT_RATE_NOT_ALLOWED');
  });

  it('montants non entiers : décimal, exposant, chaîne, négatif', async () => {
    const text = asText(cashSource());
    const decimal = text.replace(/"daily_cap_cents":\d+/, '"daily_cap_cents":1.5');
    expect(decimal).not.toBe(text);
    await expectCompileError(decimal, 'WIKI_AMOUNT_NOT_INTEGER');
    await expectCompileError(text.replace(/"daily_cap_cents":\d+/, '"daily_cap_cents":1e3'), 'WIKI_AMOUNT_NOT_INTEGER');
    await expectCompileError(asText(withRule(cashSource(), { daily_cap_cents: '100' })), 'WIKI_AMOUNT_NOT_INTEGER');
    await expectCompileError(asText(withRule(cashSource(), { daily_cap_cents: -1 })), 'WIKI_AMOUNT_NOT_INTEGER');
    await expectCompileError(asText(withRule(cashSource(), { monthly_cap_cents: Number.MAX_SAFE_INTEGER + 2 })), 'WIKI_AMOUNT_NOT_INTEGER');
  });

  it('champs inconnus (strictObject) à la racine et dans la règle', async () => {
    await expectCompileError(asText({ ...cashSource(), extra: 1 }), 'WIKI_UNKNOWN_FIELD');
    await expectCompileError(asText(withRule(cashSource(), { surprise: true })), 'WIKI_UNKNOWN_FIELD');
  });

  it('champs fiscaux en doublon : clé JSON répétée et taux répété', async () => {
    const text = asText(cashSource());
    const doubled = text.replace('"daily_cap_cents":', '"daily_cap_cents":1,"daily_cap_cents":');
    expect(doubled).not.toBe(text);
    await expectCompileError(doubled, 'WIKI_SOURCE_DUPLICATE_FIELD');
    await expectCompileError(asText(withRule(vatSource(), { allowed_rates_bps: [2000, 2000] })), 'WIKI_SOURCE_DUPLICATE_FIELD');
  });

  it('aucune valeur fiscale par défaut : base du plafond absente refusée, genre inconnu refusé', async () => {
    const source = cashSource();
    const rule = source['rule'];
    if (typeof rule !== 'object' || rule === null) {
      throw new Error('fixture');
    }
    await expectCompileError(asText({ ...source, rule: withoutKey({ ...rule }, 'cap_basis') }), 'WIKI_SOURCE_SCHEMA_INVALID');
    await expectCompileError(asText({ ...source, rule: withoutKey({ ...rule }, 'daily_cap_cents') }), 'WIKI_SOURCE_SCHEMA_INVALID');
    await expectCompileError(asText(withRule(source, { kind: 'INCONNU' })), 'WIKI_SOURCE_SCHEMA_INVALID');
  });

  it('taux hors bornes refusé par les schémas de rule-ast', async () => {
    await expectCompileError(asText(withRule(rasSource(), { reduced_rate_bps: 10001 })), 'AST_INVALID');
  });

  it('paramètres de l\'appelant : identifiant et horloge valides exigés', async () => {
    const text = asText(cashSource());
    const noId = await compileWikiRule({ wikiSourceText: text, ruleId: '', createdAtIso: FIXTURE_CREATED_AT }).catch((e: unknown) => e);
    expect(noId).toBeInstanceOf(WikiCompilerError);
    const badClock = await compileWikiRule({ wikiSourceText: text, ruleId: 'R-1', createdAtIso: 'hier' }).catch((e: unknown) => e);
    expect(badClock).toBeInstanceOf(WikiCompilerError);
    if (badClock instanceof WikiCompilerError) {
      expect(badClock.code).toBe('COMPILER_PARAMETER_INVALID');
    }
  });
});

describe('déterminisme : même source, même sortie octet pour octet', () => {
  it('deux compilations identiques, quel que soit l\'ordre des clés de la source', async () => {
    const source = cashSource();
    const reordered = Object.fromEntries(Object.entries(source).reverse());
    const first = await compile(source);
    const second = await compile(source);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const third = await compile(reordered);
    expect(third.row.rule_ast_json).toBe(first.row.rule_ast_json);
    // l'empreinte suit les octets de la source (ordre des clés compris) : traçabilité exacte
    expect(third.sourceSha256).not.toBe(first.sourceSha256);
  });

  it('rule_ast_json est du JSON canonique : clés triées, sans espace', async () => {
    const candidate = await compile(delaySource());
    const parsed: unknown = JSON.parse(candidate.row.rule_ast_json);
    expect(candidate.row.rule_ast_json).toBe(canonicalJson(parsed));
    expect(candidate.row.rule_ast_json).not.toMatch(/\s/);
    const keys = [...candidate.row.rule_ast_json.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(5);
  });

  it('canonicalJson trie les clés et refuse les non-entiers', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2], c: null } })).toBe('{"a":{"c":null,"d":[3,2]},"b":1}');
    expect(() => canonicalJson({ a: 1.5 })).toThrow(WikiCompilerError);
  });
});

describe('absence de LLM, de réseau et de base : scan des imports et des appels', () => {
  const sourceDir = new URL('../src/', import.meta.url);
  const compilerFiles = readdirSync(sourceDir).filter((name) => name.startsWith('wiki-'));

  it('le module compilateur existe et est exporté', () => {
    expect(compilerFiles).toContain('wiki-to-ast-compiler.ts');
  });

  it('aucun import réseau, base, processus ou LLM ; aucun appel dynamique', () => {
    expect(compilerFiles.length).toBeGreaterThan(0);
    for (const name of compilerFiles) {
      const text = readFileSync(new URL(name, sourceDir), 'utf8');
      const imports = [
        ...[...text.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? ''),
        ...[...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? ''),
      ];
      expect(imports.length, `${name} : imports lus`).toBeGreaterThan(0);
      for (const specifier of imports) {
        expect(specifier, `${name} importe ${specifier}`).toMatch(/^(\.\/|zod$|@fisca\/shared-types$)/);
      }
      for (const forbidden of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /node:(http|https|net|dgram|child_process|dns|tls|worker_threads)/, /\beval\s*\(/, /new Function\s*\(/, /\bD1Database\b/, /\bopenai\b/i, /\banthropic\b/i, /\bDate\.now\s*\(/, /new Date\s*\(/, /Math\.random/, /randomUUID/]) {
        expect(text, `${name} contient ${String(forbidden)}`).not.toMatch(forbidden);
      }
    }
  });
});
