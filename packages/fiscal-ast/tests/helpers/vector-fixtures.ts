import { divRoundHalfUpBigInt } from '@fisca/shared-types';
import { CONTRADICTORY_VECTOR_ROLES, addDays } from '../../src/index.ts';
import { GOLDEN_FILE, LEGAL_TERMS_DAYS, aeParamsFromGolden, cashParamsFromGolden, firstCase, rasParamsFromGolden, readNumber, readText, vatRatesFromGolden } from './rule-fixtures.ts';
import { FIXTURE_EFFECTIVE_FROM } from './wiki-fixtures.ts';

/**
 * Vecteurs contradictoires de TEST (données). Toute valeur fiscale vient des vecteurs d'or de qa-harness (lecture seule) ;
 * les valeurs attendues sont dérivées du fichier d'or ou d'une formule entière écrite ici, jamais de la sortie du moteur.
 */
const { POSITIVE_NOMINAL, NEGATIVE_COUNTEREXAMPLE, BOUNDARY_LIMIT } = CONTRADICTORY_VECTOR_ROLES;

/** Unité de mesure : 10 000 points de base = 100 %. */
const BPS_UNIT = 10000n;

export interface TestVector {
  readonly role: string;
  readonly operation: string;
  readonly input: Record<string, unknown>;
  readonly expected: { readonly matched: boolean; readonly adjustmentCents: number };
}

function vector(role: string, operation: string, input: Record<string, unknown>, matched: boolean, adjustmentCents: number): TestVector {
  return { role, operation, input, expected: { matched, adjustmentCents } };
}

function half(value: number): number {
  return Number(divRoundHalfUpBigInt(BigInt(value), 2n));
}

/** TVA incluse dans un TTC, au taux donné (formule entière, demi supérieur). */
function vatInside(ttcCents: number, vatRateBps: number): number {
  return Number(divRoundHalfUpBigInt(BigInt(ttcCents) * BigInt(vatRateBps), BPS_UNIT + BigInt(vatRateBps)));
}

// ------------------------------------------------------------------ plafond d'espèces

export function goldenCashInput(): Record<string, number | string> {
  const input = firstCase('VEC-CGI-01').input;
  return {
    paymentDateIso: GOLDEN_FILE.ruleDate,
    invoiceHtCents: readNumber(input, 'invoiceHtCents'),
    invoiceVatCents: readNumber(input, 'invoiceVatCents'),
    vatRateBps: readNumber(input, 'vatRateBps'),
    alreadyPaidCashTodayCents: readNumber(input, 'alreadyPaidCashTodayTtcCents'),
    alreadyPaidCashMonthCents: readNumber(input, 'alreadyPaidCashMonthTtcCents'),
  };
}

export function cashInputForTtc(ttcCents: number): Record<string, number | string> {
  const golden = goldenCashInput();
  const rate = Number(golden['vatRateBps']);
  const vat = vatInside(ttcCents, rate);
  return { ...golden, invoiceHtCents: ttcCents - vat, invoiceVatCents: vat };
}

export function cashCap(): number {
  return cashParamsFromGolden().dailyCapCents;
}

/** Plafond journalier de la règle de test : 500 000 centimes (golden) contre 500 001. */
export function cashVectors(): readonly TestVector[] {
  const op = 'evaluateCashCeiling';
  const cap = cashCap();
  const goldenInput = goldenCashInput();
  const goldenTtc = Number(goldenInput['invoiceHtCents']) + Number(goldenInput['invoiceVatCents']);
  const goldenAllowed = readNumber(firstCase('VEC-CGI-01').expected, 'allowedTtcCents');
  return [
    vector(POSITIVE_NOMINAL, op, goldenInput, true, goldenTtc - goldenAllowed),
    vector(NEGATIVE_COUNTEREXAMPLE, op, cashInputForTtc(half(cap)), false, 0),
    vector(BOUNDARY_LIMIT, op, cashInputForTtc(cap), false, 0),
  ];
}

export function cashJustAboveBoundary(): TestVector {
  return vector(BOUNDARY_LIMIT, 'evaluateCashCeiling', cashInputForTtc(cashCap() + 1), true, 1);
}

// ------------------------------------------------------------------ Loi 69-21 : échéance

export const DELIVERY_DATE = '2026-01-01';

export function legalDueDate(): string {
  return addDays(DELIVERY_DATE, LEGAL_TERMS_DAYS.standard, 'test');
}

export function delayInput(asOfDateIso: string): Record<string, string> {
  return { serviceDeliveryDateIso: DELIVERY_DATE, asOfDateIso, termKind: 'STANDARD' };
}

export function delayStatusVectors(): readonly TestVector[] {
  const op = 'evaluatePaymentDelayStatus';
  const goldenDelayDays = readNumber(firstCase('VEC-CGI-02').context ?? {}, 'delayDays');
  const due = legalDueDate();
  return [
    vector(POSITIVE_NOMINAL, op, delayInput(addDays(due, goldenDelayDays, 'test')), true, 0),
    vector(NEGATIVE_COUNTEREXAMPLE, op, delayInput(DELIVERY_DATE), false, 0),
    vector(BOUNDARY_LIMIT, op, delayInput(due), false, 0),
  ];
}

