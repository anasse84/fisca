/**
 * Simulateur auto-entrepreneur (VEC-CGI-04, ERRATA E, Doc_18 S06) : IR trimestriel, retenue de 30 % au-delà du seuil
 * par client, comparaison indicative avec le forfait Essentiel TPE. Entiers de bout en bout (centimes, points de base).
 *
 * - Taux d'IR : paramètre daté (0,5 % ou 1 % cités par Doc_18 S06, NON RECOUPÉ) ou saisi par l'utilisateur. Le code
 *   ne décide jamais quel taux s'applique à quelle activité.
 * - Seuil et retenue : paramètres datés (`ae_client_threshold_cents`, `ae_withholding_bps`). La retenue porte sur la
 *   part du cumul qui dépasse le seuil ; l'assiette exacte reste à faire valider (ERRATA E).
 * - Comparaison : seuls les prix de la grille Fisca (HT) et l'IR de l'auto-entrepreneur sont chiffrés. L'outil ne
 *   calcule NI l'impôt de la société NI les honoraires : ils sont saisis par l'utilisateur.
 */
import { isNonNegativeSafeInteger, proportionHalfUp } from './amounts.ts';

export type AeError = 'REVENUE' | 'RATE' | 'CUMUL' | 'INVOICE' | 'PARAMS' | 'COSTS';

export type AeOutcome<T> = { readonly ok: true; readonly result: T } | { readonly ok: false; readonly error: AeError };

const MAX_RATE_BPS = 10000;

export interface AeIrResult {
  readonly rateBps: number;
  readonly quarterRevenueCents: number;
  readonly quarterIrCents: number;
}

export function computeAeQuarterlyIr(quarterRevenueCents: number, rateBps: number): AeOutcome<AeIrResult> {
  if (!isNonNegativeSafeInteger(quarterRevenueCents) || quarterRevenueCents === 0) return { ok: false, error: 'REVENUE' };
  if (!isNonNegativeSafeInteger(rateBps) || rateBps > MAX_RATE_BPS) return { ok: false, error: 'RATE' };
  return { ok: true, result: { rateBps, quarterRevenueCents, quarterIrCents: proportionHalfUp(quarterRevenueCents, rateBps) } };
}

export interface AeThresholdParams {
  readonly thresholdCents: number;
  readonly withholdingBps: number;
}

export interface AeThresholdInput {
  /** Cumul facturé au même client depuis le début de l'année, avant la nouvelle facture. */
  readonly priorCumulCents: number;
  readonly invoiceCents: number;
}

export interface AeThresholdResult {
  readonly cumulAfterCents: number;
  readonly exceeded: boolean;
  /** Part de la nouvelle facture qui dépasse le seuil : base de la retenue. */
  readonly surplusCents: number;
  readonly withheldCents: number;
  /** Net encaissé sur la nouvelle facture : facture - retenue. */
  readonly netCents: number;
  /** Marge restante avant le seuil, après la nouvelle facture (0 si dépassé). */
  readonly headroomCents: number;
}

export function computeAeClientThreshold(input: AeThresholdInput, params: AeThresholdParams): AeOutcome<AeThresholdResult> {
  if (!isNonNegativeSafeInteger(params.thresholdCents) || !isNonNegativeSafeInteger(params.withholdingBps) || params.withholdingBps > MAX_RATE_BPS) return { ok: false, error: 'PARAMS' };
  if (!isNonNegativeSafeInteger(input.priorCumulCents)) return { ok: false, error: 'CUMUL' };
  if (!isNonNegativeSafeInteger(input.invoiceCents) || input.invoiceCents === 0) return { ok: false, error: 'INVOICE' };
  const cumulAfterCents = input.priorCumulCents + input.invoiceCents;
  if (!Number.isSafeInteger(cumulAfterCents)) return { ok: false, error: 'CUMUL' };
  const overCumul = Math.max(0, cumulAfterCents - params.thresholdCents);
  // La part déjà au-delà du seuil avant cette facture est déjà retenue : on ne taxe ici que la nouvelle facture.
  const surplusCents = Math.min(input.invoiceCents, overCumul);
  const withheldCents = proportionHalfUp(surplusCents, params.withholdingBps);
  return {
    ok: true,
    result: {
      cumulAfterCents,
      exceeded: surplusCents > 0,
      surplusCents,
      withheldCents,
      netCents: input.invoiceCents - withheldCents,
      headroomCents: Math.max(0, params.thresholdCents - cumulAfterCents),
    },
  };
}

export interface AeSwitchPrices {
  /** Fisca Solo, annuel HT, lu de `content/pricing.ts`. */
  readonly soloAnnualHtCents: number;
  /** Fisca Essentiel, annuel HT, lu de `content/pricing.ts`. */
  readonly essentielAnnualHtCents: number;
}

export interface AeSwitchInput {
  readonly quarterRevenueCents: number;
  readonly rateBps: number;
  /** Autres coûts annuels de la société (honoraires, etc.) : saisis par l'utilisateur, jamais calculés ici. */
  readonly otherCompanyCostsCents: number;
}

export interface AeSwitchResult {
  readonly quarterIrCents: number;
  /** IR annuel indicatif : quatre trimestres identiques. */
  readonly annualIrCents: number;
  readonly aeTotalCents: number;
  readonly companyTotalCents: number;
  /** Société - auto-entrepreneur : positif = la société coûte plus cher (signé). */
  readonly differenceCents: number;
}

export function computeAeSwitch(input: AeSwitchInput, prices: AeSwitchPrices): AeOutcome<AeSwitchResult> {
  const ir = computeAeQuarterlyIr(input.quarterRevenueCents, input.rateBps);
  if (!ir.ok) return ir;
  if (!isNonNegativeSafeInteger(input.otherCompanyCostsCents)) return { ok: false, error: 'COSTS' };
  if (!isNonNegativeSafeInteger(prices.soloAnnualHtCents) || !isNonNegativeSafeInteger(prices.essentielAnnualHtCents)) return { ok: false, error: 'PARAMS' };
  const annualIrCents = ir.result.quarterIrCents * 4;
  const aeTotalCents = annualIrCents + prices.soloAnnualHtCents;
  const companyTotalCents = prices.essentielAnnualHtCents + input.otherCompanyCostsCents;
  if (!Number.isSafeInteger(aeTotalCents) || !Number.isSafeInteger(companyTotalCents)) return { ok: false, error: 'COSTS' };
  return { ok: true, result: { quarterIrCents: ir.result.quarterIrCents, annualIrCents, aeTotalCents, companyTotalCents, differenceCents: companyTotalCents - aeTotalCents } };
}
