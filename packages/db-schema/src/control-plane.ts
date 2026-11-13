/**
 * DDL SQLite de CONTROL_PLANE_DB (Cloudflare D1) : Doc_06 § 02 (organisations, auth, annuaire ICE, règles AST,
 * registre FactorFlow, racines de Merkle), Doc_03 § 10 (tarification, abonnements, compteurs) et les objets que
 * les ports de `@fisca/auth-rbac` (S1A) et l'ERRATA D-19 exigent (ticket T-S1B-01).
 *
 * Règles tenues ici :
 * - migrations IMMUABLES : une migration appliquée ne se modifie jamais, toute correction est une migration de
 *   numéro supérieur. `expectedSha256Hex` est le SHA-256 de `upSqlStatements.join("\n")`, exactement le calcul de
 *   `ensureTenantSchemaUpToDate` (Doc_06 § 10) ; un test le recalcule ;
 * - montants : INTEGER seulement (`_cents`, `_bps`), jamais REAL. Le CHECK `col = CAST(col AS INTEGER)` refuse un
 *   montant fractionnaire ou textuel, car SQLite n'impose pas le type d'une colonne INTEGER (typage dynamique) ;
 *   il s'écrit de la même façon sous PostgreSQL 16 ;
 * - TVA : `vat_rate_bps IN (2000, 1000, 0)` strict (ERRATA D-04) ;
 * - rôles : 10 rôles humains ; `ERP_CONNECTOR_AGENT` et `AI_MCP_ACTOR` sont techniques, hors de la table (D-02) ;
 * - aucune donnée n'est insérée par une migration (aucune règle ni taux fiscal en dur, ADR-04) ;
 * - horodatages des tables ajoutées par le ticket : texte UTC `YYYY-MM-DDTHH:MM:SSZ` (Doc_06 § 01).
 */

/** Les 10 rôles humains autorisés dans `organization_memberships.role_code` (ERRATA D-02). */
export const HUMAN_ROLE_CODES = [
  'OWNER_GERANT',
  'COMMERCIAL_FACTURATION',
  'CAISSIER_POS',
  'ACHATS_BUYER',
  'MAGASINIER_BL',
  'DAF_TRESORIER',
  'AIDE_COMPTABLE',
  'CHEF_MISSION',
  'EXPERT_COMPTABLE_OEC',
  'AUDITEUR_CAC_DGI',
] as const;

/** Identités techniques : jamais une ligne de `organization_memberships` (ERRATA D-02). */
export const TECHNICAL_ROLE_CODES = ['ERP_CONNECTOR_AGENT', 'AI_MCP_ACTOR'] as const;

export type HumanRoleCode = (typeof HUMAN_ROLE_CODES)[number];
export type TechnicalRoleCode = (typeof TECHNICAL_ROLE_CODES)[number];

/** Taux de TVA admis dès 2026 (ERRATA D-04) : 20 %, 10 %, 0 %. */
export const VAT_RATE_BPS_VALUES = [2000, 1000, 0] as const;

export const ORG_KINDS = ['DIRECT_BUSINESS', 'FIDUCIAIRE_OEC', 'ENTERPRISE_GROUP'] as const;
export const UI_LOCALE_POLICIES = ['SIX_LOCALES_PME', 'THREE_LOCALES_INSTITUTIONAL'] as const;
export const MFA_METHODS = ['NONE', 'TOTP_APP', 'INFOBIP_OTP', 'WEBAUTHN_PASSKEY'] as const;
export const OAUTH_PROVIDERS = ['GOOGLE', 'ENTRA_OIDC', 'SAML_CORP'] as const;
export const DOSSIER_TIERS = ['DOSSIER_SIMPLIFIE', 'DOSSIER_TPE', 'DOSSIER_PME_COMPLET'] as const;
/** ERRATA D-06. */
export const DOSSIER_METER_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const POS_TERMINAL_STATUSES = ['ACTIVE', 'DECOMMISSIONED'] as const;
export const SUBSCRIPTION_STATUSES = [
  'TRIAL_SANDBOX_14D',
  'ACTIVE_PAID',
  'PAST_DUE_GRACE_14D',
  'RESTRICTED_READ_ONLY',
  'CANCELED_WORM_PRESERVED',
] as const;
export const PASSKEY_PURPOSES = ['REGISTRATION', 'AUTHENTICATION'] as const;
export const ONE_TIME_TOKEN_PURPOSES = ['email-verify', 'password-reset'] as const;
/** Algorithmes COSE acceptés par passkeys.ts : ES256 (-7) et EdDSA (-8). */
export const PASSKEY_ALGORITHMS = [-7, -8] as const;

