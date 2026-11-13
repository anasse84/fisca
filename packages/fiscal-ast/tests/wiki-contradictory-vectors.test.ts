import { describe, expect, it } from 'vitest';
import {
  CONTRADICTION_CHECK_STATUS,
  CONTRADICTORY_VECTOR_REJECTIONS,
  CONTRADICTORY_VECTOR_ROLES,
  CONTRADICTORY_VECTORS_MIN,
  VECTOR_PROJECTIONS,
  WIKI_COMPILER_ERROR_CODES,
  WikiCompilerError,
  compileWikiRule,
  evaluateContradictoryVectors,
  promoteToActive,
  promoteToShadowObserve,
  type CompiledRuleCandidate,
} from '../src/index.ts';
import { CODES } from './helpers/rule-fixtures.ts';
import {
  aeJustAboveThreshold,
  aeVectors,
  cashCap,
  cashInputForTtc,
  cashJustAboveBoundary,
  cashVectors,
  delayJustAfterDue,
  delayPenaltyVectors,
  delayStatusVectors,
  goldenCashInput,
  rasVectors,
  vatVectors,
  type TestVector,
} from './helpers/vector-fixtures.ts';
import { FIXTURE_CREATED_AT, aeSource, asText, cashSource, delaySource, rasSource, vatSource, type WikiSourceObject } from './helpers/wiki-fixtures.ts';

const { POSITIVE_NOMINAL, NEGATIVE_COUNTEREXAMPLE, BOUNDARY_LIMIT } = CONTRADICTORY_VECTOR_ROLES;
const CODE = 'AST_CONTRADICTORY_VECTORS_INVALID';
/** Montant non entier (donnée de test) : lu depuis un texte pour ne contenir aucun littéral décimal arithmétique. */
const NON_INTEGER_AMOUNT = Number('1.5');

function compile(source: WikiSourceObject, ruleId: string): Promise<CompiledRuleCandidate> {
  return compileWikiRule({ wikiSourceText: asText(source), ruleId, createdAtIso: FIXTURE_CREATED_AT });
}

function rejection(action: () => unknown): WikiCompilerError {
  try {
    action();
  } catch (error) {
    if (error instanceof WikiCompilerError) {
      return error;
    }
    throw error;
  }
  throw new Error('vecteurs acceptés alors qu\'un rejet était attendu');
}

function expectRejected(action: () => unknown, reason: string): WikiCompilerError {
  const error = rejection(action);
  expect(error.code).toBe(CODE);
  expect(error.message.startsWith(`${CODE}:`)).toBe(true);
  expect(error.detail.startsWith(`[${reason}]`), error.detail).toBe(true);
  return error;
}

function withVector(list: readonly TestVector[], index: number, patch: Partial<TestVector>): TestVector[] {
  return list.map((entry, position) => (position === index ? { ...entry, ...patch } : entry));
}

function shiftExpected(entry: TestVector, matched: boolean, adjustmentDelta: number): TestVector {
  return { ...entry, expected: { matched, adjustmentCents: entry.expected.adjustmentCents + adjustmentDelta } };
}

describe('constantes : rôles et codes', () => {
  it('une seule table de rôles, trois rôles, minimum de 3 vecteurs', () => {
    expect(CONTRADICTORY_VECTOR_ROLES).toEqual({
      POSITIVE_NOMINAL: CONTRADICTORY_VECTOR_ROLES.POSITIVE_NOMINAL,
      NEGATIVE_COUNTEREXAMPLE: CONTRADICTORY_VECTOR_ROLES.NEGATIVE_COUNTEREXAMPLE,
      BOUNDARY_LIMIT: CONTRADICTORY_VECTOR_ROLES.BOUNDARY_LIMIT,
    });
    expect(Object.keys(CONTRADICTORY_VECTOR_ROLES)).toEqual(['POSITIVE_NOMINAL', 'NEGATIVE_COUNTEREXAMPLE', 'BOUNDARY_LIMIT']);
    expect(CONTRADICTORY_VECTORS_MIN).toBe(3);
  });

  it('le code AST_CONTRADICTORY_VECTORS_INVALID est dans WIKI_COMPILER_ERROR_CODES', () => {
    expect(WIKI_COMPILER_ERROR_CODES).toContain(CODE);
  });

  it('la table de projection couvre chaque opération du moteur par une ligne justifiée', () => {
    expect(Object.keys(VECTOR_PROJECTIONS).sort()).toEqual(
      [
        'evaluateAutoEntrepreneurThreshold',
        'evaluateBtpSettlement',
        'evaluateCashCeiling',
        'evaluateCashCeilingSequence',
        'evaluatePaymentDelayPenalty',
        'evaluatePaymentDelayStatus',
        'evaluateRasTva',
        'evaluateVatRate',
      ].sort(),
    );
    for (const line of Object.values(VECTOR_PROJECTIONS)) {
      expect(line.matchedFrom.length).toBeGreaterThan(0);
      expect(line.adjustmentFrom.length).toBeGreaterThan(0);
      expect(line.justification.length).toBeGreaterThan(0);
    }
  });

  it('le contrôle n\'est plus « non évalué » : CONTRADICTION_CHECK_STATUS vaut EVALUATED', () => {
    expect(CONTRADICTION_CHECK_STATUS).toBe('EVALUATED');
  });
});

