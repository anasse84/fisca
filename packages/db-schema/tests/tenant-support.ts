import { DatabaseSync } from 'node:sqlite';
import { TENANT_MIGRATIONS } from '../src/tenant.ts';
import { NOW, type Param } from './support.ts';

/** Valeur fractionnaire liée en paramètre pour prouver le refus (jamais écrite à côté d'un nom de colonne monétaire). */
export const NON_INTEGER = 10.5;

export type RowValues = Readonly<Record<string, Param>>;

/** Base mémoire avec clés étrangères actives et toutes les migrations tenant appliquées dans l'ordre. */
export function openTenant(upToVersion?: number): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const migration of TENANT_MIGRATIONS) {
    if (upToVersion !== undefined && migration.version > upToVersion) {
      continue;
    }
    for (const statement of migration.upSqlStatements) {
      db.exec(statement);
    }
  }
  return db;
}

export function insertSqlite(table: string, values: RowValues): { readonly sql: string; readonly params: Param[] } {
  const columns = Object.keys(values);
  return {
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    params: columns.map((column) => values[column] ?? null),
  };
}

export function insertPostgres(table: string, values: RowValues): { readonly sql: string; readonly params: Param[] } {
  const columns = Object.keys(values);
  return {
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
    params: columns.map((column) => values[column] ?? null),
  };
}

export function insertRow(db: DatabaseSync, table: string, values: RowValues): void {
  const { sql, params } = insertSqlite(table, values);
  db.prepare(sql).run(...params);
}

/** Enveloppe `v1:<version de DEK>:<base64url>` (forme de key-envelope.ts), version portée par l'en-tête. */
export function envelope(dekVersion: number, payload: string): string {
  return `v1:${dekVersion}:${payload}`;
}

export const FINGERPRINT_A = 'a'.repeat(64);

export function grantRow(overrides: RowValues = {}): RowValues {
  return {
    grant_id: 'grant-1',
    grantee_role: 'OWNER_ADMIN',
    grantee_actor_id: 'actor-1',
    grantee_public_key_spki_b64: 'MIIBIjANBgkq',
    grantee_public_key_fingerprint_hex: FINGERPRINT_A,
    dek_version: 1,
    wrapped_dek_b64: envelope(1, 'ZGVr'),
    wrapped_bidx_key_b64: envelope(1, 'YmlkeA'),
    shamir_share_index: null,
    created_at: NOW,
    revoked_at: null,
    ...overrides,
  };
}

export function partnerRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'partner-1',
    partner_role: 'CLIENT',
    tax_category: 'COMPANY_IS',
    legal_name_enc: 'v1:aXY:Y3Q',
    address_adc450_enc: 'v1:aXY:YWRkcg',
    pcge_auxiliary_account: '34210001',
    created_at: NOW,
    ...overrides,
  };
}

export function purchaseOrderRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'po-1',
    partner_id: 'partner-1',
    po_number: 'PO-2026-0001',
    status: 'OPEN',
    total_ht_cents: 100000,
    lines_json: '[]',
    created_at: NOW,
    ...overrides,
  };
}

export function deliveryNoteRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'bl-1',
    po_id: null,
    partner_id: 'partner-1',
    bl_number: 'BL-0001',
    delivery_date: '2026-11-10',
    lines_qty_milli_json: '[]',
    created_at: NOW,
    ...overrides,
  };
}

/** Facture de 1 000,00 HT + 200,00 TVA = 1 200,00 TTC, tous les champs obligatoires de Doc_06 § 03. */
export function invoiceRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'inv-1',
    direction: 'EMISE',
    ubl_type_code: '380_FACTURE',
    partner_id: 'partner-1',
    issue_date: '2026-11-13',
    service_delivery_date: '2026-11-12',
    legal_due_date: '2027-01-12',
    total_ht_cents: 100000,
    total_vat_cents: 20000,
    total_ttc_cents: 120000,
    net_payable_cents: 120000,
    dgi_payment_method_id: 3,
    ubl_payment_code: '30_VIREMENT',
    created_at: NOW,
    ...overrides,
  };
}

export function invoiceLineRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'line-1',
    invoice_id: 'inv-1',
    line_number: 1,
    description_fr_enc: 'v1:aXY:ZGVzYw',
    quantity_milli: 1000,
    unit_price_cents: 100000,
    vat_rate_bps: 2000,
    line_ht_cents: 100000,
    line_vat_cents: 20000,
    pcge_account_number: '71111000',
    ...overrides,
  };
}

/** Un tiers, une facture et une ligne : les parents indispensables aux tests de clés étrangères. */
export function seedPartnerAndInvoice(db: DatabaseSync): void {
  insertRow(db, 'fiscal_partners', partnerRow());
  insertRow(db, 'invoices', invoiceRow());
}
