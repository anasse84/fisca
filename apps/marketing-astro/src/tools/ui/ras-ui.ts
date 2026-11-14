/** Îlot interactif RAS-TVA (art. 117) et plafond d'espèces (art. 11-II). */
import { formatBpsPercent, formatCentsMad } from '../../lib/money.ts';
import { parseMadToCents } from '../amounts.ts';
import { evaluateCashPayments } from '../cash-cap.ts';
import { buildMonthlyExample, parseCashLines } from '../cash-input.ts';
import type { RasUiCopy } from '../copy/ras.ts';
import { cleanAccountInput } from '../ledger.ts';
import type { LedgerEntry } from '../ledger.ts';
import { computeRasTva } from '../ras-tva.ts';
import type { CapBasis } from '../rule-params.ts';
import type { RulesPayload } from './dom.ts';
import { clear, el, mustQuery, num, readJsonAttr, renderRules, resultRow, setError, template } from './dom.ts';

interface RasPayload {
  readonly copy: RasUiCopy;
  readonly rules: RulesPayload;
  readonly roles: Readonly<Record<string, string>>;
  /** Paramètres de calcul lus des données datées par la page (aucune valeur codée ici). */
  readonly params: {
    readonly reducedBps: number;
    readonly fullBps: number;
    readonly attestationMonths: number;
    readonly thresholdCents: number;
    readonly capDayCents: number;
    readonly capMonthCents: number;
  };
  readonly example: { readonly firstDate: string; readonly count: number; readonly amountMad: string };
}

function renderEntry(target: HTMLElement, copy: RasUiCopy, roles: Readonly<Record<string, string>>, entry: LedgerEntry): void {
  clear(target);
  target.append(el('h3', {}, copy.entryHeading));
  const wrap = el('div', { class: 'table-scroll', role: 'region', 'aria-label': copy.entryHeading, tabindex: '0' });
  const table = el('table', { class: 'data-table' });
  const head = el('tr', {});
  for (const label of [copy.colAccount, copy.colLabel, copy.colDebit, copy.colCredit]) head.append(el('th', { scope: 'col' }, label));
  table.append(el('thead', {}, head));
  const body = el('tbody', {});
  for (const line of entry.lines) {
    body.append(
      el(
        'tr',
        {},
        el('td', {}, line.account === null ? el('span', { class: 'pending' }, copy.accountToFill) : num(line.account)),
        el('td', {}, roles[line.role] ?? line.role),
        el('td', {}, line.debitCents === 0 ? '' : num(formatCentsMad(line.debitCents))),
        el('td', {}, line.creditCents === 0 ? '' : num(formatCentsMad(line.creditCents))),
      ),
    );
  }
  body.append(el('tr', { class: 'total-row' }, el('th', { scope: 'row', colspan: '2' }, copy.totals), el('td', {}, num(formatCentsMad(entry.totalDebitCents))), el('td', {}, num(formatCentsMad(entry.totalCreditCents)))));
  table.append(body);
  wrap.append(table);
  target.append(wrap, el('p', { class: 'note' }, copy.balanced));
}

function accountOrNull(raw: string): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  if (raw.trim() === '') return { ok: true, value: null };
  const cleaned = cleanAccountInput(raw);
  return cleaned === null ? { ok: false } : { ok: true, value: cleaned };
}

function vatKeyOf(select: HTMLSelectElement): string {
  return select.selectedOptions[0]?.getAttribute('data-key') ?? 'vat_standard_bps';
}

