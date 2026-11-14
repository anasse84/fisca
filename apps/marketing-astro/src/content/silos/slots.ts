/**
 * Variables de gabarit des guides : toute valeur chiffrée d'un texte passe par une variable `{nom}` remplie ici,
 * depuis `dated-values.ts` (valeurs fiscales datées), la grille tarifaire et les cas chiffrés. Aucun texte de silo
 * n'écrit un pourcentage ou un taux en dur.
 */
import { BILLING_POLICY } from '../billing-policy.ts';
import { prorataRule } from '../billing-policy.ts';
import type { BillingPolicy } from '../billing-policy.ts';
import { DATED_VALUES } from '../dated-values.ts';
import {
  FIDUCIARY_METER,
  MOWAKABA_ELIGIBILITY_MAX_REVENUE_HT_MAD_MILLIONS,
  PACK_MOWAKABA_CABINET,
  TRIAL_DAYS,
  getPosModule,
  getPricingPlan,
} from '../pricing.ts';
import type { CopyLocale } from '../../i18n/copy-locale.ts';
import { formatBpsPercent, formatCentsMad } from '../../lib/money.ts';
import { buildCase, CASE_IDS } from './cases.ts';
import type { L4 } from './types.ts';

export type Slots = Readonly<Record<string, string>>;

const MOWAKABA_CEILING: L4 = {
  fr: `${String(MOWAKABA_ELIGIBILITY_MAX_REVENUE_HT_MAD_MILLIONS)} M MAD HT`,
  en: `MAD ${String(MOWAKABA_ELIGIBILITY_MAX_REVENUE_HT_MAD_MILLIONS)} million excl. tax`,
  ar: `${String(MOWAKABA_ELIGIBILITY_MAX_REVENUE_HT_MAD_MILLIONS)} مليون درهم بدون ضريبة`,
  ary: `${String(MOWAKABA_ELIGIBILITY_MAX_REVENUE_HT_MAD_MILLIONS)} مليون درهم بلا TVA`,
};

function slotName(key: string): string {
  return key.replace(/_(bps|cents)$/, '');
}

function monthlyOf(code: 'SOLO_AE' | 'ESSENTIEL_TPE' | 'CROISSANCE_PME'): number {
  const plan = getPricingPlan(code);
  if (plan.kind !== 'RECURRING') throw new RangeError('Palier récurrent attendu');
  return plan.monthly_ht_cents;
}

function tier(code: 'DOSSIER_SIMPLIFIE' | 'DOSSIER_TPE' | 'DOSSIER_PME_COMPLET'): number {
  const found = FIDUCIARY_METER.dossierTiers.find((t) => t.code === code);
  if (found === undefined) throw new RangeError(`Palier inconnu : ${code}`);
  return found.monthly_ht_cents;
}

export function buildSlots(locale: CopyLocale, policy: BillingPolicy = BILLING_POLICY): Slots {
  const slots: Record<string, string> = {};
  for (const v of DATED_VALUES) {
    slots[slotName(v.key)] = v.kind === 'bps' ? formatBpsPercent(v.value) : v.kind === 'cents' ? formatCentsMad(v.value) : String(v.value);
  }
  for (const id of CASE_IDS) {
    for (const line of buildCase(id, policy).lines) {
      if (line.cents !== undefined) slots[`c_${id}_${line.id}`] = formatCentsMad(line.cents);
    }
  }
  slots['price_solo'] = formatCentsMad(monthlyOf('SOLO_AE'));
  slots['price_essentiel'] = formatCentsMad(monthlyOf('ESSENTIEL_TPE'));
  slots['price_croissance'] = formatCentsMad(monthlyOf('CROISSANCE_PME'));
  slots['price_cabinet_base'] = formatCentsMad(FIDUCIARY_METER.base.monthly_ht_cents);
  slots['price_dossier_simplifie'] = formatCentsMad(tier('DOSSIER_SIMPLIFIE'));
  slots['price_dossier_tpe'] = formatCentsMad(tier('DOSSIER_TPE'));
  slots['price_dossier_pme'] = formatCentsMad(tier('DOSSIER_PME_COMPLET'));
  slots['price_pos_std'] = formatCentsMad(getPosModule('POS_TACTILE_STD').monthly_ht_cents);
  slots['price_pos_fleet'] = formatCentsMad(getPosModule('POS_TACTILE_FLEET').monthly_ht_cents);
  slots['price_pos_bridge'] = formatCentsMad(getPosModule('POS_BRIDGE').monthly_ht_cents);
  slots['price_pack_cabinet'] = formatCentsMad(PACK_MOWAKABA_CABINET.one_off_ht_cents);
  slots['volume_discount'] = formatBpsPercent(FIDUCIARY_METER.volumeDiscount.discount_bps);
  slots['volume_min'] = String(FIDUCIARY_METER.volumeDiscount.minActiveDossiers);
  slots['trial_days'] = String(TRIAL_DAYS);
  slots['mowakaba_ceiling'] = MOWAKABA_CEILING[locale];
  slots['prorata_rule'] = prorataRule(locale, policy);
  return slots;
}
