/**
 * DDL SQLite de TENANT_DB (une base par société : Cloudflare D1 ou PostgreSQL 16), Partie 1 : Doc_06 § 03
 * (enveloppes de clés E2EE, référentiel des tiers, commandes, bons de livraison, factures et lignes), ticket T-S1B-02.
 * Les tickets suivants AJOUTENT des migrations au tableau `TENANT_MIGRATIONS` : la v2 (T-S1B-03) porte la caisse Fisca POS
 * (Doc_06 § 04), la v3 (T-S1B-04) le grand livre CGNC immuable, sa vue à 6 colonnes et ses triggers PAF (Doc_06 § 05) ; les
 * sous-livres suivent en v4.
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
  /** Triggers créés par CETTE migration, dans leur ordre de création ; absent des migrations v1 et v2 (aucun trigger). */
  readonly triggerNames?: readonly string[];
  /** Vues créées par CETTE migration ; absent des migrations v1 et v2 (aucune vue). */
  readonly viewNames?: readonly string[];
  /**
   * Instructions PostgreSQL 16 qui REMPLACENT la traduction mécanique de l'instruction de même rang dans `upSqlStatements`
   * (triggers PL/pgSQL, vue à colonnes BIGINT). Clé = rang de l'instruction SQLite ; absent des migrations v1 et v2.
   */
  readonly postgresOverrides?: Readonly<Record<number, string>>;
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

// ---------------------------------------------------------------------------
// Migration 3 : TENANT_DB Partie 3, grand livre CGNC immuable (Doc_06 § 05, ERRATA D-03, D-04, D-10, D-11, D-19)
//
// Objets du registre : 7 tables, la vue `v_cgnc_trial_balance_6col` (balance à 6 colonnes SIMPL-IS v2.0.3) et les 5 triggers
// PAF de Doc_06 (texte des RAISE repris à l'identique), plus UN trigger hors Doc_06 : `prevent_direct_posted_insert` (ERRATA D-03).
// Flux légitime : INSERT au statut initial (IA_PROPOSITION, DRAFT, REVISEE_CYCLE), lignes, puis UPDATE contrôlé vers POSTED qui
// porte `entry_hash` et `previous_entry_hash` ; `prevent_posted_entry_update` ne vise que les UPDATE d'une pièce DÉJÀ POSTED
// (OLD.status = 'POSTED'), `enforce_balance_and_positive_cash_on_post` que le passage vers POSTED (OLD <> POSTED, NEW = POSTED).
// La contre-passation n'est PAS un statut (D-03) : le CHECK de `status` n'admet pas CONTRE_PASSEE.
// PostgreSQL 16 (D-11) : chaque trigger SQLite a un équivalent PL/pgSQL qui lève le MÊME texte (RAISE EXCEPTION, SQLSTATE
// P0001) ; la vue y convertit les SUM en BIGINT (SUM(bigint) est NUMERIC sous PostgreSQL).
// ÉCARTS ASSUMÉS AVEC Doc_06 § 05 (chacun testé) :
// 1. `pii_restricted_flag` (ERRATA D-19, Doc_11 § 06 : « Factur-X, Grand Livre, État 9421, DRVT ») sur `journal_entries` et
//    `journal_entry_lines`, INTEGER 0/1 NOT NULL DEFAULT 0. Ces deux tables SONT le Grand Livre (les lignes portent
//    `description_enc`, la pièce le tiers). Le trigger d'immuabilité interdit ensuite tout UPDATE de la pièce POSTED, drapeau
//    compris : le drapeau se pose avant le scellement ou à la création. Ni `bank_transactions` ni `fixed_assets_register` :
//    ce ne sont pas des pièces du Grand Livre et Doc_11 ne les cite pas ;
// 2. CHECK d'entier strict sur chaque colonne entière ; bornes 0 à 10000 sur les prorata et taux en bps ; montants >= 0 sur
//    `fixed_assets_register` ; `closing_hash` et `entry_hash` en SHA-256 hexadécimal minuscule (comme les empreintes de v2) ;
// 3. `journal_entries` : CHECK d'origine obligatoire sur une pièce REVERSAL (comme l'avoir 381 de v1) et CHECK qu'une pièce ne se
//    contre-passe pas elle-même ; `cgnc_accounts.account_number` : longueur de 4 à 8 (Doc_06 le précise en commentaire) ;
//    `fixed_assets_register.asset_account_number` commence par 2 (« Classe 2 » en commentaire de Doc_06) ;
// 4. aucune colonne de taux de TVA (`vat_rate_bps`) ni de prorata en pourcentage (`deduction_prorata_pct`) dans ces tables :
//    `fiscal_years` et `fixed_assets_register` gardent les bps de Doc_06 (D-10) ;
// 5. `journal_entry_lines` : Doc_06 place le CHECK de table « un seul côté, débit ou crédit » entre deux colonnes, ce que SQLite
//    refuse (« near is_tax_deductible: syntax error ») : le CHECK, inchangé, passe après la dernière colonne ;
// 6. Doc_06 ne fixe AUCUN trigger ni CHECK sur l'exercice CLOSED : aucun n'est créé (une pièce reste insérable dans un exercice
//    clos tant qu'une règle n'est pas arbitrée) ; l'INSERT de lignes dans une pièce POSTED n'est pas non plus visé par les 5
//    triggers de Doc_06 ; ni l'un ni l'autre n'est comblé ici sans arbitrage.
// ---------------------------------------------------------------------------

