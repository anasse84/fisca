import { describe, expect, it } from 'vitest';
import { DynamicFiscalAstEngine, FiscalAstError, type FiscalRuleSource, type RuleRow } from '../src/index.ts';
import { CODES, cashAst, cashParamsFromGolden, makeRow, goldenRows } from './helpers/rule-fixtures.ts';

const caps = cashParamsFromGolden();
const OLD_MONTHLY = caps.monthlyCapCents;
const NEW_MONTHLY = OLD_MONTHLY + 1000000;


function cashAt(engine: DynamicFiscalAstEngine, dateIso: string) {
  return engine.evaluateCashCeiling({
    ruleCode: CODES.CASH,
    paymentDateIso: dateIso,
    invoiceHtCents: 100,
    invoiceVatCents: 20,
    vatRateBps: 2000,
    alreadyPaidCashTodayCents: 0,
    alreadyPaidCashMonthCents: 0,
  });
}

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof FiscalAstError ? error.code : `AUTRE:${String(error)}`;
  }
  return 'AUCUNE_ERREUR';
}

describe('sélection de la règle en vigueur à une date', () => {
  const rows: RuleRow[] = [
    makeRow(cashAst(caps), { rule_id: 'CASH-A', effective_from: '2026-01-01', effective_to: '2026-06-30', status: 'SUPERSEDED' }),
    makeRow(cashAst({ ...caps, monthlyCapCents: NEW_MONTHLY }), { rule_id: 'CASH-B', effective_from: '2026-07-01', effective_to: null }),
  ];
  const engine = DynamicFiscalAstEngine.fromRows(rows);

  it('change de règle au jour exact du changement', () => {
    expect(cashAt(engine, '2026-06-30').appliedRule.ruleId).toBe('CASH-A');
    expect(cashAt(engine, '2026-07-01').appliedRule.ruleId).toBe('CASH-B');
  });

  it('le premier jour et le dernier jour d\'une règle sont inclus', () => {
    expect(cashAt(engine, '2026-01-01').appliedRule.ruleId).toBe('CASH-A');
    expect(cashAt(engine, '2030-12-31').appliedRule.ruleId).toBe('CASH-B');
  });

  it('une règle remplacée (SUPERSEDED) reste lisible pour un exercice antérieur', () => {
    expect(cashAt(engine, '2026-03-15').appliedRule.status).toBe('SUPERSEDED');
  });

  it('la chronologie contiguë est valide', () => {
    expect(() => engine.validateTimeline(CODES.CASH)).not.toThrow();
  });

  it('avant la première règle : RULE_NOT_IN_FORCE', () => {
    expect(codeOf(() => cashAt(engine, '2025-12-31'))).toBe('RULE_NOT_IN_FORCE');
  });
});

