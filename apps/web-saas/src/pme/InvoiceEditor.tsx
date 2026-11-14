import { useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import { directionOf } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { FiscalAmount } from '@fisca/ui-mercury';
import { isIceShapeValid, normalizeIceInput } from '../shared/auth/ice.ts';
import { formatBps, parseScaledDecimal } from './decimal-input.ts';
import { FiscalRuleBanners } from './FiscalRuleBanner.tsx';
import { InvoicePreview } from './InvoicePreview.tsx';
import { computeInvoiceTotals } from './invoice-totals.ts';
import { commonText, pmeText } from './labels.tsx';
import type { FiscalRule, InvoiceDraft, InvoiceDraftLine, InvoiceDraftSink, InvoiceParty, VatRateOption } from './ports.ts';
import './pme.css';

export interface InvoiceEditorProps {
  readonly locale: FiscaLocale;
  /** Date de la facture fournie par l'hôte (ISO) : aucune date n'est lue ici. */
  readonly invoiceDate: string;
  /** Taux de TVA proposés : liste fournie par le port, jamais codée en dur. */
  readonly rates: readonly VatRateOption[];
  readonly issuer: InvoiceParty;
  readonly sink: InvoiceDraftSink;
  readonly rules?: readonly FiscalRule[] | undefined;
}

interface LineState {
  readonly id: number;
  readonly designationFr: string;
  readonly designationAr: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly rate: string;
}

interface LineErrors {
  readonly designation: boolean;
  readonly quantity: boolean;
  readonly unitPrice: boolean;
  readonly rate: boolean;
}

interface ParsedLine {
  readonly designationFr: string;
  readonly designationAr: string;
  readonly quantityMilli: number;
  readonly unitPriceCents: number;
  readonly vatRateBps: number;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function safe(value: bigint | null): number | null {
  return value === null || value > MAX_SAFE ? null : Number(value);
}

function parseLine(line: LineState, rates: readonly VatRateOption[]): { readonly parsed: ParsedLine | null; readonly errors: LineErrors } {
  const designationFr = line.designationFr.trim();
  const designationAr = line.designationAr.trim();
  const quantity = safe(parseScaledDecimal(line.quantity, 3));
  const unitPrice = safe(parseScaledDecimal(line.unitPrice, 2));
  const rateValue = line.rate === '' ? null : Number(line.rate);
  const rate = rateValue !== null && rates.some((r) => r.rateBps === rateValue) ? rateValue : null;
  const errors: LineErrors = {
    designation: designationFr === '' && designationAr === '',
    quantity: quantity === null || quantity <= 0,
    unitPrice: unitPrice === null,
    rate: rate === null,
  };
  if (errors.designation || errors.quantity || errors.unitPrice || errors.rate || quantity === null || unitPrice === null || rate === null) {
    return { parsed: null, errors };
  }
  return { parsed: { designationFr, designationAr, quantityMilli: quantity, unitPriceCents: unitPrice, vatRateBps: rate }, errors };
}

const emptyLine = (id: number): LineState => ({ id, designationFr: '', designationAr: '', quantity: '', unitPrice: '', rate: '' });

/** Éditeur de facture bilingue FR / AR : lignes, totaux par divRoundHalfUpBigInt, aperçu au gabarit Section 09, brouillon via le port. */
export function InvoiceEditor({ locale, invoiceDate, rates, issuer, sink, rules }: InvoiceEditorProps): ReactElement {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const nextId = useRef(2);
  const [lines, setLines] = useState<readonly LineState[]>([emptyLine(1)]);
  const [customerNameFr, setCustomerNameFr] = useState('');
  const [customerNameAr, setCustomerNameAr] = useState('');
  const [customerIce, setCustomerIce] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const analysed = useMemo(() => lines.map((line) => ({ line, ...parseLine(line, rates) })), [lines, rates]);
  const validLines = useMemo(() => analysed.flatMap((a) => (a.parsed === null ? [] : [a.parsed])), [analysed]);
  const totals = useMemo(() => computeInvoiceTotals(validLines), [validLines]);
  const iceInvalid = customerIce !== '' && !isIceShapeValid(customerIce);
  const ratesMissing = rates.length === 0;

  const customer: InvoiceParty = {
    nameFr: customerNameFr.trim(),
    nameAr: customerNameAr.trim() === '' ? null : customerNameAr.trim(),
    ice: customerIce === '' ? null : customerIce,
    identifiantFiscal: null,
    rcNumber: null,
    rcTribunal: null,
    legalForm: null,
    shareCapitalCents: null,
    addressAdc450: null,
  };

  const patch = (id: number, change: Partial<LineState>): void => {
    setPhase('idle');
    setLines((current) => current.map((l) => (l.id === id ? { ...l, ...change } : l)));
  };
  const onText = (id: number, field: keyof LineState) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => patch(id, { [field]: event.currentTarget.value });

  const submit = async (): Promise<void> => {
    setShowErrors(true);
    const allValid = validLines.length > 0 && validLines.length === lines.length && !iceInvalid && !ratesMissing;
    if (!allValid) {
      queueMicrotask(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const draftLines: InvoiceDraftLine[] = validLines.map((l, i) => ({ ...l, lineHtCents: totals.lines[i]?.lineHtCents ?? 0 }));
    const draft: InvoiceDraft = {
      invoiceDate,
      customer,
      lines: draftLines,
      vatByRate: totals.vatByRate,
      totalHtCents: totals.totalHtCents,
      totalVatCents: totals.totalVatCents,
      totalTtcCents: totals.totalTtcCents,
    };
    setPhase('saving');
    try {
      const outcome = await sink.saveDraft(draft);
      setPhase(outcome.ok ? 'saved' : 'failed');
    } catch {
      setPhase('failed');
    }
  };

  const L = (key: string): string => pmeText(locale, `invoice.${key}`);
  const lineTitle = (n: number): string => L('line.title').replace('{n}', String(n));

  return (
    <div className="fisca-pme" dir={directionOf(locale)} lang={locale}>
      <h1 className="fisca-pme__h1">{L('title')}</h1>
      <p className="fisca-pme__meta">
        {L('invoiceDate')} :{' '}
        <time dir="ltr" dateTime={invoiceDate} className="fisca-tabular-num">
          {invoiceDate}
        </time>
      </p>
      <p className="fisca-pme__notice">{commonText(locale, 'notice.simulated')}</p>
      <FiscalRuleBanners locale={locale} rules={rules ?? []} />
      {ratesMissing ? (
        <p role="alert" className="fisca-pme__state fisca-pme__state--error">
          {L('ratesUnavailable')}
        </p>
      ) : null}

      <form
        ref={formRef}
        noValidate
        className="fisca-pme__form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset className="fisca-pme__fieldset">
          <legend className="fisca-pme__legend">{L('customerSection')}</legend>
          <div className="fisca-pme__field">
            <label htmlFor={`${uid}-cfr`} className="fisca-pme__label">
              {L('customerNameFr')}
            </label>
            <input id={`${uid}-cfr`} className="fisca-pme__input" type="text" lang="fr" dir="ltr" value={customerNameFr} onChange={(e) => setCustomerNameFr(e.currentTarget.value)} />
          </div>
          <div className="fisca-pme__field">
            <label htmlFor={`${uid}-car`} className="fisca-pme__label">
              {L('customerNameAr')}
            </label>
            <input id={`${uid}-car`} className="fisca-pme__input" type="text" lang="ar" dir="rtl" value={customerNameAr} onChange={(e) => setCustomerNameAr(e.currentTarget.value)} />
          </div>
          <div className="fisca-pme__field">
            <label htmlFor={`${uid}-ice`} className="fisca-pme__label">
              {L('customerIce')}
            </label>
            <input
              id={`${uid}-ice`}
              className="fisca-pme__input fisca-tabular-num"
              type="text"
              inputMode="numeric"
              dir="ltr"
              value={customerIce}
              aria-invalid={showErrors && iceInvalid ? true : undefined}
              aria-describedby={showErrors && iceInvalid ? `${uid}-ice-err` : undefined}
              onChange={(e) => setCustomerIce(normalizeIceInput(e.currentTarget.value))}
            />
            {showErrors && iceInvalid ? (
              <p id={`${uid}-ice-err`} className="fisca-pme__error">
                {L('errors.ice')}
              </p>
            ) : null}
          </div>
        </fieldset>

        <h2 className="fisca-pme__h2">{L('linesSection')}</h2>
        {showErrors && lines.length === 0 ? <p className="fisca-pme__error">{L('errors.noLines')}</p> : null}
        {analysed.map(({ line, parsed, errors }, index) => {
          const base = `${uid}-l${line.id}`;
          const mark = (bad: boolean): { 'aria-invalid'?: true; 'aria-describedby'?: string } => (showErrors && bad ? { 'aria-invalid': true } : {});
          const describe = (name: string, bad: boolean): { 'aria-describedby'?: string } => (showErrors && bad ? { 'aria-describedby': `${base}-${name}-err` } : {});
          const lineTotal = parsed === null ? null : computeInvoiceTotals([parsed]).lines[0]?.lineHtCents ?? null;
          return (
            <fieldset key={line.id} className="fisca-pme__fieldset fisca-pme__line">
              <legend className="fisca-pme__legend">{lineTitle(index + 1)}</legend>
              <div className="fisca-pme__field fisca-pme__field--wide">
                <label htmlFor={`${base}-dfr`} className="fisca-pme__label">
                  {L('line.designationFr')}
                </label>
                <input id={`${base}-dfr`} className="fisca-pme__input" type="text" lang="fr" dir="ltr" value={line.designationFr} {...mark(errors.designation)} {...describe('designation', errors.designation)} onChange={onText(line.id, 'designationFr')} />
              </div>
              <div className="fisca-pme__field fisca-pme__field--wide">
                <label htmlFor={`${base}-dar`} className="fisca-pme__label">
                  {L('line.designationAr')}
                </label>
                <input id={`${base}-dar`} className="fisca-pme__input" type="text" lang="ar" dir="rtl" value={line.designationAr} {...mark(errors.designation)} {...describe('designation', errors.designation)} onChange={onText(line.id, 'designationAr')} />
                {showErrors && errors.designation ? (
                  <p id={`${base}-designation-err`} className="fisca-pme__error">
                    {L('errors.designation')}
                  </p>
                ) : null}
              </div>
              <div className="fisca-pme__field">
                <label htmlFor={`${base}-qty`} className="fisca-pme__label">
                  {L('line.quantity')}
                </label>
                <input id={`${base}-qty`} className="fisca-pme__input fisca-tabular-num" type="text" inputMode="decimal" dir="ltr" value={line.quantity} {...mark(errors.quantity)} {...describe('quantity', errors.quantity)} onChange={onText(line.id, 'quantity')} />
                {showErrors && errors.quantity ? (
                  <p id={`${base}-quantity-err`} className="fisca-pme__error">
                    {L('errors.quantity')}
                  </p>
                ) : null}
              </div>
              <div className="fisca-pme__field">
                <label htmlFor={`${base}-price`} className="fisca-pme__label">
                  {L('line.unitPrice')}
                </label>
                <input id={`${base}-price`} className="fisca-pme__input fisca-tabular-num" type="text" inputMode="decimal" dir="ltr" value={line.unitPrice} {...mark(errors.unitPrice)} {...describe('unitPrice', errors.unitPrice)} onChange={onText(line.id, 'unitPrice')} />
                {showErrors && errors.unitPrice ? (
                  <p id={`${base}-unitPrice-err`} className="fisca-pme__error">
                    {L('errors.unitPrice')}
                  </p>
                ) : null}
              </div>
              <div className="fisca-pme__field">
                <label htmlFor={`${base}-rate`} className="fisca-pme__label">
                  {L('line.vatRate')}
                </label>
                <select id={`${base}-rate`} className="fisca-pme__input" value={line.rate} {...mark(errors.rate)} {...describe('rate', errors.rate)} onChange={onText(line.id, 'rate')}>
                  <option value="">{L('ratePlaceholder')}</option>
                  {rates.map((r) => (
                    <option key={r.rateBps} value={String(r.rateBps)}>
                      {formatBps(r.rateBps)}
                    </option>
                  ))}
                </select>
                {showErrors && errors.rate ? (
                  <p id={`${base}-rate-err`} className="fisca-pme__error">
                    {L('errors.rate')}
                  </p>
                ) : null}
              </div>
              <div className="fisca-pme__field fisca-pme__field--total">
                <span className="fisca-pme__acct-label">{L('line.total')}</span>
                <span className="fisca-pme__acct-value">{lineTotal === null ? '–' : <FiscalAmount amountCents={lineTotal} />}</span>
              </div>
              <button
                type="button"
                className="fisca-pme__button fisca-pme__button--quiet"
                disabled={lines.length === 1}
                onClick={() => {
                  setPhase('idle');
                  setLines((current) => current.filter((l) => l.id !== line.id));
                }}
              >
                {L('removeLine').replace('{n}', String(index + 1))}
              </button>
            </fieldset>
          );
        })}
        <button
          type="button"
          className="fisca-pme__button fisca-pme__button--secondary"
          onClick={() => {
            setPhase('idle');
            const id = nextId.current;
            nextId.current += 1;
            setLines((current) => [...current, emptyLine(id)]);
          }}
        >
          {L('addLine')}
        </button>

        <div role="group" aria-labelledby={`${uid}-totals`} className="fisca-pme__totals-card">
          <h2 id={`${uid}-totals`} className="fisca-pme__h2">
            {L('totals.title')}
          </h2>
          <dl className="fisca-pme__totals">
            {(
              [
                ['totalHt', totals.totalHtCents],
                ['totalVat', totals.totalVatCents],
                ['totalTtc', totals.totalTtcCents],
              ] as const
            ).map(([k, cents]) => (
              <div key={k} className="fisca-pme__total-row">
                <dt className="fisca-pme__total-label">{L(`totals.${k}`)}</dt>
                <dd className="fisca-pme__total-value">
                  <FiscalAmount amountCents={cents} />
                </dd>
              </div>
            ))}
          </dl>
          {totals.vatByRate.length === 0 ? null : (
            <div className="fisca-pme__scroll" tabIndex={0} role="region" aria-label={L('totals.byRate')}>
            <table className="fisca-pme__table">
              <caption className="fisca-pme__caption">{L('totals.byRate')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="fisca-pme__th">
                    {L('line.vatRate')}
                  </th>
                  <th scope="col" className="fisca-pme__th fisca-pme__th--num">
                    {L('totals.baseHt')}
                  </th>
                  <th scope="col" className="fisca-pme__th fisca-pme__th--num">
                    {L('totals.totalVat')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {totals.vatByRate.map((row) => (
                  <tr key={row.rateBps}>
                    <td className="fisca-pme__td">
                      <span dir="ltr" className="fisca-tabular-num">
                        {formatBps(row.rateBps)}
                      </span>
                    </td>
                    <td className="fisca-pme__td fisca-pme__td--num">
                      <FiscalAmount amountCents={row.baseHtCents} />
                    </td>
                    <td className="fisca-pme__td fisca-pme__td--num">
                      <FiscalAmount amountCents={row.vatCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        <div className="fisca-pme__actions">
          <button type="submit" className="fisca-pme__button fisca-pme__button--primary" disabled={phase === 'saving' || ratesMissing} aria-busy={phase === 'saving'}>
            {L('saveDraft')}
          </button>
          {phase === 'saved' ? (
            <p role="status" className="fisca-pme__state">
              {L('saved')}
            </p>
          ) : null}
          {phase === 'failed' ? (
            <p role="alert" className="fisca-pme__state fisca-pme__state--error">
              {L('saveFailed')}
            </p>
          ) : null}
        </div>
      </form>

      <InvoicePreview locale={locale} invoiceDate={invoiceDate} invoiceNumber={null} issuer={issuer} customer={customer} lines={validLines} totals={totals} rates={rates} clearance="draft" />
    </div>
  );
}
