import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { lockBlindCount } from '../src/closing/blind-count.ts';
import { sealZClosure } from '../src/closing/z-closure.ts';
import { OFFLINE_WINDOW_MS, evaluateOfflineWindow } from '../src/offline/offline-window.ts';
import { loadSyncSnapshot } from '../src/offline/sync-state.ts';
import { SyncEngine, backoffDelayMs } from '../src/sync/sync-engine.ts';
import type { SyncEngineOptions } from '../src/sync/sync-engine.ts';
import { loadPendingBatch } from '../src/sync/sync-queue.ts';
import { SyncTransportError } from '../src/sync/sync-types.ts';
import { generateSigningKeyPair } from '../src/ticketing/ticket-signing.ts';
import { LINES_20, NOW, TEST_GRID_PORT, closingHarness, sellThree } from './helpers-closing.ts';
import type { ClosingHarness } from './helpers-closing.ts';
import { FakeClock, FakeConnectivity, FakeSyncServer } from './helpers-sync.ts';

let keyPair: CryptoKeyPair;
beforeAll(async () => {
  keyPair = await generateSigningKeyPair();
});
const open: ClosingHarness[] = [];
afterAll(async () => {
  for (const h of open) await h.storage.close();
});

async function setup(sold = true): Promise<{ h: ClosingHarness; server: FakeSyncServer; clock: FakeClock; net: FakeConnectivity }> {
  const h = await closingHarness(keyPair);
  open.push(h);
  if (sold) await sellThree(h);
  return { h, server: new FakeSyncServer(), clock: new FakeClock(), net: new FakeConnectivity() };
}
const engineOf = (ctx: Awaited<ReturnType<typeof setup>>, extra: Partial<SyncEngineOptions> = {}): SyncEngine =>
  new SyncEngine({
    storage: ctx.h.storage,
    transport: ctx.server.transport,
    clock: ctx.clock,
    connectivity: ctx.net,
    isOnline: () => ctx.net.online,
    jitter: (cap) => cap,
    config: { batchSize: 200, baseDelayMs: 1000, maxDelayMs: 8000, intervalMs: 60_000 },
    ...extra,
  });
async function closeSession(h: ClosingHarness): Promise<void> {
  await lockBlindCount({ storage: h.storage, grid: TEST_GRID_PORT, now: () => NOW }, { sessionId: 'sess-1', counts: { 'note-10000': 1 } });
  await sealZClosure({ storage: h.storage, keyPair: h.keyPair, now: () => '2026-11-13T18:05:00.000Z', newId: () => 'z-1' }, { sessionId: 'sess-1' });
}

describe('file persistante locale', () => {
  it('les tickets émis sont en file (déclencheur), dans l’ordre de la chaîne, et la clôture Z aussi', async () => {
    const { h } = await setup();
    await closeSession(h);
    const batch = await loadPendingBatch(h.storage, 200);
    expect(batch.tickets.map((t) => t['terminal_seq_number'])).toEqual(['POS-M01-C01-2026-000001', 'POS-M01-C01-2026-000002', 'POS-M01-C01-2026-000003']);
    expect(batch.closures.map((c) => c['id'])).toEqual(['z-1']);
    expect(batch.closures[0]?.['ecdsa_signature_b64']).toMatch(/\S+/);
  });

  it('une clôture n’est proposée qu’avec (ou après) les tickets de sa session', async () => {
    const { h } = await setup();
    await closeSession(h);
    const small = await loadPendingBatch(h.storage, 2);
    expect(small.tickets).toHaveLength(2);
    expect(small.closures).toHaveLength(0);
    const full = await loadPendingBatch(h.storage, 3);
    expect(full.closures).toHaveLength(1);
  });

  it('survit à une réouverture : la file est dans les tables locales, pas en mémoire', async () => {
    const { h } = await setup();
    expect((await loadSyncSnapshot(h.storage)).pendingTickets).toBe(3);
  });
});