export interface ControlPlaneMigration {
  readonly version: number;
  readonly name: string;
  readonly upSqlStatements: readonly string[];
  /** SHA-256 hexadécimal de `upSqlStatements.join("\n")`. */
  readonly expectedSha256Hex: string;
}

function quoteList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/** CHECK d'entier strict (Loi 1) : refuse 12.5, '12.5' et 'abc'. */
function integerCheck(column: string): string {
  return `CHECK (${column} = CAST(${column} AS INTEGER))`;
}

function booleanCheck(column: string): string {
  return `CHECK (${column} IN (0, 1))`;
}

/** Texte UTC `YYYY-MM-DDTHH:MM:SSZ` (20 caractères), forme vérifiable sans fonction propre à SQLite. */
function utcTimestampShape(column: string): string {
  return `length(${column}) = 20 AND substr(${column}, 11, 1) = 'T' AND substr(${column}, 20, 1) = 'Z'`;
}

function utcTimestampCheck(column: string): string {
  return `CHECK (${utcTimestampShape(column)})`;
}

function nullableUtcTimestampCheck(column: string): string {
  return `CHECK (${column} IS NULL OR (${utcTimestampShape(column)}))`;
}

// ---------------------------------------------------------------------------
// Migration 1 : tables de Doc_06 § 02 et de Doc_03 § 10
// ---------------------------------------------------------------------------

const CREATE_ORGANIZATIONS = `CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    org_kind TEXT NOT NULL CHECK (org_kind IN (${quoteList(ORG_KINDS)})),
    custom_hostname TEXT UNIQUE,
    ui_locale_policy TEXT NOT NULL CHECK (ui_locale_policy IN (${quoteList(UI_LOCALE_POLICIES)})),
    created_at TEXT NOT NULL
)`;

const CREATE_USERS = `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email_normalized TEXT NOT NULL UNIQUE,
    is_email_verified INTEGER NOT NULL DEFAULT 0,
    phone_e164 TEXT UNIQUE,
    is_phone_verified INTEGER NOT NULL DEFAULT 0,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    password_hash_pbkdf2 TEXT,
    password_updated_at TEXT,
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    mfa_preferred_method TEXT NOT NULL DEFAULT 'NONE' CHECK (
        mfa_preferred_method IN (${quoteList(MFA_METHODS)})
    ),
    preferred_locale TEXT NOT NULL DEFAULT 'fr',
    created_at TEXT NOT NULL
)`;

const CREATE_USER_OAUTH_ACCOUNTS = `CREATE TABLE user_oauth_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL CHECK (provider IN (${quoteList(OAUTH_PROVIDERS)})),
    provider_subject_id TEXT NOT NULL,
    provider_email TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    UNIQUE(provider, provider_subject_id)
)`;

const CREATE_USER_MFA_FACTORS = `CREATE TABLE user_mfa_factors (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    totp_secret_aes_gcm TEXT,
    totp_verified_at TEXT,
    last_used_totp_step INTEGER,
    recovery_codes_hashes_json TEXT,
    updated_at TEXT NOT NULL
)`;

const CREATE_USER_TRUSTED_DEVICES = `CREATE TABLE user_trusted_devices (
    device_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    device_token_sha256 TEXT NOT NULL UNIQUE,
    user_agent_summary TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
)`;

const CREATE_ORGANIZATION_MEMBERSHIPS = `CREATE TABLE organization_memberships (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role_code TEXT NOT NULL CHECK (role_code IN (${quoteList(HUMAN_ROLE_CODES)})),
    public_key_spki_b64 TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(organization_id, user_id)
)`;

const CREATE_TENANT_DATABASES = `CREATE TABLE tenant_databases (
    company_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    ice TEXT NOT NULL UNIQUE,
    identifiant_fiscal TEXT NOT NULL,
    raison_sociale_fr TEXT NOT NULL,
    raison_sociale_ar TEXT,
    legal_form TEXT NOT NULL,
    share_capital_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('share_capital_cents')},
    vat_regime TEXT NOT NULL CHECK (vat_regime IN ('ENCAISSEMENT', 'DEBIT', 'EXONERE_AE')),
    vat_cadence TEXT NOT NULL CHECK (vat_cadence IN ('MENSUELLE', 'TRIMESTRIELLE', 'NONE')),
    crypto_mode TEXT NOT NULL DEFAULT 'CLOUD_ASSISTED' CHECK (crypto_mode IN ('CLOUD_ASSISTED', 'ZERO_KNOWLEDGE_E2EE')),
    storage_driver TEXT NOT NULL DEFAULT 'CLOUDFLARE_D1_EU' CHECK (storage_driver IN ('CLOUDFLARE_D1_EU', 'HYPERDRIVE_MAROC_PG')),
    d1_database_uuid TEXT NOT NULL UNIQUE,
    ingest_email_alias TEXT NOT NULL UNIQUE,
    schema_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
)`;

