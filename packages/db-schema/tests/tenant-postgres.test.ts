import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TENANT_INDEX_NAMES,
  TENANT_MIGRATIONS,
  TENANT_TABLE_NAMES,
  TENANT_TRIGGER_NAMES,
  TENANT_VIEW_NAMES,
  tenantMigrationPostgresStatements,
} from '../src/tenant.ts';
import { all, NOW, type Param } from './support.ts';
import {
  accountRow,
  deliveryNoteRow,
  entryLineRow,
  entryRow,
  entryWithLines,
  envelope,
  fiscalYearRow,
  fixedAssetRow,
  GENESIS_HASH,
  grantRow,
  insertPostgres,
  insertRow,
  insertSqlite,
  invoiceLineRow,
  invoiceRow,
  journalRow,
  LEDGER_SEED,
  NON_INTEGER,
  openTenant,
  partnerRow,
  POST_ENTRY_SQL,
  posSessionRow,
  posTicketRow,
  posZClosureRow,
  postParams,
  purchaseOrderRow,
  SHA_A,
  SHA_B,
  simpleEntry,
  type RowValues,
} from './tenant-support.ts';

/**
 * Parité SQLite / PostgreSQL 16 (ERRATA D-11) : Doc_06 § 03 et § 04 ne définissent aucun trigger, la parité des 10 premières
 * tables se prouve par le chargement du DDL PG-compatible (migrations v1 et v2) et par des refus identiques (CHECK, UNIQUE, FK,
 * NOT NULL). La migration v3 (grand livre, Doc_06 § 05) porte 6 triggers et une vue : les triggers PL/pgSQL lèvent le MÊME
 * texte que les RAISE(ABORT) SQLite, la vue rend les mêmes montants. Tout est exécuté réellement sur les DEUX moteurs.
 * Le schéma PostgreSQL est temporaire et supprimé en fin de test.
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
  { label: 'statut de session POS inconnu', table: 'pos_sessions', values: posSessionRow({ id: 'sess-x', status: 'CAISSE_FERMEE' }), expected: CHECK },
  { label: 'fond de caisse négatif', table: 'pos_sessions', values: posSessionRow({ id: 'sess-x', opening_float_cents: -1 }), expected: CHECK },
  { label: 'comptage aveugle négatif', table: 'pos_sessions', values: posSessionRow({ id: 'sess-x', blind_counted_cash_cents: -1 }), expected: CHECK },
  { label: 'fond de caisse non entier (10.5 lié)', table: 'pos_sessions', values: posSessionRow({ id: 'sess-x', opening_float_cents: NON_INTEGER }), expected: NOT_AN_INTEGER },
  { label: 'écart de caisse textuel', table: 'pos_sessions', values: posSessionRow({ id: 'sess-x', cash_variance_cents: 'abc' }), expected: NOT_AN_INTEGER },
  { label: 'caissier absent', table: 'pos_sessions', values: posSessionRow({ id: 'sess-x', cashier_user_id: null }), expected: NOT_NULL },
  { label: 'type de ticket POS inconnu', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', ticket_kind: 'VOID' }), expected: CHECK },
  { label: 'retour sans ticket d\'origine', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', ticket_kind: 'RETURN_REFUND' }), expected: CHECK },
  { label: 'état de conversion B2B inconnu', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', b2b_conversion_state: 'CONVERTI' }), expected: CHECK },
  { label: 'empreinte de ticket en majuscules', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', ticket_sha256: 'B'.repeat(64) }), expected: CHECK },
  { label: 'empreinte de ticket trop courte', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', ticket_sha256: 'abc' }), expected: CHECK },
  { label: 'total TTC de ticket négatif', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', total_ttc_cents: -1 }), expected: CHECK },
  { label: 'montant de ticket non entier (10.5 lié)', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', ht_20_cents: NON_INTEGER }), expected: NOT_AN_INTEGER },
  { label: 'montant de ticket textuel', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', paid_cash_cents: 'abc' }), expected: NOT_AN_INTEGER },
  { label: 'ticket POS en doublon (même id)', table: 'pos_tickets', values: posTicketRow({ terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x' }), expected: UNIQUE },
  { label: 'séquence de terminal dupliquée', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', qr_conversion_token: 'qr-x' }), expected: UNIQUE },
  { label: 'jeton QR en doublon', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X' }), expected: UNIQUE },
  { label: 'session POS inexistante pour un ticket', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', session_id: 'ghost' }), expected: FK },
  { label: 'ticket d\'origine inexistant', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', ticket_kind: 'RETURN_REFUND', origin_ticket_id: 'ghost' }), expected: FK },
  { label: 'facture convertie inexistante', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', converted_invoice_id: 'ghost' }), expected: FK },
  { label: 'signature ECDSA absente', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', ecdsa_signature_b64: null }), expected: NOT_NULL },
  { label: 'hash précédent absent', table: 'pos_tickets', values: posTicketRow({ id: 'tkt-x', terminal_seq_number: 'S-X', qr_conversion_token: 'qr-x', prev_ticket_sha256: null }), expected: NOT_NULL },
  { label: 'seconde clôture Z pour la même session', table: 'pos_z_closures', values: posZClosureRow({ id: 'z-x', closure_number: 2 }), expected: UNIQUE },
  { label: 'numéro de clôture dupliqué par terminal', table: 'pos_z_closures', values: posZClosureRow({ id: 'z-x', session_id: 'sess-2' }), expected: UNIQUE },
  { label: 'empreinte Z trop courte', table: 'pos_z_closures', values: posZClosureRow({ id: 'z-x', session_id: 'sess-2', closure_number: 9, z_sha256: 'abc' }), expected: CHECK },
  { label: 'montant Z non entier (10.5 lié)', table: 'pos_z_closures', values: posZClosureRow({ id: 'z-x', session_id: 'sess-2', closure_number: 9, tpe_gross_cents: NON_INTEGER }), expected: NOT_AN_INTEGER },
  { label: 'numéro de clôture textuel', table: 'pos_z_closures', values: posZClosureRow({ id: 'z-x', session_id: 'sess-2', closure_number: 'abc' }), expected: NOT_AN_INTEGER },
  { label: 'session POS inexistante pour une clôture Z', table: 'pos_z_closures', values: posZClosureRow({ id: 'z-x', session_id: 'ghost', closure_number: 9 }), expected: FK },
  { label: 'empreinte Z précédente absente', table: 'pos_z_closures', values: posZClosureRow({ id: 'z-x', session_id: 'sess-2', closure_number: 9, prev_z_sha256: null }), expected: NOT_NULL },
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
  ['pos_sessions', posSessionRow()],
  ['pos_sessions', posSessionRow({ id: 'sess-2' })],
  ['pos_tickets', posTicketRow()],
  ['pos_z_closures', posZClosureRow()],
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

describe('DDL PostgreSQL 16 des migrations tenant v1, v2 et v3', () => {
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
    const result = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`, [SCHEMA]);
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

describe('caisse POS : aucun trigger défini par Doc_06 § 04, donc aucun créé, sur les deux moteurs', () => {
  it('aucune table POS ne porte de trigger utilisateur, ni sous PostgreSQL ni sous SQLite', async () => {
    const result = await client.query(
      `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND NOT t.tgisinternal AND c.relname LIKE 'pos\\_%'`,
      [SCHEMA],
    );
    expect(result.rowCount).toBe(0);
    expect(all(sqlite, `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name LIKE 'pos\\_%' ESCAPE '\\'`)).toEqual([]);
  });

  it('les trois tables POS existent sur PostgreSQL avec les mêmes statuts de session acceptés que sur SQLite', async () => {
    for (const status of ['SESSION_OUVERTE_ACTIVE', 'COMPTAGE_AVEUGLE_PRE_Z', 'CLOTURE_TICKET_Z_SCELLEE']) {
      const values = posSessionRow({ id: `sess-${status}`, status });
      const lite = insertSqlite('pos_sessions', values);
      const pg = insertPostgres('pos_sessions', values);
      sqlite.prepare(lite.sql).run(...lite.params);
      await client.query(pg.sql, pg.params);
    }
    const pgCount = await client.query(`SELECT COUNT(*)::int AS n FROM pos_sessions WHERE id LIKE 'sess-%\\_%'`);
    expect(pgCount.rows[0]?.n).toBe(3);
  });

  it('un ticket chaîné est relu à l\'identique, hash précédent compris, sur les deux moteurs', async () => {
    const columns = 'id, terminal_seq_number, prev_ticket_sha256, ticket_sha256, ecdsa_signature_b64, total_ttc_cents, b2b_conversion_state';
    const lite = all(sqlite, `SELECT ${columns} FROM pos_tickets`).map((row) => ({ ...row }));
    const pg = await client.query(`SELECT ${columns} FROM pos_tickets`);
    const normalized = pg.rows.map((row: Record<string, string | number>) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && /^\d+$/.test(value) && value.length < 16 ? Number(value) : value])),
    );
    expect(normalized).toEqual(lite);
    expect(lite[0]?.['prev_ticket_sha256']).toBe(SHA_A);
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

// ---------------------------------------------------------------------------
// Grand livre CGNC (migration v3) : mêmes erreurs, mêmes montants sur les deux moteurs
// ---------------------------------------------------------------------------

const MSG_ENTRY_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Écriture validée immuable. Utilisez une contre-passation.';
const MSG_ENTRY_DELETE = 'VIOLATION_PAF_CGI_ART_145: Suppression interdite sur le Grand Livre.';
const MSG_LINE_UPDATE = 'VIOLATION_PAF_CGI_ART_145: Modification de ligne interdite sur pièce POSTED.';
const MSG_LINE_DELETE = 'VIOLATION_PAF_CGI_ART_145: Suppression de ligne interdite sur pièce POSTED.';
const MSG_UNBALANCED = 'CGNC_UNBALANCED_LINES: La somme des lignes ne boucle pas avec le total de la pièce.';
const MSG_MISSING_HASH = 'PAF_MISSING_HASH: Empreinte SHA-256 obligatoire pour sceller en POSTED.';
const MSG_NEGATIVE_CASH = 'CGNC_NEGATIVE_CASH_5161: Décaissement refusé car il rendrait le solde de caisse 5161 créditeur.';
const MSG_DIRECT_POSTED = 'VIOLATION_PAF_CGI_ART_145: Insertion directe au statut POSTED interdite. Créez la pièce en brouillon puis validez-la.';
/** SQLSTATE d'un RAISE EXCEPTION sans code explicite. */
const RAISED = 'P0001';

