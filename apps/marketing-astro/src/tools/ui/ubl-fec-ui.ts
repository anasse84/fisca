/** Îlot du validateur local UBL / FEC-MA : lit le fichier ou le texte dans le navigateur, appelle les modules purs, rend le résultat. */
import { formatCentsMad } from '../../lib/money.ts';
import type { ValidatorUiCopy } from '../copy/ubl-fec-ui.ts';
import { checkFecBytes } from '../fec-check.ts';
import type { FecCheckResult, FecIssue } from '../fec-check.ts';
import { checkUblXml } from '../ubl-check.ts';
import type { UblCheckItem, UblCheckResult } from '../ubl-check.ts';
import { clear, el, mustQuery, readJsonAttr, setError, setStatus, show, template } from './dom.ts';

const MAX_FEC_BYTES = 20 * 1024 * 1024;
const MAX_XML_BYTES = 5 * 1024 * 1024;

function issueVars(issue: FecIssue): Record<string, string> {
  return {
    line: String(issue.line ?? ''),
    found: String(issue.found ?? ''),
    column: issue.column ?? '',
    entry: issue.entryNum ?? '',
    detail: issue.detail ?? '',
    debit: issue.debitCents === undefined ? '' : formatCentsMad(issue.debitCents),
    credit: issue.creditCents === undefined ? '' : formatCentsMad(issue.creditCents),
  };
}

function renderFec(copy: ValidatorUiCopy, result: FecCheckResult, target: HTMLElement): void {
  clear(target);
  target.append(el('h4', {}, copy.fecResultTitle));
  target.append(el('p', result.ok ? { class: 'note' } : { class: 'notice', role: 'alert' }, result.ok ? copy.verdictOk : copy.verdictKo));
  target.append(el('p', { class: 'note' }, copy.verdictNote));
  target.append(el('p', { class: 'note' }, copy.profileLine));
  const s = result.stats;
  target.append(el('p', {}, template(copy.fecStats, { lines: String(s.lineCount), entries: String(s.entryCount), debit: formatCentsMad(s.totalDebitCents), credit: formatCentsMad(s.totalCreditCents) })));
  target.append(el('p', { class: 'notice', role: 'note' }, copy.fecHashNotVerified));
  if (result.hashChain.filledLines > 0) target.append(el('p', { class: 'note' }, template(copy.fecHashFilled, { n: String(result.hashChain.filledLines) })));
  if (!result.balanceChecked) target.append(el('p', { class: 'notice', role: 'note' }, copy.fecBalanceSkipped));
  target.append(el('p', { class: 'note' }, copy.fecNotChecked));
  if (!result.fileNameChecked) target.append(el('p', { class: 'note' }, copy.fecFileNameSkipped));
  if (result.issues.length > 0) {
    target.append(el('h5', {}, copy.issuesHeading));
    const list = el('ul', { class: 'plain-list' });
    for (const issue of result.issues) list.append(el('li', {}, template(copy.fecIssues[issue.code], issueVars(issue))));
    target.append(list);
    for (const [code, total] of Object.entries(result.issueTotals)) {
      if (total > 20) target.append(el('p', { class: 'note' }, `${code} : ${template(copy.moreIssues, { n: String(total) })}`));
    }
  }
}

function statusLabel(copy: ValidatorUiCopy, c: UblCheckItem): string {
  if (c.detail === 'NOT_APPLICABLE') return copy.statusNa;
  if (c.ok) return copy.statusPass;
  return c.severity === 'warning' ? copy.statusWarn : copy.statusFail;
}

