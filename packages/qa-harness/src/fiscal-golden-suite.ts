import { readFileSync } from 'node:fs';
import {
  FiscaIntegerError,
  applyBps,
  assertValidVatRateForIssueYear,
  bps,
  centimes,
  divRoundHalfUpBigInt,
  ensureSafeInteger,
} from '@fisca/shared-types';

/**
 * Moteur d'assertions fiscales entières (Doc_14 § 11, corrigé par l'ERRATA) : juge de référence des vecteurs d'or.
 * - Zéro flottant (ADR-03) : toute entrée numérique passe par ensureSafeInteger, toute division par divRoundHalfUpBigInt (D-09).
 * - Zéro règle en dur (ADR-04) : plafonds, seuils, taux et durées sont des paramètres d'entrée (lignes datées de D1).
 * - Les valeurs attendues viennent du JSON ; ce module ne les produit jamais.
 */

// ------------------------------------------------------------------ types JSON

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export const GOLDEN_STATES = ['RECOUPÉ', 'NON RECOUPÉ', 'PROVISOIRE'] as const;
export type GoldenState = (typeof GOLDEN_STATES)[number];

export const GOLDEN_KINDS = [
  'ART_11_CASH_CEILING',
  'LAW_69_21_PENALTY',
  'ART_117_RAS_TVA',
  'AUTO_ENTREPRENEUR_THRESHOLD',
  'LF2026_VAT_RATE',
  'BTP_SETTLEMENT',
] as const;
export type GoldenKind = (typeof GOLDEN_KINDS)[number];

export interface GoldenCase {
  readonly name: string;
  readonly context?: JsonObject;
  readonly input: JsonObject;
  readonly expected: JsonObject;
}

export interface GoldenVector {
  readonly id: string;
  readonly label: string;
  readonly law: string;
  readonly ruleDate: string;
  readonly state: GoldenState;
  readonly stateNote?: string;
  readonly assumptions?: readonly string[];
  readonly kind: GoldenKind;
  readonly calc: string;
  readonly cases: readonly GoldenCase[];
}

export interface GoldenVectorFile {
  readonly schema: string;
  readonly package: string;
  readonly ruleDate: string;
  readonly note?: string;
  readonly vectors: readonly GoldenVector[];
}

export class GoldenVectorFormatError extends Error {
  constructor(detail: string) {
    super(`GOLDEN_VECTOR_FORMAT: ${detail}`);
    this.name = 'GoldenVectorFormatError';
  }
}

// ------------------------------------------------------------------ lecture et validation du JSON

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(source: { readonly [key: string]: unknown }, key: string, where: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GoldenVectorFormatError(`${where} : le champ « ${key} » doit être un texte non vide.`);
  }
  return value;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function parseIsoDate(iso: string, label: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) {
    throw new GoldenVectorFormatError(`${label} : date « ${iso} » hors format AAAA-MM-JJ.`);
  }
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new GoldenVectorFormatError(`${label} : date « ${iso} » impossible au calendrier.`);
  }
  return { year, month, day };
}

function formatIsoDate(date: CalendarDate): string {
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

function dateKey(date: CalendarDate): number {
  return date.year * 10000 + date.month * 100 + date.day;
}

/**
 * Ajoute des mois entiers à une date ISO ; si le jour n'existe pas dans le mois d'arrivée,
 * il est ramené au dernier jour du mois (31 août + 6 mois = 28 février). Calcul entier, sans Date.
 */
export function addMonthsClamped(iso: string, months: number): string {
  const start = parseIsoDate(iso, 'addMonthsClamped');
  const monthIndex = start.year * 12 + (start.month - 1) + ensureSafeInteger(months, 'addMonthsClamped.months');
  const year = Math.trunc(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return formatIsoDate({ year, month, day: Math.min(start.day, daysInMonth(year, month)) });
}

function toJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return ensureSafeInteger(value, path);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toJsonValue(item, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = toJsonValue(item, `${path}.${key}`);
    }
    return out;
  }
  throw new GoldenVectorFormatError(`${path} : valeur JSON non admise.`);
}

