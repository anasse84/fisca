import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GOLDEN_STATES,
  GoldenMismatchError,
  GoldenVectorFormatError,
  PNM_LINE_WIDTH,
  UnreadableIssueDateError,
  addMonthsClamped,
  assertReadableIssueDate,
  assertValidSage100PnmBuffer,
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

describe('VEC-CGI-05 : date d\'émission illisible, rejet typé ADR_04_UNREADABLE_ISSUE_DATE', () => {
  const unreadable = ['', 'abc', '26-02-01', '2026-13-45', '2026-02-30', '2026-2-1', ' 2026-02-01', '2026-02-01T00:00:00Z'];

  it.each(unreadable)('assertReadableIssueDate(%j) lève UnreadableIssueDateError', (date) => {
    expect(() => assertReadableIssueDate(date)).toThrow(UnreadableIssueDateError);
    expect(() => assertReadableIssueDate(date)).toThrow(/ADR_04_UNREADABLE_ISSUE_DATE/);
  });

  it.each(unreadable)('evaluateVatRate(1400, %j) est rejeté, jamais accepté', (date) => {
    expect(evaluateVatRate({ vatRateBps: 1400, issueDateIso: date })).toEqual({
      accepted: false, errorCode: 'ADR_04_UNREADABLE_ISSUE_DATE',
    });
  });

  it.each(unreadable)('evaluateVatRate(2000, %j) est aussi rejeté : un taux licite ne rachète pas une date illisible', (date) => {
    expect(evaluateVatRate({ vatRateBps: 2000, issueDateIso: date }).accepted).toBe(false);
  });

  it('le fichier de vecteurs porte les quatre cas demandés', () => {
    const vector = file.vectors.find((v) => v.id === 'VEC-CGI-05');
    const dates = (vector?.cases ?? []).filter((c) => c.expected['errorCode'] === 'ADR_04_UNREADABLE_ISSUE_DATE').map((c) => c.input['issueDateIso']);
    expect(dates).toEqual(['', 'abc', '26-02-01', '2026-13-45']);
  });

  it('une date lisible reste acceptée avec un taux admis', () => {
    expect(evaluateVatRate({ vatRateBps: 2000, issueDateIso: '2026-02-01' })).toEqual({ accepted: true, errorCode: '' });
  });
});

