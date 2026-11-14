import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockBlindCount } from '../src/closing/blind-count.ts';
import { POS_Z_LABEL, ZClosureError, aggregateSessionTickets, buildZTuple, computeZSha256, sealZClosure, verifyZAggregatesMatchTickets, verifyZChain } from '../src/closing/z-closure.ts';
import { POS_CHAIN_GENESIS, canonicalJsonTuple, sha256HexOfText } from '../src/ticketing/ticket-hash.ts';
import { generateSigningKeyPair } from '../src/ticketing/ticket-signing.ts';
import type { PosStorage } from '../src/storage/ports.ts';
import { NOW, TEST_GRID_PORT, closingHarness, sellThree } from './helpers-closing.ts';
import type { ClosingHarness } from './helpers-closing.ts';

let keyPair: CryptoKeyPair;
beforeAll(async () => {
  keyPair = await generateSigningKeyPair();
});
const open: ClosingHarness[] = [];
afterAll(async () => {
  for (const h of open) await h.storage.close();
});

async function lockedSession(): Promise<ClosingHarness> {
  const h = await closingHarness(keyPair);
  open.push(h);
  await sellThree(h);
  return h;
}
async function lock(h: ClosingHarness): Promise<void> {
  await lockBlindCount({ storage: h.storage, grid: TEST_GRID_PORT, now: () => NOW }, { sessionId: 'sess-1', counts: { 'note-10000': 1 } });
}
const sealDeps = (h: ClosingHarness) => {
  let n = 0;
  return {
    storage: h.storage,
    keyPair: h.keyPair,
    now: () => '2026-11-13T18:05:00.000Z',
    newId: () => {
      n += 1;
      return `z-${String(n)}`;
    },
  };
};

/** Lignes d’essai insérées en SQL : un ticket converti B2B avant Z (exclu) et un retour lié (soustrait). */
async function insertRaw(storage: PosStorage, id: string, kind: 'SALE_B2C' | 'RETURN_REFUND', state: string, v: { ht20: number; vat20: number }): Promise<void> {
  await storage.run(
    `INSERT INTO pos_tickets (id, session_id, terminal_id, terminal_seq_number, issued_at, ticket_kind, origin_ticket_id, ht_20_cents, vat_20_cents, total_ttc_cents, paid_cash_cents,
       qr_conversion_token, b2b_conversion_state, prev_ticket_sha256, ticket_sha256, ecdsa_signature_b64)
     VALUES (?, 'sess-1', 'POS-M01-C01', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sig')`,
    [id, `POS-M01-C01-2026-9000${id}`, NOW, kind, kind === 'RETURN_REFUND' ? 't-1' : null, v.ht20, v.vat20, v.ht20 + v.vat20, v.ht20 + v.vat20, `qr-${id}`, state, '0'.repeat(64), 'b'.repeat(64)],
  );
}

describe('FISCA_POS_Z_V1 : formule et empreinte d’or du propriétaire (ERRATA D-22)', () => {
  it('le tuple est positionnel et l’amorce POS vaut 64 zéros : empreinte d’or da7c6566…d7c2', async () => {
    const tuple = buildZTuple({
      terminalId: 'POS-M01-C01', closureNumber: 1, businessDate: '2026-11-13',
      netB2cHt20Cents: 10000, netB2cVat20Cents: 2000, netB2cHt10Cents: 0, netB2cVat10Cents: 0, netB2cHt0Cents: 0,
      totalStampDutyCents: 30, tpeGrossCents: 0, prevZSha256: POS_CHAIN_GENESIS,
    });
    expect(tuple[0]).toBe(POS_Z_LABEL);
    expect(canonicalJsonTuple(tuple)).toBe('["FISCA_POS_Z_V1","POS-M01-C01",1,"2026-11-13",10000,2000,0,0,0,30,0,"' + '0'.repeat(64) + '"]');
    expect(await sha256HexOfText(canonicalJsonTuple(tuple))).toBe('da7c65662e8e03d044f41f6f91957b6c850e9bc8a54195f36cea8b382691d7c2');
    expect(await computeZSha256({
      terminalId: 'POS-M01-C01', closureNumber: 1, businessDate: '2026-11-13',
      netB2cHt20Cents: 10000, netB2cVat20Cents: 2000, netB2cHt10Cents: 0, netB2cVat10Cents: 0, netB2cHt0Cents: 0,
      totalStampDutyCents: 30, tpeGrossCents: 0, prevZSha256: POS_CHAIN_GENESIS,
    })).toBe('da7c65662e8e03d044f41f6f91957b6c850e9bc8a54195f36cea8b382691d7c2');
  });

  it('même ordre de champs que le hasheur serveur (lecture seule de ledger-hasher.ts)', () => {
    const source = readFileSync(join(import.meta.dirname, '../../api-hono/src/core/ledger-hasher.ts'), 'utf8');
    expect(source).toContain('["FISCA_POS_Z_V1", terminalId, closureNumber, businessDate, netB2cHt20Cents, netB2cVat20Cents, netB2cHt10Cents,');
    expect(source).toContain('netB2cVat10Cents, netB2cHt0Cents, totalStampDutyCents, tpeGrossCents, prevZSha256]');
  });

  it('refuse une amorce qui n’est pas 64 hexadécimaux minuscules', async () => {
    await expect(computeZSha256({
      terminalId: 't', closureNumber: 1, businessDate: '2026-11-13', netB2cHt20Cents: 0, netB2cVat20Cents: 0, netB2cHt10Cents: 0, netB2cVat10Cents: 0, netB2cHt0Cents: 0,
      totalStampDutyCents: 0, tpeGrossCents: 0, prevZSha256: 'GENESIS_HASH_' + '0'.repeat(32),
    })).rejects.toThrowError(TypeError);
  });
});

