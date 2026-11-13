import { assertValidVatRateForIssueYear } from '@fisca/shared-types';
import { z } from 'zod';
import { dayNumber, parseIsoDate } from './calendar.ts';
import { CONTRADICTORY_VECTOR_REJECTIONS, evaluateContradictoryVectors, rejectVectors, sandboxEngine, type VectorEvaluation } from './contradictory-vectors.ts';
import type { DynamicFiscalAstEngine } from './dynamic-fiscal-ast-engine.ts';
import { FISCAL_AST_ERROR_CODES, FiscalAstError, type FiscalAstErrorCode } from './errors.ts';
import { COMPARATORS, DYNAMIC_FISCAL_RULE_SCHEMA, type DynamicFiscalRuleAst, type RuleKind } from './rule-ast.ts';
import type { RuleRow, RuleRowStatus } from './rule-store.ts';
import { WikiCompilerError, type CaseOutcome, type WikiCompilerErrorCode } from './wiki-compiler-errors.ts';
import { canonicalJson, parseStrictJson, sha256Hex } from './wiki-json.ts';

/**
 * Compilateur Wiki-vers-AST (Doc_02 § 10, ADR-04, ADR-05) : il COMPILE un texte wiki déjà rédigé, il ne rédige rien.
 * Ni LLM, ni réseau, ni base, ni horloge : l'identifiant et la date de création sont des paramètres.
 * Les cas de test de promotion sont des DONNÉES interprétées par le moteur, jamais du code évalué.
 */

/** États de vérification de la substance fiscale (ERRATA section E, ERRATA B-09). */
export const VERIFICATION_STATES = ['RECOUPÉ', 'NON RECOUPÉ', 'PROVISOIRE'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/** Nombre minimal de cas de test exigés pour promouvoir une règle compilée (Doc_01 § PRD, ADR-05 : 3 cas). */
export const ADVERSARIAL_CASES_MIN = 3;

/**
 * Transitions du cycle de vie d'une règle (colonne `status` de dynamic_fiscal_rules, Doc_02 § 10) :
 * une règle compilée naît PENDING_ADMIN_APPROVAL, passe en observation, puis ACTIVE, puis SUPERSEDED.
 */
export const RULE_STATUS_TRANSITIONS: Readonly<Record<RuleRowStatus, readonly RuleRowStatus[]>> = {
  PENDING_ADMIN_APPROVAL: ['SHADOW_OBSERVE'],
  SHADOW_OBSERVE: ['ACTIVE'],
  ACTIVE: ['SUPERSEDED'],
  SUPERSEDED: [],
};

export function assertRuleTransitionAllowed(from: RuleRowStatus, to: RuleRowStatus): void {
  if (!RULE_STATUS_TRANSITIONS[from].includes(to)) {
    throw new WikiCompilerError('FSM_TRANSITION_REFUSED', `transition ${from} -> ${to} absente de la FSM du cycle de vie d'une règle.`);
  }
}

// ------------------------------------------------------------------ schéma strict de la source wiki

const amount = z.int().nonnegative();
const rule = { rule_code: z.string() };

const WIKI_RULE_SCHEMA = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('VAT_RATE_SET'), ...rule, allowed_rates_bps: z.array(amount).min(1) }),
  z.strictObject({ kind: z.literal('CASH_CEILING'), ...rule, cap_basis: z.enum(['TTC', 'HT']), daily_cap_cents: amount, monthly_cap_cents: amount }),
  z.strictObject({
    kind: z.literal('RAS_TVA'),
    ...rule,
    applies_when_ttc_comparator: z.enum(COMPARATORS),
    applies_when_ttc_bound_cents: amount,
    attestation_validity_months: amount,
    reduced_rate_bps: amount,
    full_rate_bps: amount,
  }),
  z.strictObject({ kind: z.literal('AUTO_ENTREPRENEUR_THRESHOLD'), ...rule, client_threshold_cents: amount, withholding_rate_bps: amount }),
  z.strictObject({
    kind: z.literal('PAYMENT_DELAY_PENALTY'),
    ...rule,
    base_rate_bps: amount,
    additional_period_increment_bps: amount,
    rounding: z.enum(['CEIL_DIRHAM', 'HALF_UP_CENT']),
    legal_term_standard_days: amount,
    legal_term_contract_days: amount,
    legal_term_decree_days: amount,
  }),
  z.strictObject({ kind: z.literal('BTP_SETTLEMENT'), ...rule, retention_rate_bps: amount }),
]);

