import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TENANT_INDEX_NAMES,
  TENANT_MIGRATIONS,
  TENANT_POSTGRES_TRIGGER_NAMES,
  TENANT_TABLE_NAMES,
  TENANT_TRIGGER_NAMES,
  tenantMigrationPostgresStatements,
} from '../src/tenant.ts';
import { DualEngines, RAISED, type Engine, type Failure } from './dual-engine.ts';
import { all } from './support.ts';
import {
  archivalRow,
  insertSqlite,
  invoiceRow,
  LEDGER_SEED,
  openTenant,
  partnerRow,
  payrollRow,
  POST_ENTRY_SQL,
  posSessionRow,
  posTicketRow,
  posZClosureRow,
  postParams,
  sealedArchivalRow,
  simpleEntry,
  SHA_B,
  SHA_C,
  type RowValues,
} from './tenant-support.ts';

/**
 * Migration tenant v6 (corrections du pilote rattachées à T-S1B-05 et T-S1B-03), prouvée sur SQLite (node:sqlite) ET sur
 * PostgreSQL 16, exécutés réellement, avec le MÊME texte d'erreur (RAISE(ABORT) contre RAISE EXCEPTION, ERRATA D-11).
 * 1. pii_restricted_flag monotone (0 vers 1 seulement) sur TOUTES les tables porteuses (Doc_11 § 06), POSTED, scellé ou non :
 *    la v6 pose un trigger de non-régression sur chacune des 5 (le pilote a remplacé l'ancienne liberté hors POSTED/scellé).
 * 2. POS option (b) : un UPDATE de ticket ou de clôture Z ne change QUE les colonnes de liaison, chacune de NULL vers une valeur ;
 *    chaque autre colonne est vérifiée une à une (boucle sur PRAGMA table_info). Les migrations v1 à v5 sont immuables.
 */
const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_t6_${randomBytes(6).toString('hex')}`;

const FROZEN_SHA256 = [
  'a554a3477c4d1e3561b81e72e243fc72e2be519d155a3120a497ef0d93a04f61',
  'bfb09b92f078d2796cc62c0604bbc50d9bf3b5f7dffc3539704b564dca15b581',
  '71c6a880b7c231ff3d005d2d1edcee5ca7956e5c9dcf9e2af44a18c8ef7a1138',
  'f1cc97cfc9eff05135df66a7ae30b6eda31535c76a9eaad0d786e58ec1c1d85f',
  'b6c338fcb3808b9cc210fd73981a3f628e8d7148910de8a2d0c12a77ec1de295',
] as const;
/** Empreinte figée de la v6 : toute modification de son DDL est une nouvelle migration, pas une retouche. */
const V6_SHA256 = '6750637f3351826b8cf4ecf816f46b232b41aad00bb7026c82c99ae86cd5b25f';

const MSG_PII_DOWNGRADE = 'VIOLATION_CNDP_LOI_09_08_ART_211: Restriction fiscale irréversible : pii_restricted_flag ne peut pas redescendre de 1 à 0.';
const MSG_ENTRY_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Écriture validée immuable. Utilisez une contre-passation.';
const MSG_LINE_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Modification de ligne interdite sur pièce POSTED.';
const MSG_WORM_UPDATE = 'VIOLATION_SAE_ISO_14641: Altération interdite sur une unité d archive scellée.';
const MSG_TICKET_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Modification de ticket POS signé interdite. Seule la conversion B2B est admise.';
const MSG_Z_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Modification de clôture Z scellée interdite. Seule la pose des références GL et AIP est admise.';

const V6_TRIGGERS = [
  'prevent_pii_flag_downgrade_invoices',
  'prevent_pii_flag_downgrade_payroll',
  'prevent_pii_flag_downgrade_journal_entries',
  'prevent_pii_flag_downgrade_journal_entry_lines',
  'prevent_pii_flag_downgrade_archival_packages',
] as const;

/** Table gardée par chacun des triggers de la v6. */
const V6_TRIGGER_TABLE: Readonly<Record<(typeof V6_TRIGGERS)[number], string>> = {
  prevent_pii_flag_downgrade_invoices: 'invoices',
  prevent_pii_flag_downgrade_payroll: 'payroll_annual_subledger',
  prevent_pii_flag_downgrade_journal_entries: 'journal_entries',
  prevent_pii_flag_downgrade_journal_entry_lines: 'journal_entry_lines',
  prevent_pii_flag_downgrade_archival_packages: 'archival_packages',
};

/** Tables porteuses de pii_restricted_flag : TOUTES portent un trigger de non-régression dans la v6. */
const FLAG_TABLES = ['invoices', 'journal_entries', 'journal_entry_lines', 'payroll_annual_subledger', 'archival_packages'] as const;

const OTHER_HEX = 'fedcba9876543210'.repeat(4);
const HASH_COLUMNS: readonly string[] = ['prev_ticket_sha256', 'ticket_sha256', 'prev_z_sha256', 'z_sha256'];
const TICKET_LINKS: readonly string[] = ['b2b_conversion_state', 'converted_invoice_id'];
const Z_LINKS: readonly string[] = ['gl_journal_entry_id', 'aip_archive_id'];

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

const RESET_ALL = `TRUNCATE archival_packages, payroll_annual_subledger, journal_entry_lines, journal_entries, bank_transactions,
  fixed_assets_register, journals, cgnc_accounts, fiscal_years, pos_z_closures, pos_tickets, pos_sessions, invoice_lines,
  invoice_delivery_links, invoices, delivery_notes, purchase_orders, fiscal_partners, tenant_key_grants CASCADE`;

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

async function flagOf(table: string, key: string, id: string): Promise<readonly [number | null, number | null]> {
  const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT pii_restricted_flag FROM ${table} WHERE ${key} = '${id}'`));
  const first = lite[0]?.['pii_restricted_flag'];
  const second = pg[0]?.['pii_restricted_flag'];
  return [typeof first === 'number' ? first : null, typeof second === 'number' ? second : null];
}