describe('agrégation des tickets de la session par taux', () => {
  it('somme par taux en centimes (bigint), timbre et TPE brut', async () => {
    const h = await lockedSession();
    const a = await aggregateSessionTickets(h.storage, 'sess-1');
    expect(a).toMatchObject({ ticketCount: 3, ht20: 10000n, vat20: 2000n, ht10: 5000n, vat10: 500n, ht0: 3000n, stamp: 30n, tpeGross: 5500n });
  });

  it('exclut un ticket converti en facture B2B avant Z et soustrait un retour lié', async () => {
    const h = await lockedSession();
    await insertRaw(h.storage, 'conv', 'SALE_B2C', 'CONVERTI_B2B_AVANT_Z', { ht20: 7777, vat20: 1555 });
    await insertRaw(h.storage, 'ret', 'RETURN_REFUND', 'NONE', { ht20: 1000, vat20: 200 });
    const a = await aggregateSessionTickets(h.storage, 'sess-1');
    expect(a.ht20).toBe(9000n);
    expect(a.vat20).toBe(1800n);
    expect(a.ticketCount).toBe(4);
  });
});

describe('scellement de la clôture Z', () => {
  it('exige le comptage verrouillé', async () => {
    const h = await lockedSession();
    await expect(sealZClosure(sealDeps(h), { sessionId: 'sess-1' })).rejects.toMatchObject({ code: 'COUNT_NOT_LOCKED' });
  });

  it('insère la clôture, la signature et passe la session à CLOTURE_TICKET_Z_SCELLEE dans un seul lot', async () => {
    const h = await lockedSession();
    await lock(h);
    const sealed = await sealZClosure(sealDeps(h), { sessionId: 'sess-1' });
    expect(sealed.replayed).toBe(false);
    expect(sealed.closureNumber).toBe(1);
    expect(sealed.prevZSha256).toBe(POS_CHAIN_GENESIS);
    expect(sealed.zSha256).toMatch(/^[0-9a-f]{64}$/);
    const session = (await h.storage.all('SELECT status, closed_at FROM pos_sessions WHERE id = ?', ['sess-1']))[0];
    expect(session?.['status']).toBe('CLOTURE_TICKET_Z_SCELLEE');
    expect(session?.['closed_at']).toBe('2026-11-13T18:05:00.000Z');
    const z = (await h.storage.all('SELECT * FROM pos_z_closures'))[0];
    expect(z?.['net_b2c_ht_20_cents']).toBe(10000);
    expect(z?.['tpe_gross_cents']).toBe(5500);
    expect(z?.['z_sha256']).toBe(sealed.zSha256);
    expect(await verifyZChain(h.storage, h.keyPair.publicKey)).toEqual({ ok: true, count: 1 });
  });

  it('la clôture est immuable (UPDATE / DELETE refusés) et la signature aussi', async () => {
    const h = await lockedSession();
    await lock(h);
    await sealZClosure(sealDeps(h), { sessionId: 'sess-1' });
    await expect(h.storage.run("UPDATE pos_z_closures SET net_b2c_ht_20_cents = 1")).rejects.toThrowError(/interdite/);
    await expect(h.storage.run('DELETE FROM pos_z_closures')).rejects.toThrowError(/interdite/);
    await expect(h.storage.run("UPDATE pos_z_seals SET ecdsa_signature_b64 = 'x'")).rejects.toThrowError(/interdite/);
    await expect(h.storage.run('DELETE FROM pos_z_seals')).rejects.toThrowError(/interdite/);
  });

  it('impossible de vendre après clôture', async () => {
    const h = await lockedSession();
    await lock(h);
    await sealZClosure(sealDeps(h), { sessionId: 'sess-1' });
    await expect(h.issue({ lines: { ht20Cents: 100, vat20Cents: 20, ht10Cents: 0, vat10Cents: 0, ht0Cents: 0 }, payments: { cashCents: 0, cardTpeCents: 120, deliveryAppCents: 0 } })).rejects.toMatchObject({ code: 'SESSION_NOT_OPEN' });
  });

  it('reprise après crash : un lot qui échoue ne laisse rien ; le rejeu clôture une seule fois', async () => {
    const h = await lockedSession();
    await lock(h);
    const failing: PosStorage = { ...h.storage, batch: async () => { throw new Error('coupure pendant le lot'); }, run: (s, p) => h.storage.run(s, p), all: (s, p) => h.storage.all(s, p), close: () => h.storage.close() };
    await expect(sealZClosure({ ...sealDeps(h), storage: failing }, { sessionId: 'sess-1' })).rejects.toThrowError(/coupure/);
    expect(await h.storage.all('SELECT id FROM pos_z_closures')).toHaveLength(0);
    expect((await h.storage.all('SELECT status FROM pos_sessions'))[0]?.['status']).toBe('COMPTAGE_AVEUGLE_PRE_Z');
    const first = await sealZClosure(sealDeps(h), { sessionId: 'sess-1' });
    const again = await sealZClosure(sealDeps(h), { sessionId: 'sess-1' });
    expect(again.replayed).toBe(true);
    expect(again.zSha256).toBe(first.zSha256);
    expect(await h.storage.all('SELECT id FROM pos_z_closures')).toHaveLength(1);
  });

  it('chaînage : la seconde clôture du terminal porte le z_sha256 de la première en prev_z_sha256', async () => {
    const h = await lockedSession();
    await lock(h);
    const first = await sealZClosure(sealDeps(h), { sessionId: 'sess-1' });
    await h.storage.run("INSERT INTO pos_sessions (id, terminal_id, cashier_user_id, opened_at, opening_float_cents, status) VALUES ('sess-2', 'POS-M01-C01', 'u-cashier', ?, 0, 'COMPTAGE_AVEUGLE_PRE_Z')", [NOW]);
    await h.storage.run("UPDATE pos_sessions SET blind_counted_cash_cents = 0 WHERE id = 'sess-2'");
    const second = await sealZClosure({ ...sealDeps(h), newId: () => 'z-b' }, { sessionId: 'sess-2' });
    expect(second.closureNumber).toBe(2);
    expect(second.prevZSha256).toBe(first.zSha256);
    expect(await verifyZChain(h.storage, h.keyPair.publicKey)).toEqual({ ok: true, count: 2 });
  });

  it('détection d’altération : montant modifié, chaînage rompu, signature invalide', async () => {
    const make = async (): Promise<ClosingHarness> => {
      const h = await lockedSession();
      await lock(h);
      await sealZClosure(sealDeps(h), { sessionId: 'sess-1' });
      return h;
    };
    // Altération hors application : on retire le déclencheur dans une copie d’essai pour simuler un SQLite modifié à la main.
    const tamper = async (h: ClosingHarness, sql: string): Promise<void> => {
      await h.storage.run('DROP TRIGGER prevent_pos_z_closure_update');
      await h.storage.run('DROP TRIGGER prevent_pos_z_seal_update');
      await h.storage.run(sql);
    };
    const amount = await make();
    await tamper(amount, 'UPDATE pos_z_closures SET net_b2c_ht_20_cents = 10001');
    expect(await verifyZChain(amount.storage, amount.keyPair.publicKey)).toMatchObject({ ok: false, reason: 'HASH_MISMATCH' });
    const chain = await make();
    await tamper(chain, `UPDATE pos_z_closures SET prev_z_sha256 = '${'c'.repeat(64)}'`);
    expect(await verifyZChain(chain.storage, chain.keyPair.publicKey)).toMatchObject({ ok: false, reason: 'CHAIN_BROKEN' });
    const sig = await make();
    await tamper(sig, "UPDATE pos_z_seals SET ecdsa_signature_b64 = 'AAAA'");
    expect(await verifyZChain(sig.storage, sig.keyPair.publicKey)).toMatchObject({ ok: false, reason: 'SIGNATURE_INVALID' });
  });

  it('recoupement avec les tickets : un ticket glissé après la clôture rend l’agrégat incohérent avec la Z', async () => {
    const h = await lockedSession();
    await lock(h);
    await sealZClosure(sealDeps(h), { sessionId: 'sess-1' });
    expect(await verifyZAggregatesMatchTickets(h.storage)).toEqual({ ok: true, count: 1 });
    await h.storage.run('DROP TRIGGER prevent_pos_ticket_after_session_close');
    await insertRaw(h.storage, 'late', 'SALE_B2C', 'NONE', { ht20: 500, vat20: 100 });
    expect(await verifyZAggregatesMatchTickets(h.storage)).toMatchObject({ ok: false, closureNumber: 1 });
  });

  it('session inconnue : refus typé', async () => {
    const h = await lockedSession();
    await expect(sealZClosure(sealDeps(h), { sessionId: 'sess-unknown' })).rejects.toBeInstanceOf(ZClosureError);
  });
});