export const FISCAL_YEAR_STATUSES = ['OPEN', 'CLOSING', 'CLOSED'] as const;
export const LEDGER_JOURNAL_TYPES = ['OPENING', 'PURCHASE', 'SALE', 'BANK', 'CASH', 'GENERAL'] as const;
export const CGNC_NORMAL_BALANCES = ['DEBIT', 'CREDIT'] as const;
export const CGNC_VAT_REGIME_ROLES = [
  'NONE',
  'VAT_COLLECTED_PENDING',
  'VAT_COLLECTED_DUE',
  'VAT_RECOVERABLE_PENDING',
  'VAT_RECOVERABLE_CHARGES',
  'VAT_RECOVERABLE_IMMOB',
] as const;
export const LEDGER_REVIEW_CYCLES = ['TRESORERIE', 'ACHATS', 'VENTES', 'PAIE_SOCIAL', 'FISCAL', 'GENERAL'] as const;
/** Statuts persistés d'une pièce (ERRATA D-03 : CONTRE_PASSEE n'existe pas, la contre-passation est une nouvelle écriture). */
export const LEDGER_STATUSES = ['IA_PROPOSITION', 'DRAFT', 'REVISEE_CYCLE', 'POSTED'] as const;
export const LEDGER_SOURCE_DOCUMENT_TYPES = [
  'INVOICE',
  'CREDIT_NOTE',
  'POS_Z_CLOSURE',
  'B2C_TO_B2B_REVERSAL',
  'PAYMENT',
  'VAT_CLEARING',
  'CUTOFF_OD',
  'REVERSAL',
] as const;
export const BANK_RECONCILIATION_STATES = ['UNMATCHED', 'SUSPENS_AMBIGU_3497_4497', 'MATCHED_PARTIAL', 'MATCHED_FULL'] as const;

/** Textes des RAISE de Doc_06 § 05 (les cinq premiers, repris tels quels) et du trigger D-03 ; identiques sous PostgreSQL. */
export const LEDGER_TRIGGER_MESSAGES = {
  entryUpdate: 'VIOLATION_PAF_CGI_ART_145: Écriture validée immuable. Utilisez une contre-passation.',
  entryDelete: 'VIOLATION_PAF_CGI_ART_145: Suppression interdite sur le Grand Livre.',
  lineUpdate: 'VIOLATION_PAF_CGI_ART_145: Modification de ligne interdite sur pièce POSTED.',
  lineDelete: 'VIOLATION_PAF_CGI_ART_145: Suppression de ligne interdite sur pièce POSTED.',
  unbalanced: 'CGNC_UNBALANCED_LINES: La somme des lignes ne boucle pas avec le total de la pièce.',
  missingHash: 'PAF_MISSING_HASH: Empreinte SHA-256 obligatoire pour sceller en POSTED.',
  negativeCash: 'CGNC_NEGATIVE_CASH_5161: Décaissement refusé car il rendrait le solde de caisse 5161 créditeur.',
  directPostedInsert: 'VIOLATION_PAF_CGI_ART_145: Insertion directe au statut POSTED interdite. Créez la pièce en brouillon puis validez-la.',
} as const;