const CREATE_MOROCCO_COMPANY_DIRECTORY = `CREATE TABLE morocco_company_directory (
    ice TEXT PRIMARY KEY,
    identifiant_fiscal TEXT NOT NULL,
    rc_number TEXT,
    rc_tribunal TEXT,
    taxe_pro TEXT,
    raison_sociale_fr TEXT NOT NULL,
    raison_sociale_ar TEXT,
    legal_form TEXT,
    share_capital_cents INTEGER ${integerCheck('share_capital_cents')},
    address_adc450 TEXT NOT NULL,
    verified_count INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
)`;

const CREATE_DYNAMIC_FISCAL_RULES = `CREATE TABLE dynamic_fiscal_rules (
    rule_id TEXT PRIMARY KEY,
    cgi_article_ref TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    target_scope TEXT NOT NULL CHECK (target_scope IN ('INVOICE_LINE', 'INVOICE_GLOBAL', 'JOURNAL_ENTRY', 'FEC_AUDIT')),
    status TEXT NOT NULL CHECK (status IN ('PENDING_ADMIN_APPROVAL', 'SHADOW_OBSERVE', 'ACTIVE', 'SUPERSEDED')),
    rule_ast_json TEXT NOT NULL,
    wiki_source_slug TEXT NOT NULL,
    created_at TEXT NOT NULL
)`;

const CREATE_SIMPL_IS_CELL_RULES = `CREATE TABLE simpl_is_cell_rules (
    id TEXT PRIMARY KEY,
    modele_id INTEGER NOT NULL CHECK (modele_id BETWEEN 1 AND 4),
    tableau_id INTEGER NOT NULL,
    code_edi INTEGER NOT NULL,
    eval_order INTEGER NOT NULL CHECK (eval_order BETWEEN 1 AND 4),
    column_role TEXT NOT NULL,
    mapping_rule_json TEXT NOT NULL,
    UNIQUE(modele_id, code_edi)
)`;

const CREATE_PLEDGED_INVOICES_REGISTRY = `CREATE TABLE pledged_invoices_registry (
    id TEXT PRIMARY KEY,
    xhub_uuid TEXT NOT NULL UNIQUE,
    invoice_sha256 TEXT NOT NULL UNIQUE,
    seller_ice TEXT NOT NULL,
    buyer_ice TEXT NOT NULL,
    financier_partner_id TEXT NOT NULL,
    pledge_status TEXT NOT NULL CHECK (pledge_status IN ('LOCKED_EVALUATION', 'FINANCED_SUBROGATED', 'SETTLED', 'RELEASED')),
    subrogation_aip_id TEXT,
    locked_at TEXT NOT NULL
)`;

const CREATE_ARCHIVAL_MERKLE_BATCHES = `CREATE TABLE archival_merkle_batches (
    batch_id TEXT PRIMARY KEY,
    batch_date TEXT NOT NULL UNIQUE,
    leaf_count INTEGER NOT NULL CHECK (leaf_count > 0),
    previous_batch_root_hash TEXT NOT NULL,
    merkle_root_sha256 TEXT NOT NULL,
    chained_root_sha256 TEXT NOT NULL,
    tsa_rfc3161_token_b64 TEXT NOT NULL,
    last_lta_renewal_at TEXT,
    lta_renewal_token_b64 TEXT
)`;

const CREATE_PRICING_CATALOG = `CREATE TABLE pricing_catalog (
    plan_code TEXT PRIMARY KEY,
    segment TEXT NOT NULL CHECK (segment IN ('DIRECT_PME', 'FIDUCIAIRE', 'ENTERPRISE', 'POS_ADDON', 'MOWAKABA_PACK')),
    billing_cadence TEXT NOT NULL CHECK (billing_cadence IN ('MONTHLY', 'ANNUAL', 'ONE_TIME')),
    unit_price_ht_cents INTEGER NOT NULL CHECK (unit_price_ht_cents >= 0) ${integerCheck('unit_price_ht_cents')},
    vat_rate_bps INTEGER NOT NULL DEFAULT 2000 CHECK (vat_rate_bps IN (${VAT_RATE_BPS_VALUES.join(', ')})) ${integerCheck('vat_rate_bps')},
    included_users INTEGER NOT NULL DEFAULT 1,
    included_pos_terminals INTEGER NOT NULL DEFAULT 0,
    included_subsidiaries_ice INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
)`;