function requireObject(source: { readonly [key: string]: unknown }, key: string, where: string): JsonObject {
  const value = source[key];
  if (!isRecord(value)) {
    throw new GoldenVectorFormatError(`${where} : le champ « ${key} » doit être un objet.`);
  }
  const converted = toJsonValue(value, `${where}.${key}`);
  if (converted === null || typeof converted !== 'object' || Array.isArray(converted)) {
    throw new GoldenVectorFormatError(`${where} : le champ « ${key} » doit être un objet.`);
  }
  return converted as JsonObject;
}

function parseCase(raw: unknown, where: string): GoldenCase {
  if (!isRecord(raw)) {
    throw new GoldenVectorFormatError(`${where} doit être un objet.`);
  }
  const name = requireString(raw, 'name', where);
  const input = requireObject(raw, 'input', where);
  const expected = requireObject(raw, 'expected', where);
  if (Object.keys(expected).length === 0) {
    throw new GoldenVectorFormatError(`${where} : « expected » ne peut pas être vide.`);
  }
  if (raw['context'] === undefined) {
    return { name, input, expected };
  }
  return { name, context: requireObject(raw, 'context', where), input, expected };
}

function parseVector(raw: unknown, index: number): GoldenVector {
  const where = `vectors[${index}]`;
  if (!isRecord(raw)) {
    throw new GoldenVectorFormatError(`${where} doit être un objet.`);
  }
  const id = requireString(raw, 'id', where);
  const label = `${where} (${id})`;
  const state = requireString(raw, 'state', label);
  if (!(GOLDEN_STATES as readonly string[]).includes(state)) {
    throw new GoldenVectorFormatError(`${label} : state « ${state} » inconnu (attendu : ${GOLDEN_STATES.join(', ')}).`);
  }
  const kind = requireString(raw, 'kind', label);
  if (!(GOLDEN_KINDS as readonly string[]).includes(kind)) {
    throw new GoldenVectorFormatError(`${label} : kind « ${kind} » inconnu.`);
  }
  const ruleDate = requireString(raw, 'ruleDate', label);
  parseIsoDate(ruleDate, `${label} ruleDate`);
  const rawCases = raw['cases'];
  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    throw new GoldenVectorFormatError(`${label} : « cases » doit contenir au moins un cas.`);
  }
  const base = {
    id,
    label: requireString(raw, 'label', label),
    law: requireString(raw, 'law', label),
    ruleDate,
    state: state as GoldenState,
    kind: kind as GoldenKind,
    calc: requireString(raw, 'calc', label),
    cases: rawCases.map((item, caseIndex) => parseCase(item, `${label}.cases[${caseIndex}]`)),
  };
  const stateNote = raw['stateNote'];
  const assumptions = raw['assumptions'];
  return {
    ...base,
    ...(typeof stateNote === 'string' ? { stateNote } : {}),
    ...(Array.isArray(assumptions) ? { assumptions: assumptions.filter((a): a is string => typeof a === 'string') } : {}),
  };
}

