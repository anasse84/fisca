import type { PosStorage } from '../storage/ports.ts';
import type { B2bConversionState } from './qr-conversion.ts';

export interface TicketConversionRow {
  readonly qrConversionToken: string;
  readonly state: B2bConversionState;
}

const STATES: readonly B2bConversionState[] = ['NONE', 'CONVERTI_B2B_AVANT_Z', 'CONVERTI_B2B_POST_Z_NEUTRALISE'];

/** Lit le jeton de conversion et l'état local d'un ticket émis (lecture seule : `pos_tickets` est immuable). */
export async function readTicketConversion(storage: PosStorage, ticketId: string): Promise<TicketConversionRow> {
  const rows = await storage.all('SELECT qr_conversion_token, b2b_conversion_state FROM pos_tickets WHERE id = ?', [ticketId]);
  const row = rows[0];
  if (row === undefined) throw new Error(`Ticket « ${ticketId} » introuvable dans la base locale.`);
  const state = STATES.find((s) => s === row['b2b_conversion_state']);
  if (state === undefined) throw new Error(`État de conversion inconnu pour le ticket « ${ticketId} ».`);
  return { qrConversionToken: String(row['qr_conversion_token']), state };
}