interface Failure {
  readonly message: string;
  readonly code: string | null;
}

/** Un moteur exécute les mêmes ordres : SQLite (paramètres `?`) ou PostgreSQL (paramètres `$n`). */
interface Engine {
  readonly name: 'sqlite' | 'postgres';
  run(sql: string, params: readonly Param[]): Promise<void>;
  fail(sql: string, params: readonly Param[]): Promise<Failure>;
  rows(sql: string): Promise<Record<string, string | number | null>[]>;
}

function toPg(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${(index += 1)}`);
}

function numeric(rows: readonly Record<string, unknown>[]): Record<string, string | number | null>[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]): [string, string | number | null] => {
        if (value === null) {
          return [key, null];
        }
        if (/(_cents|_bps)$|^cgnc_class$|^n$/.test(key)) {
          return [key, Number(value)];
        }
        return [key, String(value)];
      }),
    ),
  );
}

/** Base SQLite du grand livre, recréée avant chaque test (les triggers de la base partagée ne sont jamais touchés). */
let liteDb: DatabaseSync;

function liteError(sql: string, params: readonly Param[]): string {
  try {
    liteDb.prepare(sql).run(...params);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`SQLite n'a levé aucune erreur pour : ${sql}`);
}

function engines(): readonly Engine[] {
  const lite: Engine = {
    name: 'sqlite',
    run: async (sql, params) => {
      liteDb.prepare(sql).run(...params);
    },
    fail: async (sql, params) => ({ message: liteError(sql, params), code: null }),
    rows: async (sql) => numeric(all(liteDb, sql).map((row) => ({ ...row }))),
  };
  const pg: Engine = {
    name: 'postgres',
    run: async (sql, params) => {
      await client.query(toPg(sql), [...params]);
    },
    fail: async (sql, params) => {
      try {
        await client.query(toPg(sql), [...params]);
      } catch (error) {
        if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
          return { message: error.message, code: error.code };
        }
        throw error;
      }
      throw new Error(`PostgreSQL n'a levé aucune erreur pour : ${sql}`);
    },
    rows: async (sql) => numeric((await client.query(toPg(sql))).rows),
  };
  return [lite, pg];
}

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

