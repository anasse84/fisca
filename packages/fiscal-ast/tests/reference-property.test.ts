import { applyBps, bps, centimes } from '@fisca/shared-types';
import { describe, expect, it } from 'vitest';
import {
  computeArt11CashSplit,
  computeAutoEntrepreneurSurplus,
  computeBtpSettlement,
  computeLaw6921Penalty,
  computeRasTva,
  addMonthsClamped,
} from '../../qa-harness/src/fiscal-golden-suite.ts';
import { DynamicFiscalAstEngine } from '../src/index.ts';
import {
  CODES,
  GOLDEN_FILE,
  aeParamsFromGolden,
  cashParamsFromGolden,
  delayParamsFromGolden,
  goldenRows,
  rasParamsFromGolden,
  vatRatesFromGolden,
  btpRetentionFromGolden,
} from './helpers/rule-fixtures.ts';

const engine = DynamicFiscalAstEngine.fromRows(goldenRows());
const CASES = 400;

/** mulberry32 : générateur seedé entier, reproductible. */
function createRng(seed: number): { readonly int: (bound: number) => number } {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return { int: (bound: number): number => next() % bound };
}

function vatFor(htCents: number, rateBps: number): number {
  return applyBps(centimes(htCents), bps(rateBps));
}

describe('propriété : plafond d\'espèces identique à computeArt11CashSplit', () => {
  const caps = cashParamsFromGolden();
  const rates = vatRatesFromGolden();

  function compare(ht: number, rate: number, today: number, month: number): void {
    const vat = vatFor(ht, rate);
    const reference = computeArt11CashSplit({
      invoiceHtCents: ht,
      invoiceVatCents: vat,
      vatRateBps: rate,
      alreadyPaidCashTodayTtcCents: today,
      alreadyPaidCashMonthTtcCents: month,
      dailyCapTtcCents: caps.dailyCapCents,
      monthlyCapTtcCents: caps.monthlyCapCents,
    });
    const actual = engine.evaluateCashCeiling({
      ruleCode: CODES.CASH,
      paymentDateIso: GOLDEN_FILE.ruleDate,
      invoiceHtCents: ht,
      invoiceVatCents: vat,
      vatRateBps: rate,
      alreadyPaidCashTodayCents: today,
      alreadyPaidCashMonthCents: month,
    });
    expect({
      allowedTtcCents: actual.allowedTtcCents,
      deductibleHtCents: actual.deductibleHtCents,
      recoverableVatCents: actual.recoverableVatCents,
      reintegratedTable3HtCents: actual.reintegratedTable3HtCents,
      nonRecoverableVatCents: actual.nonRecoverableVatCents,
    }).toEqual(reference);
  }

  it(`${CASES} cas aléatoires seedés`, () => {
    const rng = createRng(20261113);
    for (let index = 0; index < CASES; index += 1) {
      const rate = rates[rng.int(rates.length)] ?? 0;
      compare(rng.int(2000000), rate, rng.int(caps.dailyCapCents + 100000), rng.int(caps.monthlyCapCents + 100000));
    }
  });

  it('cas limites : plafond exact, plafond + 1 centime, 0 centime', () => {
    const rate = rates[0] ?? 0;
    const month = caps.monthlyCapCents;
    // Facture dont le TTC vaut exactement le plafond journalier restant, puis +1 centime.
    const exactHt = 416667;
    const exactTtc = exactHt + vatFor(exactHt, rate);
    for (const ht of [0, 1, exactHt - 1, exactHt, exactHt + 1]) {
      compare(ht, rate, 0, 0);
      compare(ht, rate, caps.dailyCapCents - exactTtc, 0);
      compare(ht, rate, caps.dailyCapCents - exactTtc + 1, 0);
      compare(ht, rate, 0, month - exactTtc);
      compare(ht, rate, 0, month - exactTtc - 1);
      compare(ht, rate, caps.dailyCapCents, month);
    }
    const atCap = engine.evaluateCashCeiling({
      ruleCode: CODES.CASH,
      paymentDateIso: GOLDEN_FILE.ruleDate,
      invoiceHtCents: 0,
      invoiceVatCents: caps.dailyCapCents,
      vatRateBps: rate,
      alreadyPaidCashTodayCents: 0,
      alreadyPaidCashMonthCents: 0,
    });
    expect(atCap.exceedsCeiling).toBe(false);
    const oneMore = engine.evaluateCashCeiling({
      ruleCode: CODES.CASH,
      paymentDateIso: GOLDEN_FILE.ruleDate,
      invoiceHtCents: 0,
      invoiceVatCents: caps.dailyCapCents + 1,
      vatRateBps: rate,
      alreadyPaidCashTodayCents: 0,
      alreadyPaidCashMonthCents: 0,
    });
    expect(oneMore.exceedsCeiling).toBe(true);
    expect(oneMore.excessTtcCents).toBe(1);
  });
});

