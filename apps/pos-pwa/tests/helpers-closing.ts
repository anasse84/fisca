import { expect } from 'vitest';
import { createMemoryStorage } from '../src/storage/memory-storage.ts';
import { runLocalMigrations } from '../src/storage/migrations.ts';
import type { PosStorage } from '../src/storage/ports.ts';
import { pairTerminal } from '../src/pairing/pairing-flow.ts';
import { issueSignedTicket } from '../src/ticketing/ticket-issuer.ts';
import type { IssuedTicket, TicketInput, TicketIssuerDeps } from '../src/ticketing/ticket-issuer.ts';
import type { CashStampRulePort } from '../src/ticketing/cash-stamp.ts';
import type { Denomination, DenominationGridPort } from '../src/closing/denominations.ts';

export const NOW = '2026-11-13T18:00:00.000Z';
/** Jeu de données de test : le timbre n’existe ici que comme donnée injectée par le port. */
export const STAMP_RULES: CashStampRulePort = { getCashStampRule: async () => ({ ruleId: 'jeu-de-test', rateBps: 25, rounding: 'HALF_UP' }) };

/** Grille de coupures de TEST (le dirham et ses coupures viennent d’un port en production, jamais du code). */
export const TEST_DENOMINATIONS: readonly Denomination[] = [
  { id: 'note-20000', valueCents: 20000, kind: 'banknote' },
  { id: 'note-10000', valueCents: 10000, kind: 'banknote' },
  { id: 'note-5000', valueCents: 5000, kind: 'banknote' },
  { id: 'note-2000', valueCents: 2000, kind: 'banknote' },
  { id: 'coin-1000', valueCents: 1000, kind: 'coin' },
  { id: 'coin-500', valueCents: 500, kind: 'coin' },
  { id: 'coin-100', valueCents: 100, kind: 'coin' },
  { id: 'coin-10', valueCents: 10, kind: 'coin' },
];
export const TEST_GRID_PORT: DenominationGridPort = { listDenominations: async () => TEST_DENOMINATIONS };

export interface ClosingHarness {
  readonly storage: PosStorage;
  readonly keyPair: CryptoKeyPair;
  readonly deps: TicketIssuerDeps;
  readonly issue: (input: Omit<TicketInput, 'sessionId' | 'ticketKind'>) => Promise<IssuedTicket>;
}

export async function closingHarness(keyPair: CryptoKeyPair, openingFloatCents = 5000): Promise<ClosingHarness> {
  const storage = await createMemoryStorage();
  await runLocalMigrations(storage, NOW);
  const outcome = await pairTerminal({
    storage,
    gateway: { redeemPairingCode: async () => ({ ok: true, terminal: { terminalId: 'POS-M01-C01', storeCode: 'M01', terminalCode: 'C01', lastIssuedSequence: 0 } }) },
    rawCode: 'ABCD2345',
    deviceFingerprint: 'fp',
    nowIso: NOW,
  });
  expect(outcome.status).toBe('PAIRED');
  await storage.run("INSERT INTO pos_sessions (id, terminal_id, cashier_user_id, opened_at, opening_float_cents, status) VALUES ('sess-1', 'POS-M01-C01', 'u-cashier', ?, ?, 'SESSION_OUVERTE_ACTIVE')", [NOW, openingFloatCents]);
  let n = 0;
  const deps: TicketIssuerDeps = {
    storage,
    keyPair,
    stampRules: STAMP_RULES,
    now: () => NOW,
    newId: () => {
      n += 1;
      return `t-${String(n)}`;
    },
    newQrToken: () => `qr-${String(n)}`,
  };
  return { storage, keyPair, deps, issue: (input) => issueSignedTicket(deps, { sessionId: 'sess-1', ticketKind: 'SALE_B2C', ...input }) };
}

export const LINES_20 = { ht20Cents: 10000, vat20Cents: 2000, ht10Cents: 0, vat10Cents: 0, ht0Cents: 0 } as const;
export const LINES_10 = { ht20Cents: 0, vat20Cents: 0, ht10Cents: 5000, vat10Cents: 500, ht0Cents: 0 } as const;
export const LINES_0 = { ht20Cents: 0, vat20Cents: 0, ht10Cents: 0, vat10Cents: 0, ht0Cents: 3000 } as const;

/** Trois ventes : 20 % espèces (timbre 30), 10 % carte, 0 % appli de livraison. Espèces en tiroir : 12 030. */
export async function sellThree(h: ClosingHarness): Promise<void> {
  await h.issue({ lines: LINES_20, payments: { cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 } });
  await h.issue({ lines: LINES_10, payments: { cashCents: 0, cardTpeCents: 5500, deliveryAppCents: 0 } });
  await h.issue({ lines: LINES_0, payments: { cashCents: 0, cardTpeCents: 0, deliveryAppCents: 3000 } });
}
