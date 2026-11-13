import { applyBps, assertValidVatRateForIssueYear, bps, centimes, divRoundHalfUpBigInt } from '@fisca/shared-types';
import { z } from 'zod';
import { addDays, addMonthsClamped, dayNumber, parseIsoDate } from './calendar.ts';
import { FiscalAstError } from './errors.ts';
import { BPS_SCALE, CENTS_PER_DIRHAM, applyBpsExact, ceilDirhams, maxBig, minBig, toSafeNumber } from './int-math.ts';
import { evaluateComparison, type CapBasis } from './rule-ast.ts';
import { FiscalRuleStore, type AppliedRuleRef, type FiscalRuleSource, type RuleRow } from './rule-store.ts';

/**
 * Interpréteur déclaratif des règles du CGI (ADR-04) : il lit des lignes de dynamic_fiscal_rules datées et n'embarque
 * aucun taux, plafond ni seuil. Arithmétique entière (BigInt, divRoundHalfUpBigInt), échec fermé sur toute anomalie.
 */

// ------------------------------------------------------------------ validation des entrées

const cents = z.int().nonnegative();
const ruleCodeField = z.string().min(1);
const isoDateField = z.string();

function parseInput<S extends z.ZodType>(schema: S, input: unknown, where: string): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`).join(' ; ');
    throw new FiscalAstError('INPUT_INVALID', `${where} — ${issues}`);
  }
  return parsed.data;
}

function formatMad(amountCents: bigint): string {
  const sign = amountCents < 0n ? '-' : '';
  const absolute = amountCents < 0n ? -amountCents : amountCents;
  const whole = divRoundHalfUpBigInt(absolute - (CENTS_PER_DIRHAM / 2n), CENTS_PER_DIRHAM);
  const remainder = absolute - whole * CENTS_PER_DIRHAM;
  return `${sign}${whole.toString()},${remainder.toString().padStart(2, '0')} MAD`;
}

function assertVatRateAllowedByLaw(vatRateBps: number, onDateIso: string): void {
  try {
    assertValidVatRateForIssueYear(vatRateBps, onDateIso);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FiscalAstError('ADR_04_LF2026_VAT_VIOLATION', message.replace(/^ADR_04_LF2026_VAT_VIOLATION:\s*/, ''));
  }
}

// ------------------------------------------------------------------ résultats

export interface EvaluationBase {
  readonly appliedRule: AppliedRuleRef;
  /** Explication lisible : règle, paramètres lus, étapes du calcul. */
  readonly explanation: string;
}

// ------------------------------------------------------------------ TVA 2026

const VAT_INPUT = z.strictObject({
  ruleCode: ruleCodeField,
  issueDateIso: isoDateField,
  vatRateBps: z.int().nonnegative(),
  baseHtCents: cents.optional(),
});
export type VatRateEvaluationInput = z.input<typeof VAT_INPUT>;

export interface VatRateEvaluation extends EvaluationBase {
  readonly vatRateBps: number;
  /** TVA sur la base HT fournie ; null si aucune base n'a été fournie. */
  readonly vatCents: number | null;
  readonly totalTtcCents: number | null;
}

// ------------------------------------------------------------------ plafond d'espèces Art. 11-II

const CASH_INPUT = z.strictObject({
  ruleCode: ruleCodeField,
  paymentDateIso: isoDateField,
  invoiceHtCents: cents,
  invoiceVatCents: cents,
  vatRateBps: z.int().nonnegative(),
  /** Espèces déjà versées le même jour au même fournisseur, dans la base du plafond (TTC par défaut). */
  alreadyPaidCashTodayCents: cents,
  /** Espèces déjà versées dans le mois civil au même fournisseur, dans la base du plafond. */
  alreadyPaidCashMonthCents: cents,
});
export type CashCeilingEvaluationInput = z.input<typeof CASH_INPUT>;

export interface CashCeilingEvaluation extends EvaluationBase {
  readonly capBasis: CapBasis;
  readonly allowedTtcCents: number;
  readonly deductibleHtCents: number;
  readonly recoverableVatCents: number;
  readonly reintegratedTable3HtCents: number;
  /** TVA perdue (non récupérable). */
  readonly nonRecoverableVatCents: number;
  /** Part TTC de la facture qui dépasse le plafond. */
  readonly excessTtcCents: number;
  readonly exceedsCeiling: boolean;
}

const CASH_SEQUENCE_INPUT = z.strictObject({
  ruleCode: ruleCodeField,
  invoices: z
    .array(
      z.strictObject({
        paymentDateIso: isoDateField,
        invoiceHtCents: cents,
        invoiceVatCents: cents,
        vatRateBps: z.int().nonnegative(),
      }),
    )
    .min(1),
});
export type CashCeilingSequenceInput = z.input<typeof CASH_SEQUENCE_INPUT>;

export interface CashCeilingSequenceEvaluation {
  readonly steps: readonly CashCeilingEvaluation[];
  /** Index (base 0) de la première facture qui franchit un plafond, ou null. */
  readonly firstCrossingIndex: number | null;
}

// ------------------------------------------------------------------ RAS-TVA Art. 117

const RAS_INPUT = z.strictObject({
  ruleCode: ruleCodeField,
  paymentDateIso: isoDateField,
  invoiceTtcCents: cents,
  invoiceVatCents: cents,
  taxClearanceIssuedDateIso: isoDateField.optional(),
});
export type RasTvaEvaluationInput = z.input<typeof RAS_INPUT>;

export interface RasTvaEvaluation extends EvaluationBase {
  readonly rasRateBps: number;
  readonly rasVatCents: number;
  readonly retentionApplies: boolean;
  readonly attestationValid: boolean;
  /** Dernier jour de validité de l'attestation (inclus) ; null sans attestation. */
  readonly attestationLastValidDayIso: string | null;
}

// ------------------------------------------------------------------ auto-entrepreneur

const AE_INPUT = z.strictObject({
  ruleCode: ruleCodeField,
  invoiceDateIso: isoDateField,
  cumulBeforeInvoiceCents: cents,
  invoiceCents: cents,
});
export type AutoEntrepreneurEvaluationInput = z.input<typeof AE_INPUT>;

export interface AutoEntrepreneurEvaluation extends EvaluationBase {
  readonly surplusCents: number;
  readonly withholdingCents: number;
  readonly netCents: number;
}

// ------------------------------------------------------------------ Loi 69-21

const PENALTY_INPUT = z.strictObject({
  ruleCode: ruleCodeField,
  asOfDateIso: isoDateField,
  unpaidTtcCents: cents,
  startedMonthsOfDelay: z.int().nonnegative(),
  hasDocumentedDispute: z.boolean(),
});
export type PaymentDelayPenaltyInput = z.input<typeof PENALTY_INPUT>;

export interface PaymentDelayPenaltyEvaluation extends EvaluationBase {
  readonly totalPenaltyBps: number;
  readonly penaltyCents: number;
}

const DELAY_INPUT = z.strictObject({
  ruleCode: ruleCodeField,
  serviceDeliveryDateIso: isoDateField,
  asOfDateIso: isoDateField,
  termKind: z.enum(['STANDARD', 'CONTRACT', 'DECREE']),
});
export type PaymentDelayStatusInput = z.input<typeof DELAY_INPUT>;

export interface PaymentDelayStatus extends EvaluationBase {
  readonly legalTermDays: number;
  /** Dernier jour du délai légal (inclus) : service_delivery_date + durée. */
  readonly legalDueDateIso: string;
  /** Jours de retard au-delà de l'échéance : 0 le jour même de l'échéance, 1 dès le lendemain. */
  readonly daysLate: number;
  readonly status: 'DANS_DELAI_LEGAL' | 'EN_RETARD_PENALISE';
}

// ------------------------------------------------------------------ décompte BTP

const BTP_INPUT = z.strictObject({
  ruleCode: ruleCodeField,
  settlementDateIso: isoDateField,
  worksHtCents: cents,
  /** Débours : hors champ de la TVA, jamais taxés ni retenus. */
  deboursCents: cents,
  vatRateBps: z.int().nonnegative(),
});
export type BtpSettlementEvaluationInput = z.input<typeof BTP_INPUT>;

export interface BtpSettlementEvaluation extends EvaluationBase {
  readonly retentionCents: number;
  readonly deboursVatCents: number;
  readonly deferredVatOnRetentionCents: number;
  readonly vatDueNowCents: number;
}

// ------------------------------------------------------------------ moteur

export class DynamicFiscalAstEngine {
  private readonly store: FiscalRuleStore;

  private constructor(store: FiscalRuleStore) {
    this.store = store;
  }

  /** Construit le moteur sur des lignes déjà lues ; toute ligne opposable illisible fait échouer la construction. */
  static fromRows(rows: readonly RuleRow[]): DynamicFiscalAstEngine {
    return new DynamicFiscalAstEngine(new FiscalRuleStore(rows));
  }

  /** Construit le moteur en lisant le port injecté (D1 en production, lignes de test ailleurs). */
  static async fromSource(source: FiscalRuleSource): Promise<DynamicFiscalAstEngine> {
    return DynamicFiscalAstEngine.fromRows(await source.listRuleRows());
  }

  /** Vérifie la chronologie complète d'un code de règle : chevauchement ou trou = erreur typée. */
  validateTimeline(ruleCode: string): void {
    this.store.validateTimeline(ruleCode);
  }

  // ---------------------------------------------------------------- TVA 2026

  evaluateVatRate(rawInput: VatRateEvaluationInput): VatRateEvaluation {
    const input = parseInput(VAT_INPUT, rawInput, 'evaluateVatRate');
    parseIsoDate(input.issueDateIso, 'issueDateIso');
    assertVatRateAllowedByLaw(input.vatRateBps, input.issueDateIso);
    const rule = this.store.select(input.ruleCode, input.issueDateIso, 'VAT_RATE_SET');
    if (!rule.ast.rates.allowed_rates_bps.includes(input.vatRateBps)) {
      throw new FiscalAstError(
        'VAT_RATE_NOT_ALLOWED',
        `taux ${input.vatRateBps} bps absent de la règle ${rule.ref.ruleId} (admis : ${rule.ast.rates.allowed_rates_bps.join(', ')}).`,
      );
    }
    const base = input.baseHtCents;
    const vatCents = base === undefined ? null : applyBps(centimes(base), bps(input.vatRateBps));
    const totalTtcCents = vatCents === null || base === undefined ? null : toSafeNumber(BigInt(base) + BigInt(vatCents), 'totalTtcCents');
    return {
      vatRateBps: input.vatRateBps,
      vatCents,
      totalTtcCents,
      appliedRule: rule.ref,
      explanation: `Taux ${input.vatRateBps} bps admis par la règle ${rule.ref.ruleId} (${rule.ref.cgiArticleRef}, en vigueur depuis ${rule.ref.effectiveFrom}) à la date ${input.issueDateIso}.`,
    };
  }

  // ---------------------------------------------------------------- plafond d'espèces Art. 11-II

  evaluateCashCeiling(rawInput: CashCeilingEvaluationInput): CashCeilingEvaluation {
    const input = parseInput(CASH_INPUT, rawInput, 'evaluateCashCeiling');
    parseIsoDate(input.paymentDateIso, 'paymentDateIso');
    assertVatRateAllowedByLaw(input.vatRateBps, input.paymentDateIso);
    const rule = this.store.select(input.ruleCode, input.paymentDateIso, 'CASH_CEILING');
    const basis = rule.ast.cap_basis;
    const dailyCap = BigInt(rule.ast.daily_cap.amount_cents);
    const monthlyCap = BigInt(rule.ast.monthly_cap.amount_cents);
    const ht = BigInt(input.invoiceHtCents);
    const vat = BigInt(input.invoiceVatCents);
    const rate = BigInt(input.vatRateBps);
    const totalTtc = ht + vat;
    const capped = basis === 'TTC' ? totalTtc : ht;
    const remainingDaily = maxBig(0n, dailyCap - BigInt(input.alreadyPaidCashTodayCents));
    const remainingMonthly = maxBig(0n, monthlyCap - BigInt(input.alreadyPaidCashMonthCents));
    const allowedInBasis = minBig(capped, remainingDaily, remainingMonthly);

    let allowedTtc: bigint;
    let deductibleHt: bigint;
    let recoverableVat: bigint;
    if (allowedInBasis === capped) {
      allowedTtc = totalTtc;
      deductibleHt = ht;
      recoverableVat = vat;
    } else if (basis === 'TTC') {
      allowedTtc = allowedInBasis;
      deductibleHt = divRoundHalfUpBigInt(allowedInBasis * BPS_SCALE, BPS_SCALE + rate);
      recoverableVat = allowedInBasis - deductibleHt;
    } else {
      deductibleHt = allowedInBasis;
      recoverableVat = applyBpsExact(allowedInBasis, rate);
      allowedTtc = deductibleHt + recoverableVat;
    }
    const exceeds = allowedInBasis !== capped;
    const reintegrated = ht - deductibleHt;
    const lostVat = vat - recoverableVat;
    return {
      capBasis: basis,
      allowedTtcCents: toSafeNumber(allowedTtc, 'allowedTtcCents'),
      deductibleHtCents: toSafeNumber(deductibleHt, 'deductibleHtCents'),
      recoverableVatCents: toSafeNumber(recoverableVat, 'recoverableVatCents'),
      reintegratedTable3HtCents: toSafeNumber(reintegrated, 'reintegratedTable3HtCents'),
      nonRecoverableVatCents: toSafeNumber(lostVat, 'nonRecoverableVatCents'),
      excessTtcCents: toSafeNumber(totalTtc - allowedTtc, 'excessTtcCents'),
      exceedsCeiling: exceeds,
      appliedRule: rule.ref,
      explanation:
        `Plafond d'espèces ${rule.ref.cgiArticleRef} (règle ${rule.ref.ruleId} du ${rule.ref.effectiveFrom}, base ${basis}) : ` +
        `facture ${formatMad(totalTtc)} TTC, plafond restant jour ${formatMad(remainingDaily)}, mois ${formatMad(remainingMonthly)} ; ` +
        (exceeds
          ? `admis ${formatMad(allowedTtc)} TTC, HT déductible ${formatMad(deductibleHt)}, TVA récupérable ${formatMad(recoverableVat)}, ` +
            `HT réintégré (tableau 3) ${formatMad(reintegrated)}, TVA perdue ${formatMad(lostVat)}.`
          : 'facture admise en totalité, aucune réintégration.'),
    };
  }

  /**
   * Cumule une suite de règlements en espèces au même fournisseur : le cumul du jour et du mois civil des factures
   * précédentes (dans la base du plafond de la règle de leur date) alimente chaque évaluation. Cas D-20 : onze factures.
   */
  evaluateCashCeilingSequence(rawInput: CashCeilingSequenceInput): CashCeilingSequenceEvaluation {
    const input = parseInput(CASH_SEQUENCE_INPUT, rawInput, 'evaluateCashCeilingSequence');
    const steps: CashCeilingEvaluation[] = [];
    const paidByDay = new Map<string, bigint>();
    const paidByMonth = new Map<string, bigint>();
    let firstCrossingIndex: number | null = null;
    input.invoices.forEach((invoice, index) => {
      parseIsoDate(invoice.paymentDateIso, `invoices[${index}].paymentDateIso`);
      const monthKey = invoice.paymentDateIso.slice(0, 7);
      const step = this.evaluateCashCeiling({
        ruleCode: input.ruleCode,
        paymentDateIso: invoice.paymentDateIso,
        invoiceHtCents: invoice.invoiceHtCents,
        invoiceVatCents: invoice.invoiceVatCents,
        vatRateBps: invoice.vatRateBps,
        alreadyPaidCashTodayCents: toSafeNumber(paidByDay.get(invoice.paymentDateIso) ?? 0n, 'cumul du jour'),
        alreadyPaidCashMonthCents: toSafeNumber(paidByMonth.get(monthKey) ?? 0n, 'cumul du mois'),
      });
      const paidInBasis = step.capBasis === 'TTC' ? BigInt(invoice.invoiceHtCents) + BigInt(invoice.invoiceVatCents) : BigInt(invoice.invoiceHtCents);
      paidByDay.set(invoice.paymentDateIso, (paidByDay.get(invoice.paymentDateIso) ?? 0n) + paidInBasis);
      paidByMonth.set(monthKey, (paidByMonth.get(monthKey) ?? 0n) + paidInBasis);
      if (step.exceedsCeiling && firstCrossingIndex === null) {
        firstCrossingIndex = index;
      }
      steps.push(step);
    });
    return { steps, firstCrossingIndex };
  }

  // ---------------------------------------------------------------- RAS-TVA Art. 117

  evaluateRasTva(rawInput: RasTvaEvaluationInput): RasTvaEvaluation {
    const input = parseInput(RAS_INPUT, rawInput, 'evaluateRasTva');
    parseIsoDate(input.paymentDateIso, 'paymentDateIso');
    const rule = this.store.select(input.ruleCode, input.paymentDateIso, 'RAS_TVA');
    const ttc = BigInt(input.invoiceTtcCents);
    const applies = evaluateComparison(rule.ast.applies_when_ttc, ttc) && input.invoiceVatCents !== 0;
    let lastValidDay: string | null = null;
    let attestationValid = false;
    if (input.taxClearanceIssuedDateIso !== undefined) {
      const issued = dayNumber(parseIsoDate(input.taxClearanceIssuedDateIso, 'taxClearanceIssuedDateIso'));
      lastValidDay = addMonthsClamped(input.taxClearanceIssuedDateIso, rule.ast.attestation_validity.count, 'taxClearanceIssuedDateIso');
      const paid = dayNumber(parseIsoDate(input.paymentDateIso, 'paymentDateIso'));
      attestationValid = paid >= issued && paid <= dayNumber(parseIsoDate(lastValidDay, 'limite de validité'));
    }
    if (!applies) {
      return {
        rasRateBps: 0,
        rasVatCents: 0,
        retentionApplies: false,
        attestationValid,
        attestationLastValidDayIso: lastValidDay,
        appliedRule: rule.ref,
        explanation: `RAS-TVA ${rule.ref.cgiArticleRef} (règle ${rule.ref.ruleId}) : condition d'application non remplie (TTC ${formatMad(ttc)}, TVA ${formatMad(BigInt(input.invoiceVatCents))}) : aucune retenue.`,
      };
    }
    const rate = attestationValid ? rule.ast.reduced_rate.rate_bps : rule.ast.full_rate.rate_bps;
    const ras = applyBps(centimes(input.invoiceVatCents), bps(rate));
    return {
      rasRateBps: rate,
      rasVatCents: ras,
      retentionApplies: true,
      attestationValid,
      attestationLastValidDayIso: lastValidDay,
      appliedRule: rule.ref,
      explanation:
        `RAS-TVA ${rule.ref.cgiArticleRef} (règle ${rule.ref.ruleId} du ${rule.ref.effectiveFrom}) : ` +
        (attestationValid
          ? `attestation valide au ${input.paymentDateIso} (jusqu'au ${lastValidDay ?? ''} inclus) : taux réduit ${rate} bps`
          : `aucune attestation valide au ${input.paymentDateIso} : taux plein ${rate} bps`) +
        ` sur une TVA de ${formatMad(BigInt(input.invoiceVatCents))} = ${formatMad(BigInt(ras))}.`,
    };
  }

  // ---------------------------------------------------------------- auto-entrepreneur

  evaluateAutoEntrepreneurThreshold(rawInput: AutoEntrepreneurEvaluationInput): AutoEntrepreneurEvaluation {
    const input = parseInput(AE_INPUT, rawInput, 'evaluateAutoEntrepreneurThreshold');
    parseIsoDate(input.invoiceDateIso, 'invoiceDateIso');
    const rule = this.store.select(input.ruleCode, input.invoiceDateIso, 'AUTO_ENTREPRENEUR_THRESHOLD');
    const start = BigInt(input.cumulBeforeInvoiceCents);
    const end = start + BigInt(input.invoiceCents);
    let surplus = 0n;
    let withholding = 0n;
    rule.ast.client_brackets.brackets.forEach((bracket, index) => {
      const low = maxBig(start, BigInt(bracket.from_cents));
      const high = bracket.up_to_cents === null ? end : minBig(end, BigInt(bracket.up_to_cents));
      const slice = maxBig(0n, high - low);
      if (index > 0) {
        surplus += slice;
      }
      withholding += applyBpsExact(slice, BigInt(bracket.rate_bps));
    });
    const invoice = BigInt(input.invoiceCents);
    return {
      surplusCents: toSafeNumber(surplus, 'surplusCents'),
      withholdingCents: toSafeNumber(withholding, 'withholdingCents'),
      netCents: toSafeNumber(invoice - withholding, 'netCents'),
      appliedRule: rule.ref,
      explanation:
        `Seuil auto-entrepreneur par client (règle ${rule.ref.ruleId} du ${rule.ref.effectiveFrom}) : cumul avant ${formatMad(start)}, ` +
        `facture ${formatMad(invoice)}, cumul après ${formatMad(end)} ; surplus ${formatMad(surplus)}, retenue ${formatMad(withholding)}.`,
    };
  }

  // ---------------------------------------------------------------- Loi 69-21

  evaluatePaymentDelayPenalty(rawInput: PaymentDelayPenaltyInput): PaymentDelayPenaltyEvaluation {
    const input = parseInput(PENALTY_INPUT, rawInput, 'evaluatePaymentDelayPenalty');
    parseIsoDate(input.asOfDateIso, 'asOfDateIso');
    const rule = this.store.select(input.ruleCode, input.asOfDateIso, 'PAYMENT_DELAY_PENALTY');
    const scale = rule.ast.penalty_scale;
    if (input.hasDocumentedDispute || input.startedMonthsOfDelay === 0 || input.unpaidTtcCents === 0) {
      return {
        totalPenaltyBps: 0,
        penaltyCents: 0,
        appliedRule: rule.ref,
        explanation: `Loi 69-21 (règle ${rule.ref.ruleId} du ${rule.ref.effectiveFrom}) : ${input.hasDocumentedDispute ? 'litige documenté, pénalité gelée' : 'aucun mois de retard entamé ou aucun impayé'} : pénalité nulle.`,
      };
    }
    const months = BigInt(input.startedMonthsOfDelay);
    const totalBps = BigInt(rule.ast.base_rate.rate_bps) + (months - 1n) * BigInt(scale.additional_period_increment_bps);
    const product = BigInt(input.unpaidTtcCents) * totalBps;
    const penalty = scale.rounding === 'CEIL_DIRHAM' ? ceilDirhams(product) * CENTS_PER_DIRHAM : applyBpsExact(BigInt(input.unpaidTtcCents), totalBps);
    return {
      totalPenaltyBps: toSafeNumber(totalBps, 'totalPenaltyBps'),
      penaltyCents: toSafeNumber(penalty, 'penaltyCents'),
      appliedRule: rule.ref,
      explanation:
        `Loi 69-21 (règle ${rule.ref.ruleId} du ${rule.ref.effectiveFrom}) : ${input.startedMonthsOfDelay} mois entamés, taux ${totalBps.toString()} bps ` +
        `(taux directeur ${rule.ast.base_rate.rate_bps} bps + ${input.startedMonthsOfDelay - 1} × ${scale.additional_period_increment_bps} bps) sur ${formatMad(BigInt(input.unpaidTtcCents))} ; ` +
        `arrondi ${scale.rounding} : ${formatMad(penalty)}.`,
    };
  }

  /**
   * Statut du délai légal (Doc_02 § 06) : jours de retard au-delà de service_delivery_date + durée du délai.
   * Le décompte des mois entamés n'est PAS déduit ici : la spécification ne fixe pas sa convention (point ouvert).
   */
  evaluatePaymentDelayStatus(rawInput: PaymentDelayStatusInput): PaymentDelayStatus {
    const input = parseInput(DELAY_INPUT, rawInput, 'evaluatePaymentDelayStatus');
    parseIsoDate(input.serviceDeliveryDateIso, 'serviceDeliveryDateIso');
    const asOf = dayNumber(parseIsoDate(input.asOfDateIso, 'asOfDateIso'));
    const rule = this.store.select(input.ruleCode, input.asOfDateIso, 'PAYMENT_DELAY_PENALTY');
    const terms = rule.ast.legal_terms;
    const termDays = input.termKind === 'STANDARD' ? terms.standard.count : input.termKind === 'CONTRACT' ? terms.contract.count : terms.decree.count;
    const dueIso = addDays(input.serviceDeliveryDateIso, termDays, 'serviceDeliveryDateIso');
    const due = dayNumber(parseIsoDate(dueIso, 'échéance légale'));
    const daysLate = asOf > due ? asOf - due : 0;
    return {
      legalTermDays: termDays,
      legalDueDateIso: dueIso,
      daysLate,
      status: daysLate === 0 ? 'DANS_DELAI_LEGAL' : 'EN_RETARD_PENALISE',
      appliedRule: rule.ref,
      explanation: `Délai légal ${input.termKind} de ${termDays} jours (règle ${rule.ref.ruleId}) : échéance ${dueIso} incluse, ${daysLate} jour(s) de retard au ${input.asOfDateIso}.`,
    };
  }

  // ---------------------------------------------------------------- décompte BTP

  evaluateBtpSettlement(rawInput: BtpSettlementEvaluationInput): BtpSettlementEvaluation {
    const input = parseInput(BTP_INPUT, rawInput, 'evaluateBtpSettlement');
    parseIsoDate(input.settlementDateIso, 'settlementDateIso');
    assertVatRateAllowedByLaw(input.vatRateBps, input.settlementDateIso);
    const rule = this.store.select(input.ruleCode, input.settlementDateIso, 'BTP_SETTLEMENT');
    const works = BigInt(input.worksHtCents);
    const rate = BigInt(input.vatRateBps);
    const retention = applyBpsExact(works, BigInt(rule.ast.retention_rate.rate_bps));
    const vatOnWorks = applyBpsExact(works, rate);
    const deferred = applyBpsExact(retention, rate);
    return {
      retentionCents: toSafeNumber(retention, 'retentionCents'),
      deboursVatCents: 0,
      deferredVatOnRetentionCents: toSafeNumber(deferred, 'deferredVatOnRetentionCents'),
      vatDueNowCents: toSafeNumber(vatOnWorks - deferred, 'vatDueNowCents'),
      appliedRule: rule.ref,
      explanation:
        `Décompte BTP (règle ${rule.ref.ruleId} du ${rule.ref.effectiveFrom}) : retenue de garantie ${formatMad(retention)} sur ${formatMad(works)} HT ; ` +
        `débours ${formatMad(BigInt(input.deboursCents))} hors TVA ; TVA différée sur la retenue ${formatMad(deferred)} ; TVA exigible au décompte ${formatMad(vatOnWorks - deferred)}.`,
    };
  }
}
