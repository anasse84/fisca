import { assertSalesAllowed } from '../offline/offline-window.ts';
import type { OfflineWindowState } from '../offline/offline-window.ts';
import { issueSignedTicket } from '../ticketing/ticket-issuer.ts';
import type { IssuedTicket, TicketIssuerDeps } from '../ticketing/ticket-issuer.ts';
import { cartTotals } from './cart.ts';
import type { Cart } from './cart.ts';
import type { Settlement } from './settlement.ts';

export type CheckoutErrorCode = 'CART_EMPTY' | 'SETTLEMENT_NOT_READY' | 'SETTLEMENT_MISMATCH';

export class CheckoutError extends Error {
  readonly code: CheckoutErrorCode;
  constructor(code: CheckoutErrorCode, message: string) {
    super(message);
    this.name = 'CheckoutError';
    this.code = code;
  }
}

export interface CheckoutInput {
  readonly deps: TicketIssuerDeps;
  readonly window: OfflineWindowState;
  readonly sessionId: string;
  readonly cart: Cart;
  readonly settlement: Settlement;
}

export interface CheckoutResult {
  readonly ticket: IssuedTicket;
  readonly changeCents: number;
}

/** Garde des 72 h (règle pure), cohérence panier / règlement, puis émission du ticket signé. */
export async function checkoutCart(input: CheckoutInput): Promise<CheckoutResult> {
  assertSalesAllowed(input.window);
  if (input.cart.length === 0) throw new CheckoutError('CART_EMPTY', 'Panier vide : aucun ticket à émettre.');
  const totals = cartTotals(input.cart);
  const { settlement } = input;
  if (settlement.goodsTtcCents !== totals.totalTtcCents) {
    throw new CheckoutError('SETTLEMENT_MISMATCH', 'Le règlement ne correspond pas au total du panier.');
  }
  if (settlement.status !== 'READY') throw new CheckoutError('SETTLEMENT_NOT_READY', `Règlement non prêt (${settlement.status}).`);
  const ticket = await issueSignedTicket(input.deps, {
    sessionId: input.sessionId,
    ticketKind: 'SALE_B2C',
    lines: totals.lines,
    payments: { cashCents: settlement.cashShareCents, cardTpeCents: settlement.cardCents, deliveryAppCents: settlement.deliveryCents },
  });
  return { ticket, changeCents: settlement.changeCents };
}
