import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { directionOf } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { FiscalAmount, formatCentimesMad } from '@fisca/ui-mercury';
import { fillTemplate, pmeText, renderTemplate } from './labels.tsx';
import type { TreasuryForecast, TreasuryPoint } from './ports.ts';
import { buildChartGeometry, summarizeForecast } from './treasury-chart-model.ts';
import './pme.css';

export interface TreasuryChartProps {
  readonly locale: FiscaLocale;
  readonly forecast: TreasuryForecast;
}

const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 280;
const MAX_WIDTH = 1200;
const PADDING = 24;

/** Largeur du conteneur (borne 280–960), lue au rendu et à chaque redimensionnement ; sans ResizeObserver, valeur par défaut. */
function useContainerWidth(): readonly [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const read = (): void => {
      const measured = Math.floor(element.getBoundingClientRect().width);
      if (measured > 0) setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, measured)));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function nullableAmount(value: number | null, noValue: string): ReactNode {
  return value === null ? <span>{noValue}</span> : <FiscalAmount amountCents={value} />;
}

function readoutPlain(locale: FiscaLocale, point: TreasuryPoint): string {
  const noValue = pmeText(locale, 'chart.noValue');
  const fmt = (v: number | null): string => (v === null ? noValue : formatCentimesMad(v));
  return fillTemplate(pmeText(locale, 'chart.cursorReadout'), {
    date: point.date,
    settled: fmt(point.settledCents),
    forecast: fmt(point.forecastCents),
    vat: fmt(point.vatProvisionCents),
  });
}