describe('envoi par lots, ordre, idempotence', () => {
  it('envoie par lots de la taille configurée, ordre de séquence respecté, tout acquitté', async () => {
    const ctx = await setup();
    await closeSession(ctx.h);
    const engine = engineOf(ctx, { config: { batchSize: 2, baseDelayMs: 1000, maxDelayMs: 8000, intervalMs: 60_000 } });
    const state = await engine.syncNow();
    expect(ctx.server.calls.map((c) => c.tickets.length)).toEqual([2, 1]);
    expect([...ctx.server.tickets.values()].map((t) => t['terminal_seq_number'])).toEqual(['POS-M01-C01-2026-000001', 'POS-M01-C01-2026-000002', 'POS-M01-C01-2026-000003']);
    expect(ctx.server.closures.size).toBe(1);
    expect(state).toMatchObject({ status: 'SYNCED', pendingTickets: 0, pendingClosures: 0, errorCode: null });
    expect(state.lastSyncAtMs).toBe(ctx.clock.now);
    expect((await loadSyncSnapshot(ctx.h.storage)).lastSyncAtMs).toBe(ctx.clock.now);
  });

  it('rejeu après accusé perdu : le serveur ne duplique pas et le client finit synchronisé', async () => {
    const ctx = await setup();
    const engine = engineOf(ctx);
    ctx.server.dropAckNext = true;
    const failed = await engine.syncNow();
    expect(failed.status).toBe('ERROR');
    expect(ctx.server.tickets.size).toBe(3);
    expect(failed.pendingTickets).toBe(3);
    ctx.clock.advance(8000);
    await vi.waitFor(() => expect(engine.getState().status).toBe('SYNCED'));
    expect(ctx.server.tickets.size).toBe(3);
    expect(ctx.server.calls).toHaveLength(2);
    expect(ctx.server.calls[1]?.tickets.map((t) => t['id'])).toEqual(ctx.server.calls[0]?.tickets.map((t) => t['id']));
  });

  it('un ticket rejeté (rupture de chaîne) arrête l’envoi : les suivants ne partent pas, erreur REJECTED', async () => {
    const ctx = await setup();
    // altère la file : le serveur croit avoir déjà un maillon différent
    await ctx.h.storage.run('DROP TRIGGER prevent_pos_ticket_update');
    await ctx.h.storage.run("UPDATE pos_tickets SET prev_ticket_sha256 = ? WHERE id = 't-2'", ['d'.repeat(64)]);
    const engine = engineOf(ctx);
    const state = await engine.syncNow();
    expect(state).toMatchObject({ status: 'ERROR', errorCode: 'REJECTED', pendingTickets: 2 });
    expect(ctx.server.tickets.size).toBe(1);
  });

  it('nouveaux tickets après une synchro : seuls les non synchronisés partent', async () => {
    const ctx = await setup();
    const engine = engineOf(ctx);
    await engine.syncNow();
    await ctx.h.issue({ lines: LINES_20, payments: { cashCents: 0, cardTpeCents: 12000, deliveryAppCents: 0 } });
    await engine.syncNow();
    expect(ctx.server.calls.at(-1)?.tickets).toHaveLength(1);
    expect(ctx.server.tickets.size).toBe(4);
  });
});

describe('backoff exponentiel borné avec gigue injectable', () => {
  it('backoffDelayMs : base × 2^(n-1), plafonné, gigue appliquée sur le plafond courant', () => {
    const cfg = { batchSize: 200, baseDelayMs: 1000, maxDelayMs: 8000, intervalMs: 60_000 };
    expect([1, 2, 3, 4, 5, 9].map((n) => backoffDelayMs(n, cfg, (cap) => cap))).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
    expect(backoffDelayMs(3, cfg, () => 0)).toBe(0);
    expect(backoffDelayMs(3, cfg, (cap) => cap / 2)).toBe(2000);
    expect(backoffDelayMs(2, cfg, () => 999_999)).toBe(2000);
    expect(backoffDelayMs(2, cfg, () => -5)).toBe(0);
  });

  it('échecs successifs : délais 1 s, 2 s, 4 s, 8 s, 8 s puis remise à zéro après succès', async () => {
    const ctx = await setup();
    const engine = engineOf(ctx);
    for (let i = 0; i < 5; i += 1) {
      ctx.server.failNext = new SyncTransportError('SERVER', 'indisponible');
      if (i === 0) await engine.syncNow();
      else {
        ctx.clock.advance(ctx.clock.scheduledDelays.at(-1) ?? 0);
        await vi.waitFor(() => expect(ctx.clock.scheduledDelays.length).toBe(i + 1));
      }
    }
    expect(ctx.clock.scheduledDelays).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(engine.getState()).toMatchObject({ status: 'ERROR', errorCode: 'SERVER', attempts: 5 });
    ctx.clock.advance(8000);
    await vi.waitFor(() => expect(engine.getState().status).toBe('SYNCED'));
    expect(engine.getState().attempts).toBe(0);
    expect(ctx.clock.pendingTimeouts).toBe(0);
  });

  it('l’état d’erreur annonce l’instant de la prochaine tentative', async () => {
    const ctx = await setup();
    const engine = engineOf(ctx);
    ctx.server.failNext = new SyncTransportError('NETWORK', 'hors ligne');
    const state = await engine.syncNow();
    expect(state.nextRetryAtMs).toBe(ctx.clock.now + 1000);
  });
});

