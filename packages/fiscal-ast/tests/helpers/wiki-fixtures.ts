import {
  aeParamsFromGolden,
  btpRetentionFromGolden,
  cashParamsFromGolden,
  delayParamsFromGolden,
  rasParamsFromGolden,
  vatRatesFromGolden,
  LEGAL_TERMS_DAYS,
  CODES,
} from './rule-fixtures.ts';

/**
 * Sources wiki de TEST : chaque valeur fiscale vient des vecteurs d'or (qa-harness, lecture seule) via rule-fixtures.
 * Les dates d'effet sont des dates de fixture, pas des valeurs de loi.
 */
export const FIXTURE_EFFECTIVE_FROM = '2026-01-01';
export const FIXTURE_CREATED_AT = '2026-11-13T09:00:00Z';

export type WikiSourceObject = Record<string, unknown>;

function envelope(slug: string, article: string, state: string, rule: Record<string, unknown>): WikiSourceObject {
  return {
    wiki_source_slug: slug,
    cgi_article_ref: article,
    effective_from: FIXTURE_EFFECTIVE_FROM,
    effective_to: null,
    target_scope: 'INVOICE_GLOBAL',
    verification_state: state,
    rule,
  };
}

export function vatSource(): WikiSourceObject {
  return envelope('wiki/tva-2026', 'LF 2026 (TVA)', 'NON RECOUPÉ', {
    kind: 'VAT_RATE_SET',
    rule_code: CODES.VAT,
    allowed_rates_bps: [...vatRatesFromGolden()],
  });
}

export function cashSource(): WikiSourceObject {
  const params = cashParamsFromGolden();
  return envelope('wiki/especes-art-11-ii', 'CGI art. 11-II', 'RECOUPÉ', {
    kind: 'CASH_CEILING',
    rule_code: CODES.CASH,
    cap_basis: 'TTC',
    daily_cap_cents: params.dailyCapCents,
    monthly_cap_cents: params.monthlyCapCents,
  });
}

export function rasSource(): WikiSourceObject {
  const params = rasParamsFromGolden();
  return envelope('wiki/ras-tva-art-117', 'CGI art. 117', 'NON RECOUPÉ', {
    kind: 'RAS_TVA',
    rule_code: CODES.RAS,
    applies_when_ttc_comparator: 'GTE',
    applies_when_ttc_bound_cents: params.thresholdCents,
    attestation_validity_months: params.validityMonths,
    reduced_rate_bps: params.reducedBps,
    full_rate_bps: params.fullBps,
  });
}

export function aeSource(): WikiSourceObject {
  const params = aeParamsFromGolden();
  return envelope('wiki/auto-entrepreneur', 'Régime auto-entrepreneur', 'NON RECOUPÉ', {
    kind: 'AUTO_ENTREPRENEUR_THRESHOLD',
    rule_code: CODES.AE,
    client_threshold_cents: params.thresholdCents,
    withholding_rate_bps: params.withholdingBps,
  });
}

export function delaySource(): WikiSourceObject {
  const params = delayParamsFromGolden();
  return envelope('wiki/loi-69-21', 'Loi 69-21', 'NON RECOUPÉ', {
    kind: 'PAYMENT_DELAY_PENALTY',
    rule_code: CODES.DELAY,
    base_rate_bps: params.baseRateBps,
    additional_period_increment_bps: params.incrementBps,
    rounding: 'CEIL_DIRHAM',
    legal_term_standard_days: LEGAL_TERMS_DAYS.standard,
    legal_term_contract_days: LEGAL_TERMS_DAYS.contract,
    legal_term_decree_days: LEGAL_TERMS_DAYS.decree,
  });
}

export function btpSource(): WikiSourceObject {
  return envelope('wiki/btp-decompte', 'Décompte BTP', 'PROVISOIRE', {
    kind: 'BTP_SETTLEMENT',
    rule_code: CODES.BTP,
    retention_rate_bps: btpRetentionFromGolden(),
  });
}

export function asText(source: WikiSourceObject): string {
  return JSON.stringify(source);
}

/** Copie de la source avec la règle modifiée (clés ajoutées ou remplacées). */
export function withRule(source: WikiSourceObject, patch: Record<string, unknown>): WikiSourceObject {
  const rule = source['rule'];
  if (typeof rule !== 'object' || rule === null) {
    throw new Error('source de test sans règle');
  }
  return { ...source, rule: { ...rule, ...patch } };
}

export function withoutKey(source: WikiSourceObject, key: string): WikiSourceObject {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}
