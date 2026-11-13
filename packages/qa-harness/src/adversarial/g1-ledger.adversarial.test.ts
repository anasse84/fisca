import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TENANT_MIGRATIONS, tenantMigrationPostgresStatements } from '../../../db-schema/src/tenant.ts';
import {
  LEDGER_SEED, posSessionRow, posTicketRow, entryWithLines, insertPostgres, insertSqlite, openTenant, POST_ENTRY_SQL, REVISE_ENTRY_SQL, postParams,
  type RowValues,
} from '../../../db-schema/tests/tenant-support.ts';

/** Tests adverses de l'auditeur, barrière G1 (ERRATA B-10) : grand livre CGNC sur SQLite ET PostgreSQL 16 réels. */
const require = createRequire(new URL('../../../db-schema/package.json', import.meta.url));
const { Client } = require('pg') as { Client: new (o: { connectionString: string }) => PgClient };
interface PgClient { connect(): Promise<void>; end(): Promise<void>; query(sql: string, p?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> }
const URL_PG = 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_adv_${randomBytes(5).toString('hex')}`;
let pg: PgClient;
let lite: DatabaseSync;

type Rows = readonly (readonly [string, RowValues])[];
async function seedBoth(rows: Rows): Promise<void> {
  for (const [t, v] of rows) {
    const s = insertSqlite(t, v); lite.prepare(s.sql).run(...s.params);
    const p = insertPostgres(t, v); await pg.query(p.sql, p.params);
  }
}
async function liteRun(sql: string, params: (string | number | null)[] = []): Promise<string | null> {
  try { lite.prepare(sql).run(...params); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}
async function pgRun(sql: string, params: (string | number | null)[] = []): Promise<string | null> {
  let i = 0; const q = sql.replace(/\?/g, () => `$${(i += 1)}`);
  try { await pg.query(q, params); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}
async function both(sql: string, params: (string | number | null)[] = []): Promise<{ sqlite: string | null; pg: string | null }> {
  return { sqlite: await liteRun(sql, params), pg: await pgRun(sql, params) };
}
/** Visa du chef de mission (REVISEE_CYCLE) puis scellement : le seul chemin légitime depuis la v11. */
async function sealBoth(id: string): Promise<{ sqlite: string | null; pg: string | null }> {
  const r = await both(REVISE_ENTRY_SQL, [id]);
  if (r.sqlite !== null || r.pg !== null) return r;
  return both(POST_ENTRY_SQL, postParams(id));
}
async function reset(): Promise<void> {
  lite = openTenant();
  await pg.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); await pg.query(`CREATE SCHEMA ${SCHEMA}`); await pg.query(`SET search_path TO ${SCHEMA}`);
  for (const m of TENANT_MIGRATIONS) for (const s of tenantMigrationPostgresStatements(m)) await pg.query(s);
  await seedBoth(LEDGER_SEED);
}
beforeAll(async () => { pg = new Client({ connectionString: URL_PG }); await pg.connect(); });
afterAll(async () => { await pg.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); await pg.end(); });

describe('G1 adverse — immuabilité POSTED (Art. 145 CGI)', () => {
  it('déplacer une ligne de brouillon vers une pièce POSTED par UPDATE entry_id est refusé', async () => {
    await reset();
    await seedBoth([...entryWithLines('je-p', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 1000 }, { account: 'acc-7111', credit: 1000 }]),
      ...entryWithLines('je-d', 2, 'jrn-vte', [{ account: 'acc-3421', debit: 500 }, { account: 'acc-7111', credit: 500 }])]);
    expect(await sealBoth('je-p')).toEqual({ sqlite: null, pg: null });
    const r = await both(`UPDATE journal_entry_lines SET entry_id = 'je-p', line_number = 9 WHERE id = 'je-d-l1'`);
    expect.soft(r.sqlite, 'SQLite : ligne injectée dans une pièce POSTED').not.toBeNull();
    expect.soft(r.pg, 'PostgreSQL : ligne injectée dans une pièce POSTED').not.toBeNull();
  });
  it('POSTED : retour pii_restricted_flag 1 -> 0 refusé', async () => {
    await reset();
    await seedBoth(entryWithLines('je-p', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 1000 }, { account: 'acc-7111', credit: 1000 }]));
    await sealBoth('je-p');
    expect(await both(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-p'`)).toEqual({ sqlite: null, pg: null });
    const back = await both(`UPDATE journal_entries SET pii_restricted_flag = 0 WHERE id = 'je-p'`);
    expect(back.sqlite).not.toBeNull(); expect(back.pg).not.toBeNull();
  });
  it('POSTED : modification du total ou de reversal_of_entry_id en même temps que le drapeau refusée', async () => {
    await reset();
    await seedBoth(entryWithLines('je-p', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 1000 }, { account: 'acc-7111', credit: 1000 }]));
    await sealBoth('je-p');
    const r = await both(`UPDATE journal_entries SET pii_restricted_flag = 1, total_debit_cents = 1 WHERE id = 'je-p'`);
    expect(r.sqlite).not.toBeNull(); expect(r.pg).not.toBeNull();
  });
});

