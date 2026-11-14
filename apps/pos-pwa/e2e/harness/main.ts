import { connectOpfsWorker } from '../../src/storage/opfs-client.ts';
import { runLocalMigrations } from '../../src/storage/migrations.ts';
import { pairTerminal } from '../../src/pairing/pairing-flow.ts';
import type { PosStorage } from '../../src/storage/ports.ts';
import { createIndexedDbSigningKeyStore, exportPublicKeySpkiB64, loadOrCreateSigningKeyPair } from '../../src/ticketing/ticket-signing.ts';
import { issueSignedTicket, verifyTicketChain } from '../../src/ticketing/ticket-issuer.ts';
import type { CashStampRulePort } from '../../src/ticketing/cash-stamp.ts';
import { lockBlindCount } from '../../src/closing/blind-count.ts';
import { sealZClosure, verifyZAggregatesMatchTickets, verifyZChain } from '../../src/closing/z-closure.ts';
import type { DenominationGridPort } from '../../src/closing/denominations.ts';
import { countPending } from '../../src/sync/sync-queue.ts';

/**
 * Banc de preuve : pilote le code RÉEL (worker OPFS opfs-sahpool, migrations, appairage, émission d'un ticket signé,
 * clé non extractable dans IndexedDB). Les valeurs ci-dessous (règle de timbre, identifiants) sont un jeu de données d'essai.
 */
const NOW = '2026-11-13T10:15:00.000Z';
const TEST_RULE_DATASET: CashStampRulePort = { getCashStampRule: async () => ({ ruleId: 'jeu-de-test-e2e', rateBps: 25, rounding: 'HALF_UP' }) };

let storagePromise: Promise<PosStorage> | null = null;

function openStorage(): Promise<PosStorage> {
  storagePromise ??= connectOpfsWorker(new Worker(new URL('../../src/storage/opfs-worker.ts', import.meta.url), { type: 'module' }));
  return storagePromise;
}

async function initialise(): Promise<{ readonly secureContext: boolean; readonly appliedMigrations: readonly number[] }> {
  const storage = await openStorage();
  const report = await runLocalMigrations(storage, NOW);
  return { secureContext: window.isSecureContext, appliedMigrations: report.applied };
}

async function writeTicket(): Promise<Record<string, unknown>> {
  const storage = await openStorage();
  const outcome = await pairTerminal({
    storage,
    gateway: { redeemPairingCode: async () => ({ ok: true, terminal: { terminalId: 'term-e2e', storeCode: 'M01', terminalCode: 'C01', lastIssuedSequence: 0 } }) },
    rawCode: 'ABCD2345',
    deviceFingerprint: 'fp-e2e',
    nowIso: NOW,
  });
  if (outcome.status !== 'PAIRED') throw new Error(`appairage refusé : ${outcome.reason}`);
  await storage.run("INSERT INTO pos_sessions (id, terminal_id, cashier_user_id, opened_at, opening_float_cents, status) VALUES ('sess-e2e', 'term-e2e', 'u1', ?, 0, 'SESSION_OUVERTE_ACTIVE')", [NOW]);
  const keyPair = await loadOrCreateSigningKeyPair(createIndexedDbSigningKeyStore(indexedDB));
  const ticket = await issueSignedTicket(
    { storage, keyPair, stampRules: TEST_RULE_DATASET, now: () => NOW, newId: () => 'ticket-e2e-1', newQrToken: () => 'qr-e2e-1' },
    { sessionId: 'sess-e2e', ticketKind: 'SALE_B2C', lines: { ht20Cents: 10000, vat20Cents: 2000, ht10Cents: 0, vat10Cents: 0, ht0Cents: 0 }, payments: { cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 } },
  );
  const rows = await storage.all('SELECT * FROM pos_tickets WHERE id = ?', [ticket.id]);
  return { ...(rows[0] ?? {}), publicKeySpkiB64: await exportPublicKeySpkiB64(keyPair) };
}

async function readTickets(): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly chain: unknown; readonly publicKeySpkiB64: string; readonly privateKeyExtractable: boolean }> {
  const storage = await openStorage();
  const rows = await storage.all('SELECT * FROM pos_tickets ORDER BY rowid');
  const keyPair = await loadOrCreateSigningKeyPair(createIndexedDbSigningKeyStore(indexedDB));
  return {
    rows: rows.map((row) => ({ ...row })),
    chain: await verifyTicketChain(storage, keyPair.publicKey),
    publicKeySpkiB64: await exportPublicKeySpkiB64(keyPair),
    privateKeyExtractable: keyPair.privateKey.extractable,
  };
}

