import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TENANT_MIGRATIONS,
  TENANT_POSTGRES_TRIGGER_NAMES,
  TENANT_TABLE_NAMES,
  TENANT_TRIGGER_NAMES,
  tenantMigrationPostgresStatements,
} from '../src/tenant.ts';
import { CHECK_VIOLATION, DualEngines, RAISED, type Engine, type Failure } from './dual-engine.ts';
import { all, NOW } from './support.ts';
import {
  entryRow,
  entryWithLines,
  fiscalYearRow,
  insertSqlite,
  invoiceRow,
  LEDGER_SEED,
  openTenant,
  partnerRow,
  POST_ENTRY_SQL,
  posSessionRow,
  posTicketRow,
  posZClosureRow,
  postParams,
  SHA_B,
  SHA_C,
  simpleEntry,
  type RowValues,
} from './tenant-support.ts';

/**
 * Migration tenant v4 (corrections du pilote, tickets T-S1B-01 à 04) : chaque règle est prouvée EN ERREUR sur SQLite
 * (node:sqlite) ET sur PostgreSQL 16, exécutés réellement, avec le MÊME texte d'erreur (RAISE(ABORT) contre RAISE EXCEPTION,
 * ERRATA D-11). Les migrations v1, v2 et v3 sont immuables : leurs empreintes sont figées ici.
 */
