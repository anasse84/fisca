import type { CSSProperties, ReactElement } from 'react';
import type { ReceiptElement } from '../printing/receipt-layout.ts';
import { QrCode } from './QrCode.tsx';
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

const isArabicLine = (text: string): boolean => /[\u0600-\u06FF]/u.test(text);

/** Alignement logique : `right` du ticket devient `start` dans une ligne RTL et `end` dans une ligne LTR. */
function alignOf(align: 'left' | 'center' | 'right', rtl: boolean): 'start' | 'center' | 'end' {
  if (align === 'center') return 'center';
  return (align === 'right') === rtl ? 'start' : 'end';
}

/** Aperçu fidèle du ticket : même document que celui qui produit les octets ESC/POS. */
export function ReceiptPreview(props: ReceiptPreviewProps): ReactElement {
  const { labels, columns } = props;
  const style = { '--cols': String(columns) } as CSSProperties;
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
      <div className="pos-paper" dir="ltr" data-testid="receipt-preview" data-columns={columns} style={style}>
        {props.document.map((el, index) => {
          const key = `${el.kind}-${String(index)}`;
          switch (el.kind) {
            case 'text': {
              const rtl = isArabicLine(el.text);
              return (
                <div
                  key={key}
                  className={`pos-paper__text${el.bold ? ' pos-paper__row--bold' : ''}`}
                  dir={rtl ? 'rtl' : 'ltr'}
                  style={{ textAlign: alignOf(el.align, rtl), fontSize: el.large ? '1.25em' : undefined }}
                >
                  {el.text}
                </div>
              );
            }
            case 'columns':
              return (
                <div key={key} className={`pos-paper__row${el.bold ? ' pos-paper__row--bold' : ''}`}>
                  <span>{el.left}</span>
                  <span dir="ltr">{el.right}</span>
                </div>
              );
            case 'separator':
              return <hr key={key} className="pos-paper__sep" />;
            case 'qr':
              return (
                <div key={key} className="pos-qr">
                  <QrCode data={el.data} label={labels.qrAlt} />
                </div>
              );
            case 'feed':
              return null;
          }
        })}
      </div>
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
