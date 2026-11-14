/** Îlot interactif du simulateur loi 69-21. */
import { formatBpsPercent, formatCentsMad } from '../../lib/money.ts';
import { parseMadToCents, parsePercentToBps } from '../amounts.ts';
import type { LoiUiCopy } from '../copy/loi.ts';
import { computeLoi6921 } from '../loi-69-21.ts';
import type { RulesPayload } from './dom.ts';
import { clear, el, mustQuery, num, readJsonAttr, renderRules, resultRow, setError } from './dom.ts';

export function mountLoiTool(root: HTMLElement): void {
  const copy = readJsonAttr<LoiUiCopy>(root, 'data-copy');
  const rules = readJsonAttr<RulesPayload>(root, 'data-rules');
  const form = mustQuery<HTMLFormElement>(root, 'form');
  const amount = mustQuery<HTMLInputElement>(root, '[name="amount"]');
  const delivery = mustQuery<HTMLInputElement>(root, '[name="delivery"]');
  const delay = mustQuery<HTMLSelectElement>(root, '[name="delay"]');
  const payment = mustQuery<HTMLInputElement>(root, '[name="payment"]');
  const director = mustQuery<HTMLInputElement>(root, '[name="director"]');
  const increment = mustQuery<HTMLInputElement>(root, '[name="increment"]');
  const errorBox = mustQuery<HTMLElement>(root, '[data-role="error"]');
  const results = mustQuery<HTMLElement>(root, '[data-role="results"]');
  const list = mustQuery<HTMLElement>(root, '[data-role="list"]');
  const rulesBox = mustQuery<HTMLElement>(root, '[data-role="rules"]');

  function fail(message: string, field: HTMLElement): void {
    setError(errorBox, message);
    for (const f of [amount, delivery, delay, payment, director, increment]) f.removeAttribute('aria-invalid');
    field.setAttribute('aria-invalid', 'true');
    field.focus();
    results.hidden = true;
  }

  function datedBps(key: string): number {
    const item = rules.items.find((i) => i.key === key);
    return item === undefined ? -1 : item.value;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setError(errorBox, null);
    const cents = parseMadToCents(amount.value);
    if (cents === null || cents === 0) return fail(copy.errAmount, amount);
    if (delivery.value === '') return fail(copy.errDelivery, delivery);
    const selected = delay.selectedOptions[0];
    const days = Number(delay.value);
    if (selected === undefined || !Number.isInteger(days)) return fail(copy.errDelay, delay);
    if (payment.value === '') return fail(copy.errPayment, payment);
    const directorBps = parsePercentToBps(director.value);
    if (directorBps === null) return fail(copy.errRate, director);
    const incrementBps = parsePercentToBps(increment.value);
    if (incrementBps === null) return fail(copy.errRate, increment);
    const outcome = computeLoi6921(
      { amountTtcCents: cents, deliveryDate: delivery.value, legalDelayDays: days, paymentDate: payment.value },
      { directorRateBps: directorBps, monthlyIncrementBps: incrementBps },
    );
    if (!outcome.ok) {
      const map = { AMOUNT: amount, DELIVERY_DATE: delivery, PAYMENT_DATE: payment, DELAY: delay, RATE: director } as const;
      const messages = { AMOUNT: copy.errAmount, DELIVERY_DATE: copy.errDelivery, PAYMENT_DATE: copy.errPayment, DELAY: copy.errDelay, RATE: copy.errRate } as const;
      return fail(messages[outcome.error], map[outcome.error]);
    }
    for (const f of [amount, delivery, delay, payment, director, increment]) f.removeAttribute('aria-invalid');
    const r = outcome.result;
    clear(list);
    list.append(resultRow(copy.dueDate, num(r.dueDate)));
    list.append(resultRow(copy.delayDays, num(`${String(r.delayDays)} ${copy.unitDays}`)));
    list.append(resultRow(copy.startedMonths, num(`${String(r.startedMonths)} ${copy.unitMonths}`)));
    list.append(resultRow(copy.rate, num(`${formatBpsPercent(r.rateBps)} (${String(r.rateBps)} bps)`)));
    list.append(resultRow(copy.rawPenalty, num(formatCentsMad(r.rawPenaltyCents))));
    list.append(resultRow(copy.penalty, num(formatCentsMad(r.penaltyCents)), true));
    if (r.delayDays === 0) list.append(el('p', { class: 'note' }, copy.noDelay));
    const datedDirector = datedBps('late_base_bps');
    const datedIncrement = datedBps('late_increment_bps');
    const delayKey = selected.getAttribute('data-key') ?? 'late_legal_days';
    renderRules(rulesBox, copy.rulesUsed, rules, [
      { key: delayKey },
      ...(directorBps === datedDirector ? [{ key: 'late_base_bps' }] : [{ key: 'late_base_bps', overriddenDisplay: formatBpsPercent(directorBps) }]),
      ...(incrementBps === datedIncrement ? [{ key: 'late_increment_bps' }] : [{ key: 'late_increment_bps', overriddenDisplay: formatBpsPercent(incrementBps) }]),
    ]);
    results.hidden = false;
  });
}
