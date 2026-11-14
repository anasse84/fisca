import { columnsForWidth } from '../printing/escpos.ts';
import type { PrinterProfile } from '../printing/escpos.ts';
import { renderReceiptEscPos } from '../printing/receipt-layout.ts';
import type { ReceiptElement } from '../printing/receipt-layout.ts';
import { layoutZTicket } from './z-layout.ts';
import type { ZLabelSet, ZTicketData } from './z-layout.ts';

/** Document du Ticket Z (aperçu et impression) : libellés primaires puis jeu secondaire, comme le ticket de vente bilingue. */
export function buildZDocument(data: ZTicketData, profile: PrinterProfile, labels: ZLabelSet, secondaryLabels?: ZLabelSet): readonly ReceiptElement[] {
  return layoutZTicket(data, { columns: columnsForWidth(profile.paperWidthMm), labels, ...(secondaryLabels === undefined ? {} : { secondaryLabels }) });
}

/** Octets ESC/POS du Ticket Z, destinés à `PrintQueue.enqueue` (file FIFO existante : un travail en échec n'est jamais perdu). Pas d'ouverture de tiroir. */
export function renderZEscPos(document: readonly ReceiptElement[], profile: PrinterProfile): Uint8Array {
  return renderReceiptEscPos(document, profile, { openDrawer: false });
}