describe('(a) moins de 3 vecteurs : rejet', () => {
  it('0, 1 et 2 vecteurs, ou autre chose qu\'une liste', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    for (const count of [0, 1, 2]) {
      expectRejected(() => evaluateContradictoryVectors(row, pool.slice(0, count)), CONTRADICTORY_VECTOR_REJECTIONS.COUNT_BELOW_MIN);
    }
    expectRejected(() => evaluateContradictoryVectors(row, undefined), CONTRADICTORY_VECTOR_REJECTIONS.COUNT_BELOW_MIN);
    expectRejected(() => evaluateContradictoryVectors(row, 'trois vecteurs'), CONTRADICTORY_VECTOR_REJECTIONS.COUNT_BELOW_MIN);
  });
});

describe('(b) un des 3 rôles manque : rejet', () => {
  it('chaque rôle absent, remplacé par un doublon de rôle', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    for (const missing of [0, 1, 2]) {
      const replacement = missing === 0 ? NEGATIVE_COUNTEREXAMPLE : POSITIVE_NOMINAL;
      const list = withVector(pool, missing, { role: replacement });
      const error = expectRejected(() => evaluateContradictoryVectors(row, list), CONTRADICTORY_VECTOR_REJECTIONS.ROLE_MISSING);
      expect(error.detail).toContain(Object.values(CONTRADICTORY_VECTOR_ROLES)[missing] ?? '');
    }
  });

  it('un rôle inconnu est un vecteur mal formé', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    expectRejected(() => evaluateContradictoryVectors(row, withVector(cashVectors(), 0, { role: 'EXTRA' })), CONTRADICTORY_VECTOR_REJECTIONS.VECTOR_MALFORMED);
  });
});

describe('(c) deux vecteurs de même entrée : rejet (JSON canonique, clés triées)', () => {
  it('entrée identique', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    const first = pool[0];
    if (first === undefined) {
      throw new Error('fixture vide');
    }
    const list = withVector(pool, 2, { input: { ...first.input } });
    expectRejected(() => evaluateContradictoryVectors(row, list), CONTRADICTORY_VECTOR_REJECTIONS.DUPLICATE_INPUT);
  });

  it('mêmes clés dans un autre ordre : toujours la même entrée (JSON.stringify seul y échapperait)', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    const first = pool[0];
    if (first === undefined) {
      throw new Error('fixture vide');
    }
    const reordered = Object.fromEntries(Object.entries(first.input).reverse());
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(first.input));
    expectRejected(() => evaluateContradictoryVectors(row, withVector(pool, 1, { input: reordered })), CONTRADICTORY_VECTOR_REJECTIONS.DUPLICATE_INPUT);
  });

  it('l\'ordre des clés d\'un objet imbriqué ne masque pas non plus le doublon', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    const nestedA = { invoices: [{ paymentDateIso: '2026-11-13', invoiceHtCents: 1, invoiceVatCents: 0, vatRateBps: 0 }] };
    const nestedB = { invoices: [{ vatRateBps: 0, invoiceVatCents: 0, invoiceHtCents: 1, paymentDateIso: '2026-11-13' }] };
    const list = [
      { ...(pool[0] as TestVector), operation: 'evaluateCashCeilingSequence', input: nestedA },
      { ...(pool[1] as TestVector), operation: 'evaluateCashCeilingSequence', input: nestedB },
      pool[2] as TestVector,
    ];
    expectRejected(() => evaluateContradictoryVectors(row, list), CONTRADICTORY_VECTOR_REJECTIONS.DUPLICATE_INPUT);
  });
});

