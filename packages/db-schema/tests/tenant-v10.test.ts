import { createHash, randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TENANT_INDEX_NAMES, TENANT_MIGRATIONS, TENANT_TABLE_NAMES, tenantMigrationPostgresStatements } from '../src/tenant.ts';
import { CHECK_VIOLATION, DualEngines } from './dual-engine.ts';
import { all } from './support.ts';
import { openTenant } from './tenant-support.ts';

/**
 * Migration tenant v10 (T-S1B-11, arbitrages du propriétaire) : CRÉE `idempotency_records` et RETIRE `idempotency_keys` (v7, qui
 * reste intacte), prouvée sur SQLite (node:sqlite) ET PostgreSQL 16 réels. Les migrations v1 à v9 sont immuables (empreintes figées).
 */
const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_t10_${randomBytes(6).toString('hex')}`;
const SCHEMA_UPGRADE = `fisca_t10u_${randomBytes(6).toString('hex')}`;

const FROZEN_SHA256 = [
  'a554a3477c4d1e3561b81e72e243fc72e2be519d155a3120a497ef0d93a04f61',
  'bfb09b92f078d2796cc62c0604bbc50d9bf3b5f7dffc3539704b564dca15b581',
  '71c6a880b7c231ff3d005d2d1edcee5ca7956e5c9dcf9e2af44a18c8ef7a1138',
  'f1cc97cfc9eff05135df66a7ae30b6eda31535c76a9eaad0d786e58ec1c1d85f',
  'b6c338fcb3808b9cc210fd73981a3f628e8d7148910de8a2d0c12a77ec1de295',
  '6750637f3351826b8cf4ecf816f46b232b41aad00bb7026c82c99ae86cd5b25f',
  'ac8e45e9e121ebd8a6a0d804688389ec037248f3f9fc5446e8b6c43c4f2e98dd',
  'a62dd9d288a801559cad88b7de070d03cc646e1130b2c36d5df4952ae21ee793',
  'aadf6f86982f2068a02885f4c8ab05b230823b7979f00b7222dfff4107d3148f',
] as const;
/** Empreinte figée de la v10. */
const V10_SHA256 = 'e58f870734fa070fc821dc8901350582d7ca45bd22ad111ae094d1682e255f4d';

const KEY_HASH = 'k'.repeat(64);
const REQUEST_HASH = 'f'.repeat(64);
const ACTOR = 'user-1';
const EXPIRES = '2026-11-16T10:00:00.000Z';
const INSERT_SQL = `INSERT INTO idempotency_records (idempotency_key, actor_id, request_sha256, status, response_status, response_body_json, content_type, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const BODY = '{"bodyBase64":"e30="}';
/** Valeurs de rejet liées en paramètres (jamais écrites à côté d'un nom de colonne). */
const NON_INTEGER_STATUS = 200.5;
const TEXT_STATUS = 'abc';
const LOW_STATUS = 99;
const HIGH_STATUS = 600;

type P = string | number | null;
const inFlight = (overrides: Partial<Record<'key' | 'expires', string | null>> = {}): readonly P[] => [
  overrides.key ?? KEY_HASH, ACTOR, REQUEST_HASH, 'IN_FLIGHT', null, null, null, overrides.expires === undefined ? EXPIRES : overrides.expires,
];
const completed = (status: P = 201, body: P = BODY, contentType: P = 'application/json'): readonly P[] => [
  'z'.repeat(64), ACTOR, REQUEST_HASH, 'COMPLETED', status, body, contentType, EXPIRES,
];

let client: Client;
let dual: DualEngines;

beforeAll(async () => {
  client = new Client({ connectionString: PG_URL });
  await client.connect();
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`CREATE SCHEMA ${SCHEMA_UPGRADE}`);
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
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA_UPGRADE} CASCADE`);
  const remaining = await client.query('SELECT 1 FROM pg_namespace WHERE nspname IN ($1, $2)', [SCHEMA, SCHEMA_UPGRADE]);
  await client.end();
  expect(remaining.rowCount).toBe(0);
});

beforeEach(async () => {
  dual.resetSqlite();
  await client.query('TRUNCATE idempotency_records');
});

async function insertBoth(params: readonly P[]): Promise<void> {
  for (const engine of dual.engines()) {
    await engine.run(INSERT_SQL, params);
  }
}

async function expectCheckRefused(params: readonly P[], label: string): Promise<void> {
  const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT_SQL, params));
  expect(lite.message, label).toContain('CHECK');
  expect(pg.code, label).toBe(CHECK_VIOLATION);
}

describe('migration v10 : forme et immuabilité de v1 à v9', () => {
  const v10 = TENANT_MIGRATIONS[9];

  it('est la dixième migration ; les empreintes de v1 à v9 sont inchangées (recalculées)', () => {
    expect(TENANT_MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(v10?.name).toBe('tenant_part10_idempotency_records');
    for (const [index, expected] of FROZEN_SHA256.entries()) {
      const migration = TENANT_MIGRATIONS[index];
      expect(migration?.expectedSha256Hex).toBe(expected);
      expect(createHash('sha256').update(migration?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex'), `v${index + 1}`).toBe(expected);
    }
  });

  it("l'empreinte de la v10 est celle de upSqlStatements.join(\"\\n\"), figée", () => {
    expect(v10?.expectedSha256Hex).toBe(V10_SHA256);
    expect(createHash('sha256').update(v10?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex')).toBe(V10_SHA256);
  });

  it('crée idempotency_records et son index, retire idempotency_keys et son index, sans trigger ni vue', () => {
    expect(v10?.tableNames).toEqual(['idempotency_records']);
    expect(v10?.indexNames).toEqual(['idx_idempotency_records_expires_at']);
    expect(v10?.droppedTableNames).toEqual(['idempotency_keys']);
    expect(v10?.droppedIndexNames).toEqual(['idx_idempotency_keys_expires_at']);
    expect(v10?.triggerNames ?? []).toEqual([]);
    expect(v10?.viewNames ?? []).toEqual([]);
    expect(TENANT_TABLE_NAMES.at(-1)).toBe('idempotency_records');
    expect(TENANT_TABLE_NAMES).not.toContain('idempotency_keys');
    expect(TENANT_INDEX_NAMES.at(-1)).toBe('idx_idempotency_records_expires_at');
    expect(TENANT_INDEX_NAMES).not.toContain('idx_idempotency_keys_expires_at');
  });

  it('la v7 reste inchangée : elle crée toujours idempotency_keys', () => {
    expect(TENANT_MIGRATIONS[6]?.tableNames).toEqual(['idempotency_keys']);
    expect(TENANT_MIGRATIONS[6]?.indexNames).toEqual(['idx_idempotency_keys_expires_at']);
  });

  it('colonnes, nullités et clé primaire identiques sur SQLite et PostgreSQL ; ancienne table absente des deux', async () => {
    const lite = all(openTenant(), `SELECT name, "notnull" AS not_null, pk FROM pragma_table_info('idempotency_records') ORDER BY cid`).map(
      (row) => [String(row['name']), Number(row['not_null']), Number(row['pk'])] as const,
    );
    expect(lite).toEqual([
      ['idempotency_key', 0, 1],
      ['actor_id', 1, 0],
      ['request_sha256', 1, 0],
      ['status', 1, 0],
      ['response_status', 0, 0],
      ['response_body_json', 0, 0],
      ['content_type', 0, 0],
      ['expires_at', 1, 0],
    ]);
    const pg = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'idempotency_records' ORDER BY ordinal_position`,
      [SCHEMA],
    );
    expect(pg.rows.map((row: { column_name: string }) => row.column_name)).toEqual(lite.map(([name]) => name));
    expect(pg.rows.find((row: { column_name: string }) => row.column_name === 'response_status')?.data_type).toBe('bigint');
    const pk = await client.query(
      `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [`${SCHEMA}.idempotency_records`],
    );
    expect(pk.rows.map((row: { attname: string }) => row.attname)).toEqual(['idempotency_key']);
    const index = await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'idx_idempotency_records_expires_at'`, [SCHEMA]);
    expect(index.rows[0]?.indexdef).toContain('(expires_at)');
    const old = await client.query(
      `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname IN ('idempotency_keys', 'idx_idempotency_keys_expires_at')`,
      [SCHEMA],
    );
    expect(old.rowCount).toBe(0);
    const oldLite = all(openTenant(), `SELECT name FROM sqlite_master WHERE name IN ('idempotency_keys', 'idx_idempotency_keys_expires_at')`);
    expect(oldLite).toHaveLength(0);
  });
});

