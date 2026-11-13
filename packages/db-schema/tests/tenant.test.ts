import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  TENANT_GRANTEE_ROLES,
  TENANT_INDEX_NAMES,
  TENANT_MIGRATIONS,
  TENANT_TABLE_NAMES,
} from '../src/tenant.ts';
import { NOW, all, expectSqlError, run } from './support.ts';
import {
  deliveryNoteRow,
  envelope,
  grantRow,
  insertRow,
  insertSqlite,
  invoiceLineRow,
  invoiceRow,
  NON_INTEGER,
  openTenant,
  partnerRow,
  purchaseOrderRow,
  seedPartnerAndInvoice,
} from './tenant-support.ts';

const PART1_TABLES = [
  'tenant_key_grants',
  'fiscal_partners',
  'purchase_orders',
  'delivery_notes',
  'invoices',
  'invoice_delivery_links',
  'invoice_lines',
] as const;

const CHECK_FAILED = /CHECK constraint failed/;
const UNIQUE_FAILED = /UNIQUE constraint failed/;
const FK_FAILED = /FOREIGN KEY constraint failed/;

function listObjects(db: DatabaseSync, type: 'table' | 'index' | 'trigger' | 'view'): string[] {
  return all(db, `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`, type).map((row) =>
    String(row['name']),
  );
}

function columnsOf(db: DatabaseSync, table: string): { name: string; type: string }[] {
  return all(db, `SELECT name, type FROM pragma_table_info(?) ORDER BY cid`, table).map((row) => ({
    name: String(row['name']),
    type: String(row['type']),
  }));
}

function reject(db: DatabaseSync, table: string, values: Parameters<typeof insertSqlite>[1], pattern: RegExp): void {
  const { sql, params } = insertSqlite(table, values);
  expectSqlError(db, sql, params, pattern);
}

describe('migrations tenant : forme, ordre et immuabilité', () => {
  it('versions strictement croissantes à partir de 1, nommées, sans doublon', () => {
    const versions = TENANT_MIGRATIONS.map((m) => m.version);
    expect(versions[0]).toBe(1);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    for (const migration of TENANT_MIGRATIONS) {
      expect(migration.name.length).toBeGreaterThan(0);
      expect(migration.upSqlStatements.length).toBeGreaterThan(0);
    }
    expect(TENANT_MIGRATIONS[0]?.name).toBe('tenant_part1_keys_partners_clearance');
  });

  it('la somme de contrôle SHA-256 déclarée est celle de upSqlStatements.join("\\n") (calcul de ensureTenantSchemaUpToDate)', () => {
    for (const migration of TENANT_MIGRATIONS) {
      const digest = createHash('sha256').update(migration.upSqlStatements.join('\n'), 'utf8').digest('hex');
      expect(digest, `migration v${migration.version} (${migration.name}) altérée`).toBe(migration.expectedSha256Hex);
    }
  });

  it('chaque instruction est une instruction unique (un seul point-virgule final autorisé ; un trigger porte ses instructions entre BEGIN et END)', () => {
    for (const migration of TENANT_MIGRATIONS) {
      for (const statement of migration.upSqlStatements) {
        const body = statement.trim().replace(/;$/, '');
        if (/^CREATE TRIGGER /.test(body)) {
          expect(body, statement).toMatch(/\bBEGIN\b[\s\S]*;\s*END$/);
          expect(body.slice(body.lastIndexOf('END') + 3).includes(';'), statement).toBe(false);
        } else {
          expect(body.includes(';'), statement).toBe(false);
        }
      }
    }
  });

  it('la migration v1 crée exactement les 7 tables de la partie 1, dans cet ordre', () => {
    expect(TENANT_MIGRATIONS[0]?.tableNames).toEqual([...PART1_TABLES]);
    expect(TENANT_TABLE_NAMES.slice(0, PART1_TABLES.length)).toEqual([...PART1_TABLES]);
  });

  it('les noms de tables et d\'index déclarés par chaque migration sont ceux que cette migration crée réellement', () => {
    const db = openTenant(0);
    const known = new Set<string>();
    for (const migration of TENANT_MIGRATIONS) {
      for (const statement of migration.upSqlStatements) {
        db.exec(statement);
      }
      const tables = listObjects(db, 'table').filter((name) => !known.has(name));
      const indexes = listObjects(db, 'index').filter((name) => !name.startsWith('sqlite_autoindex') && !known.has(name));
      expect(tables.sort(), `tables de la migration v${migration.version}`).toEqual([...migration.tableNames].sort());
      expect(indexes.sort(), `index de la migration v${migration.version}`).toEqual([...migration.indexNames].sort());
      for (const name of [...tables, ...indexes]) {
        known.add(name);
      }
    }
  });
});

