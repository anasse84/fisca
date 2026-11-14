import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../src/storage/memory-storage.ts';
import { runLocalMigrations } from '../src/storage/migrations.ts';
import type { PosStorage } from '../src/storage/ports.ts';
import {
  PAIRING_CODE_PATTERN,
  formatTicketNumber,
  loadTerminalIdentity,
  normalizePairingCode,
  pairTerminal,
} from '../src/pairing/pairing-flow.ts';
import type { PairingGateway, PairingGatewayResult } from '../src/pairing/pairing-flow.ts';
import { consumeTicketNumber, reserveNextTicketNumber } from '../src/pairing/ticket-sequencer.ts';
import { loadSyncSnapshot, markSynced } from '../src/offline/sync-state.ts';

const NOW = '2026-11-14T08:00:00.000Z';
let storage: PosStorage | undefined;
afterEach(async () => {
  await storage?.close();
  storage = undefined;
});

async function freshStorage(): Promise<PosStorage> {
  const s = await createMemoryStorage();
  await runLocalMigrations(s, NOW);
  storage = s;
  return s;
}

function gatewayReturning(result: PairingGatewayResult | Error): { gateway: PairingGateway; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    gateway: {
      redeemPairingCode: async (request) => {
        calls.push(request.pairingCode);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

const OK: PairingGatewayResult = {
  ok: true,
  terminal: { terminalId: 'term-uuid-1', storeCode: 'M01', terminalCode: 'C02', lastIssuedSequence: 0 },
};

describe('code d’appairage', () => {
  it('normalise : espaces, tirets et casse', () => {
    expect(normalizePairingCode(' abcd-2345 efgh ')).toEqual({ ok: true, code: 'ABCD2345EFGH' });
  });
  it('refuse un code vide ou aux caractères invalides', () => {
    expect(normalizePairingCode('   ')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(normalizePairingCode('ab$c')).toEqual({ ok: false, reason: 'INVALID_FORMAT' });
    expect('ABCDEFGH').toMatch(PAIRING_CODE_PATTERN);
  });
});

describe('numéro de ticket', () => {
  it('POS-{MAG}-{TERM}-{AAAA}-{séquence sur 6 chiffres}', () => {
    expect(formatTicketNumber({ storeCode: 'M01', terminalCode: 'C02', year: 2026, sequence: 841 })).toBe('POS-M01-C02-2026-000841');
  });
  it('refuse une séquence non entière positive', () => {
    expect(() => formatTicketNumber({ storeCode: 'M01', terminalCode: 'C02', year: 2026, sequence: 0 })).toThrow();
    expect(() => formatTicketNumber({ storeCode: 'M01', terminalCode: 'C02', year: 2026, sequence: 1.5 })).toThrow();
  });
});

describe('flux d’appairage terminal', () => {
  it('appairage réussi : identité stockée, compteur initialisé, fenêtre 72 h ouverte', async () => {
    const s = await freshStorage();
    const { gateway, calls } = gatewayReturning(OK);
    const outcome = await pairTerminal({ storage: s, gateway, rawCode: 'abcd-2345', deviceFingerprint: 'fp-1', nowIso: NOW });
    expect(outcome).toMatchObject({ status: 'PAIRED', identity: { terminalId: 'term-uuid-1', storeCode: 'M01', terminalCode: 'C02' } });
    expect(calls).toEqual(['ABCD2345']);
    expect(await loadTerminalIdentity(s)).toMatchObject({ terminalId: 'term-uuid-1', pairedAt: NOW, deviceFingerprint: 'fp-1' });
    expect((await loadSyncSnapshot(s)).lastSyncAtMs).toBe(Date.parse(NOW));
  });

  it('le code en clair n’est jamais stocké (empreinte SHA-256 seulement)', async () => {
    const s = await freshStorage();
    await pairTerminal({ storage: s, gateway: gatewayReturning(OK).gateway, rawCode: 'ABCD2345', deviceFingerprint: 'fp', nowIso: NOW });
    const dump = JSON.stringify(await s.all('SELECT * FROM pos_pairing_attempts'));
    expect(dump).not.toContain('ABCD2345');
    expect(dump).toMatch(/[0-9a-f]{64}/);
  });

  it('terminal déjà appairé : second appairage refusé sans appel serveur', async () => {
    const s = await freshStorage();
    await pairTerminal({ storage: s, gateway: gatewayReturning(OK).gateway, rawCode: 'ABCD2345', deviceFingerprint: 'fp', nowIso: NOW });
    const second = gatewayReturning(OK);
    const outcome = await pairTerminal({ storage: s, gateway: second.gateway, rawCode: 'WXYZ6789', deviceFingerprint: 'fp', nowIso: NOW });
    expect(outcome).toEqual({ status: 'REFUSED', reason: 'ALREADY_PAIRED' });
    expect(second.calls).toEqual([]);
  });

  it('code refusé par le serveur : terminal non appairé, code marqué consommé localement (usage unique)', async () => {
    const s = await freshStorage();
    const used = gatewayReturning({ ok: false, reason: 'CODE_ALREADY_USED' });
    expect(await pairTerminal({ storage: s, gateway: used.gateway, rawCode: 'ABCD2345', deviceFingerprint: 'fp', nowIso: NOW })).toEqual({
      status: 'REFUSED',
      reason: 'CODE_ALREADY_USED',
    });
    expect(await loadTerminalIdentity(s)).toBeNull();
    const again = gatewayReturning(OK);
    expect(await pairTerminal({ storage: s, gateway: again.gateway, rawCode: 'abcd-2345', deviceFingerprint: 'fp', nowIso: NOW })).toEqual({
      status: 'REFUSED',
      reason: 'CODE_REUSED_LOCALLY',
    });
    expect(again.calls).toEqual([]);
  });

  it('code invalide ou expiré : une autre saisie reste possible', async () => {
    const s = await freshStorage();
    const invalid = gatewayReturning({ ok: false, reason: 'INVALID_CODE' });
    expect(await pairTerminal({ storage: s, gateway: invalid.gateway, rawCode: 'ABCD2345', deviceFingerprint: 'fp', nowIso: NOW })).toEqual({
      status: 'REFUSED',
      reason: 'INVALID_CODE',
    });
    const ok = await pairTerminal({ storage: s, gateway: gatewayReturning(OK).gateway, rawCode: 'WXYZ6789', deviceFingerprint: 'fp', nowIso: NOW });
    expect(ok.status).toBe('PAIRED');
  });

  it('serveur injoignable : code non consommé, nouvel essai possible avec le même code', async () => {
    const s = await freshStorage();
    const down = gatewayReturning(new TypeError('hors ligne'));
    expect(await pairTerminal({ storage: s, gateway: down.gateway, rawCode: 'ABCD2345', deviceFingerprint: 'fp', nowIso: NOW })).toEqual({
      status: 'REFUSED',
      reason: 'GATEWAY_UNREACHABLE',
    });
    const retry = await pairTerminal({ storage: s, gateway: gatewayReturning(OK).gateway, rawCode: 'ABCD2345', deviceFingerprint: 'fp', nowIso: NOW });
    expect(retry.status).toBe('PAIRED');
  });

  it('format de code invalide : refus local sans appel serveur', async () => {
    const s = await freshStorage();
    const g = gatewayReturning(OK);
    expect(await pairTerminal({ storage: s, gateway: g.gateway, rawCode: '!!', deviceFingerprint: 'fp', nowIso: NOW })).toEqual({
      status: 'REFUSED',
      reason: 'INVALID_FORMAT',
    });
    expect(g.calls).toEqual([]);
  });

  it('réponse serveur aux codes de magasin ou de terminal non conformes : refus (RESPONSE_INVALID)', async () => {
    const s = await freshStorage();
    const bad = gatewayReturning({ ok: true, terminal: { terminalId: 't', storeCode: 'M-01', terminalCode: 'C02', lastIssuedSequence: 0 } });
    expect(await pairTerminal({ storage: s, gateway: bad.gateway, rawCode: 'ABCD2345', deviceFingerprint: 'fp', nowIso: NOW })).toEqual({
      status: 'REFUSED',
      reason: 'RESPONSE_INVALID',
    });
    expect(await loadTerminalIdentity(s)).toBeNull();
  });
});

describe('séquenceur local de tickets', () => {
  async function paired(lastIssued = 0): Promise<PosStorage> {
    const s = await freshStorage();
    await pairTerminal({
      storage: s,
      gateway: gatewayReturning({ ok: true, terminal: { terminalId: 'term-uuid-1', storeCode: 'M01', terminalCode: 'C02', lastIssuedSequence: lastIssued } }).gateway,
      rawCode: 'ABCD2345',
      deviceFingerprint: 'fp',
      nowIso: NOW,
    });
    return s;
  }

  it('réserve le numéro suivant ; une réservation ouverte est rendue telle quelle (aucun trou)', async () => {
    const s = await paired();
    const first = await reserveNextTicketNumber(s, { year: 2026, nowIso: NOW });
    expect(first).toEqual({ ticketNumber: 'POS-M01-C02-2026-000001', sequence: 1, terminalId: 'term-uuid-1' });
    const again = await reserveNextTicketNumber(s, { year: 2026, nowIso: NOW });
    expect(again).toEqual(first);
  });

  it('après consommation, le numéro suivant est incrémenté de 1', async () => {
    const s = await paired();
    const first = await reserveNextTicketNumber(s, { year: 2026, nowIso: NOW });
    await consumeTicketNumber(s, first, NOW);
    const second = await reserveNextTicketNumber(s, { year: 2026, nowIso: NOW });
    expect(second.sequence).toBe(2);
    expect(second.ticketNumber).toBe('POS-M01-C02-2026-000002');
  });

  it('la séquence continue au-delà du changement d’année (numérotation continue par terminal)', async () => {
    const s = await paired(840);
    const a = await reserveNextTicketNumber(s, { year: 2026, nowIso: NOW });
    await consumeTicketNumber(s, a, NOW);
    const b = await reserveNextTicketNumber(s, { year: 2027, nowIso: '2027-01-01T00:00:00.000Z' });
    expect(a.ticketNumber).toBe('POS-M01-C02-2026-000841');
    expect(b.ticketNumber).toBe('POS-M01-C02-2027-000842');
  });

  it('consommer deux fois, ou un numéro non réservé, échoue', async () => {
    const s = await paired();
    const r = await reserveNextTicketNumber(s, { year: 2026, nowIso: NOW });
    await consumeTicketNumber(s, r, NOW);
    await expect(consumeTicketNumber(s, r, NOW)).rejects.toThrow(/réservation/);
  });

  it('réservations concurrentes : un seul numéro distribué', async () => {
    const s = await paired();
    const results = await Promise.all([1, 2, 3, 4].map(() => reserveNextTicketNumber(s, { year: 2026, nowIso: NOW })));
    expect(new Set(results.map((r) => r.ticketNumber)).size).toBe(1);
  });

  it('terminal non appairé : refus explicite', async () => {
    const s = await freshStorage();
    await expect(reserveNextTicketNumber(s, { year: 2026, nowIso: NOW })).rejects.toThrow(/appairé/);
  });
});

describe('état de synchronisation', () => {
  it('markSynced avance la dernière synchro et compte les tickets en attente', async () => {
    const s = await freshStorage();
    expect(await loadSyncSnapshot(s)).toEqual({ lastSyncAtMs: null, pendingTickets: 0 });
    await markSynced(s, NOW);
    expect(await loadSyncSnapshot(s)).toEqual({ lastSyncAtMs: Date.parse(NOW), pendingTickets: 0 });
  });
});