/** Parse et valide un fichier `*.vectors.json` (article, date de la règle, état, calcul, entrées et sorties entières). */
export function parseGoldenVectorFile(text: string): GoldenVectorFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new GoldenVectorFormatError(`JSON invalide : ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return parseValidated(raw);
  } catch (error) {
    if (error instanceof FiscaIntegerError) {
      throw new GoldenVectorFormatError(error.message);
    }
    throw error;
  }
}

function parseValidated(raw: unknown): GoldenVectorFile {
  if (!isRecord(raw)) {
    throw new GoldenVectorFormatError('la racine doit être un objet.');
  }
  const ruleDate = requireString(raw, 'ruleDate', 'racine');
  parseIsoDate(ruleDate, 'racine ruleDate');
  const rawVectors = raw['vectors'];
  if (!Array.isArray(rawVectors) || rawVectors.length === 0) {
    throw new GoldenVectorFormatError('« vectors » doit contenir au moins un vecteur.');
  }
  const vectors = rawVectors.map((item, index) => parseVector(item, index));
  const seen = new Set<string>();
  for (const vector of vectors) {
    if (seen.has(vector.id)) {
      throw new GoldenVectorFormatError(`identifiant dupliqué : ${vector.id}.`);
    }
    seen.add(vector.id);
  }
  const note = raw['note'];
  return {
    schema: requireString(raw, 'schema', 'racine'),
    package: requireString(raw, 'package', 'racine'),
    ruleDate,
    ...(typeof note === 'string' ? { note } : {}),
    vectors,
  };
}

export function loadGoldenVectorFile(path: string | URL): GoldenVectorFile {
  return parseGoldenVectorFile(readFileSync(path, 'utf8'));
}

// ------------------------------------------------------------------ lecture typée des entrées

function readInt(input: JsonObject, key: string): number {
  const value = input[key];
  if (value === undefined) {
    throw new GoldenVectorFormatError(`entrée « ${key} » absente.`);
  }
  if (typeof value !== 'number') {
    throw new GoldenVectorFormatError(`entrée « ${key} » : entier attendu.`);
  }
  return ensureSafeInteger(value, key);
}

function readString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== 'string') {
    throw new GoldenVectorFormatError(`entrée « ${key} » : texte attendu.`);
  }
  return value;
}

function readBool(input: JsonObject, key: string): boolean {
  const value = input[key];
  if (typeof value !== 'boolean') {
    throw new GoldenVectorFormatError(`entrée « ${key} » : booléen attendu.`);
  }
  return value;
}

// ------------------------------------------------------------------ 1. Art. 11-II : plafond d'espèces

export interface CashCeilingInput {
  readonly invoiceHtCents: number;
  readonly invoiceVatCents: number;
  readonly vatRateBps: number;
  readonly alreadyPaidCashTodayTtcCents: number;
  readonly alreadyPaidCashMonthTtcCents: number;
  /** Plafond journalier TTC : ligne datée de D1, jamais codé en dur (ADR-04). */
  readonly dailyCapTtcCents: number;
  /** Plafond mensuel TTC par fournisseur : ligne datée de D1. */
  readonly monthlyCapTtcCents: number;
}

export interface CashCeilingOutput {
  readonly allowedTtcCents: number;
  readonly deductibleHtCents: number;
  readonly recoverableVatCents: number;
  readonly reintegratedTable3HtCents: number;
  readonly nonRecoverableVatCents: number;
}

export function computeArt11CashSplit(input: CashCeilingInput): CashCeilingOutput {
  const htCents = ensureSafeInteger(input.invoiceHtCents, 'invoiceHtCents');
  const vatCents = ensureSafeInteger(input.invoiceVatCents, 'invoiceVatCents');
  const rateBps = bps(input.vatRateBps);
  const paidToday = ensureSafeInteger(input.alreadyPaidCashTodayTtcCents, 'alreadyPaidCashTodayTtcCents');
  const paidMonth = ensureSafeInteger(input.alreadyPaidCashMonthTtcCents, 'alreadyPaidCashMonthTtcCents');
  const dailyCap = ensureSafeInteger(input.dailyCapTtcCents, 'dailyCapTtcCents');
  const monthlyCap = ensureSafeInteger(input.monthlyCapTtcCents, 'monthlyCapTtcCents');

  const totalTtcCents = htCents + vatCents;
  const remainingDaily = Math.max(0, dailyCap - paidToday);
  const remainingMonthly = Math.max(0, monthlyCap - paidMonth);
  const allowedTtcCents = Math.min(totalTtcCents, remainingDaily, remainingMonthly);

  if (allowedTtcCents === totalTtcCents) {
    return {
      allowedTtcCents,
      deductibleHtCents: htCents,
      recoverableVatCents: vatCents,
      reintegratedTable3HtCents: 0,
      nonRecoverableVatCents: 0,
    };
  }

  const deductibleHtCents = Number(divRoundHalfUpBigInt(BigInt(allowedTtcCents) * 10000n, BigInt(10000 + rateBps)));
  const recoverableVatCents = allowedTtcCents - deductibleHtCents;
  return {
    allowedTtcCents,
    deductibleHtCents,
    recoverableVatCents,
    reintegratedTable3HtCents: htCents - deductibleHtCents,
    nonRecoverableVatCents: vatCents - recoverableVatCents,
  };
}

// ------------------------------------------------------------------ 2. Loi 69-21 : pénalité de retard

export interface Law6921Input {
  readonly unpaidTtcCents: number;
  readonly startedMonthsOfDelay: number;
  /** Taux directeur de Bank Al-Maghrib en bps, à sa valeur en vigueur (donnée datée de D1). */
  readonly bamBaseRateBps: number;
  /** Majoration par mois entamé supplémentaire en bps (85 selon les spécifications). */
  readonly monthlyIncrementBps: number;
  readonly hasDocumentedDisputeR2: boolean;
}

export interface Law6921Output {
  readonly totalPenaltyBps: number;
  readonly penaltyCents: number;
}

const BPS_DENOMINATOR_CENTS_PER_MAD = 1000000n; // 100 centimes × 10 000 bps

export function computeLaw6921Penalty(input: Law6921Input): Law6921Output {
  const unpaid = ensureSafeInteger(input.unpaidTtcCents, 'unpaidTtcCents');
  const months = ensureSafeInteger(input.startedMonthsOfDelay, 'startedMonthsOfDelay');
  const baseBps = ensureSafeInteger(input.bamBaseRateBps, 'bamBaseRateBps');
  const incrementBps = ensureSafeInteger(input.monthlyIncrementBps, 'monthlyIncrementBps');
  if (input.hasDocumentedDisputeR2 || months <= 0 || unpaid <= 0) {
    return { totalPenaltyBps: 0, penaltyCents: 0 };
  }
  const totalPenaltyBps = baseBps + (months - 1) * incrementBps;
  const product = BigInt(unpaid) * BigInt(totalPenaltyBps);
  // Plafond au dirham : ceil(p / D) = floor((p + D − 1) / D) = divRoundHalfUp(p + D/2 − 1, D) pour D pair.
  const wholeDirhams = divRoundHalfUpBigInt(product + BPS_DENOMINATOR_CENTS_PER_MAD / 2n - 1n, BPS_DENOMINATOR_CENTS_PER_MAD);
  return { totalPenaltyBps, penaltyCents: Number(wholeDirhams * 100n) };
}

// ------------------------------------------------------------------ 3. Art. 117 : RAS-TVA

export interface RasTvaInput {
  readonly invoiceTtcCents: number;
  readonly invoiceVatCents: number;
  readonly paymentDateIso: string;
  readonly taxClearanceIssuedDateIso?: string;
  /** Seuil TTC en dessous duquel aucune retenue ne s'applique (ligne datée de D1). */
  readonly exclusionThresholdTtcCents: number;
  readonly attestationValidityMonths: number;
  readonly reducedRasRateBps: number;
  readonly fullRasRateBps: number;
}

export interface RasTvaOutput {
  readonly rasRateBps: number;
  readonly rasVatCents: number;
}

export function computeRasTva(input: RasTvaInput): RasTvaOutput {
  const ttc = ensureSafeInteger(input.invoiceTtcCents, 'invoiceTtcCents');
  const vat = ensureSafeInteger(input.invoiceVatCents, 'invoiceVatCents');
  const threshold = ensureSafeInteger(input.exclusionThresholdTtcCents, 'exclusionThresholdTtcCents');
  const validityMonths = ensureSafeInteger(input.attestationValidityMonths, 'attestationValidityMonths');
  const reducedBps = bps(input.reducedRasRateBps);
  const fullBps = bps(input.fullRasRateBps);
  if (ttc < threshold || vat === 0) {
    return { rasRateBps: 0, rasVatCents: 0 };
  }

  let attestationValid = false;
  if (input.taxClearanceIssuedDateIso !== undefined) {
    const issued = parseIsoDate(input.taxClearanceIssuedDateIso, 'taxClearanceIssuedDateIso');
    const limit = parseIsoDate(addMonthsClamped(input.taxClearanceIssuedDateIso, validityMonths), 'limite');
    const paid = parseIsoDate(input.paymentDateIso, 'paymentDateIso');
    attestationValid = dateKey(paid) >= dateKey(issued) && dateKey(paid) <= dateKey(limit);
  }
  const rate = attestationValid ? reducedBps : fullBps;
  return { rasRateBps: rate, rasVatCents: applyBps(centimes(vat), rate) };
}

// ------------------------------------------------------------------ 4. Auto-entrepreneur : seuil par client

export interface AutoEntrepreneurInput {
  readonly clientThresholdCents: number;
  readonly cumulBeforeInvoiceCents: number;
  readonly invoiceCents: number;
  readonly withholdingRateBps: number;
}

export interface AutoEntrepreneurOutput {
  readonly surplusCents: number;
  readonly withholdingCents: number;
}

export function computeAutoEntrepreneurSurplus(input: AutoEntrepreneurInput): AutoEntrepreneurOutput {
  const threshold = ensureSafeInteger(input.clientThresholdCents, 'clientThresholdCents');
  const before = ensureSafeInteger(input.cumulBeforeInvoiceCents, 'cumulBeforeInvoiceCents');
  const invoice = ensureSafeInteger(input.invoiceCents, 'invoiceCents');
  const rate = bps(input.withholdingRateBps);
  const surplusCents = Math.min(invoice, Math.max(0, before + invoice - threshold));
  return { surplusCents, withholdingCents: applyBps(centimes(surplusCents), rate) };
}

// ------------------------------------------------------------------ 5. Réforme TVA 2026

export interface VatRateInput {
  readonly vatRateBps: number;
  readonly issueDateIso: string;
}

export interface VatRateOutput {
  readonly accepted: boolean;
  /** Code d'erreur ADR en cas de rejet, chaîne vide si le taux est accepté. */
  readonly errorCode: string;
}

/** Date d'émission illisible (vide, hors format AAAA-MM-JJ ou impossible au calendrier) : rejet typé ADR-04. */
export class UnreadableIssueDateError extends Error {
  readonly code = 'ADR_04_UNREADABLE_ISSUE_DATE';

  constructor(issueDateIso: string) {
    super(`ADR_04_UNREADABLE_ISSUE_DATE: date d'émission « ${issueDateIso} » illisible (attendu : AAAA-MM-JJ valide).`);
    this.name = 'UnreadableIssueDateError';
  }
}