describe('création du schéma', () => {
  it('toutes les tables de la partie 1 se créent', () => {
    const db = openTenant(1);
    expect(listObjects(db, 'table')).toEqual([...PART1_TABLES].sort());
    expect([...TENANT_TABLE_NAMES].slice(0, PART1_TABLES.length).sort()).toEqual(listObjects(db, 'table'));
    expect([...TENANT_TABLE_NAMES].sort()).toEqual(listObjects(openTenant(), 'table'));
    expect(new Set(TENANT_TABLE_NAMES).size).toBe(TENANT_TABLE_NAMES.length);
  });

  it('deux créations successives donnent exactement le même sqlite_master', () => {
    const dump = (db: DatabaseSync): string =>
      all(db, `SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY rowid`)
        .map((row) => `${String(row['type'])}|${String(row['name'])}|${String(row['sql'])}`)
        .join('\n');
    expect(dump(openTenant())).toBe(dump(openTenant()));
  });

  it("l'ordre de création respecte les clés étrangères (les parents précèdent les enfants)", () => {
    const db = openTenant();
    const position = new Map(TENANT_TABLE_NAMES.map((name, index) => [name, index]));
    for (const table of TENANT_TABLE_NAMES) {
      for (const fk of all(db, `SELECT "table" AS parent FROM pragma_foreign_key_list(?)`, table)) {
        const parent = String(fk['parent']);
        if (parent === table) {
          continue;
        }
        expect(position.get(parent), `${table} -> ${parent}`).toBeLessThan(position.get(table) ?? -1);
      }
    }
  });

  it('les index nommés exportés existent tous, et seulement eux (Doc_06 § 08)', () => {
    const db = openTenant();
    const named = listObjects(db, 'index').filter((name) => !name.startsWith('sqlite_autoindex'));
    expect(named).toEqual([...TENANT_INDEX_NAMES].sort());
    expect(TENANT_INDEX_NAMES.slice(0, 3)).toEqual(['idx_partners_ice_bidx', 'idx_invoices_dedup_bidx', 'idx_inv_partner_date_dir']);
  });

  it("les migrations v1 et v2 ne créent ni vue ni trigger (Doc_06 § 03 et § 04 n'en définissent aucun)", () => {
    const db = openTenant(2);
    expect(listObjects(db, 'trigger')).toEqual([]);
    expect(listObjects(db, 'view')).toEqual([]);
  });

  it("ne crée aucune table du ticket suivant (sous-livres, v4)", () => {
    const names: readonly string[] = TENANT_TABLE_NAMES;
    for (const later of ['subledger_invoices']) {
      expect(names).not.toContain(later);
    }
  });
});

