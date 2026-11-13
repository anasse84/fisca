<!--
ID canonique : Doc_06_ERD   |   Fichier : docs/specs/06-erd-data-lifecycle.md
Source : « Document 06 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_06_ERD#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_06_ERD »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 06 — Modèle de Données (ERD) & Cycle de Vie de la Donnée
Ce document spécifie les schémas relationnels SQL, les déclencheurs d'inaltérabilité, l'indexation aveugle E2EE et la gouvernance de rétention décennale de Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Ses 10 sections nommées sont prêtes pour Hyperagent avec la portée Projet (Doc_06_ERD).
## Section 01 — Architecture de Persistance à 3 Plans & Conventions
La persistance de Fisca sépare physiquement la gouvernance globale, les comptabilités isolées par entreprise et l'état transactionnel local afin d'éliminer toute fuite inter-clients.

| Plan de Données | Moteur Physique | Portée d'Isolation | Juridiction & Miroir | Contenu Métier Principal |
|---|---|---|---|---|
| Control Plane | Cloudflare D1 | Globale mutualisée | UE + Miroir Maroc | Abonnements, annuaire ICE, règles AST |
| Tenant DB | D1 ou Postgres 16 | 1 base par société | UE ou Maroc OIV | Factures, POS, Grand Livre CGNC, paie |
| Durable Objects | SQLite DO isolé | 1 instance par société | Edge + Réplication | Séquenceur sans trou et mémoire IA |
| Coffre WORM | R2 + MinIO S3 | Clé AES par paquet AIP | UE + Miroir Maroc | XML signés, Factur-X, preuves 10 ans |
| POS Local | SQLite WASM OPFS | 1 base par tablette | Appareil physique | Catalogue, tickets hors-ligne 72h, Z |

Cinq conventions de typage s'appliquent sans exception à toutes les tables du projet :
- Clés primaires triables : Toutes les tables utilisent des identifiants TEXT au format UUIDv7 ordonnés chronologiquement pour optimiser les index B-Tree.
- Entiers monétaires stricts : Les montants sont stockés en centimes entiers (_cents), les taux en points de base (_bps), les quantités en milli-unités (_milli) et les cours BAM en micro-unités (_micro).
- Dates canoniques : Les dates comptables utilisent le texte ISO YYYY-MM-DD et les horodatages système le format UTC YYYY-MM-DDTHH:MM:SSZ.
- Portabilité SQL : Le DDL n'utilise que des types et contraintes compatibles entre SQLite (Cloudflare D1) et PostgreSQL 16 (serveur souverain Maroc).
- Chiffrement applicatif : Les colonnes contenant des données personnelles portent le suffixe _enc et sont doublées d'un index aveugle _bidx en HMAC-SHA256.
## Section 02 — Schéma SQL Maître : Plan de Contrôle (CONTROL_PLANE_DB)
En complément des tables de tarification définies au Document 03, la base maîtresse gère le routage multi-tenant, l'annuaire national ICE, les règles fiscales dynamiques, le registre anti-double mobilisation et les racines quotidiennes de Merkle :

```sql
-- ============================================================================
-- 1. ORGANISATIONS, UTILISATEURS & ROUTAGE DES BASES D1 ISOLÉES PAR SOCIÉTÉ
-- ============================================================================
CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    org_kind TEXT NOT NULL CHECK (org_kind IN ('DIRECT_BUSINESS', 'FIDUCIAIRE_OEC', 'ENTERPRISE_GROUP')),
    custom_hostname TEXT UNIQUE,         -- Marque blanche Cloudflare for SaaS (ex: compta.cabinet.ma)
    ui_locale_policy TEXT NOT NULL CHECK (ui_locale_policy IN ('SIX_LOCALES_PME', 'THREE_LOCALES_INSTITUTIONAL')),
    created_at TEXT NOT NULL
);

CREATE TABLE users (
```

    id TEXT PRIMARY KEY,
    email_normalized TEXT NOT NULL UNIQUE,
    is_email_verified INTEGER NOT NULL DEFAULT 0,
    phone_e164 TEXT UNIQUE,
    is_phone_verified INTEGER NOT NULL DEFAULT 0,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    password_hash_pbkdf2 TEXT,           -- NULL si inscription exclusivement via Google OAuth
    password_updated_at TEXT,
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,                   -- Verrouillage progressif anti-brute-force après 5 échecs
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    mfa_preferred_method TEXT NOT NULL DEFAULT 'NONE' CHECK (
        mfa_preferred_method IN ('NONE', 'TOTP_APP', 'INFOBIP_OTP', 'WEBAUTHN_PASSKEY')
    ),
    preferred_locale TEXT NOT NULL DEFAULT 'fr',
    created_at TEXT NOT NULL
);

-- Comptes externes liés (Google OAuth 2.0 / OIDC & SSO Enterprise)
CREATE TABLE user_oauth_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL CHECK (provider IN ('GOOGLE', 'ENTRA_OIDC', 'SAML_CORP')),
    provider_subject_id TEXT NOT NULL,   -- Champ 'sub' immuable de Google (jamais l'email seul)
    provider_email TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    UNIQUE(provider, provider_subject_id)
);

-- Facteurs 2FA (TOTP Google Authenticator / Authy + Codes de Secours à usage unique)
CREATE TABLE user_mfa_factors (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    totp_secret_aes_gcm TEXT,            -- Secret Base32 chiffré AES-256-GCM avec clé serveur
    totp_verified_at TEXT,
    last_used_totp_step INTEGER,         -- Bloque le rejeu d'un même code TOTP dans la fenêtre de 30s
    recovery_codes_hashes_json TEXT,     -- Tableau JSON de 10 empreintes SHA-256 salées à usage unique
    updated_at TEXT NOT NULL
);

