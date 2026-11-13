/**
 * Grille tarifaire publique (Doc_03 S02 et S06). Montants HT en centimes entiers (ADR-03).
 * Réutilisé par T-P2C-03 : ne contient aucune règle fiscale (pas de taux de TVA, donc pas de TTC).
 */
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