const SHA256_HEX_CHECK = (column: string): string =>
  `CHECK (${column} IS NULL OR (length(${column}) = 64 AND ${column} = lower(${column})))`;

const CREATE_FISCAL_YEARS = `CREATE TABLE fiscal_years (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (${quoteList(FISCAL_YEAR_STATUSES)})),
    simpl_is_model INTEGER NOT NULL DEFAULT 1 CHECK (simpl_is_model BETWEEN 1 AND 4) ${integerCheck('simpl_is_model')},
    provisional_vat_prorata_bps INTEGER NOT NULL DEFAULT 10000 CHECK (provisional_vat_prorata_bps BETWEEN 0 AND 10000) ${integerCheck('provisional_vat_prorata_bps')},
    definitive_vat_prorata_bps INTEGER CHECK (definitive_vat_prorata_bps BETWEEN 0 AND 10000) ${integerCheck('definitive_vat_prorata_bps')},
    closing_hash TEXT ${SHA256_HEX_CHECK('closing_hash')}
)`;

const CREATE_JOURNALS = `CREATE TABLE journals (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    journal_type TEXT NOT NULL CHECK (journal_type IN (${quoteList(LEDGER_JOURNAL_TYPES)})),
    last_sequence_number INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence_number >= 0) ${integerCheck('last_sequence_number')},
    last_entry_hash TEXT NOT NULL DEFAULT 'GENESIS_HASH_00000000000000000000000000000000'
)`;

const CREATE_CGNC_ACCOUNTS = `CREATE TABLE cgnc_accounts (
    id TEXT PRIMARY KEY,
    account_number TEXT NOT NULL UNIQUE CHECK (length(account_number) BETWEEN 4 AND 8),
    label_fr TEXT NOT NULL,
    label_ar TEXT,
    cgnc_class INTEGER NOT NULL CHECK (cgnc_class BETWEEN 1 AND 8) ${integerCheck('cgnc_class')},
    normal_balance TEXT NOT NULL CHECK (normal_balance IN (${quoteList(CGNC_NORMAL_BALANCES)})),
    is_reconcilable INTEGER NOT NULL DEFAULT 0 ${booleanCheck('is_reconcilable')},
    vat_regime_role TEXT NOT NULL DEFAULT 'NONE' CHECK (vat_regime_role IN (${quoteList(CGNC_VAT_REGIME_ROLES)}))
)`;

const CREATE_JOURNAL_ENTRIES = `CREATE TABLE journal_entries (
    id TEXT PRIMARY KEY,
    fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
    journal_id TEXT NOT NULL REFERENCES journals(id),
    sequence_number INTEGER NOT NULL ${integerCheck('sequence_number')},
    entry_reference TEXT NOT NULL UNIQUE,
    entry_date TEXT NOT NULL,
    validated_at TEXT,
    review_cycle TEXT NOT NULL DEFAULT 'GENERAL' CHECK (review_cycle IN (${quoteList(LEDGER_REVIEW_CYCLES)})),
    status TEXT NOT NULL DEFAULT 'IA_PROPOSITION' CHECK (status IN (${quoteList(LEDGER_STATUSES)})),
    source_document_type TEXT NOT NULL CHECK (source_document_type IN (${quoteList(LEDGER_SOURCE_DOCUMENT_TYPES)})),
    invoice_id TEXT REFERENCES invoices(id),
    dgi_clearance_uuid TEXT,
    partner_id TEXT REFERENCES fiscal_partners(id),
    reversal_of_entry_id TEXT REFERENCES journal_entries(id),
    total_debit_cents INTEGER NOT NULL CHECK (total_debit_cents > 0) ${integerCheck('total_debit_cents')},
    total_credit_cents INTEGER NOT NULL CHECK (total_credit_cents = total_debit_cents) ${integerCheck('total_credit_cents')},
    previous_entry_hash TEXT,
    entry_hash TEXT ${SHA256_HEX_CHECK('entry_hash')},
    pii_restricted_flag INTEGER NOT NULL DEFAULT 0 ${booleanCheck('pii_restricted_flag')},
    CHECK (source_document_type <> 'REVERSAL' OR reversal_of_entry_id IS NOT NULL),
    CHECK (reversal_of_entry_id IS NULL OR reversal_of_entry_id <> id),
    UNIQUE(journal_id, fiscal_year_id, sequence_number)
)`;

