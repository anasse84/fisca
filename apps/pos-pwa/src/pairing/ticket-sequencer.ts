import type { PosStorage, SqlStatement } from '../storage/ports.ts';
import { formatTicketNumber, loadTerminalIdentity } from './pairing-flow.ts';

/**
 * Séquenceur local : réserve le numéro du PROCHAIN ticket avant sa création (numérotation continue par terminal,
 * sans trou). Une réservation ouverte est toujours rendue telle quelle ; le compteur n'avance qu'à la consommation,
 * dans la même transaction que le passage de la réservation à CONSUMED.
 * La séquence est continue : le changement d'année modifie le segment AAAA du numéro, pas le compteur.
 */

export interface TicketReservation {
  readonly ticketNumber: string;
  readonly sequence: number;
  readonly terminalId: string;
}

export interface ReserveOptions {
  readonly year: number;
  readonly nowIso: string;
}

const MAX_ATTEMPTS = 3;

async function findOpenReservation(storage: PosStorage, terminalId: string): Promise<TicketReservation | null> {
  const rows = await storage.all("SELECT seq, ticket_number FROM pos_sequence_reservations WHERE terminal_id = ? AND status = 'RESERVED'", [terminalId]);
  const row = rows[0];
  return row === undefined ? null : { terminalId, sequence: Number(row['seq']), ticketNumber: String(row['ticket_number']) };
}

export async function reserveNextTicketNumber(storage: PosStorage, options: ReserveOptions): Promise<TicketReservation> {
  const identity = await loadTerminalIdentity(storage);
  if (identity === null) throw new Error('Terminal non appairé : aucun numéro de ticket ne peut être réservé.');

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const open = await findOpenReservation(storage, identity.terminalId);
    if (open !== null) return open;
    const counter = await storage.all('SELECT last_issued_seq FROM pos_sequence_counters WHERE terminal_id = ?', [identity.terminalId]);
    const next = Number(counter[0]?.['last_issued_seq'] ?? -1) + 1;
    if (next < 1) throw new Error('Compteur de séquence absent pour ce terminal.');
    const ticketNumber = formatTicketNumber({ storeCode: identity.storeCode, terminalCode: identity.terminalCode, year: options.year, sequence: next });
    try {
      await storage.run(
        "INSERT INTO pos_sequence_reservations (terminal_id, seq, ticket_number, reserved_at, status) VALUES (?, ?, ?, ?, 'RESERVED')",
        [identity.terminalId, next, ticketNumber, options.nowIso],
      );
      return { terminalId: identity.terminalId, sequence: next, ticketNumber };
    } catch {
      // Réservation concurrente de la même séquence : on relit et on rend la réservation gagnante.
    }
  }
  const final = await findOpenReservation(storage, identity.terminalId);
  if (final !== null) return final;
  throw new Error('Réservation du numéro de ticket impossible après plusieurs tentatives.');
}

/**
 * Instructions SQL de consommation (réservation → CONSUMED, compteur +1). Exposées pour que l'émission d'un ticket signé
 * les joigne, dans le MÊME lot atomique, à l'insertion du ticket : pas de ticket sans numéro consommé, ni l'inverse.
 */
export function buildConsumeStatements(reservation: TicketReservation, nowIso: string): readonly SqlStatement[] {
  return [
    {
      sql: "UPDATE pos_sequence_reservations SET status = 'CONSUMED', consumed_at = ? WHERE terminal_id = ? AND seq = ? AND status = 'RESERVED'",
      params: [nowIso, reservation.terminalId, reservation.sequence],
    },
    {
      sql: 'UPDATE pos_sequence_counters SET last_issued_seq = ? WHERE terminal_id = ? AND last_issued_seq = ?',
      params: [reservation.sequence, reservation.terminalId, reservation.sequence - 1],
    },
  ];
}

/** Vérifie que le compteur du terminal est bien à la séquence consommée. */
export async function assertCounterAt(storage: PosStorage, reservation: TicketReservation): Promise<void> {
  const check = await storage.all('SELECT last_issued_seq FROM pos_sequence_counters WHERE terminal_id = ?', [reservation.terminalId]);
  if (Number(check[0]?.['last_issued_seq']) !== reservation.sequence) {
    throw new Error(`Compteur de séquence incohérent après consommation de ${reservation.ticketNumber}.`);
  }
}

/** Consomme la réservation (le ticket est créé) : le compteur avance de 1, atomiquement. */
export async function consumeTicketNumber(storage: PosStorage, reservation: TicketReservation, nowIso: string): Promise<void> {
  const open = await findOpenReservation(storage, reservation.terminalId);
  if (open === null || open.sequence !== reservation.sequence || open.ticketNumber !== reservation.ticketNumber) {
    throw new Error(`Aucune réservation ouverte pour ${reservation.ticketNumber}.`);
  }
  await storage.batch([...buildConsumeStatements(reservation, nowIso)]);
  await assertCounterAt(storage, reservation);
}
