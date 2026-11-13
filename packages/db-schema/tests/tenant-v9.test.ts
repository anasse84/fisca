import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createD1TenantDriver,
  ensureTenantSchemaUpToDate,
  LEDGER_SOURCE_DOCUMENT_TYPES,
  LEDGER_SOURCE_DOCUMENT_TYPES_V3,
  TENANT_INDEX_NAMES,
  TENANT_MIGRATIONS,
  TENANT_POSTGRES_TRIGGER_NAMES,
  TENANT_TRIGGER_NAMES,
  tenantMigrationPostgresStatements,
} from '../src/index.ts';
import { DualEngines, RAISED, toPg, type Engine, type Failure } from './dual-engine.ts';
import { FakeD1Database } from './fake-d1.ts';
import { all } from './support.ts';
import {
  accountRow,
  bankTransactionRow,
  entryRow,
  fiscalYearRow,
  insertSqlite,
  journalRow,
  LEDGER_SEED,
  NON_INTEGER,
  openTenant,
  POST_ENTRY_SQL,
  postParams,
  sealSqlite,
  REVISE_ENTRY_SQL,
  simpleEntry,
  type RowValues,
} from './tenant-support.ts';

/**
 * Migration tenant v9 (arbitrages du propriétaire sur le grand livre, ticket T-S1B-04), prouvée sur SQLite (node:sqlite) ET sur
 * PostgreSQL 16 réels, avec le MÊME texte d'erreur :
 * a. ligne : jamais de déplacement (entry_id), insertion directe POSTED, passage à POSTED ;
 * b. exercice CLOSED étanche (INSERT, UPDATE, DELETE, changement d'exercice, réouverture) ;
 * c. caisse 5161 : colonne cgnc_accounts.posted_balance_cents, CHECK, mise à jour atomique, deux connexions concurrentes ;
 * d. contre-passation : la pièce visée existe et est POSTED ;
 * e. source_document_type : OPENING_BALANCE, VAT_DECLARATION_CENTRALIZATION, FX_REVALUATION.
 * Les migrations v1 à v8 sont immuables : leurs empreintes sont figées ici.
 */
const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_t9_${randomBytes(6).toString('hex')}`;
const SCHEMA_UPGRADE = `fisca_t9u_${randomBytes(6).toString('hex')}`;
const SCHEMA_ROWLOCK = `fisca_t9r_${randomBytes(6).toString('hex')}`;

const FROZEN_SHA256 = [
  'a554a3477c4d1e3561b81e72e243fc72e2be519d155a3120a497ef0d93a04f61',
  'bfb09b92f078d2796cc62c0604bbc50d9bf3b5f7dffc3539704b564dca15b581',
  '71c6a880b7c231ff3d005d2d1edcee5ca7956e5c9dcf9e2af44a18c8ef7a1138',
  'f1cc97cfc9eff05135df66a7ae30b6eda31535c76a9eaad0d786e58ec1c1d85f',
  'b6c338fcb3808b9cc210fd73981a3f628e8d7148910de8a2d0c12a77ec1de295',
  '6750637f3351826b8cf4ecf816f46b232b41aad00bb7026c82c99ae86cd5b25f',
  'ac8e45e9e121ebd8a6a0d804688389ec037248f3f9fc5446e8b6c43c4f2e98dd',
  'a62dd9d288a801559cad88b7de070d03cc646e1130b2c36d5df4952ae21ee793',
] as const;
/** Empreinte figée de la v9 : toute modification de son DDL est une nouvelle migration, pas une retouche. */
const V9_SHA256 = 'aadf6f86982f2068a02885f4c8ab05b230823b7979f00b7222dfff4107d3148f';

const MSG_LINE_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Modification de ligne interdite sur pièce POSTED.';
const MSG_LINE_MOVE = 'CGNC_LINE_ENTRY_IMMUTABLE: Une ligne ne change jamais de pièce.';
const MSG_ENTRY_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Écriture validée immuable. Utilisez une contre-passation.';
const MSG_DIRECT_POSTED = 'VIOLATION_PAF_CGI_ART_145: Insertion directe au statut POSTED interdite. Créez la pièce en brouillon puis validez-la.';
const MSG_FY_CLOSED = 'CGNC_FISCAL_YEAR_CLOSED: Écriture refusée car cet exercice est clos.';
const MSG_FY_CHANGE = 'CGNC_FISCAL_YEAR_IMMUTABLE: Une pièce ne change jamais d exercice.';
const MSG_FY_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Exercice clos immuable. Ouvrez un nouvel exercice.';
const MSG_NEGATIVE_CASH = 'CGNC_NEGATIVE_CASH_5161: Décaissement refusé car il rendrait le solde de caisse 5161 créditeur.';
const MSG_CASH_CHECK = 'new row for relation "cgnc_accounts" violates check constraint "cgnc_accounts_cash_5161_nonnegative_check"';
const MSG_POST_ONLY_FROM_REVISED_CYCLE = 'CGNC_POST_ONLY_FROM_REVISED_CYCLE: Une pièce ne passe à POSTED que depuis REVISEE_CYCLE (visa du chef de mission).';
const MSG_REVERSAL_TARGET = 'CGNC_REVERSAL_TARGET_INVALID: La pièce contre-passée doit exister et être POSTED.';
const SOURCE_TYPES_CHECK = 'journal_entries_source_document_type_check';

const V9_TRIGGERS = [
  'enforce_cash_5161_posted_balance_insert',
  'enforce_cash_5161_posted_balance_update',
  'enforce_balance_and_positive_cash_on_post',
  'prevent_entry_update_in_closed_fiscal_year',
  'prevent_entry_delete_in_closed_fiscal_year',
  'enforce_reversal_target_posted_insert',
  'enforce_reversal_target_posted_update',
  'prevent_posted_lines_mutation_update',
] as const;
const V9_SQLITE_ONLY_TRIGGERS = ['enforce_cash_5161_posted_balance_insert', 'enforce_cash_5161_posted_balance_update'] as const;
const NEW_SOURCE_TYPES = ['OPENING_BALANCE', 'VAT_DECLARATION_CENTRALIZATION', 'FX_REVALUATION'] as const;
const OLD_SOURCE_TYPES = ['INVOICE', 'CREDIT_NOTE', 'POS_Z_CLOSURE', 'B2C_TO_B2B_REVERSAL', 'PAYMENT', 'VAT_CLEARING', 'CUTOFF_OD', 'REVERSAL'] as const;

const RESET_ALL = `TRUNCATE archival_packages, payroll_annual_subledger, journal_entry_lines, journal_entries, bank_transactions,
  fixed_assets_register, journals, cgnc_accounts, fiscal_years, pos_z_closures, pos_tickets, pos_sessions, invoice_lines,
  invoice_delivery_links, invoices, delivery_notes, purchase_orders, fiscal_partners, tenant_key_grants CASCADE`;

let client: Client;
let dual: DualEngines;

async function connect(schema: string = SCHEMA): Promise<Client> {
  const connection = new Client({ connectionString: PG_URL });
  await connection.connect();
  await connection.query(`SET search_path TO ${schema}`);
  return connection;
}

beforeAll(async () => {
  const admin = new Client({ connectionString: PG_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.query(`CREATE SCHEMA ${SCHEMA_UPGRADE}`);
  await admin.query(`CREATE SCHEMA ${SCHEMA_ROWLOCK}`);
  await admin.end();
  client = await connect();
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
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA_ROWLOCK} CASCADE`);
  const remaining = await client.query('SELECT 1 FROM pg_namespace WHERE nspname IN ($1, $2, $3)', [SCHEMA, SCHEMA_UPGRADE, SCHEMA_ROWLOCK]);
  await client.end();
  expect(remaining.rowCount).toBe(0);
});

async function insertAll(engine: Engine, rows: readonly (readonly [string, RowValues])[]): Promise<void> {
  for (const [table, values] of rows) {
    const { sql, params } = insertSqlite(table, values);
    await engine.run(sql, params);
  }
}

async function seedBoth(rows: readonly (readonly [string, RowValues])[]): Promise<void> {
  for (const engine of dual.engines()) {
    await insertAll(engine, rows);
  }
}

async function runBoth(sql: string, params: readonly (string | number | null)[] = []): Promise<void> {
  for (const engine of dual.engines()) {
    await engine.run(sql, params);
  }
}

