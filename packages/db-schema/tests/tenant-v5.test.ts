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
import { CHECK_VIOLATION, DualEngines, RAISED, type Engine, type Failure } from './dual-engine.ts';
import { all } from './support.ts';
import {
  archivalRow,
  exemptElementRow,
  fecAuditRow,
  insertSqlite,
  invoiceRow,
  irRemittanceRow,
  LEDGER_SEED,
  NON_INTEGER,
  openTenant,
  partnerRow,
  payrollRow,
  RETENTION_FUTURE,
  RETENTION_PAST,
  sealedArchivalRow,
  simpleEntry,
  subledgerRow,
  transitionAuditRow,
  withholdingRow,
  type RowValues,
} from './tenant-support.ts';

/**
 * Migration tenant v5 (Doc_06 § 06 : sous-livres SIMPL-TVA, loi 69-21, RAS, DRVT, paie 9421, coffre AIP WORM) : chaque règle est
 * prouvée sur SQLite (node:sqlite) ET sur PostgreSQL 16, exécutés réellement, avec le MÊME texte d'erreur (RAISE(ABORT) contre
 * RAISE EXCEPTION, ERRATA D-11). Les migrations v1 à v4 sont immuables : leurs empreintes sont figées ici.
 * L'échéance décennale est lue dans la ligne (`retention_until`), comparée à l'horloge de la base comme le fait Doc_06 :
 * les tests posent des dates passées (2001) et futures (2999), jamais d'horloge simulée.
 */
