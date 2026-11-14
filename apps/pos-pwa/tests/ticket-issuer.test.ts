import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../src/storage/memory-storage.ts';
import { runLocalMigrations } from '../src/storage/migrations.ts';
import type { PosStorage, SqlStatement } from '../src/storage/ports.ts';
import { pairTerminal } from '../src/pairing/pairing-flow.ts';
import { reserveNextTicketNumber } from '../src/pairing/ticket-sequencer.ts';
import type { CashStampRule, CashStampRulePort } from '../src/ticketing/cash-stamp.ts';
import { POS_CHAIN_GENESIS } from '../src/ticketing/ticket-hash.ts';
import { generateSigningKeyPair } from '../src/ticketing/ticket-signing.ts';
import { TicketIssuanceError, issueSignedTicket, verifyTicketChain } from '../src/ticketing/ticket-issuer.ts';
import type { TicketInput, TicketIssuerDeps } from '../src/ticketing/ticket-issuer.ts';

const NOW = '2026-11-13T10:15:00.000Z';
/** Jeu de données de test : 25 bps n’existe ici que comme donnée injectée par le port. */
const RULE_DATASET: CashStampRule = { ruleId: 'jeu-de-test', rateBps: 25, rounding: 'HALF_UP' };
const rules: CashStampRulePort = { getCashStampRule: async () => RULE_DATASET };

let storage: PosStorage | undefined;
afterEach(async () => {
  await storage?.close();
  storage = undefined;
});

async function readyStorage(): Promise<PosStorage> {
  const s = await createMemoryStorage();
  storage = s;
  await runLocalMigrations(s, NOW);
  const outcome = await pairTerminal({
    storage: s,
    gateway: { redeemPairingCode: async () => ({ ok: true, terminal: { terminalId: 'term-1', storeCode: 'M01', terminalCode: 'C01', lastIssuedSequence: 0 } }) },
    rawCode: 'ABCD2345',
    deviceFingerprint: 'fp',
    nowIso: NOW,
  });
  expect(outcome.status).toBe('PAIRED');
  await s.run("INSERT INTO pos_sessions (id, terminal_id, cashier_user_id, opened_at, opening_float_cents, status) VALUES ('sess-1', 'term-1', 'u1', ?, 0, 'SESSION_OUVERTE_ACTIVE')", [NOW]);
  return s;
}

let counter = 0;
function deps(s: PosStorage, keyPair: CryptoKeyPair, overrides: Partial<TicketIssuerDeps> = {}): TicketIssuerDeps {
  return {
    storage: s,
    keyPair,
    stampRules: rules,
    now: () => NOW,
    newId: () => {
      counter += 1;
      return `ticket-${counter}`;
    },
    newQrToken: () => `qr-token-${counter}`,
    ...overrides,
  };
}

/** Vente à 20 % : HT 10 000 + TVA 2 000 = 12 000 TTC. */
const sale12000 = (payments: { cashCents: number; cardTpeCents: number; deliveryAppCents: number }): TicketInput => ({
  sessionId: 'sess-1',
  ticketKind: 'SALE_B2C',
  lines: { ht20Cents: 10000, vat20Cents: 2000, ht10Cents: 0, vat10Cents: 0, ht0Cents: 0 },
  payments,
});