/** Lit la date d'émission avec le calendrier de ce module ; ne dépend pas de la garde de shared-types. */
export function assertReadableIssueDate(issueDateIso: string): void {
  try {
    parseIsoDate(issueDateIso, 'issueDateIso');
  } catch (error) {
    if (error instanceof GoldenVectorFormatError) {
      throw new UnreadableIssueDateError(issueDateIso);
    }
    throw error;
  }
}

export function evaluateVatRate(input: VatRateInput): VatRateOutput {
  const rate = ensureSafeInteger(input.vatRateBps, 'vatRateBps');
  try {
    assertReadableIssueDate(input.issueDateIso);
    assertValidVatRateForIssueYear(rate, input.issueDateIso);
    return { accepted: true, errorCode: '' };
  } catch (error) {
    if (error instanceof UnreadableIssueDateError) {
      return { accepted: false, errorCode: error.code };
    }
    const message = error instanceof Error ? error.message : String(error);
    const match = /^([A-Z0-9_]+):/.exec(message);
    if (match === null) {
      throw error;
    }
    return { accepted: false, errorCode: match[1] ?? '' };
  }
}

// ------------------------------------------------------------------ 6. Décompte BTP

export interface BtpSettlementInput {
  readonly worksHtCents: number;
  readonly deboursCents: number;
  readonly vatRateBps: number;
  readonly retentionBps: number;
}

