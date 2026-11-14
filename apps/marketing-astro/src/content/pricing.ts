/**
 * Grille tarifaire publique (Doc_03 S02 et S06). Montants HT en centimes entiers (ADR-03).
 * Réutilisé par T-P2C-03 : ne contient aucune règle fiscale (pas de taux de TVA, donc pas de TTC).
 */
import { applyDiscountBps } from '../lib/money.ts';

export type PlanCode = 'SOLO_AE' | 'ESSENTIEL_TPE' | 'CROISSANCE_PME' | 'PACK_MOWAKABA_TPME';

export type RecurringPlanCode = 'SOLO_AE' | 'ESSENTIEL_TPE' | 'CROISSANCE_PME';

export interface RecurringPlan {
  readonly kind: 'RECURRING';
  readonly code: RecurringPlanCode;
  readonly name: string;
  readonly audience: string;
  readonly monthly_ht_cents: number;
  readonly annual_ht_cents: number;
  readonly inclusions: readonly string[];
}

export interface OneOffPlan {
  readonly kind: 'ONE_OFF';
  readonly code: 'PACK_MOWAKABA_TPME';
  readonly name: string;
  readonly audience: string;
  readonly one_off_ht_cents: number;
  readonly includedSubscription: { readonly code: RecurringPlanCode; readonly months: number };
  readonly inclusions: readonly string[];
}

export type PricingPlan = RecurringPlan | OneOffPlan;

export const PRICING_CURRENCY = 'MAD';

export const PRICING_PLANS: readonly PricingPlan[] = [
  {
    kind: 'RECURRING',
    code: 'SOLO_AE',
    name: 'Fisca Solo',
    audience: 'Auto-entrepreneurs',
    monthly_ht_cents: 12900,
    annual_ht_cents: 129000,
    inclusions: ['1 siège utilisateur et 1 accès comptable'],
  },
  {
    kind: 'RECURRING',
    code: 'ESSENTIEL_TPE',
    name: 'Fisca Essentiel',
    audience: 'TPE et professions libérales',
    monthly_ht_cents: 39000,
    annual_ht_cents: 390000,
    inclusions: ['5 sièges utilisateurs', 'Fisca POS Bridge gratuit'],
  },
  {
    kind: 'RECURRING',
    code: 'CROISSANCE_PME',
    name: 'Fisca Croissance',
    audience: 'PME, négoce et BTP',
    monthly_ht_cents: 89000,
    annual_ht_cents: 890000,
    inclusions: ['15 sièges utilisateurs', '1 terminal Fisca POS Tactile inclus'],
  },
  {
    kind: 'ONE_OFF',
    code: 'PACK_MOWAKABA_TPME',
    name: 'Pack TPME Mowakaba',
    audience: 'TPME éligibles au dispositif Mowakaba',
    one_off_ht_cents: 1800000,
    includedSubscription: { code: 'CROISSANCE_PME', months: 12 },
    inclusions: [
      'Rapport d’audit IA de maturité numérique',
      'Assainissement de la base tiers ICE et IF',
      'Paramétrage du plan comptable et de la signature Barid eSign (loi 43-20)',
      'Formation attestée des équipes',
      '12 mois d’abonnement Fisca Croissance prépayés',
    ],
  },
];

export function getPricingPlan(code: PlanCode): PricingPlan {
  const found = PRICING_PLANS.find((p) => p.code === code);
  if (found === undefined) throw new RangeError(`Offre inconnue : ${code}`);
  return found;
}

/** Montant HT « d'appel » de l'offre : mensualité, ou prix du pack. */
export function headlinePriceCents(plan: PricingPlan): number {
  return plan.kind === 'RECURRING' ? plan.monthly_ht_cents : plan.one_off_ht_cents;
}

/* ------------------------------------------------------------------------------------------------
 * T-P2C-03 : extension de la grille aux 4 familles (Doc_03 S02 à S06). Ajouts seuls : l'API ci-dessus
 * (PRICING_PLANS, getPricingPlan, headlinePriceCents) reste inchangée. Montants HT en centimes entiers,
 * taux en points de base, aucun flottant, aucune règle fiscale (pas de TVA, donc pas de TTC).
 * ---------------------------------------------------------------------------------------------- */

export type PricingFamilyId = 'PME' | 'POS' | 'OEC' | 'CORPORATE_SOUVERAIN';

export const PRICING_FAMILY_ORDER: readonly PricingFamilyId[] = ['PME', 'POS', 'OEC', 'CORPORATE_SOUVERAIN'];

/** Doc_03 S02 : essai Sandbox gratuit de 14 jours ; paiement annuel = 10 mensualités (2 mois offerts). */
export const TRIAL_DAYS = 14;
export const ANNUAL_BILLED_MONTHS = 10;
export const ANNUAL_FREE_MONTHS = 2;