const CREATE_PLAN_ENTITLEMENTS = `CREATE TABLE plan_entitlements (
    plan_code TEXT NOT NULL REFERENCES pricing_catalog(plan_code),
    feature_key TEXT NOT NULL,
    bool_value INTEGER NOT NULL DEFAULT 0,
    numeric_limit INTEGER,
    PRIMARY KEY (plan_code, feature_key)
)`;

const CREATE_SUBSCRIPTIONS = `CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id),
    plan_code TEXT NOT NULL REFERENCES pricing_catalog(plan_code),
    cadence TEXT NOT NULL CHECK (cadence IN ('MONTHLY', 'ANNUAL')),
    status TEXT NOT NULL CHECK (status IN (${quoteList(SUBSCRIPTION_STATUSES)})),
    locked_base_price_ht_cents INTEGER NOT NULL ${integerCheck('locked_base_price_ht_cents')},
    trial_ends_at TEXT,
    current_period_start TEXT NOT NULL,
    current_period_end TEXT NOT NULL,
    grace_ends_at TEXT,
    payment_method TEXT NOT NULL DEFAULT 'PAYZONE_CARD' CHECK (payment_method IN ('PAYZONE_CARD', 'SIMT_WIRE')),
    payzone_customer_token TEXT,
    extra_seats_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
)`;

const CREATE_FIDUCIARY_DOSSIER_METERS = `CREATE TABLE fiduciary_dossier_meters (
    id TEXT PRIMARY KEY,
    cabinet_org_id TEXT NOT NULL REFERENCES organizations(id),
    client_company_id TEXT NOT NULL UNIQUE REFERENCES tenant_databases(company_id),
    dossier_tier TEXT NOT NULL CHECK (dossier_tier IN (${quoteList(DOSSIER_TIERS)})),
    pending_next_month_tier TEXT CHECK (pending_next_month_tier IN (${quoteList(DOSSIER_TIERS)})),
    monthly_rate_ht_cents INTEGER NOT NULL ${integerCheck('monthly_rate_ht_cents')},
    activated_on_date TEXT NOT NULL,
    minimum_commitment_until TEXT NOT NULL,
    archived_on_date TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (${quoteList(DOSSIER_METER_STATUSES)}))
)`;

const CREATE_POS_TERMINAL_METERS = `CREATE TABLE pos_terminal_meters (
    terminal_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    company_id TEXT NOT NULL REFERENCES tenant_databases(company_id),
    device_fingerprint TEXT NOT NULL,
    is_included_free INTEGER NOT NULL DEFAULT 0,
    monthly_rate_ht_cents INTEGER NOT NULL ${integerCheck('monthly_rate_ht_cents')},
    activated_on_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN (${quoteList(POS_TERMINAL_STATUSES)}))
)`;

const CREATE_PREPAID_WALLETS = `CREATE TABLE prepaid_wallets (
    organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
    mowakaba_dossier_credit_ht_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('mowakaba_dossier_credit_ht_cents')},
    kyb_scoring_balance_ht_cents INTEGER NOT NULL DEFAULT 0 ${integerCheck('kyb_scoring_balance_ht_cents')},
    updated_at TEXT NOT NULL
)`;

// ---------------------------------------------------------------------------
// Migration 2 : stockages des ports de S1A (refresh, passkeys, OAuth, jetons, MFA)
// ---------------------------------------------------------------------------

const CREATE_REFRESH_TOKENS = `CREATE TABLE refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    issued_at TEXT NOT NULL ${utcTimestampCheck('issued_at')},
    expires_at TEXT NOT NULL ${utcTimestampCheck('expires_at')},
    rotated_at TEXT ${nullableUtcTimestampCheck('rotated_at')},
    revoked_at TEXT ${nullableUtcTimestampCheck('revoked_at')},
    mfa_verified_at TEXT ${nullableUtcTimestampCheck('mfa_verified_at')},
    amr TEXT NOT NULL DEFAULT '[]',
    CHECK (expires_at > issued_at)
)`;

