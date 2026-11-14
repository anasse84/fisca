import type { ReactElement } from 'react';
import type { ReceiptElement } from '../printing/receipt-layout.ts';
import { PaperDocument } from './PaperDocument.tsx';

export interface ZTicketPreviewLabels {
  readonly preview: string;
  readonly seal: string;
  readonly sealing: string;
  readonly sealed: string;
  readonly print: string;
  readonly printed: string;
  readonly noSale: string;
  readonly errorText: string | null;
  readonly printErrorText: string | null;
  readonly retry: string;
  readonly qrAlt: string;
  readonly hash: string;
}

export interface ZTicketPreviewProps {
  readonly labels: ZTicketPreviewLabels;
  readonly document: readonly ReceiptElement[];
  readonly columns: number;
  readonly isSealed: boolean;
  /** Début de l'empreinte Z (scellée) ; `null` avant scellement. */
  readonly fingerprint: string | null;
  readonly busy: boolean;
  readonly canPrint: boolean;
  readonly printedNotice: boolean;
  readonly onSeal: () => void;
  readonly onPrint: () => void;
}

/** Aperçu du Ticket Z (même document que l'impression), scellement unique, impression via la file d'impression. */
export function ZTicketPreview(props: ZTicketPreviewProps): ReactElement {
  const { labels } = props;
  return (
    <section className="pos-panel" aria-labelledby="pos-z-title" data-testid="z-preview" data-sealed={props.isSealed}>
      <h2 className="pos-panel__title" id="pos-z-title">
        {labels.preview}
      </h2>
      <PaperDocument document={props.document} columns={props.columns} qrAlt={labels.qrAlt} testId="z-paper" />
      <div className="pos-actions pos-actions--spaced">
        {props.isSealed ? (
          <button type="button" className="pos-action pos-action--primary" data-testid="z-print" disabled={!props.canPrint || props.busy} onClick={props.onPrint}>
            {labels.print}
          </button>
        ) : (
          <button type="button" className="pos-action pos-action--primary" data-testid="z-seal" disabled={props.busy} onClick={props.onSeal}>
            {props.busy ? labels.sealing : labels.seal}
          </button>
        )}
      </div>
      {props.isSealed ? (
        <p className="pos-status" role="status" data-testid="z-sealed">
          <span aria-hidden="true">✓ </span>
          {labels.sealed}
        </p>
      ) : null}
      {props.fingerprint === null ? null : (
        <p className="pos-status">
          <span>{labels.hash}</span> <span dir="ltr" className="pos-amount" data-testid="z-hash">{props.fingerprint}</span>
        </p>
      )}
      {props.isSealed ? <p className="pos-status">{labels.noSale}</p> : null}
      {props.printedNotice ? <p className="pos-status" role="status" data-testid="z-printed">{labels.printed}</p> : null}
      {labels.errorText === null ? null : (
        <p className="pos-alert" role="alert" data-testid="z-error">
          {labels.errorText}
        </p>
      )}
      {labels.printErrorText === null ? null : (
        <p className="pos-alert" role="alert" data-testid="z-print-error">
          {labels.printErrorText}{' '}
          <button type="button" className="pos-action" onClick={props.onPrint}>
            {labels.retry}
          </button>
        </p>
      )}
    </section>
  );
}
