import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../src/storage/memory-storage.ts';
import { runLocalMigrations } from '../src/storage/migrations.ts';
import { pairTerminal } from '../src/pairing/pairing-flow.ts';
import { issueSignedTicket, type TicketIssuerDeps } from '../src/ticketing/ticket-issuer.ts';
import { computeTicketSha256 } from '../src/ticketing/ticket-hash.ts';
import { syncPosBatch, type PosSyncTicket, type PosTerminalDirectory } from '../../../packages/ubl-xades/src/pos/index.ts';
import { memoryStore, RULES_2026 } from '../../../packages/ubl-xades/tests/support/pos-kit.ts';
import { STAMP_RULES, LINES_20 } from './helpers-closing.ts';

const T0 = Date.parse('2026-11-10T08:00:00.000Z');
const COMPANY = 'soc-pos-1';

async function terminal(n: number) {
  const terminalId = `POS-M0${n}-C01`;
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const storage = await createMemoryStorage();
  await runLocalMigrations(storage, new Date(T0).toISOString());
  await pairTerminal({ storage, gateway: { redeemPairingCode: async () => ({ ok: true, terminal: { terminalId, storeCode: `M0${n}`, terminalCode: 'C01', lastIssuedSequence: 0 } }) }, rawCode: 'ABCD2345', deviceFingerprint: `fp${n}`, nowIso: new Date(T0).toISOString() });
  await storage.run("INSERT INTO pos_sessions (id, terminal_id, cashier_user_id, opened_at, opening_float_cents, status) VALUES ('sess-1', ?, 'u', ?, 5000, 'SESSION_OUVERTE_ACTIVE')", [terminalId, new Date(T0).toISOString()]);
  let i = 0;
  let clock = T0;
  const deps: TicketIssuerDeps = { storage, keyPair, stampRules: STAMP_RULES, now: () => new Date((clock += 432_000)).toISOString(), newId: () => `t${n}-${String(++i)}`, newQrToken: () => `qrtoken-${n}-${String(i).padStart(8, '0')}` };
  return { terminalId, keyPair, storage, deps };
}

describe('AUDIT G2 : 3 terminaux hors ligne 72 h, 600 tickets, synchronisation, altération d’un centime', () => {
  it('600 tickets (200 par terminal sur 72 h simulées) : 0 collision, 600 acceptés ; ticket modifié d’un centime refusé', async () => {
    const terms = await Promise.all([1, 2, 3].map(terminal));
    const wire = new Map<string, PosSyncTicket[]>();
    for (const t of terms) {
      for (let k = 0; k < 200; k++) await issueSignedTicket(t.deps, { sessionId: 'sess-1', ticketKind: 'SALE_B2C', lines: LINES_20, payments: { cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 } });
      const rows = await t.storage.all('SELECT * FROM pos_tickets ORDER BY rowid');
      expect(rows.length).toBe(200);
      wire.set(t.terminalId, rows.map((r) => ({
        ticketId: String(r['id']), sessionId: String(r['session_id']), terminalSeqNumber: Number(String(r['terminal_seq_number']).split('-').at(-1)),
        issuedAtIso: String(r['issued_at']), ticketKind: 'SALE_B2C' as const, originTicketId: null,
        ht20Cents: Number(r['ht_20_cents']), vat20Cents: Number(r['vat_20_cents']), ht10Cents: Number(r['ht_10_cents']), vat10Cents: Number(r['vat_10_cents']), ht0Cents: Number(r['ht_0_cents']),
        stampDutyCents: Number(r['stamp_duty_cents']), totalTtcCents: Number(r['total_ttc_cents']), paidCashCents: Number(r['paid_cash_cents']), paidCardTpeCents: Number(r['paid_card_tpe_cents']), paidDeliveryAppCents: Number(r['paid_delivery_app_cents']),
        qrConversionToken: String(r['qr_conversion_token']), prevTicketSha256: String(r['prev_ticket_sha256']), ticketSha256: String(r['ticket_sha256']), ecdsaSignatureB64: String(r['ecdsa_signature_b64']),
      })));
    }
    const jwks = new Map<string, { kty: 'EC'; crv: 'P-256'; x: string; y: string }>();
    for (const t of terms) { const j = await crypto.subtle.exportKey('jwk', t.keyPair.publicKey); jwks.set(t.terminalId, { kty: 'EC', crv: 'P-256', x: String(j.x), y: String(j.y) }); }
    const directory: PosTerminalDirectory = { find: (id) => Promise.resolve(jwks.has(id) ? { terminalId: id, companyId: COMPANY, status: 'ACTIVE', publicKey: { kind: 'jwk', jwk: jwks.get(id)! } } : null) };
    const store = memoryStore();
    const ports = { store, terminals: directory, vatRules: RULES_2026, clock: { nowIso: () => '2026-11-13T09:00:00.000Z' } };
    let accepted = 0;
    const rejectedCodes: string[] = [];
    for (const t of terms) {
      const res = await syncPosBatch(ports, { companyId: COMPANY, terminalId: t.terminalId, tickets: wire.get(t.terminalId)!.slice(0, 100) });
      const res2 = await syncPosBatch(ports, { companyId: COMPANY, terminalId: t.terminalId, tickets: wire.get(t.terminalId)!.slice(100) });
      for (const r of [...res.results, ...res2.results]) { if (r.outcome === 'ACCEPTED') accepted++; else rejectedCodes.push(`${t.terminalId}:${'code' in r ? r.code : r.outcome}`); }
    }
    expect(accepted).toBe(600);
    const keys = new Set([...store.rows.values()].map((r) => `${r.terminalId}#${r.terminalSeqNumber}`));
    expect(keys.size).toBe(600);

    // Altération d'un centime après coup (client malveillant), sur un 201e ticket légitime du terminal 1.
    const t1 = terms[0]!;
    await issueSignedTicket(t1.deps, { sessionId: 'sess-1', ticketKind: 'SALE_B2C', lines: LINES_20, payments: { cashCents: 12000, cardTpeCents: 0, deliveryAppCents: 0 } });
    const r = (await t1.storage.all('SELECT * FROM pos_tickets ORDER BY rowid DESC LIMIT 1'))[0]!;
    const base: PosSyncTicket = { ...wire.get(t1.terminalId)![199]!, ticketId: String(r['id']), terminalSeqNumber: 201, issuedAtIso: String(r['issued_at']), qrConversionToken: String(r['qr_conversion_token']), prevTicketSha256: String(r['prev_ticket_sha256']), ticketSha256: String(r['ticket_sha256']), ecdsaSignatureB64: String(r['ecdsa_signature_b64']) };
    const tamperedKeepHash = { ...base, totalTtcCents: base.totalTtcCents + 1 };
    const a = await syncPosBatch(ports, { companyId: COMPANY, terminalId: t1.terminalId, tickets: [tamperedKeepHash] });
    expect(a.results[0]).toMatchObject({ outcome: 'REJECTED' });
    const reHashed = { ...base, ht20Cents: base.ht20Cents + 1 };
    const newHash = await computeTicketSha256({ ...reHashed, terminalId: t1.terminalId, ticketKind: 'SALE_B2C' });
    const b = await syncPosBatch(ports, { companyId: COMPANY, terminalId: t1.terminalId, tickets: [{ ...reHashed, ticketSha256: newHash }] });
    expect(b.results[0]).toMatchObject({ outcome: 'REJECTED' });
  }, 120_000);
});