export interface BtpSettlementOutput {
  readonly retentionCents: number;
  readonly deboursVatCents: number;
  readonly deferredVatOnRetentionCents: number;
  readonly vatDueNowCents: number;
}

export function computeBtpSettlement(input: BtpSettlementInput): BtpSettlementOutput {
  const works = ensureSafeInteger(input.worksHtCents, 'worksHtCents');
  ensureSafeInteger(input.deboursCents, 'deboursCents'); // débours : hors champ de la TVA, jamais taxés ni retenus
  const vatRate = bps(input.vatRateBps);
  const retentionRate = bps(input.retentionBps);
  const retentionCents = applyBps(centimes(works), retentionRate);
  const vatOnWorks = applyBps(centimes(works), vatRate);
  const deferredVatOnRetentionCents = applyBps(retentionCents, vatRate);
  return {
    retentionCents,
    deboursVatCents: 0,
    deferredVatOnRetentionCents,
    vatDueNowCents: vatOnWorks - deferredVatOnRetentionCents,
  };
}

// ------------------------------------------------------------------ répartition des cas

export function computeGoldenCase(kind: GoldenKind, input: JsonObject): JsonObject {
  switch (kind) {
    case 'ART_11_CASH_CEILING':
      return { ...computeArt11CashSplit({
        invoiceHtCents: readInt(input, 'invoiceHtCents'),
        invoiceVatCents: readInt(input, 'invoiceVatCents'),
        vatRateBps: readInt(input, 'vatRateBps'),
        alreadyPaidCashTodayTtcCents: readInt(input, 'alreadyPaidCashTodayTtcCents'),
        alreadyPaidCashMonthTtcCents: readInt(input, 'alreadyPaidCashMonthTtcCents'),
        dailyCapTtcCents: readInt(input, 'dailyCapTtcCents'),
        monthlyCapTtcCents: readInt(input, 'monthlyCapTtcCents'),
      }) };
    case 'LAW_69_21_PENALTY':
      return { ...computeLaw6921Penalty({
        unpaidTtcCents: readInt(input, 'unpaidTtcCents'),
        startedMonthsOfDelay: readInt(input, 'startedMonthsOfDelay'),
        bamBaseRateBps: readInt(input, 'bamBaseRateBps'),
        monthlyIncrementBps: readInt(input, 'monthlyIncrementBps'),
        hasDocumentedDisputeR2: readBool(input, 'hasDocumentedDisputeR2'),
      }) };
    case 'ART_117_RAS_TVA': {
      const issued = input['taxClearanceIssuedDateIso'];
      return { ...computeRasTva({
        invoiceTtcCents: readInt(input, 'invoiceTtcCents'),
        invoiceVatCents: readInt(input, 'invoiceVatCents'),
        paymentDateIso: readString(input, 'paymentDateIso'),
        ...(issued === undefined ? {} : { taxClearanceIssuedDateIso: readString(input, 'taxClearanceIssuedDateIso') }),
        exclusionThresholdTtcCents: readInt(input, 'exclusionThresholdTtcCents'),
        attestationValidityMonths: readInt(input, 'attestationValidityMonths'),
        reducedRasRateBps: readInt(input, 'reducedRasRateBps'),
        fullRasRateBps: readInt(input, 'fullRasRateBps'),
      }) };
    }
    case 'AUTO_ENTREPRENEUR_THRESHOLD':
      return { ...computeAutoEntrepreneurSurplus({
        clientThresholdCents: readInt(input, 'clientThresholdCents'),
        cumulBeforeInvoiceCents: readInt(input, 'cumulBeforeInvoiceCents'),
        invoiceCents: readInt(input, 'invoiceCents'),
        withholdingRateBps: readInt(input, 'withholdingRateBps'),
      }) };
    case 'LF2026_VAT_RATE':
      return { ...evaluateVatRate({ vatRateBps: readInt(input, 'vatRateBps'), issueDateIso: readString(input, 'issueDateIso') }) };
    case 'BTP_SETTLEMENT':
      return { ...computeBtpSettlement({
        worksHtCents: readInt(input, 'worksHtCents'),
        deboursCents: readInt(input, 'deboursCents'),
        vatRateBps: readInt(input, 'vatRateBps'),
        retentionBps: readInt(input, 'retentionBps'),
      }) };
  }
}

