import type { ReactElement } from 'react';
import { FiscalAmount } from '@fisca/ui-mercury';
import { lineTotalTtcCents } from '../sale/cart.ts';
import type { Cart, CartTotals } from '../sale/cart.ts';
import { formatBps, formatMilli } from '../sale/format.ts';

export interface CartPanelLabels {
  readonly cart: string;
  readonly cartEmpty: string;
  readonly itemCount: (count: number) => string;
  readonly increase: (name: string) => string;
  readonly decrease: (name: string) => string;
  readonly remove: (name: string) => string;
  readonly clear: string;
  readonly totalHt: string;
  readonly vatRate: (rate: string) => string;
  readonly totalTtc: string;
  readonly pay: string;
  readonly quantity: string;
  readonly blocked: string;
}

export interface CartPanelProps {
  readonly labels: CartPanelLabels;
  readonly cart: Cart;
  readonly totals: CartTotals;
  readonly salesBlocked: boolean;
  readonly onChangeQuantity: (itemId: string, deltaMilli: number) => void;
  readonly onRemove: (itemId: string) => void;
  readonly onClear: () => void;
  readonly onPay: () => void;
}

export function CartPanel({ labels, cart, totals, salesBlocked, onChangeQuantity, onRemove, onClear, onPay }: CartPanelProps): ReactElement {
  const totalHt = totals.byRate.reduce((sum, bucket) => sum + bucket.htCents, 0);
  return (
    <section className="pos-panel" aria-labelledby="pos-cart-title">
      <h2 className="pos-panel__title" id="pos-cart-title">
        {labels.cart} <span data-testid="item-count">{labels.itemCount(cart.length)}</span>
      </h2>
      {cart.length === 0 ? (
        <p className="pos-empty">{labels.cartEmpty}</p>
      ) : (
        <ul className="pos-cart">
          {cart.map((line) => (
            <li key={line.item.id} className="pos-line" data-testid={`cart-line-${line.item.id}`}>
              <span className="pos-line__name">{line.item.name}</span>
              <span className="pos-line__total">
                <FiscalAmount amountCents={lineTotalTtcCents(line)} />
              </span>
              <div className="pos-line__controls">
                <button type="button" className="pos-icon-btn" aria-label={labels.decrease(line.item.name)} onClick={() => onChangeQuantity(line.item.id, -line.item.quantityStepMilli)}>
                  <span aria-hidden="true">−</span>
                </button>
                <span className="pos-qty" dir="ltr" aria-label={labels.quantity}>
                  {formatMilli(line.quantityMilli)}
                </span>
                <button type="button" className="pos-icon-btn" aria-label={labels.increase(line.item.name)} onClick={() => onChangeQuantity(line.item.id, line.item.quantityStepMilli)}>
                  <span aria-hidden="true">+</span>
                </button>
                <button type="button" className="pos-icon-btn" aria-label={labels.remove(line.item.name)} onClick={() => onRemove(line.item.id)}>
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="pos-totals">
        <div className="pos-totals__row">
          <span>{labels.totalHt}</span>
          <span data-testid="total-ht">
            <FiscalAmount amountCents={totalHt} />
          </span>
        </div>
        {totals.byRate
          .filter((bucket) => bucket.vatCents > 0)
          .map((bucket) => (
            <div key={bucket.vatRateBps} className="pos-totals__row">
              <span>{labels.vatRate(formatBps(bucket.vatRateBps))}</span>
              <FiscalAmount amountCents={bucket.vatCents} />
            </div>
          ))}
        <div className="pos-totals__row pos-totals__row--grand">
          <span>{labels.totalTtc}</span>
          <span data-testid="total-ttc">
            <FiscalAmount amountCents={totals.totalTtcCents} />
          </span>
        </div>
      </div>
      {salesBlocked ? (
        <p className="pos-alert" role="alert">
          {labels.blocked}
        </p>
      ) : null}
      <div className="pos-actions">
        <button type="button" className="pos-action pos-action--primary" data-testid="pay-button" disabled={salesBlocked || cart.length === 0} onClick={onPay}>
          {labels.pay}
        </button>
        <button type="button" className="pos-action" disabled={cart.length === 0} onClick={onClear}>
          {labels.clear}
        </button>
      </div>
    </section>
  );
}
