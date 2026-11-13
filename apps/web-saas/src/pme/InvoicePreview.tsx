import type { ReactElement } from 'react';
import { directionOf } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { FiscalAmount } from '@fisca/ui-mercury';
import { FiscaClearedBadge } from '../shared/status-badge.tsx';
import { amountInWordsAr, amountInWordsFr } from './amount-in-words.ts';
import { formatBps, formatScaledDecimal } from './decimal-input.ts';
import type { InvoiceTotals } from './invoice-totals.ts';
import { commonText, pmeText } from './labels.tsx';
import type { InvoiceParty, VatRateOption } from './ports.ts';
import './pme.css';

export interface PreviewLine {
  readonly designationFr: string;
  readonly designationAr: string;
  readonly quantityMilli: number;
  readonly unitPriceCents: number;
  readonly vatRateBps: number;
}

export interface InvoicePreviewProps {
  /** Langue de l'interface (titre, état, avertissement) : le gabarit lui-même reste bilingue FR / AR. */
  readonly locale: FiscaLocale;
  readonly invoiceDate: string;
  /** `null` tant que la numérotation n'est pas attribuée : aucun numéro n'est inventé. */
  readonly invoiceNumber: string | null;
  readonly issuer: InvoiceParty;
  readonly customer: InvoiceParty;
  readonly lines: readonly PreviewLine[];
  readonly totals: InvoiceTotals;
  readonly rates: readonly VatRateOption[];
  /** `cleared` n'est affiché que comme « Validation simulée » tant que seul le pilote simulé existe (B-13). */
  readonly clearance: 'draft' | 'cleared';
}

type ColLang = 'fr' | 'ar';

const DIR: Readonly<Record<ColLang, 'ltr' | 'rtl'>> = { fr: 'ltr', ar: 'rtl' };

function Bilingual({ k }: { readonly k: string }): ReactElement {
  return (
    <>
      <span lang="fr" dir="ltr">
        {pmeText('fr', k)}
      </span>
      <span lang="ar" dir="rtl">
        {pmeText('ar', k)}
      </span>
    </>
  );
}

function bilingualText(k: string): string {
  return `${pmeText('fr', k)} / ${pmeText('ar', k)}`;
}

function PartyBlock({ col, heading, party }: { readonly col: ColLang; readonly heading: string; readonly party: InvoiceParty }): ReactElement {
  const name = col === 'ar' ? (party.nameAr ?? party.nameFr) : party.nameFr;
  const nameDir = col === 'ar' && party.nameAr === null ? 'ltr' : DIR[col];
  const rows: ReadonlyArray<readonly [string, string, ReactElement | null]> = [
    ['legalForm', 'preview.legalForm', party.legalForm === null ? null : <span dir="auto">{party.legalForm}</span>],
    ['capital', 'preview.capital', party.shareCapitalCents === null ? null : <FiscalAmount amountCents={party.shareCapitalCents} />],
    ['address', 'preview.address', party.addressAdc450 === null ? null : <span dir="auto">{party.addressAdc450}</span>],
    ['ice', 'preview.ice', party.ice === null ? null : <span dir="ltr" className="fisca-tabular-num">{party.ice}</span>],
    ['if', 'preview.if', party.identifiantFiscal === null ? null : <span dir="ltr" className="fisca-tabular-num">{party.identifiantFiscal}</span>],
    [
      'rc',
      'preview.rc',
      party.rcNumber === null ? null : (
        <span dir="ltr" className="fisca-tabular-num">
          {party.rcNumber}
          {party.rcTribunal === null ? '' : ` — ${party.rcTribunal}`}
        </span>
      ),
    ],
  ];
  return (
    <div className="fisca-pme__party">
      <h4 className="fisca-pme__party-title">{heading}</h4>
      <p className="fisca-pme__party-name" dir={nameDir}>
        {name}
      </p>
      <dl className="fisca-pme__dl">
        {rows.map(([field, key, value]) =>
          value === null ? null : (
            <div key={field} data-field={field} data-col={col} className="fisca-pme__dl-row">
              <dt className="fisca-pme__acct-label">{pmeText(col, key)}</dt>
              <dd className="fisca-pme__acct-value">{value}</dd>
            </div>
          ),
        )}
      </dl>
    </div>
  );
}