describe('propriété : Loi 69-21 identique à computeLaw6921Penalty', () => {
  const params = delayParamsFromGolden();

  function compare(unpaid: number, months: number, dispute: boolean): void {
    const reference = computeLaw6921Penalty({
      unpaidTtcCents: unpaid,
      startedMonthsOfDelay: months,
      bamBaseRateBps: params.baseRateBps,
      monthlyIncrementBps: params.incrementBps,
      hasDocumentedDisputeR2: dispute,
    });
    const actual = engine.evaluatePaymentDelayPenalty({
      ruleCode: CODES.DELAY,
      asOfDateIso: GOLDEN_FILE.ruleDate,
      unpaidTtcCents: unpaid,
      startedMonthsOfDelay: months,
      hasDocumentedDispute: dispute,
    });
    expect({ totalPenaltyBps: actual.totalPenaltyBps, penaltyCents: actual.penaltyCents }).toEqual(reference);
  }

  it(`${CASES} cas aléatoires seedés`, () => {
    const rng = createRng(6921);
    for (let index = 0; index < CASES; index += 1) {
      compare(rng.int(900000000), rng.int(40), rng.int(10) === 0);
    }
  });

  it('cas limites : 0 centime, 0 mois, 1 mois, arrondi exact au dirham, +1 centime', () => {
    for (const unpaid of [0, 1, 99, 100, 101, 1000000, 1000001]) {
      for (const months of [0, 1, 2, 12]) {
        compare(unpaid, months, false);
        compare(unpaid, months, true);
      }
    }
  });
});

describe('propriété : RAS-TVA identique à computeRasTva', () => {
  const params = rasParamsFromGolden();
  const base = '2026-02-15';

  function compare(ttc: number, vat: number, paymentIso: string, issuedIso: string | undefined): void {
    const reference = computeRasTva({
      invoiceTtcCents: ttc,
      invoiceVatCents: vat,
      paymentDateIso: paymentIso,
      ...(issuedIso === undefined ? {} : { taxClearanceIssuedDateIso: issuedIso }),
      exclusionThresholdTtcCents: params.thresholdCents,
      attestationValidityMonths: params.validityMonths,
      reducedRasRateBps: params.reducedBps,
      fullRasRateBps: params.fullBps,
    });
    const actual = engine.evaluateRasTva({
      ruleCode: CODES.RAS,
      paymentDateIso: paymentIso,
      invoiceTtcCents: ttc,
      invoiceVatCents: vat,
      ...(issuedIso === undefined ? {} : { taxClearanceIssuedDateIso: issuedIso }),
    });
    expect({ rasRateBps: actual.rasRateBps, rasVatCents: actual.rasVatCents }).toEqual({ rasRateBps: reference.rasRateBps, rasVatCents: reference.rasVatCents });
  }

  it(`${CASES} cas aléatoires seedés`, () => {
    const rng = createRng(117);
    for (let index = 0; index < CASES; index += 1) {
      const ttc = rng.int(3000000);
      const vat = rng.int(2) === 0 ? 0 : rng.int(ttc + 1);
      const day = 1 + rng.int(28);
      const month = 1 + rng.int(12);
      const payment = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const issued = rng.int(4) === 0 ? undefined : `2025-${String(1 + rng.int(12)).padStart(2, '0')}-${String(1 + rng.int(28)).padStart(2, '0')}`;
      compare(ttc, vat, payment, issued);
    }
  });

  it('cas limites : seuil exact, seuil - 1 centime, jour exact de fin de validité, lendemain, veille de la délivrance', () => {
    for (const ttc of [params.thresholdCents - 1, params.thresholdCents, params.thresholdCents + 1]) {
      const limit = addMonthsClamped(base, params.validityMonths);
      compare(ttc, 100000, limit, base);
      compare(ttc, 100000, addMonthsClamped(limit, 0), base);
      compare(ttc, 100000, '2026-08-16', base);
      compare(ttc, 100000, '2026-02-14', base);
      compare(ttc, 100000, base, base);
      compare(ttc, 0, base, base);
    }
    const lastDay = engine.evaluateRasTva({ ruleCode: CODES.RAS, paymentDateIso: '2026-08-15', invoiceTtcCents: params.thresholdCents, invoiceVatCents: 1000, taxClearanceIssuedDateIso: base });
    expect(lastDay.attestationValid).toBe(true);
    expect(lastDay.attestationLastValidDayIso).toBe('2026-08-15');
    const dayAfter = engine.evaluateRasTva({ ruleCode: CODES.RAS, paymentDateIso: '2026-08-16', invoiceTtcCents: params.thresholdCents, invoiceVatCents: 1000, taxClearanceIssuedDateIso: base });
    expect(dayAfter.attestationValid).toBe(false);
    // Fin de mois : 31 août + 6 mois = 28 février.
    const clamped = engine.evaluateRasTva({ ruleCode: CODES.RAS, paymentDateIso: '2027-02-28', invoiceTtcCents: params.thresholdCents, invoiceVatCents: 1000, taxClearanceIssuedDateIso: '2026-08-31' });
    expect(clamped.attestationLastValidDayIso).toBe('2027-02-28');
    expect(clamped.attestationValid).toBe(true);
  });
});

