import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpectedCashForbiddenError, BlindCountError, lockBlindCount, revealVariance } from '../src/closing/blind-count.ts';
import type { ExpectedCashAuthorizationPort } from '../src/closing/blind-count.ts';
import { TicketIssuanceError } from '../src/ticketing/ticket-issuer.ts';
import { generateSigningKeyPair } from '../src/ticketing/ticket-signing.ts';
import { LINES_20, NOW, TEST_GRID_PORT, closingHarness, sellThree } from './helpers-closing.ts';
import type { ClosingHarness } from './helpers-closing.ts';

let keyPair: CryptoKeyPair;
beforeAll(async () => {
  keyPair = await generateSigningKeyPair();
});

const supervisor: ExpectedCashAuthorizationPort = { canViewExpectedCash: async (userId) => userId === 'u-supervisor' };
const open: ClosingHarness[] = [];
afterAll(async () => {
  for (const h of open) await h.storage.close();
});
async function ready(): Promise<ClosingHarness> {
  const h = await closingHarness(keyPair);
  open.push(h);
  await sellThree(h);
  return h;
}
const deps = (h: ClosingHarness) => ({ storage: h.storage, grid: TEST_GRID_PORT, now: () => NOW });

describe('comptage aveugle : verrouillage', () => {
  it('le verrouillage enregistre le compté, passe la session en COMPTAGE_AVEUGLE_PRE_Z et ne renvoie JAMAIS l’attendu', async () => {
    const h = await ready();
    const result = await lockBlindCount(deps(h), { sessionId: 'sess-1', counts: { 'note-10000': 1, 'note-5000': 1, 'coin-500': 2, 'coin-10': 3 } });
    expect(result.countedCents).toBe(16030);
    expect(JSON.stringify(result)).not.toMatch(/expected|attendu|variance|ecart/i);
    const row = (await h.storage.all('SELECT status, blind_counted_cash_cents FROM pos_sessions WHERE id = ?', ['sess-1']))[0];
    expect(row?.['status']).toBe('COMPTAGE_AVEUGLE_PRE_Z');
    expect(row?.['blind_counted_cash_cents']).toBe(16030);
  });

  it('l’attendu = fond de caisse + espèces encaissées (timbre compris) ; l’écart est calculé au verrouillage', async () => {
    const h = await ready();
    await lockBlindCount(deps(h), { sessionId: 'sess-1', counts: { 'note-10000': 1, 'note-5000': 1, 'coin-500': 2, 'coin-10': 3 } });
    const row = (await h.storage.all('SELECT expected_closing_cash_cents, cash_variance_cents FROM pos_sessions'))[0];
    expect(row?.['expected_closing_cash_cents']).toBe(5000 + 12030);
    expect(row?.['cash_variance_cents']).toBe(16030 - 17030);
  });

  it('un second verrouillage est refusé : le comptage ne se modifie plus', async () => {
    const h = await ready();
    await lockBlindCount(deps(h), { sessionId: 'sess-1', counts: { 'note-10000': 1 } });
    await expect(lockBlindCount(deps(h), { sessionId: 'sess-1', counts: { 'note-10000': 2 } })).rejects.toMatchObject({ code: 'SESSION_NOT_ACTIVE' });
    const row = (await h.storage.all('SELECT blind_counted_cash_cents FROM pos_sessions'))[0];
    expect(row?.['blind_counted_cash_cents']).toBe(10000);
  });

  it('comptage invalide ou session inconnue : refus typé', async () => {
    const h = await ready();
    await expect(lockBlindCount(deps(h), { sessionId: 'sess-1', counts: { 'note-10000': -2 } })).rejects.toBeInstanceOf(BlindCountError);
    await expect(lockBlindCount(deps(h), { sessionId: 'nope', counts: {} })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('impossible de vendre après verrouillage : l’émetteur refuse et le déclencheur SQL aussi', async () => {
    const h = await ready();
    await lockBlindCount(deps(h), { sessionId: 'sess-1', counts: { 'note-10000': 1 } });
    await expect(h.issue({ lines: LINES_20, payments: { cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 } })).rejects.toBeInstanceOf(TicketIssuanceError);
    await expect(
      h.storage.run(
        `INSERT INTO pos_tickets (id, session_id, terminal_id, terminal_seq_number, issued_at, ticket_kind, total_ttc_cents, paid_cash_cents, qr_conversion_token, prev_ticket_sha256, ticket_sha256, ecdsa_signature_b64)
         VALUES ('x', 'sess-1', 'POS-M01-C01', 'POS-M01-C01-2026-999999', ?, 'SALE_B2C', 1, 1, 'qx', ?, ?, 's')`,
        [NOW, '0'.repeat(64), 'a'.repeat(64)],
      ),
    ).rejects.toThrowError(/session/i);
  });
});

describe('comptage aveugle : révélation de l’écart réservée au rôle autorisé', () => {
  async function locked(): Promise<ClosingHarness> {
    const h = await ready();
    await lockBlindCount(deps(h), { sessionId: 'sess-1', counts: { 'note-10000': 1, 'note-5000': 1, 'coin-500': 2, 'coin-10': 3 } });
    return h;
  }

  it('un caissier (non autorisé) n’obtient rien : refus avant toute lecture', async () => {
    const h = await locked();
    await expect(revealVariance({ storage: h.storage, authorization: supervisor }, { sessionId: 'sess-1', actorUserId: 'u-cashier' })).rejects.toBeInstanceOf(ExpectedCashForbiddenError);
  });

  it('le superviseur obtient compté, attendu et écart (manquant : négatif)', async () => {
    const h = await locked();
    const reveal = await revealVariance({ storage: h.storage, authorization: supervisor }, { sessionId: 'sess-1', actorUserId: 'u-supervisor' });
    expect(reveal).toEqual({ countedCents: 16030, expectedCents: 17030, varianceCents: -1000, kind: 'SHORTAGE' });
  });

  it('excédent et équilibre sont distingués', async () => {
    const h = await ready();
    await lockBlindCount(deps(h), { sessionId: 'sess-1', counts: { 'note-20000': 1 } });
    expect((await revealVariance({ storage: h.storage, authorization: supervisor }, { sessionId: 'sess-1', actorUserId: 'u-supervisor' })).kind).toBe('OVERAGE');
    const h2 = await ready();
    await lockBlindCount(deps(h2), { sessionId: 'sess-1', counts: { 'note-10000': 1, 'note-5000': 1, 'note-2000': 1, 'coin-10': 3 } });
    expect((await revealVariance({ storage: h2.storage, authorization: supervisor }, { sessionId: 'sess-1', actorUserId: 'u-supervisor' })).kind).toBe('BALANCED');
  });

  it('avant verrouillage, même le superviseur ne peut rien révéler', async () => {
    const h = await ready();
    await expect(revealVariance({ storage: h.storage, authorization: supervisor }, { sessionId: 'sess-1', actorUserId: 'u-supervisor' })).rejects.toMatchObject({ code: 'COUNT_NOT_LOCKED' });
  });
});
