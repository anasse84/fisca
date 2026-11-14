import type { PosStorage } from '../storage/ports.ts';

/** État de synchronisation local : dernière synchro réussie et tickets en attente d'envoi. */

export interface SyncSnapshot {
  readonly lastSyncAtMs: number | null;
  readonly pendingTickets: number;
}

export async function loadSyncSnapshot(storage: PosStorage): Promise<SyncSnapshot> {
  const state = await storage.all('SELECT last_sync_at FROM pos_sync_state WHERE id = 1');
  const pending = await storage.all('SELECT COUNT(*) AS pending FROM pos_ticket_sync_status WHERE synced_at IS NULL');
  const first = state[0];
  const lastSyncAtMs = first === undefined ? null : Date.parse(String(first['last_sync_at']));
  return { lastSyncAtMs: lastSyncAtMs === null || Number.isNaN(lastSyncAtMs) ? null : lastSyncAtMs, pendingTickets: Number(pending[0]?.['pending'] ?? 0) };
}

/** Enregistre une synchronisation réussie (rouvre la fenêtre de 72 h). */
export async function markSynced(storage: PosStorage, nowIso: string): Promise<void> {
  await storage.run(
    'INSERT INTO pos_sync_state (id, last_sync_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at',
    [nowIso],
  );
}

/** Marque des tickets comme envoyés (réponse positive de la synchronisation). */
export async function markTicketsSynced(storage: PosStorage, ticketIds: readonly string[], nowIso: string): Promise<void> {
  await storage.batch(ticketIds.map((id) => ({ sql: 'UPDATE pos_ticket_sync_status SET synced_at = ? WHERE ticket_id = ? AND synced_at IS NULL', params: [nowIso, id] })));
}
