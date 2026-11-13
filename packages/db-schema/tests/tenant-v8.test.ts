import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TENANT_INDEX_NAMES,
  TENANT_MIGRATIONS,
  TENANT_POSTGRES_TRIGGER_NAMES,
  TENANT_TRIGGER_NAMES,
  tenantMigrationPostgresStatements,
} from '../src/tenant.ts';
import { DualEngines, RAISED, toPg, type Engine, type Failure } from './dual-engine.ts';
import { all } from './support.ts';
import {
  fiscalYearRow,
  insertSqlite,
  LEDGER_SEED,
  openTenant,
  POST_ENTRY_SQL,
  postParams,
  simpleEntry,
  type RowValues,
} from './tenant-support.ts';

/**
 * Migration tenant v8 (corrections G1 de l'auditeur sur le ticket T-S1B-04, clause éliminatoire R1-C3), prouvée sur SQLite
 * (node:sqlite) ET sur PostgreSQL 16, exécutés réellement, avec le MÊME texte d'erreur (RAISE(ABORT) contre RAISE EXCEPTION).
 * 1. injection d'une ligne dans une pièce POSTED par UPDATE de entry_id ;
 * 2. exercice CLOSED : scellement, changement d'exercice d'une pièce ;
 * 3. caisse 5161 : deux scellements concurrents sous PostgreSQL (deux connexions réelles, READ COMMITTED) ;
 * 4. contre-passation unique (UNIQUE partiel, SQLSTATE 23505) ;
 * 5. compte porté par une pièce POSTED non renumérotable.
 * Les migrations v1 à v7 sont immuables : leurs empreintes sont figées ici.
 */
