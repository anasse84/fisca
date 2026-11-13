import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  POS_B2B_CONVERSION_STATES,
  POS_SESSION_STATUSES,
  POS_TICKET_KINDS,
  TENANT_INDEX_NAMES,
  TENANT_MIGRATIONS,
  TENANT_TABLE_NAMES,
} from '../src/tenant.ts';
import { all, expectSqlError } from './support.ts';
import {
  insertRow,
  insertSqlite,
  invoiceRow,
  NON_INTEGER,
  openTenant,
  partnerRow,
  posSessionRow,
  posTicketRow,
  posZClosureRow,
  SHA_A,
  SHA_B,
  SHA_C,
  type RowValues,
} from './tenant-support.ts';

const CHECK_FAILED = /CHECK constraint failed/;
const UNIQUE_FAILED = /UNIQUE constraint failed/;
const FK_FAILED = /FOREIGN KEY constraint failed/;
const NOT_NULL_FAILED = /NOT NULL constraint failed/;

const POS_TABLES = ['pos_sessions', 'pos_tickets', 'pos_z_closures'] as const;
/** Empreinte de la migration v1, figée par le ticket T-S1B-02 : une migration appliquée ne change jamais. */
const MIGRATION_1_SHA256 = 'a554a3477c4d1e3561b81e72e243fc72e2be519d155a3120a497ef0d93a04f61';

function reject(db: DatabaseSync, table: string, values: RowValues, pattern: RegExp): void {
  const { sql, params } = insertSqlite(table, values);
  expectSqlError(db, sql, params, pattern);
}

function withSession(): DatabaseSync {
  const db = openTenant();
  insertRow(db, 'pos_sessions', posSessionRow());
  return db;
}

function names(db: DatabaseSync, type: string): string[] {
  return all(db, `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`, type).map((row) => String(row['name']));
}