const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_t5_${randomBytes(6).toString('hex')}`;

const FROZEN_SHA256 = [
  'a554a3477c4d1e3561b81e72e243fc72e2be519d155a3120a497ef0d93a04f61',
  'bfb09b92f078d2796cc62c0604bbc50d9bf3b5f7dffc3539704b564dca15b581',
  '71c6a880b7c231ff3d005d2d1edcee5ca7956e5c9dcf9e2af44a18c8ef7a1138',
  'f1cc97cfc9eff05135df66a7ae30b6eda31535c76a9eaad0d786e58ec1c1d85f',
] as const;
/** Empreinte figée de la v5 : toute modification de son DDL est une nouvelle migration, pas une retouche. */
const V5_SHA256 = 'b6c338fcb3808b9cc210fd73981a3f628e8d7148910de8a2d0c12a77ec1de295';

const MSG_PII_DOWNGRADE = 'VIOLATION_CNDP_LOI_09_08_ART_211: Restriction fiscale irréversible : pii_restricted_flag ne peut pas redescendre de 1 à 0.';
const MSG_WORM_DELETE = 'VIOLATION_SAE_CGI_ART_211: Destruction interdite avant expiration des 10 ans.';
const MSG_WORM_UPDATE = 'VIOLATION_SAE_ISO_14641: Altération interdite sur une unité d archive scellée.';

const V5_TABLES = [
  'tax_and_payment_subledger',
  'withholding_tax_subledger',
  'payroll_annual_subledger',
  'payroll_exempt_elements',
  'payroll_ir_remittances',
  'archival_packages',
  'state_transition_audit',
  'fec_audit_runs',
] as const;
const V5_INDEXES = ['idx_subledger_due_unpaid', 'idx_subledger_timebar'] as const;
const V5_TRIGGERS = ['enforce_10year_worm_retention_delete', 'enforce_10year_worm_retention_update'] as const;

/** Colonnes de Doc_06 § 06, dans l'ordre du DDL ; `pii_restricted_flag` (ERRATA D-19) est ajoutée en dernier. */
const V5_COLUMNS: Readonly<Record<(typeof V5_TABLES)[number], readonly string[]>> = {
  tax_and_payment_subledger: [
    'id', 'invoice_id', 'invoice_entry_id', 'payment_entry_id', 'invoice_date', 'delivery_date', 'legal_due_date', 'payment_date',
    'time_bar_deadline_date', 'dgi_payment_method_id', 'base_ht_cents', 'vat_rate_bps', 'vat_amount_cents', 'total_ttc_cents',
    'deduction_prorata_pct', 'vat_clearing_entry_id', 'simpl_tva_declared_period', 'months_of_delay_6921', 'penalty_6921_cents',
    'law_6921_declared_quarter',
  ],
  withholding_tax_subledger: [
    'id', 'fiscal_year_id', 'partner_id', 'invoice_id', 'direction', 'ras_family', 'leased_property_address_enc', 'tsc_article_number',
    'invoiced_ht_cents', 'paid_base_cents', 'ras_rate_bps', 'ras_amount_cents', 'payment_date', 'dgi_quittance_ref',
    'imputed_on_is_installment',
  ],
  payroll_annual_subledger: [
    'id', 'calendar_year', 'population_category', 'matricule', 'last_name_enc', 'first_name_enc', 'cin_enc', 'cin_bidx',
    'carte_sejour_enc', 'num_ppr_enc', 'num_cnss_enc', 'cnss_bidx', 'family_status', 'dependents_count', 'address_enc', 'hire_date',
    'exit_date', 'worked_days', 'is_sportsman', 'dgi_expense_rate_code', 'base_salary_cents', 'gross_salary_cents',
    'benefits_in_kind_cents', 'allowances_cents', 'exempt_allowances_cents', 'gross_taxable_cents', 'pro_expenses_cents',
    'supplementary_pension_cents', 'social_contributions_cents', 'housing_loan_deduction_cents', 'total_deductions_cents',
    'net_taxable_cents', 'ir_withheld_cents', 'pii_restricted_flag',
  ],
  payroll_exempt_elements: ['id', 'payroll_line_id', 'dgi_nature_code', 'amount_cents'],
  payroll_ir_remittances: [
    'id', 'calendar_year', 'month', 'payment_date', 'payment_method_code', 'dgi_reference', 'quittance_number', 'principal_cents',
    'penalty_cents', 'surcharges_cents', 'total_paid_cents', 'gl_payment_entry_id',
  ],
  archival_packages: [
    'aip_id', 'fiscal_year_id', 'entry_id', 'document_type', 'dgi_clearance_uuid', 'document_ref', 'document_date', 'amount_ttc_cents',
    'r2_object_key', 'morocco_mirror_key', 'payload_sha256', 'encrypted_dek_base64', 'iv_base64', 'merkle_batch_id',
    'merkle_leaf_index', 'merkle_proof_json', 'archived_at', 'retention_until', 'pii_restricted_flag',
  ],
  state_transition_audit: [
    'id', 'entity_table', 'entity_id', 'from_state', 'to_state', 'actor_kind', 'actor_id', 'idempotency_key', 'proof_ref', 'created_at',
  ],
  fec_audit_runs: [
    'id', 'fiscal_year_id', 'score_on_100', 'total_anomalies', 'cash_overflow_count', 'missing_ice_count', 'cadrage_tva_gap_cents',
    'negative_cash_attempts', 'findings_json', 'created_at',
  ],
};

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

const RESET_ALL = `TRUNCATE ${V5_TABLES.join(', ')}, journal_entry_lines, journal_entries, bank_transactions, fixed_assets_register, journals,
  cgnc_accounts, fiscal_years, pos_z_closures, pos_tickets, pos_sessions, invoice_lines, invoice_delivery_links, invoices,
  delivery_notes, purchase_orders, fiscal_partners, tenant_key_grants CASCADE`;

/** Parents des sous-livres : exercice 2026, tiers, facture inv-1 et pièce je-1 (comptes, journaux compris). */
const PARENTS: readonly (readonly [string, RowValues])[] = [
  ...LEDGER_SEED,
  ['fiscal_partners', partnerRow()],
  ['invoices', invoiceRow()],
  ...simpleEntry('je-1', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 120000),
];

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

async function failInsert(engine: Engine, table: string, values: RowValues): Promise<Failure> {
  const { sql, params } = insertSqlite(table, values);
  return engine.fail(sql, params);
}

function expectSame(results: readonly [Failure, Failure], message: string): void {
  expect(results[0].message).toBe(message);
  expect(results[1].message).toBe(message);
  expect(results[0].code).toBeNull();
  expect(results[1].code).toBe(RAISED);
}

/** Cumul 1 vers 0 + règle POSTED/scellé : l'un ou l'autre des deux textes déterministes (l'ordre d'exécution des triggers dépend du moteur). */
function expectEither(results: readonly [Failure, Failure], messages: readonly string[]): void {
  expect(messages).toContain(results[0].message);
  expect(messages).toContain(results[1].message);
  expect(results[0].code).toBeNull();
  expect(results[1].code).toBe(RAISED);
}

async function bothCount(sql: string): Promise<readonly [number, number]> {
  const [lite, pg] = await dual.onBoth((e) => e.rows(sql));
  return [Number(lite[0]?.['n']), Number(pg[0]?.['n'])];
}

function names(db: DatabaseSync, type: 'table' | 'trigger' | 'index'): string[] {
  return all(db, `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`, type).map((row) => String(row['name']));
}

describe('migration v5 : forme, immuabilité de v1 à v4, objets créés', () => {
  const v5 = TENANT_MIGRATIONS[4];

  it('est la cinquième migration ; les empreintes de v1 à v4 sont inchangées (recalculées)', () => {
    // La v6 (correction du pilote sur pii_restricted_flag) s'ajoute après la v5 sans la toucher.
    expect(TENANT_MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(v5?.name).toBe('tenant_part5_subledgers_payroll_9421_archival_worm');
    for (const [index, expected] of FROZEN_SHA256.entries()) {
      const migration = TENANT_MIGRATIONS[index];
      expect(migration?.expectedSha256Hex).toBe(expected);
      expect(createHash('sha256').update(migration?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex'), `v${index + 1}`).toBe(expected);
    }
  });

  it('l\'empreinte de la v5 est celle de upSqlStatements.join("\\n")', () => {
    expect(v5?.expectedSha256Hex).toBe(V5_SHA256);
    expect(createHash('sha256').update(v5?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex')).toBe(v5?.expectedSha256Hex);
  });

  it('crée exactement les 8 tables, les 2 index et les 2 triggers du registre, aucune vue', () => {
    expect(v5?.tableNames).toEqual([...V5_TABLES]);
    expect(v5?.indexNames).toEqual([...V5_INDEXES]);
    expect(v5?.triggerNames).toEqual([...V5_TRIGGERS]);
    expect(v5?.sqliteOnlyTriggerNames ?? []).toEqual([]);
    expect(v5?.viewNames ?? []).toEqual([]);
    expect(TENANT_TABLE_NAMES.slice(-9, -1)).toEqual([...V5_TABLES]);
    expect(TENANT_INDEX_NAMES.slice(-4, -2)).toEqual([...V5_INDEXES]);
    // Les cinq triggers de la v6 puis les trois nouveaux de la v8 suivent ceux de la v5 dans le registre.
    // La v9 ajoute 6 triggers au registre SQLite (4 sous PostgreSQL : deux contrôles de solde de caisse sont des CHECK nommés).
    expect(TENANT_TRIGGER_NAMES.slice(-16, -14)).toEqual([...V5_TRIGGERS]);
    expect(TENANT_POSTGRES_TRIGGER_NAMES.slice(-14, -12)).toEqual([...V5_TRIGGERS]);
  });

  it('la v4 ne crée toujours aucune table ; payroll_annual_subledger et archival_packages naissent en v5', () => {
    expect(TENANT_MIGRATIONS[3]?.tableNames).toEqual([]);
    const tableNames: readonly string[] = TENANT_TABLE_NAMES;
    expect(tableNames).toContain('payroll_annual_subledger');
    expect(tableNames).toContain('archival_packages');
  });

  it('une base v4 pleine se met à niveau sans perte en appliquant seulement la v5', () => {
    const db = openTenant(4);
    expect(names(db, 'table').filter((name) => (V5_TABLES as readonly string[]).includes(name))).toEqual([]);
    const partner = insertSqlite('fiscal_partners', partnerRow());
    db.prepare(partner.sql).run(...partner.params);
    for (const statement of v5?.upSqlStatements ?? []) {
      db.exec(statement);
    }
    expect(names(db, 'table').filter((name) => (V5_TABLES as readonly string[]).includes(name))).toEqual([...V5_TABLES].sort());
    expect(names(db, 'index').filter((name) => name.startsWith('idx_subledger'))).toEqual([...V5_INDEXES]);
    expect(names(db, 'trigger').filter((name) => name.includes('worm'))).toEqual([...V5_TRIGGERS]);
    expect(all(db, 'SELECT COUNT(*) AS n FROM fiscal_partners')).toEqual([{ n: 1 }]);
  });

  it('la traduction PostgreSQL garde une instruction par instruction SQLite, sans INTEGER ni CAST, avec BIGINT', () => {
    if (v5 === undefined) {
      throw new Error('migration v5 absente');
    }
    const statements = tenantMigrationPostgresStatements(v5);
    expect(statements).toHaveLength(v5.upSqlStatements.length);
    expect(statements.join('\n')).not.toMatch(/\bINTEGER\b/);
    expect(statements.join('\n')).not.toMatch(/CAST\(/);
    expect(statements.join('\n')).toContain('BIGINT');
  });

  it('les colonnes de chaque table suivent Doc_06 § 06 dans l\'ordre, sur SQLite et sur PostgreSQL ; aucune colonne REAL, FLOAT ou NUMERIC', async () => {
    const db = openTenant();
    for (const table of V5_TABLES) {
      const lite = all(db, `SELECT name, type FROM pragma_table_info(?) ORDER BY cid`, table);
      expect(lite.map((row) => String(row['name'])), table).toEqual([...V5_COLUMNS[table]]);
      for (const row of lite) {
        expect(['TEXT', 'INTEGER'], `${table}.${String(row['name'])}`).toContain(String(row['type']));
      }
      const pg = await client.query(
        'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
        [SCHEMA, table],
      );
      expect(pg.rows.map((row: { column_name: string }) => row.column_name), table).toEqual([...V5_COLUMNS[table]]);
      for (const row of pg.rows as { column_name: string; data_type: string }[]) {
        expect(['text', 'bigint'], `${table}.${row.column_name}`).toContain(row.data_type);
      }
    }
  });

  it('SQLite et PostgreSQL portent les 2 index nommés (partiels) et exactement les 2 triggers de rétention, sur archival_packages seule', async () => {
    const pgIndexes = await client.query('SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname LIKE $2 ORDER BY indexname', [SCHEMA, 'idx\\_subledger%']);
    expect(pgIndexes.rows.map((row: { indexname: string }) => row.indexname)).toEqual([...V5_INDEXES]);
    for (const row of pgIndexes.rows as { indexdef: string }[]) {
      expect(row.indexdef).toContain('tax_and_payment_subledger');
      expect(row.indexdef).toContain(' WHERE ');
    }
    const liteIndexes = all(openTenant(), `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_subledger%' ORDER BY name`);
    expect(liteIndexes.map((row) => String(row['name']))).toEqual([...V5_INDEXES]);
    for (const row of liteIndexes) {
      expect(String(row['sql'])).toContain(' WHERE ');
    }
    const pgTriggers = await client.query(
      `SELECT t.tgname, c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND NOT t.tgisinternal AND c.relname = ANY($2) AND t.tgname LIKE 'enforce\\_10year%' ORDER BY t.tgname`,
      [SCHEMA, [...V5_TABLES]],
    );
    expect(pgTriggers.rows).toEqual([
      { tgname: 'enforce_10year_worm_retention_delete', relname: 'archival_packages' },
      { tgname: 'enforce_10year_worm_retention_update', relname: 'archival_packages' },
    ]);
    const liteTriggers = all(openTenant(), `SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'enforce_10year%' ORDER BY name`);
    expect(liteTriggers.map((row) => `${String(row['name'])}@${String(row['tbl_name'])}`)).toEqual([
      'enforce_10year_worm_retention_delete@archival_packages',
      'enforce_10year_worm_retention_update@archival_packages',
    ]);
    const others = all(openTenant(), `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name NOT LIKE 'prevent\\_pii\\_flag%' ESCAPE '\\' AND tbl_name IN (${V5_TABLES.filter((t) => t !== 'archival_packages').map(() => '?').join(', ')})`, ...V5_TABLES.filter((t) => t !== 'archival_packages'));
    expect(others).toEqual([{ n: 0 }]);
  });
});

