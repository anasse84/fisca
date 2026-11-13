/**
 * DDL SQLite de TENANT_DB (une base par société : Cloudflare D1 ou PostgreSQL 16), Partie 1 : Doc_06 § 03
 * (enveloppes de clés E2EE, référentiel des tiers, commandes, bons de livraison, factures et lignes), ticket T-S1B-02.
 * Les tickets suivants AJOUTENT des migrations au tableau `TENANT_MIGRATIONS` : la v2 (T-S1B-03) porte la caisse Fisca POS
 * (Doc_06 § 04), la v3 (T-S1B-04) le grand livre CGNC immuable, sa vue à 6 colonnes et ses triggers PAF (Doc_06 § 05) ; les
 * sous-livres suivent en v5 (T-S1B-05) ; la v4 porte les corrections du pilote sur les tickets T-S1B-01 à 04 (comble
 * l'INSERT de lignes dans une pièce POSTED, drapeau DSAR monotone, exercice clos, statuts de facture, POS : voir la migration 4).
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
  /**
   * Triggers créés par CETTE migration, dans leur ordre de création ; absent des migrations v1 et v2 (aucun trigger).
   * Un trigger REMPLACÉ (DROP puis CREATE du même nom, v4) figure ici et dans la migration qui l'a créé d'abord.
   */
  readonly triggerNames?: readonly string[];
  /**
   * Parmi `triggerNames`, les triggers que SQLite seul porte : PostgreSQL les remplace par une contrainte CHECK nommée
   * (`ALTER TABLE ... ADD CONSTRAINT`), SQLite ne pouvant pas ajouter un CHECK à une colonne existante.
   */
  readonly sqliteOnlyTriggerNames?: readonly string[];
  /** Contraintes CHECK nommées que PostgreSQL ajoute à la place des `sqliteOnlyTriggerNames`. */
  readonly postgresConstraintNames?: readonly string[];
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

