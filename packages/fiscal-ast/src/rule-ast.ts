import { z } from 'zod';

/**
 * Types d'AST des règles fiscales (ADR-04, Doc_02 § 10 : « validé par DynamicFiscalRuleSchema »).
 * Le JSON vit dans dynamic_fiscal_rules.rule_ast_json ; chaque nœud porte un champ `node`, chaque règle un `kind`.
 * Schémas stricts : toute clé inconnue, tout flottant et tout champ absent sont refusés (échec fermé).
 * Aucune valeur de taux, plafond ou seuil n'apparaît ici : ce sont les lignes de règle qui les portent.
 */

const money = z.int().nonnegative();
/** Taux en points de base, de 0 à 10 000 (100 %). */
const rateBps = z.int().min(0).max(10000);

export const COMPARATORS = ['LT', 'LTE', 'GT', 'GTE'] as const;
export const COMPARATOR_SCHEMA = z.enum(COMPARATORS);
export type Comparator = z.infer<typeof COMPARATOR_SCHEMA>;

/** Base de calcul d'un plafond : paramètre daté de la règle (ERRATA section E, `cap_basis`, TTC par défaut). */
export const CAP_BASIS_SCHEMA = z.enum(['TTC', 'HT']);
export type CapBasis = z.infer<typeof CAP_BASIS_SCHEMA>;

/** Nœud plafond : montant maximal par période civile. */
export const CAP_NODE_SCHEMA = z.strictObject({
  node: z.literal('CAP'),
  period: z.enum(['DAY', 'MONTH']),
  amount_cents: money,
});
export type CapNode = z.infer<typeof CAP_NODE_SCHEMA>;

/** Nœud taux en points de base. */
export const BPS_RATE_NODE_SCHEMA = z.strictObject({
  node: z.literal('BPS_RATE'),
  rate_bps: rateBps,
});
export type BpsRateNode = z.infer<typeof BPS_RATE_NODE_SCHEMA>;

/** Nœud comparaison : la condition « base <comparateur> borne » est vraie ou fausse. */
export const COMPARISON_NODE_SCHEMA = z.strictObject({
  node: z.literal('COMPARISON'),
  comparator: COMPARATOR_SCHEMA,
  bound_cents: money,
});
export type ComparisonNode = z.infer<typeof COMPARISON_NODE_SCHEMA>;

/** Nœud durée (délai) : un nombre de mois ou de jours. */
export const DURATION_NODE_SCHEMA = z.strictObject({
  node: z.literal('DURATION'),
  unit: z.enum(['MONTHS', 'DAYS']),
  count: z.int().nonnegative(),
});
export type DurationNode = z.infer<typeof DURATION_NODE_SCHEMA>;

/** Nœud tranches : intervalles contigus [from, up_to[ de cumul, chacun avec son taux ; la dernière tranche est ouverte. */
export const BRACKETS_NODE_SCHEMA = z
  .strictObject({
    node: z.literal('BRACKETS'),
    brackets: z
      .array(
        z.strictObject({
          from_cents: money,
          up_to_cents: money.nullable(),
          rate_bps: rateBps,
        }),
      )
      .min(2),
  })
  .superRefine((value, ctx) => {
    const list = value.brackets;
    list.forEach((bracket, index) => {
      const previous = list[index - 1];
      const isLast = index === list.length - 1;
      if (index === 0 && bracket.from_cents !== 0) {
        ctx.addIssue({ code: 'custom', message: 'la première tranche doit commencer à 0', input: value });
      }
      if (previous !== undefined && previous.up_to_cents !== bracket.from_cents) {
        ctx.addIssue({ code: 'custom', message: `tranche ${index} non contiguë à la précédente`, input: value });
      }
      if (isLast && bracket.up_to_cents !== null) {
        ctx.addIssue({ code: 'custom', message: 'la dernière tranche doit être ouverte (up_to_cents nul)', input: value });
      }
      if (!isLast && (bracket.up_to_cents === null || bracket.up_to_cents <= bracket.from_cents)) {
        ctx.addIssue({ code: 'custom', message: `tranche ${index} : borne haute absente ou non croissante`, input: value });
      }
    });
    const first = list[0];
    if (first !== undefined && first.rate_bps !== 0) {
      ctx.addIssue({ code: 'custom', message: 'la première tranche est la franchise : son taux doit être 0', input: value });
    }
  });
export type BracketsNode = z.infer<typeof BRACKETS_NODE_SCHEMA>;

/** Nœud barème de pénalité : majoration par période entamée supplémentaire au-delà de la première (taux de base = nœud base_rate), arrondi. */
export const PENALTY_SCALE_NODE_SCHEMA = z.strictObject({
  node: z.literal('PENALTY_SCALE'),
  additional_period_increment_bps: rateBps,
  rounding: z.enum(['CEIL_DIRHAM', 'HALF_UP_CENT']),
});
export type PenaltyScaleNode = z.infer<typeof PENALTY_SCALE_NODE_SCHEMA>;