const TARGET_SCOPES = ['INVOICE_LINE', 'INVOICE_GLOBAL', 'JOURNAL_ENTRY', 'FEC_AUDIT'] as const;

const WIKI_SOURCE_SCHEMA = z.strictObject({
  wiki_source_slug: z.string().regex(/^[a-z0-9][a-z0-9._/-]{2,127}$/),
  cgi_article_ref: z.string().refine((value) => value.trim().length > 0, { message: 'article de loi vide' }),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  target_scope: z.enum(TARGET_SCOPES),
  verification_state: z.enum(VERIFICATION_STATES),
  rule: WIKI_RULE_SCHEMA,
});
type WikiSource = z.infer<typeof WIKI_SOURCE_SCHEMA>;
type WikiRule = WikiSource['rule'];

// ------------------------------------------------------------------ sorties

export interface CompileWikiRuleParams {
  /** Texte JSON de la source wiki, tel que stocké : l'empreinte porte sur ses octets UTF-8. */
  readonly wikiSourceText: string;
  /** Identifiant de la règle (paramètre : le compilateur ne génère aucun identifiant). */
  readonly ruleId: string;
  /** Horodatage de création AAAA-MM-JJThh:mm:ss[.mmm]Z (paramètre : le compilateur ne lit aucune horloge). */
  readonly createdAtIso: string;
}

export interface CompiledRuleCandidate {
  /** Ligne candidate de dynamic_fiscal_rules, toujours PENDING_ADMIN_APPROVAL. */
  readonly row: RuleRow;
  /** SHA-256 hexadécimal de la source wiki (traçabilité). */
  readonly sourceSha256: string;
  /** État de vérification porté par la source (ERRATA section E) ; la table n'a pas de colonne pour lui. */
  readonly verificationState: VerificationState;
}

/**
 * Le contrôle de contradiction est ÉVALUÉ (décision H3, 2026-11-13) : il remplace l'ancien marqueur « non évalué »
 * (définition de « contradictoire » alors non tranchée). Voir contradictory-vectors.ts.
 */
export const CONTRADICTION_CHECK_STATUS = 'EVALUATED' as const;

export interface PromotedRuleCandidate {
  /** Même ligne, statut SHADOW_OBSERVE. */
  readonly row: RuleRow;
  readonly sourceSha256: string;
  readonly verificationState: VerificationState;
  readonly caseOutcomes: readonly CaseOutcome[];
  readonly contradictionCheck: typeof CONTRADICTION_CHECK_STATUS;
  /** Détail des vecteurs contradictoires évalués par le moteur (un par vecteur reçu). */
  readonly vectorEvaluations: readonly VectorEvaluation[];
}

/** Ligne promue vers ACTIVE : porte les mêmes preuves que la promotion SHADOW_OBSERVE dont elle découle. */
export type ActivatedRuleCandidate = PromotedRuleCandidate;

// ------------------------------------------------------------------ compilation

type IssueClass = 'WIKI_UNKNOWN_FIELD' | 'WIKI_ARTICLE_MISSING' | 'WIKI_DATE_INVALID' | 'WIKI_AMOUNT_NOT_INTEGER' | 'WIKI_SOURCE_SCHEMA_INVALID';
const ISSUE_PRIORITY: readonly IssueClass[] = ['WIKI_UNKNOWN_FIELD', 'WIKI_ARTICLE_MISSING', 'WIKI_DATE_INVALID', 'WIKI_AMOUNT_NOT_INTEGER', 'WIKI_SOURCE_SCHEMA_INVALID'];

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || typeof segment === 'symbol') {
      return undefined;
    }
    current = Object.entries(current).find(([key]) => key === String(segment))?.[1];
  }
  return current;
}

