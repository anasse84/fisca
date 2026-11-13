import { describe, expect, it } from 'vitest';
import {
  CLOCK_SKEW_TOLERANCE_MS,
  OFFLINE_WINDOW_HOURS,
  OFFLINE_WINDOW_MS,
  OfflineSalesRefusedError,
  assertSalesAllowed,
  evaluateOfflineWindow,
  splitCountdown,
} from '../src/offline/offline-window.ts';

const HOUR_MS = 3_600_000;
const T0 = Date.parse('2026-11-14T08:00:00.000Z');

describe('fenêtre hors-ligne de 72 h', () => {
  it('vaut 72 heures, soit 259 200 000 ms', () => {
    expect(OFFLINE_WINDOW_HOURS).toBe(72);
    expect(OFFLINE_WINDOW_MS).toBe(259_200_000);
  });

  it('en ligne et synchronisé : vente autorisée, 72 h restantes', () => {
    const state = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0, online: true });
    expect(state.status).toBe('ONLINE');
    expect(state.canSell).toBe(true);
    expect(state.remainingMs).toBe(OFFLINE_WINDOW_MS);
  });

  it('hors ligne depuis 71 h 59 : vente autorisée, il reste une minute', () => {
    const state = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0 + 72 * HOUR_MS - 60_000, online: false });
    expect(state.status).toBe('OFFLINE_WITHIN_WINDOW');
    expect(state.canSell).toBe(true);
    expect(state.remainingMs).toBe(60_000);
  });

  it('hors ligne depuis exactement 72 h : encore autorisé, reste 0 (le refus commence au-delà)', () => {
    const state = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0 + OFFLINE_WINDOW_MS, online: false });
    expect(state.canSell).toBe(true);
    expect(state.remainingMs).toBe(0);
  });

  it('hors ligne depuis 72 h + 1 ms : nouvelles ventes refusées', () => {
    const state = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0 + OFFLINE_WINDOW_MS + 1, online: false });
    expect(state.status).toBe('OFFLINE_EXPIRED');
    expect(state.canSell).toBe(false);
    expect(state.remainingMs).toBe(0);
  });

  it('en ligne mais sans resynchronisation depuis plus de 72 h : synchronisation exigée, vente refusée', () => {
    const state = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0 + 73 * HOUR_MS, online: true });
    expect(state.status).toBe('SYNC_REQUIRED');
    expect(state.canSell).toBe(false);
  });

  it('jamais synchronisé : vente refusée', () => {
    const state = evaluateOfflineWindow({ lastSyncAtMs: null, nowMs: T0, online: true });
    expect(state.status).toBe('NEVER_SYNCED');
    expect(state.canSell).toBe(false);
  });

  it('horloge reculée au-delà de la tolérance : vente refusée', () => {
    const state = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0 - CLOCK_SKEW_TOLERANCE_MS - 1, online: false });
    expect(state.status).toBe('CLOCK_ANOMALY');
    expect(state.canSell).toBe(false);
  });

  it('léger décalage d’horloge dans la tolérance : traité comme une synchronisation à l’instant', () => {
    const state = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0 - 1000, online: false });
    expect(state.canSell).toBe(true);
    expect(state.remainingMs).toBe(OFFLINE_WINDOW_MS);
  });

  it('assertSalesAllowed lève une erreur typée quand la vente est refusée', () => {
    const refused = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0 + OFFLINE_WINDOW_MS + 1, online: false });
    expect(() => assertSalesAllowed(refused)).toThrow(OfflineSalesRefusedError);
    const allowed = evaluateOfflineWindow({ lastSyncAtMs: T0, nowMs: T0, online: false });
    expect(() => assertSalesAllowed(allowed)).not.toThrow();
  });

  it('décompose le compte à rebours en heures, minutes et secondes entières', () => {
    expect(splitCountdown(OFFLINE_WINDOW_MS)).toEqual({ hours: 72, minutes: 0, seconds: 0 });
    expect(splitCountdown(3 * HOUR_MS + 25 * 60_000 + 59_999)).toEqual({ hours: 3, minutes: 25, seconds: 59 });
    expect(splitCountdown(0)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    expect(splitCountdown(-5)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });
});
