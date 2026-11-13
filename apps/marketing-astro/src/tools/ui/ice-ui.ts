/** Îlot interactif de l'auditeur d'ICE : lit le fichier localement, appelle les modules purs, rend le résultat. */
import type { IceUiCopy } from '../copy/ice-ui.ts';
import { buildCorrectedCsv, auditIceColumn, detectIceColumn } from '../ice-table.ts';
import type { IceTableAudit } from '../ice-table.ts';
import type { IceAuditResult, IceInvalidReason } from '../ice.ts';
import { readSheet, SheetReadError } from '../sheet-reader.ts';
import type { SheetData } from '../sheet-reader.ts';
import { clear, downloadText, el, mustQuery, num, readJsonAttr, setError, setStatus, show, template } from './dom.ts';

const MAX_DISPLAYED_ROWS = 500;

function reasonText(copy: IceUiCopy, reason: IceInvalidReason | undefined): string {
  switch (reason) {
    case 'NON_DIGIT':
      return copy.reasonNonDigit;
    case 'BAD_LENGTH':
      return copy.reasonBadLength;
    case 'ZERO_ENTERPRISE_ROOT':
      return copy.reasonZeroRoot;
    case 'CHECKSUM':
      return copy.reasonChecksum;
    case 'REPAIR_CHECKSUM':
      return copy.reasonRepairChecksum;
    case 'SCIENTIFIC_NOTATION':
      return copy.reasonScientific;
    case undefined:
      return '';
  }
}

function statusText(copy: IceUiCopy, result: IceAuditResult): string {
  switch (result.status) {
    case 'VALID_15':
      return copy.statusValid;
    case 'AUTO_REPAIRED_EXCEL_LEADING_ZEROS':
      return copy.statusRepaired;
    case 'INVALID_CHECKSUM_OR_FORMAT':
      return copy.statusInvalid;
    case 'EMPTY':
      return copy.statusEmpty;
  }
}

function errorText(copy: IceUiCopy, error: unknown): string {
  if (error instanceof SheetReadError) {
    switch (error.code) {
      case 'EMPTY':
        return copy.errEmpty;
      case 'TOO_LARGE':
        return copy.errTooLarge;
      case 'UNSUPPORTED_EXTENSION':
        return copy.errUnsupported;
      case 'NO_ROWS':
        return copy.errNoRows;
      case 'XLSX':
        return template(copy.errXlsx, { reason: error.detail });
    }
  }
  return copy.errRead;
}

