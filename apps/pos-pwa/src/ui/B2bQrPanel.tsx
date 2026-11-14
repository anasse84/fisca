import type { ReactElement } from 'react';
import type { B2bConversionState, ConversionView } from '../b2b/qr-conversion.ts';
import { QrCode } from './QrCode.tsx';

export interface B2bQrPanelLabels {
  readonly title: string;
  readonly instruction: string;
  readonly qrAlt: string;
  readonly stateLabel: string;
  readonly state: Readonly<Record<B2bConversionState, string>>;
  readonly noDoubleTax: string;
  readonly alreadyConverted: string;
  readonly link: string;
}

export interface B2bQrPanelProps {
  readonly labels: B2bQrPanelLabels;
  readonly view: ConversionView;
  /** URL de conversion (base injectée + jeton) ; affichée et encodée dans le QR seulement si la conversion est encore possible. */
  readonly url: string;
}

/** Affiche le QR et l'état local de conversion. La caisse n'appelle jamais la route de conversion : c'est le client B2B qui la déclenche. */
export function B2bQrPanel({ labels, view, url }: B2bQrPanelProps): ReactElement {
  return (
    <section className="pos-panel" aria-labelledby="pos-b2b-title">
      <h2 className="pos-panel__title" id="pos-b2b-title">
        {labels.title}
      </h2>
      <p className="pos-b2b__state" data-testid="conversion-state">
        {labels.stateLabel} : {labels.state[view.state]}
        {view.canShowQr ? null : <span> — {labels.alreadyConverted}</span>}
      </p>
      {view.canShowQr ? (
        <div className="pos-qr">
          <QrCode data={url} label={labels.qrAlt} />
          <p className="pos-empty">{labels.instruction}</p>
          <p className="pos-empty">{labels.noDoubleTax}</p>
          <p className="pos-b2b__link" data-testid="conversion-link" dir="ltr">
            <span>{labels.link} : </span>
            {url}
          </p>
        </div>
      ) : (
        <p className="pos-empty">{labels.noDoubleTax}</p>
      )}
    </section>
  );
}