-- Appareils de confiance 2FA (Cookie signé 30j pour éviter la friction quotidienne hors Step-Up critique)
CREATE TABLE user_trusted_devices (
    device_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    device_token_sha256 TEXT NOT NULL UNIQUE,
    user_agent_summary TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

```sql

CREATE TABLE organization_memberships (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role_code TEXT NOT NULL CHECK (role_code IN (
        'OWNER_GERANT', 'CAISSIER_POS', 'ACHATS_BUYER', 'MAGASINIER_BL',
        'DAF_TRESORIER', 'AIDE_COMPTABLE', 'CHEF_MISSION', 'EXPERT_COMPTABLE_OEC', 'AUDITEUR_CAC_DGI'
    )),
    public_key_spki_b64 TEXT,            -- Clé publique RSA-OAEP-256 pour E2EE
    created_at TEXT NOT NULL,
    UNIQUE(organization_id, user_id)
);

CREATE TABLE tenant_databases (
    company_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    ice TEXT NOT NULL UNIQUE,            -- 15 chiffres vérifiés Modulo 97
    identifiant_fiscal TEXT NOT NULL,
    raison_sociale_fr TEXT NOT NULL,
    raison_sociale_ar TEXT,
    legal_form TEXT NOT NULL,            -- SARL, SARL_AU, SA, SAS, AE, PP (Loi 5-96 / 17-95)
    share_capital_cents INTEGER NOT NULL DEFAULT 0,
    vat_regime TEXT NOT NULL CHECK (vat_regime IN ('ENCAISSEMENT', 'DEBIT', 'EXONERE_AE')),
    vat_cadence TEXT NOT NULL CHECK (vat_cadence IN ('MENSUELLE', 'TRIMESTRIELLE', 'NONE')),
    crypto_mode TEXT NOT NULL DEFAULT 'CLOUD_ASSISTED' CHECK (crypto_mode IN ('CLOUD_ASSISTED', 'ZERO_KNOWLEDGE_E2EE')),
    storage_driver TEXT NOT NULL DEFAULT 'CLOUDFLARE_D1_EU' CHECK (storage_driver IN ('CLOUDFLARE_D1_EU', 'HYPERDRIVE_MAROC_PG')),
    d1_database_uuid TEXT NOT NULL UNIQUE,
    ingest_email_alias TEXT NOT NULL UNIQUE, -- Ex: atlas-btp@ingest.fisca.ma
    schema_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

-- ============================================================================
-- 2. ANNUAIRE NATIONAL ICE & MOTEURS DÉCLARATIFS (AST CGI + LIASSE SIMPL-IS)
-- ============================================================================
CREATE TABLE morocco_company_directory (
    ice TEXT PRIMARY KEY,                -- 15 chiffres (9 entreprise + 4 établissement + 2 clé)
    identifiant_fiscal TEXT NOT NULL,
    rc_number TEXT,
    rc_tribunal TEXT,
    taxe_pro TEXT,
    raison_sociale_fr TEXT NOT NULL,
    raison_sociale_ar TEXT,
    legal_form TEXT,
    share_capital_cents INTEGER,
    address_adc450 TEXT NOT NULL,
    verified_count INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

CREATE TABLE dynamic_fiscal_rules (
    rule_id TEXT PRIMARY KEY,
    cgi_article_ref TEXT NOT NULL,
    effective_from TEXT NOT NULL,        -- YYYY-MM-DD
    effective_to TEXT,                   -- NULL si en vigueur
    target_scope TEXT NOT NULL CHECK (target_scope IN ('INVOICE_LINE', 'INVOICE_GLOBAL', 'JOURNAL_ENTRY', 'FEC_AUDIT')),
    status TEXT NOT NULL CHECK (status IN ('PENDING_ADMIN_APPROVAL', 'SHADOW_OBSERVE', 'ACTIVE', 'SUPERSEDED')),
    rule_ast_json TEXT NOT NULL,         -- Arbre logique et formule BPS validés par Zod + 3 tests Vitest
    wiki_source_slug TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE simpl_is_cell_rules (
    id TEXT PRIMARY KEY,
    modele_id INTEGER NOT NULL CHECK (modele_id BETWEEN 1 AND 4),
    tableau_id INTEGER NOT NULL,
    code_edi INTEGER NOT NULL,
    eval_order INTEGER NOT NULL CHECK (eval_order BETWEEN 1 AND 4),
    column_role TEXT NOT NULL,
    mapping_rule_json TEXT NOT NULL,     -- 5 opérateurs DSL sur v_cgnc_trial_balance_6col
    UNIQUE(modele_id, code_edi)
);

-- ============================================================================
-- 3. REGISTRE ANTI-DOUBLE MOBILISATION FACTORFLOW & ARBRE DE MERKLE QUOTIDIEN
-- ============================================================================
CREATE TABLE pledged_invoices_registry (
    id TEXT PRIMARY KEY,
    xhub_uuid TEXT NOT NULL UNIQUE,
    invoice_sha256 TEXT NOT NULL UNIQUE,
    seller_ice TEXT NOT NULL,
    buyer_ice TEXT NOT NULL,
    financier_partner_id TEXT NOT NULL,
    pledge_status TEXT NOT NULL CHECK (pledge_status IN ('LOCKED_EVALUATION', 'FINANCED_SUBROGATED', 'SETTLED', 'RELEASED')),
    subrogation_aip_id TEXT,
    locked_at TEXT NOT NULL
);

CREATE TABLE archival_merkle_batches (
    batch_id TEXT PRIMARY KEY,
    batch_date TEXT NOT NULL UNIQUE,     -- YYYY-MM-DD (1 seul jeton RFC 3161 par jour)
    leaf_count INTEGER NOT NULL CHECK (leaf_count > 0),
    previous_batch_root_hash TEXT NOT NULL,
    merkle_root_sha256 TEXT NOT NULL,
    chained_root_sha256 TEXT NOT NULL,
    tsa_rfc3161_token_b64 TEXT NOT NULL,
    last_lta_renewal_at TEXT,            -- Renouvelé tous les 24 mois en SHA-512
    lta_renewal_token_b64 TEXT
);
```

## Section 03 — Schéma Locataire (TENANT_DB Partie 1) : E2EE, Tiers & Clearance xHub
Chaque société cliente reçoit ce premier groupe de tables gérant les enveloppes cryptographiques multi-acteurs, le référentiel tiers indexé à l'aveugle, le rapprochement multi-BL et les factures UBL 2.1 :

```sql
-- ============================================================================
-- 1. ENVELOPPES DE CLÉS ZERO-TRUST E2EE & SÉQUESTRE DE SHAMIR (ART. 211 CGI)
-- ============================================================================
CREATE TABLE tenant_key_grants (
    grant_id TEXT PRIMARY KEY,
    grantee_role TEXT NOT NULL CHECK (grantee_role IN (
        'OWNER_ADMIN', 'EXTERNAL_CPA', 'ERP_CONNECTOR_AGENT', 'DGI_AUDIT_ESCROW'
    )),
    grantee_actor_id TEXT NOT NULL,
    grantee_public_key_spki_b64 TEXT NOT NULL,
    wrapped_dek_b64 TEXT NOT NULL,       -- Clé AES-256-GCM enveloppée en RSA-OAEP-256
    wrapped_bidx_key_b64 TEXT NOT NULL,  -- Clé secrète HMAC-SHA256 pour Blind Indexing
    shamir_share_index INTEGER CHECK (shamir_share_index BETWEEN 1 AND 3),
    created_at TEXT NOT NULL,
    revoked_at TEXT,                     -- Révocation instantanée d'un cabinet sans rechiffrer R2
    UNIQUE(grantee_role, grantee_actor_id)
);

-- ============================================================================
-- 2. RÉFÉRENTIEL FISCAL DES TIERS (CLIENTS, FOURNISSEURS, BAILLEURS, AE)
-- ============================================================================
CREATE TABLE fiscal_partners (
    id TEXT PRIMARY KEY,
    partner_role TEXT NOT NULL CHECK (partner_role IN ('CLIENT', 'FOURNISSEUR', 'MIXTE', 'BAILLEUR')),
    tax_category TEXT NOT NULL CHECK (tax_category IN (
        'COMPANY_IS', 'INDIVIDUAL_IR_PRO', 'AUTO_ENTREPRENEUR', 'INDIVIDUAL_B2C', 'PUBLIC_ENTITY', 'FOREIGN_NON_RESIDENT'
    )),
    dgi_public_client_type INTEGER NOT NULL DEFAULT 5 CHECK (dgi_public_client_type BETWEEN 1 AND 5),
    legal_name_enc TEXT NOT NULL,        -- Raison sociale ou Nom/Prénom (clair ou chiffré v1:iv:ct)
    legal_name_ar_enc TEXT,
    ice_enc TEXT,
    ice_bidx TEXT UNIQUE,                -- HMAC-SHA256 128 bits pour recherche exacte SQL
    if_enc TEXT,
    if_bidx TEXT,
    cin_enc TEXT,
    rc_number TEXT,
    rc_tribunal TEXT,
    cnss_number TEXT,
    taxe_pro TEXT,
    dgi_profession_code INTEGER,         -- Nomenclature DGI pour DRVT v2.0.3
    nationality_code TEXT NOT NULL DEFAULT 'MA',
    address_adc450_enc TEXT NOT NULL,
    rib_24_verified_enc TEXT,            -- RIB marocain 24 chiffres Modulo 97 de référence
    rib_24_bidx TEXT,
    tax_clearance_cert_num TEXT,
    tax_clearance_issued_date TEXT,      -- Validité légale 6 mois pour RAS-TVA 75% vs 100%
    agreed_payment_days INTEGER NOT NULL DEFAULT 60 CHECK (agreed_payment_days BETWEEN 1 AND 180),
    pcge_auxiliary_account TEXT NOT NULL, -- Ex: 34210001 ou 44110001
    created_at TEXT NOT NULL
);

-- ============================================================================
-- 3. COMMANDES, MULTI-BONS DE LIVRAISON (N-TO-1) & FACTURES UBL 2.1 / XHUB
-- ============================================================================
CREATE TABLE purchase_orders (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES fiscal_partners(id),
    po_number TEXT NOT NULL UNIQUE,
    contract_wiki_slug TEXT,             -- Référence vers contrat BPU compilé dans le LLM Wiki
    status TEXT NOT NULL CHECK (status IN ('OPEN', 'PARTIAL', 'MATCHED', 'CLOSED')),
    total_ht_cents INTEGER NOT NULL CHECK (total_ht_cents >= 0),
    lines_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE delivery_notes (
    id TEXT PRIMARY KEY,
    po_id TEXT REFERENCES purchase_orders(id),
    partner_id TEXT NOT NULL REFERENCES fiscal_partners(id),
    bl_number TEXT NOT NULL,
    delivery_date TEXT NOT NULL,         -- Point de départ légal Loi 69-21
    has_wet_stamp_verified INTEGER NOT NULL DEFAULT 0, -- Détecté par Nanonets-OCR-s
    r2_scan_key TEXT,
    lines_qty_milli_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(partner_id, bl_number)
);

CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('EMISE', 'RECUE')),
    ubl_type_code TEXT NOT NULL CHECK (ubl_type_code IN (
        '380_FACTURE', '381_AVOIR', '383_NOTE_DEBIT', '386_ACOMPTE', '389_AUTOFACTURATION'
    )),
    is_btp_progress_statement INTEGER NOT NULL DEFAULT 0,
    origin_invoice_id TEXT REFERENCES invoices(id),    -- Obligatoire sur Avoir 381 et Note débit 383
    pos_ticket_id TEXT UNIQUE,                         -- Garantit max 1 conversion Ticket POS vers B2B
    sequential_number TEXT UNIQUE,                     -- Attribué par InvoiceSequencerDO
    icv_counter INTEGER,                               -- Compteur monotone matériel
    partner_id TEXT NOT NULL REFERENCES fiscal_partners(id),
    po_id TEXT REFERENCES purchase_orders(id),
    issue_date TEXT NOT NULL,
    service_delivery_date TEXT NOT NULL,               -- Départ légal délai Loi 69-21
    legal_due_date TEXT NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'MAD',
    bam_exchange_rate_micro INTEGER NOT NULL DEFAULT 1000000,
    total_ht_cents INTEGER NOT NULL CHECK (total_ht_cents >= 0),
    total_debours_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_debours_cents >= 0),
    total_vat_cents INTEGER NOT NULL CHECK (total_vat_cents >= 0),
    ras_vat_cents INTEGER NOT NULL DEFAULT 0 CHECK (ras_vat_cents >= 0),
    ras_ir_or_is_cents INTEGER NOT NULL DEFAULT 0 CHECK (ras_ir_or_is_cents >= 0),
    stamp_duty_cents INTEGER NOT NULL DEFAULT 0 CHECK (stamp_duty_cents >= 0),
    btp_retention_cents INTEGER NOT NULL DEFAULT 0 CHECK (btp_retention_cents >= 0),
    btp_retention_released_at TEXT,                    -- Exigibilité différée TVA sur retenue BTP
    non_deductible_cash_ht_cents INTEGER NOT NULL DEFAULT 0, -- Excédent espèces Art. 11-II CGI
    non_deductible_cash_vat_cents INTEGER NOT NULL DEFAULT 0,
    total_ttc_cents INTEGER NOT NULL CHECK (
        total_ht_cents + total_debours_cents + total_vat_cents + stamp_duty_cents = total_ttc_cents
    ),
    net_payable_cents INTEGER NOT NULL,
    paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
    dgi_payment_method_id INTEGER NOT NULL CHECK (dgi_payment_method_id BETWEEN 1 AND 7),
    ubl_payment_code TEXT NOT NULL CHECK (ubl_payment_code IN (
        '10_ESPECES', '20_CHEQUE', '30_VIREMENT', '42_EFFET_LCN', '48_CARTE', '97_COMPENSATION'
    )),
    clearance_state TEXT NOT NULL DEFAULT 'BROUILLON',
    cdv_lifecycle_status TEXT NOT NULL DEFAULT 'NONE',
    xhub_uuid TEXT UNIQUE,
    xhub_qr_payload TEXT,
    three_way_match_status TEXT NOT NULL DEFAULT 'N_A' CHECK (three_way_match_status IN ('N_A', 'MATCHED', 'ECART_BLOQUE')),
    rib_check_status TEXT NOT NULL DEFAULT 'OK' CHECK (rib_check_status IN ('OK', 'ALERTE_RIB_DAF', 'DUAL_SIGNED_OK')),
    dispute_status TEXT NOT NULL DEFAULT 'NONE' CHECK (dispute_status IN ('NONE', 'CONTESTEE_DOCUMENTEE')),
    dispute_r2_proof_key TEXT,
    dedup_supplier_invoice_bidx TEXT UNIQUE,           -- HMAC(if_fournisseur || '|' || num_facture)
    previous_pi_hash TEXT,
    sha256_hash TEXT,
    aip_archive_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE invoice_delivery_links (
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    delivery_note_id TEXT NOT NULL REFERENCES delivery_notes(id),
    PRIMARY KEY (invoice_id, delivery_note_id)         -- Supporte N Bons de Livraison pour 1 Facture
);

CREATE TABLE invoice_lines (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    line_number INTEGER NOT NULL,
    is_disbursement_debours INTEGER NOT NULL DEFAULT 0, -- 1 = Débours hors champ TVA (3488/4488)
    description_fr_enc TEXT NOT NULL,
    description_ar_enc TEXT,
    quantity_milli INTEGER NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    discount_bps INTEGER NOT NULL DEFAULT 0,
    vat_rate_bps INTEGER NOT NULL CHECK (vat_rate_bps IN (2000, 1000, 0)), -- LF 2026 stricte
    vat_exemption_reason_code TEXT,
    line_ht_cents INTEGER NOT NULL,
    line_vat_cents INTEGER NOT NULL,
    pcge_account_number TEXT NOT NULL,
    UNIQUE(invoice_id, line_number)
);
```

## Section 04 — Schéma Locataire (TENANT_DB Partie 2) : Caisse Fisca POS & Ticket Z
Ces tables équipent à la fois la base SQLite WASM locale du terminal hors-ligne (pos-pwa) et la base TENANT_DB synchronisée, garantissant le chaînage SHA-256 de l'Article 145 du CGI et l'absence de double imposition lors d'une conversion de ticket B2C en facture B2B :

```sql
CREATE TABLE pos_sessions (
    id TEXT PRIMARY KEY,
    terminal_id TEXT NOT NULL,
    cashier_user_id TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    opening_float_cents INTEGER NOT NULL CHECK (opening_float_cents >= 0),
    expected_closing_cash_cents INTEGER NOT NULL DEFAULT 0,
    blind_counted_cash_cents INTEGER,
    cash_variance_cents INTEGER,         -- Imputé en 6588 (manquant) ou 7588 (excédent)
    status TEXT NOT NULL CHECK (status IN ('SESSION_OUVERTE_ACTIVE', 'COMPTAGE_AVEUGLE_PRE_Z', 'CLOTURE_TICKET_Z_SCELLEE'))
);

CREATE TABLE pos_tickets (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES pos_sessions(id),
    terminal_id TEXT NOT NULL,
    terminal_seq_number TEXT NOT NULL UNIQUE, -- Ex: POS-M01-C02-2026-000841
    issued_at TEXT NOT NULL,
    ticket_kind TEXT NOT NULL CHECK (ticket_kind IN ('SALE_B2C', 'RETURN_REFUND')),
    origin_ticket_id TEXT REFERENCES pos_tickets(id),
    ht_20_cents INTEGER NOT NULL DEFAULT 0,
    vat_20_cents INTEGER NOT NULL DEFAULT 0,
    ht_10_cents INTEGER NOT NULL DEFAULT 0,
    vat_10_cents INTEGER NOT NULL DEFAULT 0,
    ht_0_cents INTEGER NOT NULL DEFAULT 0,
    stamp_duty_cents INTEGER NOT NULL DEFAULT 0, -- 0,25% (25 bps) sur part payée en espèces
    total_ttc_cents INTEGER NOT NULL CHECK (total_ttc_cents >= 0),
    paid_cash_cents INTEGER NOT NULL DEFAULT 0,
    paid_card_tpe_cents INTEGER NOT NULL DEFAULT 0,
    paid_delivery_app_cents INTEGER NOT NULL DEFAULT 0,
    qr_conversion_token TEXT NOT NULL UNIQUE,
    b2b_conversion_state TEXT NOT NULL DEFAULT 'NONE' CHECK (
        b2b_conversion_state IN ('NONE', 'CONVERTI_B2B_AVANT_Z', 'CONVERTI_B2B_POST_Z_NEUTRALISE')
    ),
    converted_invoice_id TEXT REFERENCES invoices(id),
    prev_ticket_sha256 TEXT NOT NULL,
    ticket_sha256 TEXT NOT NULL
);

CREATE TABLE pos_z_closures (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE REFERENCES pos_sessions(id),
    terminal_id TEXT NOT NULL,
    closure_number INTEGER NOT NULL,
    business_date TEXT NOT NULL,         -- YYYY-MM-DD
    net_b2c_ht_20_cents INTEGER NOT NULL,
    net_b2c_vat_20_cents INTEGER NOT NULL,
    net_b2c_ht_10_cents INTEGER NOT NULL,
    net_b2c_vat_10_cents INTEGER NOT NULL,
    net_b2c_ht_0_cents INTEGER NOT NULL,
    total_stamp_duty_cents INTEGER NOT NULL,
    tpe_gross_cents INTEGER NOT NULL,
    gl_journal_entry_id TEXT,
    aip_archive_id TEXT,
    prev_z_sha256 TEXT NOT NULL,
    z_sha256 TEXT NOT NULL,
    UNIQUE(terminal_id, closure_number)
);
```

## Section 05 — Schéma Locataire (TENANT_DB Partie 3) : Grand Livre CGNC Immuable & Triggers PAF
Cette section implémente le Grand Livre électronique conforme aux articles 145-I et 211 du CGI, la vue de balance à 6 colonnes pour SIMPL-IS v2.0.3 et cinq déclencheurs matériels SQLite empêchant toute altération d'écriture validée ou tout solde de caisse 5161 négatif :

```sql
CREATE TABLE fiscal_years (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,           -- Ex: 'EX-2026'
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSING', 'CLOSED')),
    simpl_is_model INTEGER NOT NULL DEFAULT 1 CHECK (simpl_is_model BETWEEN 1 AND 4),
    provisional_vat_prorata_bps INTEGER NOT NULL DEFAULT 10000, -- 100% = 10000 bps (Art. 104 CGI)
    definitive_vat_prorata_bps INTEGER,
    closing_hash TEXT
);

CREATE TABLE journals (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,           -- 'AN', 'ACH', 'VTE', 'BNQ', 'CAI', 'OD'
    name TEXT NOT NULL,
    journal_type TEXT NOT NULL CHECK (journal_type IN ('OPENING', 'PURCHASE', 'SALE', 'BANK', 'CASH', 'GENERAL')),
    last_sequence_number INTEGER NOT NULL DEFAULT 0,
    last_entry_hash TEXT NOT NULL DEFAULT 'GENESIS_HASH_00000000000000000000000000000000'
);

CREATE TABLE cgnc_accounts (
    id TEXT PRIMARY KEY,
    account_number TEXT NOT NULL UNIQUE, -- 4 à 8 chiffres (ex: '51610000', '44558000', '34552000')
    label_fr TEXT NOT NULL,
    label_ar TEXT,
    cgnc_class INTEGER NOT NULL CHECK (cgnc_class BETWEEN 1 AND 8),
    normal_balance TEXT NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
    is_reconcilable INTEGER NOT NULL DEFAULT 0,
    vat_regime_role TEXT NOT NULL DEFAULT 'NONE' CHECK (vat_regime_role IN (
        'NONE', 'VAT_COLLECTED_PENDING', 'VAT_COLLECTED_DUE',
        'VAT_RECOVERABLE_PENDING', 'VAT_RECOVERABLE_CHARGES', 'VAT_RECOVERABLE_IMMOB'
    ))
);

CREATE TABLE journal_entries (
    id TEXT PRIMARY KEY,
    fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
    journal_id TEXT NOT NULL REFERENCES journals(id),
    sequence_number INTEGER NOT NULL,
    entry_reference TEXT NOT NULL UNIQUE,
    entry_date TEXT NOT NULL,
    validated_at TEXT,
    review_cycle TEXT NOT NULL DEFAULT 'GENERAL' CHECK (
        review_cycle IN ('TRESORERIE', 'ACHATS', 'VENTES', 'PAIE_SOCIAL', 'FISCAL', 'GENERAL')
    ),
    status TEXT NOT NULL DEFAULT 'IA_PROPOSITION' CHECK (
        status IN ('IA_PROPOSITION', 'DRAFT', 'REVISEE_CYCLE', 'POSTED')
    ),
    source_document_type TEXT NOT NULL CHECK (source_document_type IN (
        'INVOICE', 'CREDIT_NOTE', 'POS_Z_CLOSURE', 'B2C_TO_B2B_REVERSAL', 'PAYMENT', 'VAT_CLEARING', 'CUTOFF_OD', 'REVERSAL'
    )),
    invoice_id TEXT REFERENCES invoices(id),
    dgi_clearance_uuid TEXT,
    partner_id TEXT REFERENCES fiscal_partners(id),
    reversal_of_entry_id TEXT REFERENCES journal_entries(id),
    total_debit_cents INTEGER NOT NULL CHECK (total_debit_cents > 0),
    total_credit_cents INTEGER NOT NULL CHECK (total_credit_cents = total_debit_cents),
    previous_entry_hash TEXT,
    entry_hash TEXT,
    UNIQUE(journal_id, fiscal_year_id, sequence_number)
);

CREATE TABLE journal_entry_lines (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES journal_entries(id),
    line_number INTEGER NOT NULL,
    account_id TEXT NOT NULL REFERENCES cgnc_accounts(id),
    auxiliary_account TEXT,
    description_enc TEXT NOT NULL,
    debit_cents INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
    credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
    CHECK ((debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0)),
    is_tax_deductible INTEGER NOT NULL DEFAULT 1,
    table3_reintegration_code TEXT,      -- Alimente automatiquement le Tableau 3 SIMPL-IS
    reconciliation_code TEXT,
    reconciled_at TEXT,
    UNIQUE(entry_id, line_number)
);

CREATE TABLE bank_transactions (
    id TEXT PRIMARY KEY,
    bank_code TEXT NOT NULL,             -- ATTIJARI, BCP, BOA, CIH, SGMB, BMCI, CFG, BARID
    statement_date TEXT NOT NULL,
    value_date TEXT NOT NULL,
    raw_label_enc TEXT NOT NULL,
    reference_code TEXT,
    amount_cents INTEGER NOT NULL,       -- Positif = encaissement, Négatif = décaissement
    reconciliation_state TEXT NOT NULL DEFAULT 'UNMATCHED' CHECK (
        reconciliation_state IN ('UNMATCHED', 'SUSPENS_AMBIGU_3497_4497', 'MATCHED_PARTIAL', 'MATCHED_FULL')
    ),
    reconciliation_code TEXT,
    gl_entry_id TEXT REFERENCES journal_entries(id)
);

CREATE TABLE fixed_assets_register (
    id TEXT PRIMARY KEY,
    acquisition_invoice_id TEXT REFERENCES invoices(id),
    asset_account_number TEXT NOT NULL,  -- Classe 2 (ex: 2340 Matériel de transport)
    label_enc TEXT NOT NULL,
    acquisition_date TEXT NOT NULL,
    acquisition_ht_cents INTEGER NOT NULL,
    acquisition_ttc_cents INTEGER NOT NULL,
    is_passenger_vehicle INTEGER NOT NULL DEFAULT 0,
    fiscal_depreciable_cap_cents INTEGER, -- Plafond 40000000 centimes (400 000 MAD TTC) voitures tourisme
    initial_vat_deducted_cents INTEGER NOT NULL DEFAULT 0,
    initial_prorata_bps INTEGER NOT NULL DEFAULT 10000,
    vat_retention_months_required INTEGER NOT NULL DEFAULT 60, -- 60 mois meubles / 120 mois immeubles (Art. 102 CGI)
    disposal_date TEXT,
    depreciation_rate_bps INTEGER NOT NULL
);

-- Vue matérialisée logique : Balance CGNC à 6 colonnes pour SIMPL-IS v2.0.3
CREATE VIEW v_cgnc_trial_balance_6col AS
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
GROUP BY je.fiscal_year_id, ca.account_number, ca.cgnc_class;

-- TRIGGERS D'IMMUABILITÉ PAF (ART. 145-I & 211 CGI) ET BOUCLIER ANTI-CAISSE CRÉDITRICE (5161)
CREATE TRIGGER prevent_posted_entry_update
BEFORE UPDATE ON journal_entries
FOR EACH ROW WHEN OLD.status = 'POSTED'
BEGIN
    SELECT RAISE(ABORT, 'VIOLATION_PAF_CGI_ART_145: Écriture validée immuable. Utilisez une contre-passation.');
END;

CREATE TRIGGER prevent_posted_entry_delete
BEFORE DELETE ON journal_entries
FOR EACH ROW WHEN OLD.status = 'POSTED'
BEGIN
    SELECT RAISE(ABORT, 'VIOLATION_PAF_CGI_ART_145: Suppression interdite sur le Grand Livre.');
END;

CREATE TRIGGER prevent_posted_lines_mutation_update
BEFORE UPDATE ON journal_entry_lines
FOR EACH ROW WHEN (SELECT status FROM journal_entries WHERE id = OLD.entry_id) = 'POSTED'
BEGIN
    SELECT RAISE(ABORT, 'VIOLATION_PAF_CGI_ART_145: Modification de ligne interdite sur pièce POSTED.');
END;

CREATE TRIGGER prevent_posted_lines_mutation_delete
BEFORE DELETE ON journal_entry_lines
FOR EACH ROW WHEN (SELECT status FROM journal_entries WHERE id = OLD.entry_id) = 'POSTED'
BEGIN
    SELECT RAISE(ABORT, 'VIOLATION_PAF_CGI_ART_145: Suppression de ligne interdite sur pièce POSTED.');
END;

CREATE TRIGGER enforce_balance_and_positive_cash_on_post
BEFORE UPDATE ON journal_entries
FOR EACH ROW WHEN OLD.status != 'POSTED' AND NEW.status = 'POSTED'
BEGIN
    SELECT CASE
        WHEN (SELECT COALESCE(SUM(debit_cents), 0) FROM journal_entry_lines WHERE entry_id = NEW.id) != NEW.total_debit_cents
          OR (SELECT COALESCE(SUM(credit_cents), 0) FROM journal_entry_lines WHERE entry_id = NEW.id) != NEW.total_credit_cents
        THEN RAISE(ABORT, 'CGNC_UNBALANCED_LINES: La somme des lignes ne boucle pas avec le total de la pièce.')
        WHEN NEW.entry_hash IS NULL OR NEW.previous_entry_hash IS NULL
        THEN RAISE(ABORT, 'PAF_MISSING_HASH: Empreinte SHA-256 obligatoire pour sceller en POSTED.')
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
        THEN RAISE(ABORT, 'CGNC_NEGATIVE_CASH_5161: Décaissement refusé car il rendrait le solde de caisse 5161 créditeur.')
    END;
END;
```

## Section 06 — Schéma Locataire (TENANT_DB Partie 4) : Sous-Livres SIMPL, Paie 9421 & Coffre AIP
Ce dernier bloc SQLite alimente les téléservices EDI (SIMPL-TVA v4.0, Loi 69-21 ADC500B-23I, DRVT v2.0.3, État 9421) et verrouille la conservation de 10 ans des archives OAIS AIP :

```sql
CREATE TABLE tax_and_payment_subledger (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    invoice_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
    payment_entry_id TEXT REFERENCES journal_entries(id),
    invoice_date TEXT NOT NULL,
    delivery_date TEXT NOT NULL,
    legal_due_date TEXT NOT NULL,
    payment_date TEXT,                   -- Point de départ du délai de forclusion de 12 mois (Art. 204 bis CGI)
    time_bar_deadline_date TEXT,         -- payment_date + 12 mois
    dgi_payment_method_id INTEGER NOT NULL CHECK (dgi_payment_method_id BETWEEN 1 AND 7),
    base_ht_cents INTEGER NOT NULL,
    vat_rate_bps INTEGER NOT NULL CHECK (vat_rate_bps IN (2000, 1000, 0)),
    vat_amount_cents INTEGER NOT NULL,
    total_ttc_cents INTEGER NOT NULL CHECK (base_ht_cents + vat_amount_cents = total_ttc_cents),
    deduction_prorata_pct INTEGER NOT NULL DEFAULT 100 CHECK (deduction_prorata_pct BETWEEN 0 AND 100),
    vat_clearing_entry_id TEXT REFERENCES journal_entries(id),
    simpl_tva_declared_period TEXT,      -- Ex: '2026-M11' ou '2026-T4'
    months_of_delay_6921 INTEGER NOT NULL DEFAULT 0,
    penalty_6921_cents INTEGER NOT NULL DEFAULT 0,
    law_6921_declared_quarter TEXT
);

CREATE TABLE withholding_tax_subledger (
    id TEXT PRIMARY KEY,
    fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
    partner_id TEXT NOT NULL REFERENCES fiscal_partners(id),
    invoice_id TEXT REFERENCES invoices(id),
    direction TEXT NOT NULL CHECK (direction IN ('OUTBOUND_SUPPLIER_RAS', 'INBOUND_CUSTOMER_RAS')),
    ras_family TEXT NOT NULL CHECK (ras_family IN (
        'RAS_TVA_ART117', 'HONORAIRES_IS_IR', 'COMMISSIONS_COURTAGES', 'LOCATION_IMMOBILIERE_TSC', 'NON_RESIDENT_ART15', 'AE_OVER_80K_IR30'
    )),
    leased_property_address_enc TEXT,
    tsc_article_number TEXT,             -- Obligatoire DRVT v2.0.3 sur baux immobiliers
    invoiced_ht_cents INTEGER NOT NULL,
    paid_base_cents INTEGER NOT NULL DEFAULT 0,
    ras_rate_bps INTEGER NOT NULL,       -- Ex: 500 (5%), 1000 (10%), 1500 (15%), 3000 (30%), 7500 (75%), 10000 (100%)
    ras_amount_cents INTEGER NOT NULL DEFAULT 0,
    payment_date TEXT,
    dgi_quittance_ref TEXT,
    imputed_on_is_installment INTEGER CHECK (imputed_on_is_installment BETWEEN 1 AND 6)
);

CREATE TABLE payroll_annual_subledger (
    id TEXT PRIMARY KEY,
    calendar_year INTEGER NOT NULL,
    population_category TEXT NOT NULL CHECK (population_category IN (
        'PERMANENT', 'EXONERE_TAHFIZ_5725', 'EXONERE_5720', 'OCCASIONNEL',
        'CFC', 'STAGIAIRE', 'STOCK_OPTIONS', 'PEE_ABONDEMENT', 'DOCTORANT'
    )),
    matricule TEXT NOT NULL,
    last_name_enc TEXT NOT NULL,
    first_name_enc TEXT NOT NULL,
    cin_enc TEXT,
    cin_bidx TEXT,
    carte_sejour_enc TEXT,
    num_ppr_enc TEXT,                    -- Inséré entre numCE et numCNSS dans le XML 9421
    num_cnss_enc TEXT,
    cnss_bidx TEXT,
    family_status TEXT NOT NULL CHECK (family_status IN ('C', 'M', 'D', 'V')),
    dependents_count INTEGER NOT NULL DEFAULT 0 CHECK (dependents_count BETWEEN 0 AND 6),
    address_enc TEXT NOT NULL,
    hire_date TEXT NOT NULL,
    exit_date TEXT,
    worked_days INTEGER NOT NULL DEFAULT 360 CHECK (worked_days BETWEEN 1 AND 365),
    is_sportsman INTEGER NOT NULL DEFAULT 0,
    dgi_expense_rate_code TEXT NOT NULL,
    base_salary_cents INTEGER NOT NULL,
    gross_salary_cents INTEGER NOT NULL,
    benefits_in_kind_cents INTEGER NOT NULL DEFAULT 0,
    allowances_cents INTEGER NOT NULL DEFAULT 0,
    exempt_allowances_cents INTEGER NOT NULL DEFAULT 0,
    gross_taxable_cents INTEGER NOT NULL,
    pro_expenses_cents INTEGER NOT NULL,
    supplementary_pension_cents INTEGER NOT NULL DEFAULT 0,
    social_contributions_cents INTEGER NOT NULL,
    housing_loan_deduction_cents INTEGER NOT NULL DEFAULT 0,
    total_deductions_cents INTEGER NOT NULL,
    net_taxable_cents INTEGER NOT NULL,
    ir_withheld_cents INTEGER NOT NULL,
    UNIQUE(calendar_year, matricule)
);

CREATE TABLE payroll_exempt_elements (
    id TEXT PRIMARY KEY,
    payroll_line_id TEXT NOT NULL REFERENCES payroll_annual_subledger(id),
    dgi_nature_code TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0)
);

CREATE TABLE payroll_ir_remittances (
    id TEXT PRIMARY KEY,
    calendar_year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    payment_date TEXT NOT NULL,
    payment_method_code TEXT NOT NULL CHECK (payment_method_code IN ('ES', 'CH', 'SIR')),
    dgi_reference TEXT NOT NULL,
    quittance_number TEXT NOT NULL,
    principal_cents INTEGER NOT NULL,
    penalty_cents INTEGER NOT NULL DEFAULT 0,
    surcharges_cents INTEGER NOT NULL DEFAULT 0,
    total_paid_cents INTEGER NOT NULL CHECK (principal_cents + penalty_cents + surcharges_cents = total_paid_cents),
    gl_payment_entry_id TEXT REFERENCES journal_entries(id)
);

CREATE TABLE archival_packages (
    aip_id TEXT PRIMARY KEY,
    fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
    entry_id TEXT REFERENCES journal_entries(id),
    document_type TEXT NOT NULL CHECK (document_type IN (
        'INVOICE_UBL_XADES', 'INVOICE_PDFA3_PADES', 'POS_TICKET_Z', 'SIMPL_TVA_XML',
        'SIMPL_IS_LIASSE_XML', 'SIMPL_IR_9421_XML', 'DRVT_XML', 'LAW_69_21_XML', 'FEC_SAFT_EXPORT'
    )),
    dgi_clearance_uuid TEXT,
    document_ref TEXT NOT NULL,
    document_date TEXT NOT NULL,
    amount_ttc_cents INTEGER NOT NULL DEFAULT 0,
    r2_object_key TEXT NOT NULL UNIQUE,
    morocco_mirror_key TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    encrypted_dek_base64 TEXT NOT NULL,
    iv_base64 TEXT NOT NULL,
    merkle_batch_id TEXT,
    merkle_leaf_index INTEGER,
    merkle_proof_json TEXT,
    archived_at TEXT NOT NULL,
    retention_until TEXT NOT NULL        -- Clôture exercice + 10 ans + 1 jour (Art. 211 CGI)
);

CREATE TABLE state_transition_audit (
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
);

CREATE TABLE fec_audit_runs (
    id TEXT PRIMARY KEY,
    fiscal_year_id TEXT NOT NULL REFERENCES fiscal_years(id),
    score_on_100 INTEGER NOT NULL CHECK (score_on_100 BETWEEN 0 AND 100),
    total_anomalies INTEGER NOT NULL,
    cash_overflow_count INTEGER NOT NULL,
    missing_ice_count INTEGER NOT NULL,
    cadrage_tva_gap_cents INTEGER NOT NULL,
    negative_cash_attempts INTEGER NOT NULL,
    findings_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TRIGGER enforce_10year_worm_retention_delete
BEFORE DELETE ON archival_packages
FOR EACH ROW WHEN datetime('now') < datetime(OLD.retention_until)
BEGIN
    SELECT RAISE(ABORT, 'VIOLATION_SAE_CGI_ART_211: Destruction interdite avant expiration des 10 ans.');
END;

CREATE TRIGGER enforce_10year_worm_retention_update
BEFORE UPDATE ON archival_packages
FOR EACH ROW WHEN OLD.merkle_batch_id IS NOT NULL AND NEW.payload_sha256 != OLD.payload_sha256
BEGIN
    SELECT RAISE(ABORT, 'VIOLATION_SAE_ISO_14641: Altération interdite sur une unité d archive scellée.');
END;
```

## Section 07 — Schéma SQLite des Durable Objects (Séquenceur & Mémoire Hindsight)
Chaque entreprise possède deux instances SQLite dédiées dans Cloudflare Durable Objects pour sérialiser ses numéros fiscaux et isoler l'apprentissage de ses agents IA :

```sql
-- 1. Instance InvoiceSequencerDO (Numérotation continue sans trou Art. 145 CGI & Chaînage PIH)
CREATE TABLE fiscal_sequences (
    series_key TEXT PRIMARY KEY,         -- Ex: 'FAC-2026', 'AVO-2026', 'NDB-2026'
    submission_attempt_counter INTEGER NOT NULL DEFAULT 0,
    last_cleared_number INTEGER NOT NULL DEFAULT 0,
    last_cleared_pi_hash TEXT NOT NULL DEFAULT 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    updated_at TEXT NOT NULL
);

-- 2. Instance AgentHindsightMemoryDO (Mémoire auto-apprenante à 3 niveaux par société)
CREATE TABLE world_facts (
    fact_key TEXT PRIMARY KEY,           -- Faits stables sur l'activité et les habitudes bancaires du dossier
    fact_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE experiences (
    id TEXT PRIMARY KEY,                 -- Historique des propositions d'imputation et de lettrage
    supplier_ice_bidx TEXT,
    raw_label_hash TEXT NOT NULL,
    proposed_pcge_account TEXT NOT NULL,
    human_final_pcge_account TEXT,
    was_accepted_as_is INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE evolving_opinions (
    pattern_key TEXT PRIMARY KEY,        -- Règle apprise via reflectOnHumanCorrection
    preferred_pcge_account TEXT NOT NULL,
    confidence_bps INTEGER NOT NULL CHECK (confidence_bps BETWEEN 0 AND 10000),
    occurrences_count INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);
```

## Section 08 — Stratégie d'Indexation, Blind Indexes & Performance
Pour garantir un temps de réponse inférieur à 15 ms sur des Grands Livres dépassant 200 000 lignes tout en supportant le mode Zero-Knowledge E2EE, chaque base TENANT_DB déploie huit index critiques :
- Recherche aveugle E2EE (idx_partners_ice_bidx, idx_invoices_dedup_bidx) : Les valeurs normalisées passent par HMAC-SHA256 avec la clé secrète du dossier et sont tronquées à 32 caractères hexadécimaux (128 bits), permettant un SELECT exact et la détection de doublons SIMPL-TVA sans déchiffrer la table.
- Extraction FEC-MA et Balance (idx_je_fy_status_seq, idx_jel_entry_account) : Index couvrant (fiscal_year_id, status, journal_id, sequence_number) évitant tout tri mémoire lors de la génération du fichier FEC-MA à 24 colonnes.
- Calcul du seuil 80 000 MAD Auto-Entrepreneur (idx_inv_partner_date_dir) : Index (partner_id, direction, issue_date) calculant instantanément le cumul annuel facturé par un prestataire Auto-Entrepreneur pour déclencher l'alerte à 70 000 MAD et la RAS IR de 30 % au-delà de 80 000 MAD.
- Surveillance Loi 69-21 et Forclusion TVA (idx_subledger_due_unpaid, idx_subledger_timebar) : Index filtrés sur les factures non soldées et sur time_bar_deadline_date pour les Crons quotidiens.
## Section 09 — Cycle de Vie de la Donnée, Rétention 10 Ans & Droit à l'Oubli
Le cycle de vie articule l'obligation fiscale impérative de conservation décennale (Article 211 du CGI et Article 22 de la Loi 9-88) avec le principe de minimisation de la Loi 09-08 (CNDP) :

| Catégorie de Donnée | Stockage Chaud (Hot) | Stockage Froid WORM (Cold) | Durée Légale Minimale | Politique de Suppression |
|---|---|---|---|---|
| Écritures POSTED & Factures | D1 / Postgres actif | Paquet AIP R2 UE + Maroc | Clôture + 10 ans + 1j | Interdite ; contre-passation seule |
| Tickets POS & Clôtures Z | OPFS 72h puis D1 | Paquet AIP R2 UE + Maroc | Clôture + 10 ans + 1j | Interdite ; retour par avoir lié |
| Paie 9421 & DRVT Tiers | Colonnes _enc D1 | XML chiffré R2 WORM | Clôture + 10 ans + 1j | Primauté fiscale Art. 211 sur 10 ans |
| Brouillons non numérotés | D1 (BROUILLON) | Aucun scellement WORM | Jusqu'à validation | Suppression physique autorisée |
| OTP, Sessions & Sandbox | KV / D1 temporaire | Aucun archivage | 10 min à 30 jours | Purge physique automatique (TTL) |

- Résolution du conflit Loi 09-08 CNDP contre Article 211 CGI : Si un ancien salarié ou fournisseur personne physique exerce son droit de suppression, Fisca purge immédiatement ses données de communication non fiscales mais maintient sous chiffrement restreint les enregistrements comptables, État 9421 et DRVT jusqu'au terme des 10 ans exigés par le CGI.
- Destruction cryptographique à l'échéance décennale : Une fois la date retention_until dépassée et en l'absence de litige fiscal ouvert, la destruction définitive s'opère par purge de l'objet R2/MinIO et effacement irréversible de sa clé d'enveloppe (Crypto-Shredding).
- Export de réversibilité en 1 clic : À tout moment — y compris en période d'impayé lecture seule ou de résiliation — le client télécharge une archive standardisée ISO 14641 regroupant sa base SQLite complète, tous ses XML UBL/SIMPL, ses PDF Factur-X, ses preuves de Merkle et son FEC-MA.
## Section 10 — Orchestrateur de Migrations Multi-Tenant (Rolling Schema Migrator)
Comme chaque société possède sa propre base D1, cet orchestrateur TypeScript (packages/db-schema/src/migrator.ts) applique les migrations SQL de façon idempotente et vérifie leur empreinte avant toute requête métier :

```sql
export interface MigrationDefinition {
  readonly version: number;
  readonly name: string;
  readonly upSqlStatements: readonly string[];
  readonly expectedSha256Hex: string;
}

export async function ensureTenantSchemaUpToDate(
  controlDb: D1Database,
  tenantDb: D1Database,
  companyId: string,
  migrations: readonly MigrationDefinition[]
): Promise<{ readonly currentVersion: number; readonly appliedCount: number }> {
  await tenantDb
    .prepare(
      `CREATE TABLE IF NOT EXISTS _fisca_schema_migrations (
         version INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         checksum_sha256 TEXT NOT NULL,
         applied_at TEXT NOT NULL
       )`
    )
    .run();

  const latestRow = await tenantDb
    .prepare(`SELECT COALESCE(MAX(version), 0) AS max_ver FROM _fisca_schema_migrations`)
    .first<{ max_ver: number }>();

  let currentVersion = latestRow?.max_ver ?? 0;
  let appliedCount = 0;

  const pending = [...migrations]
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    const joinedSql = migration.upSqlStatements.join("\n");
    const digestBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(joinedSql));
    const computedHex = Array.from(new Uint8Array(digestBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (computedHex !== migration.expectedSha256Hex) {
      throw new Error(
        `SCHEMA_CHECKSUM_MISMATCH: Migration v${migration.version} (${migration.name}) altérée.`
      );
    }

    const batch = [
      ...migration.upSqlStatements.map((sql) => tenantDb.prepare(sql)),
      tenantDb
        .prepare(
          `INSERT INTO _fisca_schema_migrations (version, name, checksum_sha256, applied_at)
           VALUES (?1, ?2, ?3, ?4)`
        )
        .bind(migration.version, migration.name, computedHex, new Date().toISOString()),
    ];

    await tenantDb.batch(batch);
    currentVersion = migration.version;
    appliedCount += 1;
  }

  if (appliedCount > 0) {
    await controlDb
      .prepare(`UPDATE tenant_databases SET schema_version = ?1 WHERE company_id = ?2`)
      .bind(currentVersion, companyId)
      .run();
  }

  return { currentVersion, appliedCount };
}
```