describe('assertValidSage100PnmBuffer : 108 caractères ASCII + CRLF', () => {
  interface PnmFields {
    readonly journal?: string;
    readonly date?: string;
    readonly reference?: string;
    readonly sense?: string;
    readonly amountField?: string;
    readonly flag?: string;
    readonly reserved?: string;
    readonly label?: string;
  }
  /** Ligne .PNM conforme (Doc_07 § 04) ; chaque zone peut être remplacée pour fabriquer un cas fautif. */
  function pnmLine(fields: PnmFields = {}): string {
    return [
      (fields.journal ?? 'VTE').padEnd(3),
      (fields.date ?? '131126').padEnd(6),
      'FC',
      '34210000'.padEnd(13),
      'X',
      'CLI0001'.padEnd(13),
      (fields.reference ?? 'FAC2026000001').padEnd(13),
      (fields.label ?? 'FACTURE ATLAS SARL').padEnd(25),
      'V',
      '120127',
      fields.sense ?? 'D',
      fields.amountField ?? '100.00'.padStart(20),
      fields.flag ?? 'N',
      fields.reserved ?? '   ',
    ].join('');
  }
  function line(sense = 'D', fill?: string): string {
    return pnmLine({ sense, ...(fill === undefined ? {} : { label: fill.repeat(25) }) });
  }
  function amount(value: string): string {
    return value.padStart(20);
  }
  /** Pièce équilibrée D 100.00 / C 100.00 (même référence). */
  function balanced(): string {
    return pnmLine({ sense: 'D' }) + crlf + pnmLine({ sense: 'C' }) + crlf;
  }
  const crlf = '\r\n';
  const REFERENCE_LINE = 'VTE131126FC34210000     XCLI0001      FAC2026000001FACTURE ATLAS SARL       V120127D             1234.50N   ';

  it('largeur imposée : 108', () => {
    expect(PNM_LINE_WIDTH).toBe(108);
    expect(line()).toHaveLength(108);
    expect(REFERENCE_LINE).toHaveLength(108);
  });

  it('la ligne de référence du propriétaire est reproduite par le gabarit', () => {
    expect(pnmLine({ amountField: amount('1234.50') })).toBe(REFERENCE_LINE);
    expect(REFERENCE_LINE.slice(84, 104)).toBe(amount('1234.50'));
  });

  it('accepte la ligne de référence équilibrée par sa contrepartie', () => {
    const counterpart = `${REFERENCE_LINE.slice(0, 83)}C${REFERENCE_LINE.slice(84)}`;
    expect(assertValidSage100PnmBuffer(REFERENCE_LINE + crlf + counterpart + crlf)).toEqual({ linesCount: 2 });
  });

  it('accepte une pièce D/C équilibrée', () => {
    expect(assertValidSage100PnmBuffer(balanced())).toEqual({ linesCount: 2 });
    expect(assertValidSage100PnmBuffer(line('D') + crlf + line('C') + crlf)).toEqual({ linesCount: 2 });
  });

  it('accepte des espaces et la ponctuation ASCII imprimable dans le libellé', () => {
    expect(assertValidSage100PnmBuffer(line('D', ' ') + crlf + line('C', ' ') + crlf).linesCount).toBe(2);
    expect(assertValidSage100PnmBuffer(line('D', '~') + crlf + line('C', '~') + crlf).linesCount).toBe(2);
  });

  it('accepte un tampon binaire (Uint8Array) conforme', () => {
    expect(assertValidSage100PnmBuffer(Buffer.from(balanced(), 'ascii')).linesCount).toBe(2);
  });

  it('refuse un tampon vide', () => {
    expect(() => assertValidSage100PnmBuffer('')).toThrow(/PNM_EMPTY_FILE/);
    expect(() => assertValidSage100PnmBuffer(new Uint8Array())).toThrow(/PNM_EMPTY_FILE/);
    expect(() => assertValidSage100PnmBuffer(crlf)).toThrow(/PNM_EMPTY_LINE/);
  });

  it('refuse une ligne trop courte ou trop longue', () => {
    expect(() => assertValidSage100PnmBuffer(line().slice(0, 107) + crlf)).toThrow(/PNM_INVALID_LINE_LENGTH/);
    expect(() => assertValidSage100PnmBuffer(line() + 'X' + crlf)).toThrow(/PNM_INVALID_LINE_LENGTH/);
    expect(() => assertValidSage100PnmBuffer(line() + crlf + line().slice(0, 50) + crlf)).toThrow(/Ligne 2/);
  });

  it('refuse la fin de ligne LF seule, CR seul, ou l\'absence de CRLF final', () => {
    expect(() => assertValidSage100PnmBuffer(line() + '\n')).toThrow(/PNM_MISSING_TRAILING_CRLF/);
    expect(() => assertValidSage100PnmBuffer(line() + '\r')).toThrow(/PNM_MISSING_TRAILING_CRLF/);
    expect(() => assertValidSage100PnmBuffer(line())).toThrow(/PNM_MISSING_TRAILING_CRLF/);
    expect(() => assertValidSage100PnmBuffer(line() + '\n' + line() + crlf)).toThrow(/PNM_/);
    expect(() => assertValidSage100PnmBuffer(line() + crlf + line() + '\n')).toThrow(/PNM_MISSING_TRAILING_CRLF/);
  });

  it('refuse une ligne vide intermédiaire ou finale', () => {
    expect(() => assertValidSage100PnmBuffer(line() + crlf + crlf + line() + crlf)).toThrow(/PNM_EMPTY_LINE: Ligne 2/);
    expect(() => assertValidSage100PnmBuffer(line() + crlf + crlf)).toThrow(/PNM_EMPTY_LINE: Ligne 2/);
  });

  it('refuse tout octet non ASCII, accentué ou de contrôle', () => {
    const accented = `${'X'.repeat(83)}D${'X'.repeat(23)}é`;
    expect(accented).toHaveLength(108);
    expect(() => assertValidSage100PnmBuffer(accented + crlf)).toThrow(/PNM_NON_ASCII_CHAR/);
    expect(() => assertValidSage100PnmBuffer(Buffer.from(accented + crlf, 'utf8'))).toThrow(/PNM_/);
    expect(() => assertValidSage100PnmBuffer(Buffer.from([...Buffer.from(line().slice(0, 107), 'ascii'), 0x80, 0x0d, 0x0a]))).toThrow(/PNM_NON_ASCII_CHAR/);
    expect(() => assertValidSage100PnmBuffer(line().slice(0, 107) + '\t' + crlf)).toThrow(/PNM_NON_ASCII_CHAR/);
    expect(() => assertValidSage100PnmBuffer(line().slice(0, 107) + '\u0000' + crlf)).toThrow(/PNM_NON_ASCII_CHAR/);
    expect(() => assertValidSage100PnmBuffer(line().slice(0, 107) + '€' + crlf)).toThrow(/PNM_NON_ASCII_CHAR/);
  });

  it('refuse un sens Débit/Crédit autre que D ou C en position 84', () => {
    expect(() => assertValidSage100PnmBuffer(line('X') + crlf)).toThrow(/PNM_INVALID_DEBIT_CREDIT_FLAG/);
    expect(() => assertValidSage100PnmBuffer(line('d') + crlf)).toThrow(/PNM_INVALID_DEBIT_CREDIT_FLAG/);
  });
});