describe('chevauchement et trou : erreurs typées, échec fermé', () => {
  it('chevauchement le jour même : RULE_OVERLAP', () => {
    const engine = DynamicFiscalAstEngine.fromRows([
      makeRow(cashAst(caps), { rule_id: 'A', effective_from: '2026-01-01', effective_to: '2026-07-01' }),
      makeRow(cashAst(caps), { rule_id: 'B', effective_from: '2026-07-01', effective_to: null }),
    ]);
    expect(codeOf(() => cashAt(engine, '2026-07-01'))).toBe('RULE_OVERLAP');
    expect(cashAt(engine, '2026-06-30').appliedRule.ruleId).toBe('A');
    expect(codeOf(() => engine.validateTimeline(CODES.CASH))).toBe('RULE_OVERLAP');
  });

  it('ancienne règle ouverte (effective_to nul) puis nouvelle : RULE_OVERLAP après la date de la nouvelle', () => {
    const engine = DynamicFiscalAstEngine.fromRows([
      makeRow(cashAst(caps), { rule_id: 'OPEN', effective_from: '2026-01-01', effective_to: null, status: 'SUPERSEDED' }),
      makeRow(cashAst(caps), { rule_id: 'NEW', effective_from: '2026-09-01', effective_to: null }),
    ]);
    expect(cashAt(engine, '2026-08-31').appliedRule.ruleId).toBe('OPEN');
    expect(codeOf(() => cashAt(engine, '2026-09-01'))).toBe('RULE_OVERLAP');
  });

  it('trou d\'un jour entre deux règles : RULE_GAP à la date du trou et dans la chronologie', () => {
    const engine = DynamicFiscalAstEngine.fromRows([
      makeRow(cashAst(caps), { rule_id: 'A', effective_from: '2026-01-01', effective_to: '2026-06-29' }),
      makeRow(cashAst(caps), { rule_id: 'B', effective_from: '2026-07-01', effective_to: null }),
    ]);
    expect(codeOf(() => cashAt(engine, '2026-06-30'))).toBe('RULE_GAP');
    expect(cashAt(engine, '2026-06-29').appliedRule.ruleId).toBe('A');
    expect(cashAt(engine, '2026-07-01').appliedRule.ruleId).toBe('B');
    expect(codeOf(() => engine.validateTimeline(CODES.CASH))).toBe('RULE_GAP');
  });

  it('règle terminée sans successeur : RULE_NOT_IN_FORCE après la fin', () => {
    const engine = DynamicFiscalAstEngine.fromRows([makeRow(cashAst(caps), { rule_id: 'A', effective_from: '2026-01-01', effective_to: '2026-06-30' })]);
    expect(codeOf(() => cashAt(engine, '2026-07-01'))).toBe('RULE_NOT_IN_FORCE');
  });

  it('code inconnu : RULE_NOT_FOUND', () => {
    const engine = DynamicFiscalAstEngine.fromRows(goldenRows());
    expect(codeOf(() => engine.evaluateCashCeiling({
      ruleCode: 'CODE_INCONNU',
      paymentDateIso: '2026-07-01',
      invoiceHtCents: 1,
      invoiceVatCents: 0,
      vatRateBps: 0,
      alreadyPaidCashTodayCents: 0,
      alreadyPaidCashMonthCents: 0,
    }))).toBe('RULE_NOT_FOUND');
    expect(codeOf(() => engine.validateTimeline('CODE_INCONNU'))).toBe('RULE_NOT_FOUND');
  });

  it('règle d\'un autre genre sous le même code : RULE_KIND_MISMATCH', () => {
    const engine = DynamicFiscalAstEngine.fromRows(goldenRows());
    expect(codeOf(() => engine.evaluateRasTva({ ruleCode: CODES.CASH, paymentDateIso: '2026-07-01', invoiceTtcCents: 1, invoiceVatCents: 1 }))).toBe('RULE_KIND_MISMATCH');
  });

  it('lignes PENDING_ADMIN_APPROVAL et SHADOW_OBSERVE ne sont jamais opposables', () => {
    for (const status of ['PENDING_ADMIN_APPROVAL', 'SHADOW_OBSERVE'] as const) {
      const engine = DynamicFiscalAstEngine.fromRows([makeRow(cashAst(caps), { rule_id: 'P', status })]);
      expect(codeOf(() => cashAt(engine, '2026-07-01'))).toBe('RULE_NOT_FOUND');
    }
  });

  it('une ligne non opposable à l\'AST illisible ne bloque pas les lignes actives', () => {
    const broken: RuleRow = { ...makeRow(cashAst(caps), { rule_id: 'BROKEN', status: 'PENDING_ADMIN_APPROVAL' }), rule_ast_json: '{pas du json' };
    const engine = DynamicFiscalAstEngine.fromRows([broken, makeRow(cashAst(caps), { rule_id: 'OK' })]);
    expect(cashAt(engine, '2026-07-01').appliedRule.ruleId).toBe('OK');
  });
});

describe('port FiscalRuleSource', () => {
  it('construit le moteur depuis une source injectée', async () => {
    const source: FiscalRuleSource = { listRuleRows: () => Promise.resolve(goldenRows()) };
    const engine = await DynamicFiscalAstEngine.fromSource(source);
    expect(cashAt(engine, '2026-07-01').appliedRule.ruleId).toBe('T-CASH');
  });

  it('une source qui échoue propage l\'échec (jamais de règles par défaut)', async () => {
    const source: FiscalRuleSource = { listRuleRows: () => Promise.reject(new Error('D1 indisponible')) };
    await expect(DynamicFiscalAstEngine.fromSource(source)).rejects.toThrow('D1 indisponible');
  });
});
