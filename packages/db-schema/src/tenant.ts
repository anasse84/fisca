/**
 * DDL SQLite de TENANT_DB (une base par société : Cloudflare D1 ou PostgreSQL 16), Partie 1 : Doc_06 § 03
 * (enveloppes de clés E2EE, référentiel des tiers, commandes, bons de livraison, factures et lignes), ticket T-S1B-02.
 * Les tickets suivants AJOUTENT des migrations au tableau `TENANT_MIGRATIONS` : la v2 (T-S1B-03) porte la caisse Fisca POS
 * (Doc_06 § 04), le grand livre et les sous-livres suivent en v3 et v4.
 *
 * Règles tenues ici (mêmes que `control-plane.ts`) :
 * - migrations IMMUABLES : une migration appliquée ne se modifie jamais, toute correction est une migration de numéro
 *   supérieur. `expectedSha256Hex` est le SHA-256 de `upSqlStatements.join("\n")`, exactement le calcul de
 *   `ensureTenantSchemaUpToDate` (Doc_06 § 10) ; un test le recalcule. Les champs `tableNames` et `indexNames` d'une
 *   migration sont des métadonnées hors empreinte : un test prouve qu'ils décrivent ce que la migration crée ;
 * - montants : INTEGER (`_cents`, `_bps`, `_milli`, `_micro`), jamais REAL. `CHECK (col = CAST(col AS INTEGER))` refuse un
 *   montant fractionnaire ou textuel, car SQLite n'impose pas le type d'une colonne INTEGER (typage dynamique) ;
 * - TVA : `vat_rate_bps IN (2000, 1000, 0)` strict (ERRATA D-04) ;
 * - champs sensibles : `<nom>_enc` (AES-256-GCM, AAD `companyId|tableName|recordId|columnName`) et, quand une recherche
 *   exacte est nécessaire, `<nom>_bidx` (HMAC-SHA256 tronqué à 128 bits) ; jamais de valeur sensible en clair ;
 * - aucune donnée n'est insérée par une migration (aucune règle ni taux fiscal en dur, ADR-04).
 *
 * ÉCARTS ASSUMÉS AVEC Doc_06 § 03 (chacun testé) :
 * 1. `tenant_key_grants` : Doc_06 pose UNIQUE(grantee_role, grantee_actor_id). La livraison S1A
 *    (`@fisca/crypto-e2ee`, `KeyGrantStore`, `addActorGrant`, `revokeActorGrant`) garde UNE ligne PAR VERSION DE DEK et par
 *    acteur, et révoque par `revoked_at` (la rotation de DEK ré-emballe pour chaque acteur restant). L'unicité devient
 *    UNIQUE(grantee_role, grantee_actor_id, dek_version) ; `dek_version` est ajoutée et doit égaler la version portée par
 *    l'en-tête `v1:<version>:<base64url>` des deux enveloppes (CHECK LIKE), ce qui garde le champ et l'enveloppe d'accord.
 *    `grantee_public_key_fingerprint_hex` (SHA-256 hexadécimal de la clé publique, `publicKeyFingerprintHex`) est ajoutée :
 *    elle entre dans le label OAEP de chaque enveloppe, l'adaptateur la calcule à l'insertion (KeyGrantRecord ne la porte pas).
 * 2. `fiscal_partners.cin_bidx` est ajoutée (Doc_06 ne pose que `cin_enc`) : un champ sensible `_enc` consultable par
 *    valeur exacte porte son index aveugle (Doc_10 § 04).
 * 3. `invoices` : CHECK d'origine obligatoire sur l'avoir 381 et la note de débit 383 (commentaire de Doc_06, règle de
 *    `CreateInvoiceRequestSchema`, Doc_07 § 11) ; CHECK 0/1 sur les booléens ; `pii_restricted_flag` (ERRATA D-19).
 * 4. `invoice_lines` : CHECK `quantity_milli > 0`, `unit_price_cents >= 0`, `discount_bps BETWEEN 0 AND 10000`
 *    (`MilliIntSchema`, `CentimesIntSchema.nonnegative()`, `BpsIntSchema`, Doc_07 § 11).
 * `clearance_state` et `cdv_lifecycle_status` gardent leur DEFAULT sans CHECK, comme Doc_06 : Doc_02 § 02 (« 8 statuts »)
 * en liste davantage et ne répartit pas ces états entre les deux colonnes ; aucune liste n'est devinée ici.
 */

