/**
 * Pénalités de retard de paiement, loi 69-21 (VEC-CGI-02, ERRATA D-13 et E).
 *
 * - Échéance = date de livraison + délai légal (60, 120 ou 180 jours : paramètres datés).
 * - Mois entamés : mois CALENDAIRES comptés à partir de l'échéance ; tout mois commencé est dû (Doc_14 V.1).
 *   Convention retenue ici, signalée à l'utilisateur ; elle donne 2 mois entamés pour le vecteur d'or (1 mois + 15 jours).
 * - Taux = taux directeur BAM (paramètre daté saisi) + majoration par mois supplémentaire x (mois entamés - 1)
 *   (ERRATA E : « 2,75 % plus 0,85 % par mois supplémentaire » ; 275 + 85 = 360 bps pour 2 mois).
 * - Pénalité = TTC x taux, arrondie au dirham SUPÉRIEUR (Doc_18 S06), en entiers : `ceil(ttc x bps / 10 000 / 100)` x 100.
 */
import { addDays, addMonths, compareDates, diffDays, formatIsoDate, parseIsoDate } from './civil-date.ts';
import type { CivilDate } from './civil-date.ts';
import { ceilDivBigInt, isNonNegativeSafeInteger, proportionHalfUp } from './amounts.ts';

export interface Loi6921Params {
  /** Taux directeur BAM, en points de base : PARAMÈTRE DATÉ (saisi ou lu d'une donnée de contenu datée). */
  readonly directorRateBps: number;
  /** Majoration par mois supplémentaire entamé, en points de base (donnée datée). */
  readonly monthlyIncrementBps: number;
}

export interface Loi6921Input {
  readonly amountTtcCents: number;
  readonly deliveryDate: string;
  readonly legalDelayDays: number;
  /** Date de paiement effectif, ou date d'arrêté du calcul si la facture est encore impayée. */
  readonly paymentDate: string;
}

export type Loi6921Error = 'AMOUNT' | 'DELIVERY_DATE' | 'PAYMENT_DATE' | 'DELAY' | 'RATE';

export interface Loi6921Result {
  readonly dueDate: string;
  readonly delayDays: number;
  readonly startedMonths: number;
  readonly rateBps: number;
  /** Pénalité avant arrondi, au centime (demi supérieur) : information, jamais la base du résultat. */
  readonly rawPenaltyCents: number;
  /** Pénalité retenue, arrondie au dirham supérieur (multiple de 100 centimes). */
  readonly penaltyCents: number;
}

export type Loi6921Outcome = { readonly ok: true; readonly result: Loi6921Result } | { readonly ok: false; readonly error: Loi6921Error };

const MAX_MONTHS = 1200;

/** Mois calendaires entamés entre l'échéance (exclue) et la date de calcul ; 0 si aucun retard. */
export function startedMonthsBetween(due: CivilDate, paid: CivilDate): number {
  if (compareDates(paid, due) <= 0) return 0;
  let whole = 0;
  while (whole < MAX_MONTHS && compareDates(addMonths(due, whole + 1), paid) <= 0) whole += 1;
  return compareDates(paid, addMonths(due, whole)) > 0 ? whole + 1 : whole;
}

export function rateForStartedMonths(startedMonths: number, params: Loi6921Params): number {
  return startedMonths <= 0 ? 0 : params.directorRateBps + params.monthlyIncrementBps * (startedMonths - 1);
}

export function computeLoi6921(input: Loi6921Input, params: Loi6921Params): Loi6921Outcome {
  if (!isNonNegativeSafeInteger(input.amountTtcCents) || input.amountTtcCents === 0) return { ok: false, error: 'AMOUNT' };
  if (!isNonNegativeSafeInteger(params.directorRateBps) || !isNonNegativeSafeInteger(params.monthlyIncrementBps)) return { ok: false, error: 'RATE' };
  if (!isNonNegativeSafeInteger(input.legalDelayDays)) return { ok: false, error: 'DELAY' };
  const delivery = parseIsoDate(input.deliveryDate);
  if (delivery === null) return { ok: false, error: 'DELIVERY_DATE' };
  const paid = parseIsoDate(input.paymentDate);
  if (paid === null) return { ok: false, error: 'PAYMENT_DATE' };
  const due = addDays(delivery, input.legalDelayDays);
  const delayDays = Math.max(0, diffDays(due, paid));
  const startedMonths = startedMonthsBetween(due, paid);
  const rateBps = rateForStartedMonths(startedMonths, params);
  const numerator = BigInt(input.amountTtcCents) * BigInt(rateBps);
  const dirhams = ceilDivBigInt(numerator, 10000n * 100n);
  return {
    ok: true,
    result: {
      dueDate: formatIsoDate(due),
      delayDays,
      startedMonths,
      rateBps,
      rawPenaltyCents: proportionHalfUp(input.amountTtcCents, rateBps),
      penaltyCents: Number(dirhams * 100n),
    },
  };
}
