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

export const SHA_A = 'a'.repeat(64);
export const SHA_B = 'b'.repeat(64);
export const SHA_C = 'c'.repeat(64);

/** Session de caisse ouverte avec un fond de 200,00 ; le comptage aveugle et l'écart ne sont pas encore saisis. */
export function posSessionRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'sess-1',
    terminal_id: 'POS-M01-C02',
    cashier_user_id: 'user-1',
    opened_at: NOW,
    opening_float_cents: 20000,
    status: 'SESSION_OUVERTE_ACTIVE',
    ...overrides,
  };
}

/** Vente B2C de 1 200,00 TTC (1 000,00 HT à 20 % + 200,00 de TVA), payée en carte, premier ticket de la chaîne. */
export function posTicketRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'tkt-1',
    session_id: 'sess-1',
    terminal_id: 'POS-M01-C02',
    terminal_seq_number: 'POS-M01-C02-2026-000001',
    issued_at: NOW,
    ticket_kind: 'SALE_B2C',
    ht_20_cents: 100000,
    vat_20_cents: 20000,
    total_ttc_cents: 120000,
    paid_card_tpe_cents: 120000,
    qr_conversion_token: 'qr-token-0001',
    prev_ticket_sha256: SHA_A,
    ticket_sha256: SHA_B,
    ecdsa_signature_b64: 'MEUCIQDsignature',
    ...overrides,
  };
}

export function posZClosureRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'z-1',
    session_id: 'sess-1',
    terminal_id: 'POS-M01-C02',
    closure_number: 1,
    business_date: '2026-11-13',
    net_b2c_ht_20_cents: 100000,
    net_b2c_vat_20_cents: 20000,
    net_b2c_ht_10_cents: 0,
    net_b2c_vat_10_cents: 0,
    net_b2c_ht_0_cents: 0,
    total_stamp_duty_cents: 0,
    tpe_gross_cents: 120000,
    prev_z_sha256: SHA_A,
    z_sha256: SHA_C,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Grand livre CGNC (migration v3, Doc_06 § 05)
// ---------------------------------------------------------------------------

/** Empreinte de départ du chaînage (valeur par défaut de journals.last_entry_hash dans Doc_06 § 05). */
export const GENESIS_HASH = 'GENESIS_HASH_00000000000000000000000000000000';

export function fiscalYearRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'fy-2026',
    code: 'EX-2026',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    ...overrides,
  };
}

export function journalRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'jrn-vte',
    code: 'VTE',
    name: 'Journal des ventes',
    journal_type: 'SALE',
    ...overrides,
  };
}

export function accountRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'acc-5161',
    account_number: '51610000',
    label_fr: 'Caisse',
    cgnc_class: 5,
    normal_balance: 'DEBIT',
    ...overrides,
  };
}

export function entryRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'je-1',
    fiscal_year_id: 'fy-2026',
    journal_id: 'jrn-vte',
    sequence_number: 1,
    entry_reference: 'VTE-2026-000001',
    entry_date: '2026-11-13',
    source_document_type: 'INVOICE',
    total_debit_cents: 120000,
    total_credit_cents: 120000,
    ...overrides,
  };
}

export function entryLineRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'jel-1',
    entry_id: 'je-1',
    line_number: 1,
    account_id: 'acc-3421',
    description_enc: 'v1:aXY:bGlnbmU',
    debit_cents: 120000,
    ...overrides,
  };
}

export function bankTransactionRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'bt-1',
    bank_code: 'ATTIJARI',
    statement_date: '2026-11-13',
    value_date: '2026-11-13',
    raw_label_enc: 'v1:aXY:bGFiZWw',
    amount_cents: 120000,
    ...overrides,
  };
}

export function fixedAssetRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'fa-1',
    asset_account_number: '23400000',
    label_enc: 'v1:aXY:dmVoaWN1bGU',
    acquisition_date: '2026-03-01',
    acquisition_ht_cents: 30000000,
    acquisition_ttc_cents: 36000000,
    depreciation_rate_bps: 2500,
    ...overrides,
  };
}

