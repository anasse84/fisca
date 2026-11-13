import { applyBps, bps, centimes } from '@fisca/shared-types';
import { describe, expect, it } from 'vitest';
import {
  computeArt11CashSplit,
  computeAutoEntrepreneurSurplus,
  computeBtpSettlement,
  computeLaw6921Penalty,
  computeRasTva,
} from '../../qa-harness/src/fiscal-golden-suite.ts';
import { DynamicFiscalAstEngine } from '../src/index.ts';
import {
  CODES,
  GOLDEN_FILE,
  LEGAL_TERMS_DAYS,
  aeAst,
  aeParamsFromGolden,
  btpAst,
  btpRetentionFromGolden,
  cashAst,
  cashParamsFromGolden,
  delayAst,
  delayParamsFromGolden,
  firstCase,
  makeRow,
  rasAst,
  rasParamsFromGolden,
  readNumber,
  vatAst,
  vatRatesFromGolden,
} from './helpers/rule-fixtures.ts';

/**
 * Preuve d'absence de valeur en dur : une règle de test aux valeurs MODIFIÉES change la sortie, et la sortie suit
 * exactement la fonction de référence appelée avec ces mêmes valeurs modifiées.
 */
describe('une règle modifiée change la sortie (aucune valeur en dur)', () => {
  const date = GOLDEN_FILE.ruleDate;

  it('plafonds d\'espèces', () => {
    const base = cashParamsFromGolden();
    const input = firstCase('VEC-CGI-01').input;
    const run = (dailyCapCents: number, monthlyCapCents: number) => {
      const engine = DynamicFiscalAstEngine.fromRows([makeRow(cashAst({ dailyCapCents, monthlyCapCents }))]);
      const actual = engine.evaluateCashCeiling({
        ruleCode: CODES.CASH,
        paymentDateIso: date,
        invoiceHtCents: readNumber(input, 'invoiceHtCents'),
        invoiceVatCents: readNumber(input, 'invoiceVatCents'),
        vatRateBps: readNumber(input, 'vatRateBps'),
        alreadyPaidCashTodayCents: 0,
        alreadyPaidCashMonthCents: 0,
      });
      const reference = computeArt11CashSplit({
        invoiceHtCents: readNumber(input, 'invoiceHtCents'),
        invoiceVatCents: readNumber(input, 'invoiceVatCents'),
        vatRateBps: readNumber(input, 'vatRateBps'),
        alreadyPaidCashTodayTtcCents: 0,
        alreadyPaidCashMonthTtcCents: 0,
        dailyCapTtcCents: dailyCapCents,
        monthlyCapTtcCents: monthlyCapCents,
      });
      expect(actual.allowedTtcCents).toBe(reference.allowedTtcCents);
      expect(actual.deductibleHtCents).toBe(reference.deductibleHtCents);
      return actual.allowedTtcCents;
    };
    const original = run(base.dailyCapCents, base.monthlyCapCents);
    expect(run(base.dailyCapCents + 12345, base.monthlyCapCents)).toBe(original + 12345);
    expect(run(base.dailyCapCents, 1000)).toBe(1000);
    expect(run(base.dailyCapCents * 2, base.monthlyCapCents)).not.toBe(original);
  });

  it('RAS-TVA : taux, seuil et validité', () => {
    const base = rasParamsFromGolden();
    const input = firstCase('VEC-CGI-03').input;
    for (const params of [
      base,
      { ...base, reducedBps: base.reducedBps - 1000 },
      { ...base, fullBps: base.fullBps - 2500 },
      { ...base, thresholdCents: readNumber(input, 'invoiceTtcCents') + 1 },
      { ...base, validityMonths: 1 },
    ]) {
      const engine = DynamicFiscalAstEngine.fromRows([makeRow(rasAst(params))]);
      for (const issued of ['2026-02-15', '2025-11-15']) {
        const actual = engine.evaluateRasTva({ ruleCode: CODES.RAS, paymentDateIso: '2026-06-15', invoiceTtcCents: readNumber(input, 'invoiceTtcCents'), invoiceVatCents: readNumber(input, 'invoiceVatCents'), taxClearanceIssuedDateIso: issued });
        const reference = computeRasTva({
          invoiceTtcCents: readNumber(input, 'invoiceTtcCents'),
          invoiceVatCents: readNumber(input, 'invoiceVatCents'),
          paymentDateIso: '2026-06-15',
          taxClearanceIssuedDateIso: issued,
          exclusionThresholdTtcCents: params.thresholdCents,
          attestationValidityMonths: params.validityMonths,
          reducedRasRateBps: params.reducedBps,
          fullRasRateBps: params.fullBps,
        });
        expect({ rasRateBps: actual.rasRateBps, rasVatCents: actual.rasVatCents }).toEqual({ rasRateBps: reference.rasRateBps, rasVatCents: reference.rasVatCents });
      }
    }
    const belowThreshold = DynamicFiscalAstEngine.fromRows([makeRow(rasAst({ ...base, thresholdCents: readNumber(input, 'invoiceTtcCents') + 1 }))]);
    expect(belowThreshold.evaluateRasTva({ ruleCode: CODES.RAS, paymentDateIso: '2026-06-15', invoiceTtcCents: readNumber(input, 'invoiceTtcCents'), invoiceVatCents: readNumber(input, 'invoiceVatCents') }).rasVatCents).toBe(0);
  });

  it('auto-entrepreneur : seuil et taux de retenue', () => {
    const base = aeParamsFromGolden();
    const input = firstCase('VEC-CGI-04').input;
    for (const params of [base, { ...base, thresholdCents: base.thresholdCents - 400000 }, { ...base, withholdingBps: 1500 }]) {
      const engine = DynamicFiscalAstEngine.fromRows([makeRow(aeAst(params))]);
      const actual = engine.evaluateAutoEntrepreneurThreshold({ ruleCode: CODES.AE, invoiceDateIso: date, cumulBeforeInvoiceCents: readNumber(input, 'cumulBeforeInvoiceCents'), invoiceCents: readNumber(input, 'invoiceCents') });
      const reference = computeAutoEntrepreneurSurplus({ clientThresholdCents: params.thresholdCents, cumulBeforeInvoiceCents: readNumber(input, 'cumulBeforeInvoiceCents'), invoiceCents: readNumber(input, 'invoiceCents'), withholdingRateBps: params.withholdingBps });
      expect({ surplusCents: actual.surplusCents, withholdingCents: actual.withholdingCents }).toEqual(reference);
    }
  });

  it('Loi 69-21 : taux directeur, majoration, arrondi au centime', () => {
    const base = delayParamsFromGolden();
    const input = firstCase('VEC-CGI-02').input;
    const unpaid = readNumber(input, 'unpaidTtcCents');
    const months = readNumber(input, 'startedMonthsOfDelay');
    const changed = DynamicFiscalAstEngine.fromRows([makeRow(delayAst({ baseRateBps: base.baseRateBps + 25, incrementBps: base.incrementBps + 5 }))]);
    const reference = computeLaw6921Penalty({ unpaidTtcCents: unpaid, startedMonthsOfDelay: months, bamBaseRateBps: base.baseRateBps + 25, monthlyIncrementBps: base.incrementBps + 5, hasDocumentedDisputeR2: false });
    const actual = changed.evaluatePaymentDelayPenalty({ ruleCode: CODES.DELAY, asOfDateIso: date, unpaidTtcCents: unpaid, startedMonthsOfDelay: months, hasDocumentedDispute: false });
    expect(actual.totalPenaltyBps).toBe(reference.totalPenaltyBps);
    expect(actual.penaltyCents).toBe(reference.penaltyCents);
    expect(actual.penaltyCents).not.toBe(readNumber(firstCase('VEC-CGI-02').expected, 'penaltyCents'));

    const centRounded = DynamicFiscalAstEngine.fromRows([makeRow(delayAst({ ...base, rounding: 'HALF_UP_CENT' }))]);
    const exact = centRounded.evaluatePaymentDelayPenalty({ ruleCode: CODES.DELAY, asOfDateIso: date, unpaidTtcCents: unpaid, startedMonthsOfDelay: months, hasDocumentedDispute: false });
    expect(exact.penaltyCents).toBe(applyBps(centimes(unpaid), bps(exact.totalPenaltyBps)));
  });

  it('BTP : taux de retenue', () => {
    const retention = btpRetentionFromGolden();
    const input = firstCase('VEC-CGI-06').input;
    const engine = DynamicFiscalAstEngine.fromRows([makeRow(btpAst(retention + 500))]);
    const actual = engine.evaluateBtpSettlement({ ruleCode: CODES.BTP, settlementDateIso: date, worksHtCents: readNumber(input, 'worksHtCents'), deboursCents: readNumber(input, 'deboursCents'), vatRateBps: readNumber(input, 'vatRateBps') });
    const reference = computeBtpSettlement({ worksHtCents: readNumber(input, 'worksHtCents'), deboursCents: readNumber(input, 'deboursCents'), vatRateBps: readNumber(input, 'vatRateBps'), retentionBps: retention + 500 });
    expect(actual.retentionCents).toBe(reference.retentionCents);
    expect(actual.vatDueNowCents).toBe(reference.vatDueNowCents);
  });

  it('TVA : la liste de taux vient de la ligne', () => {
    const [kept] = vatRatesFromGolden();
    const engine = DynamicFiscalAstEngine.fromRows([makeRow(vatAst(kept === undefined ? [] : [kept]))]);
    for (const rate of vatRatesFromGolden()) {
      const outcome = (() => {
        try {
          return engine.evaluateVatRate({ ruleCode: CODES.VAT, issueDateIso: date, vatRateBps: rate }).vatRateBps;
        } catch {
          return -1;
        }
      })();
      expect(outcome).toBe(rate === kept ? rate : -1);
    }
  });
});