// ------------------------------------------------------------------ comparaison et rapport d'écarts

export interface GoldenDiscrepancy {
  readonly key: string;
  readonly expected: JsonValue | undefined;
  readonly actual: JsonValue | undefined;
  /** actual − expected, seulement quand les deux valeurs sont des entiers. */
  readonly delta?: number;
}

export class GoldenMismatchError extends Error {
  readonly discrepancies: readonly GoldenDiscrepancy[];

  constructor(vectorId: string, caseName: string, discrepancies: readonly GoldenDiscrepancy[]) {
    super(formatDiscrepancyReport(vectorId, caseName, discrepancies));
    this.name = 'GoldenMismatchError';
    this.discrepancies = discrepancies;
  }
}

function assertNoFloat(value: JsonValue | undefined, label: string): void {
  if (typeof value === 'number') {
    ensureSafeInteger(value, label);
  }
}

/** Compare strictement attendu et calculé, clé par clé ; toute clé absente d'un côté est un écart. */
export function diffGolden(expected: JsonObject, actual: JsonObject): GoldenDiscrepancy[] {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const out: GoldenDiscrepancy[] = [];
  for (const key of keys) {
    const left = expected[key];
    const right = actual[key];
    assertNoFloat(left, `expected.${key}`);
    assertNoFloat(right, `actual.${key}`);
    if (left === right) {
      continue;
    }
    if (typeof left === 'number' && typeof right === 'number') {
      out.push({ key, expected: left, actual: right, delta: right - left });
    } else {
      out.push({ key, expected: left, actual: right });
    }
  }
  return out;
}

