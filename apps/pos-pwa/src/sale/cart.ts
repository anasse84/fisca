import { divRoundHalfUpBigInt } from '@fisca/shared-types';
import type { TicketLinesInput } from '../ticketing/ticket-issuer.ts';

/**
 * Panier du comptoir. Quantités en milli-unités, prix TTC en centimes, taux de TVA en bps : tout vient du port de catalogue.
 * Aucun prix, aucun taux ni aucune règle fiscale n'est codé ici. Les colonnes du ticket local (`pos_tickets`) sont structurelles
 * (20 %, 10 %, 0 %, ERRATA D-04) : un taux hors de ces colonnes est refusé, il ne peut pas être enregistré.
 */

export interface CatalogItem {
  readonly id: string;
  /** Désignation : donnée du catalogue, jamais un libellé d'interface. */
  readonly name: string;
  readonly unitPriceTtcCents: number;
  readonly vatRateBps: number;
  /** Pas de quantité (1 000 = une unité, 250 = un quart d'unité). */
  readonly quantityStepMilli: number;
}

export interface CatalogPort {
  listItems(): Promise<readonly CatalogItem[]>;
}

export interface CartLine {
  readonly item: CatalogItem;
  readonly quantityMilli: number;
}

export type Cart = readonly CartLine[];

export type CartErrorCode = 'AMOUNT_INVALID' | 'QUANTITY_INVALID' | 'VAT_RATE_UNSUPPORTED' | 'UNKNOWN_ITEM';

export class CartError extends Error {
  readonly code: CartErrorCode;
  constructor(code: CartErrorCode, message: string) {
    super(message);
    this.name = 'CartError';
    this.code = code;
  }
}

/** Colonnes de taux du ticket local, de la plus haute à la plus basse : structure du schéma, pas une règle. */
export const TICKET_VAT_COLUMNS_BPS: readonly number[] = [2000, 1000, 0];

const BPS_SCALE = 10000n;
const MILLI_SCALE = 1000n;

function assertItem(item: CatalogItem): void {
  if (!Number.isSafeInteger(item.unitPriceTtcCents) || item.unitPriceTtcCents < 0) {
    throw new CartError('AMOUNT_INVALID', `Prix de « ${item.id} » : entier de centimes positif ou nul exigé.`);
  }
  if (!Number.isInteger(item.vatRateBps) || item.vatRateBps < 0 || item.vatRateBps > 10000) {
    throw new CartError('AMOUNT_INVALID', `Taux de « ${item.id} » : entier de bps de 0 à 10 000 exigé.`);
  }
  if (!Number.isSafeInteger(item.quantityStepMilli) || item.quantityStepMilli <= 0) {
    throw new CartError('QUANTITY_INVALID', `Pas de quantité de « ${item.id} » : entier de milli-unités positif exigé.`);
  }
}

function assertQuantity(quantityMilli: number): void {
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0) throw new CartError('QUANTITY_INVALID', 'Quantité : entier de milli-unités strictement positif exigé.');
}

export function addItem(cart: Cart, item: CatalogItem, quantityMilli: number = item.quantityStepMilli): Cart {
  assertItem(item);
  assertQuantity(quantityMilli);
  const index = cart.findIndex((line) => line.item.id === item.id);
  if (index < 0) return [...cart, { item, quantityMilli }];
  return cart.map((line, i) => (i === index ? { item: line.item, quantityMilli: line.quantityMilli + quantityMilli } : line));
}

export function setQuantity(cart: Cart, itemId: string, quantityMilli: number): Cart {
  if (!cart.some((line) => line.item.id === itemId)) throw new CartError('UNKNOWN_ITEM', `Article « ${itemId} » absent du panier.`);
  if (quantityMilli <= 0) return removeItem(cart, itemId);
  assertQuantity(quantityMilli);
  return cart.map((line) => (line.item.id === itemId ? { item: line.item, quantityMilli } : line));
}

export function changeQuantity(cart: Cart, itemId: string, deltaMilli: number): Cart {
  const line = cart.find((l) => l.item.id === itemId);
  if (line === undefined) throw new CartError('UNKNOWN_ITEM', `Article « ${itemId} » absent du panier.`);
  return setQuantity(cart, itemId, line.quantityMilli + deltaMilli);
}

export function removeItem(cart: Cart, itemId: string): Cart {
  return cart.filter((line) => line.item.id !== itemId);
}

/** Prix × quantité, arrondi demi supérieur (D-09) : centimes entiers. */
export function lineTotalTtcCents(line: CartLine): number {
  const exact = BigInt(line.item.unitPriceTtcCents) * BigInt(line.quantityMilli);
  return Number(divRoundHalfUpBigInt(exact, MILLI_SCALE));
}

export interface VatBucket {
  readonly vatRateBps: number;
  readonly ttcCents: number;
  readonly htCents: number;
  readonly vatCents: number;
}

export interface CartTotals {
  readonly totalTtcCents: number;
  readonly byRate: readonly VatBucket[];
  readonly lines: TicketLinesInput;
}

/** HT = TTC × 10 000 / (10 000 + bps), TVA = TTC − HT : la somme HT + TVA égale le TTC au centime. */
export function cartTotals(cart: Cart): CartTotals {
  const ttcByRate = new Map<number, bigint>();
  for (const line of cart) {
    if (!TICKET_VAT_COLUMNS_BPS.includes(line.item.vatRateBps)) {
      throw new CartError('VAT_RATE_UNSUPPORTED', `Taux ${String(line.item.vatRateBps)} bps hors des colonnes du ticket local.`);
    }
    assertItem(line.item);
    ttcByRate.set(line.item.vatRateBps, (ttcByRate.get(line.item.vatRateBps) ?? 0n) + BigInt(lineTotalTtcCents(line)));
  }
  const buckets: VatBucket[] = [];
  let total = 0n;
  for (const rate of TICKET_VAT_COLUMNS_BPS) {
    const ttc = ttcByRate.get(rate);
    if (ttc === undefined) continue;
    const ht = divRoundHalfUpBigInt(ttc * BPS_SCALE, BPS_SCALE + BigInt(rate));
    buckets.push({ vatRateBps: rate, ttcCents: Number(ttc), htCents: Number(ht), vatCents: Number(ttc - ht) });
    total += ttc;
  }
  const at = (rate: number): VatBucket | undefined => buckets.find((b) => b.vatRateBps === rate);
  return {
    totalTtcCents: Number(total),
    byRate: buckets,
    lines: {
      ht20Cents: at(2000)?.htCents ?? 0,
      vat20Cents: at(2000)?.vatCents ?? 0,
      ht10Cents: at(1000)?.htCents ?? 0,
      vat10Cents: at(1000)?.vatCents ?? 0,
      ht0Cents: at(0)?.htCents ?? 0,
    },
  };
}