/** Grille de coupures du banc d'essai : donnée de test injectée par le port, jamais du code de production. */
const TEST_GRID: DenominationGridPort = {
  listDenominations: async () => [
    { id: 'note-10000', valueCents: 10000, kind: 'banknote' },
    { id: 'coin-500', valueCents: 500, kind: 'coin' },
  ],
};

/** Deux tickets signés, comptage verrouillé, clôture Z scellée : tout sur le vrai OPFS (opfs-sahpool). */
async function closeSessionWithTwoTickets(): Promise<{ readonly zRow: Record<string, unknown>; readonly publicKeySpkiB64: string; readonly pending: { readonly tickets: number; readonly closures: number } }> {
  const storage = await openStorage();
  const outcome = await pairTerminal({
    storage,
    gateway: { redeemPairingCode: async () => ({ ok: true, terminal: { terminalId: 'term-e2e', storeCode: 'M01', terminalCode: 'C01', lastIssuedSequence: 0 } }) },
    rawCode: 'ABCD2345',
    deviceFingerprint: 'fp-e2e',
    nowIso: NOW,
  });
  if (outcome.status !== 'PAIRED') throw new Error(`appairage refusé : ${outcome.reason}`);
  await storage.run("INSERT INTO pos_sessions (id, terminal_id, cashier_user_id, opened_at, opening_float_cents, status) VALUES ('sess-z', 'term-e2e', 'u1', ?, 5000, 'SESSION_OUVERTE_ACTIVE')", [NOW]);
  const keyPair = await loadOrCreateSigningKeyPair(createIndexedDbSigningKeyStore(indexedDB));
  let n = 0;
  const deps = { storage, keyPair, stampRules: TEST_RULE_DATASET, now: () => NOW, newId: () => `ticket-z-${String((n += 1))}`, newQrToken: () => `qr-z-${String(n)}` };
  await issueSignedTicket(deps, { sessionId: 'sess-z', ticketKind: 'SALE_B2C', lines: { ht20Cents: 10000, vat20Cents: 2000, ht10Cents: 0, vat10Cents: 0, ht0Cents: 0 }, payments: { cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 } });
  await issueSignedTicket(deps, { sessionId: 'sess-z', ticketKind: 'SALE_B2C', lines: { ht20Cents: 0, vat20Cents: 0, ht10Cents: 5000, vat10Cents: 500, ht0Cents: 0 }, payments: { cashCents: 0, cardTpeCents: 5500, deliveryAppCents: 0 } });
  await lockBlindCount({ storage, grid: TEST_GRID, now: () => NOW }, { sessionId: 'sess-z', counts: { 'note-10000': 1, 'coin-500': 2 } });
  await sealZClosure({ storage, keyPair, now: () => '2026-11-13T18:05:00.000Z', newId: () => 'z-e2e-1' }, { sessionId: 'sess-z' });
  return { ...(await readClosure()), pending: await countPending(storage) };
}

async function readClosure(): Promise<{ readonly zRow: Record<string, unknown>; readonly publicKeySpkiB64: string; readonly chain: unknown; readonly aggregates: unknown; readonly sessionStatus: string; readonly pending: { readonly tickets: number; readonly closures: number } }> {
  const storage = await openStorage();
  const rows = await storage.all('SELECT c.*, s.ecdsa_signature_b64 FROM pos_z_closures c JOIN pos_z_seals s ON s.closure_id = c.id');
  const keyPair = await loadOrCreateSigningKeyPair(createIndexedDbSigningKeyStore(indexedDB));
  const session = await storage.all("SELECT status FROM pos_sessions WHERE id = 'sess-z'");
  return {
    zRow: { ...(rows[0] ?? {}) },
    publicKeySpkiB64: await exportPublicKeySpkiB64(keyPair),
    chain: await verifyZChain(storage, keyPair.publicKey),
    aggregates: await verifyZAggregatesMatchTickets(storage),
    sessionStatus: String(session[0]?.['status']),
    pending: await countPending(storage),
  };
}

Object.assign(window, { fiscaPosE2E: { initialise, writeTicket, readTickets, closeSessionWithTwoTickets, readClosure } });
const status = document.getElementById('status');
if (status !== null) status.textContent = 'prêt';