const CREATE_PASSKEY_CREDENTIALS = `CREATE TABLE passkey_credentials (
    credential_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    public_key_cose TEXT NOT NULL,
    algorithm INTEGER NOT NULL CHECK (algorithm IN (${PASSKEY_ALGORITHMS.join(', ')})),
    sign_count INTEGER NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
    transports TEXT NOT NULL DEFAULT '[]',
    backup_eligible INTEGER NOT NULL DEFAULT 0 ${booleanCheck('backup_eligible')},
    backup_state INTEGER NOT NULL DEFAULT 0 ${booleanCheck('backup_state')},
    prf_enabled INTEGER NOT NULL DEFAULT 0 ${booleanCheck('prf_enabled')},
    created_at TEXT NOT NULL ${utcTimestampCheck('created_at')},
    CHECK (backup_state = 0 OR backup_eligible = 1)
)`;

const CREATE_PASSKEY_CHALLENGES = `CREATE TABLE passkey_challenges (
    challenge TEXT PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN (${quoteList(PASSKEY_PURPOSES)})),
    user_id TEXT REFERENCES users(id),
    expires_at TEXT NOT NULL ${utcTimestampCheck('expires_at')}
)`;

const CREATE_OAUTH_TRANSACTIONS = `CREATE TABLE oauth_transactions (
    state TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    turnstile_verified INTEGER NOT NULL ${booleanCheck('turnstile_verified')},
    expires_at TEXT NOT NULL ${utcTimestampCheck('expires_at')}
)`;

const CREATE_PENDING_OAUTH_LINKS = `CREATE TABLE pending_oauth_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL CHECK (provider IN (${quoteList(OAUTH_PROVIDERS)})),
    provider_subject_id TEXT NOT NULL,
    provider_email TEXT NOT NULL,
    has_password INTEGER NOT NULL ${booleanCheck('has_password')},
    email_proof_token_sha256 TEXT NOT NULL,
    attempts_left INTEGER NOT NULL CHECK (attempts_left >= 0),
    expires_at TEXT NOT NULL ${utcTimestampCheck('expires_at')}
)`;

const CREATE_ONE_TIME_TOKENS = `CREATE TABLE one_time_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    purpose TEXT NOT NULL CHECK (purpose IN (${quoteList(ONE_TIME_TOKEN_PURPOSES)})),
    email_normalized TEXT NOT NULL,
    expires_at TEXT NOT NULL ${utcTimestampCheck('expires_at')},
    UNIQUE(user_id, purpose)
)`;

const CREATE_MFA_CHALLENGE_STATES = `CREATE TABLE mfa_challenge_states (
    jti TEXT PRIMARY KEY,
    consumed_at TEXT ${nullableUtcTimestampCheck('consumed_at')},
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    expires_at TEXT NOT NULL ${utcTimestampCheck('expires_at')}
)`;

// ---------------------------------------------------------------------------
// Migration 3 : idempotence des files (ERRATA D-19, Doc_04 § 06)
// ---------------------------------------------------------------------------

const CREATE_PROCESSED_QUEUE_MESSAGES = `CREATE TABLE processed_queue_messages (
    queue_name TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_sha256 TEXT NOT NULL CHECK (length(event_sha256) = 64 AND event_sha256 = lower(event_sha256)),
    processed_at TEXT NOT NULL ${utcTimestampCheck('processed_at')},
    expires_at TEXT NOT NULL ${utcTimestampCheck('expires_at')},
    PRIMARY KEY (queue_name, event_id),
    CHECK (expires_at > processed_at)
)`;

/** Index nommés, par migration. Les contraintes UNIQUE créent leurs index automatiques sans nom. */
const MIGRATION_2_INDEXES: readonly (readonly [string, string])[] = [
  ['idx_refresh_tokens_family', 'CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id)'],
  ['idx_refresh_tokens_user_family', 'CREATE INDEX idx_refresh_tokens_user_family ON refresh_tokens (user_id, family_id)'],
  ['idx_refresh_tokens_expires_at', 'CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens (expires_at)'],
  ['idx_passkey_credentials_user', 'CREATE INDEX idx_passkey_credentials_user ON passkey_credentials (user_id)'],
  ['idx_passkey_challenges_expires_at', 'CREATE INDEX idx_passkey_challenges_expires_at ON passkey_challenges (expires_at)'],
  ['idx_oauth_transactions_expires_at', 'CREATE INDEX idx_oauth_transactions_expires_at ON oauth_transactions (expires_at)'],
  ['idx_pending_oauth_links_expires_at', 'CREATE INDEX idx_pending_oauth_links_expires_at ON pending_oauth_links (expires_at)'],
  ['idx_one_time_tokens_expires_at', 'CREATE INDEX idx_one_time_tokens_expires_at ON one_time_tokens (expires_at)'],
  ['idx_mfa_challenge_states_expires_at', 'CREATE INDEX idx_mfa_challenge_states_expires_at ON mfa_challenge_states (expires_at)'],
];