describe('plafond d\'espèces : base de calcul paramétrée par la règle', () => {
  const caps = cashParamsFromGolden();
  const input = firstCase('VEC-CGI-01').input;
  const rate = readNumber(input, 'vatRateBps');

  it('base HT : le plafond s\'applique au HT, la TVA récupérable suit au taux', () => {
    const engine = DynamicFiscalAstEngine.fromRows([makeRow(cashAst({ ...caps, capBasis: 'HT' }))]);
    const ht = caps.dailyCapCents + 100000;
    const vat = applyBps(centimes(ht), bps(rate));
    const result = engine.evaluateCashCeiling({ ruleCode: CODES.CASH, paymentDateIso: GOLDEN_FILE.ruleDate, invoiceHtCents: ht, invoiceVatCents: vat, vatRateBps: rate, alreadyPaidCashTodayCents: 0, alreadyPaidCashMonthCents: 0 });
    const recoverable = applyBps(centimes(caps.dailyCapCents), bps(rate));
    expect(result.capBasis).toBe('HT');
    expect(result.deductibleHtCents).toBe(caps.dailyCapCents);
    expect(result.recoverableVatCents).toBe(recoverable);
    expect(result.allowedTtcCents).toBe(caps.dailyCapCents + recoverable);
    expect(result.reintegratedTable3HtCents).toBe(100000);
    expect(result.nonRecoverableVatCents).toBe(vat - recoverable);
    expect(result.excessTtcCents).toBe(ht + vat - result.allowedTtcCents);
  });

  it('base HT et base TTC donnent des résultats différents pour la même facture', () => {
    const ht = readNumber(input, 'invoiceHtCents');
    const vat = readNumber(input, 'invoiceVatCents');
    const run = (capBasis: 'TTC' | 'HT') =>
      DynamicFiscalAstEngine.fromRows([makeRow(cashAst({ ...caps, capBasis }))]).evaluateCashCeiling({ ruleCode: CODES.CASH, paymentDateIso: GOLDEN_FILE.ruleDate, invoiceHtCents: ht, invoiceVatCents: vat, vatRateBps: rate, alreadyPaidCashTodayCents: 0, alreadyPaidCashMonthCents: 0 });
    expect(run('TTC').allowedTtcCents).not.toBe(run('HT').allowedTtcCents);
  });
});