const CREATE_JOURNAL_ENTRY_LINES = `CREATE TABLE journal_entry_lines (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES journal_entries(id),
    line_number INTEGER NOT NULL ${integerCheck('line_number')},
    account_id TEXT NOT NULL REFERENCES cgnc_accounts(id),
    auxiliary_account TEXT,
    description_enc TEXT NOT NULL,
    debit_cents INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0) ${integerCheck('debit_cents')},
    credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0) ${integerCheck('credit_cents')},
    is_tax_deductible INTEGER NOT NULL DEFAULT 1 ${booleanCheck('is_tax_deductible')},
    table3_reintegration_code TEXT,
    reconciliation_code TEXT,
    reconciled_at TEXT,
    pii_restricted_flag INTEGER NOT NULL DEFAULT 0 ${booleanCheck('pii_restricted_flag')},
    CHECK ((debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0)),
    UNIQUE(entry_id, line_number)
)`;

const CREATE_BANK_TRANSACTIONS = `CREATE TABLE bank_transactions (
    id TEXT PRIMARY KEY,
    bank_code TEXT NOT NULL,
    statement_date TEXT NOT NULL,
    value_date TEXT NOT NULL,
    raw_label_enc TEXT NOT NULL,
    reference_code TEXT,
    amount_cents INTEGER NOT NULL ${integerCheck('amount_cents')},
    reconciliation_state TEXT NOT NULL DEFAULT 'UNMATCHED' CHECK (reconciliation_state IN (${quoteList(BANK_RECONCILIATION_STATES)})),
    reconciliation_code TEXT,
    gl_entry_id TEXT REFERENCES journal_entries(id)
)`;

const CREATE_FIXED_ASSETS_REGISTER = `CREATE TABLE fixed_assets_register (
    id TEXT PRIMARY KEY,
    acquisition_invoice_id TEXT REFERENCES invoices(id),
    asset_account_number TEXT NOT NULL CHECK (asset_account_number LIKE '2%'),
    label_enc TEXT NOT NULL,
    acquisition_date TEXT NOT NULL,
    acquisition_ht_cents INTEGER NOT NULL CHECK (acquisition_ht_cents >= 0) ${integerCheck('acquisition_ht_cents')},
    acquisition_ttc_cents INTEGER NOT NULL CHECK (acquisition_ttc_cents >= 0) ${integerCheck('acquisition_ttc_cents')},
    is_passenger_vehicle INTEGER NOT NULL DEFAULT 0 ${booleanCheck('is_passenger_vehicle')},
    fiscal_depreciable_cap_cents INTEGER CHECK (fiscal_depreciable_cap_cents >= 0) ${integerCheck('fiscal_depreciable_cap_cents')},
    initial_vat_deducted_cents INTEGER NOT NULL DEFAULT 0 CHECK (initial_vat_deducted_cents >= 0) ${integerCheck('initial_vat_deducted_cents')},
    initial_prorata_bps INTEGER NOT NULL DEFAULT 10000 CHECK (initial_prorata_bps BETWEEN 0 AND 10000) ${integerCheck('initial_prorata_bps')},
    vat_retention_months_required INTEGER NOT NULL DEFAULT 60 CHECK (vat_retention_months_required > 0) ${integerCheck('vat_retention_months_required')},
    disposal_date TEXT,
    depreciation_rate_bps INTEGER NOT NULL CHECK (depreciation_rate_bps BETWEEN 0 AND 10000) ${integerCheck('depreciation_rate_bps')}
)`;