import { VAT_RATE_BPS_VALUES } from './control-plane.ts';

/** Rôles des destinataires d'enveloppes (Doc_06 § 03 ; mêmes valeurs que `GRANTEE_ROLES` de `@fisca/crypto-e2ee`). */
export const TENANT_GRANTEE_ROLES = ['OWNER_ADMIN', 'EXTERNAL_CPA', 'ERP_CONNECTOR_AGENT', 'DGI_AUDIT_ESCROW'] as const;
export const PARTNER_ROLES = ['CLIENT', 'FOURNISSEUR', 'MIXTE', 'BAILLEUR'] as const;
export const PARTNER_TAX_CATEGORIES = [
  'COMPANY_IS',
  'INDIVIDUAL_IR_PRO',
  'AUTO_ENTREPRENEUR',
  'INDIVIDUAL_B2C',
  'PUBLIC_ENTITY',
  'FOREIGN_NON_RESIDENT',
] as const;
export const PURCHASE_ORDER_STATUSES = ['OPEN', 'PARTIAL', 'MATCHED', 'CLOSED'] as const;
export const INVOICE_DIRECTIONS = ['EMISE', 'RECUE'] as const;
export const UBL_TYPE_CODES = ['380_FACTURE', '381_AVOIR', '383_NOTE_DEBIT', '386_ACOMPTE', '389_AUTOFACTURATION'] as const;
export const UBL_PAYMENT_CODES = ['10_ESPECES', '20_CHEQUE', '30_VIREMENT', '42_EFFET_LCN', '48_CARTE', '97_COMPENSATION'] as const;
export const THREE_WAY_MATCH_STATUSES = ['N_A', 'MATCHED', 'ECART_BLOQUE'] as const;
export const RIB_CHECK_STATUSES = ['OK', 'ALERTE_RIB_DAF', 'DUAL_SIGNED_OK'] as const;
export const DISPUTE_STATUSES = ['NONE', 'CONTESTEE_DOCUMENTEE'] as const;
/** États persistés de la session de caisse (Doc_06 § 04 ; Doc_02 § 13 : CAISSE_FERMEE est l'absence de ligne, pas un statut). */
export const POS_SESSION_STATUSES = ['SESSION_OUVERTE_ACTIVE', 'COMPTAGE_AVEUGLE_PRE_Z', 'CLOTURE_TICKET_Z_SCELLEE'] as const;
export const POS_TICKET_KINDS = ['SALE_B2C', 'RETURN_REFUND'] as const;
export const POS_B2B_CONVERSION_STATES = ['NONE', 'CONVERTI_B2B_AVANT_Z', 'CONVERTI_B2B_POST_Z_NEUTRALISE'] as const;

export interface TenantMigration {
  readonly version: number;
  readonly name: string;
  readonly upSqlStatements: readonly string[];
  /** SHA-256 hexadécimal de `upSqlStatements.join("\n")`. */
  readonly expectedSha256Hex: string;
  /** Tables créées par CETTE migration, dans leur ordre de création (métadonnée hors empreinte). */
  readonly tableNames: readonly string[];
  /** Index nommés créés par CETTE migration (hors index automatiques des contraintes). */
  readonly indexNames: readonly string[];
}

function quoteList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/** CHECK d'entier strict (Loi 1) : refuse 12.5, '12.5' et 'abc'. Vrai pour NULL, donc valable sur une colonne nullable. */
function integerCheck(column: string): string {
  return `CHECK (${column} = CAST(${column} AS INTEGER))`;
}

function booleanCheck(column: string): string {
  return `CHECK (${column} IN (0, 1))`;
}

// ---------------------------------------------------------------------------
// Migration 1 : TENANT_DB Partie 1 (Doc_06 § 03)
// ---------------------------------------------------------------------------

