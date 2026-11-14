import type { CSSProperties, ReactElement } from 'react';
import type { ReceiptElement } from '../printing/receipt-layout.ts';
import { QrCode } from './QrCode.tsx';

export interface PaperDocumentProps {
  readonly document: readonly ReceiptElement[];
  readonly columns: number;
  readonly qrAlt: string;
  readonly testId: string;
}

const isArabicLine = (text: string): boolean => /[\u0600-\u06FF]/u.test(text);

/** Alignement logique : `right` du ticket devient `start` dans une ligne RTL et `end` dans une ligne LTR. */
function alignOf(align: 'left' | 'center' | 'right', rtl: boolean): 'start' | 'center' | 'end' {
  if (align === 'center') return 'center';
  return (align === 'right') === rtl ? 'start' : 'end';
}

/** Papier imprimable à l'écran : même document que celui qui produit les octets ESC/POS (ticket de vente, Ticket Z). */
export function PaperDocument({ document: doc, columns, qrAlt, testId }: PaperDocumentProps): ReactElement {
  const style = { '--cols': String(columns) } as CSSProperties;
  return (
      <div className="pos-paper" dir="ltr" data-testid={testId} data-columns={columns} style={style}>
        {doc.map((el, index) => {
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
                  <QrCode data={el.data} label={qrAlt} />
                </div>
              );
            case 'feed':
              return null;
          }
        })}
      </div>
  );
}
