import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { directionOf } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { FiscalRuleBanners } from './FiscalRuleBanner.tsx';
import { TreasuryChart } from './TreasuryChart.tsx';
import { commonText, pmeText } from './labels.tsx';
import type { FiscalRule, FiscalRuleSource, TreasuryForecast, TreasuryForecastSource } from './ports.ts';
import './pme.css';

/** Horizon d'affichage du tableau de bord (Doc_08 Section 05) : paramètre produit, pas une règle fiscale. */
export const TREASURY_HORIZON_DAYS = 90;

export interface TreasuryDashboardProps {
  readonly locale: FiscaLocale;
  readonly source: TreasuryForecastSource;
  readonly rulesSource?: FiscalRuleSource | undefined;
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly forecast: TreasuryForecast; readonly rules: readonly FiscalRule[] };

/** Tableau de bord PME : bannières CGI contextuelles puis courbe de trésorerie et TVA à 90 jours (données par ports). */
export function TreasuryDashboard({ locale, source, rulesSource }: TreasuryDashboardProps): ReactElement {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    const rules = rulesSource === undefined ? Promise.resolve<readonly FiscalRule[]>([]) : rulesSource.loadActiveRules('treasury', controller.signal);
    Promise.all([source.loadForecast(TREASURY_HORIZON_DAYS, controller.signal), rules]).then(
      ([forecast, loadedRules]) => {
        if (!controller.signal.aborted) setState({ kind: 'ready', forecast, rules: loadedRules });
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      },
    );
    return () => controller.abort();
  }, [source, rulesSource, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <div className="fisca-pme" dir={directionOf(locale)} lang={locale}>
      <h1 className="fisca-pme__h1">{pmeText(locale, 'dashboard.title')}</h1>
      {state.kind === 'loading' ? (
        <p role="status" className="fisca-pme__state">
          {commonText(locale, 'states.loading')}
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <div role="alert" className="fisca-pme__state fisca-pme__state--error">
          <p>{commonText(locale, 'states.error')}</p>
          <button type="button" className="fisca-pme__button" onClick={retry}>
            {commonText(locale, 'actions.retry')}
          </button>
        </div>
      ) : null}
      {state.kind === 'ready' ? (
        <>
          <FiscalRuleBanners locale={locale} rules={state.rules} />
          {state.forecast.points.length === 0 ? (
            <p className="fisca-pme__state">{commonText(locale, 'states.empty')}</p>
          ) : (
            <TreasuryChart locale={locale} forecast={state.forecast} />
          )}
        </>
      ) : null}
    </div>
  );
}