const CREATE_TENANT_KEY_GRANTS = `CREATE TABLE tenant_key_grants (
    grant_id TEXT PRIMARY KEY,
    grantee_role TEXT NOT NULL CHECK (grantee_role IN (${quoteList(TENANT_GRANTEE_ROLES)})),
    grantee_actor_id TEXT NOT NULL,
    grantee_public_key_spki_b64 TEXT NOT NULL,
    grantee_public_key_fingerprint_hex TEXT NOT NULL CHECK (
        length(grantee_public_key_fingerprint_hex) = 64 AND grantee_public_key_fingerprint_hex = lower(grantee_public_key_fingerprint_hex)
    ),
    dek_version INTEGER NOT NULL CHECK (dek_version >= 1) ${integerCheck('dek_version')},
    wrapped_dek_b64 TEXT NOT NULL CHECK (wrapped_dek_b64 LIKE '%:' || dek_version || ':%'),
    wrapped_bidx_key_b64 TEXT NOT NULL CHECK (wrapped_bidx_key_b64 LIKE '%:' || dek_version || ':%'),
    shamir_share_index INTEGER CHECK (shamir_share_index BETWEEN 1 AND 3) ${integerCheck('shamir_share_index')},
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    UNIQUE(grantee_role, grantee_actor_id, dek_version)
)`;

const CREATE_FISCAL_PARTNERS = `CREATE TABLE fiscal_partners (
    id TEXT PRIMARY KEY,
    partner_role TEXT NOT NULL CHECK (partner_role IN (${quoteList(PARTNER_ROLES)})),
    tax_category TEXT NOT NULL CHECK (tax_category IN (${quoteList(PARTNER_TAX_CATEGORIES)})),
    dgi_public_client_type INTEGER NOT NULL DEFAULT 5 CHECK (dgi_public_client_type BETWEEN 1 AND 5) ${integerCheck('dgi_public_client_type')},
    legal_name_enc TEXT NOT NULL,
    legal_name_ar_enc TEXT,
    ice_enc TEXT,
    ice_bidx TEXT UNIQUE,
    if_enc TEXT,
    if_bidx TEXT,
    cin_enc TEXT,
    cin_bidx TEXT,
    rc_number TEXT,
    rc_tribunal TEXT,
    cnss_number TEXT,
    taxe_pro TEXT,
    dgi_profession_code INTEGER ${integerCheck('dgi_profession_code')},
    nationality_code TEXT NOT NULL DEFAULT 'MA',
    address_adc450_enc TEXT NOT NULL,
    rib_24_verified_enc TEXT,
    rib_24_bidx TEXT,
    tax_clearance_cert_num TEXT,
    tax_clearance_issued_date TEXT,
    agreed_payment_days INTEGER NOT NULL DEFAULT 60 CHECK (agreed_payment_days BETWEEN 1 AND 180) ${integerCheck('agreed_payment_days')},
    pcge_auxiliary_account TEXT NOT NULL,
    created_at TEXT NOT NULL
)`;

const CREATE_PURCHASE_ORDERS = `CREATE TABLE purchase_orders (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES fiscal_partners(id),
    po_number TEXT NOT NULL UNIQUE,
    contract_wiki_slug TEXT,
    status TEXT NOT NULL CHECK (status IN (${quoteList(PURCHASE_ORDER_STATUSES)})),
    total_ht_cents INTEGER NOT NULL CHECK (total_ht_cents >= 0) ${integerCheck('total_ht_cents')},
    lines_json TEXT NOT NULL,
    created_at TEXT NOT NULL
)`;

const CREATE_DELIVERY_NOTES = `CREATE TABLE delivery_notes (
    id TEXT PRIMARY KEY,
    po_id TEXT REFERENCES purchase_orders(id),
    partner_id TEXT NOT NULL REFERENCES fiscal_partners(id),
    bl_number TEXT NOT NULL,
    delivery_date TEXT NOT NULL,
    has_wet_stamp_verified INTEGER NOT NULL DEFAULT 0 ${booleanCheck('has_wet_stamp_verified')},
    r2_scan_key TEXT,
    lines_qty_milli_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(partner_id, bl_number)
)`;

