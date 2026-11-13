/**
 * Cas chiffrés des guides : centimes entiers, points de base, BigInt (ADR-03, D-09). Aucun flottant.
 * Les montants viennent des vecteurs d'or documentés (VEC-CGI-01 à 06, Doc_14 S03 ; D-20 ; Doc_03 S12) ou de
 * calculs entiers sur ces montants, arrondis par `divRoundHalfUpBigInt`. Les taux viennent de `dated-values.ts`.
 */
import { datedValue } from '../dated-values.ts';
import { BILLING_POLICY } from '../billing-policy.ts';
import type { BillingPolicy } from '../billing-policy.ts';
import { ANNUAL_BILLED_MONTHS, FIDUCIARY_METER, PACK_MOWAKABA_CABINET, getPosModule, getPricingPlan } from '../pricing.ts';
import { divRoundHalfUpBigInt, mulBps } from '../../lib/money.ts';
import type { CaseCopy, CaseLine, CaseView, L4 } from './types.ts';

const BPS = 10000n;

function bpsOf(key: string): number {
  return datedValue(key).value;
}

function centsOfValue(key: string): number {
  return datedValue(key).value;
}

/** Arrondi au dirham supérieur, en centimes, sans division flottante : ceil(x / 100) = demi-supérieur de (x + 49) / 100. */
export function ceilToDirhamCents(amountCents: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new RangeError(`Montant invalide : ${String(amountCents)}`);
  return Number(divRoundHalfUpBigInt(BigInt(amountCents) + 49n, 100n) * 100n);
}

