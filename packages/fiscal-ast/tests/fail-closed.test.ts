import { describe, expect, it } from 'vitest';
import { DynamicFiscalAstEngine, FiscalAstError, type RuleRow } from '../src/index.ts';
import { CODES, aeAst, cashAst, cashParamsFromGolden, delayAst, delayParamsFromGolden, goldenRows, makeRow, rasAst, rasParamsFromGolden, vatAst, vatRatesFromGolden, aeParamsFromGolden } from './helpers/rule-fixtures.ts';

const engine = DynamicFiscalAstEngine.fromRows(goldenRows());

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof FiscalAstError ? error.code : `AUTRE:${String(error)}`;
  }
  return 'AUCUNE_ERREUR';
}

const goodCash = {
  ruleCode: CODES.CASH,
  paymentDateIso: '2026-07-01',
  invoiceHtCents: 1000,
  invoiceVatCents: 200,
  vatRateBps: 2000,
  alreadyPaidCashTodayCents: 0,
  alreadyPaidCashMonthCents: 0,
};

function rowWithAst(ast: object): RuleRow {
  return makeRow(ast, { rule_id: 'X' });
}

describe('entrées : montant non entier, négatif, absent, hors forme', () => {
  const bad: readonly [string, unknown][] = [
    ['flottant', 100.5],
    ['négatif', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['texte', '100'],
    ['entier non sûr', Number.MAX_SAFE_INTEGER + 1],
    ['null', null],
  ];
  for (const [label, value] of bad) {
    it(`invoiceHtCents ${label} : INPUT_INVALID`, () => {
      expect(codeOf(() => engine.evaluateCashCeiling({ ...goodCash, invoiceHtCents: value as number }))).toBe('INPUT_INVALID');
    });
  }

  it('champ absent : INPUT_INVALID', () => {
    const incomplete: Record<string, unknown> = { ...goodCash };
    delete incomplete['alreadyPaidCashMonthCents'];
    expect(codeOf(() => engine.evaluateCashCeiling(incomplete as typeof goodCash))).toBe('INPUT_INVALID');
  });

  it('champ inconnu : INPUT_INVALID (schéma strict)', () => {
    expect(codeOf(() => engine.evaluateCashCeiling({ ...goodCash, plafondParDefaut: 1 } as typeof goodCash))).toBe('INPUT_INVALID');
  });

  it('tous les évaluateurs refusent les montants négatifs', () => {
    expect(codeOf(() => engine.evaluateRasTva({ ruleCode: CODES.RAS, paymentDateIso: '2026-07-01', invoiceTtcCents: -1, invoiceVatCents: 0 }))).toBe('INPUT_INVALID');
    expect(codeOf(() => engine.evaluateAutoEntrepreneurThreshold({ ruleCode: CODES.AE, invoiceDateIso: '2026-07-01', cumulBeforeInvoiceCents: -1, invoiceCents: 0 }))).toBe('INPUT_INVALID');
    expect(codeOf(() => engine.evaluatePaymentDelayPenalty({ ruleCode: CODES.DELAY, asOfDateIso: '2026-07-01', unpaidTtcCents: -5, startedMonthsOfDelay: 1, hasDocumentedDispute: false }))).toBe('INPUT_INVALID');
    expect(codeOf(() => engine.evaluatePaymentDelayPenalty({ ruleCode: CODES.DELAY, asOfDateIso: '2026-07-01', unpaidTtcCents: 5, startedMonthsOfDelay: -1, hasDocumentedDispute: false }))).toBe('INPUT_INVALID');
    expect(codeOf(() => engine.evaluateBtpSettlement({ ruleCode: CODES.BTP, settlementDateIso: '2026-07-01', worksHtCents: -1, deboursCents: 0, vatRateBps: 2000 }))).toBe('INPUT_INVALID');
    expect(codeOf(() => engine.evaluateVatRate({ ruleCode: CODES.VAT, issueDateIso: '2026-07-01', vatRateBps: 2000, baseHtCents: -1 }))).toBe('INPUT_INVALID');
  });

  it('dates illisibles : DATE_INVALID', () => {
    for (const date of ['', 'abc', '26-02-01', '2026-13-45', '2026-02-30', '2026-2-1']) {
      expect(codeOf(() => engine.evaluateCashCeiling({ ...goodCash, paymentDateIso: date }))).toBe('DATE_INVALID');
    }
  });
});

describe('TVA 2026 : taux hors liste', () => {
  it('1400 et 700 bps refusés dès 2026 (ADR_04_LF2026_VAT_VIOLATION), pour la TVA comme pour les autres évaluateurs', () => {
    for (const rate of [1400, 700, 1, 2001, 9999]) {
      expect(codeOf(() => engine.evaluateVatRate({ ruleCode: CODES.VAT, issueDateIso: '2026-02-01', vatRateBps: rate }))).toBe('ADR_04_LF2026_VAT_VIOLATION');
      expect(codeOf(() => engine.evaluateCashCeiling({ ...goodCash, vatRateBps: rate }))).toBe('ADR_04_LF2026_VAT_VIOLATION');
      expect(codeOf(() => engine.evaluateBtpSettlement({ ruleCode: CODES.BTP, settlementDateIso: '2026-02-01', worksHtCents: 1, deboursCents: 0, vatRateBps: rate }))).toBe('ADR_04_LF2026_VAT_VIOLATION');
    }
  });

  it('un taux de la loi mais absent de la règle en vigueur : VAT_RATE_NOT_ALLOWED', () => {
    const [firstRate] = vatRatesFromGolden();
    const narrow = DynamicFiscalAstEngine.fromRows([makeRow(vatAst(firstRate === undefined ? [] : [firstRate]), { rule_id: 'V' })]);
    const other = vatRatesFromGolden().find((rate) => rate !== firstRate) ?? -1;
    expect(codeOf(() => narrow.evaluateVatRate({ ruleCode: CODES.VAT, issueDateIso: '2026-07-01', vatRateBps: other }))).toBe('VAT_RATE_NOT_ALLOWED');
  });

  it('une ligne de règle TVA effective en 2026 qui liste un ancien taux est refusée à la construction', () => {
    expect(codeOf(() => DynamicFiscalAstEngine.fromRows([makeRow(vatAst([2000, 1400]), { effective_from: '2026-01-01' })]))).toBe('RULE_ROW_INVALID');
  });

  it('un exercice antérieur à 2026 peut porter ses propres taux (règle datée), sans jamais les convertir', () => {
    const history = DynamicFiscalAstEngine.fromRows([makeRow(vatAst([2000, 1400, 1000, 700, 0]), { rule_id: 'V25', effective_from: '2025-01-01', effective_to: '2025-12-31', status: 'SUPERSEDED' })]);
    expect(history.evaluateVatRate({ ruleCode: CODES.VAT, issueDateIso: '2025-06-30', vatRateBps: 1400 }).vatRateBps).toBe(1400);
    expect(codeOf(() => history.evaluateVatRate({ ruleCode: CODES.VAT, issueDateIso: '2026-01-01', vatRateBps: 1400 }))).toBe('ADR_04_LF2026_VAT_VIOLATION');
  });
});

describe('lignes de règle illisibles : RULE_ROW_INVALID, jamais de valeur par défaut', () => {
  const cash = cashParamsFromGolden();
  const cases: readonly [string, RuleRow][] = [
    ['JSON invalide', { ...rowWithAst(cashAst(cash)), rule_ast_json: '{' }],
    ['genre inconnu', rowWithAst({ ast_version: 1, rule_code: CODES.CASH, kind: 'INCONNU' })],
    ['plafond journalier absent', rowWithAst({ ast_version: 1, rule_code: CODES.CASH, kind: 'CASH_CEILING', monthly_cap: { node: 'CAP', period: 'MONTH', amount_cents: cash.monthlyCapCents } })],
    ['plafond mensuel absent', rowWithAst({ ast_version: 1, rule_code: CODES.CASH, kind: 'CASH_CEILING', daily_cap: { node: 'CAP', period: 'DAY', amount_cents: cash.dailyCapCents } })],
    ['plafond décimal', rowWithAst({ ...cashAst(cash), daily_cap: { node: 'CAP', period: 'DAY', amount_cents: Math.PI } })],
    ['plafond négatif', rowWithAst({ ...cashAst(cash), daily_cap: { node: 'CAP', period: 'DAY', amount_cents: -1 } })],
    ['plafond jour avec période mois', rowWithAst({ ...cashAst(cash), daily_cap: { node: 'CAP', period: 'MONTH', amount_cents: cash.dailyCapCents } })],
    ['base du plafond inconnue', rowWithAst({ ...cashAst(cash), cap_basis: 'TVA' })],
    ['clé inconnue', rowWithAst({ ...cashAst(cash), plafond_cache: 1 })],
    ['version d\'AST inconnue', rowWithAst({ ...cashAst(cash), ast_version: 2 })],
    ['taux supérieur à 100 %', rowWithAst(rasAst({ ...rasParamsFromGolden(), fullBps: 10001 }))],
    ['tranches non contiguës', rowWithAst({ ...aeAst(aeParamsFromGolden()), client_brackets: { node: 'BRACKETS', brackets: [{ from_cents: 0, up_to_cents: 10, rate_bps: 0 }, { from_cents: 11, up_to_cents: null, rate_bps: 5 }] } })],
    ['franchise à taux non nul', rowWithAst({ ...aeAst(aeParamsFromGolden()), client_brackets: { node: 'BRACKETS', brackets: [{ from_cents: 0, up_to_cents: 10, rate_bps: 1 }, { from_cents: 10, up_to_cents: null, rate_bps: 5 }] } })],
    ['dernière tranche fermée', rowWithAst({ ...aeAst(aeParamsFromGolden()), client_brackets: { node: 'BRACKETS', brackets: [{ from_cents: 0, up_to_cents: 10, rate_bps: 0 }, { from_cents: 10, up_to_cents: 20, rate_bps: 5 }] } })],
    ['arrondi de pénalité inconnu', rowWithAst({ ...delayAst(delayParamsFromGolden()), penalty_scale: { node: 'PENALTY_SCALE', additional_period_increment_bps: 1, rounding: 'AU_PIFOMETRE' } })],
    ['taux directeur absent', rowWithAst({ ast_version: 1, rule_code: CODES.DELAY, kind: 'PAYMENT_DELAY_PENALTY' })],
    ['validité d\'attestation en jours', rowWithAst({ ...rasAst(rasParamsFromGolden()), attestation_validity: { node: 'DURATION', unit: 'DAYS', count: 180 } })],
    ['effective_to avant effective_from', makeRow(cashAst(cash), { effective_from: '2026-05-01', effective_to: '2026-04-01' })],
    ['date de ligne impossible', makeRow(cashAst(cash), { effective_from: '2026-02-30' })],
  ];
  for (const [label, row] of cases) {
    it(label, () => {
      expect(codeOf(() => DynamicFiscalAstEngine.fromRows([row]))).toBe('RULE_ROW_INVALID');
    });
  }

  it('rule_id dupliqué : RULE_ROW_INVALID', () => {
    expect(codeOf(() => DynamicFiscalAstEngine.fromRows([rowWithAst(cashAst(cash)), rowWithAst(cashAst(cash))]))).toBe('RULE_ROW_INVALID');
  });

  it('cap_basis absent : TTC (seul défaut admis, ERRATA section E)', () => {
    const result = DynamicFiscalAstEngine.fromRows([rowWithAst(cashAst(cash))]).evaluateCashCeiling(goodCash);
    expect(result.capBasis).toBe('TTC');
  });
});

describe('aucun résultat sans règle', () => {
  it('moteur vide : chaque évaluateur échoue en RULE_NOT_FOUND', () => {
    const empty = DynamicFiscalAstEngine.fromRows([]);
    expect(codeOf(() => empty.evaluateCashCeiling(goodCash))).toBe('RULE_NOT_FOUND');
    expect(codeOf(() => empty.evaluateRasTva({ ruleCode: CODES.RAS, paymentDateIso: '2026-07-01', invoiceTtcCents: 1, invoiceVatCents: 1 }))).toBe('RULE_NOT_FOUND');
    expect(codeOf(() => empty.evaluateAutoEntrepreneurThreshold({ ruleCode: CODES.AE, invoiceDateIso: '2026-07-01', cumulBeforeInvoiceCents: 0, invoiceCents: 1 }))).toBe('RULE_NOT_FOUND');
    expect(codeOf(() => empty.evaluatePaymentDelayPenalty({ ruleCode: CODES.DELAY, asOfDateIso: '2026-07-01', unpaidTtcCents: 1, startedMonthsOfDelay: 1, hasDocumentedDispute: false }))).toBe('RULE_NOT_FOUND');
    expect(codeOf(() => empty.evaluateVatRate({ ruleCode: CODES.VAT, issueDateIso: '2026-07-01', vatRateBps: 2000 }))).toBe('RULE_NOT_FOUND');
    expect(codeOf(() => empty.evaluatePaymentDelayStatus({ ruleCode: CODES.DELAY, serviceDeliveryDateIso: '2026-01-01', asOfDateIso: '2026-07-01', termKind: 'STANDARD' }))).toBe('RULE_NOT_FOUND');
  });

  it('débordement : résultat hors entiers sûrs = ARITHMETIC_OVERFLOW', () => {
    const huge = DynamicFiscalAstEngine.fromRows([rowWithAst(delayAst(delayParamsFromGolden()))]);
    expect(codeOf(() => huge.evaluatePaymentDelayPenalty({ ruleCode: CODES.DELAY, asOfDateIso: '2026-07-01', unpaidTtcCents: Number.MAX_SAFE_INTEGER, startedMonthsOfDelay: 9000000000, hasDocumentedDispute: false }))).toBe('ARITHMETIC_OVERFLOW');
  });
});
