/**
 * Estimateur Mowakaba (Doc_03 S05 et S06, Doc_18 S06, ERRATA section C) : éligibilité et reste à charge d'un pack.
 *
 * - Éligibilité : CA <= plafond HT (borne incluse) ; détention par un grand groupe <= seuil si elle est renseignée.
 *   Plafond et seuil sont des paramètres datés (`dated-values.ts`), jamais des faits permanents du code.
 * - Prise en charge : fourchette en points de base (80 % à 90 %, NON RECOUPÉ) ; subvention = prix x taux / 10 000,
 *   demi supérieur, BigInt ; reste à charge = prix - subvention. Aucun flottant.
 * - Résultat indicatif : l'octroi relève de l'organisme gestionnaire, jamais de cet outil.
 */
import { isNonNegativeSafeInteger, proportionHalfUp } from './amounts.ts';

export interface MowakabaParams {
  readonly coverageLowBps: number;
  readonly coverageHighBps: number;
  readonly maxRevenueHtCents: number;
  readonly maxGroupOwnershipBps: number;
}

export interface MowakabaInput {
  readonly revenueHtCents: number;
  /** Détention par un grand groupe, en points de base ; null si non renseignée. */
  readonly groupOwnershipBps: number | null;
  readonly packPriceHtCents: number;
  /** Taux de prise en charge choisi dans la fourchette ; null : bornes basse et haute seulement. */
  readonly chosenCoverageBps: number | null;
}

export type MowakabaError = 'REVENUE' | 'OWNERSHIP' | 'PRICE' | 'COVERAGE' | 'PARAMS';

export type IneligibleReason = 'REVENUE_ABOVE_CEILING' | 'GROUP_OWNERSHIP_ABOVE_THRESHOLD';

export interface MowakabaScenario {
  readonly coverageBps: number;
  readonly subsidyCents: number;
  readonly remainingCents: number;
}

export interface MowakabaResult {
  readonly eligible: boolean;
  readonly reasons: readonly IneligibleReason[];
  readonly packPriceHtCents: number;
  /** Prise en charge la plus faible (reste à charge le plus haut), la plus forte, et celle choisie le cas échéant. */
  readonly low: MowakabaScenario;
  readonly high: MowakabaScenario;
  readonly chosen: MowakabaScenario | null;
}

export type MowakabaOutcome = { readonly ok: true; readonly result: MowakabaResult } | { readonly ok: false; readonly error: MowakabaError };

export function scenarioFor(packPriceHtCents: number, coverageBps: number): MowakabaScenario {
  const subsidyCents = proportionHalfUp(packPriceHtCents, coverageBps);
  return { coverageBps, subsidyCents, remainingCents: packPriceHtCents - subsidyCents };
}

export function computeMowakaba(input: MowakabaInput, params: MowakabaParams): MowakabaOutcome {
  const paramNumbers = [params.coverageLowBps, params.coverageHighBps, params.maxRevenueHtCents, params.maxGroupOwnershipBps];
  if (!paramNumbers.every(isNonNegativeSafeInteger) || params.coverageLowBps > params.coverageHighBps || params.coverageHighBps > 10000) return { ok: false, error: 'PARAMS' };
  if (!isNonNegativeSafeInteger(input.revenueHtCents)) return { ok: false, error: 'REVENUE' };
  if (input.groupOwnershipBps !== null && (!isNonNegativeSafeInteger(input.groupOwnershipBps) || input.groupOwnershipBps > 10000)) return { ok: false, error: 'OWNERSHIP' };
  if (!isNonNegativeSafeInteger(input.packPriceHtCents) || input.packPriceHtCents === 0) return { ok: false, error: 'PRICE' };
  if (input.chosenCoverageBps !== null && (!isNonNegativeSafeInteger(input.chosenCoverageBps) || input.chosenCoverageBps < params.coverageLowBps || input.chosenCoverageBps > params.coverageHighBps)) {
    return { ok: false, error: 'COVERAGE' };
  }
  const reasons: IneligibleReason[] = [];
  if (input.revenueHtCents > params.maxRevenueHtCents) reasons.push('REVENUE_ABOVE_CEILING');
  if (input.groupOwnershipBps !== null && input.groupOwnershipBps > params.maxGroupOwnershipBps) reasons.push('GROUP_OWNERSHIP_ABOVE_THRESHOLD');
  return {
    ok: true,
    result: {
      eligible: reasons.length === 0,
      reasons,
      packPriceHtCents: input.packPriceHtCents,
      low: scenarioFor(input.packPriceHtCents, params.coverageLowBps),
      high: scenarioFor(input.packPriceHtCents, params.coverageHighBps),
      chosen: input.chosenCoverageBps === null ? null : scenarioFor(input.packPriceHtCents, input.chosenCoverageBps),
    },
  };
}
