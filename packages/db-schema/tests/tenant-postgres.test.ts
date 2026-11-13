import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TENANT_INDEX_NAMES, TENANT_MIGRATIONS, TENANT_TABLE_NAMES, tenantMigrationPostgresStatements } from '../src/tenant.ts';
import { all, type Param } from './support.ts';
import {
  deliveryNoteRow,
  envelope,
  grantRow,
  insertPostgres,
  insertRow,
  insertSqlite,
  invoiceLineRow,
  invoiceRow,
  NON_INTEGER,
  openTenant,
  partnerRow,
  purchaseOrderRow,
  type RowValues,
} from './tenant-support.ts';

/**
 * Parité SQLite / PostgreSQL 16 (ERRATA D-11) : aucun trigger n'est défini par Doc_06 § 03, la parité se prouve donc par
 * le chargement du DDL PG-compatible de ces 7 tables et par des refus identiques (CHECK, UNIQUE, FK, NOT NULL) sur les
 * DEUX moteurs, exécutés réellement. Le schéma PostgreSQL est temporaire et supprimé en fin de test.
 */
const PG_URL = process.env['FISCA_TEST_PG_URL'] ?? 'postgres://fisca@127.0.0.1:54329/postgres';
const SCHEMA = `fisca_t_${randomBytes(6).toString('hex')}`;

const CHECK = { sqlite: /CHECK constraint failed/, pg: '23514' } as const;
const UNIQUE = { sqlite: /UNIQUE constraint failed/, pg: '23505' } as const;
const FK = { sqlite: /FOREIGN KEY constraint failed/, pg: '23503' } as const;
const NOT_NULL = { sqlite: /NOT NULL constraint failed/, pg: '23502' } as const;
/** Colonne BIGINT : le type refuse lui-même une valeur non entière (le CHECK d'entier n'existe que sous SQLite, typage dynamique). */
const NOT_AN_INTEGER = { sqlite: /CHECK constraint failed/, pg: '22P02' } as const;

interface Expectation {
  readonly sqlite: RegExp;
  readonly pg: string;
}

interface Case {
  readonly label: string;
  readonly table: string;
  readonly values: RowValues;
  readonly expected: Expectation;
}

const CASES: readonly Case[] = [
  { label: 'statut de commande inconnu', table: 'purchase_orders', values: purchaseOrderRow({ id: 'po-x', po_number: 'PO-X', status: 'DRAFT' }), expected: CHECK },
  { label: 'taux de TVA 1400', table: 'invoice_lines', values: invoiceLineRow({ id: 'line-x', line_number: 9, vat_rate_bps: 1400 }), expected: CHECK },
  { label: 'taux de TVA 700', table: 'invoice_lines', values: invoiceLineRow({ id: 'line-x', line_number: 9, vat_rate_bps: 700 }), expected: CHECK },
  { label: 'type UBL inconnu', table: 'invoices', values: invoiceRow({ id: 'inv-x', ubl_type_code: '388_AUTRE' }), expected: CHECK },
  { label: 'avoir sans facture d\'origine', table: 'invoices', values: invoiceRow({ id: 'inv-x', ubl_type_code: '381_AVOIR' }), expected: CHECK },
  { label: 'total TTC incohérent', table: 'invoices', values: invoiceRow({ id: 'inv-x', total_ttc_cents: 120001 }), expected: CHECK },
  { label: 'montant négatif', table: 'invoices', values: invoiceRow({ id: 'inv-x', paid_cents: -1 }), expected: CHECK },
  { label: 'montant non entier (10.5 lié)', table: 'invoices', values: invoiceRow({ id: 'inv-x', total_ht_cents: NON_INTEGER }), expected: NOT_AN_INTEGER },
  { label: 'montant textuel', table: 'purchase_orders', values: purchaseOrderRow({ id: 'po-x', po_number: 'PO-X', total_ht_cents: 'abc' }), expected: NOT_AN_INTEGER },
  { label: 'pii_restricted_flag = 2', table: 'invoices', values: invoiceRow({ id: 'inv-x', pii_restricted_flag: 2 }), expected: CHECK },
  { label: 'rôle de grant inconnu', table: 'tenant_key_grants', values: grantRow({ grant_id: 'g-x', grantee_role: 'ROOT' }), expected: CHECK },
  { label: 'version de DEK ≠ en-tête de l\'enveloppe', table: 'tenant_key_grants', values: grantRow({ grant_id: 'g-x', dek_version: 2 }), expected: CHECK },
  { label: 'index de part Shamir 4', table: 'tenant_key_grants', values: grantRow({ grant_id: 'g-x', dek_version: 3, wrapped_dek_b64: envelope(3, 'a'), wrapped_bidx_key_b64: envelope(3, 'b'), shamir_share_index: 4 }), expected: CHECK },
  { label: 'même version de DEK deux fois pour le même acteur', table: 'tenant_key_grants', values: grantRow({ grant_id: 'g-x' }), expected: UNIQUE },
  { label: 'ice_bidx en doublon', table: 'fiscal_partners', values: partnerRow({ id: 'partner-x', ice_bidx: 'a'.repeat(32) }), expected: UNIQUE },
  { label: 'numéro séquentiel en doublon', table: 'invoices', values: invoiceRow({ id: 'inv-x', sequential_number: 'FA-2026-0001' }), expected: UNIQUE },
  { label: 'ligne de facture en doublon', table: 'invoice_lines', values: invoiceLineRow({ id: 'line-x' }), expected: UNIQUE },
  { label: 'tiers inexistant', table: 'invoices', values: invoiceRow({ id: 'inv-x', partner_id: 'ghost' }), expected: FK },
  { label: 'facture inexistante', table: 'invoice_lines', values: invoiceLineRow({ id: 'line-x', line_number: 9, invoice_id: 'ghost' }), expected: FK },
  { label: 'bon de livraison inexistant', table: 'invoice_delivery_links', values: { invoice_id: 'inv-1', delivery_note_id: 'ghost' }, expected: FK },
  { label: 'raison sociale chiffrée absente', table: 'fiscal_partners', values: partnerRow({ id: 'partner-x', legal_name_enc: null }), expected: NOT_NULL },
];