const CREATE_INVOICES = `CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN (${quoteList(INVOICE_DIRECTIONS)})),
    ubl_type_code TEXT NOT NULL CHECK (ubl_type_code IN (${quoteList(UBL_TYPE_CODES)})),
    is_btp_progress_statement INTEGER NOT NULL DEFAULT 0 ${booleanCheck('is_btp_progress_statement')},
    origin_invoice_id TEXT REFERENCES invoices(id),
    pos_ticket_id TEXT UNIQUE,
    sequential_number TEXT UNIQUE,
    icv_counter INTEGER ${integerCheck('icv_counter')},
    partner_id TEXT NOT NULL REFERENCES fiscal_partners(id),
    po_id TEXT REFERENCES purchase_orders(id),
    issue_date TEXT NOT NULL,
    service_delivery_date TEXT NOT NULL,
    legal_due_date TEXT NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'MAD',
    bam_exchange_rate_micro INTEGER NOT NULL DEFAULT 1000000 ${integerCheck('bam_exchange_rate_micro')},
    total_ht_cents INTEGER NOT NULL CHECK (total_ht_cents >= 0) ${integerCheck('total_ht_cents')},
    total_debours_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_debours_cents >= 0) ${integerCheck('total_debours_cents')},
    total_vat_cents INTEGER NOT NULL CHECK (total_vat_cents >= 0) ${integerCheck('total_vat_cents')},
    ras_vat_cents INTEGER NOT NULL DEFAULT 0 CHECK (ras_vat_cents >= 0) ${integerCheck('ras_vat_cents')},
    ras_ir_or_is_cents INTEGER NOT NULL DEFAULT 0 CHECK (ras_ir_or_is_cents >= 0) ${integerCheck('ras_ir_or_is_cents')},
    stamp_duty_cents INTEGER NOT NULL DEFAULT 0 CHECK (stamp_duty_cents >= 0) ${integerCheck('stamp_duty_cents')},
    btp_retention_cents INTEGER NOT NULL DEFAULT 0 CHECK (btp_retention_cents >= 0) ${integerCheck('btp_retention_cents')},
    btp_retention_released_at TEXT,
    non_deductible_cash_ht_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('non_deductible_cash_ht_cents')},
    non_deductible_cash_vat_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('non_deductible_cash_vat_cents')},
    total_ttc_cents INTEGER NOT NULL CHECK (
        total_ht_cents + total_debours_cents + total_vat_cents + stamp_duty_cents = total_ttc_cents
    ) ${integerCheck('total_ttc_cents')},
    net_payable_cents INTEGER NOT NULL ${integerCheck('net_payable_cents')},
    paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0) ${integerCheck('paid_cents')},
    dgi_payment_method_id INTEGER NOT NULL CHECK (dgi_payment_method_id BETWEEN 1 AND 7) ${integerCheck('dgi_payment_method_id')},
    ubl_payment_code TEXT NOT NULL CHECK (ubl_payment_code IN (${quoteList(UBL_PAYMENT_CODES)})),
    clearance_state TEXT NOT NULL DEFAULT 'BROUILLON',
    cdv_lifecycle_status TEXT NOT NULL DEFAULT 'NONE',
    xhub_uuid TEXT UNIQUE,
    xhub_qr_payload TEXT,
    three_way_match_status TEXT NOT NULL DEFAULT 'N_A' CHECK (three_way_match_status IN (${quoteList(THREE_WAY_MATCH_STATUSES)})),
    rib_check_status TEXT NOT NULL DEFAULT 'OK' CHECK (rib_check_status IN (${quoteList(RIB_CHECK_STATUSES)})),
    dispute_status TEXT NOT NULL DEFAULT 'NONE' CHECK (dispute_status IN (${quoteList(DISPUTE_STATUSES)})),
    dispute_r2_proof_key TEXT,
    dedup_supplier_invoice_bidx TEXT UNIQUE,
    previous_pi_hash TEXT,
    sha256_hash TEXT,
    aip_archive_id TEXT,
    pii_restricted_flag INTEGER NOT NULL DEFAULT 0 ${booleanCheck('pii_restricted_flag')},
    created_at TEXT NOT NULL,
    CHECK (ubl_type_code NOT IN ('381_AVOIR', '383_NOTE_DEBIT') OR origin_invoice_id IS NOT NULL)
)`;

