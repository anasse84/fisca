import type { ReactElement } from 'react';
import { buildSyncIndicatorModel } from '../sync/sync-indicator.ts';
import type { SyncState } from '../sync/sync-types.ts';
import type { PosLabels } from './labels.ts';

export interface SyncIndicatorProps {
  readonly labels: PosLabels['sync'];
  readonly state: SyncState;
  /** Ventes bloquées par la règle des 72 h (`evaluateOfflineWindow`). */
  readonly blocked: boolean;
  readonly nowMs: number;
  /** Nombre d'heures de la règle existante (`OFFLINE_WINDOW_HOURS`), injecté pour le message. */
  readonly hours: number;
  readonly onRetry: () => void;
}

const ICON = { OK: '✓', INFO: '↻', WARNING: '⏳', CRITICAL: '⛔' } as const;
const STATE_KEY = { PENDING: 'pending', SYNCING: 'syncing', ERROR: 'error', SYNCED: 'synced' } as const;

/** Indicateur d'état de synchro : l'état n'est jamais porté par la couleur seule (icône, bordure, libellé). */
export function SyncIndicator({ labels, state, blocked, nowMs, hours, onRetry }: SyncIndicatorProps): ReactElement {
  const model = buildSyncIndicatorModel(state, blocked, nowMs);
  return (
    <div className="pos-banner pos-sync" data-testid="sync-indicator" data-state={model.state} data-tone={model.tone} role="status" aria-label={labels.status}>
      <span className="pos-banner__icon" aria-hidden="true">
        {ICON[model.tone]}
      </span>
      <span className="pos-banner__title">{labels.state[STATE_KEY[model.state]]}</span>
      {model.pendingTickets > 0 ? <span>{labels.pendingTickets(model.pendingTickets)}</span> : null}
      {model.pendingClosures > 0 ? <span>{labels.pendingClosures(model.pendingClosures)}</span> : null}
      {model.errorCode === null ? null : <span>{labels.cause[model.errorCode]}</span>}
      {model.state === 'ERROR' && model.retrySeconds > 0 ? <span className="pos-banner__countdown">{labels.retryIn(model.retrySeconds)}</span> : null}
      {model.blocked ? <span className="pos-banner__title">{labels.blocked(hours)}</span> : null}
      {model.canRetry && model.state === 'ERROR' ? (
        <button type="button" className="pos-action" data-testid="sync-retry" onClick={onRetry}>
          {labels.retry}
        </button>
      ) : null}
    </div>
  );
}