/** Doc_03 S02 : collaborateur supplémentaire au-delà du quota (Essentiel et Croissance). */
export const ADDITIONAL_SEAT_MONTHLY_HT_CENTS = 4900;

export type PmeComparisonPos = 'NONE' | 'POS_BRIDGE' | 'POS_TACTILE_1';

/** Matrice de comparaison PME (Doc_03 S02) : chaque palier inclut le précédent. */
export interface PmeComparison {
  readonly code: RecurringPlanCode;
  readonly includedSeats: number;
  /** Solo : 1 accès comptable en plus du siège utilisateur ; 0 pour les autres paliers (non précisé). */
  readonly accountantAccessSeats: number;
  readonly pos: PmeComparisonPos;
  readonly additionalSeatAllowed: boolean;
  readonly sageOdooConnectors: boolean;
  readonly immutableLedger: boolean;
  readonly btpAndAnnualReturn: boolean;
}

export const PME_COMPARISON: readonly PmeComparison[] = [
  {
    code: 'SOLO_AE',
    includedSeats: 1,
    accountantAccessSeats: 1,
    pos: 'NONE',
    additionalSeatAllowed: false,
    sageOdooConnectors: false,
    immutableLedger: false,
    btpAndAnnualReturn: false,
  },
  {
    code: 'ESSENTIEL_TPE',
    includedSeats: 5,
    accountantAccessSeats: 0,
    pos: 'POS_BRIDGE',
    additionalSeatAllowed: true,
    sageOdooConnectors: true,
    immutableLedger: false,
    btpAndAnnualReturn: false,
  },
  {
    code: 'CROISSANCE_PME',
    includedSeats: 15,
    accountantAccessSeats: 0,
    pos: 'POS_TACTILE_1',
    additionalSeatAllowed: true,
    sageOdooConnectors: true,
    immutableLedger: true,
    btpAndAnnualReturn: true,
  },
];

export function getPmeComparison(code: RecurringPlanCode): PmeComparison {
  const found = PME_COMPARISON.find((c) => c.code === code);
  if (found === undefined) throw new RangeError(`Palier PME inconnu : ${code}`);
  return found;
}

/** Plafond d'éligibilité Mowakaba : CA <= 200 M MAD HT (Doc_03 S06, ERRATA § C). Critère commercial, pas une règle fiscale. */
export const MOWAKABA_ELIGIBILITY_MAX_REVENUE_HT_MAD_MILLIONS = 200;
export const MOWAKABA_ELIGIBILITY_MAX_REVENUE_HT_CENTS = MOWAKABA_ELIGIBILITY_MAX_REVENUE_HT_MAD_MILLIONS * 100_000_000;
/** Doc_03 S05 : détention par un grand groupe au-delà de laquelle l'entreprise relève des contrats annuels (2 500 bps). */
export const LARGE_GROUP_OWNERSHIP_THRESHOLD_BPS = 2500;

/* ----- POS (Doc_03 S03) ----- */

export type PosModuleCode = 'POS_BRIDGE' | 'POS_TACTILE_INC' | 'POS_TACTILE_STD' | 'POS_TACTILE_FLEET';

export type PosCondition =
  | 'INCLUDED_FROM_ESSENTIEL'
  | 'INCLUDED_IN_CROISSANCE'
  | 'FROM_1_TO_9_ACTIVE_TERMINALS'
  | 'FROM_10_TERMINALS_OR_OEC_PARTNER';

export interface PosModule {
  readonly code: PosModuleCode;
  readonly name: string;
  readonly scope: string;
  readonly monthly_ht_cents: number;
  readonly annual_ht_cents: number;
  readonly condition: PosCondition;
}

export const POS_MODULES: readonly PosModule[] = [
  {
    code: 'POS_BRIDGE',
    name: 'Fisca POS Bridge',
    scope: 'Connecteur de caisses tierces',
    monthly_ht_cents: 0,
    annual_ht_cents: 0,
    condition: 'INCLUDED_FROM_ESSENTIEL',
  },
  {
    code: 'POS_TACTILE_INC',
    name: 'Fisca POS Tactile (1re caisse)',
    scope: 'Première caisse tactile native',
    monthly_ht_cents: 0,
    annual_ht_cents: 0,
    condition: 'INCLUDED_IN_CROISSANCE',
  },
  {
    code: 'POS_TACTILE_STD',
    name: 'Fisca POS Tactile (caisse additionnelle)',
    scope: 'Caisse tactile additionnelle',
    monthly_ht_cents: 14900,
    annual_ht_cents: 149000,
    condition: 'FROM_1_TO_9_ACTIVE_TERMINALS',
  },
  {
    code: 'POS_TACTILE_FLEET',
    name: 'Fisca POS Tactile (flotte ou partenaire OEC)',
    scope: 'Tarif flotte ou partenaire OEC',
    monthly_ht_cents: 9900,
    annual_ht_cents: 99000,
    condition: 'FROM_10_TERMINALS_OR_OEC_PARTNER',
  },
];