const MIGRATION_3_INDEXES: readonly (readonly [string, string])[] = [
  ['idx_processed_queue_messages_expires_at', 'CREATE INDEX idx_processed_queue_messages_expires_at ON processed_queue_messages (expires_at)'],
];

const MIGRATION_1_STATEMENTS: readonly string[] = [
  CREATE_ORGANIZATIONS,
  CREATE_USERS,
  CREATE_USER_OAUTH_ACCOUNTS,
  CREATE_USER_MFA_FACTORS,
  CREATE_USER_TRUSTED_DEVICES,
  CREATE_ORGANIZATION_MEMBERSHIPS,
  CREATE_TENANT_DATABASES,
  CREATE_MOROCCO_COMPANY_DIRECTORY,
  CREATE_DYNAMIC_FISCAL_RULES,
  CREATE_SIMPL_IS_CELL_RULES,
  CREATE_PLEDGED_INVOICES_REGISTRY,
  CREATE_ARCHIVAL_MERKLE_BATCHES,
  CREATE_PRICING_CATALOG,
  CREATE_PLAN_ENTITLEMENTS,
  CREATE_SUBSCRIPTIONS,
  CREATE_FIDUCIARY_DOSSIER_METERS,
  CREATE_POS_TERMINAL_METERS,
  CREATE_PREPAID_WALLETS,
];

const MIGRATION_2_STATEMENTS: readonly string[] = [
  CREATE_REFRESH_TOKENS,
  CREATE_PASSKEY_CREDENTIALS,
  CREATE_PASSKEY_CHALLENGES,
  CREATE_OAUTH_TRANSACTIONS,
  CREATE_PENDING_OAUTH_LINKS,
  CREATE_ONE_TIME_TOKENS,
  CREATE_MFA_CHALLENGE_STATES,
  ...MIGRATION_2_INDEXES.map(([, sql]) => sql),
];

const MIGRATION_3_STATEMENTS: readonly string[] = [
  CREATE_PROCESSED_QUEUE_MESSAGES,
  ...MIGRATION_3_INDEXES.map(([, sql]) => sql),
];

/**
 * Migrations versionnées du plan de contrôle, dans l'ordre d'application.
 * IMMUABLES une fois appliquées : toute correction est une migration de version supérieure.
 */
export const CONTROL_PLANE_MIGRATIONS: readonly ControlPlaneMigration[] = [
  {
    version: 1,
    name: 'control_plane_core',
    upSqlStatements: MIGRATION_1_STATEMENTS,
    expectedSha256Hex: '46dd28bf38c55458ce6f096e876da1d8b49dca273a99aa86982764a7f12439ae',
  },
  {
    version: 2,
    name: 'control_plane_auth_stores',
    upSqlStatements: MIGRATION_2_STATEMENTS,
    expectedSha256Hex: 'c85a6b9bcb464634089d19024884c4ae039534e9ad99fdfa895cfa6e9525e125',
  },
  {
    version: 3,
    name: 'control_plane_queue_idempotence',
    upSqlStatements: MIGRATION_3_STATEMENTS,
    expectedSha256Hex: '36eac2e7d810d74eabf7f7670a57dbf129fd660823a9540baf30593b3a327cfe',
  },
];

/** Tables de CONTROL_PLANE_DB dans leur ordre de création (les parents précèdent les enfants). */
export const CONTROL_PLANE_TABLE_NAMES: readonly string[] = [
  'organizations',
  'users',
  'user_oauth_accounts',
  'user_mfa_factors',
  'user_trusted_devices',
  'organization_memberships',
  'tenant_databases',
  'morocco_company_directory',
  'dynamic_fiscal_rules',
  'simpl_is_cell_rules',
  'pledged_invoices_registry',
  'archival_merkle_batches',
  'pricing_catalog',
  'plan_entitlements',
  'subscriptions',
  'fiduciary_dossier_meters',
  'pos_terminal_meters',
  'prepaid_wallets',
  'refresh_tokens',
  'passkey_credentials',
  'passkey_challenges',
  'oauth_transactions',
  'pending_oauth_links',
  'one_time_tokens',
  'mfa_challenge_states',
  'processed_queue_messages',
];

