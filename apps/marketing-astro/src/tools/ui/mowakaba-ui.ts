/** Îlot interactif de l'estimateur Mowakaba : éligibilité, subvention et reste à charge, en centimes entiers. */
import { formatBpsPercent, formatCentsMad } from '../../lib/money.ts';
import { parseMadToCents, parsePercentToBps } from '../amounts.ts';
import type { MowakabaUiCopy } from '../copy/mowakaba.ts';
import { computeMowakaba } from '../mowakaba.ts';
import type { MowakabaScenario } from '../mowakaba.ts';
import type { RulesPayload } from './dom.ts';
import { clear, el, mustQuery, num, readJsonAttr, renderRules, resultRow, setError, template } from './dom.ts';

interface MowakabaPayload {
  readonly copy: MowakabaUiCopy;
  readonly rules: RulesPayload;
  /** Paramètres lus des données datées et de la grille tarifaire par la page (aucune valeur codée ici). */
  readonly params: {
    readonly coverageLowBps: number;
    readonly coverageHighBps: number;
    readonly maxRevenueHtCents: number;
    readonly maxGroupOwnershipBps: number;
  };
}

function scenarioRow(label: string, s: MowakabaScenario): HTMLElement {
  return el('tr', {}, el('th', { scope: 'row' }, label), el('td', {}, num(formatBpsPercent(s.coverageBps))), el('td', {}, num(formatCentsMad(s.subsidyCents))), el('td', {}, num(formatCentsMad(s.remainingCents))));
}

export function mountMowakabaTool(root: HTMLElement): void {
  const { copy, rules, params } = readJsonAttr<MowakabaPayload>(root, 'data-payload');
  const form = mustQuery<HTMLFormElement>(root, 'form');
  const revenue = mustQuery<HTMLInputElement>(form, '[name="revenue"]');
  const ownership = mustQuery<HTMLInputElement>(form, '[name="ownership"]');
  const pack = mustQuery<HTMLSelectElement>(form, '[name="pack"]');
  const coverage = mustQuery<HTMLInputElement>(form, '[name="coverage"]');
  const errorBox = mustQuery<HTMLElement>(root, '[data-role="error"]');
  const results = mustQuery<HTMLElement>(root, '[data-role="results"]');
  const list = mustQuery<HTMLElement>(root, '[data-role="list"]');
  const tableBox = mustQuery<HTMLElement>(root, '[data-role="table"]');
  const rulesBox = mustQuery<HTMLElement>(root, '[data-role="rules"]');
  const fields = [revenue, ownership, pack, coverage];

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
    const revenueCents = parseMadToCents(revenue.value);
    if (revenueCents === null) return fail(copy.errRevenue, revenue);
    const ownershipBps = ownership.value.trim() === '' ? null : parsePercentToBps(ownership.value);
    if (ownership.value.trim() !== '' && (ownershipBps === null || ownershipBps > 10000)) return fail(copy.errOwnership, ownership);
    const chosenBps = coverage.value.trim() === '' ? null : parsePercentToBps(coverage.value);
    if (coverage.value.trim() !== '' && chosenBps === null) return fail(copy.errCoverage, coverage);
    const priceCents = Number(pack.value);
    const outcome = computeMowakaba(
      { revenueHtCents: revenueCents, groupOwnershipBps: ownershipBps, packPriceHtCents: priceCents, chosenCoverageBps: chosenBps },
      { coverageLowBps: params.coverageLowBps, coverageHighBps: params.coverageHighBps, maxRevenueHtCents: params.maxRevenueHtCents, maxGroupOwnershipBps: params.maxGroupOwnershipBps },
    );
    if (!outcome.ok) {
      const map = { REVENUE: revenue, OWNERSHIP: ownership, PRICE: pack, COVERAGE: coverage, PARAMS: revenue } as const;
      const messages = { REVENUE: copy.errRevenue, OWNERSHIP: copy.errOwnership, PRICE: copy.errRevenue, COVERAGE: copy.errCoverage, PARAMS: copy.errRevenue } as const;
      return fail(messages[outcome.error], map[outcome.error]);
    }
    for (const f of fields) f.removeAttribute('aria-invalid');
    const r = outcome.result;
    const display = (key: string): string => rules.items.find((i) => i.key === key)?.display ?? '';
    clear(list);
    clear(tableBox);
    list.append(el('p', r.eligible ? { class: 'note' } : { class: 'notice', role: 'alert' }, r.eligible ? copy.eligibleYes : copy.eligibleNo));
    for (const reason of r.reasons) {
      const text = reason === 'REVENUE_ABOVE_CEILING' ? template(copy.reasonRevenue, { ceiling: display('mowakaba_max_revenue_ht_cents') }) : template(copy.reasonOwnership, { threshold: display('mowakaba_group_ownership_max_bps') });
      list.append(el('p', { class: 'note' }, text));
    }
    list.append(resultRow(copy.packPrice, num(formatCentsMad(r.packPriceHtCents))));
    if (r.eligible) {
      list.append(resultRow(copy.rangeLine, num(`${formatCentsMad(r.high.remainingCents)} – ${formatCentsMad(r.low.remainingCents)}`), true));
      const wrap = el('div', { class: 'table-scroll', role: 'region', 'aria-label': copy.tableCaption, tabindex: '0' });
      const table = el('table', { class: 'data-table' });
      table.append(el('caption', {}, copy.tableCaption));
      const head = el('tr', {});
      for (const label of ['', copy.colCoverage, copy.colSubsidy, copy.colRemaining]) head.append(el('th', { scope: 'col' }, label));
      table.append(el('thead', {}, head));
      const body = el('tbody', {});
      body.append(scenarioRow(copy.rowLow, r.low));
      if (r.chosen !== null) body.append(scenarioRow(copy.rowChosen, r.chosen));
      body.append(scenarioRow(copy.rowHigh, r.high));
      table.append(body);
      wrap.append(table);
      tableBox.append(wrap);
    } else {
      list.append(resultRow(copy.fullPrice, num(formatCentsMad(r.packPriceHtCents)), true));
    }
    list.append(el('p', { class: 'note' }, copy.priceSource));
    list.append(el('p', { class: 'note' }, copy.notPromise));
    const used = [{ key: 'mowakaba_max_revenue_ht_cents' }, { key: 'mowakaba_coverage_low_bps' }, { key: 'mowakaba_coverage_high_bps' }, ...(ownershipBps === null ? [] : [{ key: 'mowakaba_group_ownership_max_bps' }])];
    renderRules(rulesBox, copy.rulesUsed, rules, used);
    results.hidden = false;
  });
}