describe('assertValidSage100PnmBuffer : montant (85-104), type (105), zone réservée (106-108), équilibre par pièce', () => {
  const crlf = '\r\n';

  function pnm(options: {
    readonly sense?: string;
    readonly amountField?: string;
    readonly flag?: string;
    readonly reserved?: string;
    readonly reference?: string;
    readonly journal?: string;
    readonly date?: string;
  } = {}): string {
    return [
      (options.journal ?? 'VTE'),
      (options.date ?? '131126'),
      'FC',
      '34210000'.padEnd(13),
      'X',
      'CLI0001'.padEnd(13),
      (options.reference ?? 'FAC2026000001').padEnd(13),
      'FACTURE ATLAS SARL'.padEnd(25),
      'V',
      '120127',
      options.sense ?? 'D',
      options.amountField ?? '100.00'.padStart(20),
      options.flag ?? 'N',
      options.reserved ?? '   ',
    ].join('');
  }
  function right(value: string): string {
    return value.padStart(20);
  }
  function entry(sense: 'D' | 'C', value: string, reference = 'FAC2026000001'): string {
    return pnm({ sense, amountField: right(value), reference }) + crlf;
  }
  function failsWith(content: string, code: string): void {
    expect(() => assertValidSage100PnmBuffer(content)).toThrow(new RegExp(`^${code}`));
  }

  it('accepte la ligne de référence du propriétaire avec sa contrepartie', () => {
    expect(assertValidSage100PnmBuffer(entry('D', '1234.50') + entry('C', '1234.50')).linesCount).toBe(2);
  });

  describe('montant : cadré à droite sur 20 caractères, positif, 2 décimales', () => {
    const invalid: readonly (readonly [string, string])[] = [
      ['sans décimales', right('1234')],
      ['une seule décimale', right('1234.5')],
      ['trois décimales', right('1234.500')],
      ['négatif', right('-1234.50')],
      ['signe plus', right('+1234.50')],
      ['nul', right('0.00')],
      ['nul avec zéros', right('000.00')],
      ['virgule décimale', right('1234,50')],
      ['séparateur de milliers (virgule)', right('1,234.50')],
      ['séparateur de milliers (espace)', right('1 234.50')],
      ['séparateur de milliers (point)', right('1.234.50')],
      ['non cadré à droite (espaces à droite)', '1234.50'.padEnd(20)],
      ['cadré à gauche avec zone décalée', ` ${'1234.50'.padEnd(19)}`],
      ['vide', ' '.repeat(20)],
      ['point seul', right('.50')],
      ['lettres', right('12A4.50')],
      ['notation scientifique', right('1e3.00')],
    ];
    for (const [label, field] of invalid) {
      it(`refuse un montant ${label}`, () => {
        expect(field).toHaveLength(20);
        failsWith(pnm({ amountField: field }) + crlf, 'PNM_INVALID_AMOUNT_FIELD');
      });
    }

    it('refuse un montant sur 21 caractères (ligne trop longue) ou 19 (ligne trop courte)', () => {
      failsWith(pnm({ amountField: ` ${right('100.00')}` }) + crlf, 'PNM_INVALID_LINE_LENGTH');
      failsWith(pnm({ amountField: right('100.00').slice(1) }) + crlf, 'PNM_INVALID_LINE_LENGTH');
    });

    it('refuse un montant de 19 caractères dont la ligne reste à 108 (décalage d\'une zone)', () => {
      const shifted = pnm({ amountField: right('100.00').slice(1), flag: 'N ' });
      expect(shifted).toHaveLength(108);
      failsWith(shifted + crlf, 'PNM_INVALID_AMOUNT_FIELD');
    });

    it('accepte le plus petit montant (0.01) et un montant sur 20 caractères pleins', () => {
      expect(assertValidSage100PnmBuffer(entry('D', '0.01') + entry('C', '0.01')).linesCount).toBe(2);
      const full = `${'1'.repeat(17)}.00`;
      expect(full).toHaveLength(20);
      expect(assertValidSage100PnmBuffer(
        pnm({ sense: 'D', amountField: full }) + crlf + pnm({ sense: 'C', amountField: full }) + crlf,
      ).linesCount).toBe(2);
    });
  });

  it('refuse une position 105 autre que N', () => {
    for (const flag of ['X', 'n', ' ', '0']) {
      failsWith(pnm({ flag }) + crlf, 'PNM_INVALID_ENTRY_TYPE_FLAG');
    }
  });

  it('refuse une zone réservée (106 à 108) non vide', () => {
    for (const reserved of ['X  ', ' X ', '  X', '000', '.  ']) {
      failsWith(pnm({ reserved }) + crlf, 'PNM_INVALID_RESERVED_ZONE');
    }
  });

  describe('équilibre par pièce (code journal, date, référence)', () => {
    it('accepte une pièce équilibrée sur plusieurs lignes (D 100.00 + C 60.00 + C 40.00)', () => {
      expect(assertValidSage100PnmBuffer(entry('D', '100.00') + entry('C', '60.00') + entry('C', '40.00')).linesCount).toBe(3);
    });

    it('accepte des lignes dans un ordre quelconque', () => {
      expect(assertValidSage100PnmBuffer(entry('C', '40.00') + entry('D', '100.00') + entry('C', '60.00')).linesCount).toBe(3);
    });

    it('refuse une pièce déséquilibrée d\'un centime', () => {
      failsWith(entry('D', '100.00') + entry('C', '60.00') + entry('C', '39.99'), 'PNM_UNBALANCED_PIECE');
      failsWith(entry('D', '100.00') + entry('C', '60.00') + entry('C', '40.01'), 'PNM_UNBALANCED_PIECE');
    });

    it('somme en centimes entiers : 0.10 + 0.20 est égal à 0.30, sans dérive de flottant', () => {
      expect(assertValidSage100PnmBuffer(entry('D', '0.10') + entry('D', '0.20') + entry('C', '0.30')).linesCount).toBe(3);
    });

    it('somme exacte sur de très grands montants (au-delà de 2^53 centimes)', () => {
      const big = '90071992547409.93';
      expect(assertValidSage100PnmBuffer(entry('D', big) + entry('C', '90071992547409.92') + entry('C', '0.01')).linesCount).toBe(3);
      failsWith(entry('D', big) + entry('C', '90071992547409.92') + entry('C', '0.02'), 'PNM_UNBALANCED_PIECE');
    });

    it('équilibre deux pièces distinctes (références différentes) séparément', () => {
      const two = entry('D', '100.00', 'FAC2026000001') + entry('C', '100.00', 'FAC2026000001')
        + entry('D', '50.00', 'FAC2026000002') + entry('C', '50.00', 'FAC2026000002');
      expect(assertValidSage100PnmBuffer(two).linesCount).toBe(4);
    });

    it('refuse deux pièces qui ne s\'équilibrent qu\'ensemble', () => {
      failsWith(entry('D', '100.00', 'FAC2026000001') + entry('C', '50.00', 'FAC2026000001')
        + entry('D', '50.00', 'FAC2026000002') + entry('C', '100.00', 'FAC2026000002'), 'PNM_UNBALANCED_PIECE');
    });

    it('distingue aussi la pièce par le code journal et par la date', () => {
      failsWith(
        pnm({ sense: 'D', journal: 'VTE' }) + crlf + pnm({ sense: 'C', journal: 'ACH' }) + crlf,
        'PNM_UNBALANCED_PIECE',
      );
      failsWith(
        pnm({ sense: 'D', date: '131126' }) + crlf + pnm({ sense: 'C', date: '141126' }) + crlf,
        'PNM_UNBALANCED_PIECE',
      );
    });

    it('refuse une pièce de seulement des débits, ou seulement des crédits', () => {
      failsWith(entry('D', '100.00'), 'PNM_UNBALANCED_PIECE');
      failsWith(entry('D', '100.00') + entry('D', '50.00'), 'PNM_UNBALANCED_PIECE');
      failsWith(entry('C', '100.00') + entry('C', '100.00'), 'PNM_UNBALANCED_PIECE');
    });

    it('signale la pièce fautive dans le message', () => {
      expect(() => assertValidSage100PnmBuffer(entry('D', '100.00') + entry('C', '99.99'))).toThrow(/FAC2026000001.*10000.*9999/);
    });

    it('les contrôles de ligne priment sur l\'équilibre', () => {
      failsWith(entry('D', '100.00') + pnm({ sense: 'C', flag: 'X' }) + crlf, 'PNM_INVALID_ENTRY_TYPE_FLAG');
    });
  });
});
