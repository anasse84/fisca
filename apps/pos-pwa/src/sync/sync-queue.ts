import type { PosStorage } from '../storage/ports.ts';
import type { SyncBatchPayload } from './sync-types.ts';

/**
 * File persistante locale : `pos_ticket_sync_status` (remplie par déclencheur à l'émission) et `pos_z_sync_status` (migration v3).
 * Rien n'est gardé en mémoire : un redémarrage, un crash ou une coupure reprennent exactement où ils s'étaient arrêtés.
 */

export interface PendingCounts {
  readonly tickets: number;
  readonly closures: number;
}

export async function countPending(storage: PosStorage): Promise<PendingCounts> {
  const tickets = await storage.all('SELECT COUNT(*) AS n FROM pos_ticket_sync_status WHERE synced_at IS NULL');
  const closures = await storage.all('SELECT COUNT(*) AS n FROM pos_z_sync_status WHERE synced_at IS NULL');
  return { tickets: Number(tickets[0]?.['n'] ?? 0), closures: Number(closures[0]?.['n'] ?? 0) };
}

/**
 * Prochain lot : les `limit` plus anciens tickets non synchronisés, dans l'ordre de la chaîne (rowid), puis les clôtures Z dont tous les
 * tickets de session sont déjà synchronisés ou dans ce lot — dans l'ordre des numéros de clôture, en s'arrêtant à la première non éligible.
 */
export async function loadPendingBatch(storage: PosStorage, limit: number): Promise<SyncBatchPayload> {
  const tickets = await storage.all(
    `SELECT t.* FROM pos_tickets t JOIN pos_ticket_sync_status s ON s.ticket_id = t.id
     WHERE s.synced_at IS NULL ORDER BY t.rowid LIMIT ?`,
    [limit],
  );
  const inBatch = new Set(tickets.map((t) => String(t['id'])));
  const pendingClosures = await storage.all(
    `SELECT c.*, z.ecdsa_signature_b64 FROM pos_z_closures c
       JOIN pos_z_sync_status q ON q.closure_id = c.id
       JOIN pos_z_seals z ON z.closure_id = c.id
     WHERE q.synced_at IS NULL ORDER BY c.terminal_id, c.closure_number`,
  );
  const closures = [];
  for (const closure of pendingClosures) {
    const unsynced = await storage.all(
      'SELECT t.id FROM pos_tickets t JOIN pos_ticket_sync_status s ON s.ticket_id = t.id WHERE t.session_id = ? AND s.synced_at IS NULL',
      [String(closure['session_id'])],
    );
    if (unsynced.some((row) => !inBatch.has(String(row['id'])))) break;
    closures.push(closure);
  }
  return { tickets, closures };
}

/** Marque les clôtures acquittées (rejeu sans effet : `synced_at IS NULL`). */
export async function markClosuresSynced(storage: PosStorage, closureIds: readonly string[], nowIso: string): Promise<void> {
  await storage.batch(closureIds.map((id) => ({ sql: 'UPDATE pos_z_sync_status SET synced_at = ? WHERE closure_id = ? AND synced_at IS NULL', params: [nowIso, id] })));
}
