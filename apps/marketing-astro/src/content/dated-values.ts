/**
 * Valeurs fiscales citées par les guides : des DONNÉES DE CONTENU datées, jamais des faits permanents du code
 * (AGENTS.md loi 2, ADR-04). Chaque valeur porte sa date (`as_of`), son état de vérification (ERRATA section E)
 * et la source dans les spécifications du dépôt. À la parution d'une règle AST/Wiki plus récente, on met à jour
 * cette table : aucune page ne recopie la valeur ailleurs.
 *
 * Aucune valeur ici ne concerne la facturation électronique : aucune date d'obligation ni aucun seuil de la réforme
 * n'est publié (ERRATA B-13), les pages le disent (« non publié à ce jour »).
 */
export type VerificationState = 'RECOUPÉ' | 'NON RECOUPÉ' | 'PROVISOIRE';

export type DatedValueKind = 'bps' | 'cents' | 'count';

export interface DatedValue {
  readonly key: string;
  readonly kind: DatedValueKind;
  readonly value: number;
  /** Date de la règle (ISO). Les vecteurs d'or portent 2026-11-13, date de l'état de vérification de l'ERRATA E. */
  readonly as_of: string;
  readonly state: VerificationState;
  /** Où la spécification du dépôt pose cette valeur. */
  readonly specRef: string;
}

const AS_OF = '2026-11-13';

function dv(key: string, kind: DatedValueKind, value: number, state: VerificationState, specRef: string): DatedValue {
  return { key, kind, value, as_of: AS_OF, state, specRef };
}