/** Comptes de test : caisse 5161, clients 3421, ventes 7111, TVA facturée 4455, capital 1111, charges 6111. */
export const LEDGER_ACCOUNTS: readonly RowValues[] = [
  accountRow(),
  accountRow({ id: 'acc-3421', account_number: '34211000', label_fr: 'Clients', cgnc_class: 3 }),
  accountRow({ id: 'acc-7111', account_number: '71111000', label_fr: 'Ventes de marchandises', cgnc_class: 7, normal_balance: 'CREDIT' }),
  accountRow({ id: 'acc-4455', account_number: '44551000', label_fr: 'Etat TVA facturée', cgnc_class: 4, normal_balance: 'CREDIT', vat_regime_role: 'VAT_COLLECTED_DUE' }),
  accountRow({ id: 'acc-1111', account_number: '11110000', label_fr: 'Capital social', cgnc_class: 1, normal_balance: 'CREDIT' }),
  accountRow({ id: 'acc-6111', account_number: '61110000', label_fr: 'Achats revendus de marchandises', cgnc_class: 6 }),
];

/** Parents du grand livre : un exercice 2026, trois journaux (AN, VTE, CAI) et six comptes. */
export const LEDGER_SEED: readonly (readonly [string, RowValues])[] = [
  ['fiscal_years', fiscalYearRow()],
  ['journals', journalRow({ id: 'jrn-an', code: 'AN', name: 'A nouveaux', journal_type: 'OPENING' })],
  ['journals', journalRow()],
  ['journals', journalRow({ id: 'jrn-cai', code: 'CAI', name: 'Journal de caisse', journal_type: 'CASH' })],
  ...LEDGER_ACCOUNTS.map((values): readonly [string, RowValues] => ['cgnc_accounts', values]),
];

export interface LedgerLineSpec {
  readonly account: string;
  readonly debit?: number;
  readonly credit?: number;
}

/** Une pièce au statut initial (DRAFT par défaut) et ses lignes ; les totaux sont ceux des lignes. */
export function entryWithLines(
  id: string,
  sequence: number,
  journalId: string,
  lines: readonly LedgerLineSpec[],
  overrides: RowValues = {},
): readonly (readonly [string, RowValues])[] {
  const debit = lines.reduce((sum, line) => sum + (line.debit ?? 0), 0);
  const credit = lines.reduce((sum, line) => sum + (line.credit ?? 0), 0);
  const header: readonly [string, RowValues] = [
    'journal_entries',
    entryRow({
      id,
      journal_id: journalId,
      sequence_number: sequence,
      entry_reference: `${journalId}-2026-${String(sequence).padStart(6, '0')}`,
      status: 'DRAFT',
      total_debit_cents: debit,
      total_credit_cents: credit,
      ...overrides,
    }),
  ];
  return [
    header,
    ...lines.map((line, index): readonly [string, RowValues] => [
      'journal_entry_lines',
      entryLineRow({
        id: `${id}-l${index + 1}`,
        entry_id: id,
        line_number: index + 1,
        account_id: line.account,
        debit_cents: line.debit ?? 0,
        credit_cents: line.credit ?? 0,
      }),
    ]),
  ];
}

/** Scellement DRAFT vers POSTED : UPDATE contrôlé portant les deux empreintes (Doc_06 § 05, PAF_MISSING_HASH). */
export const POST_ENTRY_SQL =
  `UPDATE journal_entries SET status = 'POSTED', validated_at = ?, entry_hash = ?, previous_entry_hash = ? WHERE id = ?`;

export function postParams(id: string): [string, string, string, string] {
  return [NOW, SHA_B, GENESIS_HASH, id];
}

/** Insère un jeu de lignes dans une base SQLite. */
export function insertRows(db: DatabaseSync, rows: readonly (readonly [string, RowValues])[]): void {
  for (const [table, values] of rows) {
    insertRow(db, table, values);
  }
}

/** Base tenant complète avec les parents du grand livre déjà insérés. */
export function openLedger(): DatabaseSync {
  const db = openTenant();
  insertRows(db, LEDGER_SEED);
  return db;
}

/** Pièce équilibrée de `amount` centimes : débit sur `debit`, crédit sur `credit`. */
export function simpleEntry(
  id: string,
  sequence: number,
  journalId: string,
  debit: string,
  credit: string,
  amount: number,
  overrides: RowValues = {},
): readonly (readonly [string, RowValues])[] {
  return entryWithLines(id, sequence, journalId, [{ account: debit, debit: amount }, { account: credit, credit: amount }], overrides);
}

// ---------------------------------------------------------------------------
// Sous-livres, paie 9421 et coffre AIP (migration v5, Doc_06 § 06)
// ---------------------------------------------------------------------------

