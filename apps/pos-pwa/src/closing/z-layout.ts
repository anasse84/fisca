import { formatCentimesMad } from '@fisca/ui-mercury';
import { formatBps } from '../sale/format.ts';
import { shortFingerprint } from '../printing/receipt-layout.ts';
import type { ReceiptElement } from '../printing/receipt-layout.ts';

/**
 * Ticket Z imprimé : même document pour l'aperçu écran et les octets ESC/POS (rendu par `renderReceiptEscPos`).
 * Jamais d'espèces attendues ni d'écart de caisse sur le Ticket Z (comptage aveugle) : seules les ventes par taux, le timbre,
 * le TPE brut et les empreintes y figurent. Libellés injectés (dictionnaires @fisca/i18n).
 */

export interface ZLabelSet {
  readonly title: string;
  readonly closureNumber: (number: string) => string;
  readonly businessDate: string;
  readonly ticketCount: (count: string) => string;
  readonly ht: (rate: string) => string;
  readonly vat: (rate: string) => string;
  readonly stamp: string;
  readonly tpeGross: string;
  readonly hash: string;
  readonly prevHash: string;
  readonly thanks: string;
}

export interface ZRateLine {
  readonly vatRateBps: number;
  readonly htCents: number;
  readonly vatCents: number;
}

export interface ZTicketData {
  readonly terminalId: string;
  readonly closureNumber: number;
  readonly businessDate: string;
  readonly ticketCount: number;
  readonly rates: readonly ZRateLine[];
  readonly stampDutyCents: number;
  readonly tpeGrossCents: number;
  /** Absents avant le scellement (aperçu). */
  readonly zSha256: string | null;
  readonly prevZSha256: string | null;
}

export interface ZLayoutOptions {
  readonly columns: number;
  readonly labels: ZLabelSet;
  readonly secondaryLabels?: ZLabelSet;
}

const text = (value: string, align: 'left' | 'center' | 'right' = 'left', bold = false, large = false): ReceiptElement => ({ kind: 'text', text: value, align, bold, large });

function columns(left: string, right: string, width: number, bold = false): ReceiptElement {
  const room = Math.max(0, width - right.length - 1);
  return { kind: 'columns', left: left.length > room ? left.slice(0, room) : left, right, bold };
}

export function layoutZTicket(data: ZTicketData, options: ZLayoutOptions): readonly ReceiptElement[] {
  const { labels, secondaryLabels, columns: width } = options;
  const out: ReceiptElement[] = [];
  const secondary = (pick: (set: ZLabelSet) => string): void => {
    if (secondaryLabels !== undefined) out.push(text(pick(secondaryLabels), 'right'));
  };
  const money = (cents: number): string => formatCentimesMad(cents);

  out.push(text(labels.title, 'center', true, true));
  secondary((s) => s.title);
  out.push(text(data.terminalId, 'center'));
  out.push(text(labels.closureNumber(String(data.closureNumber)), 'left', true));
  secondary((s) => s.closureNumber(String(data.closureNumber)));
  out.push(text(`${labels.businessDate} ${data.businessDate}`, 'left'));
  out.push(text(labels.ticketCount(String(data.ticketCount)), 'left'));
  out.push({ kind: 'separator' });
  for (const rate of data.rates) {
    const label = formatBps(rate.vatRateBps);
    out.push(columns(labels.ht(label), money(rate.htCents), width));
    secondary((s) => s.ht(label));
    out.push(columns(labels.vat(label), money(rate.vatCents), width));
    secondary((s) => s.vat(label));
  }
  out.push({ kind: 'separator' });
  out.push(columns(labels.stamp, money(data.stampDutyCents), width));
  secondary((s) => s.stamp);
  out.push(columns(labels.tpeGross, money(data.tpeGrossCents), width, true));
  secondary((s) => s.tpeGross);
  if (data.zSha256 !== null) {
    out.push({ kind: 'separator' });
    out.push(text(`${labels.hash} ${shortFingerprint(data.zSha256)}`, 'left'));
    if (data.prevZSha256 !== null) out.push(text(`${labels.prevHash} ${shortFingerprint(data.prevZSha256)}`, 'left'));
  }
  out.push(text(labels.thanks, 'center', true));
  secondary((s) => s.thanks);
  out.push({ kind: 'feed', lines: 3 });
  return out;
}