function classifyIssue(issue: z.core.$ZodIssue, raw: unknown): IssueClass {
  if (issue.code === 'unrecognized_keys') {
    return 'WIKI_UNKNOWN_FIELD';
  }
  const head = issue.path[0];
  if (head === 'cgi_article_ref') {
    return 'WIKI_ARTICLE_MISSING';
  }
  if (head === 'effective_from' || head === 'effective_to') {
    return 'WIKI_DATE_INVALID';
  }
  const last = issue.path[issue.path.length - 1];
  const isNumericField = typeof last === 'number' || (typeof last === 'string' && /(_cents|_bps|_days|_months)$/.test(last));
  if (isNumericField) {
    const present = valueAt(raw, issue.path);
    if (present !== undefined && (typeof present !== 'number' || present < 0)) {
      return 'WIKI_AMOUNT_NOT_INTEGER';
    }
  }
  return 'WIKI_SOURCE_SCHEMA_INVALID';
}

function describeIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`).join(' ; ');
}

function parseSource(text: string): { readonly source: WikiSource } {
  const raw = parseStrictJson(text);
  const parsed = WIKI_SOURCE_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const classes = parsed.error.issues.map((issue) => classifyIssue(issue, raw));
    const code: IssueClass = ISSUE_PRIORITY.find((candidate) => classes.includes(candidate)) ?? 'WIKI_SOURCE_SCHEMA_INVALID';
    throw new WikiCompilerError(code, `source wiki invalide — ${describeIssues(parsed.error.issues)}`);
  }
  return { source: parsed.data };
}

function checkDates(source: WikiSource): void {
  const read = (iso: string, label: string): number => {
    try {
      return dayNumber(parseIsoDate(iso, label));
    } catch (error) {
      if (error instanceof FiscalAstError) {
        throw new WikiCompilerError('WIKI_DATE_INVALID', error.detail);
      }
      throw error;
    }
  };
  const from = read(source.effective_from, 'effective_from');
  if (source.effective_to !== null && read(source.effective_to, 'effective_to') < from) {
    throw new WikiCompilerError('WIKI_DATE_INVALID', 'effective_to précède effective_from.');
  }
}

function checkVatRates(ruleSource: WikiRule, effectiveFrom: string): void {
  if (ruleSource.kind !== 'VAT_RATE_SET') {
    return;
  }
  const seen = new Set<number>();
  for (const rate of ruleSource.allowed_rates_bps) {
    if (seen.has(rate)) {
      throw new WikiCompilerError('WIKI_SOURCE_DUPLICATE_FIELD', `taux ${rate} bps répété dans allowed_rates_bps.`);
    }
    seen.add(rate);
    try {
      assertValidVatRateForIssueYear(rate, effectiveFrom);
    } catch (error) {
      throw new WikiCompilerError('WIKI_VAT_RATE_NOT_ALLOWED', `taux ${rate} bps hors liste TVA à la date d'effet ${effectiveFrom} (D-04) : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function buildAst(ruleSource: WikiRule): unknown {
  const head = { ast_version: 1, rule_code: ruleSource.rule_code };
  switch (ruleSource.kind) {
    case 'VAT_RATE_SET':
      return { ...head, kind: ruleSource.kind, rates: { node: 'RATE_SET', allowed_rates_bps: ruleSource.allowed_rates_bps } };
    case 'CASH_CEILING':
      return {
        ...head,
        kind: ruleSource.kind,
        cap_basis: ruleSource.cap_basis,
        daily_cap: { node: 'CAP', period: 'DAY', amount_cents: ruleSource.daily_cap_cents },
        monthly_cap: { node: 'CAP', period: 'MONTH', amount_cents: ruleSource.monthly_cap_cents },
      };
    case 'RAS_TVA':
      return {
        ...head,
        kind: ruleSource.kind,
        applies_when_ttc: { node: 'COMPARISON', comparator: ruleSource.applies_when_ttc_comparator, bound_cents: ruleSource.applies_when_ttc_bound_cents },
        attestation_validity: { node: 'DURATION', unit: 'MONTHS', count: ruleSource.attestation_validity_months },
        reduced_rate: { node: 'BPS_RATE', rate_bps: ruleSource.reduced_rate_bps },
        full_rate: { node: 'BPS_RATE', rate_bps: ruleSource.full_rate_bps },
      };
    case 'AUTO_ENTREPRENEUR_THRESHOLD':
      return {
        ...head,
        kind: ruleSource.kind,
        client_brackets: {
          node: 'BRACKETS',
          brackets: [
            { from_cents: 0, up_to_cents: ruleSource.client_threshold_cents, rate_bps: 0 },
            { from_cents: ruleSource.client_threshold_cents, up_to_cents: null, rate_bps: ruleSource.withholding_rate_bps },
          ],
        },
      };
    case 'PAYMENT_DELAY_PENALTY':
      return {
        ...head,
        kind: ruleSource.kind,
        base_rate: { node: 'BPS_RATE', rate_bps: ruleSource.base_rate_bps },
        penalty_scale: { node: 'PENALTY_SCALE', additional_period_increment_bps: ruleSource.additional_period_increment_bps, rounding: ruleSource.rounding },
        legal_terms: {
          standard: { node: 'DURATION', unit: 'DAYS', count: ruleSource.legal_term_standard_days },
          contract: { node: 'DURATION', unit: 'DAYS', count: ruleSource.legal_term_contract_days },
          decree: { node: 'DURATION', unit: 'DAYS', count: ruleSource.legal_term_decree_days },
        },
      };
    case 'BTP_SETTLEMENT':
      return { ...head, kind: ruleSource.kind, retention_rate: { node: 'BPS_RATE', rate_bps: ruleSource.retention_rate_bps } };
  }
}

