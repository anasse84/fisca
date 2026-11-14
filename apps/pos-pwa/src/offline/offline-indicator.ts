import { splitCountdown } from './offline-window.ts';
import type { OfflineWindowState } from './offline-window.ts';

/**
 * Indicateur permanent d'état réseau (Doc_08 § 06) : modèle de vue pur + écriture dans une cible abstraite.
 * Les libellés sont injectés (dictionnaires @fisca/i18n) : ce module ne contient aucun texte d'interface.
 */

export type IndicatorTone = 'OK' | 'WARNING' | 'CRITICAL';

export interface IndicatorLabels {
  readonly online: string;
  readonly offlineWithin: string;
  readonly offlineExpired: string;
  readonly neverSynced: string;
  readonly clockAnomaly: string;
  readonly pending: (count: number) => string;
  readonly remaining: (hours: number, minutes: number) => string;
}

export interface IndicatorInput {
  readonly window: OfflineWindowState;
  readonly pendingTickets: number;
}

export interface OfflineIndicatorModel {
  readonly tone: IndicatorTone;
  readonly title: string;
  readonly pendingText: string;
  readonly countdownText: string | null;
  readonly salesBlocked: boolean;
}

function titleFor(status: OfflineWindowState['status'], labels: IndicatorLabels): string {
  switch (status) {
    case 'ONLINE':
      return labels.online;
    case 'OFFLINE_WITHIN_WINDOW':
      return labels.offlineWithin;
    case 'OFFLINE_EXPIRED':
    case 'SYNC_REQUIRED':
      return labels.offlineExpired;
    case 'NEVER_SYNCED':
      return labels.neverSynced;
    case 'CLOCK_ANOMALY':
      return labels.clockAnomaly;
  }
}

export function buildOfflineIndicatorModel(input: IndicatorInput, labels: IndicatorLabels): OfflineIndicatorModel {
  const { window, pendingTickets } = input;
  const tone: IndicatorTone = !window.canSell ? 'CRITICAL' : window.status === 'ONLINE' ? 'OK' : 'WARNING';
  const showCountdown = window.canSell && window.status === 'OFFLINE_WITHIN_WINDOW';
  const countdown = splitCountdown(window.remainingMs);
  return {
    tone,
    title: titleFor(window.status, labels),
    pendingText: labels.pending(pendingTickets),
    countdownText: showCountdown ? labels.remaining(countdown.hours, countdown.minutes) : null,
    salesBlocked: !window.canSell,
  };
}

export type IndicatorPart = 'title' | 'pending' | 'countdown';

/** Cible d'affichage : n'accepte que du texte (jamais de HTML), donc aucune injection possible. */
export interface IndicatorTarget {
  setText(part: IndicatorPart, text: string): void;
  setTone(tone: IndicatorTone): void;
  setSalesBlocked(blocked: boolean): void;
}

export function mountOfflineIndicator(target: IndicatorTarget, model: OfflineIndicatorModel): void {
  target.setText('title', model.title);
  target.setText('pending', model.pendingText);
  target.setText('countdown', model.countdownText ?? '');
  target.setTone(model.tone);
  target.setSalesBlocked(model.salesBlocked);
}