describe('(d) tous les résultats ont le même matched : rejet', () => {
  it('tous matched true, attendus cohérents avec le moteur', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const over = (extra: number): TestVector => ({
      role: POSITIVE_NOMINAL,
      operation: 'evaluateCashCeiling',
      input: cashInputForTtc(cashCap() + extra),
      expected: { matched: true, adjustmentCents: extra },
    });
    const list: TestVector[] = [
      over(1),
      { ...over(2), role: NEGATIVE_COUNTEREXAMPLE },
      { ...over(3), role: BOUNDARY_LIMIT },
    ];
    expectRejected(() => evaluateContradictoryVectors(row, list), CONTRADICTORY_VECTOR_REJECTIONS.ALL_SAME_MATCHED);
  });

  it('tous matched false, attendus cohérents avec le moteur', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const under = (ttc: number, role: string): TestVector => ({ role, operation: 'evaluateCashCeiling', input: cashInputForTtc(ttc), expected: { matched: false, adjustmentCents: 0 } });
    const list = [under(cashCap() - 1, POSITIVE_NOMINAL), under(cashCap() - 2, NEGATIVE_COUNTEREXAMPLE), under(cashCap(), BOUNDARY_LIMIT)];
    expectRejected(() => evaluateContradictoryVectors(row, list), CONTRADICTORY_VECTOR_REJECTIONS.ALL_SAME_MATCHED);
  });
});

describe('(e) un résultat calculé diverge de expected : rejet, à un centime près', () => {
  it('+1 centime d\'ajustement attendu', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    const first = pool[0] as TestVector;
    const error = expectRejected(() => evaluateContradictoryVectors(row, withVector(pool, 0, shiftExpected(first, true, 1))), CONTRADICTORY_VECTOR_REJECTIONS.EXPECTED_DIVERGENCE);
    expect(error.caseOutcomes.some((outcome) => !outcome.passed)).toBe(true);
  });

  it('-1 centime d\'ajustement attendu', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    const first = pool[0] as TestVector;
    expectRejected(() => evaluateContradictoryVectors(row, withVector(pool, 0, shiftExpected(first, true, -1))), CONTRADICTORY_VECTOR_REJECTIONS.EXPECTED_DIVERGENCE);
  });

  it('matched attendu inversé', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    const boundary = pool[2] as TestVector;
    expectRejected(() => evaluateContradictoryVectors(row, withVector(pool, 2, shiftExpected(boundary, true, 0))), CONTRADICTORY_VECTOR_REJECTIONS.EXPECTED_DIVERGENCE);
  });

  it('un attendu non entier (flottant) est un vecteur mal formé, jamais arrondi', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    expectRejected(() => evaluateContradictoryVectors(row, withVector(pool, 0, { expected: { matched: true, adjustmentCents: NON_INTEGER_AMOUNT } })), CONTRADICTORY_VECTOR_REJECTIONS.VECTOR_MALFORMED);
  });

  it('au point de base près : taux RAS-TVA, une retenue décalée d\'un centime', async () => {
    const { row } = await compile(rasSource(), 'R-RAS');
    const pool = rasVectors();
    const boundary = pool[2] as TestVector;
    expectRejected(() => evaluateContradictoryVectors(row, withVector(pool, 2, shiftExpected(boundary, true, 1))), CONTRADICTORY_VECTOR_REJECTIONS.EXPECTED_DIVERGENCE);
  });
});