export function formatDiscrepancyReport(vectorId: string, caseName: string, discrepancies: readonly GoldenDiscrepancy[]): string {
  if (discrepancies.length === 0) {
    return `${vectorId} « ${caseName} » : aucun écart.`;
  }
  const lines = discrepancies.map((d) => {
    const delta = d.delta === undefined ? '' : ` ; écart = ${d.delta > 0 ? '+' : ''}${d.delta} (calculé − attendu)`;
    return `  - ${d.key} : attendu ${JSON.stringify(d.expected)}, calculé ${JSON.stringify(d.actual)}${delta}`;
  });
  return `${vectorId} « ${caseName} » : ${discrepancies.length} écart(s)\n${lines.join('\n')}`;
}

export function assertGoldenCase(vectorId: string, caseName: string, expected: JsonObject, actual: JsonObject): void {
  const discrepancies = diffGolden(expected, actual);
  if (discrepancies.length > 0) {
    throw new GoldenMismatchError(vectorId, caseName, discrepancies);
  }
}

export interface GoldenCaseResult {
  readonly caseName: string;
  readonly discrepancies: readonly GoldenDiscrepancy[];
}

/** Rejoue chaque cas : le calculé vient du code, l'attendu du JSON ; les écarts sont rendus, pas masqués. */
export function replayGoldenVector(vector: GoldenVector): GoldenCaseResult[] {
  return vector.cases.map((goldenCase) => ({
    caseName: goldenCase.name,
    discrepancies: diffGolden(goldenCase.expected, computeGoldenCase(vector.kind, goldenCase.input)),
  }));
}

// ------------------------------------------------------------------ 7. Validateur Sage 100 (.PNM)

/** Largeur fixe d'une ligne .PNM, hors CRLF (Doc_14 § 11 ; AGENTS.md Loi 9). */
export const PNM_LINE_WIDTH = 108;
/** Index (base 0) du sens Débit/Crédit : position 84 (Doc_14 § 11). */
const PNM_SENSE_INDEX = 83;

/**
 * Valide un tampon .PNM : au moins une ligne, chaque ligne de 108 caractères ASCII imprimables (0x20 à 0x7E),
 * fin de ligne CRLF partout (y compris après la dernière ligne), aucune ligne vide, sens D ou C en position 84.
 * Un tampon binaire est lu octet par octet (latin1) : tout octet ≥ 0x80 est refusé, un accent UTF-8 aussi.
 * L'équilibre Débit/Crédit par pièce (Doc_14 § 08) n'est pas vérifié ici : les spécifications ne fixent pas
 * la colonne du numéro de pièce ni celle du montant.
 */
export function assertValidSage100PnmBuffer(pnmContent: string | Uint8Array): { readonly linesCount: number } {
  const text = typeof pnmContent === 'string' ? pnmContent : Buffer.from(pnmContent).toString('latin1');
  if (text.length === 0) {
    throw new Error('PNM_EMPTY_FILE');
  }
  if (!text.endsWith('\r\n')) {
    throw new Error('PNM_MISSING_TRAILING_CRLF');
  }
  const lines = text.slice(0, -2).split('\r\n');
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.length === 0) {
      throw new Error(`PNM_EMPTY_LINE: Ligne ${lineNumber} vide.`);
    }
    if (/[^\x20-\x7E]/.test(line)) {
      throw new Error(`PNM_NON_ASCII_CHAR: Caractère hors plage ASCII imprimable (ou LF/CR isolé) à la ligne ${lineNumber}.`);
    }
    if (line.length !== PNM_LINE_WIDTH) {
      throw new Error(`PNM_INVALID_LINE_LENGTH: Ligne ${lineNumber} mesure ${line.length} car. (attendu: ${PNM_LINE_WIDTH}).`);
    }
    const sense = line.charAt(PNM_SENSE_INDEX);
    if (sense !== 'D' && sense !== 'C') {
      throw new Error(`PNM_INVALID_DEBIT_CREDIT_FLAG: Reçu '${sense}' à la ligne ${lineNumber}.`);
    }
  });
  return { linesCount: lines.length };
}