async function valueOf(sql: string): Promise<readonly [string | number | null | undefined, string | number | null | undefined]> {
  const [lite, pg] = await dual.onBoth((e) => e.rows(sql));
  return [Object.values(lite[0] ?? {})[0], Object.values(pg[0] ?? {})[0]];
}

function names(db: DatabaseSync, type: 'table' | 'trigger' | 'index'): string[] {
  return all(db, `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`, type).map((row) => String(row['name']));
}

describe('migration v6 : forme, immuabilité de v1 à v5, objets créés', () => {
  const v6 = TENANT_MIGRATIONS[5];

  it('est la sixième migration ; les empreintes de v1 à v5 sont inchangées (recalculées)', () => {
    expect(TENANT_MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(v6?.name).toBe('tenant_part6_pii_flag_monotone_all_tables');
    for (const [index, expected] of FROZEN_SHA256.entries()) {
      const migration = TENANT_MIGRATIONS[index];
      expect(migration?.expectedSha256Hex).toBe(expected);
      expect(createHash('sha256').update(migration?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex'), `v${index + 1}`).toBe(expected);
    }
  });

  it('l\'empreinte de la v6 est celle de upSqlStatements.join("\\n")', () => {
    expect(v6?.expectedSha256Hex).toBe(V6_SHA256);
    expect(createHash('sha256').update(v6?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex')).toBe(v6?.expectedSha256Hex);
  });

  it('crée exactement les 5 triggers du registre, aucune table, aucun index, aucune vue', () => {
    expect(v6?.triggerNames).toEqual([...V6_TRIGGERS]);
    expect(v6?.tableNames).toEqual([]);
    expect(v6?.indexNames).toEqual([]);
    expect(v6?.viewNames ?? []).toEqual([]);
    expect(v6?.sqliteOnlyTriggerNames ?? []).toEqual([]);
    expect(TENANT_TRIGGER_NAMES.slice(-5)).toEqual([...V6_TRIGGERS]);
    expect(TENANT_POSTGRES_TRIGGER_NAMES.slice(-5)).toEqual([...V6_TRIGGERS]);
    expect(TENANT_TABLE_NAMES).toHaveLength(26);
    expect(TENANT_INDEX_NAMES).toHaveLength(8);
  });

  it('une base v5 pleine se met à niveau sans perte en appliquant seulement la v6', () => {
    const db = openTenant(5);
    expect(names(db, 'trigger').filter((name) => name.startsWith('prevent_pii_flag'))).toEqual([]);
    const partner = insertSqlite('fiscal_partners', partnerRow());
    db.prepare(partner.sql).run(...partner.params);
    const invoice = insertSqlite('invoices', invoiceRow({ pii_restricted_flag: 1 }));
    db.prepare(invoice.sql).run(...invoice.params);
    for (const statement of v6?.upSqlStatements ?? []) {
      db.exec(statement);
    }
    expect(names(db, 'trigger').filter((name) => name.startsWith('prevent_pii_flag'))).toEqual([...V6_TRIGGERS].sort());
    expect(all(db, 'SELECT COUNT(*) AS n FROM invoices WHERE pii_restricted_flag = 1')).toEqual([{ n: 1 }]);
  });

  it('la traduction PostgreSQL garde une instruction par instruction SQLite, sans INTEGER ni CAST', () => {
    if (v6 === undefined) {
      throw new Error('migration v6 absente');
    }
    const statements = tenantMigrationPostgresStatements(v6);
    expect(statements).toHaveLength(v6.upSqlStatements.length);
    expect(statements.join('\n')).not.toMatch(/\bINTEGER\b/);
    expect(statements.join('\n')).not.toMatch(/CAST\(/);
    expect(statements.join('\n')).toContain('RAISE EXCEPTION');
  });

  it('PostgreSQL porte exactement les triggers PG du registre', async () => {
    const triggers = await client.query(
      `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND NOT t.tgisinternal ORDER BY t.tgname`,
      [SCHEMA],
    );
    expect(triggers.rows.map((row: { tgname: string }) => row.tgname)).toEqual([...TENANT_POSTGRES_TRIGGER_NAMES].sort());
    expect(names(openTenant(), 'trigger')).toEqual([...TENANT_TRIGGER_NAMES].sort());
  });
});

describe('1. inventaire : toute table porteuse de pii_restricted_flag porte un trigger monotone (SQLite et PostgreSQL)', () => {
  it('SQLite : les tables porteuses sont exactement la liste attendue ; chacune a un trigger BEFORE UPDATE qui cite la colonne', () => {
    const db = openTenant();
    const carriers = names(db, 'table').filter((table) => all(db, `SELECT name FROM pragma_table_info(?)`, table).some((column) => column['name'] === 'pii_restricted_flag'));
    expect(carriers).toEqual([...FLAG_TABLES].sort());
    for (const table of carriers) {
      const guards = all(db, `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`, table).filter(
        (row) => /BEFORE UPDATE/.test(String(row['sql'])) && /pii_restricted_flag/.test(String(row['sql'])),
      );
      expect(guards.length, `${table} sans trigger monotone`).toBeGreaterThan(0);
    }
    for (const name of V6_TRIGGERS) {
      const rows = all(db, `SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name = ?`, name);
      expect(rows, name).toEqual([{ tbl_name: V6_TRIGGER_TABLE[name] }]);
    }
    expect(Object.values(V6_TRIGGER_TABLE).sort()).toEqual([...FLAG_TABLES].sort());
  });

  it('PostgreSQL : mêmes tables porteuses, chacune avec un trigger BEFORE UPDATE dont la fonction cite la colonne', async () => {
    const carriers = await client.query(
      `SELECT table_name FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'pii_restricted_flag' ORDER BY table_name`,
      [SCHEMA],
    );
    const found = carriers.rows.map((row: { table_name: string }) => row.table_name);
    expect(found).toEqual([...FLAG_TABLES].sort());
    for (const table of found) {
      const guards = await client.query(
        `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE n.nspname = $1 AND c.relname = $2 AND NOT t.tgisinternal AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16
           AND p.prosrc LIKE '%pii_restricted_flag%'`,
        [SCHEMA, table],
      );
      expect(guards.rowCount, `${table} sans trigger monotone`).toBeGreaterThan(0);
    }
    for (const name of V6_TRIGGERS) {
      const own = await client.query(
        `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND t.tgname = $2 AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16`,
        [SCHEMA, name],
      );
      expect(own.rows.map((row: { relname: string }) => row.relname), name).toEqual([V6_TRIGGER_TABLE[name]]);
    }
  });
});

describe('2. invoices : pii_restricted_flag monotone, ligne par ailleurs libre (prevent_pii_flag_downgrade_invoices)', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth([['fiscal_partners', partnerRow()], ['invoices', invoiceRow()], ['invoices', invoiceRow({ id: 'inv-f', pii_restricted_flag: 1 })]]);
  });

  it('0 vers 1 accepté', async () => {
    await runBoth(`UPDATE invoices SET pii_restricted_flag = 1 WHERE id = 'inv-1'`);
    expect(await flagOf('invoices', 'id', 'inv-1')).toEqual([1, 1]);
  });

  it('0 vers 1 combiné à une autre modification accepté', async () => {
    await runBoth(`UPDATE invoices SET pii_restricted_flag = 1, dispute_r2_proof_key = 'r2/proof' WHERE id = 'inv-1'`);
    expect(await flagOf('invoices', 'id', 'inv-1')).toEqual([1, 1]);
    expect(await valueOf(`SELECT dispute_r2_proof_key FROM invoices WHERE id = 'inv-1'`)).toEqual(['r2/proof', 'r2/proof']);
  });

  it('1 vers 0 refusé, même texte, seul ou combiné à une autre modification ; le drapeau reste levé', async () => {
    await failBoth(`UPDATE invoices SET pii_restricted_flag = 0 WHERE id = 'inv-f'`, MSG_PII_DOWNGRADE);
    await failBoth(`UPDATE invoices SET pii_restricted_flag = 0, dispute_r2_proof_key = 'r2/x' WHERE id = 'inv-f'`, MSG_PII_DOWNGRADE);
    expect(await flagOf('invoices', 'id', 'inv-f')).toEqual([1, 1]);
    expect(await valueOf(`SELECT dispute_r2_proof_key FROM invoices WHERE id = 'inv-f'`)).toEqual([null, null]);
  });

  it('1 vers 1 accepté : ligne modifiée, drapeau inchangé (explicite ou non)', async () => {
    await runBoth(`UPDATE invoices SET dispute_r2_proof_key = 'r2/ok' WHERE id = 'inv-f'`);
    await runBoth(`UPDATE invoices SET pii_restricted_flag = 1, xhub_qr_payload = 'qr' WHERE id = 'inv-f'`);
    expect(await flagOf('invoices', 'id', 'inv-f')).toEqual([1, 1]);
    expect(await valueOf(`SELECT xhub_qr_payload FROM invoices WHERE id = 'inv-f'`)).toEqual(['qr', 'qr']);
  });

  it('ligne à drapeau 0 : modifiée librement, drapeau 0 réécrit accepté', async () => {
    await runBoth(`UPDATE invoices SET dispute_r2_proof_key = 'r2/free', paid_cents = 5 WHERE id = 'inv-1'`);
    await runBoth(`UPDATE invoices SET pii_restricted_flag = 0, xhub_qr_payload = 'qr' WHERE id = 'inv-1'`);
    expect(await flagOf('invoices', 'id', 'inv-1')).toEqual([0, 0]);
    expect(await valueOf(`SELECT paid_cents FROM invoices WHERE id = 'inv-1'`)).toEqual([5, 5]);
  });

  it('un drapeau hors 0/1 reste refusé par le CHECK existant, pas par ce trigger', async () => {
    const [lite, pg] = await dual.onBoth((e) => e.fail(`UPDATE invoices SET pii_restricted_flag = ? WHERE id = 'inv-1'`, [2]));
    expect(lite.message).not.toBe(MSG_PII_DOWNGRADE);
    expect(pg.message).not.toBe(MSG_PII_DOWNGRADE);
  });
});

describe('3. payroll_annual_subledger : pii_restricted_flag monotone, paie par ailleurs librement modifiable (prevent_pii_flag_downgrade_payroll)', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth([
      ['payroll_annual_subledger', payrollRow()],
      ['payroll_annual_subledger', payrollRow({ id: 'pay-f', matricule: 'M-0002', pii_restricted_flag: 1 })],
    ]);
  });

  it('0 vers 1 accepté, y compris combiné à une autre modification', async () => {
    await runBoth(`UPDATE payroll_annual_subledger SET pii_restricted_flag = 1 WHERE id = 'pay-1'`);
    expect(await flagOf('payroll_annual_subledger', 'id', 'pay-1')).toEqual([1, 1]);
    await seedBoth([['payroll_annual_subledger', payrollRow({ id: 'pay-2', matricule: 'M-0003' })]]);
    await runBoth(`UPDATE payroll_annual_subledger SET pii_restricted_flag = 1, ir_withheld_cents = 91000, family_status = 'C' WHERE id = 'pay-2'`);
    expect(await flagOf('payroll_annual_subledger', 'id', 'pay-2')).toEqual([1, 1]);
    expect(await valueOf(`SELECT ir_withheld_cents FROM payroll_annual_subledger WHERE id = 'pay-2'`)).toEqual([91000, 91000]);
  });

  it('1 vers 0 refusé, même texte, seul ou combiné à une autre modification ; la ligne reste inchangée', async () => {
    await failBoth(`UPDATE payroll_annual_subledger SET pii_restricted_flag = 0 WHERE id = 'pay-f'`, MSG_PII_DOWNGRADE);
    await failBoth(`UPDATE payroll_annual_subledger SET pii_restricted_flag = 0, ir_withheld_cents = 1 WHERE id = 'pay-f'`, MSG_PII_DOWNGRADE);
    expect(await flagOf('payroll_annual_subledger', 'id', 'pay-f')).toEqual([1, 1]);
    expect(await valueOf(`SELECT ir_withheld_cents FROM payroll_annual_subledger WHERE id = 'pay-f'`)).toEqual([90000, 90000]);
  });

  it('1 vers 1 accepté : ligne modifiée, drapeau inchangé', async () => {
    await runBoth(`UPDATE payroll_annual_subledger SET ir_withheld_cents = 95000, worked_days = 300 WHERE id = 'pay-f'`);
    await runBoth(`UPDATE payroll_annual_subledger SET pii_restricted_flag = 1, net_taxable_cents = 700000 WHERE id = 'pay-f'`);
    expect(await flagOf('payroll_annual_subledger', 'id', 'pay-f')).toEqual([1, 1]);
    expect(await valueOf(`SELECT net_taxable_cents FROM payroll_annual_subledger WHERE id = 'pay-f'`)).toEqual([700000, 700000]);
  });

  it('ligne à drapeau 0 : modifiée librement (aucune règle d\'immuabilité sur la paie)', async () => {
    await runBoth(`UPDATE payroll_annual_subledger SET ir_withheld_cents = 12345, gross_salary_cents = 1300000, family_status = 'D' WHERE id = 'pay-1'`);
    await runBoth(`UPDATE payroll_annual_subledger SET pii_restricted_flag = 0, worked_days = 200 WHERE id = 'pay-1'`);
    expect(await flagOf('payroll_annual_subledger', 'id', 'pay-1')).toEqual([0, 0]);
    expect(await valueOf(`SELECT ir_withheld_cents FROM payroll_annual_subledger WHERE id = 'pay-1'`)).toEqual([12345, 12345]);
  });
});