describe('G1 adverse — caisse 5161 jamais créditrice', () => {
  it('un crédit de 5161 supérieur au solde est refusé', async () => {
    await reset();
    await seedBoth([...entryWithLines('je-a', 1, 'jrn-cai', [{ account: 'acc-5161', debit: 10000 }, { account: 'acc-1111', credit: 10000 }]),
      ...entryWithLines('je-b', 2, 'jrn-cai', [{ account: 'acc-6111', debit: 10001 }, { account: 'acc-5161', credit: 10001 }])]);
    expect(await sealBoth('je-a')).toEqual({ sqlite: null, pg: null });
    const r = await sealBoth('je-b');
    expect(r.sqlite).toMatch(/5161|CASH|caisse/i); expect(r.pg).toMatch(/5161|CASH|caisse/i);
  });
  it('sous-compte de caisse 51611000 : crédit sans solde refusé', async () => {
    await reset();
    await seedBoth([['cgnc_accounts', { id: 'acc-51611', account_number: '51611000', label_fr: 'Caisse 2', cgnc_class: 5, normal_balance: 'DEBIT' }],
      ...entryWithLines('je-b', 1, 'jrn-cai', [{ account: 'acc-6111', debit: 100 }, { account: 'acc-51611', credit: 100 }])]);
    const r = await sealBoth('je-b');
    expect(r.sqlite).not.toBeNull(); expect(r.pg).not.toBeNull();
  });
  it('PostgreSQL : deux scellements concurrents (solde 10 000, deux crédits de 6 000)', async () => {
    await reset();
    await seedBoth([...entryWithLines('je-a', 1, 'jrn-cai', [{ account: 'acc-5161', debit: 10000 }, { account: 'acc-1111', credit: 10000 }]),
      ...entryWithLines('je-b', 2, 'jrn-cai', [{ account: 'acc-6111', debit: 6000 }, { account: 'acc-5161', credit: 6000 }]),
      ...entryWithLines('je-c', 3, 'jrn-cai', [{ account: 'acc-6111', debit: 6000 }, { account: 'acc-5161', credit: 6000 }])]);
    await sealBoth('je-a');
    await pgRun(REVISE_ENTRY_SQL, ['je-b']); await pgRun(REVISE_ENTRY_SQL, ['je-c']);
    const c1 = new Client({ connectionString: URL_PG }); const c2 = new Client({ connectionString: URL_PG });
    await c1.connect(); await c2.connect();
    await c1.query(`SET search_path TO ${SCHEMA}`); await c2.query(`SET search_path TO ${SCHEMA}`);
    await c1.query('BEGIN'); await c2.query('BEGIN');
    const sql = `UPDATE journal_entries SET status = 'POSTED', validated_at = $1, entry_hash = $2, previous_entry_hash = $3 WHERE id = $4`;
    let e1: string | null = null;
    try { await c1.query(sql, postParams('je-b')); } catch (e) { e1 = String(e); }
    const second = c2.query(sql, postParams('je-c')).then(() => null, (e: unknown) => String(e));
    await new Promise((r) => setTimeout(r, 400));
    await c1.query('COMMIT').catch(() => undefined);
    const e2 = await second;
    await c2.query('COMMIT').catch(() => undefined);
    await c1.end(); await c2.end();
    const bal = await pg.query(`SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS b FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN cgnc_accounts a ON a.id = l.account_id WHERE e.status = 'POSTED' AND a.account_number LIKE '5161%'`);
    expect(Number(bal.rows[0]?.['b']), `solde 5161 final (erreurs: ${e1} / ${e2})`).toBeGreaterThanOrEqual(0);
    expect.soft(e2, 'la seconde connexion doit être refusée').not.toBeNull();
  });
});