export function getPosModule(code: PosModuleCode): PosModule {
  const found = POS_MODULES.find((m) => m.code === code);
  if (found === undefined) throw new RangeError(`Module POS inconnu : ${code}`);
  return found;
}

/* ----- OEC et fiduciaires (Doc_03 S04, S06 ; ERRATA D-06 : remise 1 500 bps) ----- */

export type FiduciaryDossierCode = 'DOSSIER_SIMPLIFIE' | 'DOSSIER_TPE' | 'DOSSIER_PME_COMPLET';

export interface FiduciaryBase {
  readonly code: 'CABINET_BASE';
  readonly name: string;
  readonly monthly_ht_cents: number;
}

export interface FiduciaryDossierTier {
  readonly code: FiduciaryDossierCode;
  readonly name: string;
  readonly audience: string;
  readonly monthly_ht_cents: number;
}

export interface FiduciaryMeter {
  readonly base: FiduciaryBase;
  readonly dossierTiers: readonly FiduciaryDossierTier[];
  readonly volumeDiscount: { readonly minActiveDossiers: number; readonly discount_bps: number };
}

export const FIDUCIARY_METER: FiduciaryMeter = {
  base: { code: 'CABINET_BASE', name: 'Socle cabinet marque blanche', monthly_ht_cents: 49000 },
  dossierTiers: [
    { code: 'DOSSIER_SIMPLIFIE', name: 'Dossier simplifié', audience: 'AE, SCI ou société sans activité', monthly_ht_cents: 6900 },
    { code: 'DOSSIER_TPE', name: 'Dossier TPE', audience: 'Tenue CGNC, OCR IA, télétransmission et TVA', monthly_ht_cents: 14900 },
    { code: 'DOSSIER_PME_COMPLET', name: 'Dossier PME complet', audience: 'PME avec agents IA, IS, état 9421, DRVT et loi 69-21', monthly_ht_cents: 24900 },
  ],
  volumeDiscount: { minActiveDossiers: 100, discount_bps: 1500 },
};

export interface CabinetPack {
  readonly kind: 'ONE_OFF';
  readonly code: 'PACK_MOWAKABA_CABINET';
  readonly name: string;
  readonly audience: string;
  readonly one_off_ht_cents: number;
  /** Portefeuille prépayé de consommation de dossiers clients inclus dans le pack (Doc_03 S06). */
  readonly prepaidDossierWallet_ht_cents: number;
  readonly includedBaseMonths: number;
  readonly inclusions: readonly string[];
}

export const PACK_MOWAKABA_CABINET: CabinetPack = {
  kind: 'ONE_OFF',
  code: 'PACK_MOWAKABA_CABINET',
  name: 'Pack Cabinet Mowakaba',
  audience: 'Cabinets et fiduciaires éligibles au dispositif Mowakaba',
  one_off_ht_cents: 4500000,
  prepaidDossierWallet_ht_cents: 2500000,
  includedBaseMonths: 12,
  inclusions: [
    'Audit du cabinet',
    'Reprise des balances historiques Sage et JBS',
    'Déploiement du portail marque blanche',
    'Certification des collaborateurs du cabinet',
    '12 mois de socle cabinet inclus',
    'Portefeuille prépayé de 25 000 MAD HT de consommation de dossiers clients',
  ],
};

/** Prix unitaire de dossier après remise volume : `cents x (10 000 - bps) / 10 000`, arrondi demi-supérieur (BigInt). */
export function discountedDossierCents(tier: FiduciaryDossierTier, meter: FiduciaryMeter = FIDUCIARY_METER): number {
  return applyDiscountBps(tier.monthly_ht_cents, meter.volumeDiscount.discount_bps);
}

/* ----- Grands comptes (Doc_03 S05) ----- */

export type EnterpriseContractCode = 'ENT_CORPORATE' | 'ENT_SOUVERAIN';

export interface EnterpriseContract {
  readonly code: EnterpriseContractCode;
  readonly name: string;
  readonly audience: string;
  readonly annual_ht_cents: number;
  readonly includedIce: number;
  readonly additionalIceAnnual_ht_cents: number;
  /** Vrai : base de données, coffre et inférence GPU localisés physiquement au Maroc (Doc_11 S08). */
  readonly dataResidencyMoroccoOnly: boolean;
}