const CREATE_INVOICE_DELIVERY_LINKS = `CREATE TABLE invoice_delivery_links (
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    delivery_note_id TEXT NOT NULL REFERENCES delivery_notes(id),
    PRIMARY KEY (invoice_id, delivery_note_id)
)`;

const CREATE_INVOICE_LINES = `CREATE TABLE invoice_lines (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    line_number INTEGER NOT NULL ${integerCheck('line_number')},
    is_disbursement_debours INTEGER NOT NULL DEFAULT 0 ${booleanCheck('is_disbursement_debours')},
    description_fr_enc TEXT NOT NULL,
    description_ar_enc TEXT,
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0) ${integerCheck('quantity_milli')},
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0) ${integerCheck('unit_price_cents')},
    discount_bps INTEGER NOT NULL DEFAULT 0 CHECK (discount_bps BETWEEN 0 AND 10000) ${integerCheck('discount_bps')},
    vat_rate_bps INTEGER NOT NULL CHECK (vat_rate_bps IN (${VAT_RATE_BPS_VALUES.join(', ')})) ${integerCheck('vat_rate_bps')},
    vat_exemption_reason_code TEXT,
    line_ht_cents INTEGER NOT NULL ${integerCheck('line_ht_cents')},
    line_vat_cents INTEGER NOT NULL ${integerCheck('line_vat_cents')},
    pcge_account_number TEXT NOT NULL,
    UNIQUE(invoice_id, line_number)
)`;

/** Index nommés de Doc_06 § 08 qui portent sur la partie 1, par migration. */
const MIGRATION_1_INDEXES: readonly (readonly [string, string])[] = [
  ['idx_partners_ice_bidx', 'CREATE INDEX idx_partners_ice_bidx ON fiscal_partners (ice_bidx)'],
  ['idx_invoices_dedup_bidx', 'CREATE INDEX idx_invoices_dedup_bidx ON invoices (dedup_supplier_invoice_bidx)'],
  ['idx_inv_partner_date_dir', 'CREATE INDEX idx_inv_partner_date_dir ON invoices (partner_id, direction, issue_date)'],
];

const MIGRATION_1_TABLES: readonly string[] = [
  'tenant_key_grants',
  'fiscal_partners',
  'purchase_orders',
  'delivery_notes',
  'invoices',
  'invoice_delivery_links',
  'invoice_lines',
];

const MIGRATION_1_STATEMENTS: readonly string[] = [
  CREATE_TENANT_KEY_GRANTS,
  CREATE_FISCAL_PARTNERS,
  CREATE_PURCHASE_ORDERS,
  CREATE_DELIVERY_NOTES,
  CREATE_INVOICES,
  CREATE_INVOICE_DELIVERY_LINKS,
  CREATE_INVOICE_LINES,
  ...MIGRATION_1_INDEXES.map(([, sql]) => sql),
];


// ---------------------------------------------------------------------------
// Migration 2 : TENANT_DB Partie 2, caisse Fisca POS (Doc_06 § 04, Doc_02 § 13)
//
// Ces trois tables vivent aussi dans le SQLite WASM (OPFS) du terminal : le DDL reste du SQLite portable.
// Doc_06 § 04 ne définit AUCUN trigger : aucun n'est créé ici (l'inviolabilité repose sur le chaînage SHA-256, la signature
// ECDSA vérifiée par le serveur à la synchronisation et l'interdiction de mutation de Doc_06 § 10, « retour par avoir lié »).
// ÉCARTS ASSUMÉS AVEC Doc_06 § 04 (chacun testé) :
// 1. `pos_tickets.ecdsa_signature_b64` (NOT NULL) est ajoutée : Doc_06 ne porte pas la signature ECDSA P-256 que la skill
//    fisca-pos-offline-sce § 2 et la Loi 9 exigent de chaque ticket (signature WebCrypto, clé non extractible) ;
// 2. `ticket_sha256` et `z_sha256` : CHECK 64 caractères en minuscules (SHA-256 hexadécimal, comme les empreintes de v1) ;
// 3. `RETURN_REFUND` exige `origin_ticket_id` (skill § 3 : « un retour se fait par ticket d'avoir lié », comme l'avoir 381) ;
// 4. `expected_closing_cash_cents` et `blind_counted_cash_cents` >= 0 (caisse 5161 jamais négative, Loi 3) ;
// 5. aucun `vat_rate_bps` n'existe dans ces tables (ventilation en colonnes ht_20, ht_10, ht_0 de Doc_06), donc aucun CHECK de
//    taux ; aucun `pii_restricted_flag` (Doc_11 § 06 ne vise que Factur-X, grand livre, état 9421 et DRVT) ; aucun index
//    nommé (Doc_06 § 08 n'en cite aucun pour la caisse).
// ---------------------------------------------------------------------------