export const DATED_VALUES: readonly DatedValue[] = [
  dv('cash_cap_day_cents', 'cents', 500000, 'RECOUPÉ', 'ERRATA E ; Doc_14 S03 VEC-CGI-01'),
  dv('cash_cap_month_cents', 'cents', 5000000, 'RECOUPÉ', 'ERRATA E ; Doc_14 S03 VEC-CGI-01'),
  dv('vat_standard_bps', 'bps', 2000, 'NON RECOUPÉ', 'ERRATA D-04 et E ; Doc_01 S03'),
  dv('vat_reduced_bps', 'bps', 1000, 'NON RECOUPÉ', 'ERRATA D-04 et E ; Doc_01 S03'),
  dv('vat_zero_bps', 'bps', 0, 'NON RECOUPÉ', 'ERRATA D-04 et E ; Doc_01 S03'),
  dv('vat_rejected_sample_bps', 'bps', 1400, 'NON RECOUPÉ', 'ERRATA D-04 ; Doc_14 S03 VEC-CGI-05'),
  dv('ras_reduced_bps', 'bps', 7500, 'NON RECOUPÉ', 'ERRATA E ; Doc_14 S03 VEC-CGI-03'),
  dv('ras_full_bps', 'bps', 10000, 'NON RECOUPÉ', 'ERRATA E ; Doc_14 S03 VEC-CGI-03'),
  dv('ras_attestation_months', 'count', 6, 'NON RECOUPÉ', 'ERRATA E ; Doc_07 S08'),
  dv('ras_exclusion_threshold_ttc_cents', 'cents', 500000, 'NON RECOUPÉ', 'Doc_07 S08 ; Doc_14 S11'),
  dv('late_base_bps', 'bps', 275, 'NON RECOUPÉ', 'ERRATA E ; Doc_14 S03 VEC-CGI-02'),
  dv('late_increment_bps', 'bps', 85, 'NON RECOUPÉ', 'ERRATA E ; Doc_14 S03 VEC-CGI-02'),
  dv('late_total_two_months_bps', 'bps', 360, 'NON RECOUPÉ', 'ERRATA E ; Doc_14 S03 VEC-CGI-02'),
  dv('ae_client_threshold_cents', 'cents', 8000000, 'NON RECOUPÉ', 'ERRATA E ; Doc_14 S03 VEC-CGI-04'),
  dv('ae_withholding_bps', 'bps', 3000, 'NON RECOUPÉ', 'ERRATA E ; Doc_14 S03 VEC-CGI-04'),
  dv('btp_retention_bps', 'bps', 1000, 'NON RECOUPÉ', 'ERRATA E ; Doc_14 S03 VEC-CGI-06'),
  dv('btp_retention_alt_bps', 'bps', 700, 'NON RECOUPÉ', 'Doc_01 S03 ; Doc_07 S07'),
  dv('cash_stamp_bps', 'bps', 25, 'NON RECOUPÉ', 'Doc_01 S03 ; Doc_07 S03 et S07'),
  dv('drvt_ras_legal_entity_bps', 'bps', 500, 'NON RECOUPÉ', 'Doc_07 S09'),
  dv('drvt_ras_individual_bps', 'bps', 1000, 'NON RECOUPÉ', 'Doc_07 S09'),
  dv('drvt_rent_low_bps', 'bps', 1000, 'NON RECOUPÉ', 'Doc_07 S09'),
  dv('drvt_rent_high_bps', 'bps', 1500, 'NON RECOUPÉ', 'Doc_07 S09'),
  dv('foreign_service_ras_is_bps', 'bps', 1000, 'NON RECOUPÉ', 'Doc_01 S05'),
  dv('mowakaba_coverage_low_bps', 'bps', 8000, 'NON RECOUPÉ', 'Doc_03 S06'),
  dv('mowakaba_coverage_high_bps', 'bps', 9000, 'NON RECOUPÉ', 'Doc_03 S06'),
  dv('ice_key_modulus', 'count', 97, 'NON RECOUPÉ', 'ERRATA E (clé de contrôle de l’ICE) ; Doc_18 S06 et S11'),
  dv('late_legal_days', 'count', 60, 'NON RECOUPÉ', 'Doc_07 S08'),
  dv('late_contractual_days', 'count', 120, 'NON RECOUPÉ', 'Doc_07 S08'),
  dv('late_sector_days', 'count', 180, 'NON RECOUPÉ', 'Doc_07 S08'),
  dv('forfeit_months', 'count', 12, 'NON RECOUPÉ', 'Doc_01 S05'),
  dv('pos_offline_hours', 'count', 72, 'PROVISOIRE', 'Doc_01 S13'),
  dv('drvt_rent_tier_cents', 'cents', 12000000, 'NON RECOUPÉ', 'Doc_07 S09'),
  dv('forfeit_alert_months', 'count', 10, 'NON RECOUPÉ', 'Doc_01 S05'),
  dv('prorata_variation_points', 'count', 5, 'NON RECOUPÉ', 'Doc_01 S05'),
  dv('prorata_regularisation_years', 'count', 5, 'NON RECOUPÉ', 'Doc_01 S05'),
  dv('transfer_alert_months', 'count', 60, 'NON RECOUPÉ', 'Doc_01 S05'),
  dv('min_contribution_a_bps', 'bps', 25, 'NON RECOUPÉ', 'Doc_01 S05'),
  dv('min_contribution_b_bps', 'bps', 15, 'NON RECOUPÉ', 'Doc_01 S05'),
  dv('min_contribution_exemption_months', 'count', 36, 'NON RECOUPÉ', 'Doc_01 S05'),
];

const BY_KEY: ReadonlyMap<string, DatedValue> = new Map(DATED_VALUES.map((v) => [v.key, v]));

export function datedValue(key: string): DatedValue {
  const found = BY_KEY.get(key);
  if (found === undefined) throw new RangeError(`Valeur datée inconnue : ${key}`);
  return found;
}

export function datedValueKeys(): readonly string[] {
  return DATED_VALUES.map((v) => v.key);
}

/** Texte affiché sous une page qui cite des valeurs datées : date, état, origine. */
export interface DatedValueNote {
  readonly key: string;
  readonly as_of: string;
  readonly state: VerificationState;
}

export function datedValueNotes(keys: readonly string[]): readonly DatedValueNote[] {
  return keys.map((key) => {
    const v = datedValue(key);
    return { key: v.key, as_of: v.as_of, state: v.state };
  });
}