/** Index nommés créés par les migrations, dans leur ordre de création. */
export const CONTROL_PLANE_INDEX_NAMES: readonly string[] = [...MIGRATION_2_INDEXES, ...MIGRATION_3_INDEXES].map(([name]) => name);

/**
 * Requêtes d'usage des stockages (paramètres `?`, un par valeur, dans l'ordre indiqué). Les lectures-suppressions
 * sont des instructions uniques `DELETE … RETURNING` : la base est seule juge de l'atomicité (KV ne la garantit pas).
 * Chaque requête qui doit signaler « j'ai gagné » renvoie une ligne via RETURNING, et zéro ligne sinon.
 */
export const CONTROL_PLANE_SQL = {
  /** (state, nonce, code_verifier, turnstile_verified, expires_at) */
  oauthTransactionSave: `INSERT INTO oauth_transactions (state, nonce, code_verifier, turnstile_verified, expires_at) VALUES (?, ?, ?, ?, ?)`,
  /** (state) : lecture ET suppression en une instruction. */
  oauthTransactionConsume: `DELETE FROM oauth_transactions WHERE state = ? RETURNING state, nonce, code_verifier, turnstile_verified, expires_at`,
  /** (now) */
  oauthTransactionPurgeExpired: `DELETE FROM oauth_transactions WHERE expires_at < ?`,

  /** (id, user_id, provider, provider_subject_id, provider_email, has_password, email_proof_token_sha256, attempts_left, expires_at) */
  pendingLinkSave: `INSERT INTO pending_oauth_links (id, user_id, provider, provider_subject_id, provider_email, has_password, email_proof_token_sha256, attempts_left, expires_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, provider = excluded.provider, provider_subject_id = excluded.provider_subject_id,
  provider_email = excluded.provider_email, has_password = excluded.has_password, email_proof_token_sha256 = excluded.email_proof_token_sha256,
  attempts_left = excluded.attempts_left, expires_at = excluded.expires_at`,
  /** (id) : lecture ET suppression en une instruction. */
  pendingLinkTake: `DELETE FROM pending_oauth_links WHERE id = ? RETURNING id, user_id, provider, provider_subject_id, provider_email, has_password, email_proof_token_sha256, attempts_left, expires_at`,

  /** (token_hash, user_id, purpose, email_normalized, expires_at) : remplace le jeton actif du même (utilisateur, usage). */
  oneTimeTokenSave: `INSERT INTO one_time_tokens (token_hash, user_id, purpose, email_normalized, expires_at) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(user_id, purpose) DO UPDATE SET token_hash = excluded.token_hash, email_normalized = excluded.email_normalized, expires_at = excluded.expires_at`,
  /** (token_hash) : lecture ET suppression en une instruction. */
  oneTimeTokenConsume: `DELETE FROM one_time_tokens WHERE token_hash = ? RETURNING token_hash, user_id, purpose, email_normalized, expires_at`,

  /** (challenge, purpose, user_id, expires_at) */
  passkeyChallengeSave: `INSERT INTO passkey_challenges (challenge, purpose, user_id, expires_at) VALUES (?, ?, ?, ?)`,
  /** (challenge) : lecture ET suppression en une instruction. */
  passkeyChallengeConsume: `DELETE FROM passkey_challenges WHERE challenge = ? RETURNING challenge, purpose, user_id, expires_at`,

  /** (jti) : aucune ligne si le jti est inconnu. */
  mfaChallengeIsConsumed: `SELECT CASE WHEN consumed_at IS NULL THEN 0 ELSE 1 END AS consumed FROM mfa_challenge_states WHERE jti = ?`,
  /** (jti, expires_at, consumed_at) : une ligne seulement au premier appel. */
  mfaChallengeConsume: `INSERT INTO mfa_challenge_states (jti, consumed_at, failure_count, expires_at) VALUES (?1, ?3, 0, ?2)
ON CONFLICT(jti) DO UPDATE SET consumed_at = excluded.consumed_at WHERE mfa_challenge_states.consumed_at IS NULL
RETURNING jti`,
  /** (jti) : aucune ligne si le jti est inconnu (échecs = 0). */
  mfaChallengeFailureCount: `SELECT failure_count FROM mfa_challenge_states WHERE jti = ?`,
  /** (jti, expires_at) : renvoie le total d'échecs. */
  mfaChallengeRecordFailure: `INSERT INTO mfa_challenge_states (jti, consumed_at, failure_count, expires_at) VALUES (?, NULL, 1, ?)
ON CONFLICT(jti) DO UPDATE SET failure_count = mfa_challenge_states.failure_count + 1
RETURNING failure_count`,
  /** (user_id, hash, updated_at) : retire une empreinte de recovery_codes_hashes_json, une ligne si elle était présente. */
  mfaRecoveryCodeConsume: `UPDATE user_mfa_factors
SET recovery_codes_hashes_json = (SELECT json_group_array(value) FROM json_each(recovery_codes_hashes_json) WHERE value <> ?2),
    updated_at = ?3
WHERE user_id = ?1
  AND recovery_codes_hashes_json IS NOT NULL
  AND EXISTS (SELECT 1 FROM json_each(recovery_codes_hashes_json) WHERE value = ?2)
RETURNING user_id`,

  /** (token_hash, family_id, user_id, issued_at, expires_at, mfa_verified_at, amr) */
  refreshTokenInsert: `INSERT INTO refresh_tokens (token_hash, family_id, user_id, issued_at, expires_at, mfa_verified_at, amr) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  /** (token_hash) */
  refreshTokenFindByHash: `SELECT token_hash, family_id, user_id, issued_at, expires_at, rotated_at, revoked_at, mfa_verified_at, amr FROM refresh_tokens WHERE token_hash = ?`,
  /** (token_hash, rotated_at) : compare-and-set, une ligne seulement si le jeton n'était pas encore tourné. */
  refreshTokenMarkRotated: `UPDATE refresh_tokens SET rotated_at = ?2 WHERE token_hash = ?1 AND rotated_at IS NULL RETURNING token_hash`,
  /** (family_id, revoked_at) : ne réécrit pas une révocation antérieure. */
  refreshFamilyRevoke: `UPDATE refresh_tokens SET revoked_at = ?2 WHERE family_id = ?1 AND revoked_at IS NULL`,
  /** (user_id) */
  refreshFamilyListByUser: `SELECT DISTINCT family_id FROM refresh_tokens WHERE user_id = ? ORDER BY family_id`,
  /** (now) */
  refreshTokenPurgeExpired: `DELETE FROM refresh_tokens WHERE expires_at < ?`,

  /** (credential_id, user_id, public_key_cose, algorithm, sign_count, transports, backup_eligible, backup_state, prf_enabled, created_at) */
  passkeyCredentialInsert: `INSERT INTO passkey_credentials (credential_id, user_id, public_key_cose, algorithm, sign_count, transports, backup_eligible, backup_state, prf_enabled, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  /** Mêmes paramètres : aucune ligne si le credential_id existe déjà (le port renvoie alors false). */
  passkeyCredentialInsertIgnore: `INSERT INTO passkey_credentials (credential_id, user_id, public_key_cose, algorithm, sign_count, transports, backup_eligible, backup_state, prf_enabled, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(credential_id) DO NOTHING
RETURNING credential_id`,
  /** (credential_id) */
  passkeyCredentialFindById: `SELECT credential_id, user_id, public_key_cose, algorithm, sign_count, transports, backup_eligible, backup_state, prf_enabled, created_at FROM passkey_credentials WHERE credential_id = ?`,
  /** (user_id) */
  passkeyCredentialListByUser: `SELECT credential_id, user_id, public_key_cose, algorithm, sign_count, transports, backup_eligible, backup_state, prf_enabled, created_at FROM passkey_credentials WHERE user_id = ? ORDER BY created_at, credential_id`,
  /** (credential_id, expected_previous, next, backup_state) : compare-and-set sur sign_count. */
  passkeyCredentialUpdateSignCount: `UPDATE passkey_credentials SET sign_count = ?3, backup_state = ?4 WHERE credential_id = ?1 AND sign_count = ?2 RETURNING credential_id`,

  /** (queue_name, event_id, event_sha256, processed_at, expires_at) : une ligne seulement pour le premier consommateur. */
  queueMessageClaim: `INSERT INTO processed_queue_messages (queue_name, event_id, event_sha256, processed_at, expires_at) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(queue_name, event_id) DO NOTHING
RETURNING event_id`,
  /** (now) */
  queueMessagePurgeExpired: `DELETE FROM processed_queue_messages WHERE expires_at < ?`,
} as const;
