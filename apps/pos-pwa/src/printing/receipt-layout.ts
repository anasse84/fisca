import { formatCentimesMad } from '@fisca/ui-mercury';
import { formatBps, formatMilli } from '../sale/format.ts';
import { EscPosBuilder, columnsForWidth } from './escpos.ts';
import type { PrinterProfile } from './escpos.ts';

/**
 * Ticket imprimé : un document intermédiaire (liste d'éléments) alimente à la fois l'aperçu écran et les octets ESC/POS,
 * donc l'écran montre exactement ce qui sort de l'imprimante. Aucun libellé ici : les jeux de libellés sont injectés
 * (dictionnaires @fisca/i18n). Bilingue FR/AR : le jeu secondaire ajoute une ligne alignée à droite sous le libellé.
 */

export interface ReceiptLabelSet {
  readonly title: string;
  readonly number: string;
  readonly date: string;
  readonly totalHt: string;
  readonly vat: (rate: string) => string;
  readonly totalTtc: string;
  readonly stamp: string;
  readonly cash: string;
  readonly card: string;
  readonly delivery: string;
  readonly change: string;
  readonly hash: string;
  readonly qrCaption: string;
  readonly thanks: string;
}

export interface ReceiptLine {
  readonly name: string;
  readonly quantityMilli: number;
  readonly lineTotalTtcCents: number;
}

export interface ReceiptVatLine {
  readonly vatRateBps: number;
  readonly htCents: number;
  readonly vatCents: number;
}

export interface ReceiptData {
  readonly ticketNumber: string;
  readonly issuedAtIso: string;
  readonly lines: readonly ReceiptLine[];
  readonly vat: readonly ReceiptVatLine[];
  readonly stampDutyCents: number;
  readonly totalTtcCents: number;
  readonly paidCashCents: number;
  readonly paidCardTpeCents: number;
  readonly paidDeliveryAppCents: number;
  readonly changeCents: number;
  readonly ticketSha256: string;
  /** Contenu du QR de conversion B2B (URL construite sur la base injectée) ; `null` si le ticket est déjà converti. */
  readonly qrPayload: string | null;
  /** Lignes d'en-tête (raison sociale, adresse…) : données de la société, fournies par l'appelant. */
  readonly headerLines?: readonly string[];
}

export type ReceiptElement =
  | { readonly kind: 'text'; readonly text: string; readonly align: 'left' | 'center' | 'right'; readonly bold: boolean; readonly large: boolean }
  | { readonly kind: 'columns'; readonly left: string; readonly right: string; readonly bold: boolean }
  | { readonly kind: 'separator' }
  | { readonly kind: 'qr'; readonly data: string }
  | { readonly kind: 'feed'; readonly lines: number };

export interface ReceiptLayoutOptions {
  readonly columns: number;
  readonly labels: ReceiptLabelSet;
  readonly secondaryLabels?: ReceiptLabelSet;
  /** Imprime la légende du QR (inutile quand aucun QR n'est proposé). */
  readonly conversionCaption: boolean;
}

export const FINGERPRINT_LENGTH = 16;

export function shortFingerprint(sha256Hex: string): string {
  return sha256Hex.slice(0, FINGERPRINT_LENGTH);
}

const text = (value: string, align: 'left' | 'center' | 'right' = 'left', bold = false, large = false): ReceiptElement => ({ kind: 'text', text: value, align, bold, large });

/** Texte à gauche tronqué pour que « gauche + espace + droite » tienne dans la largeur ; le montant n'est jamais coupé. */
function columns(left: string, right: string, width: number, bold = false): ReceiptElement {
  const room = Math.max(0, width - right.length - 1);
  const clipped = left.length > room ? left.slice(0, room) : left;
  return { kind: 'columns', left: clipped, right, bold };
}