async function failEither(sql: string, messages: readonly string[]): Promise<readonly [string, string]> {
  const [lite, pg] = await dual.onBoth((e) => e.fail(sql, []));
  expect(messages).toContain(lite.message);
  expect(messages).toContain(pg.message);
  expect(lite.code).toBeNull();
  expect(pg.code).toBe(RAISED);
  return [lite.message, pg.message];
}

describe('4. journal_entries, journal_entry_lines, archival_packages : pii_restricted_flag monotone partout (v6), reste libre hors POSTED / scellé', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth(simpleEntry('je-1', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 120000));
    for (const engine of dual.engines()) {
      await engine.run(POST_ENTRY_SQL, postParams('je-1'));
    }
    await seedBoth(simpleEntry('je-d', 2, 'jrn-vte', 'acc-3421', 'acc-7111', 700));
    await seedBoth([['archival_packages', sealedArchivalRow({ pii_restricted_flag: 1 })], ['archival_packages', archivalRow({ aip_id: 'aip-2', r2_object_key: 'r2/2' })]]);
  });

  it('journal_entries (pièce POSTED) : drapeau levé puis 1 vers 0 refusé (cumul avec la règle POSTED : l\'un ou l\'autre des deux textes déterministes)', async () => {
    await runBoth(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-1'`);
    await failEither(`UPDATE journal_entries SET pii_restricted_flag = 0 WHERE id = 'je-1'`, [MSG_PII_DOWNGRADE, MSG_ENTRY_UPDATE]);
    expect(await flagOf('journal_entries', 'id', 'je-1')).toEqual([1, 1]);
  });

  it('journal_entry_lines (ligne d\'une pièce POSTED) : drapeau levé puis 1 vers 0 refusé (l\'un ou l\'autre des deux textes)', async () => {
    await runBoth(`UPDATE journal_entry_lines SET pii_restricted_flag = 1 WHERE id = 'je-1-l1'`);
    await failEither(`UPDATE journal_entry_lines SET pii_restricted_flag = 0 WHERE id = 'je-1-l1'`, [MSG_PII_DOWNGRADE, MSG_LINE_UPDATE]);
    expect(await flagOf('journal_entry_lines', 'id', 'je-1-l1')).toEqual([1, 1]);
  });

  it('archival_packages (paquet scellé) : 1 vers 0 refusé (l\'un ou l\'autre des deux textes) ; 0 vers 1 seul reste admis (v5), combiné à une autre colonne refusé', async () => {
    await failEither(`UPDATE archival_packages SET pii_restricted_flag = 0 WHERE aip_id = 'aip-1'`, [MSG_PII_DOWNGRADE, MSG_WORM_UPDATE]);
    expect(await flagOf('archival_packages', 'aip_id', 'aip-1')).toEqual([1, 1]);
    await seedBoth([['archival_packages', sealedArchivalRow({ aip_id: 'aip-3', r2_object_key: 'r2/3', pii_restricted_flag: 0 })]]);
    await runBoth(`UPDATE archival_packages SET pii_restricted_flag = 1 WHERE aip_id = 'aip-3'`);
    expect(await flagOf('archival_packages', 'aip_id', 'aip-3')).toEqual([1, 1]);
    await seedBoth([['archival_packages', sealedArchivalRow({ aip_id: 'aip-4', r2_object_key: 'r2/4', pii_restricted_flag: 0 })]]);
    await failBoth(`UPDATE archival_packages SET pii_restricted_flag = 1, document_ref = 'DOC-Q' WHERE aip_id = 'aip-4'`, MSG_WORM_UPDATE);
  });

  it('journal_entries non POSTED : 1 vers 0 refusé (texte commun, seul ou combiné) ; 0 vers 1, 1 vers 1 et autre colonne acceptés', async () => {
    await runBoth(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-d'`);
    await failBoth(`UPDATE journal_entries SET pii_restricted_flag = 0 WHERE id = 'je-d'`, MSG_PII_DOWNGRADE);
    await failBoth(`UPDATE journal_entries SET pii_restricted_flag = 0, entry_date = '2026-11-22' WHERE id = 'je-d'`, MSG_PII_DOWNGRADE);
    await runBoth(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-d'`);
    await runBoth(`UPDATE journal_entries SET entry_date = '2026-11-20' WHERE id = 'je-d'`);
    expect(await flagOf('journal_entries', 'id', 'je-d')).toEqual([1, 1]);
    expect(await valueOf(`SELECT entry_date FROM journal_entries WHERE id = 'je-d'`)).toEqual(['2026-11-20', '2026-11-20']);
  });

  it('journal_entries non POSTED à drapeau 0 : 0 vers 1 accepté, combiné à une autre colonne ; drapeau 0 réécrit accepté', async () => {
    await runBoth(`UPDATE journal_entries SET pii_restricted_flag = 0, entry_date = '2026-11-19' WHERE id = 'je-d'`);
    await runBoth(`UPDATE journal_entries SET pii_restricted_flag = 1, entry_date = '2026-11-18' WHERE id = 'je-d'`);
    expect(await flagOf('journal_entries', 'id', 'je-d')).toEqual([1, 1]);
    expect(await valueOf(`SELECT entry_date FROM journal_entries WHERE id = 'je-d'`)).toEqual(['2026-11-18', '2026-11-18']);
  });

  it('journal_entry_lines d\'une pièce non POSTED : 1 vers 0 refusé ; 0 vers 1, 1 vers 1 et autre colonne acceptés', async () => {
    await runBoth(`UPDATE journal_entry_lines SET pii_restricted_flag = 1 WHERE id = 'je-d-l1'`);
    await failBoth(`UPDATE journal_entry_lines SET pii_restricted_flag = 0 WHERE id = 'je-d-l1'`, MSG_PII_DOWNGRADE);
    await failBoth(`UPDATE journal_entry_lines SET pii_restricted_flag = 0, line_number = 7 WHERE id = 'je-d-l1'`, MSG_PII_DOWNGRADE);
    await runBoth(`UPDATE journal_entry_lines SET pii_restricted_flag = 1, reconciliation_code = 'LET2' WHERE id = 'je-d-l1'`);
    await runBoth(`UPDATE journal_entry_lines SET reconciliation_code = 'LET3' WHERE id = 'je-d-l1'`);
    expect(await flagOf('journal_entry_lines', 'id', 'je-d-l1')).toEqual([1, 1]);
    expect(await valueOf(`SELECT reconciliation_code FROM journal_entry_lines WHERE id = 'je-d-l1'`)).toEqual(['LET3', 'LET3']);
    await runBoth(`UPDATE journal_entry_lines SET pii_restricted_flag = 1 WHERE id = 'je-d-l2'`);
    expect(await flagOf('journal_entry_lines', 'id', 'je-d-l2')).toEqual([1, 1]);
  });

  it('archival_packages non scellé : 1 vers 0 refusé ; 0 vers 1, 1 vers 1 et autre colonne acceptés ; le scellement par merkle_batch_id reste possible', async () => {
    await runBoth(`UPDATE archival_packages SET pii_restricted_flag = 1 WHERE aip_id = 'aip-2'`);
    await failBoth(`UPDATE archival_packages SET pii_restricted_flag = 0 WHERE aip_id = 'aip-2'`, MSG_PII_DOWNGRADE);
    await failBoth(`UPDATE archival_packages SET pii_restricted_flag = 0, document_ref = 'DOC-X' WHERE aip_id = 'aip-2'`, MSG_PII_DOWNGRADE);
    await runBoth(`UPDATE archival_packages SET pii_restricted_flag = 1, document_ref = 'DOC-Y' WHERE aip_id = 'aip-2'`);
    await runBoth(`UPDATE archival_packages SET document_ref = 'DOC-Z' WHERE aip_id = 'aip-2'`);
    expect(await valueOf(`SELECT document_ref FROM archival_packages WHERE aip_id = 'aip-2'`)).toEqual(['DOC-Z', 'DOC-Z']);
    await runBoth(`UPDATE archival_packages SET merkle_batch_id = 'batch-2', merkle_leaf_index = 1, merkle_proof_json = '[]' WHERE aip_id = 'aip-2'`);
    expect(await valueOf(`SELECT merkle_batch_id FROM archival_packages WHERE aip_id = 'aip-2'`)).toEqual(['batch-2', 'batch-2']);
    expect(await flagOf('archival_packages', 'aip_id', 'aip-2')).toEqual([1, 1]);
    await failBoth(`UPDATE archival_packages SET document_ref = 'DOC-W' WHERE aip_id = 'aip-2'`, MSG_WORM_UPDATE);
  });

  it('flux légitime : pièce construite lignes d\'abord avec drapeau levé puis POSTED ; archive à drapeau 0 puis scellée', async () => {
    await seedBoth(simpleEntry('je-3', 3, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    await runBoth(`UPDATE journal_entry_lines SET pii_restricted_flag = 1 WHERE entry_id = 'je-3'`);
    await runBoth(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-3'`);
    for (const engine of dual.engines()) {
      await engine.run(POST_ENTRY_SQL, postParams('je-3'));
    }
    expect(await valueOf(`SELECT status FROM journal_entries WHERE id = 'je-3'`)).toEqual(['POSTED', 'POSTED']);
    expect(await flagOf('journal_entries', 'id', 'je-3')).toEqual([1, 1]);
    expect(await flagOf('journal_entry_lines', 'id', 'je-3-l1')).toEqual([1, 1]);
    await runBoth(`UPDATE archival_packages SET merkle_batch_id = 'batch-5', merkle_leaf_index = 2, merkle_proof_json = '[]' WHERE aip_id = 'aip-2'`);
    expect(await flagOf('archival_packages', 'aip_id', 'aip-2')).toEqual([0, 0]);
  });
});

describe('5. POS option (b) : ticket, un cas par colonne figée (boucle sur PRAGMA table_info, SQLite et PostgreSQL)', () => {
  const AVANT_Z = 'CONVERTI_B2B_AVANT_Z';
  const POST_Z = 'CONVERTI_B2B_POST_Z_NEUTRALISE';

  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth([
      ['fiscal_partners', partnerRow()],
      ['invoices', invoiceRow({ id: 'inv-1' })],
      ['invoices', invoiceRow({ id: 'inv-2' })],
      ['pos_sessions', posSessionRow()],
      ['pos_sessions', posSessionRow({ id: 'sess-2' })],
      ['pos_tickets', posTicketRow()],
    ]);
  });

  function columnsOf(table: string): readonly { readonly name: string; readonly type: string }[] {
    return all(openTenant(), 'SELECT name, type FROM pragma_table_info(?) ORDER BY cid', table).map((row) => ({ name: String(row['name']), type: String(row['type']) }));
  }

  /** Une valeur différente de celle de la ligne semée, du bon type ; empreintes valides pour passer le contrôle de format. */
  function changedValue(column: { readonly name: string; readonly type: string }): string | number {
    if (HASH_COLUMNS.includes(column.name)) {
      return OTHER_HEX;
    }
    return column.type === 'INTEGER' ? 987654 : `changed-${column.name}`;
  }

  async function ticketRowText(): Promise<readonly [string, string]> {
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT * FROM pos_tickets WHERE id = 'tkt-1'`));
    return [JSON.stringify(lite), JSON.stringify(pg)];
  }

  it('la liste des colonnes de pos_tickets est la même sur PostgreSQL ; 21 colonnes figées plus les 2 colonnes de liaison', async () => {
    const lite = columnsOf('pos_tickets').map((column) => column.name);
    const pg = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'pos_tickets' ORDER BY ordinal_position`, [SCHEMA]);
    expect(pg.rows.map((row: { column_name: string }) => row.column_name)).toEqual(lite);
    expect(lite.filter((name) => !TICKET_LINKS.includes(name))).toHaveLength(21);
    expect(lite).toHaveLength(23);
  });

  it('chaque colonne figée, modifiée SEULE, est refusée (même texte) ; la ligne reste strictement identique', async () => {
    const before = await ticketRowText();
    for (const column of columnsOf('pos_tickets').filter((c) => !TICKET_LINKS.includes(c.name))) {
      await failBoth(`UPDATE pos_tickets SET ${column.name} = ? WHERE id = 'tkt-1'`, MSG_TICKET_UPDATE, [changedValue(column)]);
    }
    expect(await ticketRowText()).toEqual(before);
  });

  it('chaque colonne figée, modifiée en même temps qu\'une conversion valide, est refusée (même texte) ; aucune conversion n\'est écrite', async () => {
    const before = await ticketRowText();
    for (const column of columnsOf('pos_tickets').filter((c) => !TICKET_LINKS.includes(c.name))) {
      await failBoth(
        `UPDATE pos_tickets SET b2b_conversion_state = ?, converted_invoice_id = ?, ${column.name} = ? WHERE id = 'tkt-1'`,
        MSG_TICKET_UPDATE,
        [AVANT_Z, 'inv-1', changedValue(column)],
      );
    }
    expect(await ticketRowText()).toEqual(before);
  });

  it('colonne figée mise à NULL refusée avant tout contrôle de NOT NULL, même texte ; origine NULL vers valeur et valeur vers NULL refusées', async () => {
    const before = await ticketRowText();
    for (const column of columnsOf('pos_tickets').filter((c) => !TICKET_LINKS.includes(c.name) && c.name !== 'id')) {
      await failBoth(`UPDATE pos_tickets SET ${column.name} = NULL WHERE id = 'tkt-1'`, MSG_TICKET_UPDATE);
    }
    expect(await ticketRowText()).toEqual(before);
    await seedBoth([['pos_tickets', posTicketRow({ id: 'tkt-r', terminal_seq_number: 'S-R', qr_conversion_token: 'qr-r', ticket_kind: 'RETURN_REFUND', origin_ticket_id: 'tkt-1' })]]);
    await failBoth(`UPDATE pos_tickets SET origin_ticket_id = NULL WHERE id = 'tkt-r'`, MSG_TICKET_UPDATE);
    await failBoth(`UPDATE pos_tickets SET origin_ticket_id = 'tkt-r' WHERE id = 'tkt-r'`, MSG_TICKET_UPDATE);
  });

  it('colonnes de liaison : NULL vers valeur accepté ensemble ; ensuite chacune, seule ou avec l\'autre, ni modifiée ni remise à NULL ni réécrite à l\'identique', async () => {
    await runBoth(`UPDATE pos_tickets SET b2b_conversion_state = ?, converted_invoice_id = ? WHERE id = 'tkt-1'`, [POST_Z, 'inv-1']);
    const converted = await ticketRowText();
    const attempts: readonly (readonly [string, readonly (string | number | null)[]])[] = [
      [`converted_invoice_id = ?`, ['inv-2']],
      [`converted_invoice_id = NULL`, []],
      [`converted_invoice_id = ?`, ['inv-1']],
      [`b2b_conversion_state = ?`, [AVANT_Z]],
      [`b2b_conversion_state = ?`, ['NONE']],
      [`b2b_conversion_state = ?`, [POST_Z]],
      [`b2b_conversion_state = ?, converted_invoice_id = ?`, [AVANT_Z, 'inv-2']],
      [`b2b_conversion_state = ?, converted_invoice_id = ?`, [POST_Z, 'inv-1']],
      [`b2b_conversion_state = 'NONE', converted_invoice_id = NULL`, []],
    ];
    for (const [assignment, params] of attempts) {
      await failBoth(`UPDATE pos_tickets SET ${assignment} WHERE id = 'tkt-1'`, MSG_TICKET_UPDATE, params);
    }
    expect(await ticketRowText()).toEqual(converted);
  });

  it('colonnes de liaison : une seule des deux posée (état seul, facture seule) refusée', async () => {
    await failBoth(`UPDATE pos_tickets SET b2b_conversion_state = ? WHERE id = 'tkt-1'`, MSG_TICKET_UPDATE, [AVANT_Z]);
    await failBoth(`UPDATE pos_tickets SET converted_invoice_id = ? WHERE id = 'tkt-1'`, MSG_TICKET_UPDATE, ['inv-1']);
  });
});

