import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { directionOf } from '@fisca/i18n';
import type { FiscaLocale } from '@fisca/i18n';
import { InvoiceEditor } from './InvoiceEditor.tsx';
import { commonText, pmeText } from './labels.tsx';
import type { FiscalRule, FiscalRuleSource, InvoiceDraftSink, InvoiceParty, IssuerProfileSource, VatRateCatalogSource, VatRateOption } from './ports.ts';
import './pme.css';

export interface PmeInvoiceScreenProps {
  readonly locale: FiscaLocale;
  readonly invoiceDate: string;
  readonly ratesSource: VatRateCatalogSource;
  readonly issuerSource: IssuerProfileSource;
  readonly rulesSource?: FiscalRuleSource | undefined;
  readonly sink: InvoiceDraftSink;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly rates: readonly VatRateOption[]; readonly issuer: InvoiceParty; readonly rules: readonly FiscalRule[] };

/** Écran « Nouvelle facture » : charge taux, émetteur et règles par les ports, puis monte l'éditeur. */
export function PmeInvoiceScreen({ locale, invoiceDate, ratesSource, issuerSource, rulesSource, sink }: PmeInvoiceScreenProps): ReactElement {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    const rules = rulesSource === undefined ? Promise.resolve<readonly FiscalRule[]>([]) : rulesSource.loadActiveRules('invoice', controller.signal);
    Promise.all([ratesSource.loadRates(invoiceDate, controller.signal), issuerSource.loadIssuer(controller.signal), rules]).then(
      ([rates, issuer, loadedRules]) => {
        if (!controller.signal.aborted) setState({ kind: 'ready', rates, issuer, rules: loadedRules });
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      },
    );
    return () => controller.abort();
  }, [ratesSource, issuerSource, rulesSource, invoiceDate, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state.kind === 'ready') {
    return <InvoiceEditor locale={locale} invoiceDate={invoiceDate} rates={state.rates} issuer={state.issuer} sink={sink} rules={state.rules} />;
  }
  return (
    <div className="fisca-pme" dir={directionOf(locale)} lang={locale}>
      <h1 className="fisca-pme__h1">{pmeText(locale, 'invoice.title')}</h1>
      {state.kind === 'loading' ? (
        <p role="status" className="fisca-pme__state">
          {commonText(locale, 'states.loading')}
        </p>
      ) : (
        <div role="alert" className="fisca-pme__state fisca-pme__state--error">
          <p>{commonText(locale, 'states.error')}</p>
          <button type="button" className="fisca-pme__button" onClick={retry}>
            {commonText(locale, 'actions.retry')}
          </button>
        </div>
      )}
    </div>
  );
}