describe('G1 adverse — scellement et sens du déplacement de ligne', () => {
  it('DRAFT -> POSTED direct et IA_PROPOSITION -> POSTED sont refusés (v11)', async () => {
    await reset();
    await seedBoth(entryWithLines('je-d', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 1000 }, { account: 'acc-7111', credit: 1000 }]));
    const r = await both(POST_ENTRY_SQL, postParams('je-d'));
    expect.soft(r.sqlite, 'SQLite : DRAFT scellé directement').not.toBeNull();
    expect.soft(r.pg, 'PostgreSQL : DRAFT scellé directement').not.toBeNull();
    await both(`UPDATE journal_entries SET status = 'IA_PROPOSITION' WHERE id = 'je-d'`);
    const r2 = await both(POST_ENTRY_SQL, postParams('je-d'));
    expect.soft(r2.sqlite, 'SQLite : IA_PROPOSITION scellée directement').not.toBeNull();
    expect.soft(r2.pg, 'PostgreSQL : IA_PROPOSITION scellée directement').not.toBeNull();
  });
  it("déplacer une ligne D'UNE pièce POSTED vers un brouillon est refusé", async () => {
    await reset();
    await seedBoth([...entryWithLines('je-p', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 1000 }, { account: 'acc-7111', credit: 1000 }]),
      ...entryWithLines('je-d', 2, 'jrn-vte', [{ account: 'acc-3421', debit: 500 }, { account: 'acc-7111', credit: 500 }])]);
    await sealBoth('je-p');
    const r = await both(`UPDATE journal_entry_lines SET entry_id = 'je-d', line_number = 9 WHERE id = 'je-p-l1'`);
    expect.soft(r.sqlite, "SQLite : ligne sortie d'une pièce POSTED").not.toBeNull();
    expect.soft(r.pg, "PostgreSQL : ligne sortie d'une pièce POSTED").not.toBeNull();
  });
  it("INSERT d'une ligne dans une pièce POSTED, et d'une pièce directement POSTED, refusés", async () => {
    await reset();
    await seedBoth(entryWithLines('je-p', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 1000 }, { account: 'acc-7111', credit: 1000 }]));
    await sealBoth('je-p');
    const mk = { ...(entryWithLines('je-p', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 1 }])[1]![1]), id: 'x-line', line_number: 7 };
    const s = insertSqlite('journal_entry_lines', mk); const p = insertPostgres('journal_entry_lines', mk);
    expect.soft(await liteRun(s.sql, s.params), 'SQLite : ligne insérée dans POSTED').not.toBeNull();
    const q = p.sql;
    let pgErr: string | null = null; try { await pg.query(q, p.params); } catch (e) { pgErr = String(e); }
    expect.soft(pgErr, 'PostgreSQL : ligne insérée dans POSTED').not.toBeNull();
    const direct = entryWithLines('je-x', 5, 'jrn-vte', [{ account: 'acc-3421', debit: 1 }, { account: 'acc-7111', credit: 1 }], { status: 'POSTED', entry_hash: 'a'.repeat(64), previous_entry_hash: 'b'.repeat(64) })[0]![1];
    const ds = insertSqlite('journal_entries', direct); const dp = insertPostgres('journal_entries', direct);
    expect.soft(await liteRun(ds.sql, ds.params), 'SQLite : pièce insérée POSTED').not.toBeNull();
    let pgErr2: string | null = null; try { await pg.query(dp.sql, dp.params); } catch (e) { pgErr2 = String(e); }
    expect.soft(pgErr2, 'PostgreSQL : pièce insérée POSTED').not.toBeNull();
  });
});

describe('G1 adverse — exercice clos', () => {
  it('un brouillon créé avant la clôture ne peut pas être scellé dans un exercice CLOSED', async () => {
    await reset();
    await seedBoth(entryWithLines('je-d', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 1000 }, { account: 'acc-7111', credit: 1000 }]));
    expect(await both(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`)).toEqual({ sqlite: null, pg: null });
    expect(await both(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`)).toEqual({ sqlite: null, pg: null });
    const r = await sealBoth('je-d');
    expect.soft(r.sqlite, 'SQLite : scellement dans un exercice CLOSED').not.toBeNull();
    expect.soft(r.pg, 'PostgreSQL : scellement dans un exercice CLOSED').not.toBeNull();
  });
  it("rattacher un brouillon à un exercice CLOSED par UPDATE fiscal_year_id est refusé", async () => {
    await reset();
    await seedBoth([['fiscal_years', { id: 'fy-2025', code: 'EX-2025', start_date: '2025-01-01', end_date: '2025-12-31' }],
      ...entryWithLines('je-d', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 1000 }, { account: 'acc-7111', credit: 1000 }])]);
    await both(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2025'`);
    await both(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2025'`);
    const r = await both(`UPDATE journal_entries SET fiscal_year_id = 'fy-2025' WHERE id = 'je-d'`);
    expect.soft(r.sqlite, 'SQLite : rattachement à un exercice CLOSED').not.toBeNull(); expect.soft(r.pg, 'PostgreSQL : rattachement à un exercice CLOSED').not.toBeNull();
  });
});

