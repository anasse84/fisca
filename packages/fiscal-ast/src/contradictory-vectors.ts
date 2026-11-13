import { z } from 'zod';
import { DynamicFiscalAstEngine } from './dynamic-fiscal-ast-engine.ts';
import { FiscalAstError, type FiscalAstErrorCode } from './errors.ts';
import { toSafeNumber } from './int-math.ts';
import { DYNAMIC_FISCAL_RULE_SCHEMA, type RuleKind } from './rule-ast.ts';
import type { RuleRow } from './rule-store.ts';
import { WikiCompilerError, type CaseOutcome } from './wiki-compiler-errors.ts';
import { canonicalJson } from './wiki-json.ts';

/**
 * Contrôle de contradiction des règles candidates (décision H3 du propriétaire, 2026-11-13) : l'AST est ÉVALUÉ RÉELLEMENT
 * par DynamicFiscalAstEngine contre un tableau de vecteurs {role, operation, input, expected}. Les vecteurs sont des DONNÉES
 * interprétées par le moteur : jamais d'eval, ni réseau, ni LLM, ni horloge. Aucune valeur fiscale n'est portée par ce module.
 */

/** UNIQUE table des rôles : renommer un rôle = changer UNE ligne ici (le code ne cite les rôles que par cette table). */
export const CONTRADICTORY_VECTOR_ROLES = {
  POSITIVE_NOMINAL: 'POSITIVE_NOMINAL',
  NEGATIVE_COUNTEREXAMPLE: 'NEGATIVE_COUNTEREXAMPLE',
  BOUNDARY_LIMIT: 'BOUNDARY_LIMIT',
} as const;
export type ContradictoryVectorRole = (typeof CONTRADICTORY_VECTOR_ROLES)[keyof typeof CONTRADICTORY_VECTOR_ROLES];

const ALL_ROLES: readonly ContradictoryVectorRole[] = Object.values(CONTRADICTORY_VECTOR_ROLES);

/** Nombre minimal de vecteurs : un par rôle. */
export const CONTRADICTORY_VECTORS_MIN = ALL_ROLES.length;

/** Motifs de rejet, préfixés entre crochets au détail de l'erreur AST_CONTRADICTORY_VECTORS_INVALID. */
export const CONTRADICTORY_VECTOR_REJECTIONS = {
  /** (a) moins de CONTRADICTORY_VECTORS_MIN vecteurs (ou pas une liste). */
  COUNT_BELOW_MIN: 'COUNT_BELOW_MIN',
  /** (b) un des rôles manque. */
  ROLE_MISSING: 'ROLE_MISSING',
  /** (c) deux vecteurs ont la même entrée (JSON canonique, clés triées). */
  DUPLICATE_INPUT: 'DUPLICATE_INPUT',
  /** (d) tous les résultats ont le même `matched`. */
  ALL_SAME_MATCHED: 'ALL_SAME_MATCHED',
  /** (e) un résultat calculé diverge de `expected` (égalité entière exacte). */
  EXPECTED_DIVERGENCE: 'EXPECTED_DIVERGENCE',
  /** (f) POSITIVE_NOMINAL ne matche pas, ou NEGATIVE_COUNTEREXAMPLE matche ou ajuste. */
  ROLE_SEMANTICS_VIOLATED: 'ROLE_SEMANTICS_VIOLATED',
  /** Vecteur hors schéma strict (clé inconnue, rôle inconnu, opération inconnue ou d'un autre genre, entier attendu). */
  VECTOR_MALFORMED: 'VECTOR_MALFORMED',
  /** Le moteur refuse l'entrée d'un vecteur (refus qui n'est pas « aucune correspondance » selon la table de projection). */
  ENGINE_REFUSED: 'ENGINE_REFUSED',
  /** Promotion vers ACTIVE sans résultat de promotion validé par ce contrôle. */
  NOT_VALIDATED: 'NOT_VALIDATED',
} as const;
export type ContradictoryVectorRejection = (typeof CONTRADICTORY_VECTOR_REJECTIONS)[keyof typeof CONTRADICTORY_VECTOR_REJECTIONS];

const CODE = 'AST_CONTRADICTORY_VECTORS_INVALID' as const;

export function rejectVectors(reason: ContradictoryVectorRejection, detail: string, outcomes: readonly CaseOutcome[] = []): WikiCompilerError {
  return new WikiCompilerError(CODE, `[${reason}] ${detail}`, outcomes);
}