/** Nœud liste de taux admis (TVA). */
export const RATE_SET_NODE_SCHEMA = z.strictObject({
  node: z.literal('RATE_SET'),
  allowed_rates_bps: z.array(rateBps).min(1),
});
export type RateSetNode = z.infer<typeof RATE_SET_NODE_SCHEMA>;

const ruleEnvelope = {
  ast_version: z.literal(1),
  rule_code: z.string().regex(/^[A-Z0-9_]{3,64}$/),
};

export const VAT_RATE_SET_RULE_SCHEMA = z.strictObject({
  ...ruleEnvelope,
  kind: z.literal('VAT_RATE_SET'),
  rates: RATE_SET_NODE_SCHEMA,
});

export const CASH_CEILING_RULE_SCHEMA = z.strictObject({
  ...ruleEnvelope,
  kind: z.literal('CASH_CEILING'),
  /** Absent : TTC (ERRATA section E). Seul défaut admis du moteur, imposé par l'ERRATA. */
  cap_basis: CAP_BASIS_SCHEMA.default('TTC'),
  daily_cap: CAP_NODE_SCHEMA.refine((node) => node.period === 'DAY', { message: 'daily_cap doit avoir la période DAY' }),
  monthly_cap: CAP_NODE_SCHEMA.refine((node) => node.period === 'MONTH', { message: 'monthly_cap doit avoir la période MONTH' }),
});

export const RAS_TVA_RULE_SCHEMA = z.strictObject({
  ...ruleEnvelope,
  kind: z.literal('RAS_TVA'),
  /** La retenue s'applique quand « TTC <comparateur> borne » est vraie. */
  applies_when_ttc: COMPARISON_NODE_SCHEMA,
  attestation_validity: DURATION_NODE_SCHEMA.refine((node) => node.unit === 'MONTHS', {
    message: 'la validité de l\'attestation s\'exprime en mois',
  }),
  reduced_rate: BPS_RATE_NODE_SCHEMA,
  full_rate: BPS_RATE_NODE_SCHEMA,
});

export const AUTO_ENTREPRENEUR_RULE_SCHEMA = z.strictObject({
  ...ruleEnvelope,
  kind: z.literal('AUTO_ENTREPRENEUR_THRESHOLD'),
  client_brackets: BRACKETS_NODE_SCHEMA,
});

export const PAYMENT_DELAY_RULE_SCHEMA = z.strictObject({
  ...ruleEnvelope,
  kind: z.literal('PAYMENT_DELAY_PENALTY'),
  /** Taux directeur de Bank Al-Maghrib en vigueur : donnée datée de la ligne (ERRATA E). */
  base_rate: BPS_RATE_NODE_SCHEMA,
  penalty_scale: PENALTY_SCALE_NODE_SCHEMA,
  legal_terms: z.strictObject({
    standard: DURATION_NODE_SCHEMA.refine((node) => node.unit === 'DAYS', { message: 'délai en jours' }),
    contract: DURATION_NODE_SCHEMA.refine((node) => node.unit === 'DAYS', { message: 'délai en jours' }),
    decree: DURATION_NODE_SCHEMA.refine((node) => node.unit === 'DAYS', { message: 'délai en jours' }),
  }),
});

export const BTP_SETTLEMENT_RULE_SCHEMA = z.strictObject({
  ...ruleEnvelope,
  kind: z.literal('BTP_SETTLEMENT'),
  /** Retenue de garantie sur le HT des travaux (hors débours). */
  retention_rate: BPS_RATE_NODE_SCHEMA,
});

export const DYNAMIC_FISCAL_RULE_SCHEMA = z.discriminatedUnion('kind', [
  VAT_RATE_SET_RULE_SCHEMA,
  CASH_CEILING_RULE_SCHEMA,
  RAS_TVA_RULE_SCHEMA,
  AUTO_ENTREPRENEUR_RULE_SCHEMA,
  PAYMENT_DELAY_RULE_SCHEMA,
  BTP_SETTLEMENT_RULE_SCHEMA,
]);

export type DynamicFiscalRuleAst = z.infer<typeof DYNAMIC_FISCAL_RULE_SCHEMA>;
export type RuleKind = DynamicFiscalRuleAst['kind'];
export type RuleAstOfKind<K extends RuleKind> = Extract<DynamicFiscalRuleAst, { readonly kind: K }>;

/** Évalue un nœud comparaison sur des entiers (BigInt). */
export function evaluateComparison(node: ComparisonNode, base: bigint): boolean {
  const bound = BigInt(node.bound_cents);
  switch (node.comparator) {
    case 'LT':
      return base < bound;
    case 'LTE':
      return base <= bound;
    case 'GT':
      return base > bound;
    case 'GTE':
      return base >= bound;
  }
}