interface Case {
  readonly label: string;
  readonly table: string;
  readonly values: RowValues;
  readonly kind: 'check' | 'integer' | 'unique' | 'fk' | 'notnull';
}

const PAYROLL_X = { id: 'pay-x', matricule: 'M-X' } as const;

const REFUSALS: readonly Case[] = [
  { label: 'taux de TVA 1400', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', vat_rate_bps: 1400 }), kind: 'check' },
  { label: 'taux de TVA 700', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', vat_rate_bps: 700 }), kind: 'check' },
  { label: 'mode de paiement DGI 0', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', dgi_payment_method_id: 0 }), kind: 'check' },
  { label: 'mode de paiement DGI 8', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', dgi_payment_method_id: 8 }), kind: 'check' },
  { label: 'total TTC incohérent', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', total_ttc_cents: 120001 }), kind: 'check' },
  { label: 'prorata 101', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', deduction_prorata_pct: 101 }), kind: 'check' },
  { label: 'prorata -1', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', deduction_prorata_pct: -1 }), kind: 'check' },
  { label: 'prorata fractionnaire (10.5 lié)', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', deduction_prorata_pct: NON_INTEGER }), kind: 'integer' },
  { label: 'montant HT non entier (10.5 lié)', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', base_ht_cents: NON_INTEGER }), kind: 'integer' },
  { label: 'pénalité 6921 textuelle', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', penalty_6921_cents: 'abc' }), kind: 'integer' },
  { label: 'mois de retard non entier (10.5 lié)', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', months_of_delay_6921: NON_INTEGER }), kind: 'integer' },
  { label: 'facture inexistante', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', invoice_id: 'ghost' }), kind: 'fk' },
  { label: 'pièce de facture inexistante', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', invoice_entry_id: 'ghost' }), kind: 'fk' },
  { label: 'pièce de règlement inexistante', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', payment_entry_id: 'ghost' }), kind: 'fk' },
  { label: 'pièce de compensation TVA inexistante', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', vat_clearing_entry_id: 'ghost' }), kind: 'fk' },
  { label: 'date de livraison absente', table: 'tax_and_payment_subledger', values: subledgerRow({ id: 'sub-x', delivery_date: null }), kind: 'notnull' },
  { label: 'sens de RAS inconnu', table: 'withholding_tax_subledger', values: withholdingRow({ id: 'ras-x', direction: 'SIDEWAYS' }), kind: 'check' },
  { label: 'famille de RAS inconnue', table: 'withholding_tax_subledger', values: withholdingRow({ id: 'ras-x', ras_family: 'AUTRE' }), kind: 'check' },
  { label: 'échéance d\'acompte 7', table: 'withholding_tax_subledger', values: withholdingRow({ id: 'ras-x', imputed_on_is_installment: 7 }), kind: 'check' },
  { label: 'échéance d\'acompte 0', table: 'withholding_tax_subledger', values: withholdingRow({ id: 'ras-x', imputed_on_is_installment: 0 }), kind: 'check' },
  { label: 'taux de RAS non entier (10.5 lié)', table: 'withholding_tax_subledger', values: withholdingRow({ id: 'ras-x', ras_rate_bps: NON_INTEGER }), kind: 'integer' },
  { label: 'montant facturé non entier (10.5 lié)', table: 'withholding_tax_subledger', values: withholdingRow({ id: 'ras-x', invoiced_ht_cents: NON_INTEGER }), kind: 'integer' },
  { label: 'base payée textuelle', table: 'withholding_tax_subledger', values: withholdingRow({ id: 'ras-x', paid_base_cents: 'abc' }), kind: 'integer' },
  { label: 'exercice inexistant', table: 'withholding_tax_subledger', values: withholdingRow({ id: 'ras-x', fiscal_year_id: 'ghost' }), kind: 'fk' },
  { label: 'tiers inexistant', table: 'withholding_tax_subledger', values: withholdingRow({ id: 'ras-x', partner_id: 'ghost' }), kind: 'fk' },
  { label: 'facture inexistante (RAS)', table: 'withholding_tax_subledger', values: withholdingRow({ id: 'ras-x', invoice_id: 'ghost' }), kind: 'fk' },
  { label: 'taux de RAS absent', table: 'withholding_tax_subledger', values: withholdingRow({ id: 'ras-x', ras_rate_bps: null }), kind: 'notnull' },
  { label: 'catégorie de population inconnue', table: 'payroll_annual_subledger', values: payrollRow({ ...PAYROLL_X, population_category: 'CADRE' }), kind: 'check' },
  { label: 'situation familiale inconnue', table: 'payroll_annual_subledger', values: payrollRow({ ...PAYROLL_X, family_status: 'X' }), kind: 'check' },
  { label: '7 personnes à charge', table: 'payroll_annual_subledger', values: payrollRow({ ...PAYROLL_X, dependents_count: 7 }), kind: 'check' },
  { label: '0 jour travaillé', table: 'payroll_annual_subledger', values: payrollRow({ ...PAYROLL_X, worked_days: 0 }), kind: 'check' },
  { label: '366 jours travaillés', table: 'payroll_annual_subledger', values: payrollRow({ ...PAYROLL_X, worked_days: 366 }), kind: 'check' },
  { label: 'pii_restricted_flag = 2 (paie)', table: 'payroll_annual_subledger', values: payrollRow({ ...PAYROLL_X, pii_restricted_flag: 2 }), kind: 'check' },
  { label: 'pii_restricted_flag = -1 (paie)', table: 'payroll_annual_subledger', values: payrollRow({ ...PAYROLL_X, pii_restricted_flag: -1 }), kind: 'check' },
  { label: 'salaire de base non entier (10.5 lié)', table: 'payroll_annual_subledger', values: payrollRow({ ...PAYROLL_X, base_salary_cents: NON_INTEGER }), kind: 'integer' },
  { label: 'IR retenu textuel', table: 'payroll_annual_subledger', values: payrollRow({ ...PAYROLL_X, ir_withheld_cents: 'abc' }), kind: 'integer' },
  { label: 'année civile textuelle', table: 'payroll_annual_subledger', values: payrollRow({ ...PAYROLL_X, calendar_year: 'abc' }), kind: 'integer' },
  { label: 'même matricule la même année', table: 'payroll_annual_subledger', values: payrollRow({ id: 'pay-x' }), kind: 'unique' },
  { label: 'prénom chiffré absent', table: 'payroll_annual_subledger', values: payrollRow({ ...PAYROLL_X, first_name_enc: null }), kind: 'notnull' },
  { label: 'élément exonéré à 0', table: 'payroll_exempt_elements', values: exemptElementRow({ id: 'exe-x', amount_cents: 0 }), kind: 'check' },
  { label: 'élément exonéré négatif', table: 'payroll_exempt_elements', values: exemptElementRow({ id: 'exe-x', amount_cents: -1 }), kind: 'check' },
  { label: 'élément exonéré non entier (10.5 lié)', table: 'payroll_exempt_elements', values: exemptElementRow({ id: 'exe-x', amount_cents: NON_INTEGER }), kind: 'integer' },
  { label: 'ligne de paie inexistante', table: 'payroll_exempt_elements', values: exemptElementRow({ id: 'exe-x', payroll_line_id: 'ghost' }), kind: 'fk' },
  { label: 'mois 0', table: 'payroll_ir_remittances', values: irRemittanceRow({ id: 'irr-x', month: 0 }), kind: 'check' },
  { label: 'mois 13', table: 'payroll_ir_remittances', values: irRemittanceRow({ id: 'irr-x', month: 13 }), kind: 'check' },
  { label: 'mode de règlement inconnu', table: 'payroll_ir_remittances', values: irRemittanceRow({ id: 'irr-x', payment_method_code: 'XX' }), kind: 'check' },
  { label: 'total payé incohérent', table: 'payroll_ir_remittances', values: irRemittanceRow({ id: 'irr-x', penalty_cents: 100 }), kind: 'check' },
  { label: 'principal non entier (10.5 lié)', table: 'payroll_ir_remittances', values: irRemittanceRow({ id: 'irr-x', principal_cents: NON_INTEGER }), kind: 'integer' },
  { label: 'majorations textuelles', table: 'payroll_ir_remittances', values: irRemittanceRow({ id: 'irr-x', surcharges_cents: 'abc' }), kind: 'integer' },
  { label: 'pièce de règlement IR inexistante', table: 'payroll_ir_remittances', values: irRemittanceRow({ id: 'irr-x', gl_payment_entry_id: 'ghost' }), kind: 'fk' },
  { label: 'quittance absente', table: 'payroll_ir_remittances', values: irRemittanceRow({ id: 'irr-x', quittance_number: null }), kind: 'notnull' },
  { label: 'type de document AIP inconnu', table: 'archival_packages', values: archivalRow({ aip_id: 'aip-x', r2_object_key: 'r2/x', document_type: 'PDF' }), kind: 'check' },
  { label: 'pii_restricted_flag = 2 (AIP)', table: 'archival_packages', values: archivalRow({ aip_id: 'aip-x', r2_object_key: 'r2/x', pii_restricted_flag: 2 }), kind: 'check' },
  { label: 'pii_restricted_flag = -1 (AIP)', table: 'archival_packages', values: archivalRow({ aip_id: 'aip-x', r2_object_key: 'r2/x', pii_restricted_flag: -1 }), kind: 'check' },
  { label: 'montant TTC du paquet non entier (10.5 lié)', table: 'archival_packages', values: archivalRow({ aip_id: 'aip-x', r2_object_key: 'r2/x', amount_ttc_cents: NON_INTEGER }), kind: 'integer' },
  { label: 'indice de feuille Merkle textuel', table: 'archival_packages', values: archivalRow({ aip_id: 'aip-x', r2_object_key: 'r2/x', merkle_leaf_index: 'abc' }), kind: 'integer' },
  { label: 'clé R2 en doublon', table: 'archival_packages', values: archivalRow({ aip_id: 'aip-x' }), kind: 'unique' },
  { label: 'exercice inexistant (AIP)', table: 'archival_packages', values: archivalRow({ aip_id: 'aip-x', r2_object_key: 'r2/x', fiscal_year_id: 'ghost' }), kind: 'fk' },
  { label: 'pièce inexistante (AIP)', table: 'archival_packages', values: archivalRow({ aip_id: 'aip-x', r2_object_key: 'r2/x', entry_id: 'ghost' }), kind: 'fk' },
  { label: 'échéance de rétention absente', table: 'archival_packages', values: archivalRow({ aip_id: 'aip-x', r2_object_key: 'r2/x', retention_until: null }), kind: 'notnull' },
  { label: 'clé d\'idempotence en doublon', table: 'state_transition_audit', values: transitionAuditRow({ id: 'sta-x' }), kind: 'unique' },
  { label: 'état de destination absent', table: 'state_transition_audit', values: transitionAuditRow({ id: 'sta-x', idempotency_key: 'idem-x', to_state: null }), kind: 'notnull' },
  { label: 'score 101', table: 'fec_audit_runs', values: fecAuditRow({ id: 'fec-x', score_on_100: 101 }), kind: 'check' },
  { label: 'score -1', table: 'fec_audit_runs', values: fecAuditRow({ id: 'fec-x', score_on_100: -1 }), kind: 'check' },
  { label: 'écart de cadrage TVA non entier (10.5 lié)', table: 'fec_audit_runs', values: fecAuditRow({ id: 'fec-x', cadrage_tva_gap_cents: NON_INTEGER }), kind: 'integer' },
  { label: 'anomalies textuelles', table: 'fec_audit_runs', values: fecAuditRow({ id: 'fec-x', total_anomalies: 'abc' }), kind: 'integer' },
  { label: 'exercice inexistant (audit FEC)', table: 'fec_audit_runs', values: fecAuditRow({ id: 'fec-x', fiscal_year_id: 'ghost' }), kind: 'fk' },
];

const LITE_PATTERN = {
  check: /CHECK constraint failed/,
  integer: /CHECK constraint failed/,
  unique: /UNIQUE constraint failed/,
  fk: /FOREIGN KEY constraint failed/,
  notnull: /NOT NULL constraint failed/,
} as const;
/** Colonne BIGINT : le type refuse lui-même une valeur non entière (22P02) ; le CHECK d'entier n'existe que sous SQLite. */
const PG_CODE = { check: CHECK_VIOLATION, integer: '22P02', unique: '23505', fk: '23503', notnull: '23502' } as const;

const SEED_V5: readonly (readonly [string, RowValues])[] = [
  ['tax_and_payment_subledger', subledgerRow()],
  ['withholding_tax_subledger', withholdingRow()],
  ['payroll_annual_subledger', payrollRow()],
  ['payroll_exempt_elements', exemptElementRow()],
  ['payroll_ir_remittances', irRemittanceRow()],
  ['archival_packages', archivalRow()],
  ['state_transition_audit', transitionAuditRow()],
  ['fec_audit_runs', fecAuditRow()],
];

describe('tables de la v5 : mêmes refus (CHECK, entier, UNIQUE, FK, NOT NULL) sur SQLite et PostgreSQL 16', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(PARENTS);
    await seedBoth(SEED_V5);
  });

  it('les lignes valides sont relues à l\'identique sur les deux moteurs ; taux 2000, 1000 et 0 et prorata 0 et 100 acceptés', async () => {
    const extra: readonly (readonly [string, RowValues])[] = [
      ['tax_and_payment_subledger', subledgerRow({ id: 'sub-10', vat_rate_bps: 1000, vat_amount_cents: 10000, total_ttc_cents: 110000, deduction_prorata_pct: 0 })],
      ['tax_and_payment_subledger', subledgerRow({ id: 'sub-0', vat_rate_bps: 0, vat_amount_cents: 0, total_ttc_cents: 100000, deduction_prorata_pct: 100 })],
    ];
    await seedBoth(extra);
    for (const table of V5_TABLES) {
      const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT * FROM ${table} ORDER BY 1`));
      expect(lite.length, table).toBeGreaterThan(0);
      expect(pg, table).toEqual(lite);
    }
    const [lite] = await dual.onBoth((e) => e.rows(`SELECT id, vat_rate_bps, deduction_prorata_pct FROM tax_and_payment_subledger ORDER BY id`));
    expect(lite.map((row) => `${String(row['id'])}:${String(row['vat_rate_bps'])}:${String(row['deduction_prorata_pct'])}`)).toEqual(['sub-0:0:100', 'sub-1:2000:100', 'sub-10:1000:0']);
  });

  it.each(REFUSALS.map((c) => [c.label, c] as const))('refus identique : %s', async (_label, refusal) => {
    const [lite, pg] = await dual.onBoth((e) => failInsert(e, refusal.table, refusal.values));
    expect(lite.message).toMatch(LITE_PATTERN[refusal.kind]);
    expect(pg.code).toBe(PG_CODE[refusal.kind]);
  });

  it('un montant supérieur à 2^31 centimes est accepté sur les deux moteurs (BIGINT) dans chaque table de la v5 portant des montants', async () => {
    const big = 5000000000;
    const rows: readonly (readonly [string, RowValues, string, string])[] = [
      ['tax_and_payment_subledger', subledgerRow({ id: 'sub-big', base_ht_cents: 4000000000, vat_amount_cents: 1000000000, total_ttc_cents: big }), 'total_ttc_cents', 'id'],
      ['withholding_tax_subledger', withholdingRow({ id: 'ras-big', invoiced_ht_cents: big, ras_amount_cents: big }), 'ras_amount_cents', 'id'],
      ['payroll_annual_subledger', payrollRow({ id: 'pay-big', matricule: 'M-BIG', gross_salary_cents: big }), 'gross_salary_cents', 'id'],
      ['payroll_exempt_elements', exemptElementRow({ id: 'exe-big', amount_cents: big }), 'amount_cents', 'id'],
      ['payroll_ir_remittances', irRemittanceRow({ id: 'irr-big', principal_cents: big, total_paid_cents: big }), 'total_paid_cents', 'id'],
      ['archival_packages', archivalRow({ aip_id: 'aip-big', r2_object_key: 'r2/big', amount_ttc_cents: big }), 'amount_ttc_cents', 'aip_id'],
      ['fec_audit_runs', fecAuditRow({ id: 'fec-big', cadrage_tva_gap_cents: big }), 'cadrage_tva_gap_cents', 'id'],
    ];
    for (const [table, values, column, key] of rows) {
      await seedBoth([[table, values]]);
      const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT ${column} FROM ${table} WHERE ${key} = '${String(values[key])}'`));
      expect(lite, table).toEqual([{ [column]: big }]);
      expect(pg, table).toEqual(lite);
    }
  });

  it('une ligne de paie dépend de payroll_exempt_elements par clé étrangère ; aucun trigger sur les 7 autres tables', async () => {
    const [lite, pg] = await dual.onBoth((e) => e.fail(`DELETE FROM payroll_annual_subledger WHERE id = 'pay-1'`));
    expect(lite.message).toMatch(/FOREIGN KEY constraint failed/);
    expect(pg.code).toBe('23503');
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE tax_and_payment_subledger SET months_of_delay_6921 = 2 WHERE id = 'sub-1'`);
      await engine.run(`DELETE FROM tax_and_payment_subledger WHERE id = 'sub-1'`);
      await engine.run(`DELETE FROM state_transition_audit WHERE id = 'sta-1'`);
    }
    expect(await bothCount(`SELECT COUNT(*) AS n FROM tax_and_payment_subledger`)).toEqual([0, 0]);
  });
});

async function flags(id: string): Promise<readonly [Record<string, string | number | null>[], Record<string, string | number | null>[]]> {
  return dual.onBoth((e) => e.rows(`SELECT pii_restricted_flag, payload_sha256, merkle_batch_id, document_ref FROM archival_packages WHERE aip_id = '${id}'`));
}

/** Modifications d'UNE colonne (autre que le drapeau) d'un paquet : chacune doit être refusée sur une ligne scellée. */
const OTHER_COLUMN_CHANGES: readonly string[] = [
  `aip_id = 'aip-2'`,
  `fiscal_year_id = 'fy-autre'`,
  `entry_id = 'je-1'`,
  `document_type = 'DRVT_XML'`,
  `dgi_clearance_uuid = 'uuid-1'`,
  `document_ref = 'DOC-AUTRE'`,
  `document_date = '2026-12-31'`,
  `amount_ttc_cents = 1`,
  `r2_object_key = 'r2/autre'`,
  `morocco_mirror_key = 'ma/autre'`,
  `payload_sha256 = '${'b'.repeat(64)}'`,
  `encrypted_dek_base64 = 'YXV0cmU'`,
  `iv_base64 = 'YXV0cmU'`,
  `merkle_batch_id = 'batch-2'`,
  `merkle_batch_id = NULL`,
  `merkle_leaf_index = 7`,
  `merkle_proof_json = '[1]'`,
  `merkle_proof_json = NULL`,
  `archived_at = '2027-01-01T00:00:00Z'`,
  `retention_until = '2001-01-01T00:00:00Z'`,
];

describe('archival_packages : rétention décennale WORM (DELETE) et scellement (UPDATE), pii_restricted_flag monotone', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(PARENTS);
  });

  it('DELETE avant l\'échéance décennale refusé, même texte, scellé ou non ; la ligne reste', async () => {
    await seedBoth([
      ['archival_packages', archivalRow()],
      ['archival_packages', sealedArchivalRow({ aip_id: 'aip-s', r2_object_key: 'r2/s' })],
    ]);
    for (const id of ['aip-1', 'aip-s']) {
      expectSame(await dual.onBoth((e) => e.fail(`DELETE FROM archival_packages WHERE aip_id = '${id}'`)), MSG_WORM_DELETE);
    }
    expect(await bothCount('SELECT COUNT(*) AS n FROM archival_packages')).toEqual([2, 2]);
  });

  it('DELETE avant l\'échéance refusé aussi quand le drapeau DSAR est levé (la restriction ne déverrouille pas la destruction)', async () => {
    await seedBoth([['archival_packages', sealedArchivalRow({ pii_restricted_flag: 1 })]]);
    expectSame(await dual.onBoth((e) => e.fail(`DELETE FROM archival_packages WHERE aip_id = 'aip-1'`)), MSG_WORM_DELETE);
    expect(await bothCount('SELECT COUNT(*) AS n FROM archival_packages')).toEqual([1, 1]);
  });

  it('DELETE après l\'échéance décennale accepté (échéance lue dans la ligne : 2001, déjà passée), scellé, drapeau levé ou non', async () => {
    await seedBoth([
      ['archival_packages', archivalRow({ retention_until: RETENTION_PAST })],
      ['archival_packages', sealedArchivalRow({ aip_id: 'aip-s', r2_object_key: 'r2/s', retention_until: RETENTION_PAST })],
      ['archival_packages', sealedArchivalRow({ aip_id: 'aip-f', r2_object_key: 'r2/f', retention_until: RETENTION_PAST, pii_restricted_flag: 1 })],
      ['archival_packages', archivalRow({ aip_id: 'aip-d', r2_object_key: 'r2/d', retention_until: '2001-01-02' })],
    ]);
    for (const engine of dual.engines()) {
      await engine.run(`DELETE FROM archival_packages WHERE retention_until < '2002'`);
    }
    expect(await bothCount('SELECT COUNT(*) AS n FROM archival_packages')).toEqual([0, 0]);
  });

  it('l\'échéance se lit dans la ligne : une date future (2999) protège, une date passée libère, dans la même base', async () => {
    await seedBoth([
      ['archival_packages', archivalRow({ aip_id: 'aip-old', r2_object_key: 'r2/old', retention_until: RETENTION_PAST })],
      ['archival_packages', archivalRow({ aip_id: 'aip-new', r2_object_key: 'r2/new', retention_until: RETENTION_FUTURE })],
    ]);
    expectSame(await dual.onBoth((e) => e.fail(`DELETE FROM archival_packages WHERE aip_id = 'aip-new'`)), MSG_WORM_DELETE);
    for (const engine of dual.engines()) {
      await engine.run(`DELETE FROM archival_packages WHERE aip_id = 'aip-old'`);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows('SELECT aip_id FROM archival_packages'));
    expect(lite).toEqual([{ aip_id: 'aip-new' }]);
    expect(pg).toEqual(lite);
  });

  it('montée 0 vers 1 du drapeau acceptée sur une ligne scellée, toutes les autres colonnes inchangées', async () => {
    await seedBoth([['archival_packages', sealedArchivalRow()]]);
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE archival_packages SET pii_restricted_flag = 1 WHERE aip_id = 'aip-1'`);
    }
    const [lite, pg] = await flags('aip-1');
    expect(lite).toEqual([{ pii_restricted_flag: 1, payload_sha256: 'a'.repeat(64), merkle_batch_id: 'batch-1', document_ref: 'DOC-0001' }]);
    expect(pg).toEqual(lite);
  });

  it('descente 1 vers 0 refusée sur une ligne scellée, même texte ; le drapeau reste à 1', async () => {
    await seedBoth([['archival_packages', sealedArchivalRow({ pii_restricted_flag: 1 })]]);
    expectEither(await dual.onBoth((e) => e.fail(`UPDATE archival_packages SET pii_restricted_flag = 0 WHERE aip_id = 'aip-1'`)), [MSG_PII_DOWNGRADE, MSG_WORM_UPDATE]);
    expect((await flags('aip-1'))[0][0]?.['pii_restricted_flag']).toBe(1);
    expect((await flags('aip-1'))[1][0]?.['pii_restricted_flag']).toBe(1);
  });

  it('un UPDATE qui ne monte pas le drapeau (0 vers 0, 1 vers 1) est refusé sur une ligne scellée : aucune autre modification n\'est admise', async () => {
    await seedBoth([['archival_packages', sealedArchivalRow()], ['archival_packages', sealedArchivalRow({ aip_id: 'aip-f', r2_object_key: 'r2/f', pii_restricted_flag: 1 })]]);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE archival_packages SET pii_restricted_flag = 0 WHERE aip_id = 'aip-1'`)), MSG_WORM_UPDATE);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE archival_packages SET pii_restricted_flag = 1 WHERE aip_id = 'aip-f'`)), MSG_WORM_UPDATE);
  });

  it('chaque autre colonne, seule, est refusée sur une ligne scellée, même texte (NULL compris) ; la ligne reste intacte', async () => {
    await seedBoth([['archival_packages', sealedArchivalRow()]]);
    for (const change of OTHER_COLUMN_CHANGES) {
      expectSame(await dual.onBoth((e) => e.fail(`UPDATE archival_packages SET ${change} WHERE aip_id = 'aip-1'`)), MSG_WORM_UPDATE);
    }
    const [lite, pg] = await dual.onBoth((e) => e.rows(`SELECT document_ref, merkle_proof_json, merkle_leaf_index, pii_restricted_flag FROM archival_packages`));
    expect(lite).toEqual([{ document_ref: 'DOC-0001', merkle_proof_json: '[]', merkle_leaf_index: '0', pii_restricted_flag: 0 }]);
    expect(pg).toEqual(lite);
  });

  it('montée du drapeau combinée à une autre modification refusée, pour chaque colonne ; le drapeau reste à 0', async () => {
    await seedBoth([['archival_packages', sealedArchivalRow()]]);
    for (const change of OTHER_COLUMN_CHANGES) {
      expectSame(await dual.onBoth((e) => e.fail(`UPDATE archival_packages SET pii_restricted_flag = 1, ${change} WHERE aip_id = 'aip-1'`)), MSG_WORM_UPDATE);
    }
    expect((await flags('aip-1'))[0][0]?.['pii_restricted_flag']).toBe(0);
    expect((await flags('aip-1'))[1][0]?.['pii_restricted_flag']).toBe(0);
  });

  it('une valeur de drapeau hors 0 et 1 est refusée sur une ligne scellée (trigger : pas une montée 0 vers 1) et sur une ligne libre (CHECK)', async () => {
    await seedBoth([['archival_packages', sealedArchivalRow()], ['archival_packages', archivalRow({ aip_id: 'aip-free', r2_object_key: 'r2/free' })]]);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE archival_packages SET pii_restricted_flag = 2 WHERE aip_id = 'aip-1'`)), MSG_WORM_UPDATE);
    const [lite, pg] = await dual.onBoth((e) => e.fail(`UPDATE archival_packages SET pii_restricted_flag = 2 WHERE aip_id = 'aip-free'`));
    expect(lite.message).toMatch(/CHECK constraint failed/);
    expect(pg.code).toBe(CHECK_VIOLATION);
  });

  it('ligne non scellée (merkle_batch_id NULL) : toute modification admise (Doc_06) hors drapeau, monotone (1 vers 0 refusé) ; le scellement lui-même est un UPDATE', async () => {
    await seedBoth([['archival_packages', archivalRow()]]);
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE archival_packages SET pii_restricted_flag = 1 WHERE aip_id = 'aip-1'`);
      await engine.run(`UPDATE archival_packages SET pii_restricted_flag = 1, document_ref = 'DOC-BIS' WHERE aip_id = 'aip-1'`);
      await engine.run(`UPDATE archival_packages SET payload_sha256 = '${'c'.repeat(64)}' WHERE aip_id = 'aip-1'`);
    }
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE archival_packages SET pii_restricted_flag = 0 WHERE aip_id = 'aip-1'`)), MSG_PII_DOWNGRADE);
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE archival_packages SET merkle_batch_id = 'batch-9', merkle_leaf_index = 3, merkle_proof_json = '[]' WHERE aip_id = 'aip-1'`);
    }
    const [lite, pg] = await flags('aip-1');
    expect(lite).toEqual([{ pii_restricted_flag: 1, payload_sha256: 'c'.repeat(64), merkle_batch_id: 'batch-9', document_ref: 'DOC-BIS' }]);
    expect(pg).toEqual(lite);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE archival_packages SET payload_sha256 = '${'d'.repeat(64)}' WHERE aip_id = 'aip-1'`)), MSG_WORM_UPDATE);
  });

  it('un paquet scellé à échéance passée reste immuable par UPDATE (le scellement ne lit pas la rétention) mais se supprime', async () => {
    await seedBoth([['archival_packages', sealedArchivalRow({ retention_until: RETENTION_PAST })]]);
    expectSame(await dual.onBoth((e) => e.fail(`UPDATE archival_packages SET document_ref = 'X' WHERE aip_id = 'aip-1'`)), MSG_WORM_UPDATE);
    for (const engine of dual.engines()) {
      await engine.run(`DELETE FROM archival_packages WHERE aip_id = 'aip-1'`);
    }
    expect(await bothCount('SELECT COUNT(*) AS n FROM archival_packages')).toEqual([0, 0]);
  });
});

describe('payroll_annual_subledger : pii_restricted_flag (Doc_11 § 06), aucun trigger d\'immuabilité défini par Doc_06 § 06', () => {
  beforeEach(async () => {
    await client.query(RESET_ALL);
    dual.resetSqlite();
    await seedBoth(PARENTS);
    await seedBoth([['payroll_annual_subledger', payrollRow()]]);
  });

  it('le drapeau vaut 0 par défaut et se pose à 1 sans autre modification', async () => {
    const [before] = await dual.onBoth((e) => e.rows(`SELECT pii_restricted_flag FROM payroll_annual_subledger`));
    expect(before).toEqual([{ pii_restricted_flag: 0 }]);
    for (const engine of dual.engines()) {
      await engine.run(`UPDATE payroll_annual_subledger SET pii_restricted_flag = 1 WHERE id = 'pay-1'`);
    }
    const [after, pgAfter] = await dual.onBoth((e) => e.rows(`SELECT pii_restricted_flag, matricule FROM payroll_annual_subledger`));
    expect(after).toEqual([{ pii_restricted_flag: 1, matricule: 'M-0001' }]);
    expect(pgAfter).toEqual(after);
  });

  it('une valeur hors 0 et 1 est refusée par le CHECK sur UPDATE, sur les deux moteurs', async () => {
    const [lite, pg] = await dual.onBoth((e) => e.fail(`UPDATE payroll_annual_subledger SET pii_restricted_flag = 2 WHERE id = 'pay-1'`));
    expect(lite.message).toMatch(/CHECK constraint failed/);
    expect(pg.code).toBe(CHECK_VIOLATION);
  });
});
