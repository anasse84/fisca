import { describe, expect, it } from 'vitest';
import {
  ADVERSARIAL_CASES_MIN,
  WikiCompilerError,
  compileWikiRule,
  promoteToShadowObserve,
  type CompiledRuleCandidate,
  type WikiCompilerErrorCode,
} from '../src/index.ts';
import { CODES, GOLDEN_FILE, firstCase, readNumber } from './helpers/rule-fixtures.ts';
import { FIXTURE_CREATED_AT, asText, cashSource, vatSource } from './helpers/wiki-fixtures.ts';

/**
 * Cas de test = DONNÉES (opération, entrée, sortie attendue), interprétées par le moteur : jamais de code évalué.
 * Valeurs issues du vecteur d'or VEC-CGI-01 ; les cas de refus visent des erreurs typées du moteur.
 */
function goldenCashInput(): Record<string, number | string> {
  const input = firstCase('VEC-CGI-01').input;
  return {
    paymentDateIso: GOLDEN_FILE.ruleDate,
    invoiceHtCents: readNumber(input, 'invoiceHtCents'),
    invoiceVatCents: readNumber(input, 'invoiceVatCents'),
    vatRateBps: readNumber(input, 'vatRateBps'),
    alreadyPaidCashTodayCents: readNumber(input, 'alreadyPaidCashTodayTtcCents'),
    alreadyPaidCashMonthCents: readNumber(input, 'alreadyPaidCashMonthTtcCents'),
  };
}

function expectedCash(): Record<string, number> {
  const expected = firstCase('VEC-CGI-01').expected;
  return Object.fromEntries(Object.entries(expected).flatMap(([key, value]) => (typeof value === 'number' ? [[key, value]] : [])));
}

const VALUE_CASE = {
  case_id: 'CASE-VALUE',
  label: 'dépassement du plafond journalier : valeurs d\'or',
  operation: 'evaluateCashCeiling',
  input: goldenCashInput(),
  expect: { outcome: 'VALUE', fields: expectedCash() },
};

const REFUSAL_BEFORE_EFFECT = {
  case_id: 'CASE-BEFORE-EFFECT',
  label: 'paiement avant la date d\'effet : règle non en vigueur',
  operation: 'evaluateCashCeiling',
  input: { ...goldenCashInput(), paymentDateIso: '2025-12-31' },
  expect: { outcome: 'REFUSAL', error_code: 'RULE_NOT_IN_FORCE' },
};

const REFUSAL_NEGATIVE = {
  case_id: 'CASE-NEGATIVE',
  label: 'montant négatif refusé',
  operation: 'evaluateCashCeiling',
  input: { ...goldenCashInput(), invoiceHtCents: -1 },
  expect: { outcome: 'REFUSAL', error_code: 'INPUT_INVALID' },
};

const REFUSAL_VAT_1400 = {
  case_id: 'CASE-VAT-1400',
  label: 'TVA à 1400 bps refusée en 2026 (D-04)',
  operation: 'evaluateCashCeiling',
  input: { ...goldenCashInput(), vatRateBps: 1400 },
  expect: { outcome: 'REFUSAL', error_code: 'ADR_04_LF2026_VAT_VIOLATION' },
};

async function cashCandidate(): Promise<CompiledRuleCandidate> {
  return compileWikiRule({ wikiSourceText: asText(cashSource()), ruleId: 'R-CASH', createdAtIso: FIXTURE_CREATED_AT });
}

function refusal(action: () => unknown): WikiCompilerError {
  try {
    action();
  } catch (error) {
    if (error instanceof WikiCompilerError) {
      return error;
    }
    throw error;
  }
  throw new Error('promotion acceptée alors qu\'un refus était attendu');
}

function expectRefusal(action: () => unknown, code: WikiCompilerErrorCode): WikiCompilerError {
  const error = refusal(action);
  expect(error.code).toBe(code);
  expect(error.message.startsWith(`${code}:`)).toBe(true);
  return error;
}