/** Index nommés de Doc_06 § 08 qui portent sur le grand livre (extraction FEC-MA et balance). */
const MIGRATION_3_INDEXES: readonly (readonly [string, string])[] = [
  ['idx_je_fy_status_seq', 'CREATE INDEX idx_je_fy_status_seq ON journal_entries (fiscal_year_id, status, journal_id, sequence_number)'],
  ['idx_jel_entry_account', 'CREATE INDEX idx_jel_entry_account ON journal_entry_lines (entry_id, account_id)'],
];

const TRIAL_BALANCE_VIEW_NAME = 'v_cgnc_trial_balance_6col';

/** Vue de Doc_06 § 05, définition reprise telle quelle (SQLite). */
const CREATE_TRIAL_BALANCE_VIEW = `CREATE VIEW ${TRIAL_BALANCE_VIEW_NAME} AS
SELECT
    je.fiscal_year_id,
    ca.account_number,
    ca.cgnc_class,
    SUM(CASE WHEN j.journal_type = 'OPENING' THEN jel.debit_cents ELSE 0 END) AS opening_debit_cents,
    SUM(CASE WHEN j.journal_type = 'OPENING' THEN jel.credit_cents ELSE 0 END) AS opening_credit_cents,
    SUM(CASE WHEN j.journal_type != 'OPENING' THEN jel.debit_cents ELSE 0 END) AS mvt_debit_cents,
    SUM(CASE WHEN j.journal_type != 'OPENING' THEN jel.credit_cents ELSE 0 END) AS mvt_credit_cents,
    SUM(jel.debit_cents) AS total_debit_cents,
    SUM(jel.credit_cents) AS total_credit_cents,
    (SUM(jel.debit_cents) - SUM(jel.credit_cents)) AS net_balance_cents
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.entry_id
JOIN journals j ON j.id = je.journal_id
JOIN cgnc_accounts ca ON ca.id = jel.account_id
WHERE je.status = 'POSTED'
GROUP BY je.fiscal_year_id, ca.account_number, ca.cgnc_class`;

/** Même vue sous PostgreSQL 16 : mêmes colonnes et mêmes montants, SUM(bigint) étant NUMERIC, chaque somme est ramenée en BIGINT. */
const CREATE_TRIAL_BALANCE_VIEW_PG = `CREATE VIEW ${TRIAL_BALANCE_VIEW_NAME} AS
SELECT
    je.fiscal_year_id,
    ca.account_number,
    ca.cgnc_class,
    (SUM(CASE WHEN j.journal_type = 'OPENING' THEN jel.debit_cents ELSE 0 END))::BIGINT AS opening_debit_cents,
    (SUM(CASE WHEN j.journal_type = 'OPENING' THEN jel.credit_cents ELSE 0 END))::BIGINT AS opening_credit_cents,
    (SUM(CASE WHEN j.journal_type != 'OPENING' THEN jel.debit_cents ELSE 0 END))::BIGINT AS mvt_debit_cents,
    (SUM(CASE WHEN j.journal_type != 'OPENING' THEN jel.credit_cents ELSE 0 END))::BIGINT AS mvt_credit_cents,
    (SUM(jel.debit_cents))::BIGINT AS total_debit_cents,
    (SUM(jel.credit_cents))::BIGINT AS total_credit_cents,
    (SUM(jel.debit_cents) - SUM(jel.credit_cents))::BIGINT AS net_balance_cents
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.entry_id
JOIN journals j ON j.id = je.journal_id
JOIN cgnc_accounts ca ON ca.id = jel.account_id
WHERE je.status = 'POSTED'
GROUP BY je.fiscal_year_id, ca.account_number, ca.cgnc_class`;

interface LedgerTrigger {
  readonly name: string;
  readonly sqlite: string;
  readonly postgres: string;
}

/** Corps PL/pgSQL qui lève `message` ; SQLSTATE P0001 (RAISE EXCEPTION sans code explicite). */
function raiseSqlite(message: string): string {
  return `SELECT RAISE(ABORT, '${message}');`;
}

function postgresTrigger(name: string, event: string, table: string, when: string | null, body: string, declarations = ''): string {
  const clause = when === null ? '' : ` WHEN (${when})`;
  return `CREATE FUNCTION fisca_${name}() RETURNS trigger LANGUAGE plpgsql AS $fisca$
${declarations}BEGIN
${body}
END;
$fisca$;
CREATE TRIGGER ${name}
BEFORE ${event} ON ${table}
FOR EACH ROW${clause} EXECUTE FUNCTION fisca_${name}()`;
}