describe('idempotency_records : contraintes (mêmes refus sur les deux moteurs)', () => {
  it('accepte une réservation IN_FLIGHT puis une réponse COMPLETED (avec ou sans content_type)', async () => {
    await insertBoth(inFlight());
    await insertBoth(completed());
    const noType = completed(204, '{"bodyBase64":""}', null);
    await insertBoth(['y'.repeat(64), ...noType.slice(1)]);
    const [lite, pg] = await dual.onBoth((e) => e.rows('SELECT idempotency_key, actor_id, status, response_status FROM idempotency_records ORDER BY idempotency_key'));
    expect(lite).toEqual(pg);
    expect(lite).toHaveLength(3);
  });

  it('refuse un doublon de clé primaire', async () => {
    await insertBoth(inFlight());
    const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT_SQL, inFlight()));
    expect(lite.message).toContain('UNIQUE');
    expect(pg.code).toBe('23505');
  });

  it("refuse un status hors ('IN_FLIGHT', 'COMPLETED')", async () => {
    for (const status of ['DONE', 'in_flight', '']) {
      await expectCheckRefused([KEY_HASH, ACTOR, REQUEST_HASH, status, null, null, null, EXPIRES], status);
    }
  });

  it('COMPLETED exige response_status ET response_body_json ; IN_FLIGHT exige NULL partout', async () => {
    await expectCheckRefused([KEY_HASH, ACTOR, REQUEST_HASH, 'COMPLETED', null, null, null, EXPIRES], 'COMPLETED vide');
    await expectCheckRefused([KEY_HASH, ACTOR, REQUEST_HASH, 'COMPLETED', 201, null, null, EXPIRES], 'COMPLETED sans corps');
    await expectCheckRefused([KEY_HASH, ACTOR, REQUEST_HASH, 'COMPLETED', null, BODY, null, EXPIRES], 'COMPLETED sans statut');
    await expectCheckRefused([KEY_HASH, ACTOR, REQUEST_HASH, 'IN_FLIGHT', 201, null, null, EXPIRES], 'IN_FLIGHT avec statut');
    await expectCheckRefused([KEY_HASH, ACTOR, REQUEST_HASH, 'IN_FLIGHT', null, BODY, null, EXPIRES], 'IN_FLIGHT avec corps');
    await expectCheckRefused([KEY_HASH, ACTOR, REQUEST_HASH, 'IN_FLIGHT', null, null, 'application/json', EXPIRES], 'IN_FLIGHT avec content_type');
  });

  it('refuse un response_status non entier, textuel ou hors 100..599 (valeurs liées en paramètres)', async () => {
    for (const status of [NON_INTEGER_STATUS, TEXT_STATUS, LOW_STATUS, HIGH_STATUS]) {
      const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT_SQL, completed(status)));
      expect(lite.message, String(status)).toBeTruthy();
      expect(pg.code, String(status)).toMatch(/^(22P02|23514)$/);
    }
  });

  it('accepte les bornes 100 et 599', async () => {
    await insertBoth(completed(100));
    await insertBoth(['b'.repeat(64), ...completed(599).slice(1)]);
    const [lite] = await dual.onBoth((e) => e.rows('SELECT response_status FROM idempotency_records ORDER BY response_status'));
    expect(lite?.map((row) => row['response_status'])).toEqual(['100', '599']);
  });

  it('expires_at doit être un instant UTC ISO 8601 à largeur fixe (millisecondes, suffixe Z)', async () => {
    for (const expires of ['2026-11-16', '2026-11-16T10:00:00Z', '2026-11-16 10:00:00.000', '2026-11-16T10:00:00.000+01:00', '2026-11-16T10:00:00.00x', '', 'demain']) {
      await expectCheckRefused(inFlight({ expires }), expires);
    }
  });

  it('refuse actor_id, request_sha256, status et expires_at NULL', async () => {
    for (const params of [
      [KEY_HASH, null, REQUEST_HASH, 'IN_FLIGHT', null, null, null, EXPIRES],
      [KEY_HASH, ACTOR, null, 'IN_FLIGHT', null, null, null, EXPIRES],
      [KEY_HASH, ACTOR, REQUEST_HASH, null, null, null, null, EXPIRES],
      [KEY_HASH, ACTOR, REQUEST_HASH, 'IN_FLIGHT', null, null, null, null],
    ] as const) {
      const [lite, pg] = await dual.onBoth((e) => e.fail(INSERT_SQL, params));
      expect(lite.message).toContain('NOT NULL');
      expect(pg.code).toBe('23502');
    }
  });

  it("l'index sur expires_at sert la purge (SQLite : EXPLAIN QUERY PLAN)", () => {
    const plan = all(openTenant(), `EXPLAIN QUERY PLAN DELETE FROM idempotency_records WHERE expires_at <= ?`, EXPIRES)
      .map((row) => String(row['detail']))
      .join(' ');
    expect(plan).toContain('idx_idempotency_records_expires_at');
  });
});