function mountRas(root: HTMLElement, payload: RasPayload): void {
  const { copy, rules, roles, params } = payload;
  const form = mustQuery<HTMLFormElement>(root, '[data-role="ras-form"]');
  const ht = mustQuery<HTMLInputElement>(form, '[name="ht"]');
  const vat = mustQuery<HTMLSelectElement>(form, '[name="vat"]');
  const paymentDate = mustQuery<HTMLInputElement>(form, '[name="payment-date"]');
  const attestation = mustQuery<HTMLInputElement>(form, '[name="attestation"]');
  const paymentAccount = mustQuery<HTMLInputElement>(form, '[name="payment-account"]');
  const dueAccount = mustQuery<HTMLInputElement>(form, '[name="due-account"]');
  const errorBox = mustQuery<HTMLElement>(root, '[data-role="ras-error"]');
  const results = mustQuery<HTMLElement>(root, '[data-role="ras-results"]');
  const list = mustQuery<HTMLElement>(root, '[data-role="ras-list"]');
  const entryBox = mustQuery<HTMLElement>(root, '[data-role="ras-entry"]');
  const rulesBox = mustQuery<HTMLElement>(root, '[data-role="ras-rules"]');
  const fields = [ht, vat, paymentDate, attestation, paymentAccount, dueAccount];

  function fail(message: string, field: HTMLElement): void {
    setError(errorBox, message);
    for (const f of fields) f.removeAttribute('aria-invalid');
    field.setAttribute('aria-invalid', 'true');
    field.focus();
    results.hidden = true;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setError(errorBox, null);
    const htCents = parseMadToCents(ht.value);
    if (htCents === null || htCents === 0) return fail(copy.errAmount, ht);
    if (paymentDate.value === '') return fail(copy.errPaymentDate, paymentDate);
    const pay = accountOrNull(paymentAccount.value);
    if (!pay.ok) return fail(copy.errAccount, paymentAccount);
    const due = accountOrNull(dueAccount.value);
    if (!due.ok) return fail(copy.errAccount, dueAccount);
    const vatItem = rules.items.find((i) => i.key === vatKeyOf(vat));
    const outcome = computeRasTva(
      { htCents, vatRateBps: Number(vat.value), paymentDate: paymentDate.value, attestationDate: attestation.value === '' ? null : attestation.value },
      { reducedBps: params.reducedBps, fullBps: params.fullBps, attestationMonths: params.attestationMonths, exclusionThresholdTtcCents: params.thresholdCents },
      { payment: pay.value, withheldDue: due.value },
    );
    if (!outcome.ok) {
      const map = { AMOUNT: ht, PAYMENT_DATE: paymentDate, ATTESTATION_DATE: attestation, ATTESTATION_AFTER_PAYMENT: attestation, PARAMS: ht } as const;
      const messages = {
        AMOUNT: copy.errAmount,
        PAYMENT_DATE: copy.errPaymentDate,
        ATTESTATION_DATE: copy.errAttestationDate,
        ATTESTATION_AFTER_PAYMENT: copy.errAttestationAfter,
        PARAMS: copy.errAmount,
      } as const;
      return fail(messages[outcome.error], map[outcome.error]);
    }
    for (const f of fields) f.removeAttribute('aria-invalid');
    const r = outcome.result;
    const attText = r.attestation === 'NONE' ? copy.attNone : r.attestation === 'VALID' ? copy.attValid : copy.attExpired;
    clear(list);
    list.append(resultRow(copy.vat, num(formatCentsMad(r.vatCents))));
    list.append(resultRow(copy.ttc, num(formatCentsMad(r.ttcCents))));
    list.append(resultRow(copy.attestationState, attText));
    list.append(resultRow(copy.rate, num(r.aboveThreshold ? `${formatBpsPercent(r.rateBps)} (${String(r.rateBps)} bps)` : '—')));
    list.append(resultRow(copy.withheld, num(formatCentsMad(r.withheldCents)), true));
    list.append(resultRow(copy.netPaid, num(formatCentsMad(r.netPaidCents)), true));
    if (!r.aboveThreshold) list.append(el('p', { class: 'note' }, template(copy.belowThreshold, { threshold: formatCentsMad(params.thresholdCents) })));
    renderEntry(entryBox, copy, roles, r.entry);
    const used: { key: string }[] = [{ key: r.attestation === 'VALID' ? 'ras_reduced_bps' : 'ras_full_bps' }, { key: 'ras_attestation_months' }, { key: 'ras_exclusion_threshold_ttc_cents' }];
    if (vatItem !== undefined) used.push({ key: vatItem.key });
    renderRules(rulesBox, copy.rulesUsed, rules, used);
    results.hidden = false;
  });
}