describe('6. POS option (b) : clôture Z, un cas par colonne figée et pose GL/AIP monotone (boucle sur PRAGMA table_info)', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth([
      ['pos_sessions', posSessionRow()],
      ['pos_sessions', posSessionRow({ id: 'sess-2' })],
      ['pos_z_closures', posZClosureRow()],
    ]);
  });

  function columnsOf(table: string): readonly { readonly name: string; readonly type: string }[] {
    return all(openTenant(), 'SELECT name, type FROM pragma_table_info(?) ORDER BY cid', table).map((row) => ({ name: String(row['name']), type: String(row['type']) }));
  }

  function changedValue(column: { readonly name: string; readonly type: string }): string | number {
    if (HASH_COLUMNS.includes(column.name)) {
      return OTHER_HEX;
    }
    return column.type === 'INTEGER' ? 987654 : `changed-${column.name}`;
  }

  async function zRowText(): Promise<readonly [string, string]> {
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT * FROM pos_z_closures WHERE id = 'z-1'`));
    return [JSON.stringify(lite), JSON.stringify(pg)];
  }

  it('la liste des colonnes de pos_z_closures est la même sur PostgreSQL ; 14 colonnes figées plus les 2 références', async () => {
    const lite = columnsOf('pos_z_closures').map((column) => column.name);
    const pg = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'pos_z_closures' ORDER BY ordinal_position`, [SCHEMA]);
    expect(pg.rows.map((row: { column_name: string }) => row.column_name)).toEqual(lite);
    expect(lite.filter((name) => !Z_LINKS.includes(name))).toHaveLength(14);
    expect(lite).toHaveLength(16);
  });

  it('chaque colonne figée, modifiée SEULE, est refusée (même texte) ; la clôture reste strictement identique', async () => {
    const before = await zRowText();
    for (const column of columnsOf('pos_z_closures').filter((c) => !Z_LINKS.includes(c.name))) {
      await failBoth(`UPDATE pos_z_closures SET ${column.name} = ? WHERE id = 'z-1'`, MSG_Z_UPDATE, [changedValue(column)]);
      await failBoth(`UPDATE pos_z_closures SET ${column.name} = NULL WHERE id = 'z-1'`, MSG_Z_UPDATE);
    }
    expect(await zRowText()).toEqual(before);
  });

  it('chaque colonne figée, combinée à une pose valide de gl_journal_entry_id ou aip_archive_id, est refusée (même texte)', async () => {
    const before = await zRowText();
    for (const column of columnsOf('pos_z_closures').filter((c) => !Z_LINKS.includes(c.name))) {
      await failBoth(`UPDATE pos_z_closures SET gl_journal_entry_id = ?, ${column.name} = ? WHERE id = 'z-1'`, MSG_Z_UPDATE, ['je-1', changedValue(column)]);
      await failBoth(`UPDATE pos_z_closures SET aip_archive_id = ?, ${column.name} = ? WHERE id = 'z-1'`, MSG_Z_UPDATE, ['aip-1', changedValue(column)]);
    }
    expect(await zRowText()).toEqual(before);
  });

  it('gl_journal_entry_id puis aip_archive_id, l\'un après l\'autre : acceptés ; le premier posé reste inchangé', async () => {
    await runBoth(`UPDATE pos_z_closures SET gl_journal_entry_id = ? WHERE id = 'z-1'`, ['je-1']);
    await runBoth(`UPDATE pos_z_closures SET aip_archive_id = ? WHERE id = 'z-1'`, ['aip-1']);
    expect(await valueOf(`SELECT gl_journal_entry_id FROM pos_z_closures WHERE id = 'z-1'`)).toEqual(['je-1', 'je-1']);
    expect(await valueOf(`SELECT aip_archive_id FROM pos_z_closures WHERE id = 'z-1'`)).toEqual(['aip-1', 'aip-1']);
  });

  it('ordre inverse (aip puis gl) accepté aussi ; posées ensemble acceptées', async () => {
    await runBoth(`UPDATE pos_z_closures SET aip_archive_id = ? WHERE id = 'z-1'`, ['aip-1']);
    await runBoth(`UPDATE pos_z_closures SET gl_journal_entry_id = ? WHERE id = 'z-1'`, ['je-1']);
    await seedBoth([['pos_z_closures', posZClosureRow({ id: 'z-2', session_id: 'sess-2', closure_number: 2 })]]);
    await runBoth(`UPDATE pos_z_closures SET gl_journal_entry_id = ?, aip_archive_id = ? WHERE id = 'z-2'`, ['je-2', 'aip-2']);
    expect(await valueOf(`SELECT gl_journal_entry_id FROM pos_z_closures WHERE id = 'z-2'`)).toEqual(['je-2', 'je-2']);
  });

  it('jamais deux fois : une référence déjà posée ne peut être ni changée, ni remise à NULL, ni réécrite à l\'identique', async () => {
    await runBoth(`UPDATE pos_z_closures SET gl_journal_entry_id = ? WHERE id = 'z-1'`, ['je-1']);
    await failBoth(`UPDATE pos_z_closures SET gl_journal_entry_id = ? WHERE id = 'z-1'`, MSG_Z_UPDATE, ['je-9']);
    await failBoth(`UPDATE pos_z_closures SET gl_journal_entry_id = ? WHERE id = 'z-1'`, MSG_Z_UPDATE, ['je-1']);
    await failBoth(`UPDATE pos_z_closures SET gl_journal_entry_id = NULL WHERE id = 'z-1'`, MSG_Z_UPDATE);
    await runBoth(`UPDATE pos_z_closures SET aip_archive_id = ? WHERE id = 'z-1'`, ['aip-1']);
    await failBoth(`UPDATE pos_z_closures SET aip_archive_id = ? WHERE id = 'z-1'`, MSG_Z_UPDATE, ['aip-9']);
    await failBoth(`UPDATE pos_z_closures SET aip_archive_id = ? WHERE id = 'z-1'`, MSG_Z_UPDATE, ['aip-1']);
    await failBoth(`UPDATE pos_z_closures SET aip_archive_id = NULL WHERE id = 'z-1'`, MSG_Z_UPDATE);
    await failBoth(`UPDATE pos_z_closures SET gl_journal_entry_id = ?, aip_archive_id = ? WHERE id = 'z-1'`, MSG_Z_UPDATE, ['je-2', 'aip-2']);
    await failBoth(`UPDATE pos_z_closures SET gl_journal_entry_id = NULL, aip_archive_id = NULL WHERE id = 'z-1'`, MSG_Z_UPDATE);
    expect(await valueOf(`SELECT gl_journal_entry_id FROM pos_z_closures WHERE id = 'z-1'`)).toEqual(['je-1', 'je-1']);
    expect(await valueOf(`SELECT aip_archive_id FROM pos_z_closures WHERE id = 'z-1'`)).toEqual(['aip-1', 'aip-1']);
    expect(await valueOf(`SELECT z_sha256 FROM pos_z_closures WHERE id = 'z-1'`)).toEqual([SHA_C, SHA_C]);
    expect(SHA_B).not.toBe(SHA_C);
  });
});
