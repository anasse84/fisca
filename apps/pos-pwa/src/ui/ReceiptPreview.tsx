import type { ReactElement } from 'react';
import type { ReceiptElement } from '../printing/receipt-layout.ts';
import { PaperDocument } from './PaperDocument.tsx';
import type { PaperWidthMm } from '../printing/escpos.ts';

export interface ReceiptPreviewLabels {
  readonly preview: string;
  readonly action: string;
  readonly drawer: string;
  readonly width: string;
  readonly width58: string;
  readonly width80: string;
  readonly queue: (count: number) => string;
  readonly printed: string;
  readonly qrAlt: string;
  readonly errorText: string | null;
  readonly retry: string;
}

export interface ReceiptPreviewProps {
  readonly labels: ReceiptPreviewLabels;
  readonly document: readonly ReceiptElement[];
  readonly columns: number;
  readonly widthMm: PaperWidthMm;
  readonly pendingJobs: number;
  readonly printedNotice: boolean;
  readonly canPrint: boolean;
  readonly onWidth: (width: PaperWidthMm) => void;
  readonly onPrint: () => void;
  readonly onDrawer: () => void;
  readonly onRetry: () => void;
}

/** Aperçu fidèle du ticket : même document que celui qui produit les octets ESC/POS. */
export function ReceiptPreview(props: ReceiptPreviewProps): ReactElement {
  const { labels, columns } = props;
  return (
    <section className="pos-panel" aria-labelledby="pos-preview-title">
      <h2 className="pos-panel__title" id="pos-preview-title">
        {labels.preview}
      </h2>
      <div className="pos-group" role="group" aria-label={labels.width}>
        <span className="pos-group__label">{labels.width}</span>
        <button type="button" aria-pressed={props.widthMm === 58} onClick={() => props.onWidth(58)} data-testid="width-58">
          {labels.width58}
        </button>
        <button type="button" aria-pressed={props.widthMm === 80} onClick={() => props.onWidth(80)} data-testid="width-80">
          {labels.width80}
        </button>
      </div>
      <PaperDocument document={props.document} columns={columns} qrAlt={labels.qrAlt} testId="receipt-preview" />
      <div className="pos-actions pos-actions--spaced">
        <button type="button" className="pos-action pos-action--primary" data-testid="print-button" disabled={!props.canPrint} onClick={props.onPrint}>
          {labels.action}
        </button>
        <button type="button" className="pos-action" data-testid="drawer-button" disabled={!props.canPrint} onClick={props.onDrawer}>
          {labels.drawer}
        </button>
      </div>
      {props.pendingJobs > 0 ? <p className="pos-status" data-testid="print-queue">{labels.queue(props.pendingJobs)}</p> : null}
      {props.printedNotice ? <p className="pos-status" role="status" data-testid="print-ok">{labels.printed}</p> : null}
      {labels.errorText === null ? null : (
        <p className="pos-alert" role="alert" data-testid="print-error">
          {labels.errorText}{' '}
          <button type="button" className="pos-action" onClick={props.onRetry}>
            {labels.retry}
          </button>
        </p>
      )}
    </section>
  );
}