const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_t4_${randomBytes(6).toString('hex')}`;

const V1_SHA256 = 'a554a3477c4d1e3561b81e72e243fc72e2be519d155a3120a497ef0d93a04f61';
const V2_SHA256 = 'bfb09b92f078d2796cc62c0604bbc50d9bf3b5f7dffc3539704b564dca15b581';
const V3_SHA256 = '71c6a880b7c231ff3d005d2d1edcee5ca7956e5c9dcf9e2af44a18c8ef7a1138';

const MSG_ENTRY_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Écriture validée immuable. Utilisez une contre-passation.';
const MSG_ENTRY_DELETE = 'VIOLATION_PAF_CGI_ART_145: Suppression interdite sur le Grand Livre.';
const MSG_LINE_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Modification de ligne interdite sur pièce POSTED.';
const MSG_LINE_DELETE = 'VIOLATION_PAF_CGI_ART_145: Suppression de ligne interdite sur pièce POSTED.';
const MSG_LINE_INSERT = 'VIOLATION_PAF_CGI_ART_145: Insertion de ligne interdite sur pièce POSTED.';
const MSG_FY_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Exercice clos immuable. Ouvrez un nouvel exercice.';
const MSG_FY_ENTRY_INSERT = 'CGNC_FISCAL_YEAR_CLOSED: Écriture refusée car cet exercice est clos.';
const MSG_TICKET_DELETE = 'VIOLATION_PAF_CGI_ART_145: Suppression de ticket POS interdite. Retour par avoir lié.';
const MSG_Z_DELETE = 'VIOLATION_PAF_CGI_ART_145: Suppression de clôture Z scellée interdite.';
const MSG_TICKET_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Modification de ticket POS signé interdite. Seule la conversion B2B est admise.';
const MSG_Z_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Modification de clôture Z scellée interdite. Seule la pose des références GL et AIP est admise.';
const MSG_HASH_FORMAT = 'POS_HASH_FORMAT: Empreinte SHA-256 attendue : 64 caractères hexadécimaux minuscules.';
const MSG_CLEARANCE = 'new row for relation "invoices" violates check constraint "invoices_clearance_state_check"';
const MSG_CDV = 'new row for relation "invoices" violates check constraint "invoices_cdv_lifecycle_status_check"';

/** Statuts de la FSM 01, Doc_02 § 02 (diagramme et tableau de transitions), mot pour mot. */
const CLEARANCE_STATES = [
  'BROUILLON',
  'NUMEROTEE_VERROUILLEE',
  'SIGNEE_LOI_43_20',
  'DEPOSEE_CERTIFIEE_DGI',
  'REJETEE_XHUB',
  'APPROUVEE',
  'ANNULEE_BROUILLON',
  'ENCAISSEE',
] as const;
/** Sous-états commerciaux CDV (Doc_02 § 02, ligne « Sous-états commerciaux CDV ») et défaut NONE. */
const CDV_STATES = ['NONE', 'MISE_A_DISPOSITION', 'PRISE_EN_CHARGE', 'APPROUVEE_PARTIELLEMENT', 'EN_LITIGE_SUSPENDUE', 'REFUSEE'] as const;

const V4_TRIGGERS = [
  'prevent_posted_lines_mutation_insert',
  'prevent_posted_entry_update',
  'prevent_posted_lines_mutation_update',
  'prevent_closed_fiscal_year_update',
  'prevent_entry_insert_in_closed_fiscal_year',
  'enforce_invoice_clearance_state_insert',
  'enforce_invoice_clearance_state_update',
  'enforce_invoice_cdv_status_insert',
  'enforce_invoice_cdv_status_update',
  'prevent_pos_ticket_delete',
  'prevent_pos_z_closure_delete',
  'prevent_pos_ticket_update',
  'prevent_pos_z_closure_update',
  'enforce_pos_ticket_hash_format_insert',
  'enforce_pos_ticket_hash_format_update',
  'enforce_pos_z_closure_hash_format_insert',
  'enforce_pos_z_closure_hash_format_update',
] as const;
const V3_TRIGGERS = [
  'prevent_posted_entry_update',
  'prevent_posted_entry_delete',
  'prevent_posted_lines_mutation_update',
  'prevent_posted_lines_mutation_delete',
  'enforce_balance_and_positive_cash_on_post',
  'prevent_direct_posted_insert',
] as const;
const SQLITE_ONLY_TRIGGERS = [
  'enforce_invoice_clearance_state_insert',
  'enforce_invoice_clearance_state_update',
  'enforce_invoice_cdv_status_insert',
  'enforce_invoice_cdv_status_update',
] as const;

const HEX_64 = 'abcdef0123456789'.repeat(4);

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

const RESET_ALL = `TRUNCATE journal_entry_lines, journal_entries, bank_transactions, fixed_assets_register, journals, cgnc_accounts, fiscal_years,
  pos_z_closures, pos_tickets, pos_sessions, invoice_lines, invoice_delivery_links, invoices, delivery_notes, purchase_orders,
  fiscal_partners, tenant_key_grants CASCADE`;

async function insertAll(engine: Engine, rows: readonly (readonly [string, RowValues])[]): Promise<void> {
  for (const [table, values] of rows) {
    const { sql, params } = insertSqlite(table, values);
    await engine.run(sql, params);
  }
}

async function failInsert(engine: Engine, table: string, values: RowValues): Promise<Failure> {
  const { sql, params } = insertSqlite(table, values);
  return engine.fail(sql, params);
}

async function seedBoth(rows: readonly (readonly [string, RowValues])[]): Promise<void> {
  for (const engine of dual.engines()) {
    await insertAll(engine, rows);
  }
}

function expectSame(results: readonly [Failure, Failure], message: string): void {
  expect(results[0].message).toBe(message);
  expect(results[1].message).toBe(message);
  expect(results[0].code).toBeNull();
  expect(results[1].code).toBe(RAISED);
}

/** Même texte sur les deux moteurs, SQLSTATE 23514 côté PostgreSQL (CHECK) : le texte est celui de PostgreSQL, SQLite le reprend. */
function expectSameCheck(results: readonly [Failure, Failure], message: string): void {
  expect(results[0].message).toBe(message);
  expect(results[1].message).toBe(message);
  expect(results[0].code).toBeNull();
  expect(results[1].code).toBe(CHECK_VIOLATION);
}

async function bothCount(sql: string): Promise<readonly [number, number]> {
  const [lite, pg] = await dual.onBoth((e) => e.rows(sql));
  return [Number(lite[0]?.['n']), Number(pg[0]?.['n'])];
}

function names(db: DatabaseSync, type: 'table' | 'trigger'): string[] {
  return all(db, `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`, type).map((row) => String(row['name']));
}

describe('migration v4 : forme, immuabilité de v1, v2 et v3, objets créés', () => {
  const v4 = TENANT_MIGRATIONS[3];

  it('est la quatrième migration ; les empreintes de v1, v2 et v3 sont inchangées (recalculées)', () => {
    expect(TENANT_MIGRATIONS.map((m) => m.version).slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(v4?.name).toBe('tenant_part4_pilot_corrections_immutability_statuses');
    for (const [index, expected] of [V1_SHA256, V2_SHA256, V3_SHA256].entries()) {
      const migration = TENANT_MIGRATIONS[index];
      expect(migration?.expectedSha256Hex).toBe(expected);
      expect(createHash('sha256').update(migration?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex'), `v${index + 1}`).toBe(expected);
    }
  });

  it('l\'empreinte de la v4 est celle de upSqlStatements.join("\\n")', () => {
    expect(v4?.expectedSha256Hex).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update(v4?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex')).toBe(v4?.expectedSha256Hex);
  });

  it('crée exactement les 17 triggers nommés (dont 2 remplacés et 4 réservés à SQLite), aucune table, aucun index, aucune vue', () => {
    expect(v4?.triggerNames).toEqual([...V4_TRIGGERS]);
    expect(v4?.tableNames).toEqual([]);
    expect(v4?.indexNames).toEqual([]);
    expect(v4?.viewNames ?? []).toEqual([]);
    // La v5 (T-S1B-05) ajoute deux triggers : la liste complète est celle de v3, v4 puis v5.
    const V5_TRIGGERS = ['enforce_10year_worm_retention_delete', 'enforce_10year_worm_retention_update'] as const;
    expect([...TENANT_TRIGGER_NAMES].sort()).toEqual([...new Set([...V3_TRIGGERS, ...V4_TRIGGERS, ...V5_TRIGGERS])].sort());
    expect([...TENANT_POSTGRES_TRIGGER_NAMES].sort()).toEqual(
      [...new Set([...V3_TRIGGERS, ...V4_TRIGGERS, ...V5_TRIGGERS])].filter((n) => !(SQLITE_ONLY_TRIGGERS as readonly string[]).includes(n)).sort(),
    );
  });

  it('ne crée ni payroll_annual_subledger ni archival_packages : ces tables naissent à la v5 (T-S1B-05)', () => {
    const tableNamesUpToV4: readonly string[] = TENANT_TABLE_NAMES.slice(0, 17);
    expect(tableNamesUpToV4).not.toContain('payroll_annual_subledger');
    expect(tableNamesUpToV4).not.toContain('archival_packages');
    expect(TENANT_MIGRATIONS[3]?.tableNames).toEqual([]);
    expect(TENANT_MIGRATIONS[3]?.upSqlStatements.join('\n')).not.toMatch(/CREATE TABLE (payroll_annual_subledger|archival_packages)/);
    expect(TENANT_MIGRATIONS[4]?.tableNames).toContain('payroll_annual_subledger');
    expect(TENANT_MIGRATIONS[4]?.tableNames).toContain('archival_packages');
  });

  it('les triggers déclarés sont ceux que la v4 crée sur SQLite ; une base v3 pleine se met à niveau sans perte', () => {
    const db = openTenant(3);
    expect(names(db, 'trigger')).toEqual([...V3_TRIGGERS].sort());
    db.prepare(insertSqlite('fiscal_partners', partnerRow()).sql).run(...insertSqlite('fiscal_partners', partnerRow()).params);
    db.prepare(insertSqlite('invoices', invoiceRow()).sql).run(...insertSqlite('invoices', invoiceRow()).params);
    for (const statement of v4?.upSqlStatements ?? []) {
      db.exec(statement);
    }
    expect(names(db, 'trigger')).toEqual([...new Set([...V3_TRIGGERS, ...V4_TRIGGERS])].sort());
    expect(all(db, 'SELECT COUNT(*) AS n FROM invoices')).toEqual([{ n: 1 }]);
  });

  it('la traduction PostgreSQL garde une instruction par instruction SQLite, sans INTEGER ni CAST', () => {
    if (v4 === undefined) {
      throw new Error('migration v4 absente');
    }
    const statements = tenantMigrationPostgresStatements(v4);
    expect(statements).toHaveLength(v4.upSqlStatements.length);
    expect(statements.join('\n')).not.toMatch(/\bINTEGER\b/);
    expect(statements.join('\n')).not.toMatch(/CAST\(/);
  });

  it('PostgreSQL porte exactement les triggers PG du registre et les deux contraintes de statut de facture', async () => {
    const triggers = await client.query(
      `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND NOT t.tgisinternal ORDER BY t.tgname`,
      [SCHEMA],
    );
    expect(triggers.rows.map((row: { tgname: string }) => row.tgname)).toEqual([...TENANT_POSTGRES_TRIGGER_NAMES].sort());
    const constraints = await client.query(
      `SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 AND conname IN ('invoices_clearance_state_check', 'invoices_cdv_lifecycle_status_check') ORDER BY conname`,
      [SCHEMA],
    );
    expect(constraints.rows.map((row: { conname: string }) => row.conname)).toEqual(['invoices_cdv_lifecycle_status_check', 'invoices_clearance_state_check']);
    expect(all(openTenant(), `SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`).map((row) => String(row['name']))).toEqual(
      [...TENANT_TRIGGER_NAMES].sort(),
    );
  });
});

describe('1. trou d\'immuabilité : INSERT d\'une ligne dans une pièce POSTED (prevent_posted_lines_mutation_insert)', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
  });

  async function postBoth(id: string): Promise<void> {
    for (const engine of dual.engines()) {
      await engine.run(POST_ENTRY_SQL, postParams(id));
    }
  }

  const newLine = (entryId: string, number: number): RowValues => ({
    id: `${entryId}-extra-${number}`,
    entry_id: entryId,
    line_number: number,
    account_id: 'acc-6111',
    description_enc: 'v1:aXY:bGlnbmU',
    debit_cents: 100,
  });

  it('refusé dans une pièce POSTED, même texte ; aucune ligne écrite', async () => {
    await seedBoth(simpleEntry('je-1', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 120000));
    await postBoth('je-1');
    expectSame(await dual.onBoth((e) => failInsert(e, 'journal_entry_lines', newLine('je-1', 3))), MSG_LINE_INSERT);
    expect(await bothCount(`SELECT COUNT(*) AS n FROM journal_entry_lines WHERE entry_id = 'je-1'`)).toEqual([2, 2]);
  });

  it('accepté dans une pièce non POSTED (IA_PROPOSITION, DRAFT, REVISEE_CYCLE) ; une pièce se construit lignes d\'abord, puis passe à POSTED', async () => {
    await seedBoth(entryWithLines('je-ia', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 700 }, { account: 'acc-7111', credit: 700 }], { status: 'IA_PROPOSITION' }));
    await seedBoth(entryWithLines('je-dr', 2, 'jrn-vte', [{ account: 'acc-3421', debit: 700 }, { account: 'acc-7111', credit: 700 }], { status: 'DRAFT' }));
    await seedBoth(entryWithLines('je-rv', 3, 'jrn-vte', [{ account: 'acc-3421', debit: 700 }, { account: 'acc-7111', credit: 700 }], { status: 'REVISEE_CYCLE' }));
    for (const id of ['je-ia', 'je-dr', 'je-rv']) {
      await seedBoth([['journal_entry_lines', newLine(id, 9)]]);
    }
    expect(await bothCount(`SELECT COUNT(*) AS n FROM journal_entry_lines`)).toEqual([9, 9]);
    await seedBoth(simpleEntry('je-ok', 4, 'jrn-vte', 'acc-3421', 'acc-7111', 5000));
    await postBoth('je-ok');
    expect(await bothCount(`SELECT COUNT(*) AS n FROM journal_entries WHERE status = 'POSTED'`)).toEqual([1, 1]);
  });

  it('une ligne vers une pièce inexistante reste refusée par la clé étrangère, pas par le trigger', async () => {
    const [lite, pg] = await dual.onBoth((e) => failInsert(e, 'journal_entry_lines', newLine('ghost', 1)));
    expect(lite.message).toMatch(/FOREIGN KEY constraint failed/);
    expect(pg.code).toBe('23503');
  });
});

describe('2. pii_restricted_flag : montée monotone 0 vers 1, seule modification admise d\'une pièce ou ligne POSTED', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth(simpleEntry('je-1', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 120000));
    for (const engine of dual.engines()) {
      await engine.run(POST_ENTRY_SQL, postParams('je-1'));
    }
  });

  async function flags(): Promise<readonly [Record<string, string | number | null>[], Record<string, string | number | null>[]]> {
    return dual.onBoth((e) => e.rows(`SELECT pii_restricted_flag, status, entry_hash, validated_at, entry_date FROM journal_entries WHERE id = 'je-1'`));
  }

  it('pièce POSTED : 0 vers 1 accepté, toutes les autres colonnes inchangées (NULL compris)', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-1'`);
    }
    const [lite, pg] = await flags();
    expect(lite).toEqual([{ pii_restricted_flag: 1, status: 'POSTED', entry_hash: SHA_B, validated_at: NOW, entry_date: '2026-11-13' }]);
    expect(pg).toEqual(lite);
  });

  it('pièce POSTED : 1 vers 0 refusé, même texte (aucune descente)', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-1'`);
    }
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE journal_entries SET pii_restricted_flag = 0 WHERE id = 'je-1'`)), MSG_ENTRY_UPDATE);
    expect((await flags())[0][0]?.['pii_restricted_flag']).toBe(1);
  });

  it('pièce POSTED : 0 vers 1 combiné à un changement de montant ou de n\'importe quelle autre colonne refusé, même texte', async () => {
    const changes: readonly string[] = [
      'total_debit_cents = 120001, total_credit_cents = 120001',
      'total_debit_cents = 120001',
      `entry_date = '2026-12-01'`,
      `validated_at = NULL`,
      `validated_at = '2026-11-14T10:00:00Z'`,
      `review_cycle = 'FISCAL'`,
      `status = 'DRAFT'`,
      `status = 'CONTRE_PASSEE'`,
      `source_document_type = 'PAYMENT'`,
      `invoice_id = 'inv-ghost'`,
      `dgi_clearance_uuid = 'uuid-1'`,
      `partner_id = 'partner-ghost'`,
      `reversal_of_entry_id = 'je-1'`,
      `previous_entry_hash = '${SHA_B}'`,
      `entry_hash = NULL`,
      `entry_hash = '${'c'.repeat(64)}'`,
      `journal_id = 'jrn-cai'`,
      `fiscal_year_id = 'fy-ghost'`,
      'sequence_number = 77',
      `entry_reference = 'AUTRE'`,
      `id = 'je-renomme'`,
    ];
    for (const change of changes) {
      expectSame(await dual.onBoth((e) => e.fail(`UPDATE journal_entries SET pii_restricted_flag = 1, ${change} WHERE id = 'je-1'`)), MSG_ENTRY_UPDATE);
    }
    expect((await flags())[1][0]?.['pii_restricted_flag']).toBe(0);
  });

  it('pièce POSTED : tout autre UPDATE refusé comme avant, y compris sans toucher au drapeau ; DELETE toujours refusé, même après DSAR', async () => {
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE journal_entries SET entry_date = '2026-12-01' WHERE id = 'je-1'`)), MSG_ENTRY_UPDATE);
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-1'`);
    }
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE journal_entries SET entry_date = '2026-12-01' WHERE id = 'je-1'`)), MSG_ENTRY_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`DELETE FROM journal_entries WHERE id = 'je-1'`)), MSG_ENTRY_DELETE);
  });

  it('pièce non POSTED : le drapeau est libre dans les deux sens, sur les deux moteurs', async () => {
    await seedBoth(simpleEntry('je-d', 2, 'jrn-vte', 'acc-3421', 'acc-7111', 700));
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-d'`);
      await engine.run(`UPDATE journal_entries SET pii_restricted_flag = 0, entry_date = '2026-11-20' WHERE id = 'je-d'`);
      await engine.run(`UPDATE journal_entries SET pii_restricted_flag = 1 WHERE id = 'je-d'`);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT pii_restricted_flag, entry_date FROM journal_entries WHERE id = 'je-d'`));
    expect(lite).toEqual([{ pii_restricted_flag: 1, entry_date: '2026-11-20' }]);
    expect(pg).toEqual(lite);
  });

  it('ligne d\'une pièce POSTED : 0 vers 1 accepté ; 1 vers 0 refusé ; 0 vers 1 combiné à toute autre colonne refusé', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE journal_entry_lines SET pii_restricted_flag = 1 WHERE id = 'je-1-l1'`);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT id, pii_restricted_flag FROM journal_entry_lines WHERE entry_id = 'je-1' ORDER BY id`));
    expect(lite).toEqual([
      { id: 'je-1-l1', pii_restricted_flag: 1 },
      { id: 'je-1-l2', pii_restricted_flag: 0 },
    ]);
    expect(pg).toEqual(lite);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE journal_entry_lines SET pii_restricted_flag = 0 WHERE id = 'je-1-l1'`)), MSG_LINE_UPDATE);
    const changes: readonly string[] = [
      `description_enc = 'v1:a:z'`,
      'debit_cents = 120001',
      'credit_cents = 5',
      `account_id = 'acc-6111'`,
      `auxiliary_account = 'AUX'`,
      'is_tax_deductible = 0',
      `table3_reintegration_code = 'T3'`,
      `reconciliation_code = 'LET1'`,
      `reconciled_at = '${NOW}'`,
      'line_number = 9',
      `entry_id = 'je-ghost'`,
      `id = 'jel-renomme'`,
    ];
    for (const change of changes) {
      expectSame(await dual.onBoth((e) => e.fail(`UPDATE journal_entry_lines SET pii_restricted_flag = 1, ${change} WHERE id = 'je-1-l2'`)), MSG_LINE_UPDATE);
    }
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE journal_entry_lines SET description_enc = 'v1:a:z' WHERE id = 'je-1-l2'`)), MSG_LINE_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`DELETE FROM journal_entry_lines WHERE id = 'je-1-l1'`)), MSG_LINE_DELETE);
  });

  it('ligne d\'une pièce non POSTED : drapeau libre', async () => {
    await seedBoth(simpleEntry('je-d', 2, 'jrn-vte', 'acc-3421', 'acc-7111', 700));
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE journal_entry_lines SET pii_restricted_flag = 1 WHERE id = 'je-d-l1'`);
      await engine.run(`UPDATE journal_entry_lines SET pii_restricted_flag = 0 WHERE id = 'je-d-l1'`);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT pii_restricted_flag FROM journal_entry_lines WHERE id = 'je-d-l1'`));
    expect(lite).toEqual([{ pii_restricted_flag: 0 }]);
    expect(pg).toEqual(lite);
  });

  it('invoices : aucun trigger d\'immuabilité n\'existe sur cette table, donc aucun n\'est modifié ; pii_restricted_flag y reste libre', async () => {
    await seedBoth([['fiscal_partners', partnerRow()], ['invoices', invoiceRow()]]);
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE invoices SET pii_restricted_flag = 1 WHERE id = 'inv-1'`);
    }
    const triggers = await client.query(
      `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND NOT t.tgisinternal AND c.relname = 'invoices'`,
      [SCHEMA],
    );
    expect(triggers.rows).toEqual([]);
  });
});

