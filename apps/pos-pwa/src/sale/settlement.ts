import { computeCashStampCents, resolveCashStampRule } from '../ticketing/cash-stamp.ts';
import type { CashStampRulePort } from '../ticketing/cash-stamp.ts';

/**
 * Règlement : espèces, carte TPE, appli livraison. Tout en centimes entiers. Le timbre se calcule sur la seule part espèces,
 * avec la règle datée du port (jamais en dur) ; il s'ajoute au TTC et se règle en espèces (comme `issueSignedTicket`).
 */

export interface SettlementInput {
  readonly goodsTtcCents: number;
  readonly cardCents: number;
  readonly deliveryCents: number;
  readonly cashTenderedCents: number;
}

export type SettlementStatus = 'EMPTY' | 'READY' | 'SHORT' | 'EXCESS_NON_CASH' | 'STAMP_RULE_MISSING';

export interface Settlement {
  readonly status: SettlementStatus;
  readonly goodsTtcCents: number;
  readonly cardCents: number;
  readonly deliveryCents: number;
  readonly cashShareCents: number;
  readonly stampCents: number;
  readonly cashDueCents: number;
  readonly cashTenderedCents: number;
  readonly changeCents: number;
  readonly shortfallCents: number;
  /** Reste à encaisser sur la part espèces : espèces dues moins montant remis (0 si suffisant). */
  readonly remainingCents: number;
}

function assertCents(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Règlement : « ${name} » doit être un entier de centimes positif ou nul.`);
}

export async function computeSettlement(input: SettlementInput, stampRules: CashStampRulePort, atIso: string): Promise<Settlement> {
  for (const [name, value] of Object.entries(input)) assertCents(name, value);
  const base = { goodsTtcCents: input.goodsTtcCents, cardCents: input.cardCents, deliveryCents: input.deliveryCents, cashTenderedCents: input.cashTenderedCents };
  const empty = { cashShareCents: 0, stampCents: 0, cashDueCents: 0, changeCents: 0, shortfallCents: 0, remainingCents: 0 };
  if (input.goodsTtcCents === 0) return { ...base, ...empty, status: 'EMPTY' };

  const nonCash = BigInt(input.cardCents) + BigInt(input.deliveryCents);
  const goods = BigInt(input.goodsTtcCents);
  if (nonCash > goods) return { ...base, ...empty, status: 'EXCESS_NON_CASH' };
  const cashShare = goods - nonCash;

  let stamp: bigint;
  try {
    stamp = computeCashStampCents(cashShare, await resolveCashStampRule(stampRules, atIso));
  } catch {
    return { ...base, ...empty, cashShareCents: Number(cashShare), status: 'STAMP_RULE_MISSING' };
  }
  const cashDue = cashShare + stamp;
  const tendered = BigInt(input.cashTenderedCents);
  const common = { ...base, cashShareCents: Number(cashShare), stampCents: Number(stamp), cashDueCents: Number(cashDue) };
  if (cashDue === 0n) return { ...common, status: 'READY', changeCents: 0, shortfallCents: 0, remainingCents: 0 };
  if (tendered < cashDue) {
    const gap = Number(cashDue - tendered);
    return { ...common, status: 'SHORT', changeCents: 0, shortfallCents: gap, remainingCents: gap };
  }
  return { ...common, status: 'READY', changeCents: Number(tendered - cashDue), shortfallCents: 0, remainingCents: 0 };
}

const KEYPAD_MAX_DIGITS = 10;

/** Pavé numérique : chaque chiffre décale la saisie d'un rang (1, 2, 5, 0 → 1 250 centimes). */
export function appendDigit(valueCents: number, digit: number): number {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) throw new RangeError('Pavé numérique : chiffre de 0 à 9 exigé.');
  const next = `${valueCents === 0 ? '' : String(valueCents)}${String(digit)}`;
  return Number(next.length > KEYPAD_MAX_DIGITS ? next.slice(0, KEYPAD_MAX_DIGITS) : next);
}

export function deleteLastDigit(valueCents: number): number {
  const digits = String(valueCents);
  return digits.length <= 1 ? 0 : Number(digits.slice(0, -1));
}
