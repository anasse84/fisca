import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../src/storage/memory-storage.ts';
import { runLocalMigrations } from '../src/storage/migrations.ts';
import type { PosStorage } from '../src/storage/ports.ts';
import { pairTerminal } from '../src/pairing/pairing-flow.ts';
import { generateSigningKeyPair } from '../src/ticketing/ticket-signing.ts';
import { verifyTicketChain } from '../src/ticketing/ticket-issuer.ts';
import type { CashStampRulePort } from '../src/ticketing/cash-stamp.ts';
import { OFFLINE_WINDOW_MS, OfflineSalesRefusedError, evaluateOfflineWindow } from '../src/offline/offline-window.ts';
import { addItem } from '../src/sale/cart.ts';
import type { CatalogItem } from '../src/sale/cart.ts';
import { checkoutCart, CheckoutError } from '../src/sale/checkout.ts';
import { computeSettlement } from '../src/sale/settlement.ts';

const NOW = '2026-11-14T08:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const rules: CashStampRulePort = { getCashStampRule: async () => ({ ruleId: 'jeu', rateBps: 25, rounding: 'HALF_UP' }) };
const coffee: CatalogItem = { id: 'a2', name: 'Café', unitPriceTtcCents: 1200, vatRateBps: 2000, quantityStepMilli: 1000 };

let storage: PosStorage | undefined;
afterEach(async () => {
  await storage?.close();
  storage = undefined;
});

async function ready(): Promise<PosStorage> {
  const s = await createMemoryStorage();
  storage = s;
  await runLocalMigrations(s, NOW);
  await pairTerminal({
    storage: s,
    gateway: { redeemPairingCode: async () => ({ ok: true, terminal: { terminalId: 'term-1', storeCode: 'M01', terminalCode: 'C01', lastIssuedSequence: 0 } }) },
    rawCode: 'ABCD2345',
    deviceFingerprint: 'fp',
    nowIso: NOW,
  });
  await s.run("INSERT INTO pos_sessions (id, terminal_id, cashier_user_id, opened_at, opening_float_cents, status) VALUES ('sess-1', 'term-1', 'u1', ?, 0, 'SESSION_OUVERTE_ACTIVE')", [NOW]);
  return s;
}

describe('encaissement : fenêtre 72 h puis issueSignedTicket', () => {
  it('émet un ticket signé depuis le panier ; le timbre vient du port ; rendu monnaie calculé', async () => {
    const s = await ready();
    const keyPair = await generateSigningKeyPair();
    const cart = addItem([], coffee, 1000);
    const settlement = await computeSettlement({ goodsTtcCents: 1200, cardCents: 0, deliveryCents: 0, cashTenderedCents: 2000 }, rules, NOW);
    const deps = { storage: s, keyPair, stampRules: rules, now: () => NOW, newId: () => 'ticket-1', newQrToken: () => 'qr-1' };
    const window = evaluateOfflineWindow({ lastSyncAtMs: NOW_MS - 3_600_000, nowMs: NOW_MS, online: false });
    const result = await checkoutCart({ deps, window, sessionId: 'sess-1', cart, settlement });
    expect(result.ticket.ticketNumber).toBe('POS-M01-C01-2026-000001');
    expect(result.ticket.stampDutyCents).toBe(3);
    expect(result.ticket.totalTtcCents).toBe(1203);
    expect(result.changeCents).toBe(797);
    const row = (await s.all('SELECT ht_20_cents, vat_20_cents, paid_cash_cents, qr_conversion_token, b2b_conversion_state FROM pos_tickets'))[0];
    expect(row).toMatchObject({ ht_20_cents: 1000, vat_20_cents: 200, paid_cash_cents: 1203, qr_conversion_token: 'qr-1', b2b_conversion_state: 'NONE' });
    expect(await verifyTicketChain(s, keyPair.publicKey)).toEqual({ ok: true, count: 1 });
  });

  it('passé 72 h : vente refusée par la règle pure, aucun ticket écrit', async () => {
    const s = await ready();
    const keyPair = await generateSigningKeyPair();
    const cart = addItem([], coffee, 1000);
    const settlement = await computeSettlement({ goodsTtcCents: 1200, cardCents: 1200, deliveryCents: 0, cashTenderedCents: 0 }, rules, NOW);
    const deps = { storage: s, keyPair, stampRules: rules, now: () => NOW, newId: () => 'ticket-1', newQrToken: () => 'qr-1' };
    const window = evaluateOfflineWindow({ lastSyncAtMs: NOW_MS - OFFLINE_WINDOW_MS - 1, nowMs: NOW_MS, online: false });
    await expect(checkoutCart({ deps, window, sessionId: 'sess-1', cart, settlement })).rejects.toBeInstanceOf(OfflineSalesRefusedError);
    expect(await s.all('SELECT id FROM pos_tickets')).toHaveLength(0);
  });

  it('règlement non prêt ou panier vide : CheckoutError', async () => {
    const s = await ready();
    const keyPair = await generateSigningKeyPair();
    const deps = { storage: s, keyPair, stampRules: rules, now: () => NOW, newId: () => 't', newQrToken: () => 'q' };
    const window = evaluateOfflineWindow({ lastSyncAtMs: NOW_MS, nowMs: NOW_MS, online: true });
    const short = await computeSettlement({ goodsTtcCents: 1200, cardCents: 0, deliveryCents: 0, cashTenderedCents: 100 }, rules, NOW);
    await expect(checkoutCart({ deps, window, sessionId: 'sess-1', cart: addItem([], coffee, 1000), settlement: short })).rejects.toMatchObject({ code: 'SETTLEMENT_NOT_READY' });
    await expect(checkoutCart({ deps, window, sessionId: 'sess-1', cart: [], settlement: short })).rejects.toBeInstanceOf(CheckoutError);
  });

  it('refuse un règlement dont le total ne correspond pas au panier', async () => {
    const s = await ready();
    const keyPair = await generateSigningKeyPair();
    const deps = { storage: s, keyPair, stampRules: rules, now: () => NOW, newId: () => 't', newQrToken: () => 'q' };
    const window = evaluateOfflineWindow({ lastSyncAtMs: NOW_MS, nowMs: NOW_MS, online: true });
    const other = await computeSettlement({ goodsTtcCents: 999, cardCents: 999, deliveryCents: 0, cashTenderedCents: 0 }, rules, NOW);
    await expect(checkoutCart({ deps, window, sessionId: 'sess-1', cart: addItem([], coffee, 1000), settlement: other })).rejects.toMatchObject({ code: 'SETTLEMENT_MISMATCH' });
  });
});