const GOOD_ROWS: readonly (readonly [string, RowValues])[] = [
  ['fiscal_partners', partnerRow({ ice_bidx: 'a'.repeat(32) })],
  ['tenant_key_grants', grantRow()],
  ['purchase_orders', purchaseOrderRow()],
  ['delivery_notes', deliveryNoteRow()],
  ['invoices', invoiceRow({ sequential_number: 'FA-2026-0001' })],
  ['invoice_delivery_links', { invoice_id: 'inv-1', delivery_note_id: 'bl-1' }],
  ['invoice_lines', invoiceLineRow()],
];

let client: Client;
let sqlite: DatabaseSync;

async function pgError(sql: string, params: readonly Param[]): Promise<string> {
  try {
    await client.query(sql, [...params]);
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      return error.code;
    }
    throw error;
  }
  throw new Error(`PostgreSQL n'a levé aucune erreur pour : ${sql}`);
}

function sqliteError(sql: string, params: readonly Param[]): string {
  try {
    sqlite.prepare(sql).run(...params);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`SQLite n'a levé aucune erreur pour : ${sql}`);
}

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
  sqlite = openTenant();
  for (const [table, values] of GOOD_ROWS) {
    insertRow(sqlite, table, values);
    const { sql, params } = insertPostgres(table, values);
    await client.query(sql, params);
  }
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  const remaining = await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [SCHEMA]);
  await client.end();
  expect(remaining.rowCount).toBe(0);
});

