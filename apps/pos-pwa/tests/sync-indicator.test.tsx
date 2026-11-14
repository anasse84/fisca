// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildSyncIndicatorModel } from '../src/sync/sync-indicator.ts';
import type { SyncState } from '../src/sync/sync-types.ts';
import { SyncIndicator } from '../src/ui/SyncIndicator.tsx';
import { resolvePosLabels } from '../src/ui/labels.ts';

afterEach(cleanup);
const labels = resolvePosLabels('fr');
const base: SyncState = { status: 'SYNCED', pendingTickets: 0, pendingClosures: 0, lastSyncAtMs: 1, errorCode: null, attempts: 0, nextRetryAtMs: null };

describe('modèle de l’indicateur de synchro', () => {
  it('quatre états : en attente, en cours, erreur, synchronisé', () => {
    expect(buildSyncIndicatorModel({ ...base, status: 'PENDING', pendingTickets: 4 }, false, 0).tone).toBe('WARNING');
    expect(buildSyncIndicatorModel({ ...base, status: 'SYNCING', pendingTickets: 4 }, false, 0).tone).toBe('INFO');
    expect(buildSyncIndicatorModel({ ...base, status: 'ERROR', errorCode: 'NETWORK', pendingTickets: 4 }, false, 0).tone).toBe('CRITICAL');
    expect(buildSyncIndicatorModel(base, false, 0).tone).toBe('OK');
  });
  it('bloqué passé 72 h : ton critique même si le moteur n’est pas en erreur', () => {
    expect(buildSyncIndicatorModel({ ...base, status: 'PENDING', pendingTickets: 1 }, true, 0)).toMatchObject({ tone: 'CRITICAL', blocked: true });
  });
  it('secondes avant la prochaine tentative, arrondies au supérieur, jamais négatives', () => {
    expect(buildSyncIndicatorModel({ ...base, status: 'ERROR', errorCode: 'SERVER', nextRetryAtMs: 10_500 }, false, 8000).retrySeconds).toBe(3);
    expect(buildSyncIndicatorModel({ ...base, status: 'ERROR', errorCode: 'SERVER', nextRetryAtMs: 5000 }, false, 8000).retrySeconds).toBe(0);
  });
});

describe('SyncIndicator', () => {
  const show = (state: SyncState, blocked = false, onRetry = (): void => undefined) =>
    render(<SyncIndicator labels={labels.sync} state={state} blocked={blocked} nowMs={0} hours={72} onRetry={onRetry} />);

  it('affiche l’état, le nombre de tickets et de clôtures en attente, avec icône et texte (jamais la couleur seule)', () => {
    show({ ...base, status: 'PENDING', pendingTickets: 4, pendingClosures: 1 });
    const el = screen.getByTestId('sync-indicator');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('data-state')).toBe('PENDING');
    expect(el.textContent).toContain(labels.sync.state.pending);
    expect(el.textContent).toContain(labels.sync.pendingTickets(4));
    expect(el.textContent).toContain(labels.sync.pendingClosures(1));
  });

  it('erreur : cause libellée, bouton Réessayer relance', () => {
    const retry = vi.fn();
    show({ ...base, status: 'ERROR', errorCode: 'NETWORK', pendingTickets: 2, nextRetryAtMs: 3000 }, false, retry);
    expect(screen.getByTestId('sync-indicator').textContent).toContain(labels.sync.cause.NETWORK);
    fireEvent.click(screen.getByTestId('sync-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('synchronisé : aucun bouton Réessayer ; bloqué : message avec les heures de la règle', () => {
    show(base);
    expect(screen.queryByTestId('sync-retry')).toBeNull();
    cleanup();
    show({ ...base, status: 'PENDING', pendingTickets: 1 }, true);
    expect(screen.getByTestId('sync-indicator').textContent).toContain(labels.sync.blocked(72));
  });
});