function postgresTrigger(
  name: string,
  event: string,
  table: string,
  when: string | null,
  body: string,
  declarations = '',
  replace = false,
): string {
  const clause = when === null ? '' : ` WHEN (${when})`;
  return `CREATE ${replace ? 'OR REPLACE ' : ''}FUNCTION fisca_${name}() RETURNS trigger LANGUAGE plpgsql AS $fisca$
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

// ---------------------------------------------------------------------------
// Migration 4 : corrections du pilote sur les tickets T-S1B-01 à 04 (ERRATA D-03, D-11, B-11)
//
// Les migrations v1, v2 et v3 sont IMMUABLES (empreintes SHA-256 figées, testées) : tout passe ici, par DROP TRIGGER puis
// CREATE TRIGGER (même nom, même texte d'erreur de refus) ou par de nouveaux triggers. Chaque trigger a son équivalent PL/pgSQL
// (même texte, RAISE EXCEPTION, SQLSTATE P0001) dans `postgresOverrides`, une instruction PostgreSQL par instruction SQLite.
// 1. `prevent_posted_lines_mutation_insert` : l'INSERT d'une ligne dans une pièce POSTED est refusé (trou de v3, écart 6).
//    Une pièce se construit lignes d'abord, puis passe à POSTED.
// 2. `pii_restricted_flag` (Doc_11 § 06 : restriction fiscale = 1 après demande DSAR, jusqu'à 10 ans après la clôture de
//    l'exercice, puis effacement cryptographique) : le SEUL changement admis sur une pièce ou une ligne POSTED est la montée
//    monotone 0 vers 1, toutes les autres colonnes strictement inchangées (comparaison `IS NOT` colonne par colonne, NULL compris).
//    `prevent_posted_entry_update` et `prevent_posted_lines_mutation_update` sont remplacés. `invoices` ne porte aucun trigger
//    d'immuabilité : rien à y modifier. Le drapeau doit encore exister sur `payroll_annual_subledger` et `archival_packages`
//    (état 9421 et paquets AIP, Doc_11 § 06) : ces tables naissent au ticket T-S1B-05, qui y ajoutera la colonne ; elles ne sont
//    PAS créées ici.
// 4. POS (Art. 145 CGI) : suppression interdite d'un ticket et d'une clôture Z. Le DDL de v2 ne distingue pas « signé » de
//    « non signé » (ecdsa_signature_b64 et ticket_sha256 sont NOT NULL partout) ni « scellée » de « non scellée » (z_sha256 NOT
//    NULL partout, la ligne n'existe qu'à la clôture) : l'interdiction vise donc TOUT ticket et TOUTE clôture Z. L'UPDATE
//    n'est admis que par exception (la conversion B2C vers B2B de la skill fisca-pos-offline-sce § 4
//    exige un UPDATE de `b2b_conversion_state` et `converted_invoice_id`, et Doc_06 § 04 laisse `gl_journal_entry_id` et
//    `aip_archive_id` nullables) : le pilote a tranché (option b), exception étroite et monotone, échec fermé. Voir
//    `prevent_pos_ticket_update` (seule NONE vers CONVERTI_B2B_AVANT_Z ou CONVERTI_B2B_POST_Z_NEUTRALISE, FSM 10 de Doc_02 § 13,
//    avec converted_invoice_id NULL vers valeur, toutes les autres colonnes inchangées) et `prevent_pos_z_closure_update`
//    (seule la pose NULL vers valeur de gl_journal_entry_id et/ou aip_archive_id, jamais modifiées ensuite). Aucun format ni formule de chaînage n'est défini. Format 64 caractères hexadécimaux minuscules
//    des quatre colonnes de hachage : le CHECK de v2 sur `ticket_sha256` et `z_sha256` (longueur 64, minuscules) n'est PAS
//    doublé ; les triggers n'ajoutent que ce qui manque (caractères hors 0-9a-f ; le format entier pour `prev_ticket_sha256`
//    et `prev_z_sha256`, sans CHECK en v2). Un CHECK ne s'ajoute pas à une colonne SQLite existante, d'où les triggers.
// 5. Exercice clos (Doc_02 § 04 : OPEN → CLOSING → CLOSED ; Doc_06 § 05 : statuts 'OPEN', 'CLOSING', 'CLOSED') : tout UPDATE
//    d'une ligne `fiscal_years` dont l'ANCIEN statut est CLOSED est refusé (la transition CLOSING → CLOSED reste un UPDATE d'une
//    ligne d'ancien statut CLOSING) ; l'INSERT d'une pièce rattachée à un exercice CLOSED est refusé. Le journal d'ouverture AN
//    est inséré dans le NOUVEL exercice (Doc_02 § 04, « CLOSED → OPEN N+1 »), non concerné.
// 6. Statuts de facture : CHECK sur des colonnes EXISTANTES de `invoices`. SQLite ne sait pas ajouter un CHECK à une colonne
//    existante : deux triggers par colonne (BEFORE INSERT et BEFORE UPDATE OF <colonne>) lèvent un texte IDENTIQUE à celui que
//    PostgreSQL produit pour la contrainte nommée ; PostgreSQL ajoute `ALTER TABLE ... ADD CONSTRAINT ... CHECK` (NOT VALID, puis
//    VALIDATE CONSTRAINT à l'instruction de rang suivant). `clearance_state` porte les 8 statuts de la FSM 01 de Doc_02 § 02
//    (diagramme et tableau), `cdv_lifecycle_status` porte NONE et les 5 sous-états commerciaux CDV de Doc_02 § 02.
// ---------------------------------------------------------------------------

export const INVOICE_CLEARANCE_STATES = [
  'BROUILLON',
  'NUMEROTEE_VERROUILLEE',
  'SIGNEE_LOI_43_20',
  'DEPOSEE_CERTIFIEE_DGI',
  'REJETEE_XHUB',
  'APPROUVEE',
  'ANNULEE_BROUILLON',
  'ENCAISSEE',
] as const;
export const INVOICE_CDV_LIFECYCLE_STATUSES = [
  'NONE',
  'MISE_A_DISPOSITION',
  'PRISE_EN_CHARGE',
  'APPROUVEE_PARTIELLEMENT',
  'EN_LITIGE_SUSPENDUE',
  'REFUSEE',
] as const;

/** Textes des RAISE de la migration v4 ; identiques sous PostgreSQL. Les deux derniers sont ceux de PostgreSQL pour un CHECK. */
export const TENANT_V4_TRIGGER_MESSAGES = {
  lineInsert: 'VIOLATION_PAF_CGI_ART_145: Insertion de ligne interdite sur pièce POSTED.',
  closedFiscalYearUpdate: 'VIOLATION_PAF_CGI_ART_145: Exercice clos immuable. Ouvrez un nouvel exercice.',
  closedFiscalYearEntryInsert: 'CGNC_FISCAL_YEAR_CLOSED: Écriture refusée car cet exercice est clos.',
  posTicketDelete: 'VIOLATION_PAF_CGI_ART_145: Suppression de ticket POS interdite. Retour par avoir lié.',
  posZClosureDelete: 'VIOLATION_PAF_CGI_ART_145: Suppression de clôture Z scellée interdite.',
  posTicketUpdate: 'VIOLATION_PAF_CGI_ART_145: Modification de ticket POS signé interdite. Seule la conversion B2B est admise.',
  posZClosureUpdate: 'VIOLATION_PAF_CGI_ART_145: Modification de clôture Z scellée interdite. Seule la pose des références GL et AIP est admise.',
  posHashFormat: 'POS_HASH_FORMAT: Empreinte SHA-256 attendue : 64 caractères hexadécimaux minuscules.',
  clearanceState: 'new row for relation "invoices" violates check constraint "invoices_clearance_state_check"',
  cdvLifecycleStatus: 'new row for relation "invoices" violates check constraint "invoices_cdv_lifecycle_status_check"',
} as const;

const MESSAGES_V4 = TENANT_V4_TRIGGER_MESSAGES;

/** Colonnes de `journal_entries` hors `pii_restricted_flag` : toutes doivent rester inchangées sous l'exception monotone. */
const JOURNAL_ENTRY_COLUMNS_EXCEPT_FLAG = [
  'id',
  'fiscal_year_id',
  'journal_id',
  'sequence_number',
  'entry_reference',
  'entry_date',
  'validated_at',
  'review_cycle',
  'status',
  'source_document_type',
  'invoice_id',
  'dgi_clearance_uuid',
  'partner_id',
  'reversal_of_entry_id',
  'total_debit_cents',
  'total_credit_cents',
  'previous_entry_hash',
  'entry_hash',
] as const;

/** Colonnes de `journal_entry_lines` hors `pii_restricted_flag`. */
const JOURNAL_ENTRY_LINE_COLUMNS_EXCEPT_FLAG = [
  'id',
  'entry_id',
  'line_number',
  'account_id',
  'auxiliary_account',
  'description_enc',
  'debit_cents',
  'credit_cents',
  'is_tax_deductible',
  'table3_reintegration_code',
  'reconciliation_code',
  'reconciled_at',
] as const;

/** Vrai quand le changement n'est PAS la seule montée 0 vers 1 du drapeau (SQLite : `IS NOT`, NULL compris). */
function notMonotoneFlagRiseSqlite(columns: readonly string[]): string {
  return `(NOT (OLD.pii_restricted_flag = 0 AND NEW.pii_restricted_flag = 1) OR ${columns.map((column) => `OLD.${column} IS NOT NEW.${column}`).join(' OR ')})`;
}

/** Même condition sous PostgreSQL : `IS DISTINCT FROM` est l'équivalent de `IS NOT` de SQLite. */
function notMonotoneFlagRisePostgres(columns: readonly string[]): string {
  return `(NOT (OLD.pii_restricted_flag = 0 AND NEW.pii_restricted_flag = 1) OR ${columns.map((column) => `OLD.${column} IS DISTINCT FROM NEW.${column}`).join(' OR ')})`;
}

/** Condition de refus d'une empreinte : format complet quand aucun CHECK n'existe (`full`), partie hexadécimale seule sinon. */
function hashRejectedSqlite(column: string, full: boolean): string {
  if (full) {
    return `(${column} IS NOT NULL AND (length(${column}) <> 64 OR ${column} GLOB '*[^0-9a-f]*'))`;
  }
  return `(${column} IS NOT NULL AND length(${column}) = 64 AND ${column} = lower(${column}) AND ${column} GLOB '*[^0-9a-f]*')`;
}

function hashRejectedPostgres(column: string, full: boolean): string {
  if (full) {
    return `(${column} IS NOT NULL AND ${column} !~ '^[0-9a-f]{64}$')`;
  }
  return `(${column} IS NOT NULL AND length(${column}) = 64 AND ${column} = lower(${column}) AND ${column} !~ '^[0-9a-f]{64}$')`;
}

/** Colonnes de `pos_tickets` hors `b2b_conversion_state` et `converted_invoice_id` : toutes doivent rester inchangées. */
const POS_TICKET_COLUMNS_EXCEPT_CONVERSION = [
  'id',
  'session_id',
  'terminal_id',
  'terminal_seq_number',
  'issued_at',
  'ticket_kind',
  'origin_ticket_id',
  'ht_20_cents',
  'vat_20_cents',
  'ht_10_cents',
  'vat_10_cents',
  'ht_0_cents',
  'stamp_duty_cents',
  'total_ttc_cents',
  'paid_cash_cents',
  'paid_card_tpe_cents',
  'paid_delivery_app_cents',
  'qr_conversion_token',
  'prev_ticket_sha256',
  'ticket_sha256',
  'ecdsa_signature_b64',
] as const;

/** Colonnes de `pos_z_closures` hors `gl_journal_entry_id` et `aip_archive_id`. */
const POS_Z_CLOSURE_COLUMNS_EXCEPT_REFERENCES = [
  'id',
  'session_id',
  'terminal_id',
  'closure_number',
  'business_date',
  'net_b2c_ht_20_cents',
  'net_b2c_vat_20_cents',
  'net_b2c_ht_10_cents',
  'net_b2c_vat_10_cents',
  'net_b2c_ht_0_cents',
  'total_stamp_duty_cents',
  'tpe_gross_cents',
  'prev_z_sha256',
  'z_sha256',
] as const;

/** Cibles de conversion admises depuis NONE (Doc_02 § 13, FSM 10 : avant Z, ou scan QR après clôture Z). Aucune autre transition. */
const POS_CONVERSION_TARGETS = POS_B2B_CONVERSION_STATES.filter((state) => state !== 'NONE');

/**
 * Condition de refus d'un UPDATE de ticket : tout, SAUF NONE vers un état converti avec converted_invoice_id de NULL vers une
 * valeur, toutes les autres colonnes inchangées. Jamais NULL (IS NOT / IS DISTINCT FROM, colonnes NOT NULL), donc échec fermé.
 */
function posTicketUpdateRejected(distinct: (column: string) => string): string {
  const unchanged = POS_TICKET_COLUMNS_EXCEPT_CONVERSION.map(distinct).join(' OR ');
  return `(NOT (OLD.b2b_conversion_state = 'NONE' AND NEW.b2b_conversion_state IN (${quoteList(POS_CONVERSION_TARGETS)}) AND OLD.converted_invoice_id IS NULL AND NEW.converted_invoice_id IS NOT NULL) OR ${unchanged})`;
}

/** Condition de refus d'un UPDATE de clôture Z : seule la pose NULL vers valeur de gl_journal_entry_id et/ou aip_archive_id est admise. */
function posZClosureUpdateRejected(distinct: (column: string) => string): string {
  const others = POS_Z_CLOSURE_COLUMNS_EXCEPT_REFERENCES.map(distinct).join(' OR ');
  const glRewritten = `(OLD.gl_journal_entry_id IS NOT NULL AND ${distinct('gl_journal_entry_id')})`;
  const aipRewritten = `(OLD.aip_archive_id IS NOT NULL AND ${distinct('aip_archive_id')})`;
  const glPosed = `(OLD.gl_journal_entry_id IS NULL AND NEW.gl_journal_entry_id IS NOT NULL)`;
  const aipPosed = `(OLD.aip_archive_id IS NULL AND NEW.aip_archive_id IS NOT NULL)`;
  return `(${others} OR ${glRewritten} OR ${aipRewritten} OR NOT (${glPosed} OR ${aipPosed}))`;
}

const distinctSqlite = (column: string): string => `OLD.${column} IS NOT NEW.${column}`;
const distinctPostgres = (column: string): string => `OLD.${column} IS DISTINCT FROM NEW.${column}`;

interface MigrationStatement {
  /** Nom du trigger créé par l'instruction, absent pour un DROP TRIGGER ou un ALTER TABLE. */
  readonly trigger?: string;
  readonly sqlite: string;
  readonly postgres: string;
}

function dropTrigger(name: string, table: string): MigrationStatement {
  return { sqlite: `DROP TRIGGER ${name}`, postgres: `DROP TRIGGER ${name} ON ${table}` };
}

/**
 * Trigger de refus : WHEN côté SQLite, `IF ... THEN RAISE EXCEPTION` côté PL/pgSQL (condition portée par le corps, ce qui permet
 * une sous-requête sur la pièce parente ou l'exercice). `replace` : la fonction existe déjà (trigger remplacé de la v3).
 */
function createGuardedTrigger(
  name: string,
  event: string,
  table: string,
  sqliteWhen: string,
  pgCondition: string,
  message: string,
  replace = false,
): MigrationStatement {
  const sqlite = `CREATE TRIGGER ${name}
BEFORE ${event} ON ${table}
FOR EACH ROW WHEN ${sqliteWhen}
BEGIN
    ${raiseSqlite(message)}
END`;
  const returned = event.startsWith('DELETE') ? 'OLD' : 'NEW';
  const body = `    IF ${pgCondition} THEN
${raisePg(message)}
    END IF;
    RETURN ${returned};`;
  return { trigger: name, sqlite, postgres: postgresTrigger(name, event, table, null, body, '', replace) };
}

const POSTED_PARENT_SQLITE = `(SELECT status FROM journal_entries WHERE id = OLD.entry_id) = 'POSTED'`;
const POSTED_PARENT_POSTGRES = `(SELECT status FROM journal_entries WHERE id = OLD.entry_id) = 'POSTED'`;

const CLEARANCE_LIST = quoteList(INVOICE_CLEARANCE_STATES);
const CDV_LIST = quoteList(INVOICE_CDV_LIFECYCLE_STATUSES);

function invoiceStatusTriggers(column: string, base: string, constraint: string, list: string, message: string): readonly MigrationStatement[] {
  const rejected = `NEW.${column} NOT IN (${list})`;
  return [
    {
      trigger: `${base}_insert`,
      sqlite: `CREATE TRIGGER ${base}_insert
BEFORE INSERT ON invoices
FOR EACH ROW WHEN ${rejected}
BEGIN
    ${raiseSqlite(message)}
END`,
      postgres: `ALTER TABLE invoices ADD CONSTRAINT ${constraint} CHECK (${column} IN (${list})) NOT VALID`,
    },
    {
      trigger: `${base}_update`,
      sqlite: `CREATE TRIGGER ${base}_update
BEFORE UPDATE OF ${column} ON invoices
FOR EACH ROW WHEN ${rejected}
BEGIN
    ${raiseSqlite(message)}
END`,
      postgres: `ALTER TABLE invoices VALIDATE CONSTRAINT ${constraint}`,
    },
  ];
}

const MIGRATION_4_ITEMS: readonly MigrationStatement[] = [
  // 1. INSERT de ligne dans une pièce POSTED (NEW : la pièce parente de la ligne insérée).
  createGuardedTrigger(
    'prevent_posted_lines_mutation_insert',
    'INSERT',
    'journal_entry_lines',
    `(SELECT status FROM journal_entries WHERE id = NEW.entry_id) = 'POSTED'`,
    `(SELECT status FROM journal_entries WHERE id = NEW.entry_id) = 'POSTED'`,
    MESSAGES_V4.lineInsert,
  ),
  // 2. Exception monotone du drapeau DSAR : pièce, puis lignes.
  dropTrigger('prevent_posted_entry_update', 'journal_entries'),
  createGuardedTrigger(
    'prevent_posted_entry_update',
    'UPDATE',
    'journal_entries',
    `OLD.status = 'POSTED' AND ${notMonotoneFlagRiseSqlite(JOURNAL_ENTRY_COLUMNS_EXCEPT_FLAG)}`,
    `OLD.status = 'POSTED' AND ${notMonotoneFlagRisePostgres(JOURNAL_ENTRY_COLUMNS_EXCEPT_FLAG)}`,
    MESSAGES.entryUpdate,
    true,
  ),
  dropTrigger('prevent_posted_lines_mutation_update', 'journal_entry_lines'),
  createGuardedTrigger(
    'prevent_posted_lines_mutation_update',
    'UPDATE',
    'journal_entry_lines',
    `${POSTED_PARENT_SQLITE} AND ${notMonotoneFlagRiseSqlite(JOURNAL_ENTRY_LINE_COLUMNS_EXCEPT_FLAG)}`,
    `${POSTED_PARENT_POSTGRES} AND ${notMonotoneFlagRisePostgres(JOURNAL_ENTRY_LINE_COLUMNS_EXCEPT_FLAG)}`,
    MESSAGES.lineUpdate,
    true,
  ),
  // 5. Exercice clos.
  createGuardedTrigger('prevent_closed_fiscal_year_update', 'UPDATE', 'fiscal_years', `OLD.status = 'CLOSED'`, `OLD.status = 'CLOSED'`, MESSAGES_V4.closedFiscalYearUpdate),
  createGuardedTrigger(
    'prevent_entry_insert_in_closed_fiscal_year',
    'INSERT',
    'journal_entries',
    `(SELECT status FROM fiscal_years WHERE id = NEW.fiscal_year_id) = 'CLOSED'`,
    `(SELECT status FROM fiscal_years WHERE id = NEW.fiscal_year_id) = 'CLOSED'`,
    MESSAGES_V4.closedFiscalYearEntryInsert,
  ),
  // 6. Statuts de facture.
  ...invoiceStatusTriggers('clearance_state', 'enforce_invoice_clearance_state', 'invoices_clearance_state_check', CLEARANCE_LIST, MESSAGES_V4.clearanceState),
  ...invoiceStatusTriggers('cdv_lifecycle_status', 'enforce_invoice_cdv_status', 'invoices_cdv_lifecycle_status_check', CDV_LIST, MESSAGES_V4.cdvLifecycleStatus),
  // 4. POS : suppression interdite, format des empreintes.
  createGuardedTrigger('prevent_pos_ticket_delete', 'DELETE', 'pos_tickets', '1 = 1', 'TRUE', MESSAGES_V4.posTicketDelete),
  createGuardedTrigger('prevent_pos_z_closure_delete', 'DELETE', 'pos_z_closures', '1 = 1', 'TRUE', MESSAGES_V4.posZClosureDelete),
  // Exception étroite et monotone (décision du pilote, option b) : posées AVANT les triggers de format d'empreinte, pour que le
  // refus de format passe en premier sur les deux moteurs (SQLite : dernier créé, premier exécuté ; PostgreSQL : ordre alphabétique).
  createGuardedTrigger(
    'prevent_pos_ticket_update',
    'UPDATE',
    'pos_tickets',
    posTicketUpdateRejected(distinctSqlite),
    posTicketUpdateRejected(distinctPostgres),
    MESSAGES_V4.posTicketUpdate,
  ),
  createGuardedTrigger(
    'prevent_pos_z_closure_update',
    'UPDATE',
    'pos_z_closures',
    posZClosureUpdateRejected(distinctSqlite),
    posZClosureUpdateRejected(distinctPostgres),
    MESSAGES_V4.posZClosureUpdate,
  ),
  createGuardedTrigger(
    'enforce_pos_ticket_hash_format_insert',
    'INSERT',
    'pos_tickets',
    `${hashRejectedSqlite('NEW.prev_ticket_sha256', true)} OR ${hashRejectedSqlite('NEW.ticket_sha256', false)}`,
    `${hashRejectedPostgres('NEW.prev_ticket_sha256', true)} OR ${hashRejectedPostgres('NEW.ticket_sha256', false)}`,
    MESSAGES_V4.posHashFormat,
  ),
  createGuardedTrigger(
    'enforce_pos_ticket_hash_format_update',
    'UPDATE OF prev_ticket_sha256, ticket_sha256',
    'pos_tickets',
    `${hashRejectedSqlite('NEW.prev_ticket_sha256', true)} OR ${hashRejectedSqlite('NEW.ticket_sha256', false)}`,
    `${hashRejectedPostgres('NEW.prev_ticket_sha256', true)} OR ${hashRejectedPostgres('NEW.ticket_sha256', false)}`,
    MESSAGES_V4.posHashFormat,
  ),
  createGuardedTrigger(
    'enforce_pos_z_closure_hash_format_insert',
    'INSERT',
    'pos_z_closures',
    `${hashRejectedSqlite('NEW.prev_z_sha256', true)} OR ${hashRejectedSqlite('NEW.z_sha256', false)}`,
    `${hashRejectedPostgres('NEW.prev_z_sha256', true)} OR ${hashRejectedPostgres('NEW.z_sha256', false)}`,
    MESSAGES_V4.posHashFormat,
  ),
  createGuardedTrigger(
    'enforce_pos_z_closure_hash_format_update',
    'UPDATE OF prev_z_sha256, z_sha256',
    'pos_z_closures',
    `${hashRejectedSqlite('NEW.prev_z_sha256', true)} OR ${hashRejectedSqlite('NEW.z_sha256', false)}`,
    `${hashRejectedPostgres('NEW.prev_z_sha256', true)} OR ${hashRejectedPostgres('NEW.z_sha256', false)}`,
    MESSAGES_V4.posHashFormat,
  ),
];

const MIGRATION_4_STATEMENTS: readonly string[] = MIGRATION_4_ITEMS.map((item) => item.sqlite);

const MIGRATION_4_TRIGGER_NAMES: readonly string[] = MIGRATION_4_ITEMS.flatMap((item) => (item.trigger === undefined ? [] : [item.trigger]));

const MIGRATION_4_SQLITE_ONLY_TRIGGERS: readonly string[] = ['enforce_invoice_clearance_state', 'enforce_invoice_cdv_status'].flatMap((base) => [`${base}_insert`, `${base}_update`]);

const MIGRATION_4_POSTGRES_OVERRIDES: Readonly<Record<number, string>> = Object.fromEntries(MIGRATION_4_ITEMS.map((item, index): [number, string] => [index, item.postgres]));


// ---------------------------------------------------------------------------
// Migration 5 : TENANT_DB Partie 4, sous-livres SIMPL, paie 9421 et coffre AIP (Doc_06 § 06 et § 08, ticket T-S1B-05)
//
// Huit tables, deux index nommés de Doc_06 § 08 (`idx_subledger_due_unpaid`, `idx_subledger_timebar`, tous deux sur
// `tax_and_payment_subledger`) et les DEUX seuls triggers de Doc_06 § 06 : `enforce_10year_worm_retention_delete` et
// `enforce_10year_worm_retention_update`, sur `archival_packages`. Doc_06 § 06 ne définit aucun objet nommé propre à la paie 9421
// ni au DRVT en dehors de ces tables : rien d'autre n'est créé. Les v1 à v4 restent intactes (empreintes figées).
//
// Colonnes et CHECK : ceux du DDL de Doc_06 § 06, mot pour mot, plus (comme aux migrations précédentes) le CHECK d'entier strict
// sur chaque colonne INTEGER. TVA : `vat_rate_bps IN (2000, 1000, 0)` strict (ERRATA D-04). `deduction_prorata_pct` reste un entier
// de 0 à 100 (XSD SIMPL-TVA, ERRATA D-10 : la conversion depuis les points de base se fait avant l'écriture).
//
// ÉCARTS ASSUMÉS AVEC Doc_06 § 06 (chacun testé) :
// 1. `pii_restricted_flag` (ERRATA D-19, Doc_11 § 06 : restriction fiscale = 1 après demande DSAR, jusqu'à 10 ans après la
//    clôture, puis effacement cryptographique) : INTEGER NOT NULL DEFAULT 0 CHECK (0, 1), dernière colonne de
//    `payroll_annual_subledger` et de `archival_packages`.
// 2. `enforce_10year_worm_retention_delete` : texte de Doc_06 (`datetime('now') < datetime(OLD.retention_until)`, horloge de la
//    base). PostgreSQL : `now() < OLD.retention_until::timestamptz`, fuseau de la fonction fixé à UTC (SQLite compte en UTC).
// 3. `enforce_10year_worm_retention_update` : Doc_06 n'interdit sur une ligne scellée (merkle_batch_id non NULL) que la
//    modification de `payload_sha256`. Exigence du pilote : une ligne scellée est immuable, la seule modification admise est la
//    montée monotone 0 vers 1 de `pii_restricted_flag`, toutes les autres colonnes strictement inchangées (`IS NOT` côté SQLite,
//    `IS DISTINCT FROM` côté PostgreSQL, NULL compris) ; 1 vers 0 et toute montée combinée à une autre modification sont refusées.
//    Une ligne NON scellée reste libre (le scellement est lui-même un UPDATE qui pose merkle_batch_id). Texte d'erreur de Doc_06.
// 4. Index : Doc_06 § 08 les décrit (« filtrés sur les factures non soldées et sur time_bar_deadline_date ») sans en donner le
//    DDL. `idx_subledger_due_unpaid` : (legal_due_date) WHERE payment_date IS NULL ; `idx_subledger_timebar` :
//    (time_bar_deadline_date) WHERE time_bar_deadline_date IS NOT NULL (index partiels, valables sous SQLite et PostgreSQL).
// 5. La rétention n'est PAS reportée sur l'UPDATE (Doc_06 ne la lit que dans le DELETE) ; `payroll_annual_subledger` n'a aucun
//    trigger (Doc_06 n'en définit pas) : son drapeau est donc seulement borné par le CHECK.
// ---------------------------------------------------------------------------

export const RAS_DIRECTIONS = ['OUTBOUND_SUPPLIER_RAS', 'INBOUND_CUSTOMER_RAS'] as const;
export const RAS_FAMILIES = [
  'RAS_TVA_ART117',
  'HONORAIRES_IS_IR',
  'COMMISSIONS_COURTAGES',
  'LOCATION_IMMOBILIERE_TSC',
  'NON_RESIDENT_ART15',
  'AE_OVER_80K_IR30',
] as const;
export const PAYROLL_POPULATION_CATEGORIES = [
  'PERMANENT',
  'EXONERE_TAHFIZ_5725',
  'EXONERE_5720',
  'OCCASIONNEL',
  'CFC',
  'STAGIAIRE',
  'STOCK_OPTIONS',
  'PEE_ABONDEMENT',
  'DOCTORANT',
] as const;
export const PAYROLL_FAMILY_STATUSES = ['C', 'M', 'D', 'V'] as const;
export const PAYROLL_IR_PAYMENT_METHOD_CODES = ['ES', 'CH', 'SIR'] as const;
export const ARCHIVAL_DOCUMENT_TYPES = [
  'INVOICE_UBL_XADES',
  'INVOICE_PDFA3_PADES',
  'POS_TICKET_Z',
  'SIMPL_TVA_XML',
  'SIMPL_IS_LIASSE_XML',
  'SIMPL_IR_9421_XML',
  'DRVT_XML',
  'LAW_69_21_XML',
  'FEC_SAFT_EXPORT',
] as const;

/** Textes des RAISE de la migration v5 (Doc_06 § 06, mot pour mot) ; identiques sous PostgreSQL. */
export const TENANT_V5_TRIGGER_MESSAGES = {
  wormDelete: 'VIOLATION_SAE_CGI_ART_211: Destruction interdite avant expiration des 10 ans.',
  wormUpdate: 'VIOLATION_SAE_ISO_14641: Altération interdite sur une unité d archive scellée.',
} as const;

const CREATE_TAX_AND_PAYMENT_SUBLEDGER = `CREATE TABLE tax_and_payment_subledger (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    invoice_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
    payment_entry_id TEXT REFERENCES journal_entries(id),
    invoice_date TEXT NOT NULL,
    delivery_date TEXT NOT NULL,
    legal_due_date TEXT NOT NULL,
    payment_date TEXT,
    time_bar_deadline_date TEXT,
    dgi_payment_method_id INTEGER NOT NULL CHECK (dgi_payment_method_id BETWEEN 1 AND 7) ${integerCheck('dgi_payment_method_id')},
    base_ht_cents INTEGER NOT NULL ${integerCheck('base_ht_cents')},
    vat_rate_bps INTEGER NOT NULL CHECK (vat_rate_bps IN (${VAT_RATE_BPS_VALUES.join(', ')})) ${integerCheck('vat_rate_bps')},
    vat_amount_cents INTEGER NOT NULL ${integerCheck('vat_amount_cents')},
    total_ttc_cents INTEGER NOT NULL CHECK (base_ht_cents + vat_amount_cents = total_ttc_cents) ${integerCheck('total_ttc_cents')},
    deduction_prorata_pct INTEGER NOT NULL DEFAULT 100 CHECK (deduction_prorata_pct BETWEEN 0 AND 100) ${integerCheck('deduction_prorata_pct')},
    vat_clearing_entry_id TEXT REFERENCES journal_entries(id),
    simpl_tva_declared_period TEXT,
    months_of_delay_6921 INTEGER NOT NULL DEFAULT 0 ${integerCheck('months_of_delay_6921')},
    penalty_6921_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('penalty_6921_cents')},
    law_6921_declared_quarter TEXT
)`;

const CREATE_WITHHOLDING_TAX_SUBLEDGER = `CREATE TABLE withholding_tax_subledger (
    id TEXT PRIMARY KEY,
    fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
    partner_id TEXT NOT NULL REFERENCES fiscal_partners(id),
    invoice_id TEXT REFERENCES invoices(id),
    direction TEXT NOT NULL CHECK (direction IN (${quoteList(RAS_DIRECTIONS)})),
    ras_family TEXT NOT NULL CHECK (ras_family IN (${quoteList(RAS_FAMILIES)})),
    leased_property_address_enc TEXT,
    tsc_article_number TEXT,
    invoiced_ht_cents INTEGER NOT NULL ${integerCheck('invoiced_ht_cents')},
    paid_base_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('paid_base_cents')},
    ras_rate_bps INTEGER NOT NULL ${integerCheck('ras_rate_bps')},
    ras_amount_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('ras_amount_cents')},
    payment_date TEXT,
    dgi_quittance_ref TEXT,
    imputed_on_is_installment INTEGER CHECK (imputed_on_is_installment BETWEEN 1 AND 6) ${integerCheck('imputed_on_is_installment')}
)`;

const CREATE_PAYROLL_ANNUAL_SUBLEDGER = `CREATE TABLE payroll_annual_subledger (
    id TEXT PRIMARY KEY,
    calendar_year INTEGER NOT NULL ${integerCheck('calendar_year')},
    population_category TEXT NOT NULL CHECK (population_category IN (${quoteList(PAYROLL_POPULATION_CATEGORIES)})),
    matricule TEXT NOT NULL,
    last_name_enc TEXT NOT NULL,
    first_name_enc TEXT NOT NULL,
    cin_enc TEXT,
    cin_bidx TEXT,
    carte_sejour_enc TEXT,
    num_ppr_enc TEXT,
    num_cnss_enc TEXT,
    cnss_bidx TEXT,
    family_status TEXT NOT NULL CHECK (family_status IN (${quoteList(PAYROLL_FAMILY_STATUSES)})),
    dependents_count INTEGER NOT NULL DEFAULT 0 CHECK (dependents_count BETWEEN 0 AND 6) ${integerCheck('dependents_count')},
    address_enc TEXT NOT NULL,
    hire_date TEXT NOT NULL,
    exit_date TEXT,
    worked_days INTEGER NOT NULL DEFAULT 360 CHECK (worked_days BETWEEN 1 AND 365) ${integerCheck('worked_days')},
    is_sportsman INTEGER NOT NULL DEFAULT 0 ${integerCheck('is_sportsman')},
    dgi_expense_rate_code TEXT NOT NULL,
    base_salary_cents INTEGER NOT NULL ${integerCheck('base_salary_cents')},
    gross_salary_cents INTEGER NOT NULL ${integerCheck('gross_salary_cents')},
    benefits_in_kind_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('benefits_in_kind_cents')},
    allowances_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('allowances_cents')},
    exempt_allowances_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('exempt_allowances_cents')},
    gross_taxable_cents INTEGER NOT NULL ${integerCheck('gross_taxable_cents')},
    pro_expenses_cents INTEGER NOT NULL ${integerCheck('pro_expenses_cents')},
    supplementary_pension_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('supplementary_pension_cents')},
    social_contributions_cents INTEGER NOT NULL ${integerCheck('social_contributions_cents')},
    housing_loan_deduction_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('housing_loan_deduction_cents')},
    total_deductions_cents INTEGER NOT NULL ${integerCheck('total_deductions_cents')},
    net_taxable_cents INTEGER NOT NULL ${integerCheck('net_taxable_cents')},
    ir_withheld_cents INTEGER NOT NULL ${integerCheck('ir_withheld_cents')},
    pii_restricted_flag INTEGER NOT NULL DEFAULT 0 ${booleanCheck('pii_restricted_flag')},
    UNIQUE(calendar_year, matricule)
)`;

const CREATE_PAYROLL_EXEMPT_ELEMENTS = `CREATE TABLE payroll_exempt_elements (
    id TEXT PRIMARY KEY,
    payroll_line_id TEXT NOT NULL REFERENCES payroll_annual_subledger(id),
    dgi_nature_code TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0) ${integerCheck('amount_cents')}
)`;

const CREATE_PAYROLL_IR_REMITTANCES = `CREATE TABLE payroll_ir_remittances (
    id TEXT PRIMARY KEY,
    calendar_year INTEGER NOT NULL ${integerCheck('calendar_year')},
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12) ${integerCheck('month')},
    payment_date TEXT NOT NULL,
    payment_method_code TEXT NOT NULL CHECK (payment_method_code IN (${quoteList(PAYROLL_IR_PAYMENT_METHOD_CODES)})),
    dgi_reference TEXT NOT NULL,
    quittance_number TEXT NOT NULL,
    principal_cents INTEGER NOT NULL ${integerCheck('principal_cents')},
    penalty_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('penalty_cents')},
    surcharges_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('surcharges_cents')},
    total_paid_cents INTEGER NOT NULL CHECK (principal_cents + penalty_cents + surcharges_cents = total_paid_cents) ${integerCheck('total_paid_cents')},
    gl_payment_entry_id TEXT REFERENCES journal_entries(id)
)`;

const CREATE_ARCHIVAL_PACKAGES = `CREATE TABLE archival_packages (
    aip_id TEXT PRIMARY KEY,
    fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
    entry_id TEXT REFERENCES journal_entries(id),
    document_type TEXT NOT NULL CHECK (document_type IN (${quoteList(ARCHIVAL_DOCUMENT_TYPES)})),
    dgi_clearance_uuid TEXT,
    document_ref TEXT NOT NULL,
    document_date TEXT NOT NULL,
    amount_ttc_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('amount_ttc_cents')},
    r2_object_key TEXT NOT NULL UNIQUE,
    morocco_mirror_key TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    encrypted_dek_base64 TEXT NOT NULL,
    iv_base64 TEXT NOT NULL,
    merkle_batch_id TEXT,
    merkle_leaf_index INTEGER ${integerCheck('merkle_leaf_index')},
    merkle_proof_json TEXT,
    archived_at TEXT NOT NULL,
    retention_until TEXT NOT NULL,
    pii_restricted_flag INTEGER NOT NULL DEFAULT 0 ${booleanCheck('pii_restricted_flag')}
)`;

const CREATE_STATE_TRANSITION_AUDIT = `CREATE TABLE state_transition_audit (
    id TEXT PRIMARY KEY,
    entity_table TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    actor_kind TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    proof_ref TEXT,
    created_at TEXT NOT NULL
)`;

const CREATE_FEC_AUDIT_RUNS = `CREATE TABLE fec_audit_runs (
    id TEXT PRIMARY KEY,
    fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
    score_on_100 INTEGER NOT NULL CHECK (score_on_100 BETWEEN 0 AND 100) ${integerCheck('score_on_100')},
    total_anomalies INTEGER NOT NULL ${integerCheck('total_anomalies')},
    cash_overflow_count INTEGER NOT NULL ${integerCheck('cash_overflow_count')},
    missing_ice_count INTEGER NOT NULL ${integerCheck('missing_ice_count')},
    cadrage_tva_gap_cents INTEGER NOT NULL ${integerCheck('cadrage_tva_gap_cents')},
    negative_cash_attempts INTEGER NOT NULL ${integerCheck('negative_cash_attempts')},
    findings_json TEXT NOT NULL,
    created_at TEXT NOT NULL
)`;

const MIGRATION_5_TABLES: readonly string[] = [
  'tax_and_payment_subledger',
  'withholding_tax_subledger',
  'payroll_annual_subledger',
  'payroll_exempt_elements',
  'payroll_ir_remittances',
  'archival_packages',
  'state_transition_audit',
  'fec_audit_runs',
];

const MIGRATION_5_TABLE_STATEMENTS: readonly string[] = [
  CREATE_TAX_AND_PAYMENT_SUBLEDGER,
  CREATE_WITHHOLDING_TAX_SUBLEDGER,
  CREATE_PAYROLL_ANNUAL_SUBLEDGER,
  CREATE_PAYROLL_EXEMPT_ELEMENTS,
  CREATE_PAYROLL_IR_REMITTANCES,
  CREATE_ARCHIVAL_PACKAGES,
  CREATE_STATE_TRANSITION_AUDIT,
  CREATE_FEC_AUDIT_RUNS,
];

/** Index nommés de Doc_06 § 08 qui portent sur la partie 4 (index partiels : voir l'écart 4 ci-dessus). */
const MIGRATION_5_INDEXES: readonly (readonly [string, string])[] = [
  ['idx_subledger_due_unpaid', 'CREATE INDEX idx_subledger_due_unpaid ON tax_and_payment_subledger (legal_due_date) WHERE payment_date IS NULL'],
  [
    'idx_subledger_timebar',
    'CREATE INDEX idx_subledger_timebar ON tax_and_payment_subledger (time_bar_deadline_date) WHERE time_bar_deadline_date IS NOT NULL',
  ],
];

/** Colonnes de `archival_packages` hors `pii_restricted_flag` : toutes doivent rester inchangées sous l'exception monotone. */
const ARCHIVAL_PACKAGE_COLUMNS_EXCEPT_FLAG = [
  'aip_id',
  'fiscal_year_id',
  'entry_id',
  'document_type',
  'dgi_clearance_uuid',
  'document_ref',
  'document_date',
  'amount_ttc_cents',
  'r2_object_key',
  'morocco_mirror_key',
  'payload_sha256',
  'encrypted_dek_base64',
  'iv_base64',
  'merkle_batch_id',
  'merkle_leaf_index',
  'merkle_proof_json',
  'archived_at',
  'retention_until',
] as const;

const MESSAGES_V5 = TENANT_V5_TRIGGER_MESSAGES;

/** DELETE : texte de Doc_06 § 06 côté SQLite ; côté PostgreSQL, fonction à fuseau UTC (l'échéance s'écrit sans fuseau). */
const WORM_DELETE_TRIGGER: MigrationStatement = {
  trigger: 'enforce_10year_worm_retention_delete',
  sqlite: `CREATE TRIGGER enforce_10year_worm_retention_delete