export function mountIceTool(root: HTMLElement): void {
  const copy = readJsonAttr<IceUiCopy>(root, 'data-copy');
  const input = mustQuery<HTMLInputElement>(root, '[data-role="file"]');
  const drop = mustQuery<HTMLElement>(root, '[data-role="drop"]');
  const status = mustQuery<HTMLElement>(root, '[data-role="status"]');
  const errorBox = mustQuery<HTMLElement>(root, '[data-role="error"]');
  const options = mustQuery<HTMLElement>(root, '[data-role="options"]');
  const columnSelect = mustQuery<HTMLSelectElement>(root, '[data-role="column"]');
  const headerBox = mustQuery<HTMLInputElement>(root, '[data-role="header"]');
  const results = mustQuery<HTMLElement>(root, '[data-role="results"]');
  const summary = mustQuery<HTMLElement>(root, '[data-role="summary"]');
  const tableWrap = mustQuery<HTMLElement>(root, '[data-role="table"]');
  const exportButton = mustQuery<HTMLButtonElement>(root, '[data-role="export"]');

  let sheet: SheetData | null = null;
  let audit: IceTableAudit | null = null;
  let fileName = 'fichier.csv';

  function renderResults(): void {
    if (sheet === null) return;
    const column = Number(columnSelect.value);
    audit = auditIceColumn(sheet.rows, column, headerBox.checked);
    const s = audit.summary;
    clear(summary);
    const entries: readonly (readonly [string, number])[] = [
      [copy.total, s.total],
      [copy.valid, s.valid],
      [copy.repaired, s.repaired],
      [copy.invalid, s.invalid],
      [copy.empty, s.empty],
    ];
    for (const [label, value] of entries) {
      summary.append(el('div', { class: 'result-row' }, el('dt', {}, label), el('dd', {}, num(String(value)))));
    }
    const toReview = audit.rows.filter((r) => r.result.status === 'AUTO_REPAIRED_EXCEL_LEADING_ZEROS' || r.result.status === 'INVALID_CHECKSUM_OR_FORMAT');
    clear(tableWrap);
    if (toReview.length === 0) {
      tableWrap.append(el('p', { class: 'note' }, copy.nothingToReview));
    } else {
      const table = el('table', { class: 'data-table' });
      table.append(el('caption', {}, copy.tableCaption));
      const head = el('tr', {});
      for (const label of [copy.colRow, copy.colOriginal, copy.colStatus, copy.colCorrected, copy.colDetail]) head.append(el('th', { scope: 'col' }, label));
      table.append(el('thead', {}, head));
      const body = el('tbody', {});
      for (const row of toReview.slice(0, MAX_DISPLAYED_ROWS)) {
        const r = row.result;
        const detail = r.status === 'AUTO_REPAIRED_EXCEL_LEADING_ZEROS' ? copy.detailRepaired : reasonText(copy, r.reason);
        body.append(
          el(
            'tr',
            {},
            el('th', { scope: 'row' }, num(String(row.rowNumber))),
            el('td', {}, num(r.rawInput)),
            el('td', {}, el('span', { class: r.status === 'INVALID_CHECKSUM_OR_FORMAT' ? 'chip chip-danger' : 'chip chip-warning' }, statusText(copy, r))),
            el('td', {}, num(r.normalizedIce15 ?? '')),
            el('td', {}, detail),
          ),
        );
      }
      table.append(body);
      tableWrap.append(table);
      if (toReview.length > MAX_DISPLAYED_ROWS) {
        tableWrap.append(el('p', { class: 'note' }, template(copy.truncated, { n: String(toReview.length - MAX_DISPLAYED_ROWS) })));
      }
    }
    show(results, true);
    setStatus(status, template(copy.loaded, { name: fileName, rows: String(s.total) }));
  }

  async function handleFile(file: File): Promise<void> {
    setError(errorBox, null);
    setStatus(status, copy.analyzing);
    show(results, false);
    show(options, false);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      sheet = await readSheet(file.name, bytes);
      fileName = file.name;
      const detected = detectIceColumn(sheet.rows);
      const width = sheet.rows.reduce((max, r) => Math.max(max, r.length), 0);
      clear(columnSelect);
      for (let c = 0; c < width; c += 1) {
        const header = detected.hasHeader ? (sheet.rows[0]?.[c] ?? '') : '';
        const label = header === '' ? template(copy.columnOption, { n: String(c + 1) }) : `${template(copy.columnOption, { n: String(c + 1) })} — ${header}`;
        const option = el('option', { value: String(c) }, label) as HTMLOptionElement;
        option.selected = c === detected.column;
        columnSelect.append(option);
      }
      headerBox.checked = detected.hasHeader;
      show(options, true);
      renderResults();
    } catch (error) {
      sheet = null;
      audit = null;
      setStatus(status, '');
      setError(errorBox, errorText(copy, error));
    }
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file !== undefined) void handleFile(file);
  });
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.setAttribute('data-dragging', 'true');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, () => drop.removeAttribute('data-dragging'));
  }
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = (event as DragEvent).dataTransfer?.files[0];
    if (file !== undefined) void handleFile(file);
  });
  columnSelect.addEventListener('change', renderResults);
  headerBox.addEventListener('change', renderResults);
  exportButton.addEventListener('click', () => {
    if (sheet === null || audit === null) return;
    const base = fileName.replace(/\.[^.]+$/, '');
    downloadText(`${base}_ICE_corrige.csv`, buildCorrectedCsv(sheet.rows, audit, headerBox.checked, sheet.delimiter), 'text/csv;charset=utf-8');
  });
}