describe('propriété : auto-entrepreneur identique à computeAutoEntrepreneurSurplus', () => {
  const params = aeParamsFromGolden();

  function compare(before: number, invoice: number): void {
    const reference = computeAutoEntrepreneurSurplus({
      clientThresholdCents: params.thresholdCents,
      cumulBeforeInvoiceCents: before,
      invoiceCents: invoice,
      withholdingRateBps: params.withholdingBps,
    });
    const actual = engine.evaluateAutoEntrepreneurThreshold({
      ruleCode: CODES.AE,
      invoiceDateIso: GOLDEN_FILE.ruleDate,
      cumulBeforeInvoiceCents: before,
      invoiceCents: invoice,
    });
    expect({ surplusCents: actual.surplusCents, withholdingCents: actual.withholdingCents }).toEqual(reference);
  }

  it(`${CASES} cas aléatoires seedés`, () => {
    const rng = createRng(80000);
    for (let index = 0; index < CASES; index += 1) {
      compare(rng.int(params.thresholdCents * 2), rng.int(4000000));
    }
  });

  it('cas limites : seuil exact, seuil + 1 centime, cumul déjà au-dessus, 0 centime', () => {
    const threshold = params.thresholdCents;
    for (const [before, invoice] of [
      [0, 0],
      [0, threshold],
      [0, threshold + 1],
      [threshold - 1, 1],
      [threshold - 1, 2],
      [threshold, 0],
      [threshold, 1],
      [threshold + 500, 700],
    ] as const) {
      compare(before, invoice);
    }
  });
});

describe('propriété : décompte BTP identique à computeBtpSettlement, TVA identique à la liste de la règle', () => {
  const retention = btpRetentionFromGolden();
  const rates = vatRatesFromGolden();

  it(`${CASES} cas aléatoires seedés`, () => {
    const rng = createRng(2026);
    for (let index = 0; index < CASES; index += 1) {
      const works = rng.int(900000000);
      const debours = rng.int(5000000);
      const rate = rates[rng.int(rates.length)] ?? 0;
      const reference = computeBtpSettlement({ worksHtCents: works, deboursCents: debours, vatRateBps: rate, retentionBps: retention });
      const actual = engine.evaluateBtpSettlement({ ruleCode: CODES.BTP, settlementDateIso: GOLDEN_FILE.ruleDate, worksHtCents: works, deboursCents: debours, vatRateBps: rate });
      expect({
        retentionCents: actual.retentionCents,
        deboursVatCents: actual.deboursVatCents,
        deferredVatOnRetentionCents: actual.deferredVatOnRetentionCents,
        vatDueNowCents: actual.vatDueNowCents,
      }).toEqual(reference);
    }
  });

  it('TVA : base HT -> TVA et TTC entiers pour chaque taux admis, y compris 0 centime', () => {
    const rng = createRng(1);
    for (const rate of rates) {
      for (const base of [0, 1, 5, 99, rng.int(900000000)]) {
        const result = engine.evaluateVatRate({ ruleCode: CODES.VAT, issueDateIso: GOLDEN_FILE.ruleDate, vatRateBps: rate, baseHtCents: base });
        expect(result.vatCents).toBe(vatFor(base, rate));
        expect(result.totalTtcCents).toBe(base + vatFor(base, rate));
      }
    }
  });
});
