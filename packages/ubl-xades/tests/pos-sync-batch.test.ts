import { describe, expect, it } from 'vitest';
import { POS_CHAIN_GENESIS, syncPosBatch, type PosSyncPorts, type PosSyncTicket, type PosVatRulesPort } from '../src/pos/index.ts';
import { COMPANY, directoryFor, makeChain, makeTicket, memoryStore, newTerminalKeys, RULES_2026, TERMINAL, toBase64, type MemoryStore, type TerminalKeys } from './support/pos-kit.ts';

interface Setup {
  readonly keys: TerminalKeys;
  readonly store: MemoryStore;
  readonly ports: PosSyncPorts;
}
async function setup(rules: PosVatRulesPort = RULES_2026, terminalOverrides = {}): Promise<Setup> {
  const keys = await newTerminalKeys();
  const store = memoryStore();
  return { keys, store, ports: { store, terminals: directoryFor(keys, terminalOverrides), vatRules: rules, clock: { nowIso: () => '2026-11-13T12:00:00.000Z' } } };
}
const run = (s: Setup, tickets: readonly PosSyncTicket[], companyId = COMPANY) => syncPosBatch(s.ports, { companyId, terminalId: TERMINAL, tickets });

describe('syncPosBatch', () => {
  it('lot valide : tous acceptés, insérés en un seul lot atomique', async () => {
    const s = await setup();
    const result = await run(s, await makeChain(s.keys, 3));
    expect(result.results.map((r) => r.outcome)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    expect([result.accepted, result.replayed, result.rejected]).toEqual([3, 0, 0]);
    expect(s.store.inserts).toBe(1);
    expect(s.store.rows.size).toBe(3);
  });
  it('idempotence : même lot rejoué = REPLAYED sans nouvelle écriture', async () => {
    const s = await setup();
    const chain = await makeChain(s.keys, 2);
    await run(s, chain);
    const again = await run(s, chain);
    expect(again.results.map((r) => r.outcome)).toEqual(['REPLAYED', 'REPLAYED']);
    expect(s.store.inserts).toBe(1);
  });
  it('lot qui chevauche : anciens rejoués, nouveaux acceptés dans la continuité', async () => {
    const s = await setup();
    const chain = await makeChain(s.keys, 4);
    await run(s, chain.slice(0, 2));
    const result = await run(s, chain);
    expect(result.results.map((r) => r.outcome)).toEqual(['REPLAYED', 'REPLAYED', 'ACCEPTED', 'ACCEPTED']);
  });
  it('même identifiant avec contenu différent : conflit, RIEN d’écrit', async () => {
    const s = await setup();
    const chain = await makeChain(s.keys, 2);
    await run(s, [chain[0] as PosSyncTicket]);
    const forged = { ...(chain[0] as PosSyncTicket), paidCashCents: 1 };
    await expect(run(s, [forged, chain[1] as PosSyncTicket])).rejects.toMatchObject({ code: 'POS_BATCH_CONFLICT', issues: [{ path: 'tickets[0]', code: 'ticket_conflict' }] });
    expect(s.store.rows.size).toBe(1);
  });
  it('séquence déjà prise par un autre identifiant : conflit', async () => {
    const s = await setup();
    const chain = await makeChain(s.keys, 1);
    await run(s, chain);
    await expect(run(s, [{ ...(chain[0] as PosSyncTicket), ticketId: 'autre' }])).rejects.toMatchObject({ code: 'POS_BATCH_CONFLICT' });
  });
  it('doublon dans le lot : conflit', async () => {
    const s = await setup();
    const [a] = await makeChain(s.keys, 1);
    await expect(run(s, [a as PosSyncTicket, a as PosSyncTicket])).rejects.toMatchObject({ code: 'POS_BATCH_CONFLICT' });
  });
  it('trou de séquence : le ticket et les suivants sont rejetés, le préfixe est conservé', async () => {
    const s = await setup();
    const chain = await makeChain(s.keys, 4);
    const result = await run(s, [chain[0], chain[2], chain[3]] as PosSyncTicket[]);
    expect(result.results.map((r) => [r.outcome, r.code])).toEqual([['ACCEPTED', undefined], ['REJECTED', 'SEQUENCE_GAP'], ['REJECTED', 'PREDECESSOR_REJECTED']]);
    expect(s.store.rows.size).toBe(1);
  });
  it('rupture de chaîne, hash altéré', async () => {
    const s = await setup();
    const chain = await makeChain(s.keys, 3);
    await run(s, [chain[0]] as PosSyncTicket[]);
    const broken = await makeTicket(s.keys, { seq: 2, prev: 'f'.repeat(64) });
    expect((await run(s, [broken])).results[0]?.code).toBe('CHAIN_BREAK');
    const tampered = { ...(chain[1] as PosSyncTicket), totalTtcCents: 12031 };
    expect((await run(s, [tampered])).results[0]?.code).toBe('HASH_MISMATCH');
  });
  it('signature invalide (un centime modifié puis ré-empreinte), autre terminal, format inconnu', async () => {
    const s = await setup();
    const other = await newTerminalKeys();
    const resigned = await makeTicket(other, { seq: 1, prev: POS_CHAIN_GENESIS });
    expect((await run(s, [resigned])).results[0]?.code).toBe('SIGNATURE_INVALID');
    const [good] = await makeChain(s.keys, 1);
    const reHashed = await makeTicket(s.keys, { seq: 1, prev: POS_CHAIN_GENESIS, ht20: 10001, vat20: 2000, total: 12031 });
    expect((await run(s, [{ ...reHashed, ecdsaSignatureB64: (good as PosSyncTicket).ecdsaSignatureB64 }])).results[0]?.code).toBe('SIGNATURE_INVALID');
    expect((await run(s, [{ ...(good as PosSyncTicket), ecdsaSignatureB64: toBase64(Uint8Array.from([1, 2, 3])) }])).results[0]?.code).toBe('SIGNATURE_FORMAT_UNKNOWN');
    expect(s.store.rows.size).toBe(0);
  });
  it('totaux incohérents : TVA fausse et TTC faux rejetés avec code', async () => {
    const s = await setup();
    expect((await run(s, [await makeTicket(s.keys, { seq: 1, prev: POS_CHAIN_GENESIS, vat20: 1999, total: 12029 })])).results[0]?.code).toBe('VAT_MISMATCH');
    expect((await run(s, [await makeTicket(s.keys, { seq: 1, prev: POS_CHAIN_GENESIS, total: 12031 })])).results[0]?.code).toBe('TOTAL_MISMATCH');
    expect(s.store.rows.size).toBe(0);
  });
  it('TVA : arrondi demi-supérieur (HT 5 × 10 % = 0,5 → 1 ; HT 15 × 20 % = 3 ; HT 25 × 10 % = 2,5 → 3)', async () => {
    const s = await setup();
    const half = await makeTicket(s.keys, { seq: 1, prev: POS_CHAIN_GENESIS, ht20: 0, vat20: 0, ht10: 25, vat10: 3, stamp: 0 });
    expect((await run(s, [half])).results[0]?.outcome).toBe('ACCEPTED');
    const down = await makeTicket(s.keys, { seq: 2, prev: half.ticketSha256, ht20: 0, vat20: 0, ht10: 25, vat10: 2, stamp: 0 });
    expect((await run(s, [down])).results[0]?.code).toBe('VAT_MISMATCH');
    const five = await makeTicket(s.keys, { seq: 2, prev: half.ticketSha256, ht20: 0, vat20: 0, ht10: 5, vat10: 1, stamp: 0 });
    expect((await run(s, [five])).results[0]?.outcome).toBe('ACCEPTED');
  });
  it('les taux viennent du port des règles datées : aucun taux codé en dur', async () => {
    const dates: string[] = [];
    const s = await setup({ ratesAt: (date) => (dates.push(date), Promise.resolve({ slot20Bps: 2500, slot10Bps: 1000, slot0Bps: 0 })) });
    const ticket = await makeTicket(s.keys, { seq: 1, prev: POS_CHAIN_GENESIS, ht20: 10000, vat20: 2500, stamp: 0 });
    expect((await run(s, [ticket])).results[0]?.outcome).toBe('ACCEPTED');
    expect(dates).toEqual(['2026-11-13']);
    const none = await setup({ ratesAt: () => Promise.resolve(null) });
    expect((await run(none, [(await makeChain(none.keys, 1))[0] as PosSyncTicket])).results[0]?.code).toBe('RULES_UNAVAILABLE');
    const badRates = await setup({ ratesAt: () => Promise.resolve({ slot20Bps: 2000, slot10Bps: 1000, slot0Bps: 500 }) });
    expect((await run(badRates, [(await makeChain(badRates.keys, 1))[0] as PosSyncTicket])).results[0]?.code).toBe('RULES_UNAVAILABLE');
  });
  it('session inconnue, origine de remboursement inconnue, champs invalides', async () => {
    const s = await setup();
    expect((await run(s, [await makeTicket(s.keys, { seq: 1, prev: POS_CHAIN_GENESIS, session: 'inconnue' })])).results[0]?.code).toBe('SESSION_UNKNOWN');
    expect((await run(s, [await makeTicket(s.keys, { seq: 1, prev: POS_CHAIN_GENESIS, kind: 'RETURN_REFUND', origin: 'tkt-inconnu' })])).results[0]?.code).toBe('ORIGIN_UNKNOWN');
    const noOrigin = await makeTicket(s.keys, { seq: 1, prev: POS_CHAIN_GENESIS, kind: 'RETURN_REFUND' });
    expect((await run(s, [noOrigin])).results[0]?.code).toBe('FIELDS_INVALID');
    expect((await run(s, [{ ...(await makeTicket(s.keys, { seq: 1, prev: POS_CHAIN_GENESIS }))}, ].map((t) => ({ ...t, ht20Cents: Number('1.5') })))).results[0]?.code).toBe('FIELDS_INVALID');
  });
  it('terminal inconnu, désactivé, d’un autre dossier : lot refusé avant tout traitement', async () => {
    const s = await setup();
    await expect(syncPosBatch(s.ports, { companyId: COMPANY, terminalId: 'POS-X', tickets: [] })).rejects.toMatchObject({ code: 'POS_TERMINAL_UNKNOWN' });
    const off = await setup(RULES_2026, { status: 'DECOMMISSIONED' });
    await expect(run(off, await makeChain(off.keys, 1))).rejects.toMatchObject({ code: 'POS_TERMINAL_INACTIVE' });
    await expect(run(s, await makeChain(s.keys, 1), 'soc-autre')).rejects.toMatchObject({ code: 'POS_TERMINAL_COMPANY_MISMATCH' });
    expect(s.store.rows.size).toBe(0);
  });
  it('échec d’écriture : aucun ticket acquitté, erreur POS_SYNC_UNAVAILABLE', async () => {
    const s = await setup();
    s.store.failInsert = true;
    await expect(run(s, await makeChain(s.keys, 2))).rejects.toMatchObject({ code: 'POS_SYNC_UNAVAILABLE' });
    expect(s.store.rows.size).toBe(0);
  });
  it('lot maximal de 200 tickets chaînés : tous acceptés', async () => {
    const s = await setup();
    const result = await run(s, await makeChain(s.keys, 200));
    expect(result.accepted).toBe(200);
  });
});