/** Clôture de l'exercice 2026 + 10 ans + 1 jour (Art. 211 CGI) : nettement dans le futur de toute horloge de test. */
export const RETENTION_FUTURE = '2999-12-31T00:00:00Z';
/** Échéance décennale déjà passée : l'horodatage est dans la ligne, jamais une horloge simulée. */
export const RETENTION_PAST = '2001-01-02T00:00:00Z';

/** Facture de 1 000,00 HT à 20 % : 200,00 de TVA, 1 200,00 TTC ; parents `invoices` et `journal_entries`. */
export function subledgerRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'sub-1',
    invoice_id: 'inv-1',
    invoice_entry_id: 'je-1',
    invoice_date: '2026-11-13',
    delivery_date: '2026-11-12',
    legal_due_date: '2027-01-12',
    dgi_payment_method_id: 3,
    base_ht_cents: 100000,
    vat_rate_bps: 2000,
    vat_amount_cents: 20000,
    total_ttc_cents: 120000,
    ...overrides,
  };
}

export function withholdingRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'ras-1',
    fiscal_year_id: 'fy-2026',
    partner_id: 'partner-1',
    direction: 'OUTBOUND_SUPPLIER_RAS',
    ras_family: 'HONORAIRES_IS_IR',
    invoiced_ht_cents: 100000,
    ras_rate_bps: 1000,
    ...overrides,
  };
}

export function payrollRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'pay-1',
    calendar_year: 2026,
    population_category: 'PERMANENT',
    matricule: 'M-0001',
    last_name_enc: 'v1:aXY:bm9t',
    first_name_enc: 'v1:aXY:cHJlbm9t',
    family_status: 'M',
    address_enc: 'v1:aXY:YWRyZXNzZQ',
    hire_date: '2020-01-01',
    dgi_expense_rate_code: 'FP35',
    base_salary_cents: 1000000,
    gross_salary_cents: 1200000,
    gross_taxable_cents: 1100000,
    pro_expenses_cents: 300000,
    social_contributions_cents: 90000,
    total_deductions_cents: 390000,
    net_taxable_cents: 710000,
    ir_withheld_cents: 90000,
    ...overrides,
  };
}

export function exemptElementRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'exe-1',
    payroll_line_id: 'pay-1',
    dgi_nature_code: 'N01',
    amount_cents: 50000,
    ...overrides,
  };
}

export function irRemittanceRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'irr-1',
    calendar_year: 2026,
    month: 11,
    payment_date: '2026-12-15',
    payment_method_code: 'SIR',
    dgi_reference: 'REF-0001',
    quittance_number: 'Q-0001',
    principal_cents: 90000,
    total_paid_cents: 90000,
    ...overrides,
  };
}

/** Paquet AIP non scellé (merkle_batch_id NULL), échéance décennale dans le futur. */
export function archivalRow(overrides: RowValues = {}): RowValues {
  return {
    aip_id: 'aip-1',
    fiscal_year_id: 'fy-2026',
    document_type: 'SIMPL_TVA_XML',
    document_ref: 'DOC-0001',
    document_date: '2026-11-13',
    r2_object_key: 'r2/aip-1',
    morocco_mirror_key: 'ma/aip-1',
    payload_sha256: SHA_A,
    encrypted_dek_base64: 'ZGVr',
    iv_base64: 'aXY',
    archived_at: NOW,
    retention_until: RETENTION_FUTURE,
    ...overrides,
  };
}

/** Même paquet, scellé dans un lot Merkle. */
export function sealedArchivalRow(overrides: RowValues = {}): RowValues {
  return archivalRow({ merkle_batch_id: 'batch-1', merkle_leaf_index: 0, merkle_proof_json: '[]', ...overrides });
}

export function transitionAuditRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'sta-1',
    entity_table: 'invoices',
    entity_id: 'inv-1',
    from_state: 'BROUILLON',
    to_state: 'NUMEROTEE_VERROUILLEE',
    actor_kind: 'USER',
    actor_id: 'user-1',
    idempotency_key: 'idem-0001',
    created_at: NOW,
    ...overrides,
  };
}

export function fecAuditRow(overrides: RowValues = {}): RowValues {
  return {
    id: 'fec-1',
    fiscal_year_id: 'fy-2026',
    score_on_100: 92,
    total_anomalies: 3,
    cash_overflow_count: 1,
    missing_ice_count: 1,
    cadrage_tva_gap_cents: 0,
    negative_cash_attempts: 0,
    findings_json: '[]',
    created_at: NOW,
    ...overrides,
  };
}
