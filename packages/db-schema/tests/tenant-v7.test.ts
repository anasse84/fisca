import { createHash, randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TENANT_INDEX_NAMES, TENANT_MIGRATIONS, TENANT_TABLE_NAMES, tenantMigrationPostgresStatements } from '../src/tenant.ts';
import { CHECK_VIOLATION, DualEngines } from './dual-engine.ts';
import { all } from './support.ts';
import { openTenant } from './tenant-support.ts';

/**
 * Migration tenant v7 (T-S1B-11, complément) : table `idempotency_keys`, prouvée sur SQLite (node:sqlite) ET PostgreSQL 16 réels.
 * Les migrations v1 à v6 sont immuables (empreintes figées, recalculées).
 */
const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_t7_${randomBytes(6).toString('hex')}`;

const FROZEN_SHA256 = [
  'a554a3477c4d1e3561b81e72e243fc72e2be519d155a3120a497ef0d93a04f61',
  'bfb09b92f078d2796cc62c0604bbc50d9bf3b5f7dffc3539704b564dca15b581',
  '71c6a880b7c231ff3d005d2d1edcee5ca7956e5c9dcf9e2af44a18c8ef7a1138',
  'f1cc97cfc9eff05135df66a7ae30b6eda31535c76a9eaad0d786e58ec1c1d85f',
  'b6c338fcb3808b9cc210fd73981a3f628e8d7148910de8a2d0c12a77ec1de295',
  '6750637f3351826b8cf4ecf816f46b232b41aad00bb7026c82c99ae86cd5b25f',
] as const;
const V7_SHA256 = 'ac8e45e9e121ebd8a6a0d804688389ec037248f3f9fc5446e8b6c43c4f2e98dd';

const KEY_HASH = 'k'.repeat(64);
const REQUEST_HASH = 'f'.repeat(64);
const CREATED = '2026-11-13T10:00:00.000Z';
const EXPIRES = '2026-11-16T10:00:00.000Z';
const INSERT_SQL = `INSERT INTO idempotency_keys (idempotency_key, request_sha256, response_status, response_body_json, content_type, created_at, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;
/** Valeurs de rejet liées en paramètres (jamais écrites à côté d'un nom de colonne). */
const NON_INTEGER_STATUS = 200.5;
const TEXT_STATUS = 'abc';
const OUT_OF_RANGE_STATUS = 99;
const BODY = '{"bodyBase64":"e30="}';

let client: Client;
let dual: DualEngines;

beforeAll(async () => {
  client = new Client({ connectionString: PG_URL });
  await client.connect();
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  for (const migration of TENANT_MIGRATIONS) {
    for (const statement of tenantMigrationPostgresStatements(migration)) {
      await client.query(statement);
    }
  }
  dual = new DualEngines(client, openTenant);
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  const remaining = await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [SCHEMA]);
  await client.end();
  expect(remaining.rowCount).toBe(0);
});

beforeEach(async () => {
  dual.resetSqlite();
  await client.query('TRUNCATE idempotency_keys');
});

async function insertBoth(params: readonly (string | number | null)[]): Promise<void> {
  for (const engine of dual.engines()) {
    await engine.run(INSERT_SQL, params);
  }
}