export function delayJustAfterDue(): TestVector {
  return vector(BOUNDARY_LIMIT, 'evaluatePaymentDelayStatus', delayInput(addDays(legalDueDate(), 1, 'test')), true, 0);
}

export function delayPenaltyVectors(): readonly TestVector[] {
  const op = 'evaluatePaymentDelayPenalty';
  const goldenCase = firstCase('VEC-CGI-02');
  const base = {
    asOfDateIso: GOLDEN_FILE.ruleDate,
    unpaidTtcCents: readNumber(goldenCase.input, 'unpaidTtcCents'),
    startedMonthsOfDelay: readNumber(goldenCase.input, 'startedMonthsOfDelay'),
    hasDocumentedDispute: false,
  };
  return [
    vector(POSITIVE_NOMINAL, op, base, true, readNumber(goldenCase.expected, 'penaltyCents')),
    vector(NEGATIVE_COUNTEREXAMPLE, op, { ...base, hasDocumentedDispute: true }, false, 0),
    vector(BOUNDARY_LIMIT, op, { ...base, startedMonthsOfDelay: 0 }, false, 0),
  ];
}

// ------------------------------------------------------------------ RAS-TVA

function rasInputForTtc(ttcCents: number): Record<string, number | string> {
  const golden = firstCase('VEC-CGI-03').input;
  return {
    paymentDateIso: readText(golden, 'paymentDateIso'),
    invoiceTtcCents: ttcCents,
    invoiceVatCents: vatInside(ttcCents, readNumber(firstCase('VEC-CGI-01').input, 'vatRateBps')),
    taxClearanceIssuedDateIso: readText(golden, 'taxClearanceIssuedDateIso'),
  };
}

export function rasVectors(): readonly TestVector[] {
  const op = 'evaluateRasTva';
  const params = rasParamsFromGolden();
  const goldenCase = firstCase('VEC-CGI-03');
  const goldenInput = {
    paymentDateIso: readText(goldenCase.input, 'paymentDateIso'),
    invoiceTtcCents: readNumber(goldenCase.input, 'invoiceTtcCents'),
    invoiceVatCents: readNumber(goldenCase.input, 'invoiceVatCents'),
    taxClearanceIssuedDateIso: readText(goldenCase.input, 'taxClearanceIssuedDateIso'),
  };
  const boundaryInput = rasInputForTtc(params.thresholdCents);
  const boundaryRas = Number(divRoundHalfUpBigInt(BigInt(Number(boundaryInput['invoiceVatCents'])) * BigInt(params.reducedBps), BPS_UNIT));
  return [
    vector(POSITIVE_NOMINAL, op, goldenInput, true, readNumber(goldenCase.expected, 'rasVatCents')),
    vector(NEGATIVE_COUNTEREXAMPLE, op, rasInputForTtc(params.thresholdCents - 1), false, 0),
    vector(BOUNDARY_LIMIT, op, boundaryInput, true, boundaryRas),
  ];
}

// ------------------------------------------------------------------ auto-entrepreneur

export function aeVectors(): readonly TestVector[] {
  const op = 'evaluateAutoEntrepreneurThreshold';
  const params = aeParamsFromGolden();
  const goldenCase = firstCase('VEC-CGI-04');
  const at = (cumul: number, invoice: number): Record<string, number | string> => ({ invoiceDateIso: GOLDEN_FILE.ruleDate, cumulBeforeInvoiceCents: cumul, invoiceCents: invoice });
  return [
    vector(POSITIVE_NOMINAL, op, at(readNumber(goldenCase.input, 'cumulBeforeInvoiceCents'), readNumber(goldenCase.input, 'invoiceCents')), true, readNumber(goldenCase.expected, 'withholdingCents')),
    vector(NEGATIVE_COUNTEREXAMPLE, op, at(0, half(params.thresholdCents)), false, 0),
    vector(BOUNDARY_LIMIT, op, at(0, params.thresholdCents), false, 0),
  ];
}

/** Un centime au-dessus du seuil : surplus 1 (matched), retenue arrondie à 0 centime. */
export function aeJustAboveThreshold(): TestVector {
  return vector(BOUNDARY_LIMIT, 'evaluateAutoEntrepreneurThreshold', { invoiceDateIso: GOLDEN_FILE.ruleDate, cumulBeforeInvoiceCents: 0, invoiceCents: aeParamsFromGolden().thresholdCents + 1 }, true, 0);
}

// ------------------------------------------------------------------ TVA

export function vatVectors(): readonly TestVector[] {
  const op = 'evaluateVatRate';
  const accepted = vatRatesFromGolden();
  const rate = accepted[0] ?? 0;
  const refused = firstCase('VEC-CGI-05').input;
  return [
    vector(POSITIVE_NOMINAL, op, { issueDateIso: GOLDEN_FILE.ruleDate, vatRateBps: rate }, true, 0),
    vector(NEGATIVE_COUNTEREXAMPLE, op, { issueDateIso: readText(refused, 'issueDateIso'), vatRateBps: readNumber(refused, 'vatRateBps') }, false, 0),
    vector(BOUNDARY_LIMIT, op, { issueDateIso: FIXTURE_EFFECTIVE_FROM, vatRateBps: rate }, true, 0),
  ];
}