export const ENTERPRISE_CONTRACTS: readonly EnterpriseContract[] = [
  {
    code: 'ENT_CORPORATE',
    name: 'Fisca Corporate',
    audience: 'ETI, holdings et groupes privés',
    annual_ht_cents: 5800000,
    includedIce: 5,
    additionalIceAnnual_ht_cents: 750000,
    dataResidencyMoroccoOnly: false,
  },
  {
    code: 'ENT_SOUVERAIN',
    name: 'Fisca Souverain (loi 05-20)',
    audience: 'Banques, assurances, opérateurs d’importance vitale et secteur public',
    annual_ht_cents: 14000000,
    includedIce: 10,
    additionalIceAnnual_ht_cents: 1000000,
    dataResidencyMoroccoOnly: true,
  },
];

export function getEnterpriseContract(code: EnterpriseContractCode): EnterpriseContract {
  const found = ENTERPRISE_CONTRACTS.find((c) => c.code === code);
  if (found === undefined) throw new RangeError(`Contrat inconnu : ${code}`);
  return found;
}

/* ----- Catalogue aplati (JSON-LD, llms.txt, miroirs) ----- */

export type CatalogBilling = 'MONTHLY_AND_ANNUAL' | 'MONTHLY' | 'ANNUAL' | 'ONE_OFF';

export interface CatalogOffer {
  readonly code: string;
  readonly family: PricingFamilyId;
  readonly name: string;
  readonly audience: string;
  readonly billing: CatalogBilling;
  readonly monthly_ht_cents: number | null;
  readonly annual_ht_cents: number | null;
  readonly one_off_ht_cents: number | null;
}

function recurringOffer(plan: RecurringPlan): CatalogOffer {
  return {
    code: plan.code,
    family: 'PME',
    name: plan.name,
    audience: plan.audience,
    billing: 'MONTHLY_AND_ANNUAL',
    monthly_ht_cents: plan.monthly_ht_cents,
    annual_ht_cents: plan.annual_ht_cents,
    one_off_ht_cents: null,
  };
}

function buildCatalogOffers(): readonly CatalogOffer[] {
  const offers: CatalogOffer[] = [];
  for (const plan of PRICING_PLANS) {
    if (plan.kind === 'RECURRING') {
      offers.push(recurringOffer(plan));
    } else {
      offers.push({
        code: plan.code,
        family: 'PME',
        name: plan.name,
        audience: plan.audience,
        billing: 'ONE_OFF',
        monthly_ht_cents: null,
        annual_ht_cents: null,
        one_off_ht_cents: plan.one_off_ht_cents,
      });
    }
  }
  for (const mod of POS_MODULES) {
    offers.push({
      code: mod.code,
      family: 'POS',
      name: mod.name,
      audience: mod.scope,
      billing: 'MONTHLY_AND_ANNUAL',
      monthly_ht_cents: mod.monthly_ht_cents,
      annual_ht_cents: mod.annual_ht_cents,
      one_off_ht_cents: null,
    });
  }
  offers.push({
    code: FIDUCIARY_METER.base.code,
    family: 'OEC',
    name: FIDUCIARY_METER.base.name,
    audience: 'Cabinets comptables et fiduciaires',
    billing: 'MONTHLY',
    monthly_ht_cents: FIDUCIARY_METER.base.monthly_ht_cents,
    annual_ht_cents: null,
    one_off_ht_cents: null,
  });
  for (const tier of FIDUCIARY_METER.dossierTiers) {
    offers.push({
      code: tier.code,
      family: 'OEC',
      name: tier.name,
      audience: tier.audience,
      billing: 'MONTHLY',
      monthly_ht_cents: tier.monthly_ht_cents,
      annual_ht_cents: null,
      one_off_ht_cents: null,
    });
  }
  offers.push({
    code: PACK_MOWAKABA_CABINET.code,
    family: 'OEC',
    name: PACK_MOWAKABA_CABINET.name,
    audience: PACK_MOWAKABA_CABINET.audience,
    billing: 'ONE_OFF',
    monthly_ht_cents: null,
    annual_ht_cents: null,
    one_off_ht_cents: PACK_MOWAKABA_CABINET.one_off_ht_cents,
  });
  for (const contract of ENTERPRISE_CONTRACTS) {
    offers.push({
      code: contract.code,
      family: 'CORPORATE_SOUVERAIN',
      name: contract.name,
      audience: contract.audience,
      billing: 'ANNUAL',
      monthly_ht_cents: null,
      annual_ht_cents: contract.annual_ht_cents,
      one_off_ht_cents: null,
    });
  }
  return offers;
}

/** Les 4 familles de la grille, à plat, dans l'ordre d'affichage. */
export const PRICING_CATALOG_OFFERS: readonly CatalogOffer[] = buildCatalogOffers();

export function catalogOffersOfFamily(family: PricingFamilyId): readonly CatalogOffer[] {
  return PRICING_CATALOG_OFFERS.filter((o) => o.family === family);
}
