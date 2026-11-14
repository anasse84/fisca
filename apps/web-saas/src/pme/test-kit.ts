import type { FiscalRule, InvoiceDraft, InvoiceDraftOutcome, InvoiceDraftSink, InvoiceParty, TreasuryForecast, TreasuryPoint, VatRateOption } from './ports.ts';

/** Données de test seulement (non importées par le code de production). Aucune règle fiscale réelle n'y est supposée. */
export function makeForecast(days: number): TreasuryForecast {
  const points: TreasuryPoint[] = [];
  for (let i = 0; i < days; i += 1) {
    const past = i < 30;
    points.push({
      date: `2027-${String(1 + Math.trunc(i / 30)).padStart(2, '0')}-${String(1 + (i % 30)).padStart(2, '0')}`,
      settledCents: past ? 100000 + i * 5000 : null,
      forecastCents: past ? (i === 29 ? 245000 : null) : 245000 - (i - 29) * 7000,
      vatProvisionCents: i * 1200,
    });
  }
  return { asOfDate: '2027-01-30', horizonDays: days, points, vatDue: [{ dueDate: '2027-02-20', amountCents: 38400 }] };
}

export const RATES: readonly VatRateOption[] = [
  { rateBps: 2000, legalReasonCode: null },
  { rateBps: 1000, legalReasonCode: null },
  { rateBps: 0, legalReasonCode: 'EXO-TEST' },
];

export const ISSUER: InvoiceParty = {
  nameFr: 'Atlas Services SARL',
  nameAr: 'أطلس للخدمات ش.م.م',
  ice: '001234567000089',
  identifiantFiscal: '12345678',
  rcNumber: '45678',
  rcTribunal: 'Rabat',
  legalForm: 'SARL',
  shareCapitalCents: 10000000,
  addressAdc450: '12 avenue des FAR, Rabat',
};

export const RULES: readonly FiscalRule[] = [
  {
    ruleCode: 'CASH_CEILING',
    messageKey: 'ui.pme.rule.cashCeiling',
    severity: 'warning',
    effectiveDate: '2026-01-01',
    articleRef: 'réf. fournie par la table',
    params: { threshold: { kind: 'amountCents', value: 500000 } },
  },
  { ruleCode: 'RAS_EXPIRED', messageKey: 'ui.pme.rule.rasTvaExpired', severity: 'danger', effectiveDate: '2026-01-01' },
];

export function recordingSink(outcome: InvoiceDraftOutcome): InvoiceDraftSink & { readonly calls: InvoiceDraft[] } {
  const calls: InvoiceDraft[] = [];
  return {
    calls,
    saveDraft: async (draft) => {
      calls.push(draft);
      return outcome;
    },
  };
}
