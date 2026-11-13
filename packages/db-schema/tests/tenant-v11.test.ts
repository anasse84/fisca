import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TENANT_MIGRATIONS,
  TENANT_POSTGRES_TRIGGER_NAMES,
  TENANT_TRIGGER_NAMES,
  TENANT_V11_TRIGGER_MESSAGES,
  tenantMigrationPostgresStatements,
} from '../src/index.ts';
import { DualEngines, RAISED, toPg, type Engine, type Failure } from './dual-engine.ts';
import { all } from './support.ts';
import {
  entryWithLines,
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
 * Migration tenant v11 (T-S1B-04, DÉCISION DU PILOTE 7, Doc_02) : une pièce ne passe à POSTED QUE depuis REVISEE_CYCLE (visa du
 * chef de mission). Trigger `enforce_posted_only_from_revised_cycle`, prouvé sur SQLite (node:sqlite) ET PostgreSQL 16 réels,
 * avec le MÊME texte d'erreur. REMPLACE la règle « DRAFT vers POSTED accepté » que la v9 documentait comme écart.
 */
const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_t11_${randomBytes(6).toString('hex')}`;
const SCHEMA_UPGRADE = `fisca_t11u_${randomBytes(6).toString('hex')}`;

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
  'e58f870734fa070fc821dc8901350582d7ca45bd22ad111ae094d1682e255f4d',
] as const;
/** Empreinte figée de la v11 : toute modification de son DDL est une nouvelle migration. */
const V11_SHA256 = '2c5a9fab8e526eb204c6a086eaa40d097bc39babf4560af12fbb6293f65e36c4';
const TRIGGER = 'enforce_posted_only_from_revised_cycle';

const MSG_STATUS = 'CGNC_POST_ONLY_FROM_REVISED_CYCLE: Une pièce ne passe à POSTED que depuis REVISEE_CYCLE (visa du chef de mission).';
const MSG_ENTRY_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Écriture validée immuable. Utilisez une contre-passation.';
const MSG_UNBALANCED = 'CGNC_UNBALANCED_LINES: La somme des lignes ne boucle pas avec le total de la pièce.';
const MSG_MISSING_HASH = 'PAF_MISSING_HASH: Empreinte SHA-256 obligatoire pour sceller en POSTED.';
const MSG_NEGATIVE_CASH = 'CGNC_NEGATIVE_CASH_5161: Décaissement refusé car il rendrait le solde de caisse 5161 créditeur.';
const MSG_FY_CLOSED = 'CGNC_FISCAL_YEAR_CLOSED: Écriture refusée car cet exercice est clos.';
const MSG_REVERSAL_TARGET = 'CGNC_REVERSAL_TARGET_INVALID: La pièce contre-passée doit exister et être POSTED.';

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
  const remaining = await client.query('SELECT 1 FROM pg_namespace WHERE nspname IN ($1, $2)', [SCHEMA, SCHEMA_UPGRADE]);
  await client.end();
  expect(remaining.rowCount).toBe(0);
});

async function seedBoth(rows: readonly (readonly [string, RowValues])[]): Promise<void> {
  for (const engine of dual.engines()) {
    for (const [table, values] of rows) {
      const { sql, params } = insertSqlite(table, values);
      await engine.run(sql, params);
    }
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
  expectSame(await dual.onBoth((e: Engine) => e.fail(sql, params)), message);
}

async function expectEqualRows(sql: string, expected: readonly Record<string, string | number | null>[]): Promise<void> {
  const [lite, pg] = await dual.onBoth((e: Engine) => e.rows(sql));
  expect(lite).toEqual(expected);
  expect(pg).toEqual(expected);
}

function names(db: DatabaseSync, type: 'trigger'): string[] {
  return all(db, `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`, type).map((row) => String(row['name']));
}

async function setStatus(id: string, status: string): Promise<void> {
  await runBoth(`UPDATE journal_entries SET status = '${status}' WHERE id = '${id}'`);
}

async function statusOf(id: string): Promise<void> {
  await expectEqualRows(`SELECT status FROM journal_entries WHERE id = '${id}'`, [{ status: 'DRAFT' }]);
}

describe('migration v11 : forme, immuabilité de v1 à v10, objets créés', () => {
  const v11 = TENANT_MIGRATIONS[10];

  it('est la onzième migration ; les empreintes de v1 à v10 sont inchangées (recalculées)', () => {
    expect(TENANT_MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(v11?.name).toBe('tenant_part11_posted_only_from_revised_cycle');
    for (const [index, expected] of FROZEN_SHA256.entries()) {
      const migration = TENANT_MIGRATIONS[index];
      expect(migration?.expectedSha256Hex).toBe(expected);
      expect(createHash('sha256').update(migration?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex'), `v${index + 1}`).toBe(expected);
    }
  });

  it("l'empreinte de la v11 est celle de upSqlStatements.join(\"\\n\"), figée", () => {
    expect(v11?.expectedSha256Hex).toBe(V11_SHA256);
    expect(createHash('sha256').update(v11?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex')).toBe(v11?.expectedSha256Hex);
  });

  it('crée un seul trigger (sur les deux moteurs), aucune table ni index ; le texte commun est la constante exportée', () => {
    expect(v11?.triggerNames).toEqual([TRIGGER]);
    expect(v11?.sqliteOnlyTriggerNames ?? []).toEqual([]);
    expect(v11?.tableNames).toEqual([]);
    expect(v11?.indexNames).toEqual([]);
    expect(TENANT_V11_TRIGGER_MESSAGES.postedOnlyFromRevisedCycle).toBe(MSG_STATUS);
    expect(TENANT_TRIGGER_NAMES.at(-1)).toBe(TRIGGER);
    expect(TENANT_POSTGRES_TRIGGER_NAMES.at(-1)).toBe(TRIGGER);
  });

  it('la traduction PostgreSQL garde une instruction par instruction SQLite ; SQLite RAISE(ABORT), PostgreSQL RAISE EXCEPTION', () => {
    if (v11 === undefined) {
      throw new Error('migration v11 absente');
    }
    const statements = tenantMigrationPostgresStatements(v11);
    expect(statements).toHaveLength(v11.upSqlStatements.length);
    expect(v11.upSqlStatements.join('\n')).toContain(`RAISE(ABORT, '${MSG_STATUS}')`);
    expect(statements.join('\n')).toContain('RAISE EXCEPTION');
    expect(statements.join('\n')).toContain(`fisca_${TRIGGER}`);
  });

  it('PostgreSQL et SQLite portent exactement les triggers du registre, v11 comprise', async () => {
    const triggers = await client.query(
      `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND NOT t.tgisinternal ORDER BY t.tgname`,
      [SCHEMA],
    );
    const pgNames = triggers.rows.map((row: { tgname: string }) => row.tgname);
    expect(pgNames).toEqual([...TENANT_POSTGRES_TRIGGER_NAMES].sort());
    expect(names(openTenant(), 'trigger')).toEqual([...TENANT_TRIGGER_NAMES].sort());
    expect(pgNames).toContain(TRIGGER);
    expect(names(openTenant(), 'trigger')).toContain(TRIGGER);
  });

  it('mise à niveau v10 vers v11 sur des données existantes (SQLite par le migrateur, PostgreSQL par les instructions) : le trigger apparaît, les pièces restent', async () => {
    const lite = openTenant(10);
    for (const [table, values] of [...LEDGER_SEED, ...simpleEntry('je-old', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 100)]) {
      const { sql, params } = insertSqlite(table, values);
      lite.prepare(sql).run(...params);
    }
    expect(names(lite, 'trigger')).not.toContain(TRIGGER);
    const upgrade = await connect(SCHEMA_UPGRADE);
    try {
      for (const migration of TENANT_MIGRATIONS.filter((m) => m.version <= 10)) {
        for (const statement of tenantMigrationPostgresStatements(migration)) {
          await upgrade.query(statement);
        }
      }
      for (const [table, values] of [...LEDGER_SEED, ...simpleEntry('je-old', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 100)]) {
        const { sql, params } = insertSqlite(table, values);
        await upgrade.query(toPg(sql), [...params]);
      }
      const v11 = TENANT_MIGRATIONS[10];
      for (const statement of v11 === undefined ? [] : tenantMigrationPostgresStatements(v11)) {
        await upgrade.query(statement);
      }
      await expect(upgrade.query(`UPDATE journal_entries SET status = 'POSTED', validated_at = $1, entry_hash = $2, previous_entry_hash = $3 WHERE id = 'je-old'`, postParams('x').slice(0, 3))).rejects.toThrow(MSG_STATUS);
    } finally {
      await upgrade.end();
    }
    const v11 = TENANT_MIGRATIONS[10];
    for (const statement of v11?.upSqlStatements ?? []) {
      lite.exec(statement);
    }
    expect(names(lite, 'trigger')).toContain(TRIGGER);
    expect(() => lite.prepare(POST_ENTRY_SQL).run(...postParams('je-old'))).toThrow(MSG_STATUS);
    expect(all(lite, `SELECT status FROM journal_entries WHERE id = 'je-old'`).map((row) => ({ ...row }))).toEqual([{ status: 'DRAFT' }]);
  });
});

describe('statut cible POSTED : seulement depuis REVISEE_CYCLE (décision du pilote 7)', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth(simpleEntry('je-draft', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    await seedBoth(simpleEntry('je-ia', 2, 'jrn-vte', 'acc-3421', 'acc-7111', 400, { status: 'IA_PROPOSITION' }));
    await seedBoth(simpleEntry('je-rev', 3, 'jrn-vte', 'acc-3421', 'acc-7111', 300, { status: 'REVISEE_CYCLE' }));
  });

  it('DRAFT vers POSTED est refusé, même texte sur les deux moteurs ; la pièce reste DRAFT', async () => {
    await failBoth(POST_ENTRY_SQL, MSG_STATUS, postParams('je-draft'));
    await statusOf('je-draft');
  });

  it('IA_PROPOSITION vers POSTED est refusé, même texte ; la pièce reste IA_PROPOSITION', async () => {
    await failBoth(POST_ENTRY_SQL, MSG_STATUS, postParams('je-ia'));
    await expectEqualRows(`SELECT status FROM journal_entries WHERE id = 'je-ia'`, [{ status: 'IA_PROPOSITION' }]);
  });

  it('REVISEE_CYCLE vers POSTED est accepté : flux complet DRAFT, REVISEE_CYCLE, POSTED avec équilibre et empreintes', async () => {
    await setStatus('je-draft', 'REVISEE_CYCLE');
    await runBoth(POST_ENTRY_SQL, postParams('je-draft'));
    await runBoth(POST_ENTRY_SQL, postParams('je-rev'));
    await expectEqualRows(`SELECT id, status, entry_hash, previous_entry_hash FROM journal_entries WHERE id IN ('je-draft', 'je-rev') ORDER BY id`, [
      { id: 'je-draft', status: 'POSTED', entry_hash: postParams('x')[1], previous_entry_hash: postParams('x')[2] },
      { id: 'je-rev', status: 'POSTED', entry_hash: postParams('x')[1], previous_entry_hash: postParams('x')[2] },
    ]);
    await expectEqualRows(`SELECT account_number, posted_balance_cents FROM cgnc_accounts WHERE id IN ('acc-3421', 'acc-7111') ORDER BY id`, [
      { account_number: '34211000', posted_balance_cents: 800 },
      { account_number: '71111000', posted_balance_cents: -800 },
    ]);
  });

  it('les autres refus du scellement ne sont pas masqués : empreinte absente, déséquilibre, caisse 5161 négative, exercice clos', async () => {
    await seedBoth(entryWithLines('je-unbal', 4, 'jrn-vte', [{ account: 'acc-3421', debit: 100 }, { account: 'acc-7111', credit: 90 }], { status: 'REVISEE_CYCLE', total_debit_cents: 100, total_credit_cents: 100 }));
    await failBoth(`UPDATE journal_entries SET status = 'POSTED' WHERE id = 'je-rev'`, MSG_MISSING_HASH);
    await failBoth(POST_ENTRY_SQL, MSG_UNBALANCED, postParams('je-unbal'));
    await seedBoth(entryWithLines('je-cash', 5, 'jrn-cai', [{ account: 'acc-6111', debit: 90 }, { account: 'acc-5161', credit: 90 }], { status: 'REVISEE_CYCLE' }));
    await failBoth(POST_ENTRY_SQL, MSG_NEGATIVE_CASH, postParams('je-cash'));
    // Cumul : brouillon (refus de statut) ET sans empreinte / déséquilibré : le texte de la v3 passe d'abord (SQLite exécute le dernier trigger créé en premier, PostgreSQL l'ordre alphabétique : la v11 s'efface devant les autres refus, justifié en tête de la v11).
    await seedBoth(entryWithLines('je-cum', 6, 'jrn-vte', [{ account: 'acc-3421', debit: 100 }, { account: 'acc-7111', credit: 90 }], { total_debit_cents: 100, total_credit_cents: 100 }));
    await failBoth(POST_ENTRY_SQL, MSG_UNBALANCED, postParams('je-cum'));
    await failBoth(`UPDATE journal_entries SET status = 'POSTED' WHERE id = 'je-draft'`, MSG_MISSING_HASH);
    await seedBoth(entryWithLines('je-cash-draft', 7, 'jrn-cai', [{ account: 'acc-6111', debit: 90 }, { account: 'acc-5161', credit: 90 }]));
    await failBoth(POST_ENTRY_SQL, MSG_NEGATIVE_CASH, postParams('je-cash-draft'));
    // Changement d'exercice (v8) : son texte l'emporte aussi sur le refus de statut.
    await seedBoth([['fiscal_years', fiscalYearRow({ id: 'fy-2027', code: 'EX-2027', start_date: '2027-01-01', end_date: '2027-12-31' })]]);
    await failBoth(`UPDATE journal_entries SET status = 'POSTED', fiscal_year_id = 'fy-2027', validated_at = ?, entry_hash = ?, previous_entry_hash = ? WHERE id = ?`, 'CGNC_FISCAL_YEAR_IMMUTABLE: Une pièce ne change jamais d exercice.', postParams('je-draft'));
    await runBoth(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`);
    await runBoth(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`);
    await failBoth(POST_ENTRY_SQL, MSG_FY_CLOSED, postParams('je-rev'));
    await failBoth(POST_ENTRY_SQL, MSG_FY_CLOSED, postParams('je-draft'));
  });

  it('POSTED vers POSTED (UPDATE sans changement de statut) reste refusé par prevent_posted_entry_update, texte inchangé', async () => {
    await runBoth(POST_ENTRY_SQL, postParams('je-rev'));
    await failBoth(`UPDATE journal_entries SET status = 'POSTED', review_cycle = 'VENTES' WHERE id = 'je-rev'`, MSG_ENTRY_UPDATE);
    await failBoth(`UPDATE journal_entries SET entry_date = '2026-11-14' WHERE id = 'je-rev'`, MSG_ENTRY_UPDATE);
  });

  it('les autres transitions de statut ne sont pas gênées (DRAFT, REVISEE_CYCLE, retour en DRAFT)', async () => {
    await setStatus('je-ia', 'DRAFT');
    await setStatus('je-draft', 'REVISEE_CYCLE');
    await setStatus('je-rev', 'DRAFT');
    await expectEqualRows(`SELECT id, status FROM journal_entries ORDER BY id`, [
      { id: 'je-draft', status: 'REVISEE_CYCLE' },
      { id: 'je-ia', status: 'DRAFT' },
      { id: 'je-rev', status: 'DRAFT' },
    ]);
  });

  it('la montée monotone du drapeau sur pièce POSTED et l\'insertion d\'une contre-passation ne sont pas gênées', async () => {
    await runBoth(POST_ENTRY_SQL, postParams('je-rev'));
    await runBoth(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-rev'`);
    await seedBoth(simpleEntry('je-cancel', 4, 'jrn-vte', 'acc-7111', 'acc-3421', 300, { source_document_type: 'REVERSAL', reversal_of_entry_id: 'je-rev' }));
    await expectEqualRows(`SELECT pii_restricted_flag AS f FROM journal_entries WHERE id = 'je-rev'`, [{ f: '1' }]);
    await expectEqualRows(`SELECT status, reversal_of_entry_id FROM journal_entries WHERE id = 'je-cancel'`, [{ status: 'DRAFT', reversal_of_entry_id: 'je-rev' }]);
    // v9 toujours actif : la cible d'une contre-passation doit être POSTED.
    const bad = entryWithLines('je-bad', 5, 'jrn-vte', [{ account: 'acc-7111', debit: 1 }, { account: 'acc-3421', credit: 1 }], { source_document_type: 'REVERSAL', reversal_of_entry_id: 'je-draft' });
    const header = bad[0];
    if (header === undefined) {
      throw new Error('en-tête absent');
    }
    const { sql, params } = insertSqlite(header[0], header[1]);
    await failBoth(sql, MSG_REVERSAL_TARGET, params);
  });

  it('exercice : un exercice en cours de clôture ne change rien au refus de statut', async () => {
    await seedBoth([['fiscal_years', fiscalYearRow({ id: 'fy-2027', code: 'EX-2027', start_date: '2027-01-01', end_date: '2027-12-31' })]]);
    await failBoth(POST_ENTRY_SQL, MSG_STATUS, postParams('je-draft'));
  });
});
