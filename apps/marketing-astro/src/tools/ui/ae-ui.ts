/** Îlot interactif du simulateur auto-entrepreneur : IR trimestriel, comparaison avec une société, seuil par client. */
import { formatBpsPercent, formatCentsMad } from '../../lib/money.ts';
import { parseMadToCents, parsePercentToBps } from '../amounts.ts';
import { computeAeClientThreshold, computeAeSwitch } from '../auto-entrepreneur.ts';
import type { AeUiCopy } from '../copy/ae.ts';
import type { RulesPayload } from './dom.ts';
import { clear, el, mustQuery, num, readJsonAttr, renderRules, resultRow, setError, template } from './dom.ts';

interface AePayload {
  readonly copy: AeUiCopy;
  readonly rules: RulesPayload;
  /** Paramètres lus des données datées et de la grille tarifaire par la page (aucune valeur codée ici). */
  readonly params: {
    readonly thresholdCents: number;
    readonly withholdingBps: number;
    readonly soloAnnualCents: number;
    readonly essentielAnnualCents: number;
  };
}

const CUSTOM = 'custom';

function ruleDisplay(payload: AePayload, key: string): string {
  return payload.rules.items.find((i) => i.key === key)?.display ?? '';
}

function mountIr(root: HTMLElement, payload: AePayload): void {
  const { copy, rules, params } = payload;
  const form = mustQuery<HTMLFormElement>(root, '[data-role="ir-form"]');
  const revenue = mustQuery<HTMLInputElement>(form, '[name="revenue"]');
  const rate = mustQuery<HTMLSelectElement>(form, '[name="rate"]');
  const custom = mustQuery<HTMLInputElement>(form, '[name="custom-rate"]');
  const costs = mustQuery<HTMLInputElement>(form, '[name="costs"]');
  const errorBox = mustQuery<HTMLElement>(root, '[data-role="ir-error"]');
  const results = mustQuery<HTMLElement>(root, '[data-role="ir-results"]');
  const list = mustQuery<HTMLElement>(root, '[data-role="ir-list"]');
  const rulesBox = mustQuery<HTMLElement>(root, '[data-role="ir-rules"]');
  const fields = [revenue, rate, custom, costs];

  function fail(message: string, field: HTMLElement): void {
    setError(errorBox, message);
    for (const f of fields) f.removeAttribute('aria-invalid');
    field.setAttribute('aria-invalid', 'true');
    field.focus();
    results.hidden = true;
  }

  rate.addEventListener('change', () => {
    custom.disabled = rate.value !== CUSTOM;
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setError(errorBox, null);
    const revenueCents = parseMadToCents(revenue.value);
    if (revenueCents === null || revenueCents === 0) return fail(copy.errRevenue, revenue);
    const isCustom = rate.value === CUSTOM;
    const rateBps = isCustom ? parsePercentToBps(custom.value) : Number(rate.value);
    if (rateBps === null || !Number.isInteger(rateBps) || rateBps > 10000) return fail(copy.errRate, isCustom ? custom : rate);
    const costsCents = costs.value.trim() === '' ? 0 : parseMadToCents(costs.value);
    if (costsCents === null) return fail(copy.errCosts, costs);
    const outcome = computeAeSwitch(
      { quarterRevenueCents: revenueCents, rateBps, otherCompanyCostsCents: costsCents },
      { soloAnnualHtCents: params.soloAnnualCents, essentielAnnualHtCents: params.essentielAnnualCents },
    );
    if (!outcome.ok) {
      const map = { REVENUE: revenue, RATE: rate, COSTS: costs, CUMUL: revenue, INVOICE: revenue, PARAMS: revenue } as const;
      const messages = { REVENUE: copy.errRevenue, RATE: copy.errRate, COSTS: copy.errCosts, CUMUL: copy.errRevenue, INVOICE: copy.errRevenue, PARAMS: copy.errRevenue } as const;
      return fail(messages[outcome.error], map[outcome.error]);
    }
    for (const f of fields) f.removeAttribute('aria-invalid');
    const r = outcome.result;
    clear(list);
    list.append(resultRow(`${copy.quarterIr} (${formatBpsPercent(rateBps)})`, num(formatCentsMad(r.quarterIrCents)), true));
    list.append(resultRow(copy.annualIr, num(formatCentsMad(r.annualIrCents))));
    list.append(resultRow(copy.soloAnnual, num(formatCentsMad(params.soloAnnualCents))));
    list.append(resultRow(copy.aeTotal, num(formatCentsMad(r.aeTotalCents))));
    list.append(resultRow(copy.essentielAnnual, num(formatCentsMad(params.essentielAnnualCents))));
    list.append(resultRow(copy.otherCosts, num(formatCentsMad(costsCents))));
    list.append(resultRow(copy.companyTotal, num(formatCentsMad(r.companyTotalCents))));
    list.append(resultRow(copy.difference, num(formatCentsMad(r.differenceCents)), true));
    const abs = formatCentsMad(Math.abs(r.differenceCents));
    list.append(el('p', { class: 'note' }, template(r.differenceCents >= 0 ? copy.differenceMore : copy.differenceLess, { amount: abs })));
    list.append(el('p', { class: 'note' }, copy.differenceNote));
    list.append(el('p', { class: 'note' }, copy.priceSource));
    if (isCustom) {
      renderRules(rulesBox, copy.rulesUsed, rules, []);
      const ul = rulesBox.querySelector('ul');
      if (ul !== null) ul.append(el('li', {}, `${copy.rateLabel} : `, num(formatBpsPercent(rateBps)), ` (${rules.userValue}, `, el('span', { class: 'dated-state', dir: 'ltr' }, 'NON RECOUPÉ'), ')'));
    } else {
      const key = selectedKey(rate);
      renderRules(rulesBox, copy.rulesUsed, rules, [{ key }]);
    }
    results.hidden = false;
  });
}