const RULE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CREATED_AT_PATTERN = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function checkParameters(params: CompileWikiRuleParams): void {
  if (!RULE_ID_PATTERN.test(params.ruleId)) {
    throw new WikiCompilerError('COMPILER_PARAMETER_INVALID', 'ruleId absent ou hors forme (lettres, chiffres, . _ : -, 128 caractères au plus).');
  }
  const match = CREATED_AT_PATTERN.exec(params.createdAtIso);
  if (match === null) {
    throw new WikiCompilerError('COMPILER_PARAMETER_INVALID', 'createdAtIso doit être un horodatage UTC AAAA-MM-JJThh:mm:ss[.mmm]Z.');
  }
  try {
    parseIsoDate(match[1], 'createdAtIso');
  } catch (error) {
    throw new WikiCompilerError('COMPILER_PARAMETER_INVALID', error instanceof FiscalAstError ? error.detail : 'createdAtIso illisible.');
  }
}

/**
 * Compile une source wiki en ligne de règle candidate. Échec fermé : toute anomalie lève une WikiCompilerError typée.
 * Même texte, même ruleId, même createdAtIso : même sortie, octet pour octet.
 */
export async function compileWikiRule(params: CompileWikiRuleParams): Promise<CompiledRuleCandidate> {
  checkParameters(params);
  const { source } = parseSource(params.wikiSourceText);
  checkDates(source);
  checkVatRates(source.rule, source.effective_from);
  const ast = DYNAMIC_FISCAL_RULE_SCHEMA.safeParse(buildAst(source.rule));
  if (!ast.success) {
    throw new WikiCompilerError('AST_INVALID', `AST refusé par rule-ast — ${describeIssues(ast.error.issues)}`);
  }
  const row: RuleRow = {
    rule_id: params.ruleId,
    cgi_article_ref: source.cgi_article_ref,
    effective_from: source.effective_from,
    effective_to: source.effective_to,
    target_scope: source.target_scope,
    status: 'PENDING_ADMIN_APPROVAL',
    rule_ast_json: canonicalJson(ast.data),
    wiki_source_slug: source.wiki_source_slug,
    created_at: params.createdAtIso,
  };
  sandboxEngine(row);
  return { row, sourceSha256: await sha256Hex(params.wikiSourceText), verificationState: source.verification_state };
}

