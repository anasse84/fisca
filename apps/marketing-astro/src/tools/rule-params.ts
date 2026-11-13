/**
 * Paramètres de règle des outils : lus dans `content/dated-values.ts` (données de contenu datées), jamais codés ici.
 * Chaque valeur renvoie avec sa date (`as_of`) et son état de recoupement (ERRATA E), affichés avec le résultat.
 */
import { datedValue } from '../content/dated-values.ts';
import type { VerificationState } from '../content/dated-values.ts';

export interface RuleParam {
  readonly key: string;
  readonly value: number;
  readonly as_of: string;
  readonly state: VerificationState;
  readonly specRef: string;
}

export function ruleParam(key: string): RuleParam {
  const v = datedValue(key);
  return { key: v.key, value: v.value, as_of: v.as_of, state: v.state, specRef: v.specRef };
}

export const LATE_PARAM_KEYS: readonly string[] = [
  'late_base_bps',
  'late_increment_bps',
  'late_legal_days',
  'late_contractual_days',
  'late_sector_days',
];

export const CASH_PARAM_KEYS: readonly string[] = [
  'cash_cap_day_cents',
  'cash_cap_month_cents',
  'vat_standard_bps',
  'vat_reduced_bps',
  'vat_zero_bps',
];

export const RAS_PARAM_KEYS: readonly string[] = [
  'ras_reduced_bps',
  'ras_full_bps',
  'ras_attestation_months',
  'ras_exclusion_threshold_ttc_cents',
  'vat_standard_bps',
  'vat_reduced_bps',
  'vat_zero_bps',
];

/** Base du plafond d'espèces : paramètre daté de la règle, TTC par défaut (ERRATA E, plafond d'espèces). */
export type CapBasis = 'TTC' | 'HT';
export const DEFAULT_CAP_BASIS: CapBasis = 'TTC';
