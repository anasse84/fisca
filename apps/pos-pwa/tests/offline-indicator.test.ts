import { describe, expect, it } from 'vitest';
import { buildOfflineIndicatorModel, mountOfflineIndicator } from '../src/offline/offline-indicator.ts';
import type { IndicatorLabels, IndicatorTarget } from '../src/offline/offline-indicator.ts';
import { OFFLINE_WINDOW_MS, evaluateOfflineWindow } from '../src/offline/offline-window.ts';

const T0 = Date.parse('2026-11-14T08:00:00.000Z');
const labels: IndicatorLabels = {
  online: 'En ligne',
  offlineWithin: 'Autonomie hors-ligne',
  offlineExpired: 'Resynchronisation requise',
  neverSynced: 'Jamais synchronisé',
  clockAnomaly: 'Horloge incohérente',
  pending: (count: number) => `${count} tickets en attente de synchro`,
  remaining: (hours: number, minutes: number) => `${hours} h ${minutes} min restantes`,
};

describe('indicateur d’état hors-ligne', () => {
  it('hors ligne dans la fenêtre : libellé, tickets en attente et compte à rebours', () => {
    const window = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0 + 10 * 3_600_000, online: false });
    const model = buildOfflineIndicatorModel({ window, pendingTickets: 3 }, labels);
    expect(model.tone).toBe('WARNING');
    expect(model.title).toBe('Autonomie hors-ligne');
    expect(model.pendingText).toBe('3 tickets en attente de synchro');
    expect(model.countdownText).toBe('62 h 0 min restantes');
    expect(model.salesBlocked).toBe(false);
  });

  it('en ligne : aucun compte à rebours', () => {
    const window = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0, online: true });
    const model = buildOfflineIndicatorModel({ window, pendingTickets: 0 }, labels);
    expect(model.tone).toBe('OK');
    expect(model.countdownText).toBeNull();
  });

  it('au-delà de 72 h : ton critique et ventes bloquées', () => {
    const window = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0 + OFFLINE_WINDOW_MS + 1, online: false });
    const model = buildOfflineIndicatorModel({ window, pendingTickets: 12 }, labels);
    expect(model.tone).toBe('CRITICAL');
    expect(model.title).toBe('Resynchronisation requise');
    expect(model.salesBlocked).toBe(true);
  });

  it('mountOfflineIndicator écrit le modèle dans la cible, sans HTML interprété', () => {
    const writes: Record<string, string> = {};
    const target: IndicatorTarget = {
      setText(part, text) {
        writes[part] = text;
      },
      setTone(tone) {
        writes['tone'] = tone;
      },
      setSalesBlocked(blocked) {
        writes['blocked'] = String(blocked);
      },
    };
    const window = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0, online: false });
    mountOfflineIndicator(target, buildOfflineIndicatorModel({ window, pendingTickets: 1 }, labels));
    expect(writes['title']).toBe('Autonomie hors-ligne');
    expect(writes['tone']).toBe('WARNING');
    expect(writes['blocked']).toBe('false');
  });
});
