/**
 * Schéma Drizzle (`drizzle-orm/sqlite-core`, compatible Cloudflare D1) de CONTROL_PLANE_DB.
 *
 * Le DDL de `control-plane.ts` fait foi : ce fichier ne sert qu'au typage des requêtes (`drizzle(env.CONTROL_PLANE_DB)`,
 * Doc_04 § 04). Un test compare tables, colonnes, nullités, clés étrangères et index à PRAGMA sur la base réelle.
 * Les CHECK ne sont pas répétés ici : ils vivent dans le DDL appliqué par les migrations, jamais généré par drizzle-kit.
 */

import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  DOSSIER_METER_STATUSES,
  DOSSIER_TIERS,
  HUMAN_ROLE_CODES,
  MFA_METHODS,
  OAUTH_PROVIDERS,
  ONE_TIME_TOKEN_PURPOSES,
  ORG_KINDS,
  PASSKEY_PURPOSES,
  POS_TERMINAL_STATUSES,
  SUBSCRIPTION_STATUSES,
  UI_LOCALE_POLICIES,
} from './control-plane.ts';

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  orgKind: text('org_kind', { enum: ORG_KINDS }).notNull(),
  customHostname: text('custom_hostname').unique(),
  uiLocalePolicy: text('ui_locale_policy', { enum: UI_LOCALE_POLICIES }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  emailNormalized: text('email_normalized').notNull().unique(),
  isEmailVerified: integer('is_email_verified').notNull().default(0),
  phoneE164: text('phone_e164').unique(),
  isPhoneVerified: integer('is_phone_verified').notNull().default(0),
  fullName: text('full_name').notNull(),
  avatarUrl: text('avatar_url'),
  passwordHashPbkdf2: text('password_hash_pbkdf2'),
  passwordUpdatedAt: text('password_updated_at'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: text('locked_until'),
  mfaEnabled: integer('mfa_enabled').notNull().default(0),
  mfaPreferredMethod: text('mfa_preferred_method', { enum: MFA_METHODS }).notNull().default('NONE'),
  preferredLocale: text('preferred_locale').notNull().default('fr'),
  createdAt: text('created_at').notNull(),
  /** Doc_17 § 02 (canal WABA : OTP et relances groupées), ERRATA D-19 ; migration 4 du plan de contrôle. Horodatages UTC ISO, NULL tant que non posés. */
  whatsappOptinAt: text('whatsapp_optin_at'),
  unsubscribedAt: text('unsubscribed_at'),
});

export const userOauthAccounts = sqliteTable('user_oauth_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  provider: text('provider', { enum: OAUTH_PROVIDERS }).notNull(),
  providerSubjectId: text('provider_subject_id').notNull(),
  providerEmail: text('provider_email').notNull(),
  linkedAt: text('linked_at').notNull(),
});

export const userMfaFactors = sqliteTable('user_mfa_factors', {
  userId: text('user_id').primaryKey().references(() => users.id),
  totpSecretAesGcm: text('totp_secret_aes_gcm'),
  totpVerifiedAt: text('totp_verified_at'),
  lastUsedTotpStep: integer('last_used_totp_step'),
  recoveryCodesHashesJson: text('recovery_codes_hashes_json'),
  updatedAt: text('updated_at').notNull(),
});

export const userTrustedDevices = sqliteTable('user_trusted_devices', {
  deviceId: text('device_id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  deviceTokenSha256: text('device_token_sha256').notNull().unique(),
  userAgentSummary: text('user_agent_summary').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
});

export const organizationMemberships = sqliteTable('organization_memberships', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  userId: text('user_id').notNull().references(() => users.id),
  roleCode: text('role_code', { enum: HUMAN_ROLE_CODES }).notNull(),
  publicKeySpkiB64: text('public_key_spki_b64'),
  createdAt: text('created_at').notNull(),
});

