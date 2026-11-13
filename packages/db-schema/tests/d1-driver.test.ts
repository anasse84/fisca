import { describe, expect, it } from 'vitest';
import { InfrastructureError, type SqlStatementParams } from '@fisca/shared-types';
import { createD1TenantDriver } from '../src/index.ts';
import { FakeD1Database } from './fake-d1.ts';

async function code(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof InfrastructureError) {
      return error.code;
    }
    throw error;
  }
  return 'AUCUNE_ERREUR';
}

const CREATE: SqlStatementParams = { sql: 'CREATE TABLE ledger (id TEXT PRIMARY KEY, amount_cents INTEGER NOT NULL, note TEXT)', params: [] };

async function setup(): Promise<{ db: FakeD1Database; driver: ReturnType<typeof createD1TenantDriver> }> {
  const db = new FakeD1Database();
  const driver = createD1TenantDriver('soc-a', db);
  await driver.executeBatchAtomically([CREATE]);
  return { db, driver };
}

describe('pilote D1 (faux D1Database sur node:sqlite)', () => {
  it('le faux D1 prouve la sémantique documentée : batch() est tout ou rien (3e instruction en échec)', async () => {
    const { db } = await setup();
    const insert = (id: string): ReturnType<FakeD1Database['prepare']> =>
      db.prepare('INSERT INTO ledger (id, amount_cents) VALUES (?, ?)').bind(id, 100);
    await expect(db.batch([insert('e1'), insert('e2'), db.prepare('INSERT INTO inconnue (id) VALUES (1)')])).rejects.toThrow(/D1_ERROR/);
    const rows = await db.prepare('SELECT COUNT(*) AS n FROM ledger').all<{ n: number }>();
    expect(rows.results?.[0]?.n).toBe(0);
  });

  it('executeBatchAtomically : un seul batch D1, requêtes paramétrées, totalChanges', async () => {
    const { db, driver } = await setup();
    db.batchSizes.length = 0;
    const result = await driver.executeBatchAtomically([
      { sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e1', 1000] },
      { sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e2', 2000] },
    ]);
    expect(result.totalChanges).toBe(2);
    expect(db.batchSizes).toEqual([2]);
    const rows = await driver.query<{ id: string; amount_cents: number }>({ sql: 'SELECT id, amount_cents FROM ledger WHERE amount_cents > ? ORDER BY id', params: [1500] });
    expect(rows).toEqual([{ id: 'e2', amount_cents: 2000 }]);
  });

  it('3e instruction en échec : INFRA_BATCH_ROLLED_BACK et rien n\'est appliqué', async () => {
    const { driver } = await setup();
    const failing = (): Promise<unknown> =>
      driver.executeBatchAtomically([
        { sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e1', 1] },
        { sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e2', 2] },
        { sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e1', 3] },
      ]);
    expect(await code(failing)).toBe('INFRA_BATCH_ROLLED_BACK');
    expect(await driver.query({ sql: 'SELECT id FROM ledger', params: [] })).toEqual([]);
  });

  it('une valeur hostile est liée, jamais interprétée', async () => {
    const { driver } = await setup();
    const hostile = `x'); DROP TABLE ledger; --`;
    await driver.executeBatchAtomically([{ sql: 'INSERT INTO ledger (id, amount_cents, note) VALUES (?, ?, ?)', params: ['e1', 5, hostile] }]);
    const rows = await driver.query<{ note: string }>({ sql: 'SELECT note FROM ledger WHERE id = ?', params: ['e1'] });
    expect(rows[0]?.note).toBe(hostile);
  });

  it('refuse un paramètre non entier ou hors plage sûre (ADR-03) avant tout accès', async () => {
    const { driver } = await setup();
    expect(await code(() => driver.query({ sql: 'SELECT ?', params: [1.5] }))).toBe('INFRA_SQL_REJECTED');
    expect(await code(() => driver.query({ sql: 'SELECT ?', params: [Number.MAX_SAFE_INTEGER + 2] }))).toBe('INFRA_SQL_REJECTED');
    expect(
      await code(() => driver.executeBatchAtomically([{ sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e9', 0.5] }])),
    ).toBe('INFRA_SQL_REJECTED');
    expect(await driver.query({ sql: 'SELECT id FROM ledger', params: [] })).toEqual([]);
  });

  it('requête invalide : INFRA_SQL_REJECTED ; lot vide : aucun changement', async () => {
    const { driver } = await setup();
    expect(await code(() => driver.query({ sql: 'SELECT * FROM inconnue', params: [] }))).toBe('INFRA_SQL_REJECTED');
    expect(await driver.executeBatchAtomically([])).toEqual({ totalChanges: 0 });
  });

  it('le tenantId est celui de la société', async () => {
    const { driver } = await setup();
    expect(driver.tenantId).toBe('soc-a');
  });
});