describe('5. exercice clos : fiscal_years CLOSED immuable ; aucune pièce rattachée à un exercice CLOSED (Doc_06 § 05, Doc_02 § 04)', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
  });

  it('transitions OPEN vers CLOSING puis CLOSING vers CLOSED acceptées (UPDATE d\'un ancien statut CLOSING), closing_hash posé en même temps', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`);
      await engine.run(`UPDATE fiscal_years SET status = 'CLOSED', closing_hash = ?, definitive_vat_prorata_bps = 9000 WHERE id = 'fy-2026'`, [HEX_64]);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT status, closing_hash, definitive_vat_prorata_bps FROM fiscal_years`));
    expect(lite).toEqual([{ status: 'CLOSED', closing_hash: HEX_64, definitive_vat_prorata_bps: 9000 }]);
    expect(pg).toEqual(lite);
  });

  it('tout UPDATE d\'un exercice dont l\'ancien statut est CLOSED refusé, même texte (retour à OPEN, prorata, empreinte, code)', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`);
    }
    for (const change of [`status = 'OPEN'`, `status = 'CLOSING'`, 'definitive_vat_prorata_bps = 5000', `closing_hash = '${HEX_64}'`, `code = 'EX-AUTRE'`, `status = 'CLOSED'`]) {
      expectSame(await dual.onBoth((e) => e.fail(`UPDATE fiscal_years SET ${change} WHERE id = 'fy-2026'`)), MSG_FY_UPDATE);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT status, code FROM fiscal_years`));
    expect(lite).toEqual([{ status: 'CLOSED', code: 'EX-2026' }]);
    expect(pg).toEqual(lite);
  });

  it('un exercice OPEN ou CLOSING reste modifiable', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE fiscal_years SET provisional_vat_prorata_bps = 8000 WHERE id = 'fy-2026'`);
      await engine.run(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`);
      await engine.run(`UPDATE fiscal_years SET definitive_vat_prorata_bps = 7000 WHERE id = 'fy-2026'`);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT status, provisional_vat_prorata_bps, definitive_vat_prorata_bps FROM fiscal_years`));
    expect(lite).toEqual([{ status: 'CLOSING', provisional_vat_prorata_bps: 8000, definitive_vat_prorata_bps: 7000 }]);
    expect(pg).toEqual(lite);
  });

  it('INSERT d\'une pièce dans un exercice CLOSED refusé, même texte ; accepté dans OPEN et CLOSING', async () => {
    await seedBoth(simpleEntry('je-open', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE fiscal_years SET status = 'CLOSING' WHERE id = 'fy-2026'`);
    }
    await seedBoth(simpleEntry('je-closing', 2, 'jrn-vte', 'acc-3421', 'acc-7111', 500));
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`);
    }
    const draft = entryRow({ id: 'je-late', sequence_number: 3, entry_reference: 'LATE-3', status: 'DRAFT' });
    expectSame(await dual.onBoth((e) => failInsert(e, 'journal_entries', draft)), MSG_FY_ENTRY_INSERT);
    expect(await bothCount(`SELECT COUNT(*) AS n FROM journal_entries`)).toEqual([2, 2]);
  });

  it('le journal d\'ouverture AN s\'insère dans le NOUVEL exercice OPEN pendant que l\'ancien est CLOSED', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`);
    }
    await seedBoth([['fiscal_years', fiscalYearRow({ id: 'fy-2027', code: 'EX-2027', start_date: '2027-01-01', end_date: '2027-12-31' })]]);
    await seedBoth(
      simpleEntry('je-an', 1, 'jrn-an', 'acc-5161', 'acc-1111', 100000, { fiscal_year_id: 'fy-2027', source_document_type: 'CUTOFF_OD', entry_date: '2027-01-01' }),
    );
    for (const engine of dual.engines()) {
      await engine.run(POST_ENTRY_SQL, postParams('je-an'));
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT fiscal_year_id, status FROM journal_entries`));
    expect(lite).toEqual([{ fiscal_year_id: 'fy-2027', status: 'POSTED' }]);
    expect(pg).toEqual(lite);
  });
});

describe('6. statuts de facture : CHECK sur colonnes existantes (PostgreSQL) et triggers (SQLite), même texte', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth([['fiscal_partners', partnerRow()]]);
  });

  it.each(CLEARANCE_STATES)('clearance_state %s accepté à l\'insertion et à la mise à jour', async (state) => {
    await seedBoth([['invoices', invoiceRow({ id: `inv-${state}`, clearance_state: state })]]);
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE invoices SET clearance_state = 'BROUILLON' WHERE id = ?`, [`inv-${state}`]);
      await engine.run(`UPDATE invoices SET clearance_state = ? WHERE id = ?`, [state, `inv-${state}`]);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT clearance_state FROM invoices WHERE id = 'inv-${state}'`));
    expect(lite).toEqual([{ clearance_state: state }]);
    expect(pg).toEqual(lite);
  });

  it.each(['EN_ATTENTE_XHUB', 'DRAFT', 'brouillon', 'ENCAISSE', 'REFUSEE', 'MISE_A_DISPOSITION', ''])('clearance_state « %s » refusé, même texte', async (state) => {
    expectSameCheck(await dual.onBoth((e) => failInsert(e, 'invoices', invoiceRow({ id: 'inv-x', clearance_state: state }))), MSG_CLEARANCE);
    await seedBoth([['invoices', invoiceRow({ id: 'inv-y' })]]);
    expectSameCheck(await dual.onBoth((e) => e.fail(`UPDATE invoices SET clearance_state = ? WHERE id = 'inv-y'`, [state])), MSG_CLEARANCE);
  });

  it.each(CDV_STATES)('cdv_lifecycle_status %s accepté à l\'insertion et à la mise à jour', async (state) => {
    await seedBoth([['invoices', invoiceRow({ id: `inv-${state}`, cdv_lifecycle_status: state })]]);
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE invoices SET cdv_lifecycle_status = 'NONE' WHERE id = ?`, [`inv-${state}`]);
      await engine.run(`UPDATE invoices SET cdv_lifecycle_status = ? WHERE id = ?`, [state, `inv-${state}`]);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT cdv_lifecycle_status FROM invoices WHERE id = 'inv-${state}'`));
    expect(lite).toEqual([{ cdv_lifecycle_status: state }]);
    expect(pg).toEqual(lite);
  });

  it.each(['BROUILLON', 'ENCAISSEE', 'APPROUVEE', 'REFUSE', 'EN_LITIGE', 'none', ''])('cdv_lifecycle_status « %s » refusé, même texte', async (state) => {
    expectSameCheck(await dual.onBoth((e) => failInsert(e, 'invoices', invoiceRow({ id: 'inv-x', cdv_lifecycle_status: state }))), MSG_CDV);
    await seedBoth([['invoices', invoiceRow({ id: 'inv-y' })]]);
    expectSameCheck(await dual.onBoth((e) => e.fail(`UPDATE invoices SET cdv_lifecycle_status = ? WHERE id = 'inv-y'`, [state])), MSG_CDV);
  });

  it('les valeurs par défaut BROUILLON et NONE sont admises ; la liste de clearance compte 8 statuts, celle de CDV 6 valeurs', async () => {
    await seedBoth([['invoices', invoiceRow({ id: 'inv-default' })]]);
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT clearance_state, cdv_lifecycle_status FROM invoices`));
    expect(lite).toEqual([{ clearance_state: 'BROUILLON', cdv_lifecycle_status: 'NONE' }]);
    expect(pg).toEqual(lite);
    expect(CLEARANCE_STATES).toHaveLength(8);
    expect(CDV_STATES).toHaveLength(6);
  });

  it('une mise à jour d\'une autre colonne ne passe pas par le contrôle de statut', async () => {
    await seedBoth([['invoices', invoiceRow({ id: 'inv-1' })]]);
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE invoices SET paid_cents = 10 WHERE id = 'inv-1'`);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT paid_cents FROM invoices`));
    expect(lite).toEqual([{ paid_cents: 10 }]);
    expect(pg).toEqual(lite);
  });
});

