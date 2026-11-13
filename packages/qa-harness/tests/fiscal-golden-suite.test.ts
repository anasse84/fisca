import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GOLDEN_STATES,
  GoldenMismatchError,
  GoldenVectorFormatError,
  addMonthsClamped,
  assertGoldenCase,
  computeArt11CashSplit,
  computeAutoEntrepreneurSurplus,
  computeBtpSettlement,
  computeGoldenCase,
  computeLaw6921Penalty,
  computeRasTva,
  diffGolden,
  evaluateVatRate,
  formatDiscrepancyReport,
  loadGoldenVectorFile,
  parseGoldenVectorFile,
  replayGoldenVector,
} from '../src/fiscal-golden-suite.ts';

const VECTOR_PATH = new URL('./golden/cgi.vectors.json', import.meta.url);
const file = loadGoldenVectorFile(VECTOR_PATH);

describe('fichier cgi.vectors.json : forme imposée par ERRATA B-09 et section E', () => {
  it('contient exactement VEC-CGI-01 à VEC-CGI-06 (07 à 120 : autres sessions)', () => {
    expect(file.vectors.map((v) => v.id)).toEqual([
      'VEC-CGI-01', 'VEC-CGI-02', 'VEC-CGI-03', 'VEC-CGI-04', 'VEC-CGI-05', 'VEC-CGI-06',
    ]);
  });

  it.each(file.vectors.map((v) => [v.id, v] as const))('%s porte article, date, état et calcul détaillé', (_id, vector) => {
    expect(vector.law.length).toBeGreaterThan(10);
    expect(vector.ruleDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(GOLDEN_STATES).toContain(vector.state);
    expect(vector.calc.length).toBeGreaterThan(20);
    expect(vector.cases.length).toBeGreaterThan(0);
  });

  it('suit la section E de l\'ERRATA : seul VEC-CGI-01 est recoupé', () => {
    const states = Object.fromEntries(file.vectors.map((v) => [v.id, v.state]));
    expect(states).toEqual({
      'VEC-CGI-01': 'RECOUPÉ',
      'VEC-CGI-02': 'NON RECOUPÉ',
      'VEC-CGI-03': 'NON RECOUPÉ',
      'VEC-CGI-04': 'NON RECOUPÉ',
      'VEC-CGI-05': 'NON RECOUPÉ',
      'VEC-CGI-06': 'NON RECOUPÉ',
    });
  });

  it('VEC-CGI-02 compte 46 jours de retard (ERRATA D-13)', () => {
    const vector = file.vectors.find((v) => v.id === 'VEC-CGI-02');
    expect(vector?.cases[0]?.context).toEqual({ delayDays: 46 });
  });
});

describe('rejeu des vecteurs : valeurs attendues lues du JSON, valeurs calculées par le code', () => {
  for (const vector of file.vectors) {
    it(`${vector.id} : ${vector.label}`, () => {
      const results = replayGoldenVector(vector);
      expect(results).toHaveLength(vector.cases.length);
      for (const result of results) {
        expect(result.discrepancies, formatDiscrepancyReport(vector.id, result.caseName, result.discrepancies)).toEqual([]);
      }
    });
  }
});

describe('valeurs de tête de l\'énoncé du ticket T-S0-06, écrites en dur dans le test', () => {
  it('VEC-CGI-01 : 720000 TTC → 416667 / 183333 / 36667', () => {
    const out = computeArt11CashSplit({
      invoiceHtCents: 600000, invoiceVatCents: 120000, vatRateBps: 2000,
      alreadyPaidCashTodayTtcCents: 0, alreadyPaidCashMonthTtcCents: 0,
      dailyCapTtcCents: 500000, monthlyCapTtcCents: 5000000,
    });
    expect(out.deductibleHtCents).toBe(416667);
    expect(out.reintegratedTable3HtCents).toBe(183333);
    expect(out.nonRecoverableVatCents).toBe(36667);
  });

  it('VEC-CGI-02 : 1234500 TTC, 2 mois entamés, 360 bps → 44500', () => {
    const out = computeLaw6921Penalty({
      unpaidTtcCents: 1234500, startedMonthsOfDelay: 2, bamBaseRateBps: 275, monthlyIncrementBps: 85,
      hasDocumentedDisputeR2: false,
    });
    expect(out).toEqual({ totalPenaltyBps: 360, penaltyCents: 44500 });
  });

  it('VEC-CGI-03 : 150000 (75 %) ou 200000 (100 %)', () => {
    const base = {
      invoiceTtcCents: 1200000, invoiceVatCents: 200000, paymentDateIso: '2026-06-15',
      exclusionThresholdTtcCents: 500000, attestationValidityMonths: 6, reducedRasRateBps: 7500, fullRasRateBps: 10000,
    };
    expect(computeRasTva({ ...base, taxClearanceIssuedDateIso: '2026-02-15' }).rasVatCents).toBe(150000);
    expect(computeRasTva({ ...base, taxClearanceIssuedDateIso: '2025-11-15' }).rasVatCents).toBe(200000);
    expect(computeRasTva(base).rasVatCents).toBe(200000);
  });

  it('VEC-CGI-04 : surplus 700000, retenue 210000', () => {
    expect(
      computeAutoEntrepreneurSurplus({
        clientThresholdCents: 8000000, cumulBeforeInvoiceCents: 7500000, invoiceCents: 1200000, withholdingRateBps: 3000,
      }),
    ).toEqual({ surplusCents: 700000, withholdingCents: 210000 });
  });

  it('VEC-CGI-05 : 1400 bps en 2026 rejeté avec ADR_04_LF2026_VAT_VIOLATION', () => {
    expect(evaluateVatRate({ vatRateBps: 1400, issueDateIso: '2026-02-01' })).toEqual({
      accepted: false, errorCode: 'ADR_04_LF2026_VAT_VIOLATION',
    });
  });

  it('VEC-CGI-06 : débours 0 TVA, TVA sur retenue différée', () => {
    const out = computeBtpSettlement({ worksHtCents: 10000000, deboursCents: 500000, vatRateBps: 2000, retentionBps: 1000 });
    expect(out.deboursVatCents).toBe(0);
    expect(out.deferredVatOnRetentionCents).toBe(200000);
  });
});

describe('calculateurs : bords et refus des flottants', () => {
  it('Art. 11-II : sous les plafonds, rien n\'est réintégré', () => {
    const out = computeArt11CashSplit({
      invoiceHtCents: 100000, invoiceVatCents: 20000, vatRateBps: 2000,
      alreadyPaidCashTodayTtcCents: 0, alreadyPaidCashMonthTtcCents: 0,
      dailyCapTtcCents: 500000, monthlyCapTtcCents: 5000000,
    });
    expect(out).toEqual({
      allowedTtcCents: 120000, deductibleHtCents: 100000, recoverableVatCents: 20000,
      reintegratedTable3HtCents: 0, nonRecoverableVatCents: 0,
    });
  });

  it('Art. 11-II (D-20) : onzième facture de 4 800 MAD, cumul mensuel 48 000 MAD → 2 000 MAD TTC admis', () => {
    const out = computeArt11CashSplit({
      invoiceHtCents: 400000, invoiceVatCents: 80000, vatRateBps: 2000,
      alreadyPaidCashTodayTtcCents: 0, alreadyPaidCashMonthTtcCents: 4800000,
      dailyCapTtcCents: 500000, monthlyCapTtcCents: 5000000,
    });
    expect(out.allowedTtcCents).toBe(200000);
    expect(out.deductibleHtCents).toBe(166667);
  });

  it('Art. 11-II : plafond du mois épuisé → rien d\'admis', () => {
    const out = computeArt11CashSplit({
      invoiceHtCents: 100000, invoiceVatCents: 20000, vatRateBps: 2000,
      alreadyPaidCashTodayTtcCents: 0, alreadyPaidCashMonthTtcCents: 5200000,
      dailyCapTtcCents: 500000, monthlyCapTtcCents: 5000000,
    });
    expect(out.allowedTtcCents).toBe(0);
    expect(out.deductibleHtCents).toBe(0);
    expect(out.reintegratedTable3HtCents).toBe(100000);
    expect(out.nonRecoverableVatCents).toBe(20000);
  });

  it('Loi 69-21 : litige documenté, retard nul ou impayé nul → 0', () => {
    const base = { unpaidTtcCents: 1234500, startedMonthsOfDelay: 2, bamBaseRateBps: 275, monthlyIncrementBps: 85 };
    expect(computeLaw6921Penalty({ ...base, hasDocumentedDisputeR2: true }).penaltyCents).toBe(0);
    expect(computeLaw6921Penalty({ ...base, startedMonthsOfDelay: 0, hasDocumentedDisputeR2: false }).penaltyCents).toBe(0);
    expect(computeLaw6921Penalty({ ...base, unpaidTtcCents: 0, hasDocumentedDisputeR2: false }).penaltyCents).toBe(0);
  });

  it('Loi 69-21 : un dirham exact ne monte pas au dirham suivant', () => {
    // 1000000 c × 100 bps = 100000000 ; ÷ 1000000 = 100 MAD pile.
    const out = computeLaw6921Penalty({
      unpaidTtcCents: 1000000, startedMonthsOfDelay: 1, bamBaseRateBps: 100, monthlyIncrementBps: 85,
      hasDocumentedDisputeR2: false,
    });
    expect(out.penaltyCents).toBe(10000);
  });

  it('RAS-TVA : sous le seuil d\'exclusion ou TVA nulle → 0', () => {
    const base = {
      paymentDateIso: '2026-06-15', exclusionThresholdTtcCents: 500000, attestationValidityMonths: 6,
      reducedRasRateBps: 7500, fullRasRateBps: 10000,
    };
    expect(computeRasTva({ ...base, invoiceTtcCents: 499999, invoiceVatCents: 83333 })).toEqual({ rasRateBps: 0, rasVatCents: 0 });
    expect(computeRasTva({ ...base, invoiceTtcCents: 600000, invoiceVatCents: 0 })).toEqual({ rasRateBps: 0, rasVatCents: 0 });
  });

  it('RAS-TVA : bornes de l\'attestation, y compris fin de mois (31 août + 6 mois = 28 février)', () => {
    const base = {
      invoiceTtcCents: 1200000, invoiceVatCents: 200000, exclusionThresholdTtcCents: 500000,
      attestationValidityMonths: 6, reducedRasRateBps: 7500, fullRasRateBps: 10000,
      taxClearanceIssuedDateIso: '2025-08-31',
    };
    expect(computeRasTva({ ...base, paymentDateIso: '2026-02-28' }).rasRateBps).toBe(7500);
    expect(computeRasTva({ ...base, paymentDateIso: '2026-03-01' }).rasRateBps).toBe(10000);
    // Attestation postérieure au paiement : non valable.
    expect(computeRasTva({ ...base, paymentDateIso: '2025-08-30' }).rasRateBps).toBe(10000);
    // Jour même d'émission.
    expect(computeRasTva({ ...base, paymentDateIso: '2025-08-31' }).rasRateBps).toBe(7500);
  });

  it('addMonthsClamped : 29 février et bascule d\'année', () => {
    expect(addMonthsClamped('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonthsClamped('2025-11-15', 3)).toBe('2026-02-15');
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('refuse un flottant, un NaN ou un entier non sûr en entrée', () => {
    expect(() => computeAutoEntrepreneurSurplus({
      clientThresholdCents: 8000000, cumulBeforeInvoiceCents: Number("7500000.5"), invoiceCents: 1200000, withholdingRateBps: 3000,
    })).toThrow(/ADR_03_FLOAT_FORBIDDEN/);
    expect(() => computeBtpSettlement({
      worksHtCents: Number.NaN, deboursCents: 0, vatRateBps: 2000, retentionBps: 1000,
    })).toThrow(/ADR_03_FLOAT_FORBIDDEN/);
    expect(() => computeBtpSettlement({
      worksHtCents: Number.MAX_SAFE_INTEGER + 1, deboursCents: 0, vatRateBps: 2000, retentionBps: 1000,
    })).toThrow(/ADR_03_FLOAT_FORBIDDEN/);
  });

  it('AE : en dessous du seuil, aucun surplus ; facture entièrement au-dessus du seuil, surplus = facture', () => {
    const base = { clientThresholdCents: 8000000, withholdingRateBps: 3000 };
    expect(computeAutoEntrepreneurSurplus({ ...base, cumulBeforeInvoiceCents: 1000000, invoiceCents: 1200000 }))
      .toEqual({ surplusCents: 0, withholdingCents: 0 });
    expect(computeAutoEntrepreneurSurplus({ ...base, cumulBeforeInvoiceCents: 9000000, invoiceCents: 1000000 }))
      .toEqual({ surplusCents: 1000000, withholdingCents: 300000 });
  });

  it('computeGoldenCase refuse un champ manquant ou d\'un mauvais type', () => {
    expect(() => computeGoldenCase('AUTO_ENTREPRENEUR_THRESHOLD', { clientThresholdCents: 1 })).toThrow(GoldenVectorFormatError);
    expect(() => computeGoldenCase('LF2026_VAT_RATE', { vatRateBps: 2000, issueDateIso: 20260201 })).toThrow(GoldenVectorFormatError);
  });
});

describe('moteur d\'assertion au centime', () => {
  it('signale un écart d\'un centime avec sa valeur attendue, calculée et son delta', () => {
    const discrepancies = diffGolden({ deductibleHtCents: 416667 }, { deductibleHtCents: 416666 });
    expect(discrepancies).toEqual([{ key: 'deductibleHtCents', expected: 416667, actual: 416666, delta: -1 }]);
    const report = formatDiscrepancyReport('VEC-CGI-01', 'cas', discrepancies);
    expect(report).toContain('VEC-CGI-01');
    expect(report).toContain('deductibleHtCents');
    expect(report).toContain('416667');
    expect(report).toContain('416666');
    expect(report).toContain('-1');
  });

  it('signale clés manquantes et clés en trop', () => {
    const discrepancies = diffGolden({ a: 1 }, { b: 2 });
    expect(discrepancies.map((d) => d.key).sort()).toEqual(['a', 'b']);
  });

  it('compare chaînes et booléens strictement', () => {
    expect(diffGolden({ ok: true, code: 'X' }, { ok: true, code: 'X' })).toEqual([]);
    expect(diffGolden({ ok: true }, { ok: false })).toHaveLength(1);
    expect(diffGolden({ code: 'X' }, { code: 'Y' })).toHaveLength(1);
  });

  it('refuse tout flottant attendu ou calculé', () => {
    expect(() => diffGolden({ x: 1.5 }, { x: 1 })).toThrow(/ADR_03_FLOAT_FORBIDDEN/);
    expect(() => diffGolden({ x: 1 }, { x: 0.5 })).toThrow(/ADR_03_FLOAT_FORBIDDEN/);
  });

  it('assertGoldenCase lève GoldenMismatchError avec le rapport, et se tait si tout concorde', () => {
    expect(() => assertGoldenCase('VEC-X', 'ok', { a: 1 }, { a: 1 })).not.toThrow();
    expect(() => assertGoldenCase('VEC-X', 'ko', { a: 1 }, { a: 2 })).toThrow(GoldenMismatchError);
  });

  it('détecte une valeur attendue altérée d\'un centime dans un vecteur rejoué', () => {
    const original = file.vectors[0];
    if (original === undefined) throw new Error('vecteur 01 absent');
    const firstCase = original.cases[0];
    if (firstCase === undefined) throw new Error('cas absent');
    const tampered = {
      ...original,
      cases: [{ ...firstCase, expected: { ...firstCase.expected, deductibleHtCents: 416668 } }],
    };
    const results = replayGoldenVector(tampered);
    expect(results[0]?.discrepancies).toEqual([{ key: 'deductibleHtCents', expected: 416668, actual: 416667, delta: -1 }]);
  });
});

describe('lecture et validation du JSON', () => {
  const raw = readFileSync(VECTOR_PATH, 'utf8');

  it('parse le fichier réel', () => {
    expect(parseGoldenVectorFile(raw).vectors).toHaveLength(6);
  });

  it('refuse un JSON invalide, un état inconnu, un article absent ou une date de règle absente', () => {
    expect(() => parseGoldenVectorFile('{')).toThrow(GoldenVectorFormatError);
    expect(() => parseGoldenVectorFile(raw.replace('"state": "RECOUPÉ"', '"state": "VERIFIE"'))).toThrow(/state/);
    expect(() => parseGoldenVectorFile(raw.replace(/"law": "CGI art\. 11-II[^"]*",/, ''))).toThrow(/law/);
    expect(() => parseGoldenVectorFile(raw.replace('"ruleDate": "2026-11-13",\n      "state": "RECOUPÉ"', '"state": "RECOUPÉ"'))).toThrow(/ruleDate/);
  });

  it('refuse une date de règle impossible', () => {
    expect(() => parseGoldenVectorFile(raw.replace('"ruleDate": "2026-11-13",\n      "state": "RECOUPÉ"', '"ruleDate": "2026-13-45",\n      "state": "RECOUPÉ"'))).toThrow(/ruleDate/);
  });

  it('refuse un identifiant dupliqué et un nombre flottant dans une valeur', () => {
    expect(() => parseGoldenVectorFile(raw.replace('"id": "VEC-CGI-02"', '"id": "VEC-CGI-01"'))).toThrow(/dupliqué/);
    expect(() => parseGoldenVectorFile(raw.replace('"deductibleHtCents": 416667', '"deductibleHtCents": 416666.5'))).toThrow(/ADR_03_FLOAT_FORBIDDEN/);
  });

  it('refuse un genre de calcul inconnu', () => {
    expect(() => parseGoldenVectorFile(raw.replace('"kind": "BTP_SETTLEMENT"', '"kind": "INCONNU"'))).toThrow(/kind/);
  });

  it('refuse un fichier sans vecteur ou sans cas', () => {
    expect(() => parseGoldenVectorFile('{"schema":"fisca-golden-vectors/2","package":"p","ruleDate":"2026-11-13","vectors":[]}')).toThrow(/vectors/);
  });
});