describe('aucune colonne REAL, FLOAT ou NUMERIC (Loi 1)', () => {
  it('toutes les colonnes sont TEXT ou INTEGER', () => {
    const db = openTenant();
    for (const table of TENANT_TABLE_NAMES) {
      for (const column of columnsOf(db, table)) {
        expect(['TEXT', 'INTEGER'], `${table}.${column.name}`).toContain(column.type);
      }
    }
  });

  it('le DDL ne contient aucun type flottant ou décimal', () => {
    for (const migration of TENANT_MIGRATIONS) {
      expect(migration.upSqlStatements.join('\n')).not.toMatch(/\b(REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL)\b/i);
    }
  });

  it('chaque colonne _cents, _bps, _milli, _micro porte le CHECK d\'entier strict', () => {
    const db = openTenant();
    let counted = 0;
    for (const table of TENANT_TABLE_NAMES) {
      const ddl = String(all(db, `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, table)[0]?.['sql']);
      for (const column of columnsOf(db, table)) {
        if (/_(cents|bps|milli|micro)$/.test(column.name)) {
          counted += 1;
          expect(column.type, `${table}.${column.name}`).toBe('INTEGER');
          expect(ddl, `${table}.${column.name}`).toContain(`CHECK (${column.name} = CAST(${column.name} AS INTEGER))`);
        }
      }
    }
    expect(counted).toBeGreaterThanOrEqual(20);
  });
});

describe('tenant_key_grants : unicité élargie à la version de DEK (écart assumé avec Doc_06 § 03)', () => {
  it('les 4 rôles de Doc_06 sont ceux de key-envelope.ts', () => {
    expect([...TENANT_GRANTEE_ROLES]).toEqual(['OWNER_ADMIN', 'EXTERNAL_CPA', 'ERP_CONNECTOR_AGENT', 'DGI_AUDIT_ESCROW']);
  });

  it("colonnes alignées sur KeyGrantRecord, plus dek_version et l'empreinte de clé publique", () => {
    const db = openTenant();
    expect(columnsOf(db, 'tenant_key_grants').map((c) => c.name)).toEqual([
      'grant_id',
      'grantee_role',
      'grantee_actor_id',
      'grantee_public_key_spki_b64',
      'grantee_public_key_fingerprint_hex',
      'dek_version',
      'wrapped_dek_b64',
      'wrapped_bidx_key_b64',
      'shamir_share_index',
      'created_at',
      'revoked_at',
    ]);
  });

  it.each(TENANT_GRANTEE_ROLES)('accepte le rôle %s', (role) => {
    const db = openTenant();
    insertRow(db, 'tenant_key_grants', grantRow({ grantee_role: role }));
    expect(all(db, `SELECT grantee_role FROM tenant_key_grants`)).toEqual([{ grantee_role: role }]);
  });

  it.each(['ROOT', '', 'owner_admin', 'AI_MCP_ACTOR'])('refuse le rôle %j', (role) => {
    reject(openTenant(), 'tenant_key_grants', grantRow({ grantee_role: role }), CHECK_FAILED);
  });

  it('un même acteur reçoit une ligne par version de DEK : v1 puis v2 acceptées', () => {
    const db = openTenant();
    insertRow(db, 'tenant_key_grants', grantRow());
    insertRow(
      db,
      'tenant_key_grants',
      grantRow({ grant_id: 'grant-2', dek_version: 2, wrapped_dek_b64: envelope(2, 'ZGVrMg'), wrapped_bidx_key_b64: envelope(2, 'YmlkeDI') }),
    );
    expect(all(db, `SELECT dek_version FROM tenant_key_grants ORDER BY dek_version`)).toEqual([{ dek_version: 1 }, { dek_version: 2 }]);
  });

  it('la même version de DEK deux fois pour le même acteur est refusée', () => {
    const db = openTenant();
    insertRow(db, 'tenant_key_grants', grantRow());
    reject(db, 'tenant_key_grants', grantRow({ grant_id: 'grant-2' }), UNIQUE_FAILED);
  });

  it('le même acteur dans deux rôles, ou deux acteurs au même rôle, ne se heurtent pas', () => {
    const db = openTenant();
    insertRow(db, 'tenant_key_grants', grantRow());
    insertRow(db, 'tenant_key_grants', grantRow({ grant_id: 'grant-2', grantee_role: 'EXTERNAL_CPA' }));
    insertRow(db, 'tenant_key_grants', grantRow({ grant_id: 'grant-3', grantee_actor_id: 'actor-2' }));
    expect(all(db, `SELECT COUNT(*) AS n FROM tenant_key_grants`)).toEqual([{ n: 3 }]);
  });

  it('grant_id reste unique', () => {
    const db = openTenant();
    insertRow(db, 'tenant_key_grants', grantRow());
    reject(db, 'tenant_key_grants', grantRow({ grantee_actor_id: 'actor-9' }), /UNIQUE constraint failed|PRIMARY KEY/);
  });

  it('la révocation par revoked_at ne supprime rien et ne libère pas la version', () => {
    const db = openTenant();
    insertRow(db, 'tenant_key_grants', grantRow());
    run(db, `UPDATE tenant_key_grants SET revoked_at = ? WHERE grantee_role = 'OWNER_ADMIN' AND grantee_actor_id = 'actor-1' AND revoked_at IS NULL`, NOW);
    expect(all(db, `SELECT revoked_at FROM tenant_key_grants`)).toEqual([{ revoked_at: NOW }]);
    reject(db, 'tenant_key_grants', grantRow({ grant_id: 'grant-2' }), UNIQUE_FAILED);
  });

  it('dek_version doit être un entier ≥ 1', () => {
    for (const version of [0, -1, 1.5]) {
      reject(openTenant(), 'tenant_key_grants', grantRow({ dek_version: version }), CHECK_FAILED);
    }
  });

  it("l'en-tête des deux enveloppes doit porter la version de la colonne dek_version", () => {
    reject(openTenant(), 'tenant_key_grants', grantRow({ dek_version: 2 }), CHECK_FAILED);
    reject(openTenant(), 'tenant_key_grants', grantRow({ wrapped_bidx_key_b64: envelope(3, 'YmlkeA') }), CHECK_FAILED);
  });

  it('shamir_share_index : NULL ou 1 à 3 seulement', () => {
    for (const index of [1, 2, 3, null]) {
      insertRow(openTenant(), 'tenant_key_grants', grantRow({ shamir_share_index: index }));
    }
    for (const index of [0, 4, -1]) {
      reject(openTenant(), 'tenant_key_grants', grantRow({ shamir_share_index: index }), CHECK_FAILED);
    }
  });

  it("l'empreinte de clé publique est un SHA-256 hexadécimal minuscule de 64 caractères", () => {
    for (const bad of ['abc', 'A'.repeat(64), 'a'.repeat(63)]) {
      reject(openTenant(), 'tenant_key_grants', grantRow({ grantee_public_key_fingerprint_hex: bad }), CHECK_FAILED);
    }
  });

  it('les enveloppes et clés publiques sont obligatoires', () => {
    for (const column of ['grantee_public_key_spki_b64', 'wrapped_dek_b64', 'wrapped_bidx_key_b64', 'grantee_actor_id']) {
      reject(openTenant(), 'tenant_key_grants', grantRow({ [column]: null }), /NOT NULL constraint failed/);
    }
  });
});

describe('fiscal_partners : champs sensibles chiffrés (_enc) et indexés à l\'aveugle (_bidx)', () => {
  const NAMES_IN_CLEAR = ['legal_name', 'legal_name_ar', 'ice', 'if', 'if_number', 'cin', 'rib', 'rib_24', 'rib_24_verified', 'address', 'address_adc450', 'iban'];

  it('ICE, IF, CIN et RIB : colonne _enc ET colonne _bidx', () => {
    const names = columnsOf(openTenant(), 'fiscal_partners').map((c) => c.name);
    for (const column of ['ice_enc', 'ice_bidx', 'if_enc', 'if_bidx', 'cin_enc', 'cin_bidx', 'rib_24_verified_enc', 'rib_24_bidx']) {
      expect(names, column).toContain(column);
    }
  });

  it('raison sociale (FR, AR) et adresse : colonne _enc', () => {
    const names = columnsOf(openTenant(), 'fiscal_partners').map((c) => c.name);
    for (const column of ['legal_name_enc', 'legal_name_ar_enc', 'address_adc450_enc']) {
      expect(names, column).toContain(column);
    }
  });

  it('aucune colonne en clair pour un champ sensible, dans aucune table du schéma', () => {
    const db = openTenant();
    for (const table of TENANT_TABLE_NAMES) {
      for (const column of columnsOf(db, table)) {
        expect(NAMES_IN_CLEAR, `${table}.${column.name}`).not.toContain(column.name);
        // rib_check_status est un statut de contrôle (OK, ALERTE_RIB_DAF), pas un RIB.
        if (column.name !== 'rib_check_status' && /(^|_)(ice|cin|rib|iban|if)(_|$)/.test(column.name)) {
          expect(column.name, `${table}.${column.name}`).toMatch(/_(enc|bidx)$|^rib_24_bidx$/);
        }
      }
    }
  });

  it('toute colonne _enc ou _bidx est TEXT', () => {
    const db = openTenant();
    for (const table of TENANT_TABLE_NAMES) {
      for (const column of columnsOf(db, table)) {
        if (/_(enc|bidx)$/.test(column.name)) {
          expect(column.type, `${table}.${column.name}`).toBe('TEXT');
        }
      }
    }
  });

  it("Doc_06 impose _enc NOT NULL sur la raison sociale et l'adresse, nullable sur les autres", () => {
    const db = openTenant();
    reject(db, 'fiscal_partners', partnerRow({ legal_name_enc: null }), /NOT NULL constraint failed/);
    reject(db, 'fiscal_partners', partnerRow({ address_adc450_enc: null }), /NOT NULL constraint failed/);
    insertRow(db, 'fiscal_partners', partnerRow());
    expect(all(db, `SELECT ice_enc, ice_bidx, if_enc, if_bidx, cin_enc, cin_bidx, rib_24_verified_enc, rib_24_bidx FROM fiscal_partners`)).toEqual([
      { ice_enc: null, ice_bidx: null, if_enc: null, if_bidx: null, cin_enc: null, cin_bidx: null, rib_24_verified_enc: null, rib_24_bidx: null },
    ]);
  });

  it('ice_bidx est unique (recherche exacte et détection de doublon) ; plusieurs NULL admis', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow({ ice_bidx: 'a'.repeat(32) }));
    insertRow(db, 'fiscal_partners', partnerRow({ id: 'partner-2' }));
    insertRow(db, 'fiscal_partners', partnerRow({ id: 'partner-3' }));
    reject(db, 'fiscal_partners', partnerRow({ id: 'partner-4', ice_bidx: 'a'.repeat(32) }), UNIQUE_FAILED);
  });

  it('valeurs par défaut de Doc_06 : type DGI 5, nationalité MA, délai 60 jours', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    expect(all(db, `SELECT dgi_public_client_type, nationality_code, agreed_payment_days FROM fiscal_partners`)).toEqual([
      { dgi_public_client_type: 5, nationality_code: 'MA', agreed_payment_days: 60 },
    ]);
  });

  it('refuse un rôle de tiers, une catégorie fiscale, un type DGI et un délai hors bornes', () => {
    reject(openTenant(), 'fiscal_partners', partnerRow({ partner_role: 'PROSPECT' }), CHECK_FAILED);
    reject(openTenant(), 'fiscal_partners', partnerRow({ tax_category: 'SCI' }), CHECK_FAILED);
    reject(openTenant(), 'fiscal_partners', partnerRow({ dgi_public_client_type: 6 }), CHECK_FAILED);
    reject(openTenant(), 'fiscal_partners', partnerRow({ dgi_public_client_type: 0 }), CHECK_FAILED);
    reject(openTenant(), 'fiscal_partners', partnerRow({ agreed_payment_days: 0 }), CHECK_FAILED);
    reject(openTenant(), 'fiscal_partners', partnerRow({ agreed_payment_days: 181 }), CHECK_FAILED);
  });

  it.each(['CLIENT', 'FOURNISSEUR', 'MIXTE', 'BAILLEUR'])('accepte le rôle de tiers %s', (role) => {
    insertRow(openTenant(), 'fiscal_partners', partnerRow({ partner_role: role }));
  });

  it.each(['COMPANY_IS', 'INDIVIDUAL_IR_PRO', 'AUTO_ENTREPRENEUR', 'INDIVIDUAL_B2C', 'PUBLIC_ENTITY', 'FOREIGN_NON_RESIDENT'])(
    'accepte la catégorie fiscale %s',
    (category) => {
      insertRow(openTenant(), 'fiscal_partners', partnerRow({ tax_category: category }));
    },
  );
});

describe('purchase_orders, delivery_notes, invoice_delivery_links', () => {
  it.each(['OPEN', 'PARTIAL', 'MATCHED', 'CLOSED'])('purchase_orders accepte le statut %s', (status) => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    insertRow(db, 'purchase_orders', purchaseOrderRow({ status }));
  });

  it('purchase_orders refuse un statut inconnu, un montant négatif et un montant non entier', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    reject(db, 'purchase_orders', purchaseOrderRow({ status: 'DRAFT' }), CHECK_FAILED);
    reject(db, 'purchase_orders', purchaseOrderRow({ total_ht_cents: -1 }), CHECK_FAILED);
    reject(db, 'purchase_orders', purchaseOrderRow({ total_ht_cents: NON_INTEGER }), CHECK_FAILED);
    reject(db, 'purchase_orders', purchaseOrderRow({ total_ht_cents: 'abc' }), CHECK_FAILED);
  });

  it('purchase_orders : po_number unique et tiers existant', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    insertRow(db, 'purchase_orders', purchaseOrderRow());
    reject(db, 'purchase_orders', purchaseOrderRow({ id: 'po-2' }), UNIQUE_FAILED);
    reject(db, 'purchase_orders', purchaseOrderRow({ id: 'po-3', po_number: 'PO-2', partner_id: 'ghost' }), FK_FAILED);
  });

  it('delivery_notes : (partner_id, bl_number) unique, tiers et commande existants', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    insertRow(db, 'delivery_notes', deliveryNoteRow());
    reject(db, 'delivery_notes', deliveryNoteRow({ id: 'bl-2' }), UNIQUE_FAILED);
    reject(db, 'delivery_notes', deliveryNoteRow({ id: 'bl-3', bl_number: 'BL-3', partner_id: 'ghost' }), FK_FAILED);
    reject(db, 'delivery_notes', deliveryNoteRow({ id: 'bl-4', bl_number: 'BL-4', po_id: 'ghost' }), FK_FAILED);
  });

  it('delivery_notes : tampon humide 0/1, 0 par défaut', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    insertRow(db, 'delivery_notes', deliveryNoteRow());
    expect(all(db, `SELECT has_wet_stamp_verified FROM delivery_notes`)).toEqual([{ has_wet_stamp_verified: 0 }]);
    reject(db, 'delivery_notes', deliveryNoteRow({ id: 'bl-2', bl_number: 'BL-2', has_wet_stamp_verified: 2 }), CHECK_FAILED);
  });

  it('invoice_delivery_links : N bons de livraison pour 1 facture, pas de doublon, FK des deux côtés', () => {
    const db = openTenant();
    seedPartnerAndInvoice(db);
    insertRow(db, 'delivery_notes', deliveryNoteRow());
    insertRow(db, 'delivery_notes', deliveryNoteRow({ id: 'bl-2', bl_number: 'BL-0002' }));
    insertRow(db, 'invoice_delivery_links', { invoice_id: 'inv-1', delivery_note_id: 'bl-1' });
    insertRow(db, 'invoice_delivery_links', { invoice_id: 'inv-1', delivery_note_id: 'bl-2' });
    reject(db, 'invoice_delivery_links', { invoice_id: 'inv-1', delivery_note_id: 'bl-1' }, /UNIQUE constraint failed|PRIMARY KEY/);
    reject(db, 'invoice_delivery_links', { invoice_id: 'ghost', delivery_note_id: 'bl-1' }, FK_FAILED);
    reject(db, 'invoice_delivery_links', { invoice_id: 'inv-1', delivery_note_id: 'ghost' }, FK_FAILED);
  });
});

describe('invoices', () => {
  it('une facture complète est acceptée avec les valeurs par défaut de Doc_06', () => {
    const db = openTenant();
    seedPartnerAndInvoice(db);
    expect(
      all(
        db,
        `SELECT currency_code, bam_exchange_rate_micro, total_debours_cents, ras_vat_cents, paid_cents, clearance_state, cdv_lifecycle_status,
                three_way_match_status, rib_check_status, dispute_status, is_btp_progress_statement, pii_restricted_flag
           FROM invoices`,
      ),
    ).toEqual([
      {
        currency_code: 'MAD',
        bam_exchange_rate_micro: 1000000,
        total_debours_cents: 0,
        ras_vat_cents: 0,
        paid_cents: 0,
        clearance_state: 'BROUILLON',
        cdv_lifecycle_status: 'NONE',
        three_way_match_status: 'N_A',
        rib_check_status: 'OK',
        dispute_status: 'NONE',
        is_btp_progress_statement: 0,
        pii_restricted_flag: 0,
      },
    ]);
  });

  it('refuse une valeur inconnue pour chaque colonne à CHECK (statuts et codes de Doc_06)', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    const cases: readonly [string, string | number][] = [
      ['direction', 'INTERNE'],
      ['ubl_type_code', '388_AUTRE'],
      ['ubl_payment_code', '99_BITCOIN'],
      ['three_way_match_status', 'PENDING'],
      ['rib_check_status', 'FAUX'],
      ['dispute_status', 'OUVERT'],
      ['dgi_payment_method_id', 8],
      ['dgi_payment_method_id', 0],
    ];
    for (const [column, value] of cases) {
      reject(db, 'invoices', invoiceRow({ [column]: value }), CHECK_FAILED);
    }
  });

  it.each(['380_FACTURE', '381_AVOIR', '383_NOTE_DEBIT', '386_ACOMPTE', '389_AUTOFACTURATION'])('accepte le type UBL %s', (code) => {
    const db = openTenant();
    seedPartnerAndInvoice(db);
    insertRow(db, 'invoices', invoiceRow({ id: 'inv-2', ubl_type_code: code, origin_invoice_id: 'inv-1' }));
  });

  it.each(['10_ESPECES', '20_CHEQUE', '30_VIREMENT', '42_EFFET_LCN', '48_CARTE', '97_COMPENSATION'])('accepte le paiement UBL %s', (code) => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    insertRow(db, 'invoices', invoiceRow({ ubl_payment_code: code }));
  });

  it('un avoir 381 et une note de débit 383 exigent origin_invoice_id', () => {
    const db = openTenant();
    seedPartnerAndInvoice(db);
    reject(db, 'invoices', invoiceRow({ id: 'inv-2', ubl_type_code: '381_AVOIR' }), CHECK_FAILED);
    reject(db, 'invoices', invoiceRow({ id: 'inv-3', ubl_type_code: '383_NOTE_DEBIT' }), CHECK_FAILED);
    reject(db, 'invoices', invoiceRow({ id: 'inv-4', ubl_type_code: '381_AVOIR', origin_invoice_id: 'ghost' }), FK_FAILED);
  });

  it('total_ttc = HT + débours + TVA + timbre (CHECK de Doc_06)', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    reject(db, 'invoices', invoiceRow({ total_ttc_cents: 120001 }), CHECK_FAILED);
    insertRow(db, 'invoices', invoiceRow({ total_debours_cents: 5000, stamp_duty_cents: 25, total_ttc_cents: 125025 }));
  });

  it('refuse un montant négatif, fractionnaire ou textuel, sur chaque colonne _cents', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    const money = [
      'total_ht_cents',
      'total_debours_cents',
      'total_vat_cents',
      'ras_vat_cents',
      'ras_ir_or_is_cents',
      'stamp_duty_cents',
      'btp_retention_cents',
      'paid_cents',
    ];
    for (const column of money) {
      reject(db, 'invoices', invoiceRow({ [column]: -1 }), CHECK_FAILED);
      reject(db, 'invoices', invoiceRow({ [column]: NON_INTEGER }), CHECK_FAILED);
      reject(db, 'invoices', invoiceRow({ [column]: 'abc' }), CHECK_FAILED);
    }
    for (const column of ['net_payable_cents', 'non_deductible_cash_ht_cents', 'non_deductible_cash_vat_cents', 'bam_exchange_rate_micro', 'icv_counter']) {
      reject(db, 'invoices', invoiceRow({ [column]: NON_INTEGER }), CHECK_FAILED);
    }
  });

  it('unicité : numéro séquentiel, ticket POS, UUID xHub, empreinte de dédoublonnage ; NULL multiples admis', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    insertRow(db, 'invoices', invoiceRow({ sequential_number: 'FA-2026-0001', pos_ticket_id: 't-1', xhub_uuid: 'x-1', dedup_supplier_invoice_bidx: 'd'.repeat(32) }));
    insertRow(db, 'invoices', invoiceRow({ id: 'inv-2' }));
    insertRow(db, 'invoices', invoiceRow({ id: 'inv-3' }));
    for (const column of ['sequential_number', 'pos_ticket_id', 'xhub_uuid', 'dedup_supplier_invoice_bidx']) {
      const value = column === 'dedup_supplier_invoice_bidx' ? 'd'.repeat(32) : column === 'sequential_number' ? 'FA-2026-0001' : column === 'pos_ticket_id' ? 't-1' : 'x-1';
      reject(db, 'invoices', invoiceRow({ id: `dup-${column}`, [column]: value }), UNIQUE_FAILED);
    }
  });

  it('clés étrangères : tiers et commande doivent exister', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    reject(db, 'invoices', invoiceRow({ partner_id: 'ghost' }), FK_FAILED);
    reject(db, 'invoices', invoiceRow({ po_id: 'ghost' }), FK_FAILED);
  });

  it("clearance_state et cdv_lifecycle_status n'ont pas de CHECK dans Doc_06 : aucun n'est ajouté ici", () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    insertRow(db, 'invoices', invoiceRow({ clearance_state: 'SIGNEE_LOI_43_20', cdv_lifecycle_status: 'MISE_A_DISPOSITION' }));
    const ddl = String(all(db, `SELECT sql FROM sqlite_master WHERE name = 'invoices'`)[0]?.['sql']);
    expect(ddl).not.toMatch(/clearance_state[^,]*CHECK/);
    expect(ddl).not.toMatch(/cdv_lifecycle_status[^,]*CHECK/);
  });
});

describe('pii_restricted_flag (ERRATA D-19, Doc_11 § 06)', () => {
  it('existe sur invoices (Factur-X) ; v3 y ajoute le grand livre (tenant-ledger.test.ts) ; entier 0/1 NOT NULL DEFAULT 0', () => {
    const db = openTenant(2);
    const tables = TENANT_TABLE_NAMES.filter((table) => columnsOf(db, table).some((c) => c.name === 'pii_restricted_flag'));
    expect(tables).toEqual(['invoices']);
    const column = all(db, `SELECT type, "notnull" AS not_null, dflt_value FROM pragma_table_info('invoices') WHERE name = 'pii_restricted_flag'`);
    expect(column).toEqual([{ type: 'INTEGER', not_null: 1, dflt_value: '0' }]);
  });

  it('accepte 0 et 1, refuse 2, -1, 0.5 et NULL', () => {
    const db = openTenant();
    insertRow(db, 'fiscal_partners', partnerRow());
    insertRow(db, 'invoices', invoiceRow({ pii_restricted_flag: 0 }));
    insertRow(db, 'invoices', invoiceRow({ id: 'inv-2', pii_restricted_flag: 1 }));
    reject(db, 'invoices', invoiceRow({ id: 'inv-3', pii_restricted_flag: 2 }), CHECK_FAILED);
    reject(db, 'invoices', invoiceRow({ id: 'inv-4', pii_restricted_flag: -1 }), CHECK_FAILED);
    reject(db, 'invoices', invoiceRow({ id: 'inv-5', pii_restricted_flag: 0.5 }), CHECK_FAILED);
    reject(db, 'invoices', invoiceRow({ id: 'inv-6', pii_restricted_flag: null }), /NOT NULL constraint failed/);
  });
});

describe('invoice_lines', () => {
  it('une ligne valide est acceptée', () => {
    const db = openTenant();
    seedPartnerAndInvoice(db);
    insertRow(db, 'invoice_lines', invoiceLineRow());
    expect(all(db, `SELECT discount_bps, is_disbursement_debours FROM invoice_lines`)).toEqual([{ discount_bps: 0, is_disbursement_debours: 0 }]);
  });

  it.each([2000, 1000, 0])('accepte vat_rate_bps = %i (ERRATA D-04)', (rate) => {
    const db = openTenant();
    seedPartnerAndInvoice(db);
    insertRow(db, 'invoice_lines', invoiceLineRow({ vat_rate_bps: rate }));
  });

  it.each([1400, 700, 600, 2100, -1, 10])('refuse vat_rate_bps = %i', (rate) => {
    const db = openTenant();
    seedPartnerAndInvoice(db);
    reject(db, 'invoice_lines', invoiceLineRow({ vat_rate_bps: rate }), CHECK_FAILED);
  });

  it('refuse un taux non entier (10.5 lié en paramètre) et un taux textuel', () => {
    const db = openTenant();
    seedPartnerAndInvoice(db);
    reject(db, 'invoice_lines', invoiceLineRow({ vat_rate_bps: NON_INTEGER }), CHECK_FAILED);
    reject(db, 'invoice_lines', invoiceLineRow({ vat_rate_bps: '2000x' }), CHECK_FAILED);
  });

  it('refuse montants, quantités et remises non entiers ou hors bornes', () => {
    const db = openTenant();
    seedPartnerAndInvoice(db);
    for (const column of ['unit_price_cents', 'line_ht_cents', 'line_vat_cents', 'quantity_milli', 'discount_bps']) {
      reject(db, 'invoice_lines', invoiceLineRow({ [column]: NON_INTEGER }), CHECK_FAILED);
      reject(db, 'invoice_lines', invoiceLineRow({ [column]: 'abc' }), CHECK_FAILED);
    }
    reject(db, 'invoice_lines', invoiceLineRow({ quantity_milli: 0 }), CHECK_FAILED);
    reject(db, 'invoice_lines', invoiceLineRow({ unit_price_cents: -1 }), CHECK_FAILED);
    reject(db, 'invoice_lines', invoiceLineRow({ discount_bps: 10001 }), CHECK_FAILED);
    reject(db, 'invoice_lines', invoiceLineRow({ discount_bps: -1 }), CHECK_FAILED);
  });

  it('(invoice_id, line_number) unique ; la facture doit exister', () => {
    const db = openTenant();
    seedPartnerAndInvoice(db);
    insertRow(db, 'invoice_lines', invoiceLineRow());
    reject(db, 'invoice_lines', invoiceLineRow({ id: 'line-2' }), UNIQUE_FAILED);
    insertRow(db, 'invoice_lines', invoiceLineRow({ id: 'line-3', line_number: 2 }));
    reject(db, 'invoice_lines', invoiceLineRow({ id: 'line-4', line_number: 3, invoice_id: 'ghost' }), FK_FAILED);
  });

  it('la description FR est chiffrée et obligatoire ; débours 0/1', () => {
    const db = openTenant();
    seedPartnerAndInvoice(db);
    reject(db, 'invoice_lines', invoiceLineRow({ description_fr_enc: null }), /NOT NULL constraint failed/);
    reject(db, 'invoice_lines', invoiceLineRow({ is_disbursement_debours: 2 }), CHECK_FAILED);
  });
});