function expectSame(results: readonly [Failure, Failure], message: string): void {
  expect(results[0].message).toBe(message);
  expect(results[1].message).toBe(message);
  expect(results[0].code).toBeNull();
  expect(results[1].code).toBe(RAISED);
}

async function failBoth(sql: string, message: string, params: readonly (string | number | null)[] = []): Promise<void> {
  expectSame(await dual.onBoth((e) => e.fail(sql, params)), message);
}

async function failInsertBoth(rows: readonly (readonly [string, RowValues])[], message: string): Promise<void> {
  const header = rows[0];
  if (header === undefined) {
    throw new Error('en-tête absent');
  }
  const { sql, params } = insertSqlite(header[0], header[1]);
  await failBoth(sql, message, params);
}

async function expectEqualRows(sql: string, expected: readonly Record<string, string | number | null>[]): Promise<void> {
  const [lite, pg] = await dual.onBoth((e) => e.rows(sql));
  expect(lite).toEqual(expected);
  expect(pg).toEqual(expected);
}

function names(db: DatabaseSync, type: 'table' | 'trigger' | 'index'): string[] {
  return all(db, `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`, type).map((row) => String(row['name']));
}

async function seal(id: string): Promise<void> {
  await runBoth(REVISE_ENTRY_SQL, [id]);
  await runBoth(POST_ENTRY_SQL, postParams(id));
}

function sqliteRun(db: DatabaseSync, rows: readonly (readonly [string, RowValues])[]): void {
  for (const [table, values] of rows) {
    const { sql, params } = insertSqlite(table, values);
    db.prepare(sql).run(...params);
  }
}

async function pgRun(connection: Client, rows: readonly (readonly [string, RowValues])[]): Promise<void> {
  for (const [table, values] of rows) {
    const { sql, params } = insertSqlite(table, values);
    await connection.query(toPg(sql), [...params]);
  }
}