describe('D-20 : onze factures de 4 800 MAD TTC, franchissement à la onzième, excédent de 2 800 MAD TTC', () => {
  const caps = cashParamsFromGolden();
  const rate = readNumber(firstCase('VEC-CGI-01').input, 'vatRateBps');
  const invoiceTtc = 480000;
  const invoiceHt = 400000;
  const invoiceVat = invoiceTtc - invoiceHt;

  function sequence(count: number) {
    const engine = DynamicFiscalAstEngine.fromRows([makeRow(cashAst(caps))]);
    const invoices = Array.from({ length: count }, (_unused, index) => ({
      paymentDateIso: `2026-11-${String(index + 1).padStart(2, '0')}`,
      invoiceHtCents: invoiceHt,
      invoiceVatCents: invoiceVat,
      vatRateBps: rate,
    }));
    return engine.evaluateCashCeilingSequence({ ruleCode: CODES.CASH, invoices });
  }

  it('la TVA de test est cohérente avec le taux du vecteur', () => {
    expect(applyBps(centimes(invoiceHt), bps(rate))).toBe(invoiceVat);
  });

  it('dix factures (48 000 MAD) ne franchissent aucun plafond', () => {
    const result = sequence(10);
    expect(result.firstCrossingIndex).toBeNull();
    expect(result.steps.every((step) => !step.exceedsCeiling)).toBe(true);
  });

  it('la onzième franchit le plafond mensuel : excédent 280 000 centimes (2 800 MAD TTC), reste scindé', () => {
    const result = sequence(11);
    expect(result.firstCrossingIndex).toBe(10);
    const eleventh = result.steps[10];
    expect(eleventh?.excessTtcCents).toBe(280000);
    expect(eleventh?.allowedTtcCents).toBe(invoiceTtc - 280000);
    const reference = computeArt11CashSplit({
      invoiceHtCents: invoiceHt,
      invoiceVatCents: invoiceVat,
      vatRateBps: rate,
      alreadyPaidCashTodayTtcCents: 0,
      alreadyPaidCashMonthTtcCents: 10 * invoiceTtc,
      dailyCapTtcCents: caps.dailyCapCents,
      monthlyCapTtcCents: caps.monthlyCapCents,
    });
    expect(eleventh?.deductibleHtCents).toBe(reference.deductibleHtCents);
    expect(eleventh?.nonRecoverableVatCents).toBe(reference.nonRecoverableVatCents);
    expect(result.steps.slice(0, 10).every((step) => step.excessTtcCents === 0)).toBe(true);
  });

  it('une douzième facture est entièrement hors plafond mensuel', () => {
    const twelfth = sequence(12).steps[11];
    expect(twelfth?.allowedTtcCents).toBe(0);
    expect(twelfth?.excessTtcCents).toBe(invoiceTtc);
  });
});