describe('migration v2 : caisse Fisca POS (Doc_06 § 04)', () => {
  const v2 = TENANT_MIGRATIONS[1];

  it('est la deuxième migration, après la v1, et crée exactement 3 tables dans l\'ordre des clés étrangères', () => {
    expect(TENANT_MIGRATIONS.map((m) => m.version).slice(0, 2)).toEqual([1, 2]);
    expect(v2?.name).toBe('tenant_part2_pos_sessions_tickets_z');
    expect(v2?.tableNames).toEqual([...POS_TABLES]);
    expect(v2?.indexNames).toEqual([]);
    expect(TENANT_TABLE_NAMES.slice(7, 10)).toEqual([...POS_TABLES]);
  });

  it('empreinte SHA-256 recalculée identique à celle déclarée, pour la v1 comme pour la v2', () => {
    for (const migration of TENANT_MIGRATIONS) {
      const digest = createHash('sha256').update(migration.upSqlStatements.join('\n'), 'utf8').digest('hex');
      expect(digest, `migration v${migration.version}`).toBe(migration.expectedSha256Hex);
    }
  });

  it('la migration v1 est inchangée : empreinte identique à celle de T-S1B-02', () => {
    expect(TENANT_MIGRATIONS[0]?.expectedSha256Hex).toBe(MIGRATION_1_SHA256);
    const digest = createHash('sha256').update(TENANT_MIGRATIONS[0]?.upSqlStatements.join('\n') ?? '', 'utf8').digest('hex');
    expect(digest).toBe(MIGRATION_1_SHA256);
    expect(TENANT_MIGRATIONS[0]?.tableNames).toHaveLength(7);
  });

  it('crée les 3 tables sur SQLite, sans index nommé, sans vue et sans trigger (Doc_06 § 04 n\'en définit aucun)', () => {
    const db = openTenant(2);
    for (const table of POS_TABLES) {
      expect(names(db, 'table')).toContain(table);
    }
    expect(names(db, 'trigger')).toEqual([]);
    expect(names(db, 'view')).toEqual([]);
    expect(TENANT_MIGRATIONS[1]?.indexNames).toEqual([]);
    expect(TENANT_INDEX_NAMES.slice(0, 3)).toEqual(['idx_partners_ice_bidx', 'idx_invoices_dedup_bidx', 'idx_inv_partner_date_dir']);
  });

  it('une base v1 se met à niveau en appliquant seulement la v2 (les 7 tables de la v1 restent)', () => {
    const db = openTenant(1);
    expect(names(db, 'table')).toHaveLength(7);
    for (const statement of TENANT_MIGRATIONS[1]?.upSqlStatements ?? []) {
      db.exec(statement);
    }
    expect(names(db, 'table')).toHaveLength(10);
  });

  it('aucune colonne REAL, FLOAT ou NUMERIC : TEXT et INTEGER seulement', () => {
    const db = openTenant();
    for (const table of POS_TABLES) {
      for (const column of all(db, `SELECT name, type FROM pragma_table_info(?)`, table)) {
        expect(['TEXT', 'INTEGER'], `${table}.${String(column['name'])}`).toContain(String(column['type']));
      }
    }
    expect(v2?.upSqlStatements.join('\n')).not.toMatch(/\b(REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL)\b/i);
  });

  it('aucune colonne taux ni pii_restricted_flag (Doc_06 § 04 ventile par colonnes ; Doc_11 § 06 ne vise pas la caisse)', () => {
    const db = openTenant();
    for (const table of POS_TABLES) {
      const columns = all(db, `SELECT name FROM pragma_table_info(?)`, table).map((row) => String(row['name']));
      expect(columns.filter((c) => /_bps$|pii_restricted_flag/.test(c)), table).toEqual([]);
    }
  });

  it('chaque colonne _cents et closure_number porte le CHECK d\'entier strict', () => {
    const db = openTenant();
    let counted = 0;
    for (const table of POS_TABLES) {
      const ddl = String(all(db, `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, table)[0]?.['sql']);
      for (const row of all(db, `SELECT name FROM pragma_table_info(?)`, table)) {
        const column = String(row['name']);
        if (/_cents$/.test(column) || column === 'closure_number') {
          counted += 1;
          expect(ddl, `${table}.${column}`).toContain(`CHECK (${column} = CAST(${column} AS INTEGER))`);
        }
      }
    }
    expect(counted).toBe(22);
  });
});

describe('pos_sessions : statuts de la machine de Doc_02 § 13 et comptage aveugle', () => {
  it('les 3 statuts persistés sont exactement ceux de Doc_06 § 04', () => {
    expect([...POS_SESSION_STATUSES]).toEqual(['SESSION_OUVERTE_ACTIVE', 'COMPTAGE_AVEUGLE_PRE_Z', 'CLOTURE_TICKET_Z_SCELLEE']);
  });

  it.each(POS_SESSION_STATUSES)('accepte le statut %s', (status) => {
    const db = openTenant();
    insertRow(db, 'pos_sessions', posSessionRow({ status }));
    expect(all(db, 'SELECT status FROM pos_sessions')).toEqual([{ status }]);
  });

  it.each(['CAISSE_FERMEE', 'MODE_OFFLINE_SQLITE_WASM', 'TICKET_SCELLE_SHA256_LOCAL', 'open', ''])('refuse le statut inconnu %j', (status) => {
    reject(openTenant(), 'pos_sessions', posSessionRow({ status }), CHECK_FAILED);
  });

  it('le fond d\'ouverture négatif est refusé, zéro est accepté (garde d\'ouverture)', () => {
    reject(openTenant(), 'pos_sessions', posSessionRow({ opening_float_cents: -1 }), CHECK_FAILED);
    insertRow(openTenant(), 'pos_sessions', posSessionRow({ opening_float_cents: 0 }));
  });

  it('le comptage saisi et le cash attendu sont deux colonnes distinctes ; le comptage est vide à l\'ouverture', () => {
    const db = openTenant();
    insertRow(db, 'pos_sessions', posSessionRow());
    expect(all(db, 'SELECT expected_closing_cash_cents AS expected, blind_counted_cash_cents AS counted, cash_variance_cents AS variance FROM pos_sessions')).toEqual([
      { expected: 0, counted: null, variance: null },
    ]);
  });

  it('un comptage aveugle puis un écart négatif (manquant) ou positif (excédent) sont acceptés', () => {
    const db = openTenant();
    insertRow(db, 'pos_sessions', posSessionRow({ id: 's-short', expected_closing_cash_cents: 50000, blind_counted_cash_cents: 49000, cash_variance_cents: -1000 }));
    insertRow(db, 'pos_sessions', posSessionRow({ id: 's-over', expected_closing_cash_cents: 50000, blind_counted_cash_cents: 50500, cash_variance_cents: 500 }));
    expect(all(db, 'SELECT cash_variance_cents AS v FROM pos_sessions ORDER BY id')).toEqual([{ v: 500 }, { v: -1000 }]);
  });

  it('un comptage ou un cash attendu négatif est refusé (caisse 5161 jamais négative)', () => {
    reject(openTenant(), 'pos_sessions', posSessionRow({ blind_counted_cash_cents: -1 }), CHECK_FAILED);
    reject(openTenant(), 'pos_sessions', posSessionRow({ expected_closing_cash_cents: -1 }), CHECK_FAILED);
  });

  it.each(['opening_float_cents', 'expected_closing_cash_cents', 'blind_counted_cash_cents', 'cash_variance_cents'])(
    'refuse un montant non entier (10.5 lié) ou textuel dans %s',
    (column) => {
      reject(openTenant(), 'pos_sessions', posSessionRow({ [column]: NON_INTEGER }), CHECK_FAILED);
      reject(openTenant(), 'pos_sessions', posSessionRow({ [column]: 'abc' }), CHECK_FAILED);
    },
  );

  it.each(['terminal_id', 'cashier_user_id', 'opened_at', 'status', 'opening_float_cents'])('%s est obligatoire', (column) => {
    reject(openTenant(), 'pos_sessions', posSessionRow({ [column]: null }), NOT_NULL_FAILED);
  });

  it('un identifiant de session en doublon est refusé', () => {
    reject(withSession(), 'pos_sessions', posSessionRow(), /UNIQUE constraint failed|PRIMARY KEY/);
  });
});

describe('pos_tickets : séquence par terminal, chaînage SHA-256, signature ECDSA, conversion B2B', () => {
  it('les colonnes de Doc_06 § 04 sont présentes, plus la signature ECDSA (écart 1)', () => {
    const columns = all(openTenant(), `SELECT name FROM pragma_table_info('pos_tickets') ORDER BY cid`).map((row) => String(row['name']));
    expect(columns).toEqual([
      'id', 'session_id', 'terminal_id', 'terminal_seq_number', 'issued_at', 'ticket_kind', 'origin_ticket_id',
      'ht_20_cents', 'vat_20_cents', 'ht_10_cents', 'vat_10_cents', 'ht_0_cents', 'stamp_duty_cents', 'total_ttc_cents',
      'paid_cash_cents', 'paid_card_tpe_cents', 'paid_delivery_app_cents', 'qr_conversion_token', 'b2b_conversion_state',
      'converted_invoice_id', 'prev_ticket_sha256', 'ticket_sha256', 'ecdsa_signature_b64',
    ]);
  });

  it('un ticket valide s\'insère, avec défauts : montants à 0 et conversion NONE', () => {
    const db = withSession();
    insertRow(db, 'pos_tickets', posTicketRow());
    expect(all(db, 'SELECT b2b_conversion_state AS s, ht_10_cents AS h, stamp_duty_cents AS d, paid_cash_cents AS c FROM pos_tickets')).toEqual([
      { s: 'NONE', h: 0, d: 0, c: 0 },
    ]);
  });

  it.each(POS_TICKET_KINDS)('accepte le type %s', (kind) => {
    const db = withSession();
    insertRow(db, 'pos_tickets', posTicketRow());
    insertRow(db, 'pos_tickets', posTicketRow({ id: 'tkt-k', terminal_seq_number: 'S-K', qr_conversion_token: 'qr-k', ticket_kind: kind, origin_ticket_id: 'tkt-1' }));
  });

  it('refuse un type de ticket inconnu', () => {
    reject(withSession(), 'pos_tickets', posTicketRow({ ticket_kind: 'VOID' }), CHECK_FAILED);
  });

  it('un retour exige le ticket d\'origine ; une vente peut s\'en passer', () => {
    const db = withSession();
    reject(db, 'pos_tickets', posTicketRow({ ticket_kind: 'RETURN_REFUND' }), CHECK_FAILED);
    insertRow(db, 'pos_tickets', posTicketRow());
  });

  it('un ticket d\'origine inexistant est refusé (FK)', () => {
    reject(withSession(), 'pos_tickets', posTicketRow({ ticket_kind: 'RETURN_REFUND', origin_ticket_id: 'ghost' }), FK_FAILED);
  });

  it('une session inexistante est refusée (FK)', () => {
    reject(openTenant(), 'pos_tickets', posTicketRow({ session_id: 'ghost' }), FK_FAILED);
  });

  it('refuse un identifiant de ticket en doublon', () => {
    const db = withSession();
    insertRow(db, 'pos_tickets', posTicketRow());
    reject(db, 'pos_tickets', posTicketRow({ terminal_seq_number: 'S-2', qr_conversion_token: 'qr-2' }), /UNIQUE constraint failed|PRIMARY KEY/);
  });

  it('refuse une séquence dupliquée (terminal_seq_number UNIQUE, le préfixe porte le terminal)', () => {
    const db = withSession();
    insertRow(db, 'pos_tickets', posTicketRow());
    reject(db, 'pos_tickets', posTicketRow({ id: 'tkt-2', qr_conversion_token: 'qr-2' }), UNIQUE_FAILED);
    insertRow(db, 'pos_tickets', posTicketRow({ id: 'tkt-3', terminal_seq_number: 'POS-M01-C03-2026-000001', terminal_id: 'POS-M01-C03', qr_conversion_token: 'qr-3', prev_ticket_sha256: SHA_B, ticket_sha256: SHA_C }));
  });

  it('refuse un jeton de conversion QR en doublon', () => {
    const db = withSession();
    insertRow(db, 'pos_tickets', posTicketRow());
    reject(db, 'pos_tickets', posTicketRow({ id: 'tkt-2', terminal_seq_number: 'S-2' }), UNIQUE_FAILED);
  });

  it.each(POS_B2B_CONVERSION_STATES)('accepte l\'état de conversion %s', (state) => {
    insertRow(withSession(), 'pos_tickets', posTicketRow({ b2b_conversion_state: state }));
  });

  it('refuse un état de conversion inconnu', () => {
    reject(withSession(), 'pos_tickets', posTicketRow({ b2b_conversion_state: 'CONVERTI' }), CHECK_FAILED);
  });

  it('le lien vers la facture B2B suit la FK ; un second ticket ne partage pas la facture sans contrainte propre (UNIQUE côté invoices.pos_ticket_id)', () => {
    const db = withSession();
    insertRow(db, 'fiscal_partners', partnerRow());
    insertRow(db, 'invoices', invoiceRow({ pos_ticket_id: 'tkt-1' }));
    insertRow(db, 'pos_tickets', posTicketRow({ b2b_conversion_state: 'CONVERTI_B2B_AVANT_Z', converted_invoice_id: 'inv-1' }));
    reject(db, 'pos_tickets', posTicketRow({ id: 'tkt-2', terminal_seq_number: 'S-2', qr_conversion_token: 'qr-2', converted_invoice_id: 'ghost' }), FK_FAILED);
    reject(db, 'invoices', invoiceRow({ id: 'inv-2', pos_ticket_id: 'tkt-1' }), UNIQUE_FAILED);
  });

  it.each(['prev_ticket_sha256', 'ticket_sha256', 'ecdsa_signature_b64', 'qr_conversion_token', 'terminal_seq_number', 'total_ttc_cents'])('%s est obligatoire', (column) => {
    reject(withSession(), 'pos_tickets', posTicketRow({ [column]: null }), NOT_NULL_FAILED);
  });

  it.each(['abc', 'A'.repeat(64), 'b'.repeat(63), 'b'.repeat(65), ''])('refuse l\'empreinte de ticket %j (SHA-256 hexadécimal minuscule de 64 caractères)', (hash) => {
    reject(withSession(), 'pos_tickets', posTicketRow({ ticket_sha256: hash }), CHECK_FAILED);
  });

  it('le hash précédent est lié au hash courant d\'un SHA-256 réel : deux tickets chaînés s\'insèrent', () => {
    const db = withSession();
    const first = createHash('sha256').update('ticket-1', 'utf8').digest('hex');
    const second = createHash('sha256').update(`${first}ticket-2`, 'utf8').digest('hex');
    insertRow(db, 'pos_tickets', posTicketRow({ prev_ticket_sha256: SHA_A, ticket_sha256: first }));
    insertRow(db, 'pos_tickets', posTicketRow({ id: 'tkt-2', terminal_seq_number: 'S-2', qr_conversion_token: 'qr-2', prev_ticket_sha256: first, ticket_sha256: second }));
    expect(all(db, `SELECT t2.id AS id FROM pos_tickets t1 JOIN pos_tickets t2 ON t2.prev_ticket_sha256 = t1.ticket_sha256`)).toEqual([{ id: 'tkt-2' }]);
  });

  it('le total TTC négatif est refusé', () => {
    reject(withSession(), 'pos_tickets', posTicketRow({ total_ttc_cents: -1 }), CHECK_FAILED);
  });

  it.each([
    'ht_20_cents', 'vat_20_cents', 'ht_10_cents', 'vat_10_cents', 'ht_0_cents', 'stamp_duty_cents', 'total_ttc_cents',
    'paid_cash_cents', 'paid_card_tpe_cents', 'paid_delivery_app_cents',
  ])('refuse un montant non entier (10.5 lié) ou textuel dans %s', (column) => {
    reject(withSession(), 'pos_tickets', posTicketRow({ [column]: NON_INTEGER }), CHECK_FAILED);
    reject(withSession(), 'pos_tickets', posTicketRow({ [column]: 'abc' }), CHECK_FAILED);
  });
});

describe('pos_z_closures : clôture Z, une par session et un numéro par terminal', () => {
  it('une clôture valide s\'insère', () => {
    const db = withSession();
    insertRow(db, 'pos_z_closures', posZClosureRow());
    expect(all(db, 'SELECT closure_number AS n, gl_journal_entry_id AS gl FROM pos_z_closures')).toEqual([{ n: 1, gl: null }]);
  });

  it('une seconde clôture pour la même session est refusée', () => {
    const db = withSession();
    insertRow(db, 'pos_z_closures', posZClosureRow());
    reject(db, 'pos_z_closures', posZClosureRow({ id: 'z-2', closure_number: 2 }), UNIQUE_FAILED);
  });

  it('un numéro de clôture dupliqué sur le même terminal est refusé, accepté sur un autre terminal', () => {
    const db = withSession();
    insertRow(db, 'pos_sessions', posSessionRow({ id: 'sess-2', terminal_id: 'POS-M01-C03' }));
    insertRow(db, 'pos_sessions', posSessionRow({ id: 'sess-3' }));
    insertRow(db, 'pos_z_closures', posZClosureRow());
    reject(db, 'pos_z_closures', posZClosureRow({ id: 'z-2', session_id: 'sess-3' }), UNIQUE_FAILED);
    insertRow(db, 'pos_z_closures', posZClosureRow({ id: 'z-3', session_id: 'sess-2', terminal_id: 'POS-M01-C03' }));
  });

  it('une session inexistante est refusée (FK)', () => {
    reject(openTenant(), 'pos_z_closures', posZClosureRow({ session_id: 'ghost' }), FK_FAILED);
  });

  it('les nets B2C peuvent être négatifs (retours supérieurs aux ventes)', () => {
    const db = withSession();
    insertRow(db, 'pos_z_closures', posZClosureRow({ net_b2c_ht_20_cents: -5000, net_b2c_vat_20_cents: -1000 }));
  });

  it.each([
    'closure_number', 'net_b2c_ht_20_cents', 'net_b2c_vat_20_cents', 'net_b2c_ht_10_cents', 'net_b2c_vat_10_cents',
    'net_b2c_ht_0_cents', 'total_stamp_duty_cents', 'tpe_gross_cents',
  ])('refuse un montant non entier (10.5 lié) ou textuel dans %s', (column) => {
    reject(withSession(), 'pos_z_closures', posZClosureRow({ [column]: NON_INTEGER }), CHECK_FAILED);
    reject(withSession(), 'pos_z_closures', posZClosureRow({ [column]: 'abc' }), CHECK_FAILED);
  });

  it.each(['abc', 'C'.repeat(64), 'c'.repeat(63), ''])('refuse l\'empreinte Z %j', (hash) => {
    reject(withSession(), 'pos_z_closures', posZClosureRow({ z_sha256: hash }), CHECK_FAILED);
  });

  it.each(['terminal_id', 'closure_number', 'business_date', 'prev_z_sha256', 'z_sha256', 'tpe_gross_cents'])('%s est obligatoire', (column) => {
    reject(withSession(), 'pos_z_closures', posZClosureRow({ [column]: null }), NOT_NULL_FAILED);
  });
});