describe('G1 adverse — exercice clos étanche (v9)', () => {
  it('réouverture, retour en CLOSING et DELETE d\'un exercice CLOSED qui porte une pièce POSTED refusés', async () => {
    await reset();
    await seedBoth(entryWithLines('je-p', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 1000 }, { account: 'acc-7111', credit: 1000 }]));
    await sealBoth('je-p');
    await both(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`);
    await both(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`);
    for (const sql of [`UPDATE fiscal_years SET status = 'OPEN' WHERE id = 'fy-2026'`, `UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`, `DELETE FROM fiscal_years WHERE id = 'fy-2026'`]) {
      const r = await both(sql);
      expect.soft(r.sqlite, `SQLite refuse : ${sql}`).not.toBeNull();
      expect.soft(r.pg, `PG refuse : ${sql}`).not.toBeNull();
    }
  });
  it('INSERT d\'une pièce brouillon dans un exercice CLOSED refusé', async () => {
    await reset();
    await both(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`);
    await both(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`);
    const row = entryWithLines('je-n', 9, 'jrn-vte', [{ account: 'acc-3421', debit: 1 }, { account: 'acc-7111', credit: 1 }])[0]![1];
    const s = insertSqlite('journal_entries', row); const p = insertPostgres('journal_entries', row);
    expect.soft(await liteRun(s.sql, s.params), 'SQLite : pièce créée dans exercice CLOSED').not.toBeNull();
    let e: string | null = null; try { await pg.query(p.sql, p.params); } catch (x) { e = String(x); }
    expect.soft(e, 'PostgreSQL : pièce créée dans exercice CLOSED').not.toBeNull();
  });
});

describe('G1 adverse — plan comptable', () => {
  it('renommer le numéro de compte 5161 utilisé par une pièce POSTED est refusé', async () => {
    await reset();
    await seedBoth(entryWithLines('je-a', 1, 'jrn-cai', [{ account: 'acc-5161', debit: 10000 }, { account: 'acc-1111', credit: 10000 }]));
    await sealBoth('je-a');
    const r = await both(`UPDATE cgnc_accounts SET account_number = '99990000' WHERE id = 'acc-5161'`);
    expect.soft(r.sqlite, 'SQLite : compte POSTED renuméroté').not.toBeNull();
    expect.soft(r.pg, 'PostgreSQL : compte POSTED renuméroté').not.toBeNull();
  });
});

describe('G1 adverse — contre-passation unique', () => {
  it('une même pièce POSTED ne peut pas recevoir deux contre-passations (écriture directe)', async () => {
    await reset();
    await seedBoth([...entryWithLines('je-o', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 1000 }, { account: 'acc-7111', credit: 1000 }])]);
    await sealBoth('je-o');
    const rev = (id: string, seq: number): Rows => entryWithLines(id, seq, 'jrn-vte', [{ account: 'acc-7111', debit: 1000 }, { account: 'acc-3421', credit: 1000 }], { source_document_type: 'REVERSAL', reversal_of_entry_id: 'je-o' });
    await seedBoth(rev('je-r1', 2));
    let sqliteErr: string | null = null; let pgErr: string | null = null;
    try { for (const [t, v] of rev('je-r2', 3)) { const s = insertSqlite(t, v); lite.prepare(s.sql).run(...s.params); } } catch (e) { sqliteErr = String(e); }
    try { for (const [t, v] of rev('je-r2', 3)) { const p = insertPostgres(t, v); await pg.query(p.sql, p.params); } } catch (e) { pgErr = String(e); }
    expect.soft(sqliteErr, 'SQLite : seconde contre-passation acceptée').not.toBeNull();
    expect.soft(pgErr, 'PostgreSQL : seconde contre-passation acceptée').not.toBeNull();
  });
});