describe('migration v9 : forme, immuabilité de v1 à v8, objets créés', () => {
  const v9 = TENANT_MIGRATIONS[8];

  it('est la neuvième migration ; les empreintes de v1 à v8 sont inchangées (recalculées)', () => {
    expect(TENANT_MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(v9?.name).toBe('tenant_part9_ledger_cash_balance_closed_year_source_types');
    for (const [index, expected] of FROZEN_SHA256.entries()) {
      const migration = TENANT_MIGRATIONS[index];
      expect(migration?.expectedSha256Hex).toBe(expected);
      expect(createHash('sha256').update(migration?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex'), `v${index + 1}`).toBe(expected);
    }
  });

  it('l\'empreinte de la v9 est celle de upSqlStatements.join("\\n"), figée', () => {
    expect(v9?.expectedSha256Hex).toBe(V9_SHA256);
    expect(createHash('sha256').update(v9?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex')).toBe(v9?.expectedSha256Hex);
  });

  it('crée les triggers du registre (deux sont portés par SQLite seul), aucune table ; les index recréés ne sont pas de nouveaux index', () => {
    expect(v9?.triggerNames).toEqual([...V9_TRIGGERS]);
    expect(v9?.sqliteOnlyTriggerNames).toEqual([...V9_SQLITE_ONLY_TRIGGERS]);
    expect(v9?.postgresConstraintNames).toEqual(['cgnc_accounts_cash_5161_nonnegative_check']);
    expect(v9?.tableNames).toEqual([]);
    expect(v9?.indexNames).toEqual([]);
    expect(TENANT_INDEX_NAMES.at(-2)).toBe('uq_journal_entries_reversal_of');
  });

  it('la traduction PostgreSQL garde une instruction par instruction SQLite, pose la colonne BIGINT et nomme la contrainte du type source', () => {
    if (v9 === undefined) {
      throw new Error('migration v9 absente');
    }
    const statements = tenantMigrationPostgresStatements(v9);
    expect(statements).toHaveLength(v9.upSqlStatements.length);
    const pg = statements.join('\n');
    expect(pg).not.toMatch(/\bINTEGER\b/);
    expect(pg).not.toMatch(/CAST\(posted_balance_cents AS INTEGER\)/);
    expect(pg).toContain('ADD COLUMN posted_balance_cents BIGINT NOT NULL DEFAULT 0');
    expect(pg).toContain('ADD CONSTRAINT cgnc_accounts_cash_5161_nonnegative_check');
    expect(pg).toContain(`DROP CONSTRAINT ${SOURCE_TYPES_CHECK}`);
    expect(pg).toContain('FOR UPDATE');
    expect(v9.upSqlStatements.join('\n')).not.toContain('pg_advisory');
  });

  it('les constantes TS : 11 types sources (les 8 d\'origine conservés), la liste figée de la v3 reste à 8', () => {
    expect([...LEDGER_SOURCE_DOCUMENT_TYPES_V3]).toEqual([...OLD_SOURCE_TYPES]);
    expect([...LEDGER_SOURCE_DOCUMENT_TYPES]).toEqual([...OLD_SOURCE_TYPES, ...NEW_SOURCE_TYPES]);
  });

  it('PostgreSQL et SQLite portent exactement les triggers du registre ; prevent_direct_posted_insert existe sur les deux', async () => {
    const triggers = await client.query(
      `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND NOT t.tgisinternal ORDER BY t.tgname`,
      [SCHEMA],
    );
    const pgNames = triggers.rows.map((row: { tgname: string }) => row.tgname);
    expect(pgNames).toEqual([...TENANT_POSTGRES_TRIGGER_NAMES].sort());
    expect(names(openTenant(), 'trigger')).toEqual([...TENANT_TRIGGER_NAMES].sort());
    expect(pgNames).toContain('prevent_direct_posted_insert');
    expect(names(openTenant(), 'trigger')).toContain('prevent_direct_posted_insert');
    for (const name of V9_TRIGGERS) {
      expect(names(openTenant(), 'trigger'), name).toContain(name);
    }
  });

  it('PostgreSQL : colonne BIGINT NOT NULL DEFAULT 0, contrainte nommée du solde de caisse, contrainte du type source à 11 valeurs', async () => {
    const column = await client.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'cgnc_accounts' AND column_name = 'posted_balance_cents'`,
      [SCHEMA],
    );
    expect(column.rows).toEqual([{ data_type: 'bigint', is_nullable: 'NO', column_default: '0' }]);
    const constraint = await client.query(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = $1::regclass AND c.conname = 'cgnc_accounts_cash_5161_nonnegative_check'`,
      [`${SCHEMA}.cgnc_accounts`],
    );
    expect(constraint.rows.map((row: { def: string }) => row.def)).toEqual([expect.stringContaining('5161')]);
    const types = await client.query(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = $1::regclass AND c.conname = $2 AND c.convalidated`,
      [`${SCHEMA}.journal_entries`, SOURCE_TYPES_CHECK],
    );
    expect(types.rows).toHaveLength(1);
    for (const value of [...OLD_SOURCE_TYPES, ...NEW_SOURCE_TYPES]) {
      expect(String(types.rows[0]?.def)).toContain(`'${value}'`);
    }
  });

  it('SQLite : colonne INTEGER NOT NULL DEFAULT 0 et table journal_entries reconstruite avec ses index, FK entrantes et vue', () => {
    const db = openTenant();
    expect(all(db, `SELECT type, "notnull" AS not_null, dflt_value FROM pragma_table_info('cgnc_accounts') WHERE name = 'posted_balance_cents'`)).toEqual([
      { type: 'INTEGER', not_null: 1, dflt_value: '0' },
    ]);
    expect(names(db, 'index')).toEqual(expect.arrayContaining(['idx_je_fy_status_seq', 'uq_journal_entries_reversal_of', 'idx_jel_entry_account']));
    for (const child of ['journal_entry_lines', 'bank_transactions', 'tax_and_payment_subledger', 'payroll_ir_remittances', 'archival_packages']) {
      const parents = all(db, `SELECT "table" AS parent FROM pragma_foreign_key_list(?)`, child).map((row) => String(row['parent']));
      expect(parents, child).toContain('journal_entries');
      expect(parents, child).not.toContain('journal_entries_backup');
    }
    expect(all(db, 'SELECT COUNT(*) AS n FROM v_cgnc_trial_balance_6col')).toEqual([{ n: 0 }]);
    expect(names(db, 'table')).not.toContain('journal_entries_backup');
    expect(all(db, 'PRAGMA foreign_key_check')).toEqual([]);
  });
});

describe('mise à niveau d\'une base v8 contenant des pièces POSTED (backfill, reconstruction de journal_entries)', () => {
  const v9 = TENANT_MIGRATIONS[8];

  /** Pièces : fonds de caisse 10 000 (POSTED), décaissement 6 000 (POSTED), vente (POSTED), contre-passation POSTED, brouillon, relevé bancaire lié. */
  const SEED_ROWS: readonly (readonly [string, RowValues])[] = [
    ...LEDGER_SEED,
    ['journals', journalRow({ id: 'jrn-od', code: 'OD', name: 'Operations diverses', journal_type: 'GENERAL' })],
    ...simpleEntry('je-fund', 1, 'jrn-cai', 'acc-5161', 'acc-1111', 10000),
    ...simpleEntry('je-out', 2, 'jrn-cai', 'acc-6111', 'acc-5161', 6000),
    ...simpleEntry('je-sale', 3, 'jrn-vte', 'acc-3421', 'acc-7111', 500),
    ...simpleEntry('je-rev', 4, 'jrn-od', 'acc-7111', 'acc-3421', 500, { source_document_type: 'REVERSAL', reversal_of_entry_id: 'je-sale' }),
    ...simpleEntry('je-draft', 5, 'jrn-vte', 'acc-3421', 'acc-7111', 900),
    ['bank_transactions', bankTransactionRow({ id: 'bt-1', gl_entry_id: 'je-fund' })],
  ];
  const SEALED = ['je-fund', 'je-out', 'je-sale', 'je-rev'] as const;
  const EXPECTED_BALANCES = [
    { id: 'acc-1111', posted_balance_cents: -10000 },
    { id: 'acc-3421', posted_balance_cents: 0 },
    { id: 'acc-4455', posted_balance_cents: 0 },
    { id: 'acc-5161', posted_balance_cents: 4000 },
    { id: 'acc-6111', posted_balance_cents: 6000 },
    { id: 'acc-7111', posted_balance_cents: 0 },
  ];

  it('SQLite : migrateur sur un faux D1 (lot atomique, clés étrangères actives) : lignes conservées, soldes calculés, chaînes intactes', async () => {
    const fake = new FakeD1Database();
    const driver = createD1TenantDriver('soc-upgrade', fake);
    await ensureTenantSchemaUpToDate(null, driver, 'soc-upgrade', TENANT_MIGRATIONS.slice(0, 8));
    sqliteRun(fake.sqlite, SEED_ROWS);
    for (const id of SEALED) {
      sealSqlite(fake.sqlite, id);
    }
    expect(all(fake.sqlite, `SELECT COUNT(*) AS n FROM pragma_table_info('cgnc_accounts') WHERE name = 'posted_balance_cents'`)).toEqual([{ n: 0 }]);
    const result = await ensureTenantSchemaUpToDate(null, driver, 'soc-upgrade', TENANT_MIGRATIONS.slice(0, 9));
    expect(result).toEqual({ currentVersion: 9, appliedCount: 1 });
    const db = fake.sqlite;
    expect(all(db, 'SELECT id, posted_balance_cents FROM cgnc_accounts ORDER BY id').map((row) => ({ ...row }))).toEqual(EXPECTED_BALANCES);
    expect(all(db, 'SELECT id, status, reversal_of_entry_id FROM journal_entries ORDER BY id').map((row) => ({ ...row }))).toEqual([
      { id: 'je-draft', status: 'DRAFT', reversal_of_entry_id: null },
      { id: 'je-fund', status: 'POSTED', reversal_of_entry_id: null },
      { id: 'je-out', status: 'POSTED', reversal_of_entry_id: null },
      { id: 'je-rev', status: 'POSTED', reversal_of_entry_id: 'je-sale' },
      { id: 'je-sale', status: 'POSTED', reversal_of_entry_id: null },
    ]);
    expect(all(db, 'SELECT COUNT(*) AS n FROM journal_entry_lines')).toEqual([{ n: 10 }]);
    expect(all(db, `SELECT gl_entry_id FROM bank_transactions`)).toEqual([{ gl_entry_id: 'je-fund' }]);
    expect(all(db, 'PRAGMA foreign_key_check')).toEqual([]);
    expect(all(db, `SELECT COUNT(*) AS n FROM v_cgnc_trial_balance_6col`)).toEqual([{ n: 5 }]);
    // Base mise à niveau jusqu'à la v9 : les triggers de v1 à v9 (la v11, qui suit, n'y est pas encore appliquée).
    for (const name of TENANT_MIGRATIONS.slice(0, 9).flatMap((migration) => migration.triggerNames ?? [])) {
      expect(names(db, 'trigger'), name).toContain(name);
    }
    // Les pièces POSTED restent immuables après la reconstruction, et les nouveaux triggers sont actifs.
    expect(() => db.prepare(`UPDATE journal_entries SET review_cycle = 'VENTES' WHERE id = 'je-fund'`).run()).toThrow(MSG_ENTRY_UPDATE);
    expect(() => db.prepare(`DELETE FROM journal_entries WHERE id = 'je-fund'`).run()).toThrow('Suppression interdite');
    db.prepare(`INSERT INTO journal_entries (id, fiscal_year_id, journal_id, sequence_number, entry_reference, entry_date, source_document_type, status, total_debit_cents, total_credit_cents) VALUES ('je-x', 'fy-2026', 'jrn-vte', 99, 'X-99', '2026-11-13', 'OPENING_BALANCE', 'DRAFT', 5, 5)`).run();
    expect(all(db, `SELECT source_document_type FROM journal_entries WHERE id = 'je-x'`)).toEqual([{ source_document_type: 'OPENING_BALANCE' }]);
  });

  it('SQLite : une base v8 dont un compte 5161x est négatif (le trigger v8 ne contrôle que le total des comptes 5161) fait échouer la mise à niveau, sans rien laisser', async () => {
    const fake = new FakeD1Database();
    const driver = createD1TenantDriver('soc-negative', fake);
    await ensureTenantSchemaUpToDate(null, driver, 'soc-negative', TENANT_MIGRATIONS.slice(0, 8));
    sqliteRun(fake.sqlite, [
      ...LEDGER_SEED,
      ['cgnc_accounts', accountRow({ id: 'acc-5161b', account_number: '51612000', label_fr: 'Caisse annexe' })],
      ...simpleEntry('je-fund', 1, 'jrn-cai', 'acc-5161', 'acc-1111', 10000),
      ...simpleEntry('je-annex', 2, 'jrn-cai', 'acc-6111', 'acc-5161b', 3000),
    ]);
    sealSqlite(fake.sqlite, 'je-fund');
    sealSqlite(fake.sqlite, 'je-annex');
    await expect(ensureTenantSchemaUpToDate(null, driver, 'soc-negative', TENANT_MIGRATIONS)).rejects.toThrow(MSG_CASH_CHECK);
    expect(all(fake.sqlite, `SELECT COUNT(*) AS n FROM pragma_table_info('cgnc_accounts') WHERE name = 'posted_balance_cents'`)).toEqual([{ n: 0 }]);
    expect(all(fake.sqlite, `SELECT COUNT(*) AS n FROM _fisca_schema_migrations`)).toEqual([{ n: 8 }]);
    expect(all(fake.sqlite, `SELECT COUNT(*) AS n FROM journal_entries`)).toEqual([{ n: 2 }]);
    expect(all(fake.sqlite, `SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'journal_entries_backup'`)).toEqual([{ n: 0 }]);
  });

  it('PostgreSQL : base v8 pleine mise à niveau par les instructions de la v9 : soldes posés, contrainte validée', async () => {
    const upgrade = await connect(SCHEMA_UPGRADE);
    try {
      for (const migration of TENANT_MIGRATIONS.slice(0, 8)) {
        for (const statement of tenantMigrationPostgresStatements(migration)) {
          await upgrade.query(statement);
        }
      }
      await pgRun(upgrade, SEED_ROWS);
      for (const id of SEALED) {
        await upgrade.query(toPg(POST_ENTRY_SQL), postParams(id));
      }
      if (v9 === undefined) {
        throw new Error('migration v9 absente');
      }
      for (const statement of tenantMigrationPostgresStatements(v9)) {
        await upgrade.query(statement);
      }
      const balances = await upgrade.query(`SELECT id, CAST(posted_balance_cents AS BIGINT)::text AS bal FROM cgnc_accounts ORDER BY id`);
      expect(balances.rows.map((row: { id: string; bal: string }) => ({ id: row.id, posted_balance_cents: Number(row.bal) }))).toEqual(EXPECTED_BALANCES);
      const validated = await upgrade.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'cgnc_accounts_cash_5161_nonnegative_check' AND conrelid = $1::regclass`, [`${SCHEMA_UPGRADE}.cgnc_accounts`]);
      expect(validated.rows).toEqual([{ convalidated: true }]);
      const counts = await upgrade.query(`SELECT COUNT(*)::int AS n FROM journal_entries`);
      expect(counts.rows).toEqual([{ n: 5 }]);
    } finally {
      await upgrade.end();
    }
  });
});

describe('a. ligne : jamais de déplacement ; insertion directe POSTED ; passage à POSTED', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth(simpleEntry('je-posted', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 1000));
    await seal('je-posted');
    await seedBoth(simpleEntry('je-draft', 2, 'jrn-vte', 'acc-3421', 'acc-7111', 700));
    await seedBoth(simpleEntry('je-draft2', 3, 'jrn-vte', 'acc-3421', 'acc-7111', 300));
  });

  it('déplacer une ligne d\'un brouillon vers un AUTRE brouillon est refusé (un entry_id modifié est refusé quelle que soit la pièce)', async () => {
    await failBoth(`UPDATE journal_entry_lines SET entry_id = 'je-draft2', line_number = 9 WHERE id = 'je-draft-l1'`, MSG_LINE_MOVE);
    await failBoth(`UPDATE journal_entry_lines SET entry_id = 'je-draft2' WHERE id = 'je-draft-l1'`, MSG_LINE_MOVE);
    await expectEqualRows(`SELECT entry_id, line_number FROM journal_entry_lines WHERE id = 'je-draft-l1'`, [{ entry_id: 'je-draft', line_number: '1' }]);
  });

  it('les déplacements impliquant une pièce POSTED gardent le texte de ligne POSTED (ancien ou nouveau entry_id)', async () => {
    await failBoth(`UPDATE journal_entry_lines SET entry_id = 'je-posted', line_number = 9 WHERE id = 'je-draft-l1'`, MSG_LINE_UPDATE);
    await failBoth(`UPDATE journal_entry_lines SET entry_id = 'je-draft', line_number = 9 WHERE id = 'je-posted-l1'`, MSG_LINE_UPDATE);
  });

  it('une modification qui laisse entry_id inchangé reste libre sur un brouillon, et la montée du drapeau reste admise sur POSTED', async () => {
    await runBoth(`UPDATE journal_entry_lines SET entry_id = 'je-draft', description_enc = 'v1:aXY:bm91dmVhdQ', auxiliary_account = 'AUX' WHERE id = 'je-draft-l1'`);
    await runBoth(`UPDATE journal_entry_lines SET pii_restricted_flag = 1 WHERE id = 'je-posted-l1'`);
    await failBoth(`UPDATE journal_entry_lines SET description_enc = 'x' WHERE id = 'je-posted-l2'`, MSG_LINE_UPDATE);
    await expectEqualRows(`SELECT description_enc, auxiliary_account FROM journal_entry_lines WHERE id = 'je-draft-l1'`, [
      { description_enc: 'v1:aXY:bm91dmVhdQ', auxiliary_account: 'AUX' },
    ]);
  });

  it('prevent_direct_posted_insert : toute insertion directe d\'une pièce au statut POSTED est refusée, même texte, quel que soit l\'exercice', async () => {
    await failInsertBoth(simpleEntry('je-direct', 4, 'jrn-vte', 'acc-3421', 'acc-7111', 100, { status: 'POSTED' }), MSG_DIRECT_POSTED);
    await failInsertBoth(simpleEntry('je-direct', 4, 'jrn-vte', 'acc-3421', 'acc-7111', 100, { status: 'POSTED', source_document_type: 'OPENING_BALANCE' }), MSG_DIRECT_POSTED);
    await expectEqualRows(`SELECT COUNT(*) AS n FROM journal_entries WHERE id = 'je-direct'`, [{ n: 0 }]);
  });

  it('flux légitime du moteur : DRAFT puis REVISEE_CYCLE puis POSTED accepté ; le moteur scelle sous `status = REVISEE_CYCLE` seulement', async () => {
    await runBoth(`UPDATE journal_entries SET status = 'REVISEE_CYCLE' WHERE id = 'je-draft'`);
    await seal('je-draft');
    await expectEqualRows(`SELECT status FROM journal_entries WHERE id = 'je-draft'`, [{ status: 'POSTED' }]);
    await runBoth(`UPDATE journal_entries SET status = 'REVISEE_CYCLE' WHERE id = 'je-draft2'`);
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE journal_entries SET status = 'POSTED', validated_at = ?, entry_hash = ?, previous_entry_hash = ? WHERE id = ? AND status = 'REVISEE_CYCLE'`, postParams('je-draft2'));
    }
    await expectEqualRows(`SELECT status FROM journal_entries WHERE id = 'je-draft2'`, [{ status: 'POSTED' }]);
  });

  it('RÈGLE REMPLACÉE (décision du pilote 7, migration v11) : l\'ancien « ÉCART DOCUMENTÉ » (DRAFT vers POSTED accepté par la base) est INVERSÉ ; DRAFT et IA_PROPOSITION vers POSTED sont refusés, seul REVISEE_CYCLE scelle', async () => {
    await seedBoth(simpleEntry('je-ia', 4, 'jrn-vte', 'acc-3421', 'acc-7111', 100, { status: 'IA_PROPOSITION' }));
    await failBoth(POST_ENTRY_SQL, MSG_POST_ONLY_FROM_REVISED_CYCLE, postParams('je-draft'));
    await failBoth(POST_ENTRY_SQL, MSG_POST_ONLY_FROM_REVISED_CYCLE, postParams('je-ia'));
    await expectEqualRows(`SELECT id, status FROM journal_entries WHERE id IN ('je-draft', 'je-ia') ORDER BY id`, [
      { id: 'je-draft', status: 'DRAFT' },
      { id: 'je-ia', status: 'IA_PROPOSITION' },
    ]);
    await seal('je-draft');
    await expectEqualRows(`SELECT id, status FROM journal_entries WHERE id = 'je-draft'`, [{ id: 'je-draft', status: 'POSTED' }]);
  });
});

describe('b. exercice CLOSED étanche', () => {
  const FY_2027 = fiscalYearRow({ id: 'fy-2027', code: 'EX-2027', start_date: '2027-01-01', end_date: '2027-12-31' });
  const FY_2025 = fiscalYearRow({ id: 'fy-2025', code: 'EX-2025', start_date: '2025-01-01', end_date: '2025-12-31', status: 'CLOSED' });

  async function closeFiscalYear2026(): Promise<void> {
    await runBoth(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`);
    await runBoth(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`);
  }

  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth([['fiscal_years', FY_2027], ['fiscal_years', FY_2025]]);
    await seedBoth(simpleEntry('je-draft', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    await seedBoth(simpleEntry('je-posted', 2, 'jrn-vte', 'acc-3421', 'acc-7111', 800));
    await seal('je-posted');
  });

  it('INSERT d\'une pièce dans un exercice CLOSED est refusé, même texte (nouvel exercice CLOSED)', async () => {
    await failInsertBoth(simpleEntry('je-in', 9, 'jrn-vte', 'acc-3421', 'acc-7111', 100, { fiscal_year_id: 'fy-2025' }), MSG_FY_CLOSED);
  });

  it('UPDATE d\'un brouillon dont l\'exercice est devenu CLOSED est refusé, même texte, pour toute colonne et tout statut cible', async () => {
    await closeFiscalYear2026();
    await failBoth(`UPDATE journal_entries SET review_cycle = 'VENTES' WHERE id = 'je-draft'`, MSG_FY_CLOSED);
    await failBoth(`UPDATE journal_entries SET entry_date = '2026-11-14' WHERE id = 'je-draft'`, MSG_FY_CLOSED);
    await failBoth(`UPDATE journal_entries SET status = 'REVISEE_CYCLE' WHERE id = 'je-draft'`, MSG_FY_CLOSED);
    await failBoth(POST_ENTRY_SQL, MSG_FY_CLOSED, postParams('je-draft'));
    await expectEqualRows(`SELECT status, review_cycle FROM journal_entries WHERE id = 'je-draft'`, [{ status: 'DRAFT', review_cycle: 'GENERAL' }]);
  });

  it('UPDATE de fiscal_year_id refusé dans les deux sens : ancien exercice CLOSED, puis nouvel exercice CLOSED', async () => {
    await closeFiscalYear2026();
    await failBoth(`UPDATE journal_entries SET fiscal_year_id = 'fy-2027', sequence_number = 7 WHERE id = 'je-draft'`, MSG_FY_CHANGE);
    await expectEqualRows(`SELECT fiscal_year_id FROM journal_entries WHERE id = 'je-draft'`, [{ fiscal_year_id: 'fy-2026' }]);
    await seedBoth(simpleEntry('je-open', 5, 'jrn-vte', 'acc-3421', 'acc-7111', 100, { fiscal_year_id: 'fy-2027', entry_date: '2027-02-01', sequence_number: 5 }));
    await failBoth(`UPDATE journal_entries SET fiscal_year_id = 'fy-2025', sequence_number = 8 WHERE id = 'je-open'`, MSG_FY_CHANGE);
    await failBoth(`UPDATE journal_entries SET fiscal_year_id = 'fy-2026', sequence_number = 8 WHERE id = 'je-open'`, MSG_FY_CHANGE);
    await expectEqualRows(`SELECT fiscal_year_id FROM journal_entries WHERE id = 'je-open'`, [{ fiscal_year_id: 'fy-2027' }]);
  });

  it('DELETE d\'une pièce d\'un exercice CLOSED est refusé, même texte ; accepté dans un exercice OPEN', async () => {
    await closeFiscalYear2026();
    await failBoth(`DELETE FROM journal_entries WHERE id = 'je-draft'`, MSG_FY_CLOSED);
    await expectEqualRows(`SELECT COUNT(*) AS n FROM journal_entries WHERE id = 'je-draft'`, [{ n: 1 }]);
    await seedBoth(simpleEntry('je-open', 5, 'jrn-vte', 'acc-3421', 'acc-7111', 100, { fiscal_year_id: 'fy-2027', entry_date: '2027-02-01', sequence_number: 5 }));
    await runBoth(`DELETE FROM journal_entry_lines WHERE entry_id = 'je-open'`);
    await runBoth(`DELETE FROM journal_entries WHERE id = 'je-open'`);
    await expectEqualRows(`SELECT COUNT(*) AS n FROM journal_entries WHERE id = 'je-open'`, [{ n: 0 }]);
  });

  it('un exercice CLOSED ne se rouvre pas : retour à OPEN ou CLOSING refusé (prevent_closed_fiscal_year_update) ; CLOSING vers CLOSED reste permis', async () => {
    await closeFiscalYear2026();
    await failBoth(`UPDATE fiscal_years SET status = 'OPEN' WHERE id = 'fy-2026'`, MSG_FY_UPDATE);
    await failBoth(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`, MSG_FY_UPDATE);
    await failBoth(`UPDATE fiscal_years SET status = 'OPEN' WHERE id = 'fy-2025'`, MSG_FY_UPDATE);
    await expectEqualRows(`SELECT id, status FROM fiscal_years WHERE id IN ('fy-2025', 'fy-2026') ORDER BY id`, [
      { id: 'fy-2025', status: 'CLOSED' },
      { id: 'fy-2026', status: 'CLOSED' },
    ]);
    await expectEqualRows(`SELECT status FROM fiscal_years WHERE id = 'fy-2027'`, [{ status: 'OPEN' }]);
    await runBoth(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2027'`);
    await runBoth(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2027'`);
    await expectEqualRows(`SELECT status FROM fiscal_years WHERE id = 'fy-2027'`, [{ status: 'CLOSED' }]);
  });

  it('le journal d\'à-nouveaux (OPENING_BALANCE) s\'insère dans le NOUVEL exercice OPEN, puis se scelle, pendant que l\'ancien est CLOSED', async () => {
    await closeFiscalYear2026();
    await seedBoth(simpleEntry('je-an', 1, 'jrn-an', 'acc-5161', 'acc-1111', 100000, { fiscal_year_id: 'fy-2027', source_document_type: 'OPENING_BALANCE', entry_date: '2027-01-01' }));
    await runBoth(`UPDATE journal_entries SET status = 'REVISEE_CYCLE' WHERE id = 'je-an'`);
    await seal('je-an');
    await expectEqualRows(`SELECT fiscal_year_id, status, source_document_type FROM journal_entries WHERE id = 'je-an'`, [
      { fiscal_year_id: 'fy-2027', status: 'POSTED', source_document_type: 'OPENING_BALANCE' },
    ]);
  });

  it('CHOIX DOCUMENTÉ : la montée monotone 0 vers 1 de pii_restricted_flag (DSAR, v4 et v6) reste admise sur une pièce POSTED d\'un exercice CLOSED ; tout autre UPDATE est refusé', async () => {
    await closeFiscalYear2026();
    await runBoth(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-posted'`);
    await expectEqualRows(`SELECT pii_restricted_flag FROM journal_entries WHERE id = 'je-posted'`, [{ pii_restricted_flag: 1 }]);
    await failBoth(`UPDATE journal_entries SET review_cycle = 'VENTES' WHERE id = 'je-posted'`, MSG_ENTRY_UPDATE);
  });
});

describe('c. caisse 5161 : posted_balance_cents, CHECK et mise à jour atomique au scellement', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
  });

  it('un compte neuf démarre à 0 sur les deux moteurs', async () => {
    await expectEqualRows(`SELECT id, posted_balance_cents FROM cgnc_accounts ORDER BY id`, [
      { id: 'acc-1111', posted_balance_cents: 0 },
      { id: 'acc-3421', posted_balance_cents: 0 },
      { id: 'acc-4455', posted_balance_cents: 0 },
      { id: 'acc-5161', posted_balance_cents: 0 },
      { id: 'acc-6111', posted_balance_cents: 0 },
      { id: 'acc-7111', posted_balance_cents: 0 },
    ]);
  });

  it('le scellement pose le delta débit moins crédit par compte (sens unique, quel que soit normal_balance) ; un brouillon ne bouge rien', async () => {
    await seedBoth(simpleEntry('je-fund', 1, 'jrn-cai', 'acc-5161', 'acc-1111', 10000));
    await seedBoth(simpleEntry('je-sale', 2, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    await expectEqualRows(`SELECT SUM(posted_balance_cents) AS total_cents FROM cgnc_accounts`, [{ total_cents: 0 }]);
    await seal('je-fund');
    await expectEqualRows(`SELECT id, posted_balance_cents FROM cgnc_accounts WHERE id IN ('acc-5161', 'acc-1111', 'acc-3421') ORDER BY id`, [
      { id: 'acc-1111', posted_balance_cents: -10000 },
      { id: 'acc-3421', posted_balance_cents: 0 },
      { id: 'acc-5161', posted_balance_cents: 10000 },
    ]);
    await seal('je-sale');
    await expectEqualRows(`SELECT id, posted_balance_cents FROM cgnc_accounts WHERE id IN ('acc-3421', 'acc-7111') ORDER BY id`, [
      { id: 'acc-3421', posted_balance_cents: 500 },
      { id: 'acc-7111', posted_balance_cents: -500 },
    ]);
  });

  it('invariant : posted_balance_cents égale la somme débit moins crédit des lignes des pièces POSTED, pour chaque compte', async () => {
    await seedBoth(simpleEntry('je-fund', 1, 'jrn-cai', 'acc-5161', 'acc-1111', 10000));
    await seedBoth(simpleEntry('je-out', 2, 'jrn-cai', 'acc-6111', 'acc-5161', 2500));
    await seedBoth(simpleEntry('je-sale', 3, 'jrn-vte', 'acc-3421', 'acc-7111', 700));
    await seal('je-fund');
    await seal('je-out');
    await expectEqualRows(
      `SELECT ca.id AS id, ca.posted_balance_cents - COALESCE((SELECT SUM(jel.debit_cents - jel.credit_cents) FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id WHERE jel.account_id = ca.id AND je.status = 'POSTED'), 0) AS gap_cents FROM cgnc_accounts ca ORDER BY ca.id`,
      ['acc-1111', 'acc-3421', 'acc-4455', 'acc-5161', 'acc-6111', 'acc-7111'].map((id) => ({ id, gap_cents: 0 })),
    );
  });

  it('un décaissement qui rendrait la caisse négative est refusé (même texte), la pièce reste en brouillon et AUCUN solde ne bouge ; un compte non 5161 peut devenir négatif', async () => {
    await seedBoth(simpleEntry('je-fund', 1, 'jrn-cai', 'acc-5161', 'acc-1111', 10000));
    await seal('je-fund');
    await seedBoth(simpleEntry('je-over', 2, 'jrn-cai', 'acc-6111', 'acc-5161', 12000));
    expectSame(await dual.onBoth((e) => e.fail(POST_ENTRY_SQL, postParams('je-over'))), MSG_NEGATIVE_CASH);
    await expectEqualRows(`SELECT id, posted_balance_cents FROM cgnc_accounts WHERE id IN ('acc-5161', 'acc-6111', 'acc-1111') ORDER BY id`, [
      { id: 'acc-1111', posted_balance_cents: -10000 },
      { id: 'acc-5161', posted_balance_cents: 10000 },
      { id: 'acc-6111', posted_balance_cents: 0 },
    ]);
    await expectEqualRows(`SELECT status FROM journal_entries WHERE id = 'je-over'`, [{ status: 'DRAFT' }]);
    await seedBoth(simpleEntry('je-ok', 3, 'jrn-cai', 'acc-6111', 'acc-5161', 4000));
    await seal('je-ok');
    await expectEqualRows(`SELECT id, posted_balance_cents FROM cgnc_accounts WHERE id IN ('acc-5161', 'acc-6111') ORDER BY id`, [
      { id: 'acc-5161', posted_balance_cents: 6000 },
      { id: 'acc-6111', posted_balance_cents: 4000 },
    ]);
  });

  it('le CHECK est PAR COMPTE : un second compte 5161x négatif est refusé même si le total des comptes 5161 reste positif, même texte', async () => {
    await seedBoth([['cgnc_accounts', accountRow({ id: 'acc-5161b', account_number: '51612000', label_fr: 'Caisse annexe' })]]);
    await seedBoth(simpleEntry('je-fund', 1, 'jrn-cai', 'acc-5161', 'acc-1111', 10000));
    await seal('je-fund');
    await seedBoth(simpleEntry('je-annex', 2, 'jrn-cai', 'acc-6111', 'acc-5161b', 3000));
    expectSame(await dual.onBoth((e) => e.fail(POST_ENTRY_SQL, postParams('je-annex'))), MSG_NEGATIVE_CASH);
    await expectEqualRows(`SELECT id, posted_balance_cents FROM cgnc_accounts WHERE id IN ('acc-5161', 'acc-5161b') ORDER BY id`, [
      { id: 'acc-5161', posted_balance_cents: 10000 },
      { id: 'acc-5161b', posted_balance_cents: 0 },
    ]);
  });

  it('CHECK direct : UPDATE négatif d\'un compte 5161 refusé avec le texte PostgreSQL de la contrainte nommée ; accepté pour un autre compte', async () => {
    const [lite, pg] = await dual.onBoth((e) => e.fail(`UPDATE cgnc_accounts SET posted_balance_cents = -1 WHERE id = 'acc-5161'`));
    expect(lite.message).toBe(MSG_CASH_CHECK);
    expect(pg.message).toBe(MSG_CASH_CHECK);
    expect(pg.code).toBe('23514');
    await runBoth(`UPDATE cgnc_accounts SET posted_balance_cents = -1 WHERE id = 'acc-3421'`);
    await expectEqualRows(`SELECT id, posted_balance_cents FROM cgnc_accounts WHERE id IN ('acc-3421', 'acc-5161') ORDER BY id`, [
      { id: 'acc-3421', posted_balance_cents: -1 },
      { id: 'acc-5161', posted_balance_cents: 0 },
    ]);
  });

  it('CHECK direct : INSERT d\'un compte 5161 à solde négatif refusé, à solde nul ou positif accepté ; renumérotation d\'un compte négatif vers 5161 refusée', async () => {
    const negative = accountRow({ id: 'acc-5161c', account_number: '51613000', posted_balance_cents: -5 });
    const [lite, pg] = await dual.onBoth((e) => {
      const { sql, params } = insertSqlite('cgnc_accounts', negative);
      return e.fail(sql, params);
    });
    expect(lite.message).toBe(MSG_CASH_CHECK);
    expect(pg.message).toBe(MSG_CASH_CHECK);
    expect(pg.code).toBe('23514');
    await seedBoth([['cgnc_accounts', accountRow({ id: 'acc-5161c', account_number: '51613000', posted_balance_cents: 7 })]]);
    await runBoth(`UPDATE cgnc_accounts SET posted_balance_cents = -3 WHERE id = 'acc-6111'`);
    const [renumberLite, renumberPg] = await dual.onBoth((e) => e.fail(`UPDATE cgnc_accounts SET account_number = '51619999' WHERE id = 'acc-6111'`));
    expect(renumberLite.message).toBe(MSG_CASH_CHECK);
    expect(renumberPg.message).toBe(MSG_CASH_CHECK);
    expect(renumberPg.code).toBe('23514');
  });

  it('un solde non entier (10.5 lié en paramètre) est refusé : CHECK d\'entier strict sous SQLite, 22P02 sous PostgreSQL', async () => {
    const [lite, pg] = await dual.onBoth((e) => e.fail(`UPDATE cgnc_accounts SET posted_balance_cents = ? WHERE id = 'acc-3421'`, [NON_INTEGER]));
    expect(lite.message).toContain('CHECK constraint failed');
    expect(pg.code).toBe('22P02');
    const [liteText, pgText] = await dual.onBoth((e) => e.fail(`UPDATE cgnc_accounts SET posted_balance_cents = ? WHERE id = 'acc-3421'`, ['abc']));
    expect(liteText.message).toContain('CHECK constraint failed');
    expect(pgText.code).toBe('22P02');
  });
});

describe('c. caisse 5161 sous PostgreSQL READ COMMITTED : deux connexions réelles concurrentes', () => {
  let first: Client;
  let second: Client;
  let observer: Client;

  beforeAll(async () => {
    first = await connect();
    second = await connect();
    observer = await connect();
  });

  afterAll(async () => {
    await first.end();
    await second.end();
    await observer.end();
  });

  afterEach(async () => {
    await first.query('ROLLBACK');
    await second.query('ROLLBACK');
  });

  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth(simpleEntry('je-fund', 1, 'jrn-cai', 'acc-5161', 'acc-1111', 10000));
    await seal('je-fund');
    await seedBoth(simpleEntry('je-out-1', 2, 'jrn-cai', 'acc-6111', 'acc-5161', 6000, { status: 'REVISEE_CYCLE' }));
    await seedBoth(simpleEntry('je-out-2', 3, 'jrn-cai', 'acc-6111', 'acc-5161', 6000, { status: 'REVISEE_CYCLE' }));
  });

  async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 250; attempt += 1) {
      if (await predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('barrière non atteinte en 5 secondes');
  }

  async function backendPid(connection: Client): Promise<number> {
    const result = await connection.query('SELECT pg_backend_pid() AS pid');
    return Number(result.rows[0]?.pid);
  }

  /** Barrière : la session attend réellement un verrou (pg_locks, granted = false). */
  async function waitsOnLock(pid: number): Promise<boolean> {
    const result = await observer.query(`SELECT 1 FROM pg_locks WHERE NOT granted AND pid = $1`, [pid]);
    return (result.rowCount ?? 0) > 0;
  }

  async function postedBalance(): Promise<number> {
    const result = await client.query(`SELECT posted_balance_cents::text AS bal FROM cgnc_accounts WHERE id = 'acc-5161'`);
    return Number(result.rows[0]?.bal);
  }

  async function derivedBalance(): Promise<number> {
    const result = await client.query(
      `SELECT CAST(COALESCE(SUM(jel.debit_cents - jel.credit_cents), 0) AS BIGINT)::text AS net
         FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id JOIN cgnc_accounts ca ON ca.id = jel.account_id
        WHERE je.status = 'POSTED' AND ca.account_number LIKE '5161%'`,
    );
    return Number(result.rows[0]?.net);
  }

  it('solde 10 000, deux crédits de 6 000 : exactement un passe, le second est refusé CGNC_NEGATIVE_CASH_5161, solde final 4 000 (jamais -2 000)', async () => {
    expect(await postedBalance()).toBe(10000);
    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(toPg(POST_ENTRY_SQL), postParams('je-out-1'));
    const secondPid = await backendPid(second);
    let secondSettled = false;
    const secondAttempt = second.query(toPg(POST_ENTRY_SQL), postParams('je-out-2')).then(
      () => ({ failure: null as string | null }),
      (error: unknown) => ({ failure: error instanceof Error ? error.message : String(error) }),
    );
    void secondAttempt.then(() => {
      secondSettled = true;
    });
    await waitUntil(async () => secondSettled || (await waitsOnLock(secondPid)));
    expect(secondSettled).toBe(false);
    await first.query('COMMIT');
    const outcome = await secondAttempt;
    await second.query(outcome.failure === null ? 'COMMIT' : 'ROLLBACK');
    expect(outcome.failure).toBe(MSG_NEGATIVE_CASH);
    expect(await postedBalance()).toBe(4000);
    expect(await derivedBalance()).toBe(4000);
    const statuses = await client.query(`SELECT id, status FROM journal_entries WHERE id LIKE 'je-out-%' ORDER BY id`);
    expect(statuses.rows).toEqual([
      { id: 'je-out-1', status: 'POSTED' },
      { id: 'je-out-2', status: 'REVISEE_CYCLE' },
    ]);
  });

  it('même scénario, la connexion perdante démarre la première : toujours un seul scellement, solde 4 000', async () => {
    await second.query('BEGIN');
    await first.query('BEGIN');
    await second.query(toPg(POST_ENTRY_SQL), postParams('je-out-2'));
    const firstPid = await backendPid(first);
    let settled = false;
    const attempt = first.query(toPg(POST_ENTRY_SQL), postParams('je-out-1')).then(
      () => ({ failure: null as string | null }),
      (error: unknown) => ({ failure: error instanceof Error ? error.message : String(error) }),
    );
    void attempt.then(() => {
      settled = true;
    });
    await waitUntil(async () => settled || (await waitsOnLock(firstPid)));
    await second.query('COMMIT');
    const outcome = await attempt;
    await first.query(outcome.failure === null ? 'COMMIT' : 'ROLLBACK');
    expect(outcome.failure).toBe(MSG_NEGATIVE_CASH);
    expect(await postedBalance()).toBe(4000);
  });

  it('deux scellements concurrents couverts par le solde passent tous les deux : le solde se cumule (10 000 - 3 000 - 3 000 = 4 000)', async () => {
    await runBoth(`UPDATE journal_entry_lines SET credit_cents = 3000 WHERE id IN ('je-out-1-l2', 'je-out-2-l2')`);
    await runBoth(`UPDATE journal_entry_lines SET debit_cents = 3000 WHERE id IN ('je-out-1-l1', 'je-out-2-l1')`);
    await runBoth(`UPDATE journal_entries SET total_debit_cents = 3000, total_credit_cents = 3000 WHERE id IN ('je-out-1', 'je-out-2')`);
    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(toPg(POST_ENTRY_SQL), postParams('je-out-1'));
    const secondPid = await backendPid(second);
    const secondAttempt = second.query(toPg(POST_ENTRY_SQL), postParams('je-out-2'));
    await waitUntil(async () => waitsOnLock(secondPid));
    await first.query('COMMIT');
    await secondAttempt;
    await second.query('COMMIT');
    expect(await postedBalance()).toBe(4000);
    expect(await derivedBalance()).toBe(4000);
  });
});