export const tenantDatabases = sqliteTable('tenant_databases', {
  companyId: text('company_id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  ice: text('ice').notNull().unique(),
  identifiantFiscal: text('identifiant_fiscal').notNull(),
  raisonSocialeFr: text('raison_sociale_fr').notNull(),
  raisonSocialeAr: text('raison_sociale_ar'),
  legalForm: text('legal_form').notNull(),
  shareCapitalCents: integer('share_capital_cents').notNull().default(0),
  vatRegime: text('vat_regime', { enum: ['ENCAISSEMENT', 'DEBIT', 'EXONERE_AE'] }).notNull(),
  vatCadence: text('vat_cadence', { enum: ['MENSUELLE', 'TRIMESTRIELLE', 'NONE'] }).notNull(),
  cryptoMode: text('crypto_mode', { enum: ['CLOUD_ASSISTED', 'ZERO_KNOWLEDGE_E2EE'] }).notNull().default('CLOUD_ASSISTED'),
  storageDriver: text('storage_driver', { enum: ['CLOUDFLARE_D1_EU', 'HYPERDRIVE_MAROC_PG'] }).notNull().default('CLOUDFLARE_D1_EU'),
  d1DatabaseUuid: text('d1_database_uuid').notNull().unique(),
  ingestEmailAlias: text('ingest_email_alias').notNull().unique(),
  schemaVersion: integer('schema_version').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const moroccoCompanyDirectory = sqliteTable('morocco_company_directory', {
  ice: text('ice').primaryKey(),
  identifiantFiscal: text('identifiant_fiscal').notNull(),
  rcNumber: text('rc_number'),
  rcTribunal: text('rc_tribunal'),
  taxePro: text('taxe_pro'),
  raisonSocialeFr: text('raison_sociale_fr').notNull(),
  raisonSocialeAr: text('raison_sociale_ar'),
  legalForm: text('legal_form'),
  shareCapitalCents: integer('share_capital_cents'),
  addressAdc450: text('address_adc450').notNull(),
  verifiedCount: integer('verified_count').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});

export const dynamicFiscalRules = sqliteTable('dynamic_fiscal_rules', {
  ruleId: text('rule_id').primaryKey(),
  cgiArticleRef: text('cgi_article_ref').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  effectiveTo: text('effective_to'),
  targetScope: text('target_scope', { enum: ['INVOICE_LINE', 'INVOICE_GLOBAL', 'JOURNAL_ENTRY', 'FEC_AUDIT'] }).notNull(),
  status: text('status', { enum: ['PENDING_ADMIN_APPROVAL', 'SHADOW_OBSERVE', 'ACTIVE', 'SUPERSEDED'] }).notNull(),
  ruleAstJson: text('rule_ast_json').notNull(),
  wikiSourceSlug: text('wiki_source_slug').notNull(),
  createdAt: text('created_at').notNull(),
});

export const simplIsCellRules = sqliteTable('simpl_is_cell_rules', {
  id: text('id').primaryKey(),
  modeleId: integer('modele_id').notNull(),
  tableauId: integer('tableau_id').notNull(),
  codeEdi: integer('code_edi').notNull(),
  evalOrder: integer('eval_order').notNull(),
  columnRole: text('column_role').notNull(),
  mappingRuleJson: text('mapping_rule_json').notNull(),
});

export const pledgedInvoicesRegistry = sqliteTable('pledged_invoices_registry', {
  id: text('id').primaryKey(),
  xhubUuid: text('xhub_uuid').notNull().unique(),
  invoiceSha256: text('invoice_sha256').notNull().unique(),
  sellerIce: text('seller_ice').notNull(),
  buyerIce: text('buyer_ice').notNull(),
  financierPartnerId: text('financier_partner_id').notNull(),
  pledgeStatus: text('pledge_status', { enum: ['LOCKED_EVALUATION', 'FINANCED_SUBROGATED', 'SETTLED', 'RELEASED'] }).notNull(),
  subrogationAipId: text('subrogation_aip_id'),
  lockedAt: text('locked_at').notNull(),
});

export const archivalMerkleBatches = sqliteTable('archival_merkle_batches', {
  batchId: text('batch_id').primaryKey(),
  batchDate: text('batch_date').notNull().unique(),
  leafCount: integer('leaf_count').notNull(),
  previousBatchRootHash: text('previous_batch_root_hash').notNull(),
  merkleRootSha256: text('merkle_root_sha256').notNull(),
  chainedRootSha256: text('chained_root_sha256').notNull(),
  tsaRfc3161TokenB64: text('tsa_rfc3161_token_b64').notNull(),
  lastLtaRenewalAt: text('last_lta_renewal_at'),
  ltaRenewalTokenB64: text('lta_renewal_token_b64'),
});

export const pricingCatalog = sqliteTable('pricing_catalog', {
  planCode: text('plan_code').primaryKey(),
  segment: text('segment', { enum: ['DIRECT_PME', 'FIDUCIAIRE', 'ENTERPRISE', 'POS_ADDON', 'MOWAKABA_PACK'] }).notNull(),
  billingCadence: text('billing_cadence', { enum: ['MONTHLY', 'ANNUAL', 'ONE_TIME'] }).notNull(),
  unitPriceHtCents: integer('unit_price_ht_cents').notNull(),
  vatRateBps: integer('vat_rate_bps').notNull().default(2000),
  includedUsers: integer('included_users').notNull().default(1),
  includedPosTerminals: integer('included_pos_terminals').notNull().default(0),
  includedSubsidiariesIce: integer('included_subsidiaries_ice').notNull().default(1),
  isActive: integer('is_active').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});

export const planEntitlements = sqliteTable(
  'plan_entitlements',
  {
    planCode: text('plan_code').notNull().references(() => pricingCatalog.planCode),
    featureKey: text('feature_key').notNull(),
    boolValue: integer('bool_value').notNull().default(0),
    numericLimit: integer('numeric_limit'),
  },
  (table) => [primaryKey({ columns: [table.planCode, table.featureKey] })],
);

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().unique().references(() => organizations.id),
  planCode: text('plan_code').notNull().references(() => pricingCatalog.planCode),
  cadence: text('cadence', { enum: ['MONTHLY', 'ANNUAL'] }).notNull(),
  status: text('status', { enum: SUBSCRIPTION_STATUSES }).notNull(),
  lockedBasePriceHtCents: integer('locked_base_price_ht_cents').notNull(),
  trialEndsAt: text('trial_ends_at'),
  currentPeriodStart: text('current_period_start').notNull(),
  currentPeriodEnd: text('current_period_end').notNull(),
  graceEndsAt: text('grace_ends_at'),
  paymentMethod: text('payment_method', { enum: ['PAYZONE_CARD', 'SIMT_WIRE'] }).notNull().default('PAYZONE_CARD'),
  payzoneCustomerToken: text('payzone_customer_token'),
  extraSeatsCount: integer('extra_seats_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const fiduciaryDossierMeters = sqliteTable('fiduciary_dossier_meters', {
  id: text('id').primaryKey(),
  cabinetOrgId: text('cabinet_org_id').notNull().references(() => organizations.id),
  clientCompanyId: text('client_company_id').notNull().unique().references(() => tenantDatabases.companyId),
  dossierTier: text('dossier_tier', { enum: DOSSIER_TIERS }).notNull(),
  pendingNextMonthTier: text('pending_next_month_tier', { enum: DOSSIER_TIERS }),
  monthlyRateHtCents: integer('monthly_rate_ht_cents').notNull(),
  activatedOnDate: text('activated_on_date').notNull(),
  minimumCommitmentUntil: text('minimum_commitment_until').notNull(),
  archivedOnDate: text('archived_on_date'),
  status: text('status', { enum: DOSSIER_METER_STATUSES }).notNull().default('ACTIVE'),
});

export const posTerminalMeters = sqliteTable('pos_terminal_meters', {
  terminalId: text('terminal_id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  companyId: text('company_id').notNull().references(() => tenantDatabases.companyId),
  deviceFingerprint: text('device_fingerprint').notNull(),
  isIncludedFree: integer('is_included_free').notNull().default(0),
  monthlyRateHtCents: integer('monthly_rate_ht_cents').notNull(),
  activatedOnDate: text('activated_on_date').notNull(),
  status: text('status', { enum: POS_TERMINAL_STATUSES }).notNull().default('ACTIVE'),
});

export const prepaidWallets = sqliteTable('prepaid_wallets', {
  organizationId: text('organization_id').primaryKey().references(() => organizations.id),
  mowakabaDossierCreditHtCents: integer('mowakaba_dossier_credit_ht_cents').notNull().default(0),
  kybScoringBalanceHtCents: integer('kyb_scoring_balance_ht_cents').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    familyId: text('family_id').notNull(),
    userId: text('user_id').notNull().references(() => users.id),
    issuedAt: text('issued_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    rotatedAt: text('rotated_at'),
    revokedAt: text('revoked_at'),
    mfaVerifiedAt: text('mfa_verified_at'),
    amr: text('amr').notNull().default('[]'),
  },
  (table) => [
    index('idx_refresh_tokens_family').on(table.familyId),
    index('idx_refresh_tokens_user_family').on(table.userId, table.familyId),
    index('idx_refresh_tokens_expires_at').on(table.expiresAt),
  ],
);

export const passkeyCredentials = sqliteTable(
  'passkey_credentials',
  {
    credentialId: text('credential_id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    publicKeyCose: text('public_key_cose').notNull(),
    algorithm: integer('algorithm').notNull(),
    signCount: integer('sign_count').notNull().default(0),
    transports: text('transports').notNull().default('[]'),
    backupEligible: integer('backup_eligible').notNull().default(0),
    backupState: integer('backup_state').notNull().default(0),
    prfEnabled: integer('prf_enabled').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_passkey_credentials_user').on(table.userId)],
);

export const passkeyChallenges = sqliteTable(
  'passkey_challenges',
  {
    challenge: text('challenge').primaryKey(),
    purpose: text('purpose', { enum: PASSKEY_PURPOSES }).notNull(),
    userId: text('user_id').references(() => users.id),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('idx_passkey_challenges_expires_at').on(table.expiresAt)],
);

export const oauthTransactions = sqliteTable(
  'oauth_transactions',
  {
    state: text('state').primaryKey(),
    nonce: text('nonce').notNull(),
    codeVerifier: text('code_verifier').notNull(),
    turnstileVerified: integer('turnstile_verified').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('idx_oauth_transactions_expires_at').on(table.expiresAt)],
);

export const pendingOauthLinks = sqliteTable(
  'pending_oauth_links',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    provider: text('provider', { enum: OAUTH_PROVIDERS }).notNull(),
    providerSubjectId: text('provider_subject_id').notNull(),
    providerEmail: text('provider_email').notNull(),
    hasPassword: integer('has_password').notNull(),
    emailProofTokenSha256: text('email_proof_token_sha256').notNull(),
    attemptsLeft: integer('attempts_left').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('idx_pending_oauth_links_expires_at').on(table.expiresAt)],
);

export const oneTimeTokens = sqliteTable(
  'one_time_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    purpose: text('purpose', { enum: ONE_TIME_TOKEN_PURPOSES }).notNull(),
    emailNormalized: text('email_normalized').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('idx_one_time_tokens_expires_at').on(table.expiresAt)],
);

export const mfaChallengeStates = sqliteTable(
  'mfa_challenge_states',
  {
    jti: text('jti').primaryKey(),
    consumedAt: text('consumed_at'),
    failureCount: integer('failure_count').notNull().default(0),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('idx_mfa_challenge_states_expires_at').on(table.expiresAt)],
);

export const processedQueueMessages = sqliteTable(
  'processed_queue_messages',
  {
    queueName: text('queue_name').notNull(),
    eventId: text('event_id').notNull(),
    eventSha256: text('event_sha256').notNull(),
    processedAt: text('processed_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.queueName, table.eventId] }),
    index('idx_processed_queue_messages_expires_at').on(table.expiresAt),
  ],
);