function raisePg(message: string): string {
  return `    RAISE EXCEPTION '%', '${message}';`;
}

const MESSAGES = LEDGER_TRIGGER_MESSAGES;

const MIGRATION_3_TRIGGERS: readonly LedgerTrigger[] = [
  {
    name: 'prevent_posted_entry_update',
    sqlite: `CREATE TRIGGER prevent_posted_entry_update
BEFORE UPDATE ON journal_entries
FOR EACH ROW WHEN OLD.status = 'POSTED'
BEGIN
    ${raiseSqlite(MESSAGES.entryUpdate)}
END`,
    postgres: postgresTrigger('prevent_posted_entry_update', 'UPDATE', 'journal_entries', `OLD.status = 'POSTED'`, raisePg(MESSAGES.entryUpdate)),
  },
  {
    name: 'prevent_posted_entry_delete',
    sqlite: `CREATE TRIGGER prevent_posted_entry_delete
BEFORE DELETE ON journal_entries
FOR EACH ROW WHEN OLD.status = 'POSTED'
BEGIN
    ${raiseSqlite(MESSAGES.entryDelete)}
END`,
    postgres: postgresTrigger('prevent_posted_entry_delete', 'DELETE', 'journal_entries', `OLD.status = 'POSTED'`, raisePg(MESSAGES.entryDelete)),
  },
  {
    name: 'prevent_posted_lines_mutation_update',
    sqlite: `CREATE TRIGGER prevent_posted_lines_mutation_update
BEFORE UPDATE ON journal_entry_lines
FOR EACH ROW WHEN (SELECT status FROM journal_entries WHERE id = OLD.entry_id) = 'POSTED'
BEGIN
    ${raiseSqlite(MESSAGES.lineUpdate)}
END`,
    postgres: postgresTrigger(
      'prevent_posted_lines_mutation_update',
      'UPDATE',
      'journal_entry_lines',
      null,
      `    IF (SELECT status FROM journal_entries WHERE id = OLD.entry_id) = 'POSTED' THEN
${raisePg(MESSAGES.lineUpdate)}
    END IF;
    RETURN NEW;`,
    ),
  },
  {
    name: 'prevent_posted_lines_mutation_delete',
    sqlite: `CREATE TRIGGER prevent_posted_lines_mutation_delete
BEFORE DELETE ON journal_entry_lines
FOR EACH ROW WHEN (SELECT status FROM journal_entries WHERE id = OLD.entry_id) = 'POSTED'
BEGIN
    ${raiseSqlite(MESSAGES.lineDelete)}
END`,
    postgres: postgresTrigger(
      'prevent_posted_lines_mutation_delete',
      'DELETE',
      'journal_entry_lines',
      null,
      `    IF (SELECT status FROM journal_entries WHERE id = OLD.entry_id) = 'POSTED' THEN
${raisePg(MESSAGES.lineDelete)}
    END IF;
    RETURN OLD;`,
    ),
  },
  {
    name: 'enforce_balance_and_positive_cash_on_post',
    sqlite: `CREATE TRIGGER enforce_balance_and_positive_cash_on_post
BEFORE UPDATE ON journal_entries
FOR EACH ROW WHEN OLD.status != 'POSTED' AND NEW.status = 'POSTED'
BEGIN
    SELECT CASE
        WHEN (SELECT COALESCE(SUM(debit_cents), 0) FROM journal_entry_lines WHERE entry_id = NEW.id) != NEW.total_debit_cents
          OR (SELECT COALESCE(SUM(credit_cents), 0) FROM journal_entry_lines WHERE entry_id = NEW.id) != NEW.total_credit_cents
        THEN RAISE(ABORT, '${MESSAGES.unbalanced}')
        WHEN NEW.entry_hash IS NULL OR NEW.previous_entry_hash IS NULL
        THEN RAISE(ABORT, '${MESSAGES.missingHash}')
        WHEN EXISTS (
            SELECT 1 FROM journal_entry_lines jel
            JOIN cgnc_accounts ca ON ca.id = jel.account_id
            WHERE jel.entry_id = NEW.id AND ca.account_number LIKE '5161%' AND jel.credit_cents > 0
        ) AND (
            (SELECT COALESCE(SUM(jel2.debit_cents - jel2.credit_cents), 0)
             FROM journal_entry_lines jel2
             JOIN journal_entries je2 ON je2.id = jel2.entry_id
             JOIN cgnc_accounts ca2 ON ca2.id = jel2.account_id
             WHERE (je2.status = 'POSTED' OR je2.id = NEW.id) AND ca2.account_number LIKE '5161%') < 0
        )
        THEN RAISE(ABORT, '${MESSAGES.negativeCash}')
    END;
END`,
    postgres: postgresTrigger(
      'enforce_balance_and_positive_cash_on_post',
      'UPDATE',
      'journal_entries',
      `OLD.status <> 'POSTED' AND NEW.status = 'POSTED'`,
      `    SELECT COALESCE(SUM(debit_cents), 0), COALESCE(SUM(credit_cents), 0) INTO lines_debit, lines_credit
    FROM journal_entry_lines WHERE entry_id = NEW.id;
    IF lines_debit <> NEW.total_debit_cents OR lines_credit <> NEW.total_credit_cents THEN
${raisePg(MESSAGES.unbalanced)}
    END IF;
    IF NEW.entry_hash IS NULL OR NEW.previous_entry_hash IS NULL THEN
${raisePg(MESSAGES.missingHash)}
    END IF;
    IF EXISTS (
        SELECT 1 FROM journal_entry_lines jel
        JOIN cgnc_accounts ca ON ca.id = jel.account_id
        WHERE jel.entry_id = NEW.id AND ca.account_number LIKE '5161%' AND jel.credit_cents > 0
    ) THEN
        SELECT COALESCE(SUM(jel2.debit_cents - jel2.credit_cents), 0) INTO cash_balance
        FROM journal_entry_lines jel2
        JOIN journal_entries je2 ON je2.id = jel2.entry_id
        JOIN cgnc_accounts ca2 ON ca2.id = jel2.account_id
        WHERE (je2.status = 'POSTED' OR je2.id = NEW.id) AND ca2.account_number LIKE '5161%';
        IF cash_balance < 0 THEN
${raisePg(MESSAGES.negativeCash)}
        END IF;
    END IF;
    RETURN NEW;`,
      `DECLARE
    lines_debit BIGINT;
    lines_credit BIGINT;
    cash_balance BIGINT;
`,
    ),
  },
  {
    name: 'prevent_direct_posted_insert',
    sqlite: `CREATE TRIGGER prevent_direct_posted_insert
BEFORE INSERT ON journal_entries
FOR EACH ROW WHEN NEW.status = 'POSTED'
BEGIN
    ${raiseSqlite(MESSAGES.directPostedInsert)}
END`,
    postgres: postgresTrigger('prevent_direct_posted_insert', 'INSERT', 'journal_entries', `NEW.status = 'POSTED'`, raisePg(MESSAGES.directPostedInsert)),
  },
];