describe('c. le verrou de ligne du solde suffit seul : mêmes deux connexions, verrou consultatif retiré de la fonction (schéma dédié)', () => {
  it('sans pg_advisory_xact_lock, le second scellement attend le verrou de ligne de cgnc_accounts puis est refusé CGNC_NEGATIVE_CASH_5161 ; solde final 4 000', async () => {
    const admin = await connect(SCHEMA_ROWLOCK);
    const first = await connect(SCHEMA_ROWLOCK);
    const second = await connect(SCHEMA_ROWLOCK);
    const observer = await connect(SCHEMA_ROWLOCK);
    try {
      for (const migration of TENANT_MIGRATIONS) {
        for (const statement of tenantMigrationPostgresStatements(migration)) {
          await admin.query(statement);
        }
      }
      const source = await admin.query(
        `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1 AND p.proname = 'fisca_enforce_balance_and_positive_cash_on_post'`,
        [SCHEMA_ROWLOCK],
      );
      const definition = String(source.rows[0]?.def);
      expect(definition).toContain('pg_advisory_xact_lock');
      const withoutAdvisory = definition.replace(/\s*PERFORM pg_advisory_xact_lock\([^;]*\);/, '');
      expect(withoutAdvisory).not.toContain('pg_advisory_xact_lock');
      expect(withoutAdvisory).toContain('FOR UPDATE');
      await admin.query(withoutAdvisory);
      await pgRun(admin, [
        ...LEDGER_SEED,
        ...simpleEntry('je-fund', 1, 'jrn-cai', 'acc-5161', 'acc-1111', 10000, { status: 'REVISEE_CYCLE' }),
      ]);
      await admin.query(toPg(POST_ENTRY_SQL), postParams('je-fund'));
      await pgRun(admin, [
        ...simpleEntry('je-out-1', 2, 'jrn-cai', 'acc-6111', 'acc-5161', 6000, { status: 'REVISEE_CYCLE' }),
        ...simpleEntry('je-out-2', 3, 'jrn-cai', 'acc-6111', 'acc-5161', 6000, { status: 'REVISEE_CYCLE' }),
      ]);
      await first.query('BEGIN');
      await second.query('BEGIN');
      await first.query(toPg(POST_ENTRY_SQL), postParams('je-out-1'));
      const secondPid = Number((await second.query('SELECT pg_backend_pid() AS pid')).rows[0]?.pid);
      let settled = false;
      const attempt = second.query(toPg(POST_ENTRY_SQL), postParams('je-out-2')).then(
        () => ({ failure: null as string | null }),
        (error: unknown) => ({ failure: error instanceof Error ? error.message : String(error) }),
      );
      void attempt.then(() => {
        settled = true;
      });
      let lockType: string | null = null;
      for (let tries = 0; tries < 250 && lockType === null && !settled; tries += 1) {
        const waiting = await observer.query(`SELECT locktype FROM pg_locks WHERE NOT granted AND pid = $1`, [secondPid]);
        lockType = waiting.rows[0]?.locktype === undefined ? null : String(waiting.rows[0]?.locktype);
        if (lockType === null) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      expect(settled).toBe(false);
      expect(['tuple', 'transactionid']).toContain(lockType);
      await first.query('COMMIT');
      const outcome = await attempt;
      await second.query(outcome.failure === null ? 'COMMIT' : 'ROLLBACK');
      expect(outcome.failure).toBe(MSG_NEGATIVE_CASH);
      const balance = await admin.query(`SELECT posted_balance_cents::text AS bal FROM cgnc_accounts WHERE id = 'acc-5161'`);
      expect(Number(balance.rows[0]?.bal)).toBe(4000);
    } finally {
      await first.query('ROLLBACK');
      await second.query('ROLLBACK');
      await admin.end();
      await first.end();
      await second.end();
      await observer.end();
    }
  });
});

describe('d. contre-passation : la pièce visée existe et est POSTED', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth([['journals', journalRow({ id: 'jrn-od', code: 'OD', name: 'Operations diverses', journal_type: 'GENERAL' })]]);
    await seedBoth(simpleEntry('je-orig', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    await seal('je-orig');
    await seedBoth(simpleEntry('je-draft', 2, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
  });

  const reversal = (id: string, sequence: number, of: string): readonly (readonly [string, RowValues])[] =>
    simpleEntry(id, sequence, 'jrn-od', 'acc-7111', 'acc-3421', 500, { source_document_type: 'REVERSAL', reversal_of_entry_id: of });

  it('une contre-passation d\'une pièce INEXISTANTE est refusée avec le texte commun (et non par la clé étrangère propre à chaque moteur)', async () => {
    await failInsertBoth(reversal('je-rev', 1, 'ghost'), MSG_REVERSAL_TARGET);
    await expectEqualRows(`SELECT COUNT(*) AS n FROM journal_entries WHERE id = 'je-rev'`, [{ n: 0 }]);
  });

  it('une contre-passation d\'une pièce non POSTED (brouillon) est refusée avec le texte commun', async () => {
    await failInsertBoth(reversal('je-rev', 1, 'je-draft'), MSG_REVERSAL_TARGET);
    await expectEqualRows(`SELECT COUNT(*) AS n FROM journal_entries WHERE id = 'je-rev'`, [{ n: 0 }]);
  });

  it('la contre-passation d\'une pièce POSTED est acceptée ; la seconde contre-passation de la même pièce reste refusée par l\'index unique (UNIQUE / 23505)', async () => {
    await seedBoth(reversal('je-rev-1', 1, 'je-orig'));
    const header = reversal('je-rev-2', 2, 'je-orig')[0];
    if (header === undefined) {
      throw new Error('en-tête absent');
    }
    const { sql, params } = insertSqlite(header[0], header[1]);
    const [lite, pg] = await dual.onBoth((e) => e.fail(sql, params));
    expect(lite.message).toContain('UNIQUE constraint failed: journal_entries.reversal_of_entry_id');
    expect(pg.code).toBe('23505');
    expect(pg.message).toContain('uq_journal_entries_reversal_of');
    await expectEqualRows(`SELECT COUNT(*) AS n FROM journal_entries WHERE reversal_of_entry_id = 'je-orig'`, [{ n: 1 }]);
  });

  it('la pièce ne se vise pas elle-même : le CHECK d\'origine reste le garde-fou (CHECK sous SQLite, 23514 sous PostgreSQL)', async () => {
    const header = reversal('je-self', 3, 'je-self')[0];
    if (header === undefined) {
      throw new Error('en-tête absent');
    }
    const { sql, params } = insertSqlite(header[0], header[1]);
    const [lite, pg] = await dual.onBoth((e) => e.fail(sql, params));
    expect(lite.message).toContain('CHECK constraint failed');
    expect(pg.code).toBe('23514');
  });

  it('un UPDATE de reversal_of_entry_id vers une pièce inexistante ou non POSTED est refusé avec le texte commun ; vers une pièce POSTED, accepté', async () => {
    await seedBoth(simpleEntry('je-target', 3, 'jrn-od', 'acc-7111', 'acc-3421', 500, { source_document_type: 'REVERSAL', reversal_of_entry_id: 'je-orig' }));
    await failBoth(`UPDATE journal_entries SET reversal_of_entry_id = 'ghost' WHERE id = 'je-target'`, MSG_REVERSAL_TARGET);
    await failBoth(`UPDATE journal_entries SET reversal_of_entry_id = 'je-draft' WHERE id = 'je-target'`, MSG_REVERSAL_TARGET);
    await seedBoth(simpleEntry('je-orig-2', 4, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    await seal('je-orig-2');
    await runBoth(`UPDATE journal_entries SET reversal_of_entry_id = 'je-orig-2' WHERE id = 'je-target'`);
    await expectEqualRows(`SELECT reversal_of_entry_id FROM journal_entries WHERE id = 'je-target'`, [{ reversal_of_entry_id: 'je-orig-2' }]);
  });

  it('les pièces sans contre-passation (reversal_of_entry_id NULL) ne sont pas concernées', async () => {
    await seedBoth(simpleEntry('je-plain', 5, 'jrn-vte', 'acc-3421', 'acc-7111', 100));
    await runBoth(`UPDATE journal_entries SET review_cycle = 'VENTES' WHERE id = 'je-plain'`);
    await expectEqualRows(`SELECT review_cycle FROM journal_entries WHERE id = 'je-plain'`, [{ review_cycle: 'VENTES' }]);
  });
});

describe('e. source_document_type : OPENING_BALANCE, VAT_DECLARATION_CENTRALIZATION, FX_REVALUATION', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth(simpleEntry('je-orig', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    await seal('je-orig');
  });

  it('les trois nouvelles valeurs sont ACCEPTÉES sur les deux moteurs', async () => {
    for (const [index, kind] of NEW_SOURCE_TYPES.entries()) {
      await seedBoth(simpleEntry(`je-new-${index}`, 10 + index, 'jrn-vte', 'acc-3421', 'acc-7111', 100, { source_document_type: kind }));
    }
    await expectEqualRows(`SELECT source_document_type FROM journal_entries WHERE id LIKE 'je-new-%' ORDER BY id`, NEW_SOURCE_TYPES.map((kind) => ({ source_document_type: kind })));
  });

  it('les huit valeurs d\'origine restent ACCEPTÉES (REVERSAL avec sa pièce POSTED)', async () => {
    for (const [index, kind] of OLD_SOURCE_TYPES.entries()) {
      const extra: RowValues = kind === 'REVERSAL' ? { reversal_of_entry_id: 'je-orig' } : {};
      await seedBoth(simpleEntry(`je-old-${index}`, 20 + index, 'jrn-vte', 'acc-3421', 'acc-7111', 100, { source_document_type: kind, ...extra }));
    }
    await expectEqualRows(`SELECT COUNT(*) AS n FROM journal_entries WHERE id LIKE 'je-old-%'`, [{ n: 8 }]);
  });

  it('une valeur inconnue, vide ou de casse différente est REFUSÉE par le CHECK (SQLite : CHECK constraint failed ; PostgreSQL : 23514 sur la contrainte nommée)', async () => {
    for (const value of ['MANUAL', '', 'opening_balance', 'OPENING_BALANCE ']) {
      const header = simpleEntry('je-bad', 40, 'jrn-vte', 'acc-3421', 'acc-7111', 100, { source_document_type: value })[0];
      if (header === undefined) {
        throw new Error('en-tête absent');
      }
      const { sql, params } = insertSqlite(header[0], header[1]);
      const [lite, pg] = await dual.onBoth((e) => e.fail(sql, params));
      expect(lite.message, value).toContain('CHECK constraint failed');
      expect(pg.code, value).toBe('23514');
      expect(pg.message, value).toContain(SOURCE_TYPES_CHECK);
    }
    await expectEqualRows(`SELECT COUNT(*) AS n FROM journal_entries WHERE id = 'je-bad'`, [{ n: 0 }]);
  });

  it('un UPDATE du type source d\'un brouillon vers une nouvelle valeur est accepté ; vers une valeur inconnue, refusé', async () => {
    await seedBoth(simpleEntry('je-d', 5, 'jrn-vte', 'acc-3421', 'acc-7111', 100));
    await runBoth(`UPDATE journal_entries SET source_document_type = 'FX_REVALUATION' WHERE id = 'je-d'`);
    const [lite, pg] = await dual.onBoth((e) => e.fail(`UPDATE journal_entries SET source_document_type = 'MANUAL' WHERE id = 'je-d'`));
    expect(lite.message).toContain('CHECK constraint failed');
    expect(pg.code).toBe('23514');
    await expectEqualRows(`SELECT source_document_type FROM journal_entries WHERE id = 'je-d'`, [{ source_document_type: 'FX_REVALUATION' }]);
  });

  it('le CHECK REVERSAL exige toujours reversal_of_entry_id après la reconstruction', async () => {
    const header = simpleEntry('je-rev', 6, 'jrn-vte', 'acc-7111', 'acc-3421', 100, { source_document_type: 'REVERSAL' })[0];
    if (header === undefined) {
      throw new Error('en-tête absent');
    }
    const { sql, params } = insertSqlite(header[0], header[1]);
    const [lite, pg] = await dual.onBoth((e) => e.fail(sql, params));
    expect(lite.message).toContain('CHECK constraint failed');
    expect(pg.code).toBe('23514');
  });

  it('une entrée entryRow par défaut garde ses valeurs : la reconstruction ne change ni colonnes ni défauts', () => {
    const db = openTenant();
    expect(all(db, `SELECT name FROM pragma_table_info('journal_entries') ORDER BY cid`).map((row) => String(row['name']))).toEqual([
      'id',
      'fiscal_year_id',
      'journal_id',
      'sequence_number',
      'entry_reference',
      'entry_date',
      'validated_at',
      'review_cycle',
      'status',
      'source_document_type',
      'invoice_id',
      'dgi_clearance_uuid',
      'partner_id',
      'reversal_of_entry_id',
      'total_debit_cents',
      'total_credit_cents',
      'previous_entry_hash',
      'entry_hash',
      'pii_restricted_flag',
    ]);
    expect(entryRow()['source_document_type']).toBe('INVOICE');
  });
});