function renderUbl(copy: ValidatorUiCopy, result: UblCheckResult, target: HTMLElement): void {
  clear(target);
  target.append(el('h4', {}, copy.ublResultTitle));
  target.append(el('p', result.ok ? { class: 'note' } : { class: 'notice', role: 'alert' }, result.ok ? copy.verdictOk : copy.verdictKo));
  target.append(el('p', { class: 'note' }, copy.verdictNote));
  target.append(el('p', { class: 'note' }, copy.ublProfileLine));
  target.append(el('p', { class: 'note' }, copy.ublNoXsd));
  if (result.rootName !== null) target.append(el('p', { class: 'note' }, template(copy.ublRootFound, { name: result.rootName })));
  if (result.typeCode !== null) target.append(el('p', { class: 'note' }, template(copy.ublTypeFound, { code: result.typeCode })));
  const wrap = el('div', { class: 'table-scroll', role: 'region', 'aria-label': copy.tableCaption, tabindex: '0' });
  const table = el('table', { class: 'data-table' });
  table.append(el('caption', {}, copy.tableCaption));
  const head = el('tr', {});
  for (const label of [copy.colCheck, copy.colOrigin, copy.colStatus, copy.colDetail]) head.append(el('th', { scope: 'col' }, label));
  table.append(el('thead', {}, head));
  const body = el('tbody', {});
  for (const c of result.checks) {
    const detail = c.detail === 'PASS' ? '' : template(copy.ublDetails[c.detail], { found: c.found ?? '' });
    const chip = c.ok ? 'chip' : c.severity === 'warning' ? 'chip chip-warning' : 'chip chip-danger';
    body.append(el('tr', {}, el('th', { scope: 'row' }, copy.ublChecks[c.id]), el('td', {}, copy.ublBasis[c.basis]), el('td', {}, el('span', { class: chip }, statusLabel(copy, c))), el('td', {}, detail)));
  }
  table.append(body);
  wrap.append(table);
  target.append(wrap);
}

function isPdf(name: string, bytes: Uint8Array): boolean {
  return name.toLowerCase().endsWith('.pdf') || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
}

/** Second avis de forme : DOMParser signale une erreur d'analyse par un élément parsererror. */
function domWellFormed(xml: string): boolean {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return doc.getElementsByTagName('parsererror').length === 0;
}

export function mountUblFecTool(root: HTMLElement): void {
  const copy = readJsonAttr<ValidatorUiCopy>(root, 'data-copy');
  const fecInput = mustQuery<HTMLInputElement>(root, '[data-role="fec-file"]');
  const fecStatus = mustQuery<HTMLElement>(root, '[data-role="fec-status"]');
  const fecError = mustQuery<HTMLElement>(root, '[data-role="fec-error"]');
  const fecResults = mustQuery<HTMLElement>(root, '[data-role="fec-results"]');
  const ublFile = mustQuery<HTMLInputElement>(root, '[data-role="ubl-file"]');
  const ublText = mustQuery<HTMLTextAreaElement>(root, '[data-role="ubl-text"]');
  const ublForm = mustQuery<HTMLFormElement>(root, '[data-role="ubl-form"]');
  const ublStatus = mustQuery<HTMLElement>(root, '[data-role="ubl-status"]');
  const ublError = mustQuery<HTMLElement>(root, '[data-role="ubl-error"]');
  const ublResults = mustQuery<HTMLElement>(root, '[data-role="ubl-results"]');

  async function handleFec(file: File): Promise<void> {
    setError(fecError, null);
    show(fecResults, false);
    if (file.size > MAX_FEC_BYTES) return setError(fecError, copy.errTooLarge);
    setStatus(fecStatus, copy.analyzing);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = checkFecBytes(bytes, { fileName: file.name });
      renderFec(copy, result, fecResults);
      show(fecResults, true);
      setStatus(fecStatus, template(copy.fecLoaded, { name: file.name }));
    } catch {
      setStatus(fecStatus, '');
      setError(fecError, copy.errRead);
    }
  }

  function runUbl(): void {
    setError(ublError, null);
    show(ublResults, false);
    const xml = ublText.value;
    if (xml.trim() === '') return setError(ublError, copy.errEmptyXml);
    if (xml.length > MAX_XML_BYTES) return setError(ublError, copy.errTooLarge);
    renderUbl(copy, checkUblXml(xml, { domWellFormed }), ublResults);
    show(ublResults, true);
    setStatus(ublStatus, copy.ublLoaded);
  }

  async function handleUblFile(file: File): Promise<void> {
    setError(ublError, null);
    show(ublResults, false);
    if (file.size > MAX_XML_BYTES) return setError(ublError, copy.errTooLarge);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isPdf(file.name, bytes)) return setError(ublError, copy.errPdf);
      ublText.value = new TextDecoder('utf-8').decode(bytes);
      runUbl();
    } catch {
      setError(ublError, copy.errRead);
    }
  }

  fecInput.addEventListener('change', () => {
    const file = fecInput.files?.[0];
    if (file !== undefined) void handleFec(file);
  });
  ublFile.addEventListener('change', () => {
    const file = ublFile.files?.[0];
    if (file !== undefined) void handleUblFile(file);
  });
  ublForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runUbl();
  });
}
