import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InfrastructureError } from '@fisca/shared-types';
import {
  convertQuestionPlaceholders,
  createPostgresTenantDriver,
  singleConnectionSource,
  type PgConnectionSource,
  type PgPoolClientLike,
  type PgQueryResultLike,
} from '../src/index.ts';
import { PG_URL, PgSandbox } from './pg-sandbox.ts';

async function codeOf(action: () => Promise<unknown>): Promise<InfrastructureError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof InfrastructureError) {
      return error;
    }
    throw error;
  }
  throw new Error('Une InfrastructureError était attendue.');
}

describe('convertQuestionPlaceholders', () => {
  it('convertit les ? en $n dans l\'ordre', () => {
    expect(convertQuestionPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?', 2)).toBe('SELECT * FROM t WHERE a = $1 AND b = $2');
  });

  it('ne touche ni les littéraux, ni les identifiants entre guillemets, ni les commentaires, ni les dollar-quotes', () => {
    const sql = `SELECT '?' AS a, 'l''?' AS b, "col?" AS c, $q$ ? $q$ AS d, ? AS e -- ?\n, /* ? */ ? AS f`;
    expect(convertQuestionPlaceholders(sql, 2)).toBe(`SELECT '?' AS a, 'l''?' AS b, "col?" AS c, $q$ ? $q$ AS d, $1 AS e -- ?\n, /* ? */ $2 AS f`);
  });

  it('refuse un nombre de ? différent du nombre de paramètres', () => {
    expect(() => convertQuestionPlaceholders('SELECT ?', 2)).toThrow(/INFRA_SQL_REJECTED/);
    expect(() => convertQuestionPlaceholders('SELECT ?, ?', 1)).toThrow(/INFRA_SQL_REJECTED/);
  });
});

describe('pilote PostgreSQL : séquence BEGIN/COMMIT/ROLLBACK (client enregistreur)', () => {
  class Recorder implements PgPoolClientLike {
    readonly texts: string[] = [];
    releases: (Error | boolean | undefined)[] = [];
    constructor(private readonly failOn: (text: string) => Error | null = () => null) {}
    async query(text: string): Promise<PgQueryResultLike> {
      this.texts.push(text);
      const failure = this.failOn(text);
      if (failure) {
        throw failure;
      }
      return { rows: [], rowCount: 0, command: 'SELECT' };
    }
    release(error?: Error | boolean): void {
      this.releases.push(error);
    }
  }
  const sourceOf = (client: Recorder): PgConnectionSource => ({ connect: async () => client });

  it('succès : BEGIN, instructions, COMMIT, connexion rendue', async () => {
    const client = new Recorder();
    const driver = createPostgresTenantDriver('soc-a', sourceOf(client));
    await driver.executeBatchAtomically([
      { sql: 'INSERT INTO t (a) VALUES (?)', params: [1] },
      { sql: 'CREATE TABLE u (id INTEGER)', params: [] },
    ]);
    expect(client.texts).toEqual(['BEGIN', 'INSERT INTO t (a) VALUES ($1)', 'CREATE TABLE u (id INTEGER)', 'COMMIT']);
    expect(client.releases).toEqual([undefined]);
  });

  it('échec : ROLLBACK et INFRA_BATCH_ROLLED_BACK, connexion rendue saine', async () => {
    const client = new Recorder((text) => (text.startsWith('INSERT') ? new Error('boom') : null));
    const driver = createPostgresTenantDriver('soc-a', sourceOf(client));
    const error = await codeOf(() => driver.executeBatchAtomically([{ sql: 'INSERT INTO t (a) VALUES (?)', params: [1] }]));
    expect(error.code).toBe('INFRA_BATCH_ROLLED_BACK');
    expect(client.texts).toEqual(['BEGIN', 'INSERT INTO t (a) VALUES ($1)', 'ROLLBACK']);
    expect(client.releases).toEqual([undefined]);
  });

  it('ROLLBACK lui-même en échec : la connexion est détruite, pas remise au pool', async () => {
    const client = new Recorder((text) => (text === 'ROLLBACK' || text.startsWith('INSERT') ? new Error('coupé') : null));
    const driver = createPostgresTenantDriver('soc-a', sourceOf(client));
    const error = await codeOf(() => driver.executeBatchAtomically([{ sql: 'INSERT INTO t (a) VALUES (?)', params: [1] }]));
    expect(error.code).toBe('INFRA_BATCH_ROLLED_BACK');
    expect(client.releases).toHaveLength(1);
    expect(client.releases[0]).toBeInstanceOf(Error);
  });

  it('refuse un paramètre flottant sans ouvrir de connexion', async () => {
    const client = new Recorder();
    const driver = createPostgresTenantDriver('soc-a', sourceOf(client));
    expect((await codeOf(() => driver.query({ sql: 'SELECT ?', params: [0.1] }))).code).toBe('INFRA_SQL_REJECTED');
    expect((await codeOf(() => driver.executeBatchAtomically([{ sql: 'SELECT ?', params: [0.1] }]))).code).toBe('INFRA_SQL_REJECTED');
    expect(client.texts).toEqual([]);
  });
});

describe('pilote PostgreSQL 16 réel (schéma temporaire)', () => {
  const sandbox = new PgSandbox();
  beforeAll(async () => {
    await sandbox.open();
  });
  afterAll(async () => {
    await sandbox.close();
  });

  it('transaction validée, requêtes paramétrées $n, BIGINT renvoyé en nombre', async () => {
    await sandbox.reset();
    const driver = sandbox.driver('soc-a');
    await driver.executeBatchAtomically([{ sql: 'CREATE TABLE ledger (id TEXT PRIMARY KEY, amount_cents BIGINT NOT NULL, note TEXT)', params: [] }]);
    const result = await driver.executeBatchAtomically([
      { sql: 'INSERT INTO ledger (id, amount_cents, note) VALUES (?, ?, ?)', params: ['e1', 3_000_000_000, 'a'] },
      { sql: 'INSERT INTO ledger (id, amount_cents, note) VALUES (?, ?, ?)', params: ['e2', 2000, null] },
    ]);
    expect(result.totalChanges).toBe(2);
    const rows = await driver.query<{ id: string; amount_cents: number }>({
      sql: 'SELECT id, amount_cents FROM ledger WHERE amount_cents > ? ORDER BY id',
      params: [1500],
    });
    expect(rows).toEqual([
      { id: 'e1', amount_cents: 3_000_000_000 },
      { id: 'e2', amount_cents: 2000 },
    ]);
    const count = await driver.query<{ n: number }>({ sql: 'SELECT COUNT(*) AS n FROM ledger', params: [] });
    expect(count[0]?.n).toBe(2);
  });

  it('un « ? » dans un littéral reste un « ? » ; le paramètre est lié', async () => {
    await sandbox.reset();
    const driver = sandbox.driver('soc-a');
    const rows = await driver.query<{ q: string; p: string }>({
      sql: `SELECT 'pourquoi ?' AS q, CAST(? AS TEXT) AS p`,
      params: ['réponse ?'],
    });
    expect(rows).toEqual([{ q: 'pourquoi ?', p: 'réponse ?' }]);
  });

  it('rollback réel : la 3e instruction échoue, rien n\'est appliqué, la connexion reste utilisable', async () => {
    await sandbox.reset();
    const driver = sandbox.driver('soc-a');
    await driver.executeBatchAtomically([{ sql: 'CREATE TABLE ledger (id TEXT PRIMARY KEY, amount_cents BIGINT NOT NULL)', params: [] }]);
    const error = await codeOf(() =>
      driver.executeBatchAtomically([
        { sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e1', 1] },
        { sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e2', 2] },
        { sql: 'INSERT INTO ledger (id, amount_cents) VALUES (?, ?)', params: ['e1', 3] },
      ]),
    );
    expect(error.code).toBe('INFRA_BATCH_ROLLED_BACK');
    expect(error.message).toContain('23505');
    expect(await driver.query({ sql: 'SELECT id FROM ledger', params: [] })).toEqual([]);
  });

  it('DDL transactionnel : une table créée avant l\'échec disparaît', async () => {
    await sandbox.reset();
    const driver = sandbox.driver('soc-a');
    await codeOf(() =>
      driver.executeBatchAtomically([
        { sql: 'CREATE TABLE temporaire (id INTEGER)', params: [] },
        { sql: 'INSERT INTO inconnue (id) VALUES (1)', params: [] },
      ]),
    );
    const rows = await driver.query({ sql: `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?`, params: ['temporaire'] });
    expect(rows).toEqual([]);
  });

  it('requête rejetée : INFRA_SQL_REJECTED avec le SQLSTATE', async () => {
    await sandbox.reset();
    const driver = sandbox.driver('soc-a');
    const error = await codeOf(() => driver.query({ sql: 'SELECT * FROM inconnue', params: [] }));
    expect(error.code).toBe('INFRA_SQL_REJECTED');
    expect(error.message).toContain('42P01');
  });

  it('BIGINT hors plage sûre : refusé (aucune perte silencieuse)', async () => {
    await sandbox.reset();
    const driver = sandbox.driver('soc-a');
    const error = await codeOf(() => driver.query({ sql: 'SELECT 9223372036854775807::bigint AS big', params: [] }));
    expect(error.code).toBe('INFRA_SQL_REJECTED');
  });

  it('une connexion serialisée sert aussi plusieurs transactions concurrentes sans les entrelacer', async () => {
    await sandbox.reset();
    const driver = sandbox.driver('soc-a');
    await driver.executeBatchAtomically([{ sql: 'CREATE TABLE c (id INTEGER PRIMARY KEY)', params: [] }]);
    await Promise.all(
      [1, 2, 3, 4].map((id) => driver.executeBatchAtomically([{ sql: 'INSERT INTO c (id) VALUES (?)', params: [id] }])),
    );
    const n = await driver.query<{ n: number }>({ sql: 'SELECT COUNT(*) AS n FROM c', params: [] });
    expect(n[0]?.n).toBe(4);
  });

  it('un pg.Pool se branche tel quel (typage structurel) et rend ses connexions', async () => {
    const pool = new Pool({ connectionString: PG_URL, max: 2 });
    try {
      const source: PgConnectionSource = pool;
      const driver = createPostgresTenantDriver('soc-a', source);
      const rows = await driver.query<{ one: number }>({ sql: 'SELECT 1 AS one', params: [] });
      expect(rows).toEqual([{ one: 1 }]);
      await driver.executeBatchAtomically([{ sql: 'SELECT 1', params: [] }]);
      expect(pool.idleCount).toBe(pool.totalCount);
    } finally {
      await pool.end();
    }
  });

  it('singleConnectionSource est exporté pour une connexion unique', () => {
    expect(typeof singleConnectionSource).toBe('function');
  });
});