// ------------------------------------------------------------------ table de projection

/** Projection commune d'une évaluation : `matched` et l'ajustement en centimes entiers. */
export interface ProjectedResult {
  readonly matched: boolean;
  readonly adjustmentCents: number;
}

type EngineInputOf<M extends keyof DynamicFiscalAstEngine> = DynamicFiscalAstEngine[M] extends (input: infer I) => unknown ? I : never;

export interface ProjectionLine {
  /** Genre de règle que l'opération évalue. */
  readonly kind: RuleKind;
  /** Sortie réelle du moteur dont `matched` se dérive (documentation vérifiée par test). */
  readonly matchedFrom: string;
  /** Sortie réelle du moteur dont `adjustmentCents` se dérive. */
  readonly adjustmentFrom: string;
  /** Pourquoi cette projection suit la sémantique du moteur. */
  readonly justification: string;
  /** Refus du moteur qui signifie « la règle ne correspond pas » (matched false, 0 centime) au lieu d'un vecteur invalide. */
  readonly refusalMeansNoMatch: readonly FiscalAstErrorCode[];
  /** Appelle le moteur avec l'entrée du vecteur (validée par le moteur lui-même : INPUT_INVALID sinon) et projette. */
  readonly run: (engine: DynamicFiscalAstEngine, input: Record<string, unknown>) => ProjectedResult;
}

const positive = (cents: number): boolean => cents > 0;

/**
 * UNE ligne par opération du moteur. Aucune valeur fiscale : seulement quelle sortie du moteur devient `matched`
 * et laquelle devient `adjustmentCents`.
 */
