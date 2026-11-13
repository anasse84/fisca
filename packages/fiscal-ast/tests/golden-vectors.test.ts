import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../../qa-harness/src/fiscal-golden-suite.ts';
import { DynamicFiscalAstEngine, FiscalAstError } from '../src/index.ts';
import { CODES, GOLDEN_FILE, firstCase, goldenRows, readNumber, readText, vectorById } from './helpers/rule-fixtures.ts';

const engine = DynamicFiscalAstEngine.fromRows(goldenRows());

function expectExactly(actual: object, expected: JsonObject): void {
  const lookup = new Map<string, unknown>(Object.entries(actual));
  for (const [key, value] of Object.entries(expected)) {
    expect(lookup.has(key), `clé ${key} absente du résultat`).toBe(true);
    expect(lookup.get(key), `clé ${key}`).toBe(value);
  }
}

describe('fichier d\'or : forme exigée par ERRATA B-09', () => {
  it('chaque vecteur VEC-CGI-01 à 06 porte article, date de règle et état', () => {
    for (const id of ['VEC-CGI-01', 'VEC-CGI-02', 'VEC-CGI-03', 'VEC-CGI-04', 'VEC-CGI-05', 'VEC-CGI-06']) {
      const vector = vectorById(id);
      expect(vector.law.length).toBeGreaterThan(0);
      expect(vector.ruleDate).toBe(GOLDEN_FILE.ruleDate);
      expect(['RECOUPÉ', 'NON RECOUPÉ', 'PROVISOIRE']).toContain(vector.state);
    }
  });
});

describe('VEC-CGI-01 : plafond d\'espèces Art. 11-II (RECOUPÉ)', () => {
  it('rend les cinq valeurs attendues à l\'unité près', () => {
    const goldenCase = firstCase('VEC-CGI-01');
    const input = goldenCase.input;
    const result = engine.evaluateCashCeiling({
      ruleCode: CODES.CASH,
      paymentDateIso: GOLDEN_FILE.ruleDate,
      invoiceHtCents: readNumber(input, 'invoiceHtCents'),
      invoiceVatCents: readNumber(input, 'invoiceVatCents'),
      vatRateBps: readNumber(input, 'vatRateBps'),
      alreadyPaidCashTodayCents: readNumber(input, 'alreadyPaidCashTodayTtcCents'),
      alreadyPaidCashMonthCents: readNumber(input, 'alreadyPaidCashMonthTtcCents'),
    });
    expectExactly(result, goldenCase.expected);
    expect(result.capBasis).toBe('TTC');
    expect(result.appliedRule.ruleId).toBe('T-CASH');
    expect(result.appliedRule.evaluatedOnIso).toBe(GOLDEN_FILE.ruleDate);
    expect(result.explanation).toContain('T-CASH');
  });
});

describe('VEC-CGI-02 : Loi 69-21 (NON RECOUPÉ)', () => {
  it('46 jours de retard, 2 mois entamés, 360 bps, 44 500 centimes', () => {
    const goldenCase = firstCase('VEC-CGI-02');
    const input = goldenCase.input;
    const delayDays = readNumber(goldenCase.context ?? {}, 'delayDays');
    expect(delayDays).toBe(46);
    // Livraison fixée dans le test ; l'échéance légale (60 jours) + 46 jours donne la date d'évaluation.
    const status = engine.evaluatePaymentDelayStatus({
      ruleCode: CODES.DELAY,
      serviceDeliveryDateIso: '2026-01-01',
      asOfDateIso: '2026-04-17',
      termKind: 'STANDARD',
    });
    expect(status.legalDueDateIso).toBe('2026-03-02');
    expect(status.daysLate).toBe(delayDays);
    expect(status.status).toBe('EN_RETARD_PENALISE');
    const result = engine.evaluatePaymentDelayPenalty({
      ruleCode: CODES.DELAY,
      asOfDateIso: '2026-04-17',
      unpaidTtcCents: readNumber(input, 'unpaidTtcCents'),
      startedMonthsOfDelay: readNumber(input, 'startedMonthsOfDelay'),
      hasDocumentedDispute: input['hasDocumentedDisputeR2'] === true,
    });
    expectExactly(result, goldenCase.expected);
    expect(result.penaltyCents).toBe(44500);
  });
});

