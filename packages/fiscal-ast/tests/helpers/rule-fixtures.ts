import {
  loadGoldenVectorFile,
  type GoldenCase,
  type GoldenVector,
  type JsonObject,
} from '../../../qa-harness/src/fiscal-golden-suite.ts';
import type { RuleRow } from '../../src/index.ts';

/**
 * Lignes de règle de TEST : toutes les valeurs fiscales viennent du fichier de vecteurs d'or de qa-harness (lecture seule),
 * jamais d'un littéral du moteur. Les durées légales de la Loi 69-21 (Doc_02 § 06) sont les seules valeurs saisies ici.
 */
export const GOLDEN_FILE = loadGoldenVectorFile(new URL('../../../qa-harness/tests/golden/cgi.vectors.json', import.meta.url));

export function vectorById(id: string): GoldenVector {
  const found = GOLDEN_FILE.vectors.find((vector) => vector.id === id);
  if (found === undefined) {
    throw new Error(`vecteur ${id} absent du fichier d'or`);
  }
  return found;
}

export function firstCase(id: string): GoldenCase {
  const found = vectorById(id).cases[0];
  if (found === undefined) {
    throw new Error(`vecteur ${id} sans cas`);
  }
  return found;
}

export function readNumber(source: JsonObject, key: string): number {
  const value = source[key];
  if (typeof value !== 'number') {
    throw new Error(`clé numérique absente : ${key}`);
  }
  return value;
}

export function readText(source: JsonObject, key: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new Error(`clé texte absente : ${key}`);
  }
  return value;
}

export const RULE_DATE = GOLDEN_FILE.ruleDate;
export const CODES = {
  VAT: 'TEST_VAT_RATES',
  CASH: 'TEST_CASH_CEILING',
  RAS: 'TEST_RAS_TVA',
  AE: 'TEST_AE_THRESHOLD',
  DELAY: 'TEST_PAYMENT_DELAY',
  BTP: 'TEST_BTP_SETTLEMENT',
} as const;

/** Délais légaux de test (Doc_02 § 06 : standard, contrat, décret sectoriel). */
export const LEGAL_TERMS_DAYS = { standard: 60, contract: 120, decree: 180 } as const;

export interface RowOverrides {
  readonly rule_id?: string;
  readonly effective_from?: string;
  readonly effective_to?: string | null;
  readonly status?: RuleRow['status'];
}

export function makeRow(ast: object, overrides: RowOverrides = {}): RuleRow {
  return {
    rule_id: overrides.rule_id ?? `R-${JSON.stringify(ast).length}-${overrides.effective_from ?? 'x'}`,
    cgi_article_ref: 'ART-TEST',
    effective_from: overrides.effective_from ?? '2026-01-01',
    effective_to: overrides.effective_to === undefined ? null : overrides.effective_to,
    target_scope: 'INVOICE_GLOBAL',
    status: overrides.status ?? 'ACTIVE',
    rule_ast_json: JSON.stringify(ast),
    wiki_source_slug: 'test-fixture',
    created_at: '2026-01-01T00:00:00Z',
  };
}

export interface CashParams {
  readonly dailyCapCents: number;
  readonly monthlyCapCents: number;
  readonly capBasis?: 'TTC' | 'HT';
}

export function cashAst(params: CashParams, code: string = CODES.CASH): object {
  return {
    ast_version: 1,
    rule_code: code,
    kind: 'CASH_CEILING',
    ...(params.capBasis === undefined ? {} : { cap_basis: params.capBasis }),
    daily_cap: { node: 'CAP', period: 'DAY', amount_cents: params.dailyCapCents },
    monthly_cap: { node: 'CAP', period: 'MONTH', amount_cents: params.monthlyCapCents },
  };
}

export interface RasParams {
  readonly thresholdCents: number;
  readonly validityMonths: number;
  readonly reducedBps: number;
  readonly fullBps: number;
}

export function rasAst(params: RasParams, code: string = CODES.RAS): object {
  return {
    ast_version: 1,
    rule_code: code,
    kind: 'RAS_TVA',
    applies_when_ttc: { node: 'COMPARISON', comparator: 'GTE', bound_cents: params.thresholdCents },
    attestation_validity: { node: 'DURATION', unit: 'MONTHS', count: params.validityMonths },
    reduced_rate: { node: 'BPS_RATE', rate_bps: params.reducedBps },
    full_rate: { node: 'BPS_RATE', rate_bps: params.fullBps },
  };
}

export interface AeParams {
  readonly thresholdCents: number;
  readonly withholdingBps: number;
}