describe('(f) rôles : POSITIVE_NOMINAL doit matcher, NEGATIVE_COUNTEREXAMPLE ne doit pas matcher et ajuster 0 centime', () => {
  it('POSITIVE_NOMINAL qui ne matche pas (attendu cohérent avec le moteur)', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    const positiveBelowCap: TestVector = { role: POSITIVE_NOMINAL, operation: 'evaluateCashCeiling', input: cashInputForTtc(cashCap() - 1), expected: { matched: false, adjustmentCents: 0 } };
    const list = [positiveBelowCap, pool[1] as TestVector, cashJustAboveBoundary()];
    const error = expectRejected(() => evaluateContradictoryVectors(row, list), CONTRADICTORY_VECTOR_REJECTIONS.ROLE_SEMANTICS_VIOLATED);
    expect(error.detail).toContain(POSITIVE_NOMINAL);
  });

  it('NEGATIVE_COUNTEREXAMPLE qui matche et ajuste (attendu cohérent avec le moteur)', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    const negativeOverCap: TestVector = { role: NEGATIVE_COUNTEREXAMPLE, operation: 'evaluateCashCeiling', input: cashInputForTtc(cashCap() + 5), expected: { matched: true, adjustmentCents: 5 } };
    const list = [pool[0] as TestVector, negativeOverCap, pool[2] as TestVector];
    const error = expectRejected(() => evaluateContradictoryVectors(row, list), CONTRADICTORY_VECTOR_REJECTIONS.ROLE_SEMANTICS_VIOLATED);
    expect(error.detail).toContain(NEGATIVE_COUNTEREXAMPLE);
  });

  it('NEGATIVE_COUNTEREXAMPLE : matched true sans ajustement (surplus d\'un centime, retenue 0) reste un rejet', async () => {
    const { row } = await compile(aeSource(), 'R-AE');
    const pool = aeVectors();
    const negative = { ...aeJustAboveThreshold(), role: NEGATIVE_COUNTEREXAMPLE };
    const list = [pool[0] as TestVector, negative, pool[2] as TestVector];
    expectRejected(() => evaluateContradictoryVectors(row, list), CONTRADICTORY_VECTOR_REJECTIONS.ROLE_SEMANTICS_VIOLATED);
  });
});

describe('BOUNDARY_LIMIT : pile sur la borne, le vecteur prouve le sens de l\'opérateur', () => {
  it('espèces : 500 000 centimes (borne, plafond atteint non dépassé) contre 500 001 (1 centime d\'excédent)', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    expect(cashCap()).toBe(500000);
    const report = evaluateContradictoryVectors(row, [...cashVectors(), cashJustAboveBoundary()]);
    const boundaries = report.vectorEvaluations.filter((entry) => entry.role === BOUNDARY_LIMIT);
    expect(boundaries.map((entry) => [entry.matched, entry.adjustmentCents])).toEqual([[false, 0], [true, 1]]);
  });

  it('espèces : affirmer qu\'à 500 000 le plafond est dépassé (sens large) est rejeté', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    const wrongSense: TestVector = { role: BOUNDARY_LIMIT, operation: 'evaluateCashCeiling', input: cashInputForTtc(cashCap()), expected: { matched: true, adjustmentCents: 0 } };
    expectRejected(() => evaluateContradictoryVectors(row, withVector(pool, 2, wrongSense)), CONTRADICTORY_VECTOR_REJECTIONS.EXPECTED_DIVERGENCE);
  });

  it('69-21 : le jour pile de l\'échéance n\'est pas en retard, le lendemain si', async () => {
    const { row } = await compile(delaySource(), 'R-DELAY');
    const report = evaluateContradictoryVectors(row, [...delayStatusVectors(), delayJustAfterDue()]);
    const boundaries = report.vectorEvaluations.filter((entry) => entry.role === BOUNDARY_LIMIT);
    expect(boundaries.map((entry) => entry.matched)).toEqual([false, true]);
  });
});