const MIGRATION_3_TABLES: readonly string[] = [
  'fiscal_years',
  'journals',
  'cgnc_accounts',
  'journal_entries',
  'journal_entry_lines',
  'bank_transactions',
  'fixed_assets_register',
];

const MIGRATION_3_TABLE_STATEMENTS: readonly string[] = [
  CREATE_FISCAL_YEARS,
  CREATE_JOURNALS,
  CREATE_CGNC_ACCOUNTS,
  CREATE_JOURNAL_ENTRIES,
  CREATE_JOURNAL_ENTRY_LINES,
  CREATE_BANK_TRANSACTIONS,
  CREATE_FIXED_ASSETS_REGISTER,
];

const MIGRATION_3_STATEMENTS: readonly string[] = [
  ...MIGRATION_3_TABLE_STATEMENTS,
  ...MIGRATION_3_INDEXES.map(([, sql]) => sql),
  CREATE_TRIAL_BALANCE_VIEW,
  ...MIGRATION_3_TRIGGERS.map((trigger) => trigger.sqlite),
];

/** Rang SQLite (dans `MIGRATION_3_STATEMENTS`) de la vue puis des triggers, avec leur traduction PostgreSQL. */
const MIGRATION_3_POSTGRES_OVERRIDES: Readonly<Record<number, string>> = Object.fromEntries([
  [MIGRATION_3_TABLE_STATEMENTS.length + MIGRATION_3_INDEXES.length, CREATE_TRIAL_BALANCE_VIEW_PG],
  ...MIGRATION_3_TRIGGERS.map((trigger, index): [number, string] => [
    MIGRATION_3_TABLE_STATEMENTS.length + MIGRATION_3_INDEXES.length + 1 + index,
    trigger.postgres,
  ]),
]);