const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_t8_${randomBytes(6).toString('hex')}`;

const FROZEN_SHA256 = [
  'a554a3477c4d1e3561b81e72e243fc72e2be519d155a3120a497ef0d93a04f61',
  'bfb09b92f078d2796cc62c0604bbc50d9bf3b5f7dffc3539704b564dca15b581',
  '71c6a880b7c231ff3d005d2d1edcee5ca7956e5c9dcf9e2af44a18c8ef7a1138',
  'f1cc97cfc9eff05135df66a7ae30b6eda31535c76a9eaad0d786e58ec1c1d85f',
  'b6c338fcb3808b9cc210fd73981a3f628e8d7148910de8a2d0c12a77ec1de295',
  '6750637f3351826b8cf4ecf816f46b232b41aad00bb7026c82c99ae86cd5b25f',
  'ac8e45e9e121ebd8a6a0d804688389ec037248f3f9fc5446e8b6c43c4f2e98dd',
] as const;
/** Empreinte figée de la v8 : toute modification de son DDL est une nouvelle migration, pas une retouche. */
const V8_SHA256 = 'a62dd9d288a801559cad88b7de070d03cc646e1130b2c36d5df4952ae21ee793';

const MSG_LINE_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Modification de ligne interdite sur pièce POSTED.';
const MSG_ENTRY_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Écriture validée immuable. Utilisez une contre-passation.';
const MSG_FY_CLOSED = 'CGNC_FISCAL_YEAR_CLOSED: Écriture refusée car cet exercice est clos.';
const MSG_FY_CHANGE = 'CGNC_FISCAL_YEAR_IMMUTABLE: Une pièce ne change jamais d exercice.';
const MSG_NEGATIVE_CASH = 'CGNC_NEGATIVE_CASH_5161: Décaissement refusé car il rendrait le solde de caisse 5161 créditeur.';
const MSG_ACCOUNT_RENUMBER = 'VIOLATION_PAF_CGI_ART_145: Compte porté par une pièce POSTED : numéro, classe et sens normal immuables.';
const MSG_PII_DOWNGRADE = 'VIOLATION_CNDP_LOI_09_08_ART_211: Restriction fiscale irréversible : pii_restricted_flag ne peut pas redescendre de 1 à 0.';

const V8_TRIGGERS = [
  'prevent_posted_lines_mutation_update',
  'enforce_balance_and_positive_cash_on_post',
  'prevent_post_in_closed_fiscal_year',
  'prevent_entry_fiscal_year_change',
  'prevent_posted_account_renumbering',
] as const;
const V8_INDEXES = ['uq_journal_entries_reversal_of'] as const;
const REVERSAL_INDEX = 'uq_journal_entries_reversal_of';

const RESET_ALL = `TRUNCATE archival_packages, payroll_annual_subledger, journal_entry_lines, journal_entries, bank_transactions,
  fixed_assets_register, journals, cgnc_accounts, fiscal_years, pos_z_closures, pos_tickets, pos_sessions, invoice_lines,
  invoice_delivery_links, invoices, delivery_notes, purchase_orders, fiscal_partners, tenant_key_grants CASCADE`;

let client: Client;
let dual: DualEngines;

async function connect(): Promise<Client> {
  const connection = new Client({ connectionString: PG_URL });
  await connection.connect();
  await connection.query(`SET search_path TO ${SCHEMA}`);
  return connection;
}

beforeAll(async () => {
  const admin = new Client({ connectionString: PG_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
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
  const remaining = await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [SCHEMA]);
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

/** Même texte sur les deux moteurs parmi plusieurs possibles (l'ordre d'exécution des triggers dépend du moteur). */
function expectEither(results: readonly [Failure, Failure], messages: readonly string[]): void {
  expect(messages).toContain(results[0].message);
  expect(messages).toContain(results[1].message);
  expect(results[0].code).toBeNull();
  expect(results[1].code).toBe(RAISED);
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
  await runBoth(POST_ENTRY_SQL, postParams(id));
}

describe('migration v8 : forme, immuabilité de v1 à v7, objets créés', () => {
  const v8 = TENANT_MIGRATIONS[7];

  it('est la huitième migration ; les empreintes de v1 à v7 sont inchangées (recalculées)', () => {
    expect(TENANT_MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(v8?.name).toBe('tenant_part8_g1_corrections_ledger_integrity');
    for (const [index, expected] of FROZEN_SHA256.entries()) {
      const migration = TENANT_MIGRATIONS[index];
      expect(migration?.expectedSha256Hex).toBe(expected);
      expect(createHash('sha256').update(migration?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex'), `v${index + 1}`).toBe(expected);
    }
  });

  it('l\'empreinte de la v8 est celle de upSqlStatements.join("\\n"), figée', () => {
    expect(v8?.expectedSha256Hex).toBe(V8_SHA256);
    expect(createHash('sha256').update(v8?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex')).toBe(v8?.expectedSha256Hex);
  });

  it('crée exactement les triggers et l\'index du registre, aucune table ni vue ; deux triggers sont des remplacements de v3 et v4', () => {
    expect(v8?.triggerNames).toEqual([...V8_TRIGGERS]);
    expect(v8?.indexNames).toEqual([...V8_INDEXES]);
    expect(v8?.tableNames).toEqual([]);
    expect(v8?.viewNames ?? []).toEqual([]);
    expect(v8?.sqliteOnlyTriggerNames ?? []).toEqual([]);
    expect(TENANT_TRIGGER_NAMES.slice(-3)).toEqual(V8_TRIGGERS.slice(2));
    expect(TENANT_POSTGRES_TRIGGER_NAMES.slice(-3)).toEqual(V8_TRIGGERS.slice(2));
    expect(TENANT_INDEX_NAMES.at(-1)).toBe(REVERSAL_INDEX);
  });

  it('la traduction PostgreSQL garde une instruction par instruction SQLite et pose le verrou consultatif de transaction', () => {
    if (v8 === undefined) {
      throw new Error('migration v8 absente');
    }
    const statements = tenantMigrationPostgresStatements(v8);
    expect(statements).toHaveLength(v8.upSqlStatements.length);
    expect(statements.join('\n')).not.toMatch(/\bINTEGER\b/);
    expect(statements.join('\n')).not.toMatch(/CAST\(/);
    expect(statements.join('\n')).toContain('pg_advisory_xact_lock');
    expect(v8.upSqlStatements.join('\n')).not.toContain('pg_advisory');
  });

  it('une base v7 pleine se met à niveau sans perte en appliquant seulement la v8', () => {
    const db = openTenant(7);
    for (const [table, values] of LEDGER_SEED) {
      const { sql, params } = insertSqlite(table, values);
      db.prepare(sql).run(...params);
    }
    for (const [table, values] of simpleEntry('je-old', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 500)) {
      const { sql, params } = insertSqlite(table, values);
      db.prepare(sql).run(...params);
    }
    for (const statement of v8?.upSqlStatements ?? []) {
      db.exec(statement);
    }
    expect(all(db, 'SELECT COUNT(*) AS n FROM journal_entry_lines')).toEqual([{ n: 2 }]);
    expect(names(db, 'index')).toContain(REVERSAL_INDEX);
    for (const name of V8_TRIGGERS) {
      expect(names(db, 'trigger'), name).toContain(name);
    }
  });

  it('PostgreSQL porte exactement les triggers PG du registre, l\'index partiel unique et un verrou consultatif dans la fonction de scellement', async () => {
    const triggers = await client.query(
      `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND NOT t.tgisinternal ORDER BY t.tgname`,
      [SCHEMA],
    );
    expect(triggers.rows.map((row: { tgname: string }) => row.tgname)).toEqual([...TENANT_POSTGRES_TRIGGER_NAMES].sort());
    expect(names(openTenant(), 'trigger')).toEqual([...TENANT_TRIGGER_NAMES].sort());
    const index = await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [SCHEMA, REVERSAL_INDEX]);
    expect(index.rows.map((row: { indexdef: string }) => row.indexdef)).toEqual([
      `CREATE UNIQUE INDEX ${REVERSAL_INDEX} ON ${SCHEMA}.journal_entries USING btree (reversal_of_entry_id) WHERE (reversal_of_entry_id IS NOT NULL)`,
    ]);
    const source = await client.query(
      `SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1 AND p.proname = 'fisca_enforce_balance_and_positive_cash_on_post'`,
      [SCHEMA],
    );
    expect(String(source.rows[0]?.prosrc)).toContain('pg_advisory_xact_lock');
  });
});

describe('1. injection dans une pièce POSTED par UPDATE de journal_entry_lines.entry_id', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth(simpleEntry('je-posted', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 1000));
    await seal('je-posted');
    await seedBoth(simpleEntry('je-draft', 2, 'jrn-vte', 'acc-3421', 'acc-7111', 700));
    await seedBoth(simpleEntry('je-draft2', 3, 'jrn-vte', 'acc-3421', 'acc-7111', 300));
  });

  it('déplacer une ligne de brouillon VERS une pièce POSTED est refusé, même texte ; rien n\'est déplacé', async () => {
    await failBoth(`UPDATE journal_entry_lines SET entry_id = 'je-posted', line_number = 9 WHERE id = 'je-draft-l1'`, MSG_LINE_UPDATE);
    await failBoth(`UPDATE journal_entry_lines SET entry_id = 'je-posted' WHERE id = 'je-draft-l1'`, MSG_LINE_UPDATE);
    await expectEqualRows(`SELECT entry_id, line_number FROM journal_entry_lines WHERE id = 'je-draft-l1'`, [{ entry_id: 'je-draft', line_number: '1' }]);
    await expectEqualRows(`SELECT COUNT(*) AS n FROM journal_entry_lines WHERE entry_id = 'je-posted'`, [{ n: 2 }]);
  });

  it('déplacer une ligne d\'une pièce POSTED VERS un brouillon est refusé, même texte', async () => {
    await failBoth(`UPDATE journal_entry_lines SET entry_id = 'je-draft', line_number = 9 WHERE id = 'je-posted-l1'`, MSG_LINE_UPDATE);
    await expectEqualRows(`SELECT entry_id FROM journal_entry_lines WHERE id = 'je-posted-l1'`, [{ entry_id: 'je-posted' }]);
  });

  it('déplacer une ligne de brouillon vers un autre brouillon reste accepté', async () => {
    await runBoth(`UPDATE journal_entry_lines SET entry_id = 'je-draft2', line_number = 9 WHERE id = 'je-draft-l1'`);
    await expectEqualRows(`SELECT entry_id, line_number FROM journal_entry_lines WHERE id = 'je-draft-l1'`, [{ entry_id: 'je-draft2', line_number: '9' }]);
  });

  it('flux légitime inchangé : modification libre d\'une ligne de brouillon, montée 0 vers 1 du drapeau sur POSTED, scellement ensuite', async () => {
    await runBoth(`UPDATE journal_entry_lines SET description_enc = 'v1:aXY:bm91dmVhdQ', auxiliary_account = 'AUX' WHERE id = 'je-draft-l1'`);
    await runBoth(`UPDATE journal_entry_lines SET pii_restricted_flag = 1 WHERE id = 'je-posted-l1'`);
    await expectEqualRows(`SELECT pii_restricted_flag FROM journal_entry_lines WHERE id = 'je-posted-l1'`, [{ pii_restricted_flag: 1 }]);
    expectEither(await dual.onBoth((e) => e.fail(`UPDATE journal_entry_lines SET pii_restricted_flag = 0 WHERE id = 'je-posted-l1'`)), [MSG_PII_DOWNGRADE, MSG_LINE_UPDATE]);
    await failBoth(`UPDATE journal_entry_lines SET description_enc = 'x' WHERE id = 'je-posted-l2'`, MSG_LINE_UPDATE);
    await seal('je-draft');
    await expectEqualRows(`SELECT status FROM journal_entries WHERE id = 'je-draft'`, [{ status: 'POSTED' }]);
  });

  it('la montée du drapeau ne passe pas quand elle accompagne un changement d\'entry_id (ancienne pièce POSTED)', async () => {
    await failBoth(`UPDATE journal_entry_lines SET pii_restricted_flag = 1, entry_id = 'je-draft', line_number = 9 WHERE id = 'je-posted-l1'`, MSG_LINE_UPDATE);
    await expectEqualRows(`SELECT entry_id, pii_restricted_flag FROM journal_entry_lines WHERE id = 'je-posted-l1'`, [{ entry_id: 'je-posted', pii_restricted_flag: 0 }]);
  });
});

describe('2. exercice CLOSED : scellement et changement d\'exercice', () => {
  const FY_2027 = fiscalYearRow({ id: 'fy-2027', code: 'EX-2027', start_date: '2027-01-01', end_date: '2027-12-31' });

  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth([['fiscal_years', FY_2027]]);
  });

  it('le passage à POSTED d\'une pièce d\'un exercice CLOSED est refusé, même texte ; accepté dans OPEN et CLOSING', async () => {
    await seedBoth(simpleEntry('je-open', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 500, { status: 'REVISEE_CYCLE' }));
    await seal('je-open');
    await seedBoth(simpleEntry('je-closing', 2, 'jrn-vte', 'acc-3421', 'acc-7111', 500, { status: 'REVISEE_CYCLE' }));
    await runBoth(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`);
    await seal('je-closing');
    await seedBoth(simpleEntry('je-late', 3, 'jrn-vte', 'acc-3421', 'acc-7111', 500, { status: 'REVISEE_CYCLE' }));
    await runBoth(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`);
    expectSame(await dual.onBoth((e) => e.fail(POST_ENTRY_SQL, postParams('je-late'))), MSG_FY_CLOSED);
    await expectEqualRows(`SELECT id, status FROM journal_entries ORDER BY id`, [
      { id: 'je-closing', status: 'POSTED' },
      { id: 'je-late', status: 'REVISEE_CYCLE' },
      { id: 'je-open', status: 'POSTED' },
    ]);
  });

  it('la transition CLOSING vers CLOSED d\'un exercice reste permise', async () => {
    await runBoth(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`);
    await runBoth(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`);
    await expectEqualRows(`SELECT status FROM fiscal_years WHERE id = 'fy-2026'`, [{ status: 'CLOSED' }]);
  });

  it('un UPDATE de fiscal_year_id vers un exercice CLOSED, ou vers un exercice OPEN, est refusé pour un brouillon', async () => {
    await seedBoth(simpleEntry('je-draft', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    await seedBoth([['fiscal_years', fiscalYearRow({ id: 'fy-2025', code: 'EX-2025', start_date: '2025-01-01', end_date: '2025-12-31', status: 'CLOSED' })]]);
    await failBoth(`UPDATE journal_entries SET fiscal_year_id = 'fy-2025' WHERE id = 'je-draft'`, MSG_FY_CHANGE);
    await failBoth(`UPDATE journal_entries SET fiscal_year_id = 'fy-2027', sequence_number = 7 WHERE id = 'je-draft'`, MSG_FY_CHANGE);
    await expectEqualRows(`SELECT fiscal_year_id, sequence_number FROM journal_entries WHERE id = 'je-draft'`, [{ fiscal_year_id: 'fy-2026', sequence_number: '1' }]);
  });

  it('un UPDATE qui laisse fiscal_year_id inchangé reste accepté ; une pièce POSTED reste refusée (texte de pièce validée)', async () => {
    await seedBoth(simpleEntry('je-draft', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    await runBoth(`UPDATE journal_entries SET fiscal_year_id = 'fy-2026', review_cycle = 'VENTES' WHERE id = 'je-draft'`);
    await expectEqualRows(`SELECT review_cycle FROM journal_entries WHERE id = 'je-draft'`, [{ review_cycle: 'VENTES' }]);
    await seal('je-draft');
    await failBoth(`UPDATE journal_entries SET fiscal_year_id = 'fy-2027' WHERE id = 'je-draft'`, MSG_ENTRY_UPDATE);
  });

  it('le journal d\'à-nouveaux s\'insère dans le NOUVEL exercice ouvert puis se scelle pendant que l\'ancien est CLOSED', async () => {
    await runBoth(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`);
    await runBoth(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`);
    await seedBoth(simpleEntry('je-an', 1, 'jrn-an', 'acc-5161', 'acc-1111', 100000, { fiscal_year_id: 'fy-2027', source_document_type: 'CUTOFF_OD', entry_date: '2027-01-01' }));
    await runBoth(`UPDATE journal_entries SET status = 'REVISEE_CYCLE' WHERE id = 'je-an'`);
    await seal('je-an');
    await expectEqualRows(`SELECT fiscal_year_id, status FROM journal_entries`, [{ fiscal_year_id: 'fy-2027', status: 'POSTED' }]);
  });
});

describe('3. caisse 5161 : scellements concurrents sous PostgreSQL (READ COMMITTED, deux connexions réelles)', () => {
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
    // Une transaction restée ouverte par un échec d'assertion ne doit pas bloquer les tests suivants.
    await first.query('ROLLBACK');
    await second.query('ROLLBACK');
  });

  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    // Solde de caisse : 10 000 centimes (pièce POSTED débitant 5161).
    await seedBoth(simpleEntry('je-fund', 1, 'jrn-cai', 'acc-5161', 'acc-1111', 10000));
    await seal('je-fund');
    // Deux décaissements de 6 000 centimes chacun, déjà prêts à sceller, plus une pièce sans caisse.
    await seedBoth(simpleEntry('je-out-1', 2, 'jrn-cai', 'acc-6111', 'acc-5161', 6000));
    await seedBoth(simpleEntry('je-out-2', 3, 'jrn-cai', 'acc-6111', 'acc-5161', 6000));
    await seedBoth(simpleEntry('je-other', 4, 'jrn-vte', 'acc-3421', 'acc-7111', 900));
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

  async function waitsOnAdvisoryLock(pid: number): Promise<boolean> {
    const result = await observer.query(`SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND pid = $1`, [pid]);
    return (result.rowCount ?? 0) > 0;
  }

  async function cashBalance(): Promise<number> {
    const result = await client.query(
      `SELECT CAST(COALESCE(SUM(jel.debit_cents - jel.credit_cents), 0) AS BIGINT) AS net
         FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id JOIN cgnc_accounts ca ON ca.id = jel.account_id
        WHERE je.status = 'POSTED' AND ca.account_number LIKE '5161%'`,
    );
    return Number(result.rows[0]?.net);
  }

  it('le second scellement échoue avec « caisse négative » : solde final non négatif (deux crédits de 6 000 sur 10 000)', async () => {
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
    // Barrière : le second scellement a soit déjà lu le solde (sans verrou, il se termine pendant que le premier est ouvert),
    // soit attend le verrou consultatif de transaction posé par le premier.
    await waitUntil(async () => secondSettled || (await waitsOnAdvisoryLock(secondPid)));
    await first.query('COMMIT');
    const outcome = await secondAttempt;
    await second.query(outcome.failure === null ? 'COMMIT' : 'ROLLBACK');
    expect(outcome.failure).toBe(MSG_NEGATIVE_CASH);
    expect(await cashBalance()).toBe(4000);
    const statuses = await client.query(`SELECT id, status FROM journal_entries WHERE id LIKE 'je-out-%' ORDER BY id`);
    expect(statuses.rows).toEqual([
      { id: 'je-out-1', status: 'POSTED' },
      { id: 'je-out-2', status: 'DRAFT' },
    ]);
  });

  it('le verrou est pris pour les seuls scellements qui créditent la caisse : une pièce sans 5161 n\'attend pas', async () => {
    await first.query('BEGIN');
    await first.query(toPg(POST_ENTRY_SQL), postParams('je-out-1'));
    await second.query('BEGIN');
    await second.query(toPg(POST_ENTRY_SQL), postParams('je-other'));
    await second.query('COMMIT');
    await first.query('COMMIT');
    expect(await cashBalance()).toBe(4000);
  });

  it('après le COMMIT du premier, un scellement couvert par le solde passe (le verrou est libéré avec la transaction)', async () => {
    await runBoth(`UPDATE journal_entry_lines SET credit_cents = 3000 WHERE id = 'je-out-2-l2'`);
    await runBoth(`UPDATE journal_entry_lines SET debit_cents = 3000 WHERE id = 'je-out-2-l1'`);
    await runBoth(`UPDATE journal_entries SET total_debit_cents = 3000, total_credit_cents = 3000 WHERE id = 'je-out-2'`);
    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(toPg(POST_ENTRY_SQL), postParams('je-out-1'));
    const secondPid = await backendPid(second);
    const secondAttempt = second.query(toPg(POST_ENTRY_SQL), postParams('je-out-2'));
    await waitUntil(async () => waitsOnAdvisoryLock(secondPid));
    await first.query('COMMIT');
    await secondAttempt;
    await second.query('COMMIT');
    expect(await cashBalance()).toBe(1000);
  });
});

describe('4. contre-passation unique : index partiel unique sur reversal_of_entry_id', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth([['journals', { id: 'jrn-od', code: 'OD', name: 'Operations diverses', journal_type: 'GENERAL' }]]);
    await seedBoth(simpleEntry('je-orig', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    await seal('je-orig');
    await seedBoth(simpleEntry('je-orig-2', 2, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    await seal('je-orig-2');
  });

  const reversal = (id: string, sequence: number, of: string): readonly (readonly [string, RowValues])[] =>
    simpleEntry(id, sequence, 'jrn-od', 'acc-7111', 'acc-3421', 500, { source_document_type: 'REVERSAL', reversal_of_entry_id: of });

  it('deux REVERSAL de la même pièce : la seconde est refusée par UNIQUE (SQLite) et 23505 (PostgreSQL)', async () => {
    await seedBoth(reversal('je-rev-1', 1, 'je-orig'));
    const header = reversal('je-rev-2', 2, 'je-orig')[0];
    if (header === undefined) {
      throw new Error('en-tête absent');
    }
    const { sql, params } = insertSqlite(header[0], header[1]);
    const [lite, pg] = await dual.onBoth((e) => e.fail(sql, params));
    expect(lite.message).toContain('UNIQUE constraint failed: journal_entries.reversal_of_entry_id');
    expect(pg.code).toBe('23505');
    expect(pg.message).toContain(REVERSAL_INDEX);
    await expectEqualRows(`SELECT COUNT(*) AS n FROM journal_entries WHERE reversal_of_entry_id = 'je-orig'`, [{ n: 1 }]);
  });

  it('plusieurs pièces sans contre-passation (NULL) et des contre-passations de pièces différentes restent permises', async () => {
    await seedBoth(reversal('je-rev-1', 1, 'je-orig'));
    await seedBoth(reversal('je-rev-2', 2, 'je-orig-2'));
    await expectEqualRows(`SELECT COUNT(*) AS n FROM journal_entries WHERE reversal_of_entry_id IS NULL`, [{ n: 2 }]);
    await expectEqualRows(`SELECT COUNT(*) AS n FROM journal_entries WHERE reversal_of_entry_id IS NOT NULL`, [{ n: 2 }]);
  });
});

describe('5. compte porté par une pièce POSTED : numéro, classe et sens normal immuables', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth(simpleEntry('je-posted', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    await seal('je-posted');
    await seedBoth(simpleEntry('je-draft', 2, 'jrn-vte', 'acc-6111', 'acc-1111', 500));
  });

  it('refuse la renumérotation, le changement de classe et de sens normal d\'un compte utilisé par une pièce POSTED, même texte', async () => {
    await failBoth(`UPDATE cgnc_accounts SET account_number = '34219999' WHERE id = 'acc-3421'`, MSG_ACCOUNT_RENUMBER);
    await failBoth(`UPDATE cgnc_accounts SET cgnc_class = 4 WHERE id = 'acc-7111'`, MSG_ACCOUNT_RENUMBER);
    await failBoth(`UPDATE cgnc_accounts SET normal_balance = 'DEBIT' WHERE id = 'acc-7111'`, MSG_ACCOUNT_RENUMBER);
    await expectEqualRows(`SELECT account_number, cgnc_class, normal_balance FROM cgnc_accounts WHERE id IN ('acc-3421', 'acc-7111') ORDER BY id`, [
      { account_number: '34211000', cgnc_class: 3, normal_balance: 'DEBIT' },
      { account_number: '71111000', cgnc_class: 7, normal_balance: 'CREDIT' },
    ]);
  });

  it('libre tant qu\'aucune pièce POSTED ne porte le compte (brouillon seul, ou aucune ligne), et le libellé reste modifiable', async () => {
    await runBoth(`UPDATE cgnc_accounts SET account_number = '61119999', cgnc_class = 6 WHERE id = 'acc-6111'`);
    await runBoth(`UPDATE cgnc_accounts SET account_number = '11119999' WHERE id = 'acc-1111'`);
    await runBoth(`UPDATE cgnc_accounts SET label_fr = 'Clients (libellé révisé)' WHERE id = 'acc-3421'`);
    await runBoth(`UPDATE cgnc_accounts SET account_number = '34211000' WHERE id = 'acc-3421'`);
    await expectEqualRows(`SELECT account_number FROM cgnc_accounts WHERE id IN ('acc-6111', 'acc-1111') ORDER BY id`, [
      { account_number: '11119999' },
      { account_number: '61119999' },
    ]);
  });

  it('le compte devient figé dès que la pièce qui le porte passe POSTED', async () => {
    await runBoth(`UPDATE cgnc_accounts SET account_number = '61110001' WHERE id = 'acc-6111'`);
    await seal('je-draft');
    await failBoth(`UPDATE cgnc_accounts SET account_number = '61110002' WHERE id = 'acc-6111'`, MSG_ACCOUNT_RENUMBER);
  });
});