BEFORE DELETE ON archival_packages
FOR EACH ROW WHEN datetime('now') < datetime(OLD.retention_until)
BEGIN
    ${raiseSqlite(MESSAGES_V5.wormDelete)}
END`,
  postgres: `CREATE FUNCTION fisca_enforce_10year_worm_retention_delete() RETURNS trigger LANGUAGE plpgsql SET timezone = 'UTC' AS $fisca$
BEGIN
    IF now() < OLD.retention_until::timestamptz THEN
${raisePg(MESSAGES_V5.wormDelete)}
    END IF;
    RETURN OLD;
END;
$fisca$;
CREATE TRIGGER enforce_10year_worm_retention_delete
BEFORE DELETE ON archival_packages
FOR EACH ROW EXECUTE FUNCTION fisca_enforce_10year_worm_retention_delete()`,
};

/** UPDATE : ligne scellée (merkle_batch_id non NULL) immuable, sauf la montée monotone 0 vers 1 de pii_restricted_flag. */
const WORM_UPDATE_TRIGGER: MigrationStatement = createGuardedTrigger(
  'enforce_10year_worm_retention_update',
  'UPDATE',
  'archival_packages',
  `OLD.merkle_batch_id IS NOT NULL AND ${notMonotoneFlagRiseSqlite(ARCHIVAL_PACKAGE_COLUMNS_EXCEPT_FLAG)}`,
  `OLD.merkle_batch_id IS NOT NULL AND ${notMonotoneFlagRisePostgres(ARCHIVAL_PACKAGE_COLUMNS_EXCEPT_FLAG)}`,
  MESSAGES_V5.wormUpdate,
);

const MIGRATION_5_TRIGGERS: readonly MigrationStatement[] = [WORM_DELETE_TRIGGER, WORM_UPDATE_TRIGGER];

const MIGRATION_5_STATEMENTS: readonly string[] = [
  ...MIGRATION_5_TABLE_STATEMENTS,
  ...MIGRATION_5_INDEXES.map(([, sql]) => sql),
  ...MIGRATION_5_TRIGGERS.map((trigger) => trigger.sqlite),
];

/** Rang SQLite des triggers (après les tables et les index) avec leur traduction PostgreSQL. */
const MIGRATION_5_POSTGRES_OVERRIDES: Readonly<Record<number, string>> = Object.fromEntries(
  MIGRATION_5_TRIGGERS.map((trigger, index): [number, string] => [MIGRATION_5_TABLE_STATEMENTS.length + MIGRATION_5_INDEXES.length + index, trigger.postgres]),
);

const MIGRATION_5_TRIGGER_NAMES: readonly string[] = MIGRATION_5_TRIGGERS.flatMap((trigger) => (trigger.trigger === undefined ? [] : [trigger.trigger]));

// ---------------------------------------------------------------------------
// Migration v6 (T-S1B-05 et T-S1B-03) : correction du pilote, pii_restricted_flag MONOTONE sur toutes les tables porteuses
// (Doc_11 § 06 : un drapeau levé par erreur ou par malveillance ne doit jamais faire perdre la restriction fiscale décennale).
// Les migrations v1 à v5 restent intactes (empreintes figées par test).
//
// 1. Tables porteuses : invoices (v1), journal_entries et journal_entry_lines (v3), payroll_annual_subledger et archival_packages
//    (v5). La règle du pilote est la montée monotone PARTOUT : 0 vers 1 seulement, que la ligne soit POSTED, scellée ou libre.
// 2. Cinq triggers BEFORE UPDATE `prevent_pii_flag_downgrade_*` (invoices, payroll, journal_entries, journal_entry_lines,
//    archival_packages) : refus de 1 vers 0 seul, sans condition de statut. 0 vers 1 et 1 vers 1 passent, y compris combinés à
//    une autre modification : le reste de la ligne reste régi par ses règles propres (celles de v4 et v5 sur POSTED et scellé,
//    aucune sur la paie ni sur les lignes libres). Texte commun aux cinq tables, identique sur SQLite (RAISE(ABORT)) et
//    PostgreSQL (RAISE EXCEPTION, SQLSTATE P0001).
// 3. Les triggers de v4 et v5 ne sont pas retouchés : sur une ligne POSTED ou scellée, un UPDATE qui cumule 1 vers 0 et une autre
//    violation reçoit le texte du premier trigger exécuté (ordre propre à chaque moteur, voir tests/tenant-v6.test.ts).
// 4. Option (b) POS : la couverture colonne par colonne (tests/tenant-v6.test.ts) n'a révélé aucune colonne non comparée dans
//    `prevent_pos_ticket_update` ni `prevent_pos_z_closure_update` ; la v6 ne les remplace donc pas.
// ---------------------------------------------------------------------------
export const TENANT_V6_TRIGGER_MESSAGES = {
  piiFlagDowngrade: 'VIOLATION_CNDP_LOI_09_08_ART_211: Restriction fiscale irréversible : pii_restricted_flag ne peut pas redescendre de 1 à 0.',
} as const;

/** Refus de la seule descente 1 vers 0 (colonne NOT NULL : `IS NOT` côté SQLite, `IS DISTINCT FROM` côté PostgreSQL). */
function piiFlagDowngradeTrigger(name: string, table: string): MigrationStatement {
  return createGuardedTrigger(
    name,
    'UPDATE',
    table,
    'OLD.pii_restricted_flag = 1 AND NEW.pii_restricted_flag IS NOT 1',
    'OLD.pii_restricted_flag = 1 AND NEW.pii_restricted_flag IS DISTINCT FROM 1',
    TENANT_V6_TRIGGER_MESSAGES.piiFlagDowngrade,
  );
}

const MIGRATION_6_TRIGGERS: readonly MigrationStatement[] = [
  piiFlagDowngradeTrigger('prevent_pii_flag_downgrade_invoices', 'invoices'),
  piiFlagDowngradeTrigger('prevent_pii_flag_downgrade_payroll', 'payroll_annual_subledger'),
  piiFlagDowngradeTrigger('prevent_pii_flag_downgrade_journal_entries', 'journal_entries'),
  piiFlagDowngradeTrigger('prevent_pii_flag_downgrade_journal_entry_lines', 'journal_entry_lines'),
  piiFlagDowngradeTrigger('prevent_pii_flag_downgrade_archival_packages', 'archival_packages'),
];

const MIGRATION_6_STATEMENTS: readonly string[] = MIGRATION_6_TRIGGERS.map((trigger) => trigger.sqlite);

const MIGRATION_6_POSTGRES_OVERRIDES: Readonly<Record<number, string>> = Object.fromEntries(
  MIGRATION_6_TRIGGERS.map((trigger, index): [number, string] => [index, trigger.postgres]),
);

const MIGRATION_6_TRIGGER_NAMES: readonly string[] = MIGRATION_6_TRIGGERS.flatMap((trigger) => (trigger.trigger === undefined ? [] : [trigger.trigger]));

// ---------------------------------------------------------------------------
// Migration v7 (T-S1B-11, complément) : stockage SQL de l'Idempotency-Key 72 h dans TENANT_DB.
// DÉCISION DU PILOTE : la clé et l'écriture comptable doivent être validées dans le MÊME lot atomique (`executeBatchAtomically`),
// donc la clé vit dans la base du dossier. Les migrations v1 à v6 restent intactes (empreintes figées par test).
// Table `idempotency_keys` : `idempotency_key` est la clé de stockage du port `IdempotencyStore` (SHA-256 hexadécimal de société,
// utilisateur, méthode, chemin et clé client : jamais la clé client en clair), `request_sha256` l'empreinte de la requête.
// Une ligne dont `response_status` est NULL est une réservation EN COURS ; une ligne dont il est renseigné est TERMINÉE
// (`response_status` et `response_body_json` vont ensemble, contrainte `(… IS NULL) = (… IS NULL)`).
// Colonne ajoutée à la liste du pilote, strictement nécessaire au port : `content_type` (type de contenu mémorisé de la réponse,
// NULL si la route n'en a pas rendu : `StoredIdempotentResponse.contentType` est nullable). Aucune colonne `state` : l'état se
// déduit de `response_status IS NULL`. `response_body_json` porte le JSON `{"bodyBase64": …}` (le corps rendu peut être binaire).
// `created_at` et `expires_at` : instants ISO 8601 UTC à largeur fixe (`toISOString`), comparables comme du texte.
// Index `idx_idempotency_keys_expires_at` : purge des expirés (`DELETE … WHERE expires_at <= ?`).
// PostgreSQL : INTEGER devient BIGINT et le CHECK d'entier strict est retiré par la traduction mécanique, sans override.
// ---------------------------------------------------------------------------
const CREATE_IDEMPOTENCY_KEYS = `CREATE TABLE idempotency_keys (
    idempotency_key TEXT PRIMARY KEY,
    request_sha256 TEXT NOT NULL,
    response_status INTEGER CHECK (response_status >= 100 AND response_status <= 599) ${integerCheck('response_status')},
    response_body_json TEXT,
    content_type TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    CHECK (expires_at > created_at),
    CHECK ((response_status IS NULL) = (response_body_json IS NULL))
)`;

const MIGRATION_7_INDEXES: readonly (readonly [string, string])[] = [
  ['idx_idempotency_keys_expires_at', 'CREATE INDEX idx_idempotency_keys_expires_at ON idempotency_keys (expires_at)'],
];

const MIGRATION_7_TABLES: readonly string[] = ['idempotency_keys'];

const MIGRATION_7_STATEMENTS: readonly string[] = [CREATE_IDEMPOTENCY_KEYS, ...MIGRATION_7_INDEXES.map(([, sql]) => sql)];

/**
 * Migrations versionnées de TENANT_DB, dans l'ordre d'application.
 * IMMUABLES une fois appliquées : la v3 (T-S1B-04, grand livre) a été AJOUTÉE sans toucher aux versions 1 et 2 ;
 * la v5 (T-S1B-05, sous-livres, paie 9421, coffre AIP) est AJOUTÉE sans toucher aux versions 1 à 4 ;
 * la v6 (drapeau pii_restricted_flag monotone sur les 5 tables porteuses) est AJOUTÉE sans toucher aux versions 1 à 5 ;
 * la v7 (Idempotency-Key 72 h, table `idempotency_keys`) est AJOUTÉE sans toucher aux versions 1 à 6.
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
  {
    version: 4,
    name: 'tenant_part4_pilot_corrections_immutability_statuses',
    upSqlStatements: MIGRATION_4_STATEMENTS,
    expectedSha256Hex: 'f1cc97cfc9eff05135df66a7ae30b6eda31535c76a9eaad0d786e58ec1c1d85f',
    tableNames: [],
    indexNames: [],
    triggerNames: MIGRATION_4_TRIGGER_NAMES,
    sqliteOnlyTriggerNames: MIGRATION_4_SQLITE_ONLY_TRIGGERS,
    postgresConstraintNames: ['invoices_clearance_state_check', 'invoices_cdv_lifecycle_status_check'],
    postgresOverrides: MIGRATION_4_POSTGRES_OVERRIDES,
  },
  {
    version: 5,
    name: 'tenant_part5_subledgers_payroll_9421_archival_worm',
    upSqlStatements: MIGRATION_5_STATEMENTS,
    expectedSha256Hex: 'b6c338fcb3808b9cc210fd73981a3f628e8d7148910de8a2d0c12a77ec1de295',
    tableNames: MIGRATION_5_TABLES,
    indexNames: MIGRATION_5_INDEXES.map(([name]) => name),
    triggerNames: MIGRATION_5_TRIGGER_NAMES,
    postgresOverrides: MIGRATION_5_POSTGRES_OVERRIDES,
  },
  {
    version: 6,
    name: 'tenant_part6_pii_flag_monotone_all_tables',
    upSqlStatements: MIGRATION_6_STATEMENTS,
    expectedSha256Hex: '6750637f3351826b8cf4ecf816f46b232b41aad00bb7026c82c99ae86cd5b25f',
    tableNames: [],
    indexNames: [],
    triggerNames: MIGRATION_6_TRIGGER_NAMES,
    postgresOverrides: MIGRATION_6_POSTGRES_OVERRIDES,
  },
  {
    version: 7,
    name: 'tenant_part7_idempotency_keys',
    upSqlStatements: MIGRATION_7_STATEMENTS,
    expectedSha256Hex: 'ac8e45e9e121ebd8a6a0d804688389ec037248f3f9fc5446e8b6c43c4f2e98dd',
    tableNames: MIGRATION_7_TABLES,
    indexNames: MIGRATION_7_INDEXES.map(([name]) => name),
  },
];

/** Tables de TENANT_DB dans leur ordre de création (les parents précèdent les enfants), toutes migrations confondues. */
export const TENANT_TABLE_NAMES: readonly string[] = TENANT_MIGRATIONS.flatMap((migration) => migration.tableNames);

/** Index nommés créés par les migrations de TENANT_DB, dans leur ordre de création. */
export const TENANT_INDEX_NAMES: readonly string[] = TENANT_MIGRATIONS.flatMap((migration) => migration.indexNames);

/** Triggers de TENANT_DB dans leur ordre de première création, sans doublon (la v4 remplace deux triggers de la v3 sous le même nom). */
export const TENANT_TRIGGER_NAMES: readonly string[] = TENANT_MIGRATIONS.flatMap((migration) => migration.triggerNames ?? []).filter(
  (name, index, all) => all.indexOf(name) === index,
);

/** Triggers que SQLite porte seul (PostgreSQL les remplace par une contrainte CHECK nommée). */
const TENANT_SQLITE_ONLY_TRIGGER_NAMES: readonly string[] = TENANT_MIGRATIONS.flatMap((migration) => migration.sqliteOnlyTriggerNames ?? []);

/** Triggers présents sous PostgreSQL 16 (sans doublon : un trigger remplacé par la v4 n'existe qu'une fois). */
export const TENANT_POSTGRES_TRIGGER_NAMES: readonly string[] = TENANT_TRIGGER_NAMES.filter((name) => !TENANT_SQLITE_ONLY_TRIGGER_NAMES.includes(name));

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