describe('4. POS (Art. 145 CGI) : suppression interdite, format 64 caractères hexadécimaux minuscules', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth([['pos_sessions', posSessionRow()], ['pos_tickets', posTicketRow()], ['pos_z_closures', posZClosureRow()]]);
  });

  it('DELETE d\'un ticket POS refusé, même texte ; le ticket reste', async () => {
    expectSame(await dual.onBoth((e) => e.fail(`DELETE FROM pos_tickets WHERE id = 'tkt-1'`)), MSG_TICKET_DELETE);
    expect(await bothCount('SELECT COUNT(*) AS n FROM pos_tickets')).toEqual([1, 1]);
  });

  it('DELETE d\'une clôture Z scellée refusé, même texte ; la clôture reste', async () => {
    expectSame(await dual.onBoth((e) => e.fail(`DELETE FROM pos_z_closures WHERE id = 'z-1'`)), MSG_Z_DELETE);
    expect(await bothCount('SELECT COUNT(*) AS n FROM pos_z_closures')).toEqual([1, 1]);
  });

  it('empreintes hexadécimales minuscules de 64 caractères acceptées à l\'insertion ; leur mise à jour est désormais refusée par prevent_pos_ticket_update (pas par le format)', async () => {
    await seedBoth([
      ['pos_tickets', posTicketRow({ id: 'tkt-2', terminal_seq_number: 'S-2', qr_conversion_token: 'qr-2', prev_ticket_sha256: HEX_64, ticket_sha256: HEX_64 })]
    ]);
    expect(await bothCount('SELECT COUNT(*) AS n FROM pos_tickets')).toEqual([2, 2]);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET ticket_sha256 = ? WHERE id = 'tkt-2'`, ['0123456789'.repeat(6) + 'abcd'])), MSG_TICKET_UPDATE);
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT ticket_sha256 FROM pos_tickets WHERE id = 'tkt-2'`));
    expect(lite).toEqual([{ ticket_sha256: HEX_64 }]);
    expect(pg).toEqual(lite);
  });

  const BAD_HEX = 'g'.repeat(64);
  const BAD_UPPER = 'B'.repeat(64);

  it('ticket : 64 caractères non hexadécimaux refusés par le trigger (ticket_sha256 et prev_ticket_sha256), même texte', async () => {
    const extra = { id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x' };
    expectSame(await dual.onBoth((e) => failInsert(e, 'pos_tickets', posTicketRow({ ...extra, ticket_sha256: BAD_HEX }))), MSG_HASH_FORMAT);
    expectSame(await dual.onBoth((e) => failInsert(e, 'pos_tickets', posTicketRow({ ...extra, prev_ticket_sha256: BAD_HEX }))), MSG_HASH_FORMAT);
    expectSame(await dual.onBoth((e) => failInsert(e, 'pos_tickets', posTicketRow({ ...extra, prev_ticket_sha256: BAD_UPPER }))), MSG_HASH_FORMAT);
    expectSame(await dual.onBoth((e) => failInsert(e, 'pos_tickets', posTicketRow({ ...extra, prev_ticket_sha256: 'abc' }))), MSG_HASH_FORMAT);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET ticket_sha256 = ? WHERE id = 'tkt-1'`, [BAD_HEX])), MSG_HASH_FORMAT);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET prev_ticket_sha256 = ? WHERE id = 'tkt-1'`, [BAD_HEX])), MSG_HASH_FORMAT);
  });

  it('ticket : le CHECK de v2 (longueur 64 et minuscules) n\'est pas doublé ; il continue de refuser majuscules et longueur, avec son propre code', async () => {
    const extra = { id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x' };
    for (const bad of [BAD_UPPER, 'abc']) {
      const [lite, pg] = await dual.onBoth((e) => failInsert(e, 'pos_tickets', posTicketRow({ ...extra, ticket_sha256: bad })));
      expect(lite.message).toMatch(/CHECK constraint failed/);
      expect(pg.code).toBe(CHECK_VIOLATION);
    }
  });

  it('ticket : une empreinte précédente absente reste refusée par NOT NULL, pas par le trigger', async () => {
    const [lite, pg] = await dual.onBoth((e) => failInsert(e, 'pos_tickets', posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', prev_ticket_sha256: null })));
    expect(lite.message).toMatch(/NOT NULL constraint failed/);
    expect(pg.code).toBe('23502');
  });

  it('clôture Z : 64 caractères non hexadécimaux, majuscules ou longueur incorrecte refusés (trigger pour prev_z_sha256 et la partie hexadécimale de z_sha256, CHECK de v2 sinon)', async () => {
    const extra = { id: 'z-x', session_id: 'sess-2', closure_number: 9 };
    await seedBoth([['pos_sessions', posSessionRow({ id: 'sess-2' })]]);
    expectSame(await dual.onBoth((e) => failInsert(e, 'pos_z_closures', posZClosureRow({ ...extra, z_sha256: BAD_HEX }))), MSG_HASH_FORMAT);
    expectSame(await dual.onBoth((e) => failInsert(e, 'pos_z_closures', posZClosureRow({ ...extra, prev_z_sha256: BAD_HEX }))), MSG_HASH_FORMAT);
    expectSame(await dual.onBoth((e) => failInsert(e, 'pos_z_closures', posZClosureRow({ ...extra, prev_z_sha256: BAD_UPPER }))), MSG_HASH_FORMAT);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_z_closures SET z_sha256 = ? WHERE id = 'z-1'`, [BAD_HEX])), MSG_HASH_FORMAT);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_z_closures SET prev_z_sha256 = ? WHERE id = 'z-1'`, [BAD_HEX])), MSG_HASH_FORMAT);
    for (const bad of [BAD_UPPER, 'abc']) {
      const [lite, pg] = await dual.onBoth((e) => failInsert(e, 'pos_z_closures', posZClosureRow({ ...extra, z_sha256: bad })));
      expect(lite.message).toMatch(/CHECK constraint failed/);
      expect(pg.code).toBe(CHECK_VIOLATION);
    }
    const [lite, pg] = await dual.onBoth((e) => failInsert(e, 'pos_z_closures', posZClosureRow({ ...extra, prev_z_sha256: null })));
    expect(lite.message).toMatch(/NOT NULL constraint failed/);
    expect(pg.code).toBe('23502');
  });

  it('clôture Z valide en hexadécimal acceptée à l\'insertion', async () => {
    await seedBoth([['pos_sessions', posSessionRow({ id: 'sess-2' })], ['pos_z_closures', posZClosureRow({ id: 'z-2', session_id: 'sess-2', closure_number: 2, prev_z_sha256: HEX_64, z_sha256: HEX_64 })]]);
    expect(await bothCount('SELECT COUNT(*) AS n FROM pos_z_closures')).toEqual([2, 2]);
  });
});