export function layoutReceipt(data: ReceiptData, options: ReceiptLayoutOptions): readonly ReceiptElement[] {
  const { labels, secondaryLabels, columns: width } = options;
  const out: ReceiptElement[] = [];
  const secondary = (pick: (set: ReceiptLabelSet) => string): void => {
    if (secondaryLabels !== undefined) out.push(text(pick(secondaryLabels), 'right'));
  };
  const money = (cents: number): string => formatCentimesMad(cents);

  for (const header of data.headerLines ?? []) out.push(text(header, 'center', true));
  out.push(text(labels.title, 'center', true, true));
  secondary((s) => s.title);
  out.push(text(`${labels.number} ${data.ticketNumber}`, 'left'));
  secondary((s) => s.number);
  out.push(text(`${labels.date} ${data.issuedAtIso.slice(0, 16).replace('T', ' ')}`, 'left'));
  out.push({ kind: 'separator' });
  for (const line of data.lines) out.push(columns(`${formatMilli(line.quantityMilli)} x ${line.name}`, money(line.lineTotalTtcCents), width));
  out.push({ kind: 'separator' });

  const totalHt = data.vat.reduce((sum, v) => sum + v.htCents, 0);
  out.push(columns(labels.totalHt, money(totalHt), width));
  secondary((s) => s.totalHt);
  for (const v of data.vat) {
    if (v.vatCents === 0) continue;
    out.push(columns(labels.vat(formatBps(v.vatRateBps)), money(v.vatCents), width));
    secondary((s) => s.vat(formatBps(v.vatRateBps)));
  }
  if (data.stampDutyCents > 0) {
    out.push(columns(labels.stamp, money(data.stampDutyCents), width));
    secondary((s) => s.stamp);
  }
  out.push(columns(labels.totalTtc, money(data.totalTtcCents), width, true));
  secondary((s) => s.totalTtc);
  if (data.paidCashCents > 0) out.push(columns(labels.cash, money(data.paidCashCents), width));
  if (data.paidCardTpeCents > 0) out.push(columns(labels.card, money(data.paidCardTpeCents), width));
  if (data.paidDeliveryAppCents > 0) out.push(columns(labels.delivery, money(data.paidDeliveryAppCents), width));
  if (data.changeCents > 0) {
    out.push(columns(labels.change, money(data.changeCents), width));
    secondary((s) => s.change);
  }
  out.push({ kind: 'separator' });
  out.push(text(`${labels.hash} ${shortFingerprint(data.ticketSha256)}`, 'left'));
  if (data.qrPayload !== null) {
    out.push({ kind: 'qr', data: data.qrPayload });
    if (options.conversionCaption) {
      out.push(text(labels.qrCaption, 'center'));
      secondary((s) => s.qrCaption);
    }
  }
  out.push(text(labels.thanks, 'center', true));
  secondary((s) => s.thanks);
  out.push({ kind: 'feed', lines: 3 });
  return out;
}

export interface RenderOptions {
  readonly openDrawer: boolean;
}

export function renderReceiptEscPos(doc: readonly ReceiptElement[], profile: PrinterProfile, options: RenderOptions): Uint8Array {
  const width = columnsForWidth(profile.paperWidthMm);
  const b = new EscPosBuilder(profile).init();
  if (options.openDrawer) b.openDrawer();
  for (const el of doc) {
    switch (el.kind) {
      case 'text':
        b.align(el.align).bold(el.bold);
        if (el.large) b.size(2, 2);
        b.line(el.text);
        if (el.large) b.size(1, 1);
        b.bold(false);
        break;
      case 'columns': {
        const gap = Math.max(1, width - el.left.length - el.right.length);
        b.align('left').bold(el.bold).line(`${el.left}${' '.repeat(gap)}${el.right}`).bold(false);
        break;
      }
      case 'separator':
        b.align('left').separator();
        break;
      case 'qr':
        b.align('center').qr(el.data, { moduleSize: profile.paperWidthMm === 58 ? 5 : 6, errorCorrection: 'M' }).line('');
        break;
      case 'feed':
        b.feed(el.lines);
        break;
    }
  }
  return b.cut().build();
}