/** Courbe de trésorerie et TVA : SVG maison (trait plein = lettré, pointillés = prévision), curseur clavier et tableau alternatif. */
export function TreasuryChart({ locale, forecast }: TreasuryChartProps): ReactElement {
  const titleId = useId();
  const descId = useId();
  const sliderId = useId();
  const [containerRef, width] = useContainerWidth();
  const points = forecast.points;
  const lastIndex = Math.max(0, points.length - 1);
  const asOfIndex = points.findIndex((p) => p.date === forecast.asOfDate);
  const [cursor, setCursor] = useState(asOfIndex >= 0 ? asOfIndex : lastIndex);
  const height = width < 480 ? 220 : 260;
  const geometry = buildChartGeometry(points, { width, height, padding: PADDING });
  const summary = summarizeForecast(points);
  const current = points[Math.min(cursor, lastIndex)];
  const noValue = pmeText(locale, 'chart.noValue');
  const description =
    summary === null
      ? ''
      : fillTemplate(pmeText(locale, 'chart.summary'), {
          from: summary.from,
          to: summary.to,
          min: formatCentimesMad(summary.minCents),
          minDate: summary.minDate,
          max: formatCentimesMad(summary.maxCents),
          maxDate: summary.maxDate,
        });
  const cursorX = geometry.xs[Math.min(cursor, lastIndex)] ?? PADDING;
  const dueMarks = forecast.vatDue
    .map((due) => ({ due, index: points.findIndex((p) => p.date === due.dueDate) }))
    .filter((m) => m.index >= 0);

  return (
    <section className="fisca-pme__chart" dir={directionOf(locale)} lang={locale} aria-labelledby={`${titleId}-h`}>
      <h2 id={`${titleId}-h`} className="fisca-pme__h2">
        {pmeText(locale, 'chart.title')}
      </h2>
      <p className="fisca-pme__meta">
        {renderTemplate(pmeText(locale, 'chart.asOf'), {
          date: (
            <time dir="ltr" dateTime={forecast.asOfDate} className="fisca-tabular-num">
              {forecast.asOfDate}
            </time>
          ),
        })}
      </p>
      <ul className="fisca-pme__legend">
        <li>
          <svg width="32" height="12" aria-hidden="true" focusable="false">
            <line x1="1" y1="6" x2="31" y2="6" className="fisca-pme__stroke-settled" />
          </svg>
          <span className="fisca-pme__legend-label">{pmeText(locale, 'chart.settledLegend')}</span>
        </li>
        <li>
          <svg width="32" height="12" aria-hidden="true" focusable="false">
            <line x1="1" y1="6" x2="31" y2="6" className="fisca-pme__stroke-forecast" strokeDasharray="6 4" />
          </svg>
          <span className="fisca-pme__legend-label">{pmeText(locale, 'chart.forecastLegend')}</span>
        </li>
        <li>
          <svg width="32" height="12" aria-hidden="true" focusable="false">
            <line x1="1" y1="6" x2="31" y2="6" className="fisca-pme__stroke-vat" strokeDasharray="2 4" />
          </svg>
          <span className="fisca-pme__legend-label">{pmeText(locale, 'chart.vatLegend')}</span>
        </li>
      </ul>

      <div ref={containerRef} dir="ltr" className="fisca-pme__plot">
        <svg role="img" aria-labelledby={`${titleId} ${descId}`} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="fisca-pme__svg">
          <title id={titleId}>{pmeText(locale, 'chart.title')}</title>
          <desc id={descId}>{description}</desc>
          {geometry.ticks.map((tick) => (
            <g key={tick.y}>
              <line x1={PADDING} x2={width - PADDING} y1={tick.y} y2={tick.y} className="fisca-pme__grid" />
              <text x={PADDING} y={tick.y - 4} className="fisca-pme__tick fisca-tabular-num">
                {formatCentimesMad(tick.valueCents)}
              </text>
            </g>
          ))}
          <line x1={PADDING} x2={width - PADDING} y1={geometry.zeroY} y2={geometry.zeroY} className="fisca-pme__zero" />
          {dueMarks.map(({ due, index }) => (
            <g key={due.dueDate} data-testid="vat-due-mark">
              <line x1={geometry.xs[index] ?? 0} x2={geometry.xs[index] ?? 0} y1={PADDING} y2={height - PADDING} className="fisca-pme__due" />
              <path d={`M${geometry.xs[index] ?? 0} ${PADDING - 8}l6 6l-6 6l-6 -6z`} className="fisca-pme__due-mark" />
            </g>
          ))}
          <path d={geometry.vatPath} data-series="vat" className="fisca-pme__stroke-vat" strokeDasharray="2 4" fill="none" />
          <path d={geometry.forecastPath} data-series="forecast" className="fisca-pme__stroke-forecast" strokeDasharray="6 4" fill="none" />
          <path d={geometry.settledPath} data-series="settled" className="fisca-pme__stroke-settled" fill="none" />
          {current === undefined ? null : (
            <g>
              <line x1={cursorX} x2={cursorX} y1={PADDING} y2={height - PADDING} className="fisca-pme__cursor" />
              {[current.settledCents, current.forecastCents, current.vatProvisionCents].map((v, i) =>
                v === null ? null : <circle key={i} cx={cursorX} cy={geometry.yOf(v)} r="4" className="fisca-pme__dot" />,
              )}
            </g>
          )}
          <text x={PADDING} y={height - 6} className="fisca-pme__tick fisca-tabular-num">
            {points[0]?.date ?? ''}
          </text>
          <text x={width - PADDING} y={height - 6} textAnchor="end" className="fisca-pme__tick fisca-tabular-num">
            {points[lastIndex]?.date ?? ''}
          </text>
        </svg>
      </div>

      <div className="fisca-pme__cursor-row">
        <label htmlFor={sliderId} className="fisca-pme__label">
          {pmeText(locale, 'chart.cursorLabel')}
        </label>
        <input
          id={sliderId}
          type="range"
          dir="ltr"
          min={0}
          max={lastIndex}
          step={1}
          value={Math.min(cursor, lastIndex)}
          onChange={(event) => setCursor(Number(event.currentTarget.value))}
          aria-valuetext={current === undefined ? '' : readoutPlain(locale, current)}
          className="fisca-pme__range"
        />
      </div>
      <p data-testid="chart-readout" aria-live="polite" className="fisca-pme__readout">
        {current === undefined
          ? null
          : renderTemplate(pmeText(locale, 'chart.cursorReadout'), {
              date: (
                <time dir="ltr" dateTime={current.date} className="fisca-tabular-num">
                  {current.date}
                </time>
              ),
              settled: nullableAmount(current.settledCents, noValue),
              forecast: nullableAmount(current.forecastCents, noValue),
              vat: nullableAmount(current.vatProvisionCents, noValue),
            })}
      </p>

      {forecast.vatDue.length === 0 ? null : (
        <div className="fisca-pme__due-block">
          <h3 id={`${titleId}-due`} className="fisca-pme__h3">
            {pmeText(locale, 'vatDue.title')}
          </h3>
          <ul aria-labelledby={`${titleId}-due`} className="fisca-pme__due-list">
            {forecast.vatDue.map((due) => (
              <li key={due.dueDate}>
                <time dir="ltr" dateTime={due.dueDate} className="fisca-tabular-num">
                  {due.dueDate}
                </time>
                <FiscalAmount amountCents={due.amountCents} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="fisca-pme__details">
        <summary className="fisca-pme__summary">{pmeText(locale, 'chart.table.summary')}</summary>
        <div className="fisca-pme__scroll" tabIndex={0} role="region" aria-label={pmeText(locale, 'chart.table.caption')}>
          <table className="fisca-pme__table">
            <caption className="fisca-pme__caption">{pmeText(locale, 'chart.table.caption')}</caption>
            <thead>
              <tr>
                <th scope="col" className="fisca-pme__th">
                  {pmeText(locale, 'chart.table.date')}
                </th>
                <th scope="col" className="fisca-pme__th fisca-pme__th--num">
                  {pmeText(locale, 'chart.table.settled')}
                </th>
                <th scope="col" className="fisca-pme__th fisca-pme__th--num">
                  {pmeText(locale, 'chart.table.forecast')}
                </th>
                <th scope="col" className="fisca-pme__th fisca-pme__th--num">
                  {pmeText(locale, 'chart.table.vat')}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <th scope="row" className="fisca-pme__td fisca-pme__td--date">
                    <time dir="ltr" dateTime={p.date} className="fisca-tabular-num">
                      {p.date}
                    </time>
                  </th>
                  {[p.settledCents, p.forecastCents, p.vatProvisionCents].map((v, i) => (
                    <td key={i} className="fisca-pme__td fisca-pme__td--num">
                      {v === null ? (
                        <>
                          <span aria-hidden="true">–</span>
                          <span className="fisca-pme__sr">{noValue}</span>
                        </>
                      ) : (
                        <FiscalAmount amountCents={v} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