function selectedKey(select: HTMLSelectElement): string {
  return select.selectedOptions[0]?.getAttribute('data-key') ?? 'ae_ir_rate_low_bps';
}

function mountThreshold(root: HTMLElement, payload: AePayload): void {
  const { copy, rules, params } = payload;
  const form = mustQuery<HTMLFormElement>(root, '[data-role="thr-form"]');
  const prior = mustQuery<HTMLInputElement>(form, '[name="prior"]');
  const invoice = mustQuery<HTMLInputElement>(form, '[name="invoice"]');
  const errorBox = mustQuery<HTMLElement>(root, '[data-role="thr-error"]');
  const results = mustQuery<HTMLElement>(root, '[data-role="thr-results"]');
  const list = mustQuery<HTMLElement>(root, '[data-role="thr-list"]');
  const rulesBox = mustQuery<HTMLElement>(root, '[data-role="thr-rules"]');

  function fail(message: string, field: HTMLElement): void {
    setError(errorBox, message);
    for (const f of [prior, invoice]) f.removeAttribute('aria-invalid');
    field.setAttribute('aria-invalid', 'true');
    field.focus();
    results.hidden = true;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setError(errorBox, null);
    const priorCents = prior.value.trim() === '' ? 0 : parseMadToCents(prior.value);
    if (priorCents === null) return fail(copy.errPrior, prior);
    const invoiceCents = parseMadToCents(invoice.value);
    if (invoiceCents === null || invoiceCents === 0) return fail(copy.errInvoice, invoice);
    const outcome = computeAeClientThreshold({ priorCumulCents: priorCents, invoiceCents }, { thresholdCents: params.thresholdCents, withholdingBps: params.withholdingBps });
    if (!outcome.ok) {
      const bad = outcome.error === 'INVOICE' ? invoice : prior;
      return fail(outcome.error === 'INVOICE' ? copy.errInvoice : copy.errPrior, bad);
    }
    for (const f of [prior, invoice]) f.removeAttribute('aria-invalid');
    const r = outcome.result;
    clear(list);
    const thresholdText = ruleDisplay(payload, 'ae_client_threshold_cents');
    const rateText = ruleDisplay(payload, 'ae_withholding_bps');
    list.append(
      el(
        'p',
        r.exceeded ? { class: 'notice', role: 'alert' } : { class: 'note' },
        r.exceeded ? template(copy.alertOver, { threshold: thresholdText, rate: rateText }) : template(copy.okUnder, { threshold: thresholdText }),
      ),
    );
    list.append(resultRow(copy.cumulAfter, num(formatCentsMad(r.cumulAfterCents))));
    list.append(resultRow(copy.headroom, num(formatCentsMad(r.headroomCents))));
    list.append(resultRow(copy.surplus, num(formatCentsMad(r.surplusCents))));
    list.append(resultRow(copy.withheld, num(formatCentsMad(r.withheldCents)), true));
    list.append(resultRow(copy.net, num(formatCentsMad(r.netCents)), true));
    renderRules(rulesBox, copy.rulesUsed, rules, [{ key: 'ae_client_threshold_cents' }, { key: 'ae_withholding_bps' }]);
    results.hidden = false;
  });
}

export function mountAeTool(root: HTMLElement): void {
  const payload = readJsonAttr<AePayload>(root, 'data-payload');
  mountIr(root, payload);
  mountThreshold(root, payload);
}