const CREATE_POS_SESSIONS = `CREATE TABLE pos_sessions (
    id TEXT PRIMARY KEY,
    terminal_id TEXT NOT NULL,
    cashier_user_id TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    opening_float_cents INTEGER NOT NULL CHECK (opening_float_cents >= 0) ${integerCheck('opening_float_cents')},
    expected_closing_cash_cents INTEGER NOT NULL DEFAULT 0 CHECK (expected_closing_cash_cents >= 0) ${integerCheck('expected_closing_cash_cents')},
    blind_counted_cash_cents INTEGER CHECK (blind_counted_cash_cents >= 0) ${integerCheck('blind_counted_cash_cents')},
    cash_variance_cents INTEGER ${integerCheck('cash_variance_cents')},
    status TEXT NOT NULL CHECK (status IN (${quoteList(POS_SESSION_STATUSES)}))
)`;

const CREATE_POS_TICKETS = `CREATE TABLE pos_tickets (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES pos_sessions(id),
    terminal_id TEXT NOT NULL,
    terminal_seq_number TEXT NOT NULL UNIQUE,
    issued_at TEXT NOT NULL,
    ticket_kind TEXT NOT NULL CHECK (ticket_kind IN (${quoteList(POS_TICKET_KINDS)})),
    origin_ticket_id TEXT REFERENCES pos_tickets(id),
    ht_20_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('ht_20_cents')},
    vat_20_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('vat_20_cents')},
    ht_10_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('ht_10_cents')},
    vat_10_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('vat_10_cents')},
    ht_0_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('ht_0_cents')},
    stamp_duty_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('stamp_duty_cents')},
    total_ttc_cents INTEGER NOT NULL CHECK (total_ttc_cents >= 0) ${integerCheck('total_ttc_cents')},
    paid_cash_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('paid_cash_cents')},
    paid_card_tpe_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('paid_card_tpe_cents')},
    paid_delivery_app_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('paid_delivery_app_cents')},
    qr_conversion_token TEXT NOT NULL UNIQUE,
    b2b_conversion_state TEXT NOT NULL DEFAULT 'NONE' CHECK (b2b_conversion_state IN (${quoteList(POS_B2B_CONVERSION_STATES)})),
    converted_invoice_id TEXT REFERENCES invoices(id),
    prev_ticket_sha256 TEXT NOT NULL,
    ticket_sha256 TEXT NOT NULL CHECK (length(ticket_sha256) = 64 AND ticket_sha256 = lower(ticket_sha256)),
    ecdsa_signature_b64 TEXT NOT NULL,
    CHECK (ticket_kind <> 'RETURN_REFUND' OR origin_ticket_id IS NOT NULL)
)`;