describe('cas valides complets, valeurs issues des vecteurs d\'or de qa-harness', () => {
  it('espèces Art. 11-II (VEC-CGI-01) : excédent de 220 000 centimes, borne 500 000 contre 500 001', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const report = evaluateContradictoryVectors(row, [...cashVectors(), cashJustAboveBoundary()]);
    expect(report.vectorEvaluations).toHaveLength(4);
    expect(report.vectorEvaluations[0]).toMatchObject({ role: POSITIVE_NOMINAL, matched: true, adjustmentCents: 220000 });
    expect(report.vectorEvaluations[1]).toMatchObject({ role: NEGATIVE_COUNTEREXAMPLE, matched: false, adjustmentCents: 0 });
  });

  it('délai 69-21 (VEC-CGI-02) : statut au jour pile de l\'échéance, et pénalité de 44 500 centimes', async () => {
    const { row } = await compile(delaySource(), 'R-DELAY');
    expect(evaluateContradictoryVectors(row, delayStatusVectors()).vectorEvaluations.map((entry) => entry.matched)).toEqual([true, false, false]);
    const penalty = evaluateContradictoryVectors(row, delayPenaltyVectors());
    expect(penalty.vectorEvaluations[0]).toMatchObject({ matched: true, adjustmentCents: 44500 });
  });

  it('RAS-TVA (VEC-CGI-03) : retenue de 150 000 centimes, borne GTE incluse', async () => {
    const { row } = await compile(rasSource(), 'R-RAS');
    const report = evaluateContradictoryVectors(row, rasVectors());
    expect(report.vectorEvaluations[0]).toMatchObject({ matched: true, adjustmentCents: 150000 });
    expect(report.vectorEvaluations.map((entry) => entry.matched)).toEqual([true, false, true]);
  });

  it('auto-entrepreneur (VEC-CGI-04) : retenue de 210 000 centimes, seuil pile puis +1 centime', async () => {
    const { row } = await compile(aeSource(), 'R-AE');
    const report = evaluateContradictoryVectors(row, [...aeVectors(), aeJustAboveThreshold()]);
    expect(report.vectorEvaluations[0]).toMatchObject({ matched: true, adjustmentCents: 210000 });
    expect(report.vectorEvaluations.slice(2).map((entry) => [entry.matched, entry.adjustmentCents])).toEqual([[false, 0], [true, 0]]);
  });

  it('TVA (VEC-CGI-05) : taux autorisé, taux refusé, date = date d\'effet', async () => {
    const { row } = await compile(vatSource(), 'R-VAT');
    const report = evaluateContradictoryVectors(row, vatVectors());
    expect(report.vectorEvaluations.map((entry) => entry.matched)).toEqual([true, false, true]);
    expect(CODES.VAT.length).toBeGreaterThan(0);
  });
});

describe('déterminisme, divergence d\'un centime, données', () => {
  it('même règle, mêmes vecteurs : même rapport, deux fois', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const first = evaluateContradictoryVectors(row, cashVectors());
    const second = evaluateContradictoryVectors(row, cashVectors());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second).toEqual(first);
  });

  it('un vecteur à un seul centime de divergence fait rejeter la promotion de bout en bout', async () => {
    const candidate = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    const shifted = withVector(pool, 0, shiftExpected(pool[0] as TestVector, true, 1));
    expectRejected(() => promoteToShadowObserve(candidate, LEGACY_CASES, shifted), CONTRADICTORY_VECTOR_REJECTIONS.EXPECTED_DIVERGENCE);
    expect(promoteToShadowObserve(candidate, LEGACY_CASES, pool).row.status).toBe('SHADOW_OBSERVE');
  });

  it('les vecteurs sont des données : une chaîne de code dans une entrée n\'est jamais exécutée, elle est refusée par le moteur', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    const pool = cashVectors();
    const hostile = { ...(pool[1] as TestVector), input: { ...goldenCashInput(), paymentDateIso: 'process.exit(1)' } };
    expectRejected(() => evaluateContradictoryVectors(row, withVector(pool, 1, hostile)), CONTRADICTORY_VECTOR_REJECTIONS.ENGINE_REFUSED);
  });

  it('une opération qui ne vise pas le genre de la règle est un vecteur mal formé', async () => {
    const { row } = await compile(cashSource(), 'R-CASH');
    expectRejected(() => evaluateContradictoryVectors(row, withVector(cashVectors(), 1, { operation: 'evaluateBtpSettlement' })), CONTRADICTORY_VECTOR_REJECTIONS.VECTOR_MALFORMED);
    expectRejected(() => evaluateContradictoryVectors(row, withVector(cashVectors(), 1, { operation: 'eval' })), CONTRADICTORY_VECTOR_REJECTIONS.VECTOR_MALFORMED);
  });
});