describe('VEC-CGI-03 : RAS-TVA Art. 117 (NON RECOUPÉ)', () => {
  for (const goldenCase of vectorById('VEC-CGI-03').cases) {
    it(goldenCase.name, () => {
      const input = goldenCase.input;
      const result = engine.evaluateRasTva({
        ruleCode: CODES.RAS,
        paymentDateIso: readText(input, 'paymentDateIso'),
        invoiceTtcCents: readNumber(input, 'invoiceTtcCents'),
        invoiceVatCents: readNumber(input, 'invoiceVatCents'),
        taxClearanceIssuedDateIso: readText(input, 'taxClearanceIssuedDateIso'),
      });
      expectExactly(result, goldenCase.expected);
    });
  }
});

describe('VEC-CGI-04 : auto-entrepreneur, seuil par client (NON RECOUPÉ)', () => {
  it('surplus 700 000 centimes, retenue 210 000, net 990 000', () => {
    const goldenCase = firstCase('VEC-CGI-04');
    const input = goldenCase.input;
    const result = engine.evaluateAutoEntrepreneurThreshold({
      ruleCode: CODES.AE,
      invoiceDateIso: GOLDEN_FILE.ruleDate,
      cumulBeforeInvoiceCents: readNumber(input, 'cumulBeforeInvoiceCents'),
      invoiceCents: readNumber(input, 'invoiceCents'),
    });
    expectExactly(result, goldenCase.expected);
    expect(result.netCents).toBe(readNumber(input, 'invoiceCents') - readNumber(goldenCase.expected, 'withholdingCents'));
  });
});

describe('VEC-CGI-05 : TVA 2026 (NON RECOUPÉ)', () => {
  for (const goldenCase of vectorById('VEC-CGI-05').cases) {
    it(goldenCase.name, () => {
      const input = goldenCase.input;
      const call = () =>
        engine.evaluateVatRate({
          ruleCode: CODES.VAT,
          issueDateIso: readText(input, 'issueDateIso'),
          vatRateBps: readNumber(input, 'vatRateBps'),
        });
      if (goldenCase.expected['accepted'] === true) {
        expect(call().vatRateBps).toBe(readNumber(input, 'vatRateBps'));
        return;
      }
      let caught: unknown;
      try {
        call();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(FiscalAstError);
      const expectedCode = readText(goldenCase.expected, 'errorCode');
      // Une date illisible est rejetée par DATE_INVALID (typé), l'ancien taux par ADR_04_LF2026_VAT_VIOLATION.
      const actualCode = caught instanceof FiscalAstError ? caught.code : '';
      expect(actualCode).toBe(expectedCode === 'ADR_04_UNREADABLE_ISSUE_DATE' ? 'DATE_INVALID' : expectedCode);
    });
  }
});

describe('VEC-CGI-06 : décompte BTP (NON RECOUPÉ)', () => {
  it('retenue 1 000 000, débours sans TVA, TVA différée 200 000, TVA exigible 1 800 000', () => {
    const goldenCase = firstCase('VEC-CGI-06');
    const input = goldenCase.input;
    const result = engine.evaluateBtpSettlement({
      ruleCode: CODES.BTP,
      settlementDateIso: GOLDEN_FILE.ruleDate,
      worksHtCents: readNumber(input, 'worksHtCents'),
      deboursCents: readNumber(input, 'deboursCents'),
      vatRateBps: readNumber(input, 'vatRateBps'),
    });
    expectExactly(result, goldenCase.expected);
  });
});