/** Part HT d'un TTC à un taux en points de base : `ttc x 10 000 / (10 000 + taux)`, demi supérieur. */
function htFromTtc(ttcCents: number, vatBps: number): number {
  return Number(divRoundHalfUpBigInt(BigInt(ttcCents) * BPS, BPS + BigInt(vatBps)));
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

function money(id: string, cents: number): CaseLine {
  return { id, cents };
}

function note(id: string, text: L4): CaseLine {
  return { id, text };
}

const SAME = (text: string): L4 => ({ fr: text, en: text, ar: text, ary: text });

/* ----- Plafond d'espèces (VEC-CGI-01) ----- */

function cashCase(): CaseView {
  const vatBps = bpsOf('vat_standard_bps');
  const ht = 600000;
  const vat = mulBps(ht, vatBps);
  const ttc = ht + vat;
  const cap = Math.min(ttc, centsOfValue('cash_cap_day_cents'), centsOfValue('cash_cap_month_cents'));
  const deductibleHt = htFromTtc(cap, vatBps);
  const recoverableVat = cap - deductibleHt;
  const reintegrated = ht - deductibleHt;
  const lostVat = vat - recoverableVat;
  return {
    id: 'cash',
    basis: ['VEC-CGI-01'],
    lines: [
      money('ht', ht),
      money('vat', vat),
      money('ttc', ttc),
      money('cap', cap),
      money('deductible_ht', deductibleHt),
      money('recoverable_vat', recoverableVat),
      money('reintegrated', reintegrated),
      money('lost_vat', lostVat),
    ],
    resultLineId: 'reintegrated',
    datedKeys: ['cash_cap_day_cents', 'cash_cap_month_cents', 'vat_standard_bps'],
  };
}

/* ----- Cumul mensuel d'espèces (ERRATA D-20) ----- */

function cashMonthCase(): CaseView {
  const unit = 480000;
  const cap = centsOfValue('cash_cap_month_cents');
  const cumulTen = unit * 10;
  const cumulEleven = unit * 11;
  return {
    id: 'cash_month',
    basis: ['ERRATA D-20'],
    lines: [money('unit', unit), money('cumul_ten', cumulTen), money('cap', cap), money('cumul_eleven', cumulEleven), money('excess', cumulEleven - cap)],
    resultLineId: 'excess',
    datedKeys: ['cash_cap_month_cents'],
  };
}

/* ----- Loi 69-21 (VEC-CGI-02) ----- */

function lateCase(): CaseView {
  const unpaid = 1234500;
  const totalBps = bpsOf('late_base_bps') + bpsOf('late_increment_bps');
  const raw = mulBps(unpaid, totalBps);
  const penalty = ceilToDirhamCents(raw);
  return {
    id: 'late',
    basis: ['VEC-CGI-02'],
    lines: [money('unpaid', unpaid), note('delay', SAME('46')), money('raw', raw), money('penalty', penalty)],
    resultLineId: 'penalty',
    datedKeys: ['late_base_bps', 'late_increment_bps', 'late_total_two_months_bps'],
  };
}

function lateDisputeCase(): CaseView {
  const unpaid = 1234500;
  return {
    id: 'late_dispute',
    basis: ['VEC-CGI-02', 'Doc_07 S08'],
    lines: [money('unpaid', unpaid), money('disputed', unpaid), money('penalty', 0)],
    resultLineId: 'penalty',
    datedKeys: [],
  };
}

/* ----- RAS-TVA (VEC-CGI-03) ----- */

function rasCase(): CaseView {
  const ttc = 1200000;
  const vat = 200000;
  const reduced = mulBps(vat, bpsOf('ras_reduced_bps'));
  const full = mulBps(vat, bpsOf('ras_full_bps'));
  return {
    id: 'ras',
    basis: ['VEC-CGI-03'],
    lines: [
      money('ttc', ttc),
      money('vat', vat),
      money('ras_valid', reduced),
      money('net_valid', ttc - reduced),
      money('ras_expired', full),
      money('net_expired', ttc - full),
    ],
    resultLineId: 'ras_valid',
    datedKeys: ['ras_reduced_bps', 'ras_full_bps', 'ras_attestation_months', 'ras_exclusion_threshold_ttc_cents'],
  };
}

/* ----- Auto-entrepreneur (VEC-CGI-04) ----- */

function aeCase(): CaseView {
  const threshold = centsOfValue('ae_client_threshold_cents');
  const before = 7500000;
  const invoice = 1200000;
  const surplus = before + invoice - threshold;
  const withholding = mulBps(surplus, bpsOf('ae_withholding_bps'));
  return {
    id: 'ae',
    basis: ['VEC-CGI-04'],
    lines: [
      money('threshold', threshold),
      money('before', before),
      money('invoice', invoice),
      money('surplus', surplus),
      money('withholding', withholding),
      money('net', invoice - withholding),
    ],
    resultLineId: 'withholding',
    datedKeys: ['ae_client_threshold_cents', 'ae_withholding_bps'],
  };
}

/* ----- Taux de TVA admis (VEC-CGI-05) ----- */

function vatAdmitCase(): CaseView {
  const ht = 1000000;
  return {
    id: 'vat_admit',
    basis: ['VEC-CGI-05'],
    lines: [
      money('ht', ht),
      note('rejected_code', SAME('ADR_04_LF2026_VAT_VIOLATION')),
      money('vat_standard', mulBps(ht, bpsOf('vat_standard_bps'))),
      money('vat_reduced', mulBps(ht, bpsOf('vat_reduced_bps'))),
      money('vat_zero', mulBps(ht, bpsOf('vat_zero_bps'))),
    ],
    resultLineId: 'vat_standard',
    datedKeys: ['vat_standard_bps', 'vat_reduced_bps', 'vat_zero_bps', 'vat_rejected_sample_bps'],
  };
}

/* ----- Décompte BTP (VEC-CGI-06) ----- */

function btpCase(): CaseView {
  const works = 10000000;
  const debours = 500000;
  const vatBps = bpsOf('vat_standard_bps');
  const retention = mulBps(works, bpsOf('btp_retention_bps'));
  const vatWorks = mulBps(works, vatBps);
  const deferred = mulBps(retention, vatBps);
  return {
    id: 'btp',
    basis: ['VEC-CGI-06'],
    lines: [
      money('works', works),
      money('debours', debours),
      money('retention', retention),
      money('vat_works', vatWorks),
      money('deferred_vat', deferred),
      money('vat_due_now', vatWorks - deferred),
      money('debours_vat', 0),
    ],
    resultLineId: 'vat_due_now',
    datedKeys: ['vat_standard_bps', 'btp_retention_bps'],
  };
}

/* ----- Mapping UBL 2.1 d'une facture (montants du vecteur VEC-CGI-03) ----- */

function ublCase(): CaseView {
  const ht = 1000000;
  const vat = mulBps(ht, bpsOf('vat_standard_bps'));
  return {
    id: 'ubl',
    basis: ['VEC-CGI-03'],
    lines: [money('exclusive', ht), money('tax', vat), money('inclusive', ht + vat), money('payable', ht + vat)],
    resultLineId: 'payable',
    datedKeys: ['vat_standard_bps'],
  };
}

function creditNoteCase(): CaseView {
  const ttc = 1200000;
  return {
    id: 'credit_note',
    basis: ['VEC-CGI-03'],
    lines: [money('invoice', ttc), money('credit', ttc), money('balance', ttc - ttc)],
    resultLineId: 'balance',
    datedKeys: [],
  };
}

/* ----- Timbre espèces (illustration sur le montant de VEC-CGI-01) ----- */

function stampCase(): CaseView {
  const cash = 720000;
  return {
    id: 'stamp',
    basis: ['VEC-CGI-01'],
    lines: [money('cash', cash), money('stamp', mulBps(cash, bpsOf('cash_stamp_bps')))],
    resultLineId: 'stamp',
    datedKeys: ['cash_stamp_bps'],
  };
}

/* ----- DRVT (illustration sur la base HT de VEC-CGI-03) ----- */

function drvtCase(): CaseView {
  const fees = 1000000;
  return {
    id: 'drvt',
    basis: ['VEC-CGI-03'],
    lines: [
      money('fees', fees),
      money('ras_legal', mulBps(fees, bpsOf('drvt_ras_legal_entity_bps'))),
      money('ras_individual', mulBps(fees, bpsOf('drvt_ras_individual_bps'))),
    ],
    resultLineId: 'ras_legal',
    datedKeys: ['drvt_ras_legal_entity_bps', 'drvt_ras_individual_bps'],
  };
}

function rentCase(): CaseView {
  const rent = centsOfValue('drvt_rent_tier_cents');
  return {
    id: 'rent',
    basis: ['Doc_07 S09'],
    lines: [money('rent', rent), money('ras_low', mulBps(rent, bpsOf('drvt_rent_low_bps'))), money('ras_high', mulBps(rent, bpsOf('drvt_rent_high_bps')))],
    resultLineId: 'ras_low',
    datedKeys: ['drvt_rent_low_bps', 'drvt_rent_high_bps', 'drvt_rent_tier_cents'],
  };
}

/* ----- Prestation étrangère (illustration, Doc_01 S05) ----- */

function foreignCase(): CaseView {
  const invoice = 1000000;
  const ras = mulBps(invoice, bpsOf('foreign_service_ras_is_bps'));
  return {
    id: 'foreign',
    basis: ['VEC-CGI-03', 'Doc_01 S05'],
    lines: [
      money('invoice', invoice),
      money('self_vat', mulBps(invoice, bpsOf('vat_standard_bps'))),
      money('ras', ras),
      money('transfer', invoice - ras),
    ],
    resultLineId: 'transfer',
    datedKeys: ['vat_standard_bps', 'foreign_service_ras_is_bps'],
  };
}

/* ----- Silo 4 : grille fiduciaire (Doc_03 S04 et S12) ----- */

function tierCents(code: 'DOSSIER_SIMPLIFIE' | 'DOSSIER_TPE' | 'DOSSIER_PME_COMPLET'): number {
  const tier = FIDUCIARY_METER.dossierTiers.find((t) => t.code === code);
  if (tier === undefined) throw new RangeError(`Palier inconnu : ${code}`);
  return tier.monthly_ht_cents;
}

function prorataCase(policy: BillingPolicy): CaseView {
  const tpe = tierCents('DOSSIER_TPE');
  const pme = tierCents('DOSSIER_PME_COMPLET');
  const daysInMonth = 30;
  const activeDays = 15;
  const daily = (tier: number): number => Number(divRoundHalfUpBigInt(BigInt(tier) * BigInt(activeDays), BigInt(daysInMonth)));
  const daily_mode = policy.fiduciaryProrata === 'DAILY';
  return {
    id: 'prorata',
    basis: ['Doc_03 S12', 'Doc_03 S04'],
    lines: [
      money('tpe_full', tpe),
      money('pme_full', pme),
      money('tpe_billed', daily_mode ? daily(tpe) : tpe),
      money('pme_billed', daily_mode ? daily(pme) : pme),
    ],
    resultLineId: 'tpe_billed',
    datedKeys: [],
  };
}

function meterMidCase(): CaseView {
  const base = FIDUCIARY_METER.base.monthly_ht_cents;
  const pos = getPosModule('POS_TACTILE_FLEET').monthly_ht_cents * 2;
  const simplified = tierCents('DOSSIER_SIMPLIFIE') * 10;
  const tpe = tierCents('DOSSIER_TPE') * 35;
  const pme = tierCents('DOSSIER_PME_COMPLET') * 15;
  const ht = sum([base, pos, simplified, tpe, pme]);
  const vat = mulBps(ht, bpsOf('vat_standard_bps'));
  return {
    id: 'meter_mid',
    basis: ['Doc_03 S12'],
    lines: [
      money('base', base),
      money('simplified', simplified),
      money('tpe', tpe),
      money('pme', pme),
      money('pos', pos),
      money('ht', ht),
      money('vat', vat),
      money('ttc', ht + vat),
    ],
    resultLineId: 'ttc',
    datedKeys: ['vat_standard_bps'],
  };
}

function volumeCase(): CaseView {
  const gross = tierCents('DOSSIER_SIMPLIFIE') * 20 + tierCents('DOSSIER_TPE') * 50 + tierCents('DOSSIER_PME_COMPLET') * 30;
  const discount = mulBps(gross, FIDUCIARY_METER.volumeDiscount.discount_bps);
  const base = FIDUCIARY_METER.base.monthly_ht_cents;
  const net = gross - discount + base;
  const vat = mulBps(net, bpsOf('vat_standard_bps'));
  return {
    id: 'volume',
    basis: ['Doc_03 S12', 'ERRATA D-06'],
    lines: [money('gross', gross), money('discount', discount), money('base', base), money('net', net), money('vat', vat), money('ttc', net + vat)],
    resultLineId: 'discount',
    datedKeys: ['vat_standard_bps'],
  };
}

function mowakabaCase(): CaseView {
  const tpme = getPricingPlan('PACK_MOWAKABA_TPME');
  if (tpme.kind !== 'ONE_OFF') throw new RangeError('Pack TPME attendu');
  const low = bpsOf('mowakaba_coverage_low_bps');
  const high = bpsOf('mowakaba_coverage_high_bps');
  const tpmePrice = tpme.one_off_ht_cents;
  const cabinetPrice = PACK_MOWAKABA_CABINET.one_off_ht_cents;
  return {
    id: 'mowakaba',
    basis: ['Doc_03 S06'],
    lines: [
      money('tpme_price', tpmePrice),
      money('tpme_low_out', tpmePrice - mulBps(tpmePrice, low)),
      money('tpme_high_out', tpmePrice - mulBps(tpmePrice, high)),
      money('cabinet_price', cabinetPrice),
      money('cabinet_low_out', cabinetPrice - mulBps(cabinetPrice, low)),
      money('cabinet_high_out', cabinetPrice - mulBps(cabinetPrice, high)),
    ],
    resultLineId: 'tpme_low_out',
    datedKeys: ['mowakaba_coverage_low_bps', 'mowakaba_coverage_high_bps'],
  };
}

function posChrCase(): CaseView {
  const base = getPricingPlan('CROISSANCE_PME');
  if (base.kind !== 'RECURRING') throw new RangeError('Palier récurrent attendu');
  const extra = getPosModule('POS_TACTILE_STD').monthly_ht_cents;
  return {
    id: 'pos_chr',
    basis: ['Doc_03 S02', 'Doc_03 S03'],
    lines: [money('plan', base.monthly_ht_cents), money('extra_unit', extra), money('extra_two', extra * 2), money('total', base.monthly_ht_cents + extra * 2)],
    resultLineId: 'total',
    datedKeys: [],
  };
}

function posFleetCase(): CaseView {
  const std = getPosModule('POS_TACTILE_STD').monthly_ht_cents;
  const fleet = getPosModule('POS_TACTILE_FLEET').monthly_ht_cents;
  return {
    id: 'pos_fleet',
    basis: ['Doc_03 S03'],
    lines: [money('std_ten', std * 10), money('fleet_ten', fleet * 10), money('saving', std * 10 - fleet * 10)],
    resultLineId: 'saving',
    datedKeys: [],
  };
}

function annualCase(code: 'CROISSANCE_PME' | 'ESSENTIEL_TPE', id: string): CaseView {
  const plan = getPricingPlan(code);
  if (plan.kind !== 'RECURRING') throw new RangeError('Palier récurrent attendu');
  const twelve = plan.monthly_ht_cents * 12;
  const annual = plan.monthly_ht_cents * ANNUAL_BILLED_MONTHS;
  return {
    id,
    basis: ['Doc_03 S02'],
    lines: [money('monthly', plan.monthly_ht_cents), money('twelve', twelve), money('annual', annual), money('saving', twelve - annual)],
    resultLineId: 'saving',
    datedKeys: [],
  };
}

/* ----- POS : Ticket Z et conversion QR ----- */

function zTicketCase(): CaseView {
  const first = 1200000;
  const second = 720000;
  const total = first + second;
  const vatBps = bpsOf('vat_standard_bps');
  const ht = htFromTtc(total, vatBps);
  return {
    id: 'z_ticket',
    basis: ['VEC-CGI-03', 'VEC-CGI-01'],
    lines: [money('first', first), money('second', second), money('total', total), money('ht', ht), money('vat', total - ht)],
    resultLineId: 'total',
    datedKeys: ['vat_standard_bps'],
  };
}

function qrConvertCase(): CaseView {
  const ticket = 1200000;
  return {
    id: 'qr_convert',
    basis: ['VEC-CGI-03', 'Doc_07 S03'],
    lines: [money('ticket', ticket), money('invoice', ticket), money('reversal', ticket), money('residual', ticket - ticket)],
    resultLineId: 'residual',
    datedKeys: [],
  };
}

export const CASE_IDS = [
  'cash',
  'cash_month',
  'late',
  'late_dispute',
  'ras',
  'ae',
  'vat_admit',
  'btp',
  'ubl',
  'credit_note',
  'stamp',
  'drvt',
  'rent',
  'foreign',
  'prorata',
  'meter_mid',
  'volume',
  'mowakaba',
  'pos_chr',
  'pos_fleet',
  'annual_growth',
  'annual_essential',
  'z_ticket',
  'qr_convert',
] as const;

export type CaseId = (typeof CASE_IDS)[number];

export function isCaseId(value: string): value is CaseId {
  return (CASE_IDS as readonly string[]).includes(value);
}

export function buildCase(id: CaseId, policy: BillingPolicy = BILLING_POLICY): CaseView {
  switch (id) {
    case 'cash':
      return cashCase();
    case 'cash_month':
      return cashMonthCase();
    case 'late':
      return lateCase();
    case 'late_dispute':
      return lateDisputeCase();
    case 'ras':
      return rasCase();
    case 'ae':
      return aeCase();
    case 'vat_admit':
      return vatAdmitCase();
    case 'btp':
      return btpCase();
    case 'ubl':
      return ublCase();
    case 'credit_note':
      return creditNoteCase();
    case 'stamp':
      return stampCase();
    case 'drvt':
      return drvtCase();
    case 'rent':
      return rentCase();
    case 'foreign':
      return foreignCase();
    case 'prorata':
      return prorataCase(policy);
    case 'meter_mid':
      return meterMidCase();
    case 'volume':
      return volumeCase();
    case 'mowakaba':
      return mowakabaCase();
    case 'pos_chr':
      return posChrCase();
    case 'pos_fleet':
      return posFleetCase();
    case 'annual_growth':
      return annualCase('CROISSANCE_PME', 'annual_growth');
    case 'annual_essential':
      return annualCase('ESSENTIEL_TPE', 'annual_essential');
    case 'z_ticket':
      return zTicketCase();
    case 'qr_convert':
      return qrConvertCase();
  }
}

export type { CaseCopy };