// ------------------------------------------------------------------ cas de test : des données

/** Opération du moteur visée par un cas, avec le genre de règle qu'elle évalue. */
export const CASE_OPERATIONS = {
  evaluateVatRate: 'VAT_RATE_SET',
  evaluateCashCeiling: 'CASH_CEILING',
  evaluateCashCeilingSequence: 'CASH_CEILING',
  evaluateRasTva: 'RAS_TVA',
  evaluateAutoEntrepreneurThreshold: 'AUTO_ENTREPRENEUR_THRESHOLD',
  evaluatePaymentDelayPenalty: 'PAYMENT_DELAY_PENALTY',
  evaluatePaymentDelayStatus: 'PAYMENT_DELAY_PENALTY',
  evaluateBtpSettlement: 'BTP_SETTLEMENT',
} as const satisfies Record<string, RuleKind>;
type CaseOperation = keyof typeof CASE_OPERATIONS;
const OPERATION_NAMES = Object.keys(CASE_OPERATIONS) as [CaseOperation, ...CaseOperation[]];

const CASE_SCHEMA = z.strictObject({
  case_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/),
  label: z.string().min(1),
  operation: z.enum(OPERATION_NAMES),
  /** Entrée du moteur SANS `ruleCode` : le compilateur y injecte le code de la règle candidate. */
  input: z.record(z.string(), z.unknown()).refine((value) => !Object.keys(value).includes('ruleCode'), { message: 'ruleCode est injecté par le compilateur' }),
  expect: z.discriminatedUnion('outcome', [
    z.strictObject({
      outcome: z.literal('VALUE'),
      fields: z.record(z.string(), z.union([z.int(), z.string(), z.boolean(), z.null()])).refine((value) => Object.keys(value).length > 0, { message: 'au moins un champ attendu' }),
    }),
    z.strictObject({ outcome: z.literal('REFUSAL'), error_code: z.enum(FISCAL_AST_ERROR_CODES) }),
  ]),
});
type CandidateCase = z.infer<typeof CASE_SCHEMA>;

function caseIdOf(raw: unknown): string {
  const id = valueAt(raw, ['case_id']);
  return typeof id === 'string' ? id : '(sans identifiant)';
}

function runOperation(engine: DynamicFiscalAstEngine, testCase: CandidateCase, ruleCode: string): object {
  const input = { ...testCase.input, ruleCode };
  switch (testCase.operation) {
    case 'evaluateVatRate':
      return engine.evaluateVatRate(input as Parameters<DynamicFiscalAstEngine['evaluateVatRate']>[0]);
    case 'evaluateCashCeiling':
      return engine.evaluateCashCeiling(input as Parameters<DynamicFiscalAstEngine['evaluateCashCeiling']>[0]);
    case 'evaluateCashCeilingSequence':
      return engine.evaluateCashCeilingSequence(input as Parameters<DynamicFiscalAstEngine['evaluateCashCeilingSequence']>[0]);
    case 'evaluateRasTva':
      return engine.evaluateRasTva(input as Parameters<DynamicFiscalAstEngine['evaluateRasTva']>[0]);
    case 'evaluateAutoEntrepreneurThreshold':
      return engine.evaluateAutoEntrepreneurThreshold(input as Parameters<DynamicFiscalAstEngine['evaluateAutoEntrepreneurThreshold']>[0]);
    case 'evaluatePaymentDelayPenalty':
      return engine.evaluatePaymentDelayPenalty(input as Parameters<DynamicFiscalAstEngine['evaluatePaymentDelayPenalty']>[0]);
    case 'evaluatePaymentDelayStatus':
      return engine.evaluatePaymentDelayStatus(input as Parameters<DynamicFiscalAstEngine['evaluatePaymentDelayStatus']>[0]);
    case 'evaluateBtpSettlement':
      return engine.evaluateBtpSettlement(input as Parameters<DynamicFiscalAstEngine['evaluateBtpSettlement']>[0]);
  }
}