export const VECTOR_PROJECTIONS = {
  evaluateCashCeiling: {
    kind: 'CASH_CEILING',
    matchedFrom: 'exceedsCeiling',
    adjustmentFrom: 'excessTtcCents',
    justification: "Plafond d'espèces : le moteur pose exceedsCeiling quand le règlement dépasse le plafond restant (jour ou mois) ; l'excédent TTC est la part réintégrée. Plafond atteint sans être dépassé : false, 0.",
    refusalMeansNoMatch: [],
    run: (engine, input) => {
      const result = engine.evaluateCashCeiling(input as EngineInputOf<'evaluateCashCeiling'>);
      return { matched: result.exceedsCeiling, adjustmentCents: result.excessTtcCents };
    },
  },
  evaluateCashCeilingSequence: {
    kind: 'CASH_CEILING',
    matchedFrom: 'firstCrossingIndex !== null',
    adjustmentFrom: 'somme des excessTtcCents de steps',
    justification: "Suite de règlements au même fournisseur : le moteur rend l'indice de la première facture qui franchit un plafond (null sinon) ; l'ajustement total est la somme des excédents TTC de chaque étape, additionnés en BigInt.",
    refusalMeansNoMatch: [],
    run: (engine, input) => {
      const result = engine.evaluateCashCeilingSequence(input as EngineInputOf<'evaluateCashCeilingSequence'>);
      const total = result.steps.reduce((sum, step) => sum + BigInt(step.excessTtcCents), 0n);
      return { matched: result.firstCrossingIndex !== null, adjustmentCents: toSafeNumber(total, 'excédent cumulé') };
    },
  },
  evaluateVatRate: {
    kind: 'VAT_RATE_SET',
    matchedFrom: 'aucune levée (taux autorisé)',
    adjustmentFrom: 'aucun montant (0)',
    justification: "Liste de taux : le moteur ne rend de valeur que si le taux est autorisé (loi ET règle) ; VAT_RATE_NOT_ALLOWED et ADR_04_LF2026_VAT_VIOLATION sont ses refus « taux non autorisé » = pas de correspondance. La règle ne corrige aucun montant : ajustement 0 (la TVA calculée est une taxe, pas un ajustement).",
    refusalMeansNoMatch: ['VAT_RATE_NOT_ALLOWED', 'ADR_04_LF2026_VAT_VIOLATION'],
    run: (engine, input) => {
      engine.evaluateVatRate(input as EngineInputOf<'evaluateVatRate'>);
      return { matched: true, adjustmentCents: 0 };
    },
  },
  evaluateRasTva: {
    kind: 'RAS_TVA',
    matchedFrom: 'rasVatCents > 0',
    adjustmentFrom: 'rasVatCents',
    justification: "RAS-TVA : la retenue (rasVatCents) est le montant prélevé sur la TVA ; la règle correspond quand une retenue est effectivement due (> 0), et l'ajustement est cette retenue.",
    refusalMeansNoMatch: [],
    run: (engine, input) => {
      const result = engine.evaluateRasTva(input as EngineInputOf<'evaluateRasTva'>);
      return { matched: positive(result.rasVatCents), adjustmentCents: result.rasVatCents };
    },
  },
  evaluateAutoEntrepreneurThreshold: {
    kind: 'AUTO_ENTREPRENEUR_THRESHOLD',
    matchedFrom: 'surplusCents > 0',
    adjustmentFrom: 'withholdingCents',
    justification: "Seuil par client : la règle correspond quand le cumul franchit le seuil (surplus > 0) ; l'ajustement est la retenue calculée sur ce surplus (peut être 0 centime pour un surplus d'un centime, arrondi demi supérieur du moteur).",
    refusalMeansNoMatch: [],
    run: (engine, input) => {
      const result = engine.evaluateAutoEntrepreneurThreshold(input as EngineInputOf<'evaluateAutoEntrepreneurThreshold'>);
      return { matched: positive(result.surplusCents), adjustmentCents: result.withholdingCents };
    },
  },
  evaluatePaymentDelayPenalty: {
    kind: 'PAYMENT_DELAY_PENALTY',
    matchedFrom: 'penaltyCents > 0',
    adjustmentFrom: 'penaltyCents',
    justification: "Barème de pénalité 69-21 : le moteur rend 0 sans mois entamé, sans impayé ou en cas de litige documenté ; la règle correspond quand une pénalité est due (> 0), l'ajustement est cette pénalité.",
    refusalMeansNoMatch: [],
    run: (engine, input) => {
      const result = engine.evaluatePaymentDelayPenalty(input as EngineInputOf<'evaluatePaymentDelayPenalty'>);
      return { matched: positive(result.penaltyCents), adjustmentCents: result.penaltyCents };
    },
  },
  evaluatePaymentDelayStatus: {
    kind: 'PAYMENT_DELAY_PENALTY',
    matchedFrom: 'daysLate > 0',
    adjustmentFrom: 'aucun montant (0)',
    justification: "Délai 69-21 : le moteur compte 0 jour de retard le jour pile de l'échéance (incluse) et 1 dès le lendemain ; la règle correspond en cas de retard (> 0). Le statut ne porte aucun montant : ajustement 0.",
    refusalMeansNoMatch: [],
    run: (engine, input) => {
      const result = engine.evaluatePaymentDelayStatus(input as EngineInputOf<'evaluatePaymentDelayStatus'>);
      return { matched: positive(result.daysLate), adjustmentCents: 0 };
    },
  },
  evaluateBtpSettlement: {
    kind: 'BTP_SETTLEMENT',
    matchedFrom: 'retentionCents > 0',
    adjustmentFrom: 'retentionCents',
    justification: "Décompte BTP : la retenue de garantie (retentionCents) est le montant retenu sur les travaux ; la règle correspond quand une retenue est opérée (> 0), l'ajustement est cette retenue.",
    refusalMeansNoMatch: [],
    run: (engine, input) => {
      const result = engine.evaluateBtpSettlement(input as EngineInputOf<'evaluateBtpSettlement'>);
      return { matched: positive(result.retentionCents), adjustmentCents: result.retentionCents };
    },
  },
} as const satisfies Record<string, ProjectionLine>;
export type VectorOperation = keyof typeof VECTOR_PROJECTIONS;
const OPERATION_NAMES = Object.keys(VECTOR_PROJECTIONS) as [VectorOperation, ...VectorOperation[]];

// ------------------------------------------------------------------ schéma des vecteurs

const VECTOR_SCHEMA = z.strictObject({
  role: z.enum(CONTRADICTORY_VECTOR_ROLES),
  operation: z.enum(OPERATION_NAMES),
  /** Entrée du moteur SANS `ruleCode` : injecté depuis l'AST de la règle candidate. */
  input: z.record(z.string(), z.unknown()).refine((value) => !Object.keys(value).includes('ruleCode'), { message: 'ruleCode est injecté par le compilateur' }),
  expected: z.strictObject({ matched: z.boolean(), adjustmentCents: z.int() }),
});
type ParsedVector = z.infer<typeof VECTOR_SCHEMA>;