describe('4 bis. POS (Art. 145 CGI) : UPDATE interdit sauf conversion B2B monotone (ticket) et pose GL/AIP monotone (clôture Z)', () => {
  const AVANT_Z = 'CONVERTI_B2B_AVANT_Z';
  const POST_Z = 'CONVERTI_B2B_POST_Z_NEUTRALISE';
  const OTHER_HEX = 'fedcba9876543210'.repeat(4);

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
      ['pos_z_closures', posZClosureRow()],
    ]);
  });

  async function ticketState(): Promise<readonly [readonly Record<string, string | number | null>[], readonly Record<string, string | number | null>[]]> {
    return dual.onBoth((e) => e.rows(`SELECT b2b_conversion_state, converted_invoice_id, total_ttc_cents, ticket_sha256 FROM pos_tickets WHERE id = 'tkt-1'`));
  }

  async function untouched(): Promise<void> {
    const [lite, pg] = await ticketState();
    expect(lite).toEqual([{ b2b_conversion_state: 'NONE', converted_invoice_id: null, total_ttc_cents: 120000, ticket_sha256: SHA_B }]);
    expect(pg).toEqual(lite);
  }

  it('conversion valide acceptée sur les deux moteurs : NONE vers CONVERTI_B2B_AVANT_Z, converted_invoice_id NULL vers valeur', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE pos_tickets SET b2b_conversion_state = ?, converted_invoice_id = ? WHERE id = 'tkt-1'`, [AVANT_Z, 'inv-1']);
    }
    const [lite, pg] = await ticketState();
    expect(lite).toEqual([{ b2b_conversion_state: AVANT_Z, converted_invoice_id: 'inv-1', total_ttc_cents: 120000, ticket_sha256: SHA_B }]);
    expect(pg).toEqual(lite);
  });

  it('conversion après Z acceptée : NONE vers CONVERTI_B2B_POST_Z_NEUTRALISE (scan QR après clôture)', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE pos_tickets SET b2b_conversion_state = ?, converted_invoice_id = ? WHERE id = 'tkt-1'`, [POST_Z, 'inv-1']);
    }
    const [lite, pg] = await ticketState();
    expect(lite[0]?.['b2b_conversion_state']).toBe(POST_Z);
    expect(pg).toEqual(lite);
  });

  it('changement de montant, de signature, de hash, de session, de terminal, de séquence, de jeton QR refusé, même texte', async () => {
    const changes: readonly (readonly [string, string | number])[] = [
      ['total_ttc_cents', 130000],
      ['ht_20_cents', 1],
      ['paid_cash_cents', 5],
      ['ecdsa_signature_b64', 'MEUCIQDforged'],
      ['ticket_sha256', OTHER_HEX],
      ['prev_ticket_sha256', OTHER_HEX],
      ['session_id', 'sess-2'],
      ['terminal_id', 'POS-M01-C09'],
      ['terminal_seq_number', 'POS-M01-C02-2026-000999'],
      ['qr_conversion_token', 'qr-other'],
      ['issued_at', '2026-11-14T00:00:00Z'],
    ];
    for (const [column, value] of changes) {
      expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET ${column} = ? WHERE id = 'tkt-1'`, [value])), MSG_TICKET_UPDATE);
    }
    await untouched();
  });

  it('une origine NULL vers valeur ou un type de ticket modifié sont refusés', async () => {
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET origin_ticket_id = ? WHERE id = 'tkt-1'`, ['tkt-1'])), MSG_TICKET_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET ticket_kind = ? WHERE id = 'tkt-1'`, ['RETURN_REFUND'])), MSG_TICKET_UPDATE);
    await untouched();
  });

  it('conversion combinée à un changement d\'une autre colonne refusée (montant, signature, hash), même texte', async () => {
    for (const [column, value] of [['total_ttc_cents', 130000], ['ecdsa_signature_b64', 'MEUCIQDforged'], ['ticket_sha256', OTHER_HEX]] as const) {
      expectSame(
        await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET b2b_conversion_state = ?, converted_invoice_id = ?, ${column} = ? WHERE id = 'tkt-1'`, [AVANT_Z, 'inv-1', value])),
        MSG_TICKET_UPDATE,
      );
    }
    await untouched();
  });

  it('état seul sans facture, facture seule sans état, état inchangé, no-op : refusés', async () => {
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET b2b_conversion_state = ? WHERE id = 'tkt-1'`, [AVANT_Z])), MSG_TICKET_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET converted_invoice_id = ? WHERE id = 'tkt-1'`, ['inv-1'])), MSG_TICKET_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET converted_invoice_id = ?, b2b_conversion_state = 'NONE' WHERE id = 'tkt-1'`, ['inv-1'])), MSG_TICKET_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET total_ttc_cents = total_ttc_cents WHERE id = 'tkt-1'`)), MSG_TICKET_UPDATE);
    await untouched();
  });

  it('régression d\'état refusée (retour à NONE, AVANT_Z vers POST_Z, POST_Z vers AVANT_Z), facture comprise', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE pos_tickets SET b2b_conversion_state = ?, converted_invoice_id = ? WHERE id = 'tkt-1'`, [AVANT_Z, 'inv-1']);
    }
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET b2b_conversion_state = 'NONE' WHERE id = 'tkt-1'`)), MSG_TICKET_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET b2b_conversion_state = 'NONE', converted_invoice_id = NULL WHERE id = 'tkt-1'`)), MSG_TICKET_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET b2b_conversion_state = ? WHERE id = 'tkt-1'`, [POST_Z])), MSG_TICKET_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET b2b_conversion_state = ?, converted_invoice_id = ? WHERE id = 'tkt-1'`, [POST_Z, 'inv-2'])), MSG_TICKET_UPDATE);
    const [lite, pg] = await ticketState();
    expect(lite[0]?.['b2b_conversion_state']).toBe(AVANT_Z);
    expect(pg).toEqual(lite);
  });

  it('écrasement de converted_invoice_id déjà posé refusé (autre facture, remise à NULL), état converti inchangé ou non', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE pos_tickets SET b2b_conversion_state = ?, converted_invoice_id = ? WHERE id = 'tkt-1'`, [POST_Z, 'inv-1']);
    }
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET converted_invoice_id = ? WHERE id = 'tkt-1'`, ['inv-2'])), MSG_TICKET_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET converted_invoice_id = NULL WHERE id = 'tkt-1'`)), MSG_TICKET_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET b2b_conversion_state = ?, converted_invoice_id = ? WHERE id = 'tkt-1'`, [POST_Z, 'inv-2'])), MSG_TICKET_UPDATE);
    const [lite, pg] = await ticketState();
    expect(lite[0]?.['converted_invoice_id']).toBe('inv-1');
    expect(pg).toEqual(lite);
  });

  it('un état hors liste est refusé (le trigger BEFORE passe avant le CHECK de v2, échec fermé), même texte', async () => {
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_tickets SET b2b_conversion_state = ?, converted_invoice_id = ? WHERE id = 'tkt-1'`, ['INVENTE', 'inv-1'])), MSG_TICKET_UPDATE);
    await untouched();
  });

  it('DELETE d\'un ticket converti toujours refusé', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE pos_tickets SET b2b_conversion_state = ?, converted_invoice_id = ? WHERE id = 'tkt-1'`, [AVANT_Z, 'inv-1']);
    }
    expectSame(await dual.onBoth((e) => e.fail(`DELETE FROM pos_tickets WHERE id = 'tkt-1'`)), MSG_TICKET_DELETE);
  });

  async function zState(): Promise<readonly [readonly Record<string, string | number | null>[], readonly Record<string, string | number | null>[]]> {
    return dual.onBoth((e) => e.rows(`SELECT gl_journal_entry_id, aip_archive_id, tpe_gross_cents, z_sha256 FROM pos_z_closures WHERE id = 'z-1'`));
  }

  it('clôture Z : pose de gl_journal_entry_id NULL vers valeur acceptée', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE pos_z_closures SET gl_journal_entry_id = ? WHERE id = 'z-1'`, ['je-1']);
    }
    const [lite, pg] = await zState();
    expect(lite).toEqual([{ gl_journal_entry_id: 'je-1', aip_archive_id: null, tpe_gross_cents: 120000, z_sha256: SHA_C }]);
    expect(pg).toEqual(lite);
  });

  it('clôture Z : pose de aip_archive_id acceptée, puis des deux ensemble sur une autre clôture', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE pos_z_closures SET aip_archive_id = ? WHERE id = 'z-1'`, ['aip-1']);
    }
    const [lite, pg] = await zState();
    expect(lite[0]?.['aip_archive_id']).toBe('aip-1');
    expect(pg).toEqual(lite);
    await seedBoth([['pos_z_closures', posZClosureRow({ id: 'z-2', session_id: 'sess-2', closure_number: 2 })]]);
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE pos_z_closures SET gl_journal_entry_id = ?, aip_archive_id = ? WHERE id = 'z-2'`, ['je-2', 'aip-2']);
    }
    const [liteTwo, pgTwo] = await dual.onBoth((e) => e.rows(`SELECT gl_journal_entry_id, aip_archive_id FROM pos_z_closures WHERE id = 'z-2'`));
    expect(liteTwo).toEqual([{ gl_journal_entry_id: 'je-2', aip_archive_id: 'aip-2' }]);
    expect(pgTwo).toEqual(liteTwo);
  });

  it('clôture Z : pose de l\'une des deux références après l\'autre acceptée (la première reste inchangée)', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE pos_z_closures SET gl_journal_entry_id = ? WHERE id = 'z-1'`, ['je-1']);
      await engine.run(`UPDATE pos_z_closures SET aip_archive_id = ? WHERE id = 'z-1'`, ['aip-1']);
    }
    const [lite, pg] = await zState();
    expect(lite).toEqual([{ gl_journal_entry_id: 'je-1', aip_archive_id: 'aip-1', tpe_gross_cents: 120000, z_sha256: SHA_C }]);
    expect(pg).toEqual(lite);
  });

  it('clôture Z : modification d\'une valeur déjà posée refusée (autre valeur, remise à NULL), même texte', async () => {
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE pos_z_closures SET gl_journal_entry_id = ?, aip_archive_id = ? WHERE id = 'z-1'`, ['je-1', 'aip-1']);
    }
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_z_closures SET gl_journal_entry_id = ? WHERE id = 'z-1'`, ['je-9'])), MSG_Z_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_z_closures SET aip_archive_id = ? WHERE id = 'z-1'`, ['aip-9'])), MSG_Z_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_z_closures SET gl_journal_entry_id = NULL WHERE id = 'z-1'`)), MSG_Z_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_z_closures SET aip_archive_id = NULL WHERE id = 'z-1'`)), MSG_Z_UPDATE);
    const [lite, pg] = await zState();
    expect(lite[0]).toMatchObject({ gl_journal_entry_id: 'je-1', aip_archive_id: 'aip-1' });
    expect(pg).toEqual(lite);
  });

  it('clôture Z : modification d\'un autre champ refusée, seule ou combinée à une pose, et no-op refusé', async () => {
    for (const [column, value] of [['tpe_gross_cents', 1], ['net_b2c_ht_20_cents', 1], ['z_sha256', OTHER_HEX], ['prev_z_sha256', OTHER_HEX], ['business_date', '2026-11-14'], ['closure_number', 7], ['terminal_id', 'POS-M01-C09'], ['session_id', 'sess-2']] as const) {
      expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_z_closures SET ${column} = ? WHERE id = 'z-1'`, [value])), MSG_Z_UPDATE);
      expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_z_closures SET gl_journal_entry_id = ?, ${column} = ? WHERE id = 'z-1'`, ['je-1', value])), MSG_Z_UPDATE);
    }
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_z_closures SET tpe_gross_cents = tpe_gross_cents WHERE id = 'z-1'`)), MSG_Z_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_z_closures SET gl_journal_entry_id = NULL WHERE id = 'z-1'`)), MSG_Z_UPDATE);
    const [lite, pg] = await zState();
    expect(lite).toEqual([{ gl_journal_entry_id: null, aip_archive_id: null, tpe_gross_cents: 120000, z_sha256: SHA_C }]);
    expect(pg).toEqual(lite);
  });

  it('clôture Z : le format d\'empreinte garde priorité (même texte que pour le trigger de format)', async () => {
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE pos_z_closures SET z_sha256 = ? WHERE id = 'z-1'`, ['g'.repeat(64)])), MSG_HASH_FORMAT);
  });
});

describe('7. montants supérieurs à 2^31 centimes : une table de chaque migration tenant, sur les deux moteurs (BIGINT)', () => {
  const BIG = 5000000000;
  const BIG_TTC = 6000000000;

  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(LEDGER_SEED);
    await seedBoth([['fiscal_partners', partnerRow()]]);
  });

  it('v1 : invoices accepte un total TTC de 6 000 000 000 centimes', async () => {
    await seedBoth([['invoices', invoiceRow({ id: 'inv-big', total_ht_cents: BIG, total_vat_cents: 1000000000, total_ttc_cents: BIG_TTC, net_payable_cents: BIG_TTC })]]);
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT total_ttc_cents FROM invoices WHERE id = 'inv-big'`));
    expect(lite).toEqual([{ total_ttc_cents: BIG_TTC }]);
    expect(pg).toEqual(lite);
  });

  it('v2 : pos_tickets accepte un total TTC et un encaissement carte de plus de 2^31 centimes ; pos_sessions un fond de caisse équivalent', async () => {
    await seedBoth([
      ['pos_sessions', posSessionRow({ opening_float_cents: BIG })],
      ['pos_tickets', posTicketRow({ ht_20_cents: BIG, vat_20_cents: 1000000000, total_ttc_cents: BIG_TTC, paid_card_tpe_cents: BIG_TTC })],
    ]);
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT total_ttc_cents, paid_card_tpe_cents FROM pos_tickets`));
    expect(lite).toEqual([{ total_ttc_cents: BIG_TTC, paid_card_tpe_cents: BIG_TTC }]);
    expect(pg).toEqual(lite);
  });

  it('v3 : journal_entries et journal_entry_lines acceptent 5 000 000 000 centimes ; la pièce se scelle en POSTED', async () => {
    await seedBoth(simpleEntry('je-big', 1, 'jrn-vte', 'acc-3421', 'acc-7111', BIG));
    for (const engine of dual.engines()) {
      await engine.run(POST_ENTRY_SQL, postParams('je-big'));
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT total_debit_cents, status FROM journal_entries WHERE id = 'je-big'`));
    expect(lite).toEqual([{ total_debit_cents: BIG, status: 'POSTED' }]);
    expect(pg).toEqual(lite);
    const [liteLine, pgLine] = await dual.onBoth((e) => e.rows(`SELECT debit_cents FROM journal_entry_lines WHERE id = 'je-big-l1'`));
    expect(liteLine).toEqual([{ debit_cents: BIG }]);
    expect(pgLine).toEqual(liteLine);
  });
});
