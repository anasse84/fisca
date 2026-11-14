import { divRoundHalfUpBigInt } from '@fisca/shared-types';

/**
 * Timbre sur règlement en espèces. Aucun taux n'est codé ici (ADR-04) : la règle datée est une DONNÉE fournie par un port
 * (alimenté par l'API / les règles AST synchronisées). Sans règle, l'émission d'un ticket est refusée.
 * Calcul en entiers : montant en centimes × taux en bps, divisé par l'échelle des bps (unité de mesure) via
 * `divRoundHalfUpBigInt` (ERRATA D-09).
 */

export interface CashStampRule {
  readonly ruleId: string;
  /** Taux en points de base, entier de 0 à 10 000. */
  readonly rateBps: number;
  /** Règle d'arrondi injectée ; seule `HALF_UP` (demi supérieur, D-09) est supportée. */
  readonly rounding: 'HALF_UP';
}

export interface CashStampRulePort {
  /** Règle de timbre en vigueur à l'instant donné, ou `null` si aucune règle datée n'est disponible. */
  getCashStampRule(atIso: string): Promise<CashStampRule | null>;
}

/** 10 000 bps = 100 % : unité de mesure, pas une règle fiscale. */
const BPS_SCALE = 10000n;

export async function resolveCashStampRule(port: CashStampRulePort, atIso: string): Promise<CashStampRule> {
  const rule = await port.getCashStampRule(atIso);
  if (rule === null) throw new Error(`Aucune règle de timbre espèces fournie pour ${atIso} : émission refusée (aucune constante implicite).`);
  return rule;
}

/** Timbre en centimes sur la part payée en espèces. */
export function computeCashStampCents(cashCents: bigint, rule: CashStampRule): bigint {
  if (cashCents < 0n) throw new RangeError('Timbre : montant espèces négatif.');
  if (!Number.isInteger(rule.rateBps) || rule.rateBps < 0 || rule.rateBps > 10000) {
    throw new RangeError(`Timbre : rateBps doit être un entier de 0 à 10 000 (reçu ${String(rule.rateBps)}).`);
  }
  if (rule.rounding !== 'HALF_UP') throw new RangeError(`Timbre : arrondi inconnu « ${String(rule.rounding)} ».`);
  return divRoundHalfUpBigInt(cashCents * BigInt(rule.rateBps), BPS_SCALE);
}