/**
 * Migrations versionnées de TENANT_DB, dans l'ordre d'application.
 * IMMUABLES une fois appliquées : la v3 (T-S1B-04, grand livre) a été AJOUTÉE sans toucher aux versions 1 et 2 ;
 * T-S1B-05 (sous-livres) ajoutera la v4.
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
  {
    version: 3,
    name: 'tenant_part3_general_ledger_cgnc_paf_triggers',
    upSqlStatements: MIGRATION_3_STATEMENTS,
    expectedSha256Hex: '71c6a880b7c231ff3d005d2d1edcee5ca7956e5c9dcf9e2af44a18c8ef7a1138',
    tableNames: MIGRATION_3_TABLES,
    indexNames: MIGRATION_3_INDEXES.map(([name]) => name),
    triggerNames: MIGRATION_3_TRIGGERS.map((trigger) => trigger.name),
    viewNames: [TRIAL_BALANCE_VIEW_NAME],
    postgresOverrides: MIGRATION_3_POSTGRES_OVERRIDES,
  },
];

/** Tables de TENANT_DB dans leur ordre de création (les parents précèdent les enfants), toutes migrations confondues. */
export const TENANT_TABLE_NAMES: readonly string[] = TENANT_MIGRATIONS.flatMap((migration) => migration.tableNames);

/** Index nommés créés par les migrations de TENANT_DB, dans leur ordre de création. */
export const TENANT_INDEX_NAMES: readonly string[] = TENANT_MIGRATIONS.flatMap((migration) => migration.indexNames);

/** Triggers créés par les migrations de TENANT_DB, dans leur ordre de création. */
export const TENANT_TRIGGER_NAMES: readonly string[] = TENANT_MIGRATIONS.flatMap((migration) => migration.triggerNames ?? []);

/** Vues créées par les migrations de TENANT_DB. */
export const TENANT_VIEW_NAMES: readonly string[] = TENANT_MIGRATIONS.flatMap((migration) => migration.viewNames ?? []);

/**
 * Équivalent PostgreSQL 16 des instructions d'une migration (ERRATA D-11 : la parité se prouve par le comportement, pas par
 * un DDL identique). Deux différences, toutes deux de typage :
 * - `INTEGER` devient `BIGINT` : INTEGER est sur 32 bits sous PostgreSQL (plafond de 21 474 836,47 MAD en centimes) alors
 *   que SQLite stocke 64 bits ;
 * - le CHECK d'entier strict est retiré : une colonne BIGINT refuse déjà une valeur non entière (SQLSTATE 22P02), et
 *   `CAST(col AS INTEGER)` y déborderait au-delà de 2^31.
 * Les empreintes (`expectedSha256Hex`) restent celles du DDL SQLite, source de vérité.
 * Les triggers et la vue ne se traduisent pas mécaniquement : la migration porte leur équivalent PL/pgSQL dans
 * `postgresOverrides` (une instruction PostgreSQL par instruction SQLite, même rang), qui lève le même texte d'erreur.
 */
export function tenantMigrationPostgresStatements(migration: TenantMigration): readonly string[] {
  return migration.upSqlStatements.map(
    (statement, index) =>
      migration.postgresOverrides?.[index] ??
      statement
        .replace(/ CHECK \((\w+) = CAST\(\1 AS INTEGER\)\)/g, '')
        .replace(/\bINTEGER\b/g, 'BIGINT'),
  );
}