const CREATE_POS_Z_CLOSURES = `CREATE TABLE pos_z_closures (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE REFERENCES pos_sessions(id),
    terminal_id TEXT NOT NULL,
    closure_number INTEGER NOT NULL ${integerCheck('closure_number')},
    business_date TEXT NOT NULL,
    net_b2c_ht_20_cents INTEGER NOT NULL ${integerCheck('net_b2c_ht_20_cents')},
    net_b2c_vat_20_cents INTEGER NOT NULL ${integerCheck('net_b2c_vat_20_cents')},
    net_b2c_ht_10_cents INTEGER NOT NULL ${integerCheck('net_b2c_ht_10_cents')},
    net_b2c_vat_10_cents INTEGER NOT NULL ${integerCheck('net_b2c_vat_10_cents')},
    net_b2c_ht_0_cents INTEGER NOT NULL ${integerCheck('net_b2c_ht_0_cents')},
    total_stamp_duty_cents INTEGER NOT NULL ${integerCheck('total_stamp_duty_cents')},
    tpe_gross_cents INTEGER NOT NULL ${integerCheck('tpe_gross_cents')},
    gl_journal_entry_id TEXT,
    aip_archive_id TEXT,
    prev_z_sha256 TEXT NOT NULL,
    z_sha256 TEXT NOT NULL CHECK (length(z_sha256) = 64 AND z_sha256 = lower(z_sha256)),
    UNIQUE(terminal_id, closure_number)
)`;

const MIGRATION_2_TABLES: readonly string[] = ['pos_sessions', 'pos_tickets', 'pos_z_closures'];

const MIGRATION_2_STATEMENTS: readonly string[] = [CREATE_POS_SESSIONS, CREATE_POS_TICKETS, CREATE_POS_Z_CLOSURES];

/**
 * Migrations versionnées de TENANT_DB, dans l'ordre d'application.
 * IMMUABLES une fois appliquées : T-S1B-04 (grand livre) et 05 (sous-livres) AJOUTENT les versions 3 et 4
 * à ce tableau, sans toucher aux versions 1 et 2.
 */
export const TENANT_MIGRATIONS: readonly TenantMigration[] = [
  {
    version: 1,
    name: 'tenant_part1_keys_partners_clearance',
    upSqlStatements: MIGRATION_1_STATEMENTS,
    expectedSha256Hex: 'a554a3477c4d1e3561b81e72e243fc72e2be519d155a3120a497ef0d93a04f61',
    tableNames: MIGRATION_1_TABLES,
    indexNames: MIGRATION_1_INDEXES.map(([name]) => name),
  },
  {
    version: 2,
    name: 'tenant_part2_pos_sessions_tickets_z',
    upSqlStatements: MIGRATION_2_STATEMENTS,
    expectedSha256Hex: 'bfb09b92f078d2796cc62c0604bbc50d9bf3b5f7dffc3539704b564dca15b581',
    tableNames: MIGRATION_2_TABLES,
    indexNames: [],
  },
];

/** Tables de TENANT_DB dans leur ordre de création (les parents précèdent les enfants), toutes migrations confondues. */
export const TENANT_TABLE_NAMES: readonly string[] = TENANT_MIGRATIONS.flatMap((migration) => migration.tableNames);

/** Index nommés créés par les migrations de TENANT_DB, dans leur ordre de création. */
export const TENANT_INDEX_NAMES: readonly string[] = TENANT_MIGRATIONS.flatMap((migration) => migration.indexNames);

/**
 * Équivalent PostgreSQL 16 des instructions d'une migration (ERRATA D-11 : la parité se prouve par le comportement, pas par
 * un DDL identique). Deux différences, toutes deux de typage :
 * - `INTEGER` devient `BIGINT` : INTEGER est sur 32 bits sous PostgreSQL (plafond de 21 474 836,47 MAD en centimes) alors
 *   que SQLite stocke 64 bits ;
 * - le CHECK d'entier strict est retiré : une colonne BIGINT refuse déjà une valeur non entière (SQLSTATE 22P02), et
 *   `CAST(col AS INTEGER)` y déborderait au-delà de 2^31.
 * Les empreintes (`expectedSha256Hex`) restent celles du DDL SQLite, source de vérité.
 */
export function tenantMigrationPostgresStatements(migration: TenantMigration): readonly string[] {
  return migration.upSqlStatements.map((statement) =>
    statement
      .replace(/ CHECK \((\w+) = CAST\(\1 AS INTEGER\)\)/g, '')
      .replace(/\bINTEGER\b/g, 'BIGINT'),
  );
}