export interface VectorEvaluation {
  readonly index: number;
  readonly role: ContradictoryVectorRole;
  readonly operation: string;
  readonly matched: boolean;
  readonly adjustmentCents: number;
  readonly expectedMatched: boolean;
  readonly expectedAdjustmentCents: number;
  readonly passed: boolean;
}

export interface ContradictoryVectorsReport {
  readonly check: 'EVALUATED';
  readonly vectorEvaluations: readonly VectorEvaluation[];
}

function describeIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`).join(' ; ');
}

function label(index: number, role: string): string {
  return `vecteur[${index}]:${role}`;
}

/** Le moteur n'évalue que les lignes ACTIVE : le bac à sable en mémoire en reçoit une copie, jamais renvoyée à l'appelant. */
export function sandboxEngine(row: RuleRow): DynamicFiscalAstEngine {
  try {
    return DynamicFiscalAstEngine.fromRows([{ ...row, status: 'ACTIVE' }]);
  } catch (error) {
    if (error instanceof FiscalAstError) {
      throw new WikiCompilerError('AST_INVALID', error.detail, [], error.code);
    }
    throw error;
  }
}

function readAst(row: RuleRow): { readonly kind: RuleKind; readonly ruleCode: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(row.rule_ast_json);
  } catch {
    raw = undefined;
  }
  const parsed = DYNAMIC_FISCAL_RULE_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    throw new WikiCompilerError('AST_INVALID', `rule_ast_json refusé par rule-ast — ${describeIssues(parsed.error.issues)}`);
  }
  return { kind: parsed.data.kind, ruleCode: parsed.data.rule_code };
}

/**
 * Évalue les vecteurs contre l'AST de la ligne par le moteur et applique les rejets (a) à (f). Ordre : (a) nombre,
 * forme des vecteurs, (b) rôles, (c) entrées distinctes, évaluation réelle, (d) matched non uniforme, (e) égalité exacte
 * avec `expected`, (f) sémantique des rôles. Échec fermé : le premier motif rencontré lève AST_CONTRADICTORY_VECTORS_INVALID.
 *
 * Choix pour (c) : l'entrée est comparée par son JSON canonique (clés triées à tout niveau, sans espaces ; canonicalJson),
 * pour que { a, b } et { b, a } soient la même entrée alors que JSON.stringify seul les distinguerait.
 */
export function evaluateContradictoryVectors(row: RuleRow, rawVectors: unknown): ContradictoryVectorsReport {
  const ast = readAst(row);
  const engine = sandboxEngine(row);
  const received: readonly unknown[] = Array.isArray(rawVectors) ? rawVectors : [];
  if (received.length < CONTRADICTORY_VECTORS_MIN) {
    throw rejectVectors(CONTRADICTORY_VECTOR_REJECTIONS.COUNT_BELOW_MIN, `${received.length} vecteur(s) fournis, ${CONTRADICTORY_VECTORS_MIN} au moins exigés (un par rôle : ${ALL_ROLES.join(', ')}).`);
  }

  const vectors: ParsedVector[] = [];
  const malformed: CaseOutcome[] = [];
  received.forEach((raw, index) => {
    const parsed = VECTOR_SCHEMA.safeParse(raw);
    if (!parsed.success) {
      malformed.push({ caseId: label(index, '?'), passed: false, detail: `vecteur mal formé — ${describeIssues(parsed.error.issues)}` });
      return;
    }
    const line: ProjectionLine = VECTOR_PROJECTIONS[parsed.data.operation];
    if (line.kind !== ast.kind) {
      malformed.push({ caseId: label(index, parsed.data.role), passed: false, detail: `l'opération ${parsed.data.operation} évalue ${line.kind}, la règle est ${ast.kind}.` });
      return;
    }
    vectors.push(parsed.data);
  });
  if (malformed.length > 0) {
    throw rejectVectors(CONTRADICTORY_VECTOR_REJECTIONS.VECTOR_MALFORMED, `${malformed.length} vecteur(s) mal formé(s) sur ${received.length}.`, malformed);
  }

  const present = new Set<ContradictoryVectorRole>(vectors.map((vector) => vector.role));
  const missing = ALL_ROLES.filter((role) => !present.has(role));
  if (missing.length > 0) {
    throw rejectVectors(CONTRADICTORY_VECTOR_REJECTIONS.ROLE_MISSING, `rôle(s) absent(s) : ${missing.join(', ')}.`);
  }

  const seen = new Map<string, number>();
  vectors.forEach((vector, index) => {
    let key: string;
    try {
      key = canonicalJson(vector.input);
    } catch (error) {
      throw rejectVectors(CONTRADICTORY_VECTOR_REJECTIONS.VECTOR_MALFORMED, `${label(index, vector.role)} : entrée non canonisable (${error instanceof Error ? error.message : String(error)}).`);
    }
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      throw rejectVectors(CONTRADICTORY_VECTOR_REJECTIONS.DUPLICATE_INPUT, `les vecteurs ${earlier} et ${index} ont la même entrée (JSON canonique, clés triées).`);
    }
    seen.set(key, index);
  });

  const evaluations: VectorEvaluation[] = [];
  const refused: CaseOutcome[] = [];
  vectors.forEach((vector, index) => {
    const line: ProjectionLine = VECTOR_PROJECTIONS[vector.operation];
    let projected: ProjectedResult | undefined;
    try {
      projected = line.run(engine, { ...vector.input, ruleCode: ast.ruleCode });
    } catch (error) {
      if (error instanceof FiscalAstError && line.refusalMeansNoMatch.includes(error.code)) {
        projected = { matched: false, adjustmentCents: 0 };
      } else if (error instanceof FiscalAstError) {
        refused.push({ caseId: label(index, vector.role), passed: false, detail: `le moteur refuse l'entrée : ${error.code}.` });
      } else {
        throw error;
      }
    }
    if (projected !== undefined) {
      evaluations.push({
        index,
        role: vector.role,
        operation: vector.operation,
        matched: projected.matched,
        adjustmentCents: projected.adjustmentCents,
        expectedMatched: vector.expected.matched,
        expectedAdjustmentCents: vector.expected.adjustmentCents,
        passed: projected.matched === vector.expected.matched && projected.adjustmentCents === vector.expected.adjustmentCents,
      });
    }
  });
  if (refused.length > 0) {
    throw rejectVectors(CONTRADICTORY_VECTOR_REJECTIONS.ENGINE_REFUSED, `${refused.length} vecteur(s) refusé(s) par le moteur.`, refused);
  }

  const outcomes = (): CaseOutcome[] =>
    evaluations.map((entry) => ({
      caseId: label(entry.index, entry.role),
      passed: entry.passed,
      detail: `calculé matched=${String(entry.matched)}, ${entry.adjustmentCents} centimes ; attendu matched=${String(entry.expectedMatched)}, ${entry.expectedAdjustmentCents} centimes.`,
    }));

  const first = evaluations[0];
  if (first !== undefined && evaluations.every((entry) => entry.matched === first.matched)) {
    throw rejectVectors(CONTRADICTORY_VECTOR_REJECTIONS.ALL_SAME_MATCHED, `tous les résultats ont matched=${String(first.matched)} : la règle n'est pas discriminante.`, outcomes());
  }
  const diverging = evaluations.filter((entry) => !entry.passed);
  if (diverging.length > 0) {
    throw rejectVectors(
      CONTRADICTORY_VECTOR_REJECTIONS.EXPECTED_DIVERGENCE,
      `${diverging.length} vecteur(s) divergent de expected : ${diverging.map((entry) => label(entry.index, entry.role)).join(', ')}.`,
      outcomes(),
    );
  }
  const violations = evaluations.flatMap((entry) => {
    if (entry.role === CONTRADICTORY_VECTOR_ROLES.POSITIVE_NOMINAL && !entry.matched) {
      return [`${label(entry.index, entry.role)} devrait avoir matched=true`];
    }
    if (entry.role === CONTRADICTORY_VECTOR_ROLES.NEGATIVE_COUNTEREXAMPLE && (entry.matched || entry.adjustmentCents !== 0)) {
      return [`${label(entry.index, entry.role)} devrait avoir matched=false et 0 centime d'ajustement`];
    }
    return [];
  });
  if (violations.length > 0) {
    throw rejectVectors(CONTRADICTORY_VECTOR_REJECTIONS.ROLE_SEMANTICS_VIOLATED, `${violations.join(' ; ')}.`, outcomes());
  }
  return { check: 'EVALUATED', vectorEvaluations: evaluations };
}