describe('promotion vers SHADOW_OBSERVE : exigence des 3 cas exécutés contre le moteur', () => {
  it('le minimum est de 3 cas', () => {
    expect(ADVERSARIAL_CASES_MIN).toBe(3);
  });

  it('refusée avec 0, 1 et 2 cas : erreur typée qui liste les cas reçus', async () => {
    const candidate = await cashCandidate();
    const pool = [VALUE_CASE, REFUSAL_BEFORE_EFFECT, REFUSAL_NEGATIVE];
    for (const count of [0, 1, 2]) {
      const error = expectRefusal(() => promoteToShadowObserve(candidate, pool.slice(0, count)), 'PROMOTION_CASES_INSUFFICIENT');
      expect(error.caseOutcomes.map((outcome) => outcome.caseId)).toEqual(pool.slice(0, count).map((c) => c.case_id));
      expect(error.message).toContain(String(count));
    }
  });

  it('refusée si les cas ne sont pas une liste, ou si un cas est mal formé', async () => {
    const candidate = await cashCandidate();
    expectRefusal(() => promoteToShadowObserve(candidate, 'trois cas'), 'PROMOTION_CASES_INSUFFICIENT');
    expectRefusal(() => promoteToShadowObserve(candidate, [VALUE_CASE, REFUSAL_BEFORE_EFFECT, { ...REFUSAL_NEGATIVE, extra: 1 }]), 'PROMOTION_CASE_INVALID');
    expectRefusal(() => promoteToShadowObserve(candidate, [VALUE_CASE, REFUSAL_BEFORE_EFFECT, { ...REFUSAL_NEGATIVE, operation: 'eval' }]), 'PROMOTION_CASE_INVALID');
    expectRefusal(
      () => promoteToShadowObserve(candidate, [VALUE_CASE, REFUSAL_BEFORE_EFFECT, { ...REFUSAL_NEGATIVE, input: { ...goldenCashInput(), ruleCode: 'AUTRE' } }]),
      'PROMOTION_CASE_INVALID',
    );
  });

  it('refusée si un identifiant de cas est répété (trois fois le même cas ne font pas trois cas)', async () => {
    const candidate = await cashCandidate();
    expectRefusal(() => promoteToShadowObserve(candidate, [VALUE_CASE, VALUE_CASE, VALUE_CASE]), 'PROMOTION_CASE_INVALID');
  });

  it('refusée si l\'opération d\'un cas ne vise pas le genre de la règle', async () => {
    const candidate = await cashCandidate();
    const wrongKind = { ...REFUSAL_NEGATIVE, operation: 'evaluateBtpSettlement' };
    expectRefusal(() => promoteToShadowObserve(candidate, [VALUE_CASE, REFUSAL_BEFORE_EFFECT, wrongKind]), 'PROMOTION_CASE_INVALID');
  });

  it('refusée avec un cas qui échoue : la valeur attendue diffère d\'un centime', async () => {
    const candidate = await cashCandidate();
    const expected = expectedCash();
    const key = Object.keys(expected)[0] ?? '';
    const current = expected[key] ?? 0;
    const failing = { ...VALUE_CASE, case_id: 'CASE-OFF-BY-ONE', expect: { outcome: 'VALUE', fields: { ...expected, [key]: current + 1 } } };
    const error = expectRefusal(() => promoteToShadowObserve(candidate, [failing, REFUSAL_BEFORE_EFFECT, REFUSAL_NEGATIVE]), 'PROMOTION_CASE_FAILED');
    const byId = new Map(error.caseOutcomes.map((outcome) => [outcome.caseId, outcome]));
    expect(byId.get('CASE-OFF-BY-ONE')?.passed).toBe(false);
    expect(byId.get('CASE-OFF-BY-ONE')?.detail).toContain(key);
    expect(byId.get('CASE-BEFORE-EFFECT')?.passed).toBe(true);
    expect(byId.get('CASE-NEGATIVE')?.passed).toBe(true);
  });

  it('refusée si un cas de refus ne refuse pas, ou refuse avec un autre code', async () => {
    const candidate = await cashCandidate();
    const notRefused = { ...REFUSAL_BEFORE_EFFECT, case_id: 'CASE-NOT-REFUSED', input: goldenCashInput() };
    const error = expectRefusal(() => promoteToShadowObserve(candidate, [VALUE_CASE, notRefused, REFUSAL_NEGATIVE]), 'PROMOTION_CASE_FAILED');
    expect(error.caseOutcomes.find((o) => o.caseId === 'CASE-NOT-REFUSED')?.passed).toBe(false);
    const wrongCode = { ...REFUSAL_NEGATIVE, case_id: 'CASE-WRONG-CODE', expect: { outcome: 'REFUSAL', error_code: 'RULE_GAP' } };
    const second = expectRefusal(() => promoteToShadowObserve(candidate, [VALUE_CASE, REFUSAL_BEFORE_EFFECT, wrongCode]), 'PROMOTION_CASE_FAILED');
    expect(second.caseOutcomes.find((o) => o.caseId === 'CASE-WRONG-CODE')?.detail).toContain('INPUT_INVALID');
  });

  it('acceptée avec 3 cas valides : ligne SHADOW_OBSERVE, source et état de vérification conservés', async () => {
    const candidate = await cashCandidate();
    const promoted = promoteToShadowObserve(candidate, [VALUE_CASE, REFUSAL_BEFORE_EFFECT, REFUSAL_NEGATIVE]);
    expect(promoted.row.status).toBe('SHADOW_OBSERVE');
    expect(promoted.row).toEqual({ ...candidate.row, status: 'SHADOW_OBSERVE' });
    expect(promoted.sourceSha256).toBe(candidate.sourceSha256);
    expect(promoted.verificationState).toBe('RECOUPÉ');
    expect(promoted.caseOutcomes).toHaveLength(3);
    expect(promoted.caseOutcomes.every((outcome) => outcome.passed)).toBe(true);
    expect(candidate.row.status).toBe('PENDING_ADMIN_APPROVAL');
  });

  it('acceptée avec plus de 3 cas ; jamais ACTIVE', async () => {
    const candidate = await cashCandidate();
    const promoted = promoteToShadowObserve(candidate, [VALUE_CASE, REFUSAL_BEFORE_EFFECT, REFUSAL_NEGATIVE, REFUSAL_VAT_1400]);
    expect(promoted.row.status).toBe('SHADOW_OBSERVE');
    expect(promoted.caseOutcomes).toHaveLength(4);
  });

  it('exécute vraiment le moteur : une règle modifiée change le verdict d\'un cas de valeur', async () => {
    const other = await compileWikiRule({
      wikiSourceText: asText(cashSource()).replace(/"daily_cap_cents":\d+/, '"daily_cap_cents":1'),
      ruleId: 'R-OTHER',
      createdAtIso: FIXTURE_CREATED_AT,
    });
    expectRefusal(() => promoteToShadowObserve(other, [VALUE_CASE, REFUSAL_BEFORE_EFFECT, REFUSAL_NEGATIVE]), 'PROMOTION_CASE_FAILED');
  });

  it('refusée si la ligne n\'est pas PENDING_ADMIN_APPROVAL (FSM) ou si la ligne est altérée', async () => {
    const candidate = await cashCandidate();
    const cases = [VALUE_CASE, REFUSAL_BEFORE_EFFECT, REFUSAL_NEGATIVE];
    for (const status of ['SHADOW_OBSERVE', 'ACTIVE', 'SUPERSEDED'] as const) {
      expectRefusal(() => promoteToShadowObserve({ ...candidate, row: { ...candidate.row, status } }, cases), 'FSM_TRANSITION_REFUSED');
    }
    expectRefusal(() => promoteToShadowObserve({ ...candidate, row: { ...candidate.row, rule_ast_json: '{}' } }, cases), 'AST_INVALID');
  });

  it('les cas sont des données : une chaîne de code dans un cas n\'est jamais exécutée', async () => {
    const candidate = await cashCandidate();
    const hostile = { ...REFUSAL_NEGATIVE, case_id: 'CASE-HOSTILE', input: { ...goldenCashInput(), paymentDateIso: 'process.exit(1)' }, expect: { outcome: 'REFUSAL', error_code: 'DATE_INVALID' } };
    const promoted = promoteToShadowObserve(candidate, [VALUE_CASE, REFUSAL_BEFORE_EFFECT, hostile]);
    expect(promoted.row.status).toBe('SHADOW_OBSERVE');
  });

  it('couvre les autres opérations du moteur (liste de TVA : refus de date, valeur, refus de taux)', async () => {
    const candidate = await compileWikiRule({ wikiSourceText: asText(vatSource()), ruleId: 'R-VAT', createdAtIso: FIXTURE_CREATED_AT });
    const vatCases = [
      { case_id: 'V-1', label: 'avant l\'effet', operation: 'evaluateVatRate', input: { issueDateIso: '2025-12-31', vatRateBps: 2000 }, expect: { outcome: 'REFUSAL', error_code: 'RULE_NOT_IN_FORCE' } },
      { case_id: 'V-2', label: '1400 bps en 2026', operation: 'evaluateVatRate', input: { issueDateIso: GOLDEN_FILE.ruleDate, vatRateBps: 1400 }, expect: { outcome: 'REFUSAL', error_code: 'ADR_04_LF2026_VAT_VIOLATION' } },
      { case_id: 'V-3', label: 'taux listé', operation: 'evaluateVatRate', input: { issueDateIso: GOLDEN_FILE.ruleDate, vatRateBps: 2000 }, expect: { outcome: 'VALUE', fields: { vatRateBps: 2000 } } },
    ];
    expect(promoteToShadowObserve(candidate, vatCases).row.status).toBe('SHADOW_OBSERVE');
    expect(CODES.VAT.length).toBeGreaterThan(0);
  });
});