describe('ticket signé : numéro, timbre espèces, chaînage, signature', () => {
  it('espèces : timbre 25 bps (donnée injectée) ajouté, numéro POS-MAG-TERM-AAAA-séq6, amorce de 64 zéros, signature vérifiable', async () => {
    const s = await readyStorage();
    const keyPair = await generateSigningKeyPair();
    const ticket = await issueSignedTicket(deps(s, keyPair), sale12000({ cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 }));
    expect(ticket.ticketNumber).toBe('POS-M01-C01-2026-000001');
    expect(ticket.sequence).toBe(1);
    expect(ticket.stampDutyCents).toBe(30);
    expect(ticket.totalTtcCents).toBe(12030);
    expect(ticket.prevTicketSha256).toBe(POS_CHAIN_GENESIS);
    const rows = await s.all('SELECT * FROM pos_tickets');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.['terminal_seq_number']).toBe('POS-M01-C01-2026-000001');
    expect(row?.['stamp_duty_cents']).toBe(30);
    expect(row?.['total_ttc_cents']).toBe(12030);
    expect(row?.['paid_cash_cents']).toBe(12030);
    expect(row?.['ticket_sha256']).toBe(ticket.ticketSha256);
    expect(row?.['ecdsa_signature_b64']).toBe(ticket.signatureB64);
    expect(row?.['prev_ticket_sha256']).toBe('0'.repeat(64));
    expect(await verifyTicketChain(s, keyPair.publicKey)).toEqual({ ok: true, count: 1 });
  });

  it('timbre seulement sur la part espèces : paiement carte seul → 0 ; mixte → timbre sur la part espèces', async () => {
    const s = await readyStorage();
    const keyPair = await generateSigningKeyPair();
    const card = await issueSignedTicket(deps(s, keyPair), sale12000({ cashCents: 0, cardTpeCents: 12000, deliveryAppCents: 0 }));
    expect(card.stampDutyCents).toBe(0);
    expect(card.totalTtcCents).toBe(12000);
    const mixed = await issueSignedTicket(deps(s, keyPair), sale12000({ cashCents: 4000, cardTpeCents: 6000, deliveryAppCents: 2000 }));
    expect(mixed.stampDutyCents).toBe(10);
    expect(mixed.totalTtcCents).toBe(12010);
    const rows = await s.all('SELECT paid_cash_cents, paid_card_tpe_cents, paid_delivery_app_cents, total_ttc_cents FROM pos_tickets ORDER BY rowid');
    expect(rows[1]).toEqual({ paid_cash_cents: 4010, paid_card_tpe_cents: 6000, paid_delivery_app_cents: 2000, total_ttc_cents: 12010 });
  });

  it('cas limites : espèces à 0 centime et à 1 centime de timbre nul', async () => {
    const s = await readyStorage();
    const keyPair = await generateSigningKeyPair();
    const zero = await issueSignedTicket(deps(s, keyPair), {
      sessionId: 'sess-1', ticketKind: 'SALE_B2C',
      lines: { ht20Cents: 0, vat20Cents: 0, ht10Cents: 0, vat10Cents: 0, ht0Cents: 0 },
      payments: { cashCents: 0, cardTpeCents: 0, deliveryAppCents: 0 },
    });
    expect(zero.stampDutyCents).toBe(0);
    const one = await issueSignedTicket(deps(s, keyPair), {
      sessionId: 'sess-1', ticketKind: 'SALE_B2C',
      lines: { ht20Cents: 0, vat20Cents: 0, ht10Cents: 0, vat10Cents: 0, ht0Cents: 1 },
      payments: { cashCents: 1, cardTpeCents: 0, deliveryAppCents: 0 },
    });
    expect(one.stampDutyCents).toBe(0);
    expect(one.totalTtcCents).toBe(1);
    expect(await verifyTicketChain(s, keyPair.publicKey)).toEqual({ ok: true, count: 2 });
  });

  it('refuse les paiements dont la somme ≠ TTC des lignes, et un montant non entier', async () => {
    const s = await readyStorage();
    const keyPair = await generateSigningKeyPair();
    await expect(issueSignedTicket(deps(s, keyPair), sale12000({ cashCents: 11999, cardTpeCents: 0, deliveryAppCents: 0 }))).rejects.toMatchObject({ code: 'PAYMENTS_MISMATCH' });
    await expect(issueSignedTicket(deps(s, keyPair), sale12000({ cashCents: Number('12000.5'), cardTpeCents: 0, deliveryAppCents: 0 }))).rejects.toMatchObject({ code: 'AMOUNT_INVALID' });
    expect(await s.all('SELECT id FROM pos_tickets')).toEqual([]);
  });

  it('sans règle de timbre fournie par le port : refus explicite, aucun ticket, aucun numéro consommé', async () => {
    const s = await readyStorage();
    const keyPair = await generateSigningKeyPair();
    const noRule: CashStampRulePort = { getCashStampRule: async () => null };
    await expect(issueSignedTicket(deps(s, keyPair, { stampRules: noRule }), sale12000({ cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 }))).rejects.toBeInstanceOf(TicketIssuanceError);
    expect(await s.all('SELECT id FROM pos_tickets')).toEqual([]);
    const counter = await s.all('SELECT last_issued_seq FROM pos_sequence_counters');
    expect(counter[0]?.['last_issued_seq']).toBe(0);
  });

  it('chaînage : prev = empreinte du ticket précédent, numérotation continue sans trou, compteur avancé', async () => {
    const s = await readyStorage();
    const keyPair = await generateSigningKeyPair();
    const issued = [];
    for (let i = 0; i < 5; i += 1) {
      issued.push(await issueSignedTicket(deps(s, keyPair), sale12000({ cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 })));
    }
    expect(issued.map((t) => t.sequence)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < issued.length; i += 1) expect(issued[i]?.prevTicketSha256).toBe(issued[i - 1]?.ticketSha256);
    const counter = await s.all('SELECT last_issued_seq FROM pos_sequence_counters');
    expect(counter[0]?.['last_issued_seq']).toBe(5);
    const reservations = await s.all("SELECT seq FROM pos_sequence_reservations WHERE status = 'CONSUMED' ORDER BY seq");
    expect(reservations.map((r) => r['seq'])).toEqual([1, 2, 3, 4, 5]);
    expect(await verifyTicketChain(s, keyPair.publicKey)).toEqual({ ok: true, count: 5 });
  });

  it('changement d’année : la séquence reste continue, seul le segment AAAA change', async () => {
    const s = await readyStorage();
    const keyPair = await generateSigningKeyPair();
    const input = sale12000({ cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 });
    await issueSignedTicket(deps(s, keyPair, { now: () => '2026-12-31T23:59:59.000Z' }), input);
    const next = await issueSignedTicket(deps(s, keyPair, { now: () => '2027-01-01T00:00:01.000Z' }), input);
    expect(next.ticketNumber).toBe('POS-M01-C01-2027-000002');
  });

  it('reprise après crash entre réservation et création : le même numéro est rendu, pas de trou', async () => {
    const s = await readyStorage();
    const keyPair = await generateSigningKeyPair();
    const reserved = await reserveNextTicketNumber(s, { year: 2026, nowIso: NOW });
    expect(reserved.sequence).toBe(1);
    const ticket = await issueSignedTicket(deps(s, keyPair), sale12000({ cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 }));
    expect(ticket.ticketNumber).toBe(reserved.ticketNumber);
    expect(ticket.sequence).toBe(1);
  });

  it('crash pendant l’écriture (lot en échec) : rien n’est écrit, la réservation reste ouverte, la reprise rend le même numéro', async () => {
    const s = await readyStorage();
    const keyPair = await generateSigningKeyPair();
    const failing: PosStorage = {
      run: (sql, params) => s.run(sql, params),
      all: (sql, params) => s.all(sql, params),
      close: () => s.close(),
      batch: async (statements: readonly SqlStatement[]) => {
        if (statements.some((statement) => statement.sql.includes('INSERT INTO pos_tickets'))) throw new Error('crash simulé');
        await s.batch(statements);
      },
    };
    await expect(issueSignedTicket(deps(failing, keyPair), sale12000({ cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 }))).rejects.toThrow(/crash simulé/);
    expect(await s.all('SELECT id FROM pos_tickets')).toEqual([]);
    const open = await s.all("SELECT seq FROM pos_sequence_reservations WHERE status = 'RESERVED'");
    expect(open.map((r) => r['seq'])).toEqual([1]);
    const retry = await issueSignedTicket(deps(s, keyPair), sale12000({ cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 }));
    expect(retry.sequence).toBe(1);
    expect(await s.all('SELECT seq FROM pos_sequence_reservations')).toHaveLength(1);
  });

  it('terminal non appairé ou session non ouverte : refus', async () => {
    const bare = await createMemoryStorage();
    storage = bare;
    await runLocalMigrations(bare, NOW);
    const keyPair = await generateSigningKeyPair();
    await expect(issueSignedTicket(deps(bare, keyPair), sale12000({ cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 }))).rejects.toMatchObject({ code: 'TERMINAL_NOT_PAIRED' });
    await bare.close();
    const s = await readyStorage();
    await expect(issueSignedTicket(deps(s, keyPair), { ...sale12000({ cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 }), sessionId: 'absente' })).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN' });
  });

  it('immuabilité conservée : UPDATE et DELETE d’un ticket émis sont refusés par les déclencheurs, le ticket est mis en file de synchronisation', async () => {
    const s = await readyStorage();
    const keyPair = await generateSigningKeyPair();
    const ticket = await issueSignedTicket(deps(s, keyPair), sale12000({ cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 }));
    await expect(s.run('UPDATE pos_tickets SET total_ttc_cents = 1 WHERE id = ?', [ticket.id])).rejects.toThrow(/VIOLATION_PAF_CGI_ART_145/);
    await expect(s.run('DELETE FROM pos_tickets WHERE id = ?', [ticket.id])).rejects.toThrow(/VIOLATION_PAF_CGI_ART_145/);
    const queue = await s.all('SELECT ticket_id, synced_at FROM pos_ticket_sync_status');
    expect(queue).toEqual([{ ticket_id: ticket.id, synced_at: null }]);
  });

  it('un centime modifié dans le SQLite local est détecté (HASH_MISMATCH) ; une signature d’une autre clé aussi', async () => {
    const s = await readyStorage();
    const keyPair = await generateSigningKeyPair();
    await issueSignedTicket(deps(s, keyPair), sale12000({ cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 }));
    const second = await issueSignedTicket(deps(s, keyPair), sale12000({ cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 }));
    const stranger = await generateSigningKeyPair();
    expect(await verifyTicketChain(s, stranger.publicKey)).toMatchObject({ ok: false, reason: 'SIGNATURE_INVALID' });
    // Falsification hors application : on retire le déclencheur du jeu d’essai pour simuler une base altérée.
    await s.run('DROP TRIGGER prevent_pos_ticket_update');
    await s.run('UPDATE pos_tickets SET total_ttc_cents = total_ttc_cents + 1 WHERE id = ?', [second.id]);
    expect(await verifyTicketChain(s, keyPair.publicKey)).toEqual({ ok: false, reason: 'HASH_MISMATCH', ticketNumber: second.ticketNumber });
  });
});