export function aeAst(params: AeParams, code: string = CODES.AE): object {
  return {
    ast_version: 1,
    rule_code: code,
    kind: 'AUTO_ENTREPRENEUR_THRESHOLD',
    client_brackets: {
      node: 'BRACKETS',
      brackets: [
        { from_cents: 0, up_to_cents: params.thresholdCents, rate_bps: 0 },
        { from_cents: params.thresholdCents, up_to_cents: null, rate_bps: params.withholdingBps },
      ],
    },
  };
}

export interface DelayParams {
  readonly baseRateBps: number;
  readonly incrementBps: number;
  readonly rounding?: 'CEIL_DIRHAM' | 'HALF_UP_CENT';
}

export function delayAst(params: DelayParams, code: string = CODES.DELAY): object {
  return {
    ast_version: 1,
    rule_code: code,
    kind: 'PAYMENT_DELAY_PENALTY',
    base_rate: { node: 'BPS_RATE', rate_bps: params.baseRateBps },
    penalty_scale: {
      node: 'PENALTY_SCALE',
      additional_period_increment_bps: params.incrementBps,
      rounding: params.rounding ?? 'CEIL_DIRHAM',
    },
    legal_terms: {
      standard: { node: 'DURATION', unit: 'DAYS', count: LEGAL_TERMS_DAYS.standard },
      contract: { node: 'DURATION', unit: 'DAYS', count: LEGAL_TERMS_DAYS.contract },
      decree: { node: 'DURATION', unit: 'DAYS', count: LEGAL_TERMS_DAYS.decree },
    },
  };
}

export function vatAst(allowedRatesBps: readonly number[], code: string = CODES.VAT): object {
  return { ast_version: 1, rule_code: code, kind: 'VAT_RATE_SET', rates: { node: 'RATE_SET', allowed_rates_bps: allowedRatesBps } };
}

export function btpAst(retentionBps: number, code: string = CODES.BTP): object {
  return { ast_version: 1, rule_code: code, kind: 'BTP_SETTLEMENT', retention_rate: { node: 'BPS_RATE', rate_bps: retentionBps } };
}

// ------------------------------------------------------------------ paramètres tirés des vecteurs d'or

export function cashParamsFromGolden(): CashParams {
  const input = firstCase('VEC-CGI-01').input;
  return { dailyCapCents: readNumber(input, 'dailyCapTtcCents'), monthlyCapCents: readNumber(input, 'monthlyCapTtcCents') };
}

export function rasParamsFromGolden(): RasParams {
  const input = firstCase('VEC-CGI-03').input;
  return {
    thresholdCents: readNumber(input, 'exclusionThresholdTtcCents'),
    validityMonths: readNumber(input, 'attestationValidityMonths'),
    reducedBps: readNumber(input, 'reducedRasRateBps'),
    fullBps: readNumber(input, 'fullRasRateBps'),
  };
}

export function aeParamsFromGolden(): AeParams {
  const input = firstCase('VEC-CGI-04').input;
  return { thresholdCents: readNumber(input, 'clientThresholdCents'), withholdingBps: readNumber(input, 'withholdingRateBps') };
}

export function delayParamsFromGolden(): DelayParams {
  const input = firstCase('VEC-CGI-02').input;
  return { baseRateBps: readNumber(input, 'bamBaseRateBps'), incrementBps: readNumber(input, 'monthlyIncrementBps') };
}

export function vatRatesFromGolden(): readonly number[] {
  const rates = new Set<number>();
  for (const goldenCase of vectorById('VEC-CGI-05').cases) {
    if (goldenCase.expected['accepted'] === true) {
      rates.add(readNumber(goldenCase.input, 'vatRateBps'));
    }
  }
  return [...rates];
}

export function btpRetentionFromGolden(): number {
  return readNumber(firstCase('VEC-CGI-06').input, 'retentionBps');
}

export function goldenRows(): RuleRow[] {
  return [
    makeRow(vatAst(vatRatesFromGolden()), { rule_id: 'T-VAT' }),
    makeRow(cashAst(cashParamsFromGolden()), { rule_id: 'T-CASH' }),
    makeRow(rasAst(rasParamsFromGolden()), { rule_id: 'T-RAS' }),
    makeRow(aeAst(aeParamsFromGolden()), { rule_id: 'T-AE' }),
    makeRow(delayAst(delayParamsFromGolden()), { rule_id: 'T-DELAY' }),
    makeRow(btpAst(btpRetentionFromGolden()), { rule_id: 'T-BTP' }),
  ];
}
