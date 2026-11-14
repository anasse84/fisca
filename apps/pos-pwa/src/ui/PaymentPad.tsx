import type { ReactElement } from 'react';
import { FiscalAmount } from '@fisca/ui-mercury';
import type { Settlement } from '../sale/settlement.ts';

export type PaymentMethod = 'cash' | 'card' | 'delivery';
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'card', 'delivery'];
const DIGITS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export interface PaymentPadLabels {
  readonly title: string;
  readonly methods: string;
  readonly method: Readonly<Record<PaymentMethod, string>>;
  readonly totalDue: string;
  readonly cashShare: string;
  readonly stamp: string;
  readonly cashDue: string;
  readonly tendered: string;
  readonly change: string;
  readonly remaining: string;
  readonly short: string;
  readonly amountFor: (method: string) => string;
  readonly fillRemaining: string;
  readonly keypad: string;
  readonly key: (digit: string) => string;
  readonly backspace: string;
  readonly clear: string;
  readonly validate: string;
  readonly backToCart: string;
  readonly issuing: string;
  readonly stampRuleMissing: string;
}

export interface PaymentPadProps {
  readonly labels: PaymentPadLabels;
  readonly settlement: Settlement;
  readonly method: PaymentMethod;
  readonly submitting: boolean;
  readonly errorText: string | null;
  readonly onMethod: (method: PaymentMethod) => void;
  readonly onDigit: (digit: number) => void;
  readonly onBackspace: () => void;
  readonly onClear: () => void;
  readonly onFillRemaining: () => void;
  readonly onValidate: () => void;
  readonly onBack: () => void;
}

function Row({ label, testId, cents, className }: { readonly label: string; readonly testId: string; readonly cents: number; readonly className?: string }): ReactElement {
  return (
    <div className={`pos-pay__row${className === undefined ? '' : ` ${className}`}`}>
      <dt>{label}</dt>
      <dd data-testid={testId}>
        <FiscalAmount amountCents={cents} />
      </dd>
    </div>
  );
}

export function PaymentPad(props: PaymentPadProps): ReactElement {
  const { labels, settlement, method } = props;
  const canValidate = settlement.status === 'READY' && !props.submitting;
  return (
    <section className="pos-panel pos-pay pos-main__full" aria-labelledby="pos-pay-title">
      <div>
        <h2 className="pos-panel__title" id="pos-pay-title">
          {labels.title}
        </h2>
        <div className="pos-methods" role="radiogroup" aria-label={labels.methods}>
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              className="pos-method"
              data-testid={`method-${m}`}
              onClick={() => props.onMethod(m)}
            >
              {labels.method[m]}
            </button>
          ))}
        </div>
        <dl className="pos-pay__summary" aria-live="polite">
          <Row label={labels.totalDue} testId="due-amount" cents={settlement.goodsTtcCents} />
          {settlement.cardCents > 0 ? <Row label={labels.amountFor(labels.method.card)} testId="card-amount" cents={settlement.cardCents} /> : null}
          {settlement.deliveryCents > 0 ? <Row label={labels.amountFor(labels.method.delivery)} testId="delivery-amount" cents={settlement.deliveryCents} /> : null}
          <Row label={labels.cashShare} testId="cash-share" cents={settlement.cashShareCents} />
          <Row label={labels.stamp} testId="stamp-amount" cents={settlement.stampCents} />
          <Row label={labels.cashDue} testId="cash-due" cents={settlement.cashDueCents} />
          <Row label={labels.tendered} testId="tendered-amount" cents={settlement.cashTenderedCents} />
          <Row label={labels.change} testId="change-amount" cents={settlement.changeCents} className="pos-pay__row--change" />
          {settlement.remainingCents > 0 ? <Row label={labels.remaining} testId="remaining-amount" cents={settlement.remainingCents} /> : null}
        </dl>
        {settlement.status === 'SHORT' ? <p className="pos-status">{labels.short}</p> : null}
        {settlement.status === 'STAMP_RULE_MISSING' ? (
          <p className="pos-alert" role="alert">
            {labels.stampRuleMissing}
          </p>
        ) : null}
        {props.errorText === null ? null : (
          <p className="pos-alert" role="alert" data-testid="checkout-error">
            {props.errorText}
          </p>
        )}
        {props.submitting ? <p className="pos-status">{labels.issuing}</p> : null}
      </div>
      <div>
        <div className="pos-keypad" dir="ltr" role="group" aria-label={labels.keypad}>
          {DIGITS.map((d) => (
            <button key={d} type="button" className="pos-key" data-testid={`key-${String(d)}`} aria-label={labels.key(String(d))} onClick={() => props.onDigit(d)}>
              {d}
            </button>
          ))}
          <button type="button" className="pos-key" data-testid="key-clear" aria-label={labels.clear} onClick={props.onClear}>
            <span aria-hidden="true">C</span>
          </button>
          <button type="button" className="pos-key" data-testid="key-0" aria-label={labels.key('0')} onClick={() => props.onDigit(0)}>
            0
          </button>
          <button type="button" className="pos-key" data-testid="key-backspace" aria-label={labels.backspace} onClick={props.onBackspace}>
            <span aria-hidden="true">⌫</span>
          </button>
        </div>
        <div className="pos-actions pos-actions--spaced">
          <button type="button" className="pos-action" data-testid="fill-remaining" onClick={props.onFillRemaining}>
            {labels.fillRemaining}
          </button>
          <button type="button" className="pos-action pos-action--primary" data-testid="validate-payment" disabled={!canValidate} onClick={props.onValidate}>
            {labels.validate}
          </button>
          <button type="button" className="pos-action" onClick={props.onBack}>
            {labels.backToCart}
          </button>
        </div>
      </div>
    </section>
  );
}
