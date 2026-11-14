/**
 * Fenêtre d'autonomie hors-ligne de la caisse (PRD § 13 : SQLite WASM résistant aux coupures jusqu'à 72 heures).
 * Fonctions pures : aucune lecture d'horloge, aucun accès réseau ni stockage.
 *
 * Décision d'interprétation (documentée dans le rapport du ticket) : la fenêtre se compte depuis la dernière
 * synchronisation réussie, que le réseau soit présent ou non. Un terminal en ligne mais non resynchronisé depuis
 * plus de 72 h reste bloqué (`SYNC_REQUIRED`) tant que la synchronisation n'a pas abouti.
 */

export const OFFLINE_WINDOW_HOURS = 72;
export const OFFLINE_WINDOW_MS = OFFLINE_WINDOW_HOURS * 3_600_000;

/** Écart d'horloge toléré (réglage NTP, dérive) avant de considérer l'horloge comme incohérente. */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;

export type OfflineWindowStatus =
  | 'ONLINE'
  | 'OFFLINE_WITHIN_WINDOW'
  | 'OFFLINE_EXPIRED'
  | 'SYNC_REQUIRED'
  | 'NEVER_SYNCED'
  | 'CLOCK_ANOMALY';

export interface OfflineWindowInput {
  /** Instant (ms epoch) de la dernière synchronisation réussie ; null si jamais synchronisé. */
  readonly lastSyncAtMs: number | null;
  readonly nowMs: number;
  readonly online: boolean;
}

export interface OfflineWindowState {
  readonly status: OfflineWindowStatus;
  readonly canSell: boolean;
  /** Millisecondes restantes avant le refus des nouvelles ventes (0 si expirée ou indéterminée). */
  readonly remainingMs: number;
}

export function evaluateOfflineWindow(input: OfflineWindowInput): OfflineWindowState {
  const { lastSyncAtMs, nowMs, online } = input;
  if (lastSyncAtMs === null) {
    return { status: 'NEVER_SYNCED', canSell: false, remainingMs: 0 };
  }
  if (nowMs < lastSyncAtMs - CLOCK_SKEW_TOLERANCE_MS) {
    return { status: 'CLOCK_ANOMALY', canSell: false, remainingMs: 0 };
  }
  const elapsedMs = Math.max(0, nowMs - lastSyncAtMs);
  if (elapsedMs > OFFLINE_WINDOW_MS) {
    return { status: online ? 'SYNC_REQUIRED' : 'OFFLINE_EXPIRED', canSell: false, remainingMs: 0 };
  }
  return {
    status: online ? 'ONLINE' : 'OFFLINE_WITHIN_WINDOW',
    canSell: true,
    remainingMs: OFFLINE_WINDOW_MS - elapsedMs,
  };
}

export class OfflineSalesRefusedError extends Error {
  readonly status: OfflineWindowStatus;

  constructor(status: OfflineWindowStatus) {
    super(`Nouvelle vente refusée : fenêtre hors-ligne de ${OFFLINE_WINDOW_HOURS} h dépassée ou indéterminée (${status}). Resynchronisation requise.`);
    this.name = 'OfflineSalesRefusedError';
    this.status = status;
  }
}

/** Garde à appeler avant tout nouveau ticket. */
export function assertSalesAllowed(state: OfflineWindowState): void {
  if (!state.canSell) {
    throw new OfflineSalesRefusedError(state.status);
  }
}

export interface Countdown {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

/** Décompose une durée en heures, minutes et secondes entières (affichage). */
export function splitCountdown(remainingMs: number): Countdown {
  const totalSeconds = Math.floor(Math.max(0, remainingMs) / 1000);
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}