describe('G1 adverse — POS signé (Art. 145)', () => {
  const POS: Rows = [['pos_sessions', posSessionRow()], ['pos_tickets', posTicketRow()]];
  it('un ticket signé ne change ni montant, ni signature, ni statut inverse ; la conversion ne se fait qu\'une fois', async () => {
    await reset();
    await seedBoth(POS);
    for (const sql of [
      `UPDATE pos_tickets SET total_ttc_cents = total_ttc_cents + 1`,
      `UPDATE pos_tickets SET ecdsa_signature_b64 = 'x'`,
      `UPDATE pos_tickets SET b2b_conversion_state = 'CONVERTI_B2B_AVANT_Z'`,
      `DELETE FROM pos_tickets`,
    ]) {
      const r = await both(sql);
      expect.soft(r.sqlite, `SQLite refuse : ${sql}`).not.toBeNull();
      expect.soft(r.pg, `PG refuse : ${sql}`).not.toBeNull();
    }
  });
});

describe('G1 adverse — réserve : exercice CLOSED vide', () => {
  it.fails('RÉSERVE (non bloquante, passera au vert quand corrigée) : un exercice CLOSED sans aucune pièce ne devrait pas être supprimable', async () => {
    await reset();
    await both(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`);
    await both(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`);
    const r = await both(`DELETE FROM fiscal_years WHERE id = 'fy-2026'`);
    expect.soft(r.sqlite, 'SQLite : exercice CLOSED vide supprimé').not.toBeNull();
    expect.soft(r.pg, 'PostgreSQL : exercice CLOSED vide supprimé').not.toBeNull();
  });
});

describe('G1 adverse — DSAR : drapeau PII sur pièce POSTED d\'un exercice CLOSED', () => {
  it('montée 0 -> 1 admise, retour 1 -> 0 et toute autre colonne refusés (pièce et ligne)', async () => {
    await reset();
    await seedBoth(entryWithLines('je-p', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 1000 }, { account: 'acc-7111', credit: 1000 }]));
    await sealBoth('je-p');
    await both(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`);
    await both(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`);
    expect(await both(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-p'`)).toEqual({ sqlite: null, pg: null });
    expect(await both(`UPDATE journal_entry_lines SET pii_restricted_flag = 1 WHERE id = 'je-p-l1'`)).toEqual({ sqlite: null, pg: null });
    for (const sql of [`UPDATE journal_entries SET pii_restricted_flag = 0 WHERE id = 'je-p'`, `UPDATE journal_entry_lines SET pii_restricted_flag = 0 WHERE id = 'je-p-l1'`,
      `UPDATE journal_entry_lines SET debit_cents = 1 WHERE id = 'je-p-l1'`, `UPDATE journal_entry_lines SET pii_restricted_flag = 1, description_enc = 'x' WHERE id = 'je-p-l2'`]) {
      const r = await both(sql);
      expect.soft(r.sqlite, `SQLite refuse : ${sql}`).not.toBeNull(); expect.soft(r.pg, `PG refuse : ${sql}`).not.toBeNull();
    }
  });
});

describe('G1 adverse — balance à 6 colonnes', () => {
  it('seules les pièces POSTED comptent et la balance est équilibrée au centime', async () => {
    await reset();
    await seedBoth([...entryWithLines('je-1', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 120000 }, { account: 'acc-7111', credit: 100000 }, { account: 'acc-4455', credit: 20000 }]),
      ...entryWithLines('je-2', 2, 'jrn-cai', [{ account: 'acc-5161', debit: 7777 }, { account: 'acc-1111', credit: 7777 }]),
      ...entryWithLines('je-3', 3, 'jrn-cai', [{ account: 'acc-6111', debit: 33 }, { account: 'acc-1111', credit: 33 }])]);
    await sealBoth('je-1'); await sealBoth('je-2');
    const sql = `SELECT COALESCE(SUM(total_debit_cents),0) AS d, COALESCE(SUM(total_credit_cents),0) AS c, COALESCE(SUM(net_balance_cents),0) AS n FROM v_cgnc_trial_balance_6col`;
    const l = lite.prepare(sql).get() as Record<string, number | bigint>;
    const p = (await pg.query(sql)).rows[0] as Record<string, string | number>;
    expect({ d: Number(l['d']), c: Number(l['c']), n: Number(l['n']) }).toEqual({ d: 127777, c: 127777, n: 0 });
    expect({ d: Number(p['d']), c: Number(p['c']), n: Number(p['n']) }).toEqual({ d: 127777, c: 127777, n: 0 });
  });
});