function executeCase(engine: DynamicFiscalAstEngine, testCase: CandidateCase, ruleCode: string): CaseOutcome {
  let result: object | undefined;
  let refusedWith: FiscalAstErrorCode | undefined;
  let unexpected: string | undefined;
  try {
    result = runOperation(engine, testCase, ruleCode);
  } catch (error) {
    if (error instanceof FiscalAstError) {
      refusedWith = error.code;
    } else {
      unexpected = error instanceof Error ? error.message : String(error);
    }
  }
  const caseId = testCase.case_id;
  if (unexpected !== undefined) {
    return { caseId, passed: false, detail: `erreur inattendue du moteur : ${unexpected}` };
  }
  if (testCase.expect.outcome === 'REFUSAL') {
    if (refusedWith === undefined) {
      return { caseId, passed: false, detail: `refus ${testCase.expect.error_code} attendu, le moteur a rendu une valeur.` };
    }
    return refusedWith === testCase.expect.error_code
      ? { caseId, passed: true, detail: `refus ${refusedWith} conforme.` }
      : { caseId, passed: false, detail: `refus ${testCase.expect.error_code} attendu, obtenu ${refusedWith}.` };
  }
  if (result === undefined) {
    return { caseId, passed: false, detail: `valeur attendue, le moteur a refusé avec ${refusedWith ?? 'une erreur'}.` };
  }
  const actual = new Map<string, unknown>(Object.entries(result));
  const gaps = Object.entries(testCase.expect.fields)
    .filter(([key, value]) => !actual.has(key) || actual.get(key) !== value)
    .map(([key, value]) => `${key} : attendu ${JSON.stringify(value)}, obtenu ${actual.has(key) ? JSON.stringify(actual.get(key)) : '(absent)'}`);
  return gaps.length === 0 ? { caseId, passed: true, detail: 'valeurs conformes.' } : { caseId, passed: false, detail: gaps.join(' ; ') };
}

// ------------------------------------------------------------------ promotion PENDING_ADMIN_APPROVAL -> SHADOW_OBSERVE

/**
 * Promeut une règle compilée vers SHADOW_OBSERVE à une condition : au moins ADVERSARIAL_CASES_MIN cas de test, bien formés,
 * à identifiants distincts, TOUS exécutés contre le moteur avec la règle candidate et TOUS conformes.
 * ET, après ces cas, le contrôle de contradiction : au moins CONTRADICTORY_VECTORS_MIN vecteurs {role, operation, input, expected},
 * un par rôle, évalués RÉELLEMENT par le moteur (voir evaluateContradictoryVectors). Sinon AST_CONTRADICTORY_VECTORS_INVALID.
 */