describe('Loi 69-21 : statut du délai légal, jour exact d\'échéance', () => {
  const engine = DynamicFiscalAstEngine.fromRows([makeRow(delayAst(delayParamsFromGolden()))]);
  const status = (delivery: string, asOf: string, termKind: 'STANDARD' | 'CONTRACT' | 'DECREE') =>
    engine.evaluatePaymentDelayStatus({ ruleCode: CODES.DELAY, serviceDeliveryDateIso: delivery, asOfDateIso: asOf, termKind });

  it('le jour exact de l\'échéance est encore dans le délai ; le lendemain est en retard d\'un jour', () => {
    const due = status('2026-01-01', '2026-01-01', 'STANDARD').legalDueDateIso;
    expect(due).toBe('2026-03-02');
    expect(status('2026-01-01', '2026-03-02', 'STANDARD')).toMatchObject({ daysLate: 0, status: 'DANS_DELAI_LEGAL' });
    expect(status('2026-01-01', '2026-03-03', 'STANDARD')).toMatchObject({ daysLate: 1, status: 'EN_RETARD_PENALISE' });
    expect(status('2026-01-01', '2026-01-01', 'STANDARD')).toMatchObject({ daysLate: 0 });
  });

  it('année bissextile', () => {
    expect(status('2028-01-01', '2028-03-01', 'STANDARD')).toMatchObject({ legalDueDateIso: '2028-03-01', daysLate: 0 });
    expect(status('2028-01-01', '2028-03-02', 'STANDARD').daysLate).toBe(1);
  });

  it('délais de contrat et de décret lus de la règle', () => {
    expect(status('2026-01-01', '2026-01-01', 'CONTRACT').legalTermDays).toBe(LEGAL_TERMS_DAYS.contract);
    expect(status('2026-01-01', '2026-01-01', 'DECREE').legalTermDays).toBe(LEGAL_TERMS_DAYS.decree);
  });
});