describe('mise à niveau v9 → v10 (aucune donnée de production avant v1.0.0)', () => {
  const v10 = TENANT_MIGRATIONS[9];

  it('SQLite : la base v9 (idempotency_keys remplie) perd l’ancienne table et son index, gagne la nouvelle', () => {
    const db = openTenant(9);
    db.prepare(
      `INSERT INTO idempotency_keys (idempotency_key, request_sha256, created_at, expires_at) VALUES ('old', 'f', '2026-11-13T10:00:00.000Z', '2026-11-16T10:00:00.000Z')`,
    ).run();
    for (const statement of v10?.upSqlStatements ?? []) {
      db.exec(statement);
    }
    const names = all(db, `SELECT name FROM sqlite_master WHERE name LIKE '%idempotency%' ORDER BY name`).map((row) => String(row['name']));
    expect(names).toEqual(['idempotency_records', 'idx_idempotency_records_expires_at', 'sqlite_autoindex_idempotency_records_1']);
  });

  it('PostgreSQL 16 : même résultat sur un schéma v9 réel', async () => {
    const connection = new Client({ connectionString: PG_URL });
    await connection.connect();
    try {
      await connection.query(`SET search_path TO ${SCHEMA_UPGRADE}`);
      for (const migration of TENANT_MIGRATIONS.filter((candidate) => candidate.version <= 9)) {
        for (const statement of tenantMigrationPostgresStatements(migration)) {
          await connection.query(statement);
        }
      }
      await connection.query(
        `INSERT INTO idempotency_keys (idempotency_key, request_sha256, created_at, expires_at) VALUES ('old', 'f', '2026-11-13T10:00:00.000Z', '2026-11-16T10:00:00.000Z')`,
      );
      for (const statement of v10 === undefined ? [] : tenantMigrationPostgresStatements(v10)) {
        await connection.query(statement);
      }
      const rels = await connection.query(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname LIKE '%idempotency%' AND c.relname NOT LIKE 'state\\_transition%' ORDER BY c.relname`,
        [SCHEMA_UPGRADE],
      );
      expect(rels.rows.map((row: { relname: string }) => row.relname)).toEqual([
        'idempotency_records',
        'idempotency_records_pkey',
        'idx_idempotency_records_expires_at',
      ]);
    } finally {
      await connection.end();
    }
  });

  it('la traduction PostgreSQL garde une instruction par instruction SQLite et pose BIGINT', () => {
    if (v10 === undefined) {
      throw new Error('migration v10 absente');
    }
    const statements = tenantMigrationPostgresStatements(v10);
    expect(statements).toHaveLength(v10.upSqlStatements.length);
    expect(statements[0]).toContain('response_status BIGINT');
    expect(statements.join('\n')).not.toMatch(/GLOB|CAST\(/);
  });
});