describe('migration v7 : forme et immuabilité de v1 à v6', () => {
  const v7 = TENANT_MIGRATIONS[6];

  it('est la septième migration ; les empreintes de v1 à v6 sont inchangées (recalculées)', () => {
    expect(TENANT_MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(v7?.name).toBe('tenant_part7_idempotency_keys');
    for (const [index, expected] of FROZEN_SHA256.entries()) {
      const migration = TENANT_MIGRATIONS[index];
      expect(migration?.expectedSha256Hex).toBe(expected);
      expect(createHash('sha256').update(migration?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex'), `v${index + 1}`).toBe(expected);
    }
  });

  it("l'empreinte de la v7 est celle de upSqlStatements.join(\"\\n\")", () => {
    expect(v7?.expectedSha256Hex).toBe(V7_SHA256);
    expect(createHash('sha256').update(v7?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex')).toBe(V7_SHA256);
  });

  it('crée la table idempotency_keys et son index de purge, sans trigger ni vue', () => {
    expect(v7?.tableNames).toEqual(['idempotency_keys']);
    expect(v7?.indexNames).toEqual(['idx_idempotency_keys_expires_at']);
    expect(v7?.triggerNames ?? []).toEqual([]);
    expect(v7?.viewNames ?? []).toEqual([]);
    expect(TENANT_TABLE_NAMES.at(-1)).toBe('idempotency_keys');
    expect(TENANT_INDEX_NAMES.at(-2)).toBe('idx_idempotency_keys_expires_at');
  });

  it('colonnes, nullités et clé primaire identiques sur SQLite et PostgreSQL', async () => {
    const lite = all(openTenant(), `SELECT name, "notnull" AS not_null, pk FROM pragma_table_info('idempotency_keys') ORDER BY cid`).map(
      (row) => [String(row['name']), Number(row['not_null']), Number(row['pk'])] as const,
    );
    expect(lite).toEqual([
      ['idempotency_key', 0, 1],
      ['request_sha256', 1, 0],
      ['response_status', 0, 0],
      ['response_body_json', 0, 0],
      ['content_type', 0, 0],
      ['created_at', 1, 0],
      ['expires_at', 1, 0],
    ]);
    const pg = await client.query(
      `SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'idempotency_keys' ORDER BY ordinal_position`,
      [SCHEMA],
    );
    expect(pg.rows.map((row: { column_name: string }) => row.column_name)).toEqual(lite.map(([name]) => name));
    const status = pg.rows.find((row: { column_name: string }) => row.column_name === 'response_status');
    expect(status?.data_type).toBe('bigint');
    const pk = await client.query(
      `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [`${SCHEMA}.idempotency_keys`],
    );
    expect(pk.rows.map((row: { attname: string }) => row.attname)).toEqual(['idempotency_key']);
    const index = await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'idx_idempotency_keys_expires_at'`, [SCHEMA]);
    expect(index.rows[0]?.indexdef).toContain('(expires_at)');
  });
});

describe('idempotency_keys : contraintes (mêmes refus sur les deux moteurs)', () => {
  it('accepte une réservation en cours puis une réponse terminée', async () => {
    await insertBoth([KEY_HASH, REQUEST_HASH, null, null, null, CREATED, EXPIRES]);
    await insertBoth(['z'.repeat(64), REQUEST_HASH, 201, BODY, 'application/json', CREATED, EXPIRES]);
    const [lite, pg] = await dual.onBoth((e) => e.rows('SELECT idempotency_key, response_status FROM idempotency_keys ORDER BY idempotency_key'));
    expect(lite).toEqual(pg);
    expect(lite).toHaveLength(2);
  });

  it('refuse un doublon de clé primaire', async () => {
    await insertBoth([KEY_HASH, REQUEST_HASH, null, null, null, CREATED, EXPIRES]);
    const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT_SQL, [KEY_HASH, REQUEST_HASH, null, null, null, CREATED, EXPIRES]));
    expect(lite.message).toContain('UNIQUE');
    expect(pg.code).toBe('23505');
  });

  it('refuse expires_at <= created_at (égal, puis antérieur)', async () => {
    for (const expires of [CREATED, '2026-11-13T09:59:59.000Z']) {
      const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT_SQL, [KEY_HASH, REQUEST_HASH, null, null, null, CREATED, expires]));
      expect(lite.message).toContain('CHECK');
      expect(pg.code).toBe(CHECK_VIOLATION);
    }
  });

  it('refuse un statut non entier, textuel ou hors 100..599 (valeurs liées en paramètres)', async () => {
    for (const status of [NON_INTEGER_STATUS, TEXT_STATUS, OUT_OF_RANGE_STATUS]) {
      const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT_SQL, [KEY_HASH, REQUEST_HASH, status, BODY, null, CREATED, EXPIRES]));
      expect(lite.message, String(status)).toBeTruthy();
      expect(pg.code, String(status)).toMatch(/^(22P02|23514)$/);
    }
  });

  it('refuse un statut sans corps et un corps sans statut', async () => {
    for (const params of [
      [KEY_HASH, REQUEST_HASH, 201, null, null, CREATED, EXPIRES],
      [KEY_HASH, REQUEST_HASH, null, BODY, null, CREATED, EXPIRES],
    ] as const) {
      const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT_SQL, params));
      expect(lite.message).toContain('CHECK');
      expect(pg.code).toBe(CHECK_VIOLATION);
    }
  });

  it('refuse request_sha256, created_at et expires_at NULL', async () => {
    for (const params of [
      [KEY_HASH, null, null, null, null, CREATED, EXPIRES],
      [KEY_HASH, REQUEST_HASH, null, null, null, null, EXPIRES],
      [KEY_HASH, REQUEST_HASH, null, null, null, CREATED, null],
    ] as const) {
      const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT_SQL, params));
      expect(lite.message).toContain('NOT NULL');
      expect(pg.code).toBe('23502');
    }
  });

  it("l'index sur expires_at sert la purge (SQLite : EXPLAIN QUERY PLAN)", () => {
    const plan = all(openTenant(), `EXPLAIN QUERY PLAN DELETE FROM idempotency_keys WHERE expires_at <= ?`, CREATED)
      .map((row) => String(row['detail']))
      .join(' ');
    expect(plan).toContain('idx_idempotency_keys_expires_at');
  });
});