export function promoteToShadowObserve(candidate: CompiledRuleCandidate, rawCases: unknown, rawVectors: unknown): PromotedRuleCandidate {
  assertRuleTransitionAllowed(candidate.row.status, 'SHADOW_OBSERVE');
  const engine = sandboxEngine(candidate.row);
  const parsedAst = DYNAMIC_FISCAL_RULE_SCHEMA.safeParse(safeJson(candidate.row.rule_ast_json));
  if (!parsedAst.success) {
    throw new WikiCompilerError('AST_INVALID', `rule_ast_json refusé par rule-ast — ${describeIssues(parsedAst.error.issues)}`);
  }
  const ast: DynamicFiscalRuleAst = parsedAst.data;

  const received: readonly unknown[] = Array.isArray(rawCases) ? rawCases : [];
  const listed: readonly CaseOutcome[] = received.map((raw) => ({ caseId: caseIdOf(raw), passed: false, detail: 'non exécuté : promotion refusée avant exécution.' }));
  if (received.length < ADVERSARIAL_CASES_MIN) {
    throw new WikiCompilerError('PROMOTION_CASES_INSUFFICIENT', `${received.length} cas fournis, ${ADVERSARIAL_CASES_MIN} au moins exigés pour passer en SHADOW_OBSERVE.`, listed);
  }

  const cases: CandidateCase[] = [];
  const problems: CaseOutcome[] = [];
  const seen = new Set<string>();
  received.forEach((raw) => {
    const parsed = CASE_SCHEMA.safeParse(raw);
    if (!parsed.success) {
      problems.push({ caseId: caseIdOf(raw), passed: false, detail: `cas mal formé — ${describeIssues(parsed.error.issues)}` });
      return;
    }
    if (seen.has(parsed.data.case_id)) {
      problems.push({ caseId: parsed.data.case_id, passed: false, detail: 'identifiant de cas répété.' });
      return;
    }
    seen.add(parsed.data.case_id);
    if (CASE_OPERATIONS[parsed.data.operation] !== ast.kind) {
      problems.push({ caseId: parsed.data.case_id, passed: false, detail: `l'opération ${parsed.data.operation} évalue ${CASE_OPERATIONS[parsed.data.operation]}, la règle est ${ast.kind}.` });
      return;
    }
    cases.push(parsed.data);
  });
  if (problems.length > 0) {
    throw new WikiCompilerError('PROMOTION_CASE_INVALID', `${problems.length} cas invalide(s) sur ${received.length}.`, problems);
  }

  const outcomes = cases.map((testCase) => executeCase(engine, testCase, ast.rule_code));
  const failed = outcomes.filter((outcome) => !outcome.passed);
  if (failed.length > 0) {
    throw new WikiCompilerError('PROMOTION_CASE_FAILED', `${failed.length} cas en échec sur ${outcomes.length} : ${failed.map((o) => o.caseId).join(', ')}.`, outcomes);
  }
  const report = evaluateContradictoryVectors(candidate.row, rawVectors);
  const promoted: PromotedRuleCandidate = Object.freeze({
    row: Object.freeze({ ...candidate.row, status: 'SHADOW_OBSERVE' as const }),
    sourceSha256: candidate.sourceSha256,
    verificationState: candidate.verificationState,
    caseOutcomes: outcomes,
    contradictionCheck: CONTRADICTION_CHECK_STATUS,
    vectorEvaluations: report.vectorEvaluations,
  });
  VALIDATED_PROMOTIONS.add(promoted);
  return promoted;
}

/** Résultats de promotion émis par promoteToShadowObserve (identité d'objet) : seule preuve admise pour passer à ACTIVE. */
const VALIDATED_PROMOTIONS = new WeakSet<PromotedRuleCandidate>();

/**
 * Promeut une règle SHADOW_OBSERVE vers ACTIVE. Le contrôle de contradiction ne peut pas être contourné : l'argument doit être
 * le résultat de promoteToShadowObserve lui-même (un objet recopié ou forgé à la main est refusé), donc des vecteurs validés.
 */
export function promoteToActive(promoted: PromotedRuleCandidate): ActivatedRuleCandidate {
  assertRuleTransitionAllowed(promoted.row.status, 'ACTIVE');
  if (!VALIDATED_PROMOTIONS.has(promoted) || promoted.contradictionCheck !== CONTRADICTION_CHECK_STATUS || promoted.vectorEvaluations.length === 0) {
    throw rejectVectors(CONTRADICTORY_VECTOR_REJECTIONS.NOT_VALIDATED, 'promotion vers ACTIVE refusée : le résultat reçu ne provient pas du contrôle de contradiction (promoteToShadowObserve).');
  }
  return Object.freeze({ ...promoted, row: Object.freeze({ ...promoted.row, status: 'ACTIVE' as const }) });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export type { WikiCompilerErrorCode };