/** Aperçu au gabarit de la Section 09 : colonnes FR (LTR) et AR (RTL), tableau bilingue, ventilation par taux, double arrêté. */
export function InvoicePreview({ locale, invoiceDate, invoiceNumber, issuer, customer, lines, totals, rates, clearance }: InvoicePreviewProps): ReactElement {
  const reasonByRate = new Map(rates.map((r) => [r.rateBps, r.legalReasonCode]));
  return (
    <section className="fisca-pme__preview" dir={directionOf(locale)} lang={locale} aria-labelledby="fisca-pme-preview-title">
      <h2 id="fisca-pme-preview-title" className="fisca-pme__h2">
        {pmeText(locale, 'preview.title')}
      </h2>
      <div className="fisca-pme__guard">
        {clearance === 'cleared' ? (
          <FiscaClearedBadge locale={locale} />
        ) : (
          <span data-status="draft" className="fisca-pme__badge">
            {commonText(locale, 'states.draft')}
          </span>
        )}
        <p className="fisca-pme__notice">{commonText(locale, 'notice.simulated')}</p>
      </div>

      <div data-testid="invoice-sheet" dir="ltr" className="fisca-pme__sheet">
        <div className="fisca-pme__sheet-head">
          {(['fr', 'ar'] as const).map((col) => (
            <div key={col} data-col={col} dir={DIR[col]} lang={col} className="fisca-pme__col">
              <h3 className="fisca-pme__sheet-title">{pmeText(col, 'preview.invoice')}</h3>
              <p className="fisca-pme__acct-line">
                {pmeText(col, 'preview.number')} :{' '}
                {invoiceNumber === null ? (
                  <span>{pmeText(col, 'preview.numberPending')}</span>
                ) : (
                  <span dir="ltr" className="fisca-tabular-num">
                    {invoiceNumber}
                  </span>
                )}
              </p>
              <p className="fisca-pme__acct-line">
                {pmeText(col, 'preview.date')} :{' '}
                <time dir="ltr" dateTime={invoiceDate} className="fisca-tabular-num">
                  {invoiceDate}
                </time>
              </p>
              <PartyBlock col={col} heading={pmeText(col, 'preview.seller')} party={issuer} />
              <PartyBlock col={col} heading={pmeText(col, 'preview.customer')} party={customer} />
            </div>
          ))}
        </div>

        <div className="fisca-pme__scroll" tabIndex={0} role="region" aria-label={bilingualText('preview.designation')}>
        <table className="fisca-pme__table fisca-pme__table--lines">
          <thead>
            <tr>
              {(['designation', 'quantity', 'unitPrice', 'vatRate', 'lineTotal'] as const).map((k) => (
                <th key={k} scope="col" className={k === 'designation' ? 'fisca-pme__th' : 'fisca-pme__th fisca-pme__th--num'}>
                  <Bilingual k={`preview.${k}`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const total = totals.lines[index];
              return (
                <tr key={index}>
                  <td className="fisca-pme__td">
                    {line.designationFr === '' ? null : (
                      <div lang="fr" dir="ltr">
                        {line.designationFr}
                      </div>
                    )}
                    {line.designationAr === '' ? null : (
                      <div lang="ar" dir="rtl">
                        {line.designationAr}
                      </div>
                    )}
                  </td>
                  <td className="fisca-pme__td fisca-pme__td--num">
                    <span dir="ltr" className="fisca-tabular-num">
                      {formatScaledDecimal(BigInt(line.quantityMilli), 3)}
                    </span>
                  </td>
                  <td className="fisca-pme__td fisca-pme__td--num">
                    <FiscalAmount amountCents={line.unitPriceCents} />
                  </td>
                  <td className="fisca-pme__td fisca-pme__td--num">
                    <span dir="ltr" className="fisca-tabular-num">
                      {formatBps(line.vatRateBps)}
                    </span>
                  </td>
                  <td className="fisca-pme__td fisca-pme__td--num">
                    {total === undefined ? null : <FiscalAmount amountCents={total.lineHtCents} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        </div>

        <div className="fisca-pme__scroll" tabIndex={0} role="region" aria-label={bilingualText('preview.baseHt')}>
        <table className="fisca-pme__table fisca-pme__table--rates">
          <thead>
            <tr>
              <th scope="col" className="fisca-pme__th">
                <Bilingual k="preview.vatRate" />
              </th>
              <th scope="col" className="fisca-pme__th fisca-pme__th--num">
                <Bilingual k="preview.baseHt" />
              </th>
              <th scope="col" className="fisca-pme__th fisca-pme__th--num">
                <Bilingual k="preview.vat" />
              </th>
              <th scope="col" className="fisca-pme__th">
                <Bilingual k="preview.legalReason" />
              </th>
            </tr>
          </thead>
          <tbody>
            {totals.vatByRate.map((row) => {
              const reason = reasonByRate.get(row.rateBps) ?? null;
              return (
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
                  <td className="fisca-pme__td">
                    {reason === null ? null : (
                      <span dir="ltr" className="fisca-tabular-num">
                        {reason}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        <dl className="fisca-pme__totals">
          {(
            [
              ['totalHt', totals.totalHtCents],
              ['totalVat', totals.totalVatCents],
              ['totalTtc', totals.totalTtcCents],
            ] as const
          ).map(([k, cents]) => (
            <div key={k} className="fisca-pme__total-row">
              <dt className="fisca-pme__total-label">
                <Bilingual k={`preview.${k}`} />
              </dt>
              <dd className="fisca-pme__total-value">
                <FiscalAmount amountCents={cents} />
              </dd>
            </div>
          ))}
        </dl>

        <p data-testid="arrete-fr" lang="fr" dir="ltr" className="fisca-pme__acct-line fisca-pme__arrete">
          {pmeText('fr', 'preview.arrete')} {amountInWordsFr(totals.totalTtcCents)}
        </p>
        <p data-testid="arrete-ar" lang="ar" dir="rtl" className="fisca-pme__acct-line fisca-pme__arrete">
          {pmeText('ar', 'preview.arrete')} {amountInWordsAr(totals.totalTtcCents)}
        </p>
      </div>
    </section>
  );
}