function mountCash(root: HTMLElement, payload: RasPayload): void {
  const { copy, rules, roles, params, example } = payload;
  const form = mustQuery<HTMLFormElement>(root, '[data-role="cash-form"]');
  const lines = mustQuery<HTMLTextAreaElement>(form, '[name="lines"]');
  const vat = mustQuery<HTMLSelectElement>(form, '[name="cash-vat"]');
  const basis = mustQuery<HTMLSelectElement>(form, '[name="basis"]');
  const expense = mustQuery<HTMLInputElement>(form, '[name="expense-account"]');
  const loadExample = mustQuery<HTMLButtonElement>(form, '[data-role="load-example"]');
  const errorBox = mustQuery<HTMLElement>(root, '[data-role="cash-error"]');
  const results = mustQuery<HTMLElement>(root, '[data-role="cash-results"]');
  const summary = mustQuery<HTMLElement>(root, '[data-role="cash-summary"]');
  const tableBox = mustQuery<HTMLElement>(root, '[data-role="cash-table"]');
  const entryBox = mustQuery<HTMLElement>(root, '[data-role="cash-entry"]');
  const rulesBox = mustQuery<HTMLElement>(root, '[data-role="cash-rules"]');

  function fail(message: string, field: HTMLElement): void {
    setError(errorBox, message);
    field.setAttribute('aria-invalid', 'true');
    field.focus();
    results.hidden = true;
  }

  loadExample.addEventListener('click', () => {
    lines.value = buildMonthlyExample(example.firstDate, copy.exampleSupplier, example.count, example.amountMad);
    lines.removeAttribute('aria-invalid');
    lines.focus();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setError(errorBox, null);
    for (const f of [lines, expense]) f.removeAttribute('aria-invalid');
    const parsed = parseCashLines(lines.value);
    if (!parsed.ok) {
      const n = String(parsed.lineNumber ?? 0);
      const messages = { EMPTY: copy.errLinesEmpty, FORMAT: template(copy.errLinesFormat, { n }), DATE: template(copy.errLinesDate, { n }), AMOUNT: template(copy.errLinesAmount, { n }) } as const;
      return fail(messages[parsed.error], lines);
    }
    const account = accountOrNull(expense.value);
    if (!account.ok) return fail(copy.errAccount, expense);
    const capBasis: CapBasis = basis.value === 'HT' ? 'HT' : 'TTC';
    const outcome = evaluateCashPayments(
      parsed.payments,
      { capDayCents: params.capDayCents, capMonthCents: params.capMonthCents, vatRateBps: Number(vat.value), capBasis },
      account.value,
    );
    if (!outcome.ok) return fail(copy.errLinesFormat.replace('{n}', String((outcome.inputIndex ?? 0) + 1)), lines);
    const t = outcome.totals;
    clear(summary);
    summary.append(resultRow(copy.excessTotal, num(formatCentsMad(t.excessTtcCents)), true));
    summary.append(resultRow(copy.reintegratedTotal, num(formatCentsMad(t.reintegratedHtCents))));
    summary.append(resultRow(copy.lostVatTotal, num(formatCentsMad(t.lostVatCents))));
    const crossedAt = outcome.lines.findIndex((l) => l.excessTtcCents > 0);
    summary.append(el('p', { class: 'note' }, `${copy.capBasisLabel} : ${basis.selectedOptions[0]?.textContent ?? capBasis}`));
    summary.append(el('p', { class: 'note' }, crossedAt < 0 ? copy.noExcess : template(copy.crossed, { n: String(crossedAt + 1) })));

    clear(tableBox);
    const wrap = el('div', { class: 'table-scroll', role: 'region', 'aria-label': copy.cashTableCaption, tabindex: '0' });
    const table = el('table', { class: 'data-table' });
    table.append(el('caption', {}, copy.cashTableCaption));
    const head = el('tr', {});
    for (const label of [copy.colDate, copy.colSupplier, copy.colTtc, copy.colAllowed, copy.colExcess, copy.colReintegrated, copy.colLostVat, copy.colCumulMonth]) head.append(el('th', { scope: 'col' }, label));
    table.append(el('thead', {}, head));
    const body = el('tbody', {});
    for (const l of outcome.lines) {
      const bindingText = l.binding === 'DAY' ? copy.bindingDay : l.binding === 'MONTH' ? copy.bindingMonth : '';
      body.append(
        el(
          'tr',
          {},
          el('th', { scope: 'row' }, num(l.date)),
          el('td', {}, l.supplier),
          el('td', {}, num(formatCentsMad(l.ttcCents))),
          el('td', {}, num(formatCentsMad(l.allowedTtcCents))),
          el('td', {}, num(formatCentsMad(l.excessTtcCents)), bindingText === '' ? '' : el('span', { class: 'chip chip-danger' }, bindingText)),
          el('td', {}, num(formatCentsMad(l.reintegratedHtCents))),
          el('td', {}, num(formatCentsMad(l.lostVatCents))),
          el('td', {}, num(formatCentsMad(l.monthCumulCents))),
        ),
      );
    }
    table.append(body);
    wrap.append(table);
    tableBox.append(wrap);
    renderEntry(entryBox, copy, roles, outcome.entry);
    const vatItem = rules.items.find((i) => i.key === vatKeyOf(vat));
    const used: { key: string }[] = [{ key: 'cash_cap_day_cents' }, { key: 'cash_cap_month_cents' }];
    if (vatItem !== undefined) used.push({ key: vatItem.key });
    renderRules(rulesBox, copy.rulesUsed, rules, used);
    results.hidden = false;
  });
}

export function mountRasTool(root: HTMLElement): void {
  const payload = readJsonAttr<RasPayload>(root, 'data-payload');
  mountRas(root, payload);
  mountCash(root, payload);
}
