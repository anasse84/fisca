import type { SyncState } from './sync-types.ts';

/** Modèle de vue pur de l'indicateur de synchro : quatre états, jamais portés par la couleur seule (icône et texte côté composant). */

export type SyncTone = 'OK' | 'INFO' | 'WARNING' | 'CRITICAL';

export interface SyncIndicatorModel {
  readonly tone: SyncTone;
  readonly state: SyncState['status'];
  readonly pendingTickets: number;
  readonly pendingClosures: number;
  readonly errorCode: SyncState['errorCode'];
  /** Ventes bloquées par la règle des 72 h (fenêtre déjà évaluée par `evaluateOfflineWindow`). */
  readonly blocked: boolean;
  /** Secondes avant la prochaine tentative automatique (arrondi au supérieur), 0 si aucune. */
  readonly retrySeconds: number;
  readonly canRetry: boolean;
}

export function buildSyncIndicatorModel(state: SyncState, blocked: boolean, nowMs: number): SyncIndicatorModel {
  const tone: SyncTone = blocked || state.status === 'ERROR' ? 'CRITICAL' : state.status === 'PENDING' ? 'WARNING' : state.status === 'SYNCING' ? 'INFO' : 'OK';
  const remainingMs = state.nextRetryAtMs === null ? 0 : Math.max(0, state.nextRetryAtMs - nowMs);
  return {
    tone,
    state: state.status,
    pendingTickets: state.pendingTickets,
    pendingClosures: state.pendingClosures,
    errorCode: state.errorCode,
    blocked,
    retrySeconds: Math.ceil(remainingMs / 1000),
    canRetry: state.status === 'ERROR' || state.status === 'PENDING',
  };
}