const LEGACY_CASES = [
  { case_id: 'L-1', label: 'dépassement : valeurs d\'or', operation: 'evaluateCashCeiling', input: goldenCashInput(), expect: { outcome: 'VALUE', fields: { allowedTtcCents: cashCap() } } },
  { case_id: 'L-2', label: 'avant l\'effet', operation: 'evaluateCashCeiling', input: { ...goldenCashInput(), paymentDateIso: '2025-12-31' }, expect: { outcome: 'REFUSAL', error_code: 'RULE_NOT_IN_FORCE' } },
  { case_id: 'L-3', label: 'montant négatif', operation: 'evaluateCashCeiling', input: { ...goldenCashInput(), invoiceHtCents: -1 }, expect: { outcome: 'REFUSAL', error_code: 'INPUT_INVALID' } },
];

describe('la promotion applique le contrôle à toute sortie de PENDING_ADMIN_APPROVAL', () => {
  it('sans vecteurs, ou avec 2 vecteurs : refusée (SHADOW_OBSERVE)', async () => {
    const candidate = await compile(cashSource(), 'R-CASH');
    expectRejected(() => promoteToShadowObserve(candidate, LEGACY_CASES, undefined), CONTRADICTORY_VECTOR_REJECTIONS.COUNT_BELOW_MIN);
    expectRejected(() => promoteToShadowObserve(candidate, LEGACY_CASES, cashVectors().slice(0, 2)), CONTRADICTORY_VECTOR_REJECTIONS.COUNT_BELOW_MIN);
  });

  it('acceptée : le résultat porte EVALUATED et le détail des vecteurs évalués', async () => {
    const candidate = await compile(cashSource(), 'R-CASH');
    const promoted = promoteToShadowObserve(candidate, LEGACY_CASES, cashVectors());
    expect(promoted.contradictionCheck).toBe('EVALUATED');
    expect(promoted.vectorEvaluations.map((entry) => entry.role)).toEqual([POSITIVE_NOMINAL, NEGATIVE_COUNTEREXAMPLE, BOUNDARY_LIMIT]);
    expect(promoted.vectorEvaluations.every((entry) => entry.passed)).toBe(true);
  });

  it('promotion déterministe : deux promotions identiques donnent le même résultat', async () => {
    const candidate = await compile(cashSource(), 'R-CASH');
    const first = promoteToShadowObserve(candidate, LEGACY_CASES, cashVectors());
    const second = promoteToShadowObserve(candidate, LEGACY_CASES, cashVectors());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('le passage à ACTIVE ne contourne pas le contrôle', () => {
  it('ACTIVE accepté pour un résultat de promotion validé', async () => {
    const candidate = await compile(cashSource(), 'R-CASH');
    const promoted = promoteToShadowObserve(candidate, LEGACY_CASES, cashVectors());
    const active = promoteToActive(promoted);
    expect(active.row.status).toBe('ACTIVE');
    expect(active.row).toEqual({ ...candidate.row, status: 'ACTIVE' });
    expect(active.vectorEvaluations).toEqual(promoted.vectorEvaluations);
  });

  it('refusé pour un résultat forgé à la main, même identique champ pour champ', async () => {
    const candidate = await compile(cashSource(), 'R-CASH');
    const promoted = promoteToShadowObserve(candidate, LEGACY_CASES, cashVectors());
    const forged = { ...promoted, row: { ...promoted.row }, vectorEvaluations: [...promoted.vectorEvaluations] };
    expectRejected(() => promoteToActive(forged), CONTRADICTORY_VECTOR_REJECTIONS.NOT_VALIDATED);
    expectRejected(() => promoteToActive({ ...promoted, vectorEvaluations: [] }), CONTRADICTORY_VECTOR_REJECTIONS.NOT_VALIDATED);
  });

  it('refusé depuis PENDING_ADMIN_APPROVAL ou ACTIVE (FSM)', async () => {
    const candidate = await compile(cashSource(), 'R-CASH');
    const promoted = promoteToShadowObserve(candidate, LEGACY_CASES, cashVectors());
    const pending = { ...promoted, row: { ...promoted.row, status: 'PENDING_ADMIN_APPROVAL' as const } };
    expect(rejection(() => promoteToActive(pending)).code).toBe('FSM_TRANSITION_REFUSED');
    const active = promoteToActive(promoted);
    expect(rejection(() => promoteToActive(active)).code).toBe('FSM_TRANSITION_REFUSED');
  });
});