describe('reprise automatique', () => {
  it('l’événement online déclenche une synchronisation immédiate et remet le backoff à zéro', async () => {
    const ctx = await setup();
    const engine = engineOf(ctx);
    ctx.server.failNext = new SyncTransportError('NETWORK', 'x');
    engine.start();
    await vi.waitFor(() => expect(engine.getState().status).toBe('ERROR'));
    ctx.net.emit('online');
    await vi.waitFor(() => expect(engine.getState().status).toBe('SYNCED'));
    expect(ctx.server.tickets.size).toBe(3);
    engine.stop();
  });

  it('l’intervalle relance la file tant qu’il reste des éléments', async () => {
    const ctx = await setup(false);
    const engine = engineOf(ctx);
    engine.start();
    await vi.waitFor(() => expect(engine.getState().status).toBe('SYNCED'));
    await sellThree(ctx.h);
    await vi.waitFor(async () => expect((await loadSyncSnapshot(ctx.h.storage)).pendingTickets).toBe(3));
    ctx.clock.advance(60_000);
    await vi.waitFor(() => expect(ctx.server.tickets.size).toBe(3));
    engine.stop();
  });

  it('hors ligne : aucun appel au transport, état en attente ; au retour du réseau, envoi', async () => {
    const ctx = await setup();
    ctx.net.online = false;
    const engine = engineOf(ctx);
    const state = await engine.syncNow();
    expect(ctx.server.calls).toHaveLength(0);
    expect(state).toMatchObject({ status: 'PENDING', pendingTickets: 3 });
    engine.start();
    ctx.net.emit('online');
    await vi.waitFor(() => expect(engine.getState().status).toBe('SYNCED'));
    engine.stop();
  });

  it('stop() retire écouteurs et minuteries', async () => {
    const ctx = await setup();
    const engine = engineOf(ctx);
    engine.start();
    expect(ctx.net.listenerCount()).toBeGreaterThan(0);
    engine.stop();
    expect(ctx.net.listenerCount()).toBe(0);
    expect(ctx.clock.timers).toHaveLength(0);
  });

  it('un seul envoi à la fois : deux déclenchements simultanés partagent le même tour', async () => {
    const ctx = await setup();
    const engine = engineOf(ctx);
    await Promise.all([engine.syncNow(), engine.syncNow()]);
    expect(ctx.server.calls).toHaveLength(1);
  });
});

describe('règle des 72 heures (existante)', () => {
  it('une synchro réussie rouvre la fenêtre ; sans synchro depuis plus de 72 h, les ventes restent bloquées en ligne', async () => {
    const ctx = await setup();
    const engine = engineOf(ctx);
    const state = await engine.syncNow();
    const fresh = evaluateOfflineWindow({ lastSyncAtMs: state.lastSyncAtMs, nowMs: ctx.clock.now, online: true });
    expect(fresh.canSell).toBe(true);
    const stale = evaluateOfflineWindow({ lastSyncAtMs: state.lastSyncAtMs, nowMs: ctx.clock.now + OFFLINE_WINDOW_MS + 1, online: true });
    expect(stale).toMatchObject({ canSell: false, status: 'SYNC_REQUIRED' });
  });
});