/** Exécute le même scénario sur les deux moteurs et rend les deux résultats, SQLite en premier. */
async function onBoth<T>(scenario: (engine: Engine) => Promise<T>): Promise<readonly [T, T]> {
  const [lite, pg] = engines();
  if (lite === undefined || pg === undefined) {
    throw new Error('deux moteurs attendus');
  }
  return [await scenario(lite), await scenario(pg)];
}

const LEDGER_RESET = `TRUNCATE journal_entry_lines, journal_entries, bank_transactions, fixed_assets_register, journals, cgnc_accounts, fiscal_years CASCADE`;

async function resetLedger(): Promise<void> {
  await client.query(LEDGER_RESET);
  liteDb = openTenant();
}

describe('grand livre CGNC : DDL PostgreSQL 16 (triggers PL/pgSQL, vue, index)', () => {
  it('la traduction PG de la v3 garde une instruction par instruction SQLite, sans INTEGER ni CAST', () => {
    const v3 = TENANT_MIGRATIONS[2];
    expect(v3).toBeDefined();
    if (v3 === undefined) {
      return;
    }
    const statements = tenantMigrationPostgresStatements(v3);
    expect(statements).toHaveLength(v3.upSqlStatements.length);
    expect(statements.join('\n')).not.toMatch(/\bINTEGER\b/);
    expect(statements.join('\n')).not.toMatch(/CAST\(/);
    expect(statements.join('\n')).toContain('LANGUAGE plpgsql');
  });

  it('PostgreSQL porte exactement les 6 triggers et la vue du registre ; SQLite aussi', async () => {
    const triggers = await client.query(
      `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND NOT t.tgisinternal ORDER BY t.tgname`,
      [SCHEMA],
    );
    expect(triggers.rows.map((row: { tgname: string }) => row.tgname)).toEqual([...TENANT_TRIGGER_NAMES].sort());
    const views = await client.query(`SELECT table_name FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name`, [SCHEMA]);
    expect(views.rows.map((row: { table_name: string }) => row.table_name)).toEqual([...TENANT_VIEW_NAMES]);
    expect(all(sqlite, `SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`).map((row) => String(row['name']))).toEqual([...TENANT_TRIGGER_NAMES].sort());
    expect(all(sqlite, `SELECT name FROM sqlite_master WHERE type = 'view'`).map((row) => String(row['name']))).toEqual([...TENANT_VIEW_NAMES]);
  });

  it('les colonnes de la vue sont toutes BIGINT ou TEXT sous PostgreSQL (aucun NUMERIC issu de SUM)', async () => {
    const result = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'v_cgnc_trial_balance_6col' ORDER BY ordinal_position`,
      [SCHEMA],
    );
    expect(result.rows.map((row: { column_name: string; data_type: string }) => `${row.column_name}:${row.data_type}`)).toEqual([
      'fiscal_year_id:text',
      'account_number:text',
      'cgnc_class:bigint',
      'opening_debit_cents:bigint',
      'opening_credit_cents:bigint',
      'mvt_debit_cents:bigint',
      'mvt_credit_cents:bigint',
      'total_debit_cents:bigint',
      'total_credit_cents:bigint',
      'net_balance_cents:bigint',
    ]);
  });
});

describe('grand livre CGNC : mêmes refus, mêmes textes d\'erreur sur SQLite et PostgreSQL 16', () => {
  beforeEach(async () => {
    await resetLedger();
    for (const engine of engines()) {
      await insertAll(engine, LEDGER_SEED);
    }
  });

  /** Insère un brouillon équilibré sur les deux moteurs. */
  async function draft(id: string, sequence: number, journal: string, debit: string, credit: string, amount: number, overrides: RowValues = {}): Promise<void> {
    for (const engine of engines()) {
      await insertAll(engine, simpleEntry(id, sequence, journal, debit, credit, amount, overrides));
    }
  }

  async function postOn(engine: Engine, id: string): Promise<void> {
    await engine.run(POST_ENTRY_SQL, postParams(id));
  }

  async function postBoth(id: string): Promise<void> {
    for (const engine of engines()) {
      await postOn(engine, id);
    }
  }

  function expectSame(results: readonly [Failure, Failure], message: string): void {
    expect(results[0].message).toBe(message);
    expect(results[1].message).toBe(message);
    expect(results[0].message).toBe(results[1].message);
    expect(results[0].code).toBeNull();
    expect(results[1].code).toBe(RAISED);
  }

  it('UPDATE d\'une pièce POSTED refusé, même texte', async () => {
    await draft('je-1', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 120000);
    await postBoth('je-1');
    expectSame(await onBoth((e) => e.fail(`UPDATE journal_entries SET entry_date = '2026-12-01' WHERE id = 'je-1'`, [])), MSG_ENTRY_UPDATE);
    expectSame(await onBoth((e) => e.fail(`UPDATE journal_entries SET status = 'DRAFT' WHERE id = 'je-1'`, [])), MSG_ENTRY_UPDATE);
    expectSame(await onBoth((e) => e.fail(`UPDATE journal_entries SET status = 'CONTRE_PASSEE' WHERE id = 'je-1'`, [])), MSG_ENTRY_UPDATE);
    const [lite, pg] = await onBoth((e) => e.rows(`SELECT status, entry_date FROM journal_entries WHERE id = 'je-1'`));
    expect(lite).toEqual([{ status: 'POSTED', entry_date: '2026-11-13' }]);
    expect(pg).toEqual(lite);
  });

  it('DELETE d\'une pièce POSTED refusé, même texte ; un brouillon se supprime', async () => {
    await draft('je-1', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 120000);
    await postBoth('je-1');
    expectSame(await onBoth((e) => e.fail(`DELETE FROM journal_entries WHERE id = 'je-1'`, [])), MSG_ENTRY_DELETE);
    for (const engine of engines()) {
      await insertAll(engine, [['journal_entries', entryRow({ id: 'je-d', sequence_number: 9, entry_reference: 'D-9', status: 'DRAFT' })]]);
      await engine.run(`DELETE FROM journal_entries WHERE id = 'je-d'`, []);
    }
    const [lite, pg] = await onBoth((e) => e.rows('SELECT COUNT(*) AS n FROM journal_entries'));
    expect(lite).toEqual([{ n: 1 }]);
    expect(pg).toEqual(lite);
  });

  it('UPDATE et DELETE d\'une ligne d\'une pièce POSTED refusés, mêmes textes', async () => {
    await draft('je-1', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 120000);
    await postBoth('je-1');
    expectSame(await onBoth((e) => e.fail(`UPDATE journal_entry_lines SET account_id = 'acc-6111' WHERE id = 'je-1-l1'`, [])), MSG_LINE_UPDATE);
    expectSame(await onBoth((e) => e.fail(`UPDATE journal_entry_lines SET pii_restricted_flag = 1 WHERE entry_id = 'je-1'`, [])), MSG_LINE_UPDATE);
    expectSame(await onBoth((e) => e.fail(`DELETE FROM journal_entry_lines WHERE id = 'je-1-l1'`, [])), MSG_LINE_DELETE);
    const [lite, pg] = await onBoth((e) => e.rows(`SELECT COUNT(*) AS n FROM journal_entry_lines WHERE entry_id = 'je-1'`));
    expect(lite).toEqual([{ n: 2 }]);
    expect(pg).toEqual(lite);
  });

  it('les lignes d\'un brouillon restent modifiables et supprimables sur les deux moteurs', async () => {
    await draft('je-d', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 700);
    for (const engine of engines()) {
      await engine.run(`UPDATE journal_entry_lines SET description_enc = 'v1:a:z' WHERE entry_id = 'je-d'`, []);
      await engine.run(`DELETE FROM journal_entry_lines WHERE id = 'je-d-l2'`, []);
    }
    const [lite, pg] = await onBoth((e) => e.rows(`SELECT COUNT(*) AS n FROM journal_entry_lines WHERE entry_id = 'je-d'`));
    expect(lite).toEqual([{ n: 1 }]);
    expect(pg).toEqual(lite);
  });

  it('passage à POSTED d\'une pièce déséquilibrée refusé (débit court, crédit court, sans ligne), même texte', async () => {
    for (const engine of engines()) {
      await insertAll(engine, entryWithLines('je-u', 1, 'jrn-vte', [{ account: 'acc-3421', debit: 120000 }, { account: 'acc-7111', credit: 100000 }], { total_debit_cents: 120000, total_credit_cents: 120000 }));
      await insertAll(engine, entryWithLines('je-v', 2, 'jrn-vte', [{ account: 'acc-3421', debit: 100000 }, { account: 'acc-7111', credit: 120000 }], { total_debit_cents: 120000, total_credit_cents: 120000 }));
      await insertAll(engine, [['journal_entries', entryRow({ id: 'je-w', sequence_number: 3, entry_reference: 'W-3', status: 'DRAFT' })]]);
    }
    for (const id of ['je-u', 'je-v', 'je-w']) {
      expectSame(await onBoth((e) => e.fail(POST_ENTRY_SQL, postParams(id))), MSG_UNBALANCED);
    }
    const [lite, pg] = await onBoth((e) => e.rows(`SELECT status FROM journal_entries ORDER BY id`));
    expect(lite).toEqual([{ status: 'DRAFT' }, { status: 'DRAFT' }, { status: 'DRAFT' }]);
    expect(pg).toEqual(lite);
  });

  it('passage à POSTED sans empreinte SHA-256 refusé (PAF_MISSING_HASH), même texte', async () => {
    await draft('je-h', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 5000);
    expectSame(await onBoth((e) => e.fail(`UPDATE journal_entries SET status = 'POSTED' WHERE id = 'je-h'`, [])), MSG_MISSING_HASH);
    expectSame(await onBoth((e) => e.fail(`UPDATE journal_entries SET status = 'POSTED', entry_hash = ? WHERE id = 'je-h'`, [SHA_B])), MSG_MISSING_HASH);
    expectSame(await onBoth((e) => e.fail(`UPDATE journal_entries SET status = 'POSTED', previous_entry_hash = ? WHERE id = 'je-h'`, [GENESIS_HASH])), MSG_MISSING_HASH);
  });

  it('passage à POSTED qui rendrait la caisse 5161 négative refusé, même texte ; solde nul accepté', async () => {
    await draft('je-in', 1, 'jrn-cai', 'acc-5161', 'acc-3421', 100000);
    await postBoth('je-in');
    await draft('je-big', 2, 'jrn-cai', 'acc-6111', 'acc-5161', 150000);
    expectSame(await onBoth((e) => e.fail(POST_ENTRY_SQL, postParams('je-big'))), MSG_NEGATIVE_CASH);
    await draft('je-ok', 3, 'jrn-cai', 'acc-6111', 'acc-5161', 100000);
    await postBoth('je-ok');
    await draft('je-one', 4, 'jrn-cai', 'acc-6111', 'acc-5161', 1);
    expectSame(await onBoth((e) => e.fail(POST_ENTRY_SQL, postParams('je-one'))), MSG_NEGATIVE_CASH);
    const [lite, pg] = await onBoth((e) => e.rows(`SELECT id, status FROM journal_entries ORDER BY id`));
    expect(lite).toEqual([
      { id: 'je-big', status: 'DRAFT' },
      { id: 'je-in', status: 'POSTED' },
      { id: 'je-ok', status: 'POSTED' },
      { id: 'je-one', status: 'DRAFT' },
    ]);
    expect(pg).toEqual(lite);
  });

  it('INSERT direct au statut POSTED refusé (ERRATA D-03), même texte ; aucune ligne écrite', async () => {
    const values = entryRow({ status: 'POSTED', entry_hash: SHA_B, previous_entry_hash: GENESIS_HASH });
    const results = await onBoth((e) => failInsert(e, 'journal_entries', values));
    expectSame(results, MSG_DIRECT_POSTED);
    const [lite, pg] = await onBoth((e) => e.rows('SELECT COUNT(*) AS n FROM journal_entries'));
    expect(lite).toEqual([{ n: 0 }]);
    expect(pg).toEqual(lite);
  });

  it('flux légitime DRAFT puis REVISEE_CYCLE puis POSTED accepté sur les deux moteurs', async () => {
    await draft('je-ok', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 120000);
    for (const engine of engines()) {
      await engine.run(`UPDATE journal_entries SET status = 'REVISEE_CYCLE' WHERE id = 'je-ok'`, []);
      await postOn(engine, 'je-ok');
    }
    const [lite, pg] = await onBoth((e) => e.rows(`SELECT status, validated_at, entry_hash, previous_entry_hash FROM journal_entries WHERE id = 'je-ok'`));
    expect(lite).toEqual([{ status: 'POSTED', validated_at: NOW, entry_hash: SHA_B, previous_entry_hash: GENESIS_HASH }]);
    expect(pg).toEqual(lite);
  });

  it('contre-passation : nouvelle écriture REVERSAL acceptée ; statut CONTRE_PASSEE refusé par CHECK sur les deux moteurs', async () => {
    await draft('je-in', 1, 'jrn-cai', 'acc-5161', 'acc-3421', 100000);
    await postBoth('je-in');
    for (const engine of engines()) {
      await insertAll(
        engine,
        entryWithLines('je-rev', 2, 'jrn-cai', [{ account: 'acc-3421', debit: 100000 }, { account: 'acc-5161', credit: 100000 }], {
          source_document_type: 'REVERSAL',
          reversal_of_entry_id: 'je-in',
        }),
      );
      await postOn(engine, 'je-rev');
    }
    const [lite, pg] = await onBoth((e) => e.rows(`SELECT id, status, reversal_of_entry_id FROM journal_entries ORDER BY id`));
    expect(lite).toEqual([
      { id: 'je-in', status: 'POSTED', reversal_of_entry_id: null },
      { id: 'je-rev', status: 'POSTED', reversal_of_entry_id: 'je-in' },
    ]);
    expect(pg).toEqual(lite);
    const [liteBad, pgBad] = await onBoth((e) => failInsert(e, 'journal_entries', entryRow({ id: 'je-x', sequence_number: 9, entry_reference: 'X-9', status: 'CONTRE_PASSEE' })));
    expect(liteBad.message).toMatch(/CHECK constraint failed/);
    expect(pgBad.code).toBe('23514');
  });

  it('un brouillon ne passe pas non plus au statut CONTRE_PASSEE : CHECK sur les deux moteurs', async () => {
    await draft('je-d', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 100);
    const [lite, pg] = await onBoth((e) => e.fail(`UPDATE journal_entries SET status = 'CONTRE_PASSEE' WHERE id = 'je-d'`, []));
    expect(lite.message).toMatch(/CHECK constraint failed/);
    expect(pg.code).toBe('23514');
  });

  it('contraintes de table : mêmes refus (CHECK, UNIQUE, FK, entier) sur les deux moteurs', async () => {
    const CHECK_PG = '23514';
    const cases: readonly { readonly label: string; readonly table: string; readonly values: RowValues; readonly sqlite: RegExp; readonly pg: string }[] = [
      { label: 'exercice au statut ARCHIVED', table: 'fiscal_years', values: fiscalYearRow({ id: 'fy-x', code: 'EX-X', status: 'ARCHIVED' }), sqlite: /CHECK constraint failed/, pg: CHECK_PG },
      { label: 'prorata provisoire 10001 bps', table: 'fiscal_years', values: fiscalYearRow({ id: 'fy-x', code: 'EX-X', provisional_vat_prorata_bps: 10001 }), sqlite: /CHECK constraint failed/, pg: CHECK_PG },
      { label: 'code d\'exercice en doublon', table: 'fiscal_years', values: fiscalYearRow({ id: 'fy-x' }), sqlite: /UNIQUE constraint failed/, pg: '23505' },
      { label: 'type de journal inconnu', table: 'journals', values: journalRow({ id: 'j-x', code: 'JX', journal_type: 'PAIE' }), sqlite: /CHECK constraint failed/, pg: CHECK_PG },
      { label: 'classe CGNC 9', table: 'cgnc_accounts', values: accountRow({ id: 'a-x', account_number: '99990000', cgnc_class: 9 }), sqlite: /CHECK constraint failed/, pg: CHECK_PG },
      { label: 'numéro de compte de 3 chiffres', table: 'cgnc_accounts', values: accountRow({ id: 'a-x', account_number: '516' }), sqlite: /CHECK constraint failed/, pg: CHECK_PG },
      { label: 'pièce REVERSAL sans reversal_of_entry_id', table: 'journal_entries', values: entryRow({ id: 'je-x', sequence_number: 9, entry_reference: 'X-9', source_document_type: 'REVERSAL' }), sqlite: /CHECK constraint failed/, pg: CHECK_PG },
      { label: 'total crédit différent du total débit', table: 'journal_entries', values: entryRow({ id: 'je-x', sequence_number: 9, entry_reference: 'X-9', total_credit_cents: 1 }), sqlite: /CHECK constraint failed/, pg: CHECK_PG },
      { label: 'total non entier (10.5 lié)', table: 'journal_entries', values: entryRow({ id: 'je-x', sequence_number: 9, entry_reference: 'X-9', total_debit_cents: NON_INTEGER, total_credit_cents: NON_INTEGER }), sqlite: /CHECK constraint failed/, pg: '22P02' },
      { label: 'pii_restricted_flag = 2 sur une pièce', table: 'journal_entries', values: entryRow({ id: 'je-x', sequence_number: 9, entry_reference: 'X-9', pii_restricted_flag: 2 }), sqlite: /CHECK constraint failed/, pg: CHECK_PG },
      { label: 'référence de pièce en doublon', table: 'journal_entries', values: entryRow({ id: 'je-x', sequence_number: 9, entry_reference: 'DOUBLON' }), sqlite: /UNIQUE constraint failed/, pg: '23505' },
      { label: 'séquence de journal en doublon', table: 'journal_entries', values: entryRow({ id: 'je-x', entry_reference: 'X-9', sequence_number: 1 }), sqlite: /UNIQUE constraint failed/, pg: '23505' },
      { label: 'exercice inexistant', table: 'journal_entries', values: entryRow({ id: 'je-x', sequence_number: 9, entry_reference: 'X-9', fiscal_year_id: 'ghost' }), sqlite: /FOREIGN KEY constraint failed/, pg: '23503' },
      { label: 'ligne au débit et au crédit', table: 'journal_entry_lines', values: entryLineRow({ id: 'jel-x', entry_id: 'je-ref', line_number: 9, debit_cents: 5, credit_cents: 5 }), sqlite: /CHECK constraint failed/, pg: CHECK_PG },
      { label: 'ligne à zéro', table: 'journal_entry_lines', values: entryLineRow({ id: 'jel-x', entry_id: 'je-ref', line_number: 9, debit_cents: 0, credit_cents: 0 }), sqlite: /CHECK constraint failed/, pg: CHECK_PG },
      { label: 'ligne en doublon', table: 'journal_entry_lines', values: entryLineRow({ id: 'jel-x', entry_id: 'je-ref', line_number: 1 }), sqlite: /UNIQUE constraint failed/, pg: '23505' },
      { label: 'ligne sur compte inexistant', table: 'journal_entry_lines', values: entryLineRow({ id: 'jel-x', entry_id: 'je-ref', line_number: 9, account_id: 'ghost' }), sqlite: /FOREIGN KEY constraint failed/, pg: '23503' },
      { label: 'montant de ligne non entier (10.5 lié)', table: 'journal_entry_lines', values: entryLineRow({ id: 'jel-x', entry_id: 'je-ref', line_number: 9, debit_cents: NON_INTEGER }), sqlite: /CHECK constraint failed/, pg: '22P02' },
      { label: 'état de rapprochement inconnu', table: 'bank_transactions', values: { id: 'bt-x', bank_code: 'CIH', statement_date: '2026-11-13', value_date: '2026-11-13', raw_label_enc: 'v1:a:b', amount_cents: 1, reconciliation_state: 'LETTREE' }, sqlite: /CHECK constraint failed/, pg: CHECK_PG },
      { label: 'relevé sur pièce inexistante', table: 'bank_transactions', values: { id: 'bt-x', bank_code: 'CIH', statement_date: '2026-11-13', value_date: '2026-11-13', raw_label_enc: 'v1:a:b', amount_cents: 1, gl_entry_id: 'ghost' }, sqlite: /FOREIGN KEY constraint failed/, pg: '23503' },
      { label: 'immobilisation hors classe 2', table: 'fixed_assets_register', values: fixedAssetRow({ id: 'fa-x', asset_account_number: '61110000' }), sqlite: /CHECK constraint failed/, pg: CHECK_PG },
      { label: 'taux d\'amortissement 10001 bps', table: 'fixed_assets_register', values: fixedAssetRow({ id: 'fa-x', depreciation_rate_bps: 10001 }), sqlite: /CHECK constraint failed/, pg: CHECK_PG },
    ];
    for (const engine of engines()) {
      await insertAll(engine, [
        ['journal_entries', entryRow({ id: 'je-ref', sequence_number: 1, entry_reference: 'DOUBLON', status: 'DRAFT' })],
        ['journal_entry_lines', entryLineRow({ id: 'jel-ref', entry_id: 'je-ref', line_number: 1 })],
      ]);
    }
    for (const testCase of cases) {
      const [lite, pg] = await onBoth((e) => failInsert(e, testCase.table, testCase.values));
      expect(lite.message, `${testCase.label} (SQLite)`).toMatch(testCase.sqlite);
      expect(pg.code, `${testCase.label} (PostgreSQL)`).toBe(testCase.pg);
    }
  });

  it('exercice CLOSED : accepté comme statut sur les deux moteurs ; aucun trigger ne le lit (Doc_06 § 05 n\'en fixe aucun)', async () => {
    for (const engine of engines()) {
      await engine.run(`UPDATE fiscal_years SET status = 'CLOSED' WHERE id = 'fy-2026'`, []);
    }
    const [lite, pg] = await onBoth((e) => e.rows(`SELECT status FROM fiscal_years`));
    expect(lite).toEqual([{ status: 'CLOSED' }]);
    expect(pg).toEqual(lite);
    const source = await client.query(
      `SELECT string_agg(p.prosrc, ' ') AS body FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1`,
      [SCHEMA],
    );
    expect(String(source.rows[0]?.body)).not.toMatch(/fiscal_years/);
  });
});

describe('grand livre CGNC : la vue v_cgnc_trial_balance_6col rend les mêmes montants sur SQLite et PostgreSQL 16', () => {
  beforeEach(async () => {
    await resetLedger();
    for (const engine of engines()) {
      await insertAll(engine, LEDGER_SEED);
    }
  });

  async function seedBalance(engine: Engine): Promise<void> {
    const entries: readonly (readonly [string, number, string, string, string, number, RowValues])[] = [
      ['je-an', 1, 'jrn-an', 'acc-5161', 'acc-1111', 100000, { source_document_type: 'CUTOFF_OD' }],
      ['je-enc', 2, 'jrn-cai', 'acc-5161', 'acc-3421', 120000, { source_document_type: 'PAYMENT' }],
      ['je-ach', 3, 'jrn-cai', 'acc-6111', 'acc-5161', 30000, { source_document_type: 'PAYMENT' }],
    ];
    for (const [id, sequence, journal, debit, credit, amount, overrides] of entries) {
      await insertAll(engine, simpleEntry(id, sequence, journal, debit, credit, amount, overrides));
      await engine.run(POST_ENTRY_SQL, postParams(id));
    }
    await insertAll(
      engine,
      entryWithLines('je-vte', 1, 'jrn-vte', [
        { account: 'acc-3421', debit: 120000 },
        { account: 'acc-7111', credit: 100000 },
        { account: 'acc-4455', credit: 20000 },
      ]),
    );
    await engine.run(POST_ENTRY_SQL, postParams('je-vte'));
    await insertAll(engine, simpleEntry('je-draft', 4, 'jrn-cai', 'acc-6111', 'acc-5161', 99900));
    await insertAll(engine, simpleEntry('je-revise', 5, 'jrn-cai', 'acc-6111', 'acc-5161', 88800, { status: 'REVISEE_CYCLE' }));
  }

  it('mêmes lignes, mêmes montants ; la balance à 6 colonnes est équilibrée sur les deux moteurs', async () => {
    for (const engine of engines()) {
      await seedBalance(engine);
    }
    const [lite, pg] = await onBoth((e) => e.rows('SELECT * FROM v_cgnc_trial_balance_6col ORDER BY account_number'));
    expect(lite).toHaveLength(6);
    expect(pg).toEqual(lite);
    expect(lite.find((row) => row['account_number'] === '51610000')).toEqual({
      fiscal_year_id: 'fy-2026',
      account_number: '51610000',
      cgnc_class: 5,
      opening_debit_cents: 100000,
      opening_credit_cents: 0,
      mvt_debit_cents: 120000,
      mvt_credit_cents: 30000,
      total_debit_cents: 220000,
      total_credit_cents: 30000,
      net_balance_cents: 190000,
    });
    const [liteSum, pgSum] = await onBoth((e) =>
      e.rows(
        `SELECT SUM(opening_debit_cents) AS od, SUM(opening_credit_cents) AS oc, SUM(mvt_debit_cents) AS md, SUM(mvt_credit_cents) AS mc,
                SUM(total_debit_cents) AS td, SUM(total_credit_cents) AS tc, SUM(net_balance_cents) AS net FROM v_cgnc_trial_balance_6col`,
      ),
    );
    const expectedSums = [{ od: '100000', oc: '100000', md: '270000', mc: '270000', td: '370000', tc: '370000', net: '0' }];
    expect(liteSum).toEqual(expectedSums);
    expect(pgSum).toEqual(expectedSums);
  });

  it('la vue est vide tant qu\'aucune pièce n\'est POSTED, sur les deux moteurs', async () => {
    for (const engine of engines()) {
      await insertAll(engine, simpleEntry('je-d', 1, 'jrn-vte', 'acc-3421', 'acc-7111', 5000));
    }
    const [lite, pg] = await onBoth((e) => e.rows('SELECT * FROM v_cgnc_trial_balance_6col'));
    expect(lite).toEqual([]);
    expect(pg).toEqual([]);
  });
});