describe('DDL PostgreSQL 16 de la migration tenant v1', () => {
  it('la traduction est déterministe, sans CAST d\'entier ni type INTEGER 32 bits', () => {
    for (const migration of TENANT_MIGRATIONS) {
      const statements = tenantMigrationPostgresStatements(migration);
      expect(statements).toEqual(tenantMigrationPostgresStatements(migration));
      expect(statements).toHaveLength(migration.upSqlStatements.length);
      const joined = statements.join('\n');
      expect(joined).not.toMatch(/\bINTEGER\b/);
      expect(joined).not.toMatch(/CAST\(/);
      expect(joined).toContain('BIGINT');
    }
  });

  it('les mêmes tables existent dans le schéma temporaire PostgreSQL', async () => {
    const result = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name', [SCHEMA]);
    expect(result.rows.map((row: { table_name: string }) => row.table_name)).toEqual([...TENANT_TABLE_NAMES].sort());
  });

  it('les mêmes index nommés existent', async () => {
    const result = await client.query('SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname LIKE $2 ORDER BY indexname', [SCHEMA, 'idx\\_%']);
    expect(result.rows.map((row: { indexname: string }) => row.indexname)).toEqual([...TENANT_INDEX_NAMES].sort());
  });

  it('les mêmes colonnes dans le même ordre, avec les mêmes nullités', async () => {
    for (const table of TENANT_TABLE_NAMES) {
      const pg = await client.query(
        'SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
        [SCHEMA, table],
      );
      const lite = all(sqlite, `SELECT name, "notnull" AS not_null, pk FROM pragma_table_info(?) ORDER BY cid`, table);
      expect(pg.rows.map((row: { column_name: string }) => row.column_name), table).toEqual(lite.map((row) => String(row['name'])));
      pg.rows.forEach((row: { is_nullable: string }, index) => {
        const liteRow = lite[index];
        if (Number(liteRow?.['pk']) === 0) {
          expect(row.is_nullable === 'NO', `${table}.${String(liteRow?.['name'])}`).toBe(Number(liteRow?.['not_null']) === 1);
        }
      });
    }
  });

  it('aucune colonne numeric, real ou double precision ; seulement text et bigint', async () => {
    const result = await client.query('SELECT DISTINCT data_type FROM information_schema.columns WHERE table_schema = $1 ORDER BY data_type', [SCHEMA]);
    expect(result.rows.map((row: { data_type: string }) => row.data_type)).toEqual(['bigint', 'text']);
  });
});

describe('mêmes refus sur les deux moteurs (mêmes lignes, mêmes contraintes)', () => {
  it.each(CASES)('$label : refusé par SQLite ET par PostgreSQL', async ({ table, values, expected }) => {
    const lite = insertSqlite(table, values);
    const pg = insertPostgres(table, values);
    expect(sqliteError(lite.sql, lite.params)).toMatch(expected.sqlite);
    expect(await pgError(pg.sql, pg.params)).toBe(expected.pg);
  });

  it('les lignes valides sont relues à l\'identique sur les deux moteurs', async () => {
    const columns = 'id, direction, ubl_type_code, total_ht_cents, total_ttc_cents, clearance_state, pii_restricted_flag, bam_exchange_rate_micro';
    const lite = all(sqlite, `SELECT ${columns} FROM invoices`).map((row) => ({ ...row }));
    const pg = await client.query(`SELECT ${columns} FROM invoices`);
    const normalized = pg.rows.map((row: Record<string, string | number>) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value])),
    );
    expect(normalized).toEqual(lite);
  });

  it('un montant supérieur à 2^31 centimes est accepté sur les deux moteurs (BIGINT, pas INTEGER 32 bits)', async () => {
    const values = invoiceRow({ id: 'inv-big', total_ht_cents: 5000000000, total_vat_cents: 1000000000, total_ttc_cents: 6000000000, net_payable_cents: 6000000000 });
    const lite = insertSqlite('invoices', values);
    const pg = insertPostgres('invoices', values);
    sqlite.prepare(lite.sql).run(...lite.params);
    await client.query(pg.sql, pg.params);
    const pgRow = await client.query('SELECT total_ttc_cents FROM invoices WHERE id = $1', ['inv-big']);
    expect(String(pgRow.rows[0]?.total_ttc_cents)).toBe('6000000000');
    expect(String(all(sqlite, `SELECT total_ttc_cents FROM invoices WHERE id = 'inv-big'`)[0]?.['total_ttc_cents'])).toBe('6000000000');
  });

  it('une deuxième version de DEK pour le même acteur est acceptée sur les deux moteurs', async () => {
    const values = grantRow({ grant_id: 'g-v2', dek_version: 2, wrapped_dek_b64: envelope(2, 'ZGVrMg'), wrapped_bidx_key_b64: envelope(2, 'YmlkeDI') });
    const lite = insertSqlite('tenant_key_grants', values);
    const pg = insertPostgres('tenant_key_grants', values);
    sqlite.prepare(lite.sql).run(...lite.params);
    await client.query(pg.sql, pg.params);
    const count = await client.query('SELECT COUNT(*)::int AS n FROM tenant_key_grants');
    expect(count.rows[0]?.n).toBe(2);
    expect(all(sqlite, 'SELECT COUNT(*) AS n FROM tenant_key_grants')).toEqual([{ n: 2 }]);
  });
});
