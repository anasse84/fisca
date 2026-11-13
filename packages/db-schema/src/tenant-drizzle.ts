/**
 * Schéma Drizzle (`drizzle-orm/sqlite-core`, compatible Cloudflare D1) de TENANT_DB, Partie 1 (T-S1B-02).
 *
 * Le DDL de `tenant.ts` fait foi : ce fichier ne sert qu'au typage des requêtes. Un test compare tables, colonnes,
 * nullités, clés primaires, clés étrangères, contraintes UNIQUE et index à PRAGMA sur la base réelle. Les CHECK ne sont pas
 * répétés ici : ils vivent dans le DDL appliqué par les migrations, jamais généré par drizzle-kit.
 * Les tickets suivants ajoutent ici les tables des migrations v2, v3 et v4.
 */

import { index, integer, primaryKey, sqliteTable, text, unique, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
  DISPUTE_STATUSES,
  INVOICE_DIRECTIONS,
  PARTNER_ROLES,
  PARTNER_TAX_CATEGORIES,
  PURCHASE_ORDER_STATUSES,
  RIB_CHECK_STATUSES,
  TENANT_GRANTEE_ROLES,
  THREE_WAY_MATCH_STATUSES,
  UBL_PAYMENT_CODES,
  UBL_TYPE_CODES,
} from './tenant.ts';

export const tenantKeyGrants = sqliteTable(
  'tenant_key_grants',
  {
    grantId: text('grant_id').primaryKey(),
    granteeRole: text('grantee_role', { enum: TENANT_GRANTEE_ROLES }).notNull(),
    granteeActorId: text('grantee_actor_id').notNull(),
    granteePublicKeySpkiB64: text('grantee_public_key_spki_b64').notNull(),
    granteePublicKeyFingerprintHex: text('grantee_public_key_fingerprint_hex').notNull(),
    dekVersion: integer('dek_version').notNull(),
    wrappedDekB64: text('wrapped_dek_b64').notNull(),
    wrappedBidxKeyB64: text('wrapped_bidx_key_b64').notNull(),
    shamirShareIndex: integer('shamir_share_index'),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (table) => [unique().on(table.granteeRole, table.granteeActorId, table.dekVersion)],
);

export const fiscalPartners = sqliteTable(
  'fiscal_partners',
  {
    id: text('id').primaryKey(),
    partnerRole: text('partner_role', { enum: PARTNER_ROLES }).notNull(),
    taxCategory: text('tax_category', { enum: PARTNER_TAX_CATEGORIES }).notNull(),
    dgiPublicClientType: integer('dgi_public_client_type').notNull().default(5),
    legalNameEnc: text('legal_name_enc').notNull(),
    legalNameArEnc: text('legal_name_ar_enc'),
    iceEnc: text('ice_enc'),
    iceBidx: text('ice_bidx').unique(),
    ifEnc: text('if_enc'),
    ifBidx: text('if_bidx'),
    cinEnc: text('cin_enc'),
    cinBidx: text('cin_bidx'),
    rcNumber: text('rc_number'),
    rcTribunal: text('rc_tribunal'),
    cnssNumber: text('cnss_number'),
    taxeProfessionnelle: text('taxe_pro'),
    dgiProfessionCode: integer('dgi_profession_code'),
    nationalityCode: text('nationality_code').notNull().default('MA'),
    addressAdc450Enc: text('address_adc450_enc').notNull(),
    rib24VerifiedEnc: text('rib_24_verified_enc'),
    rib24Bidx: text('rib_24_bidx'),
    taxClearanceCertNum: text('tax_clearance_cert_num'),
    taxClearanceIssuedDate: text('tax_clearance_issued_date'),
    agreedPaymentDays: integer('agreed_payment_days').notNull().default(60),
    pcgeAuxiliaryAccount: text('pcge_auxiliary_account').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_partners_ice_bidx').on(table.iceBidx)],
);

export const purchaseOrders = sqliteTable('purchase_orders', {
  id: text('id').primaryKey(),
  partnerId: text('partner_id').notNull().references(() => fiscalPartners.id),
  poNumber: text('po_number').notNull().unique(),
  contractWikiSlug: text('contract_wiki_slug'),
  status: text('status', { enum: PURCHASE_ORDER_STATUSES }).notNull(),
  totalHtCents: integer('total_ht_cents').notNull(),
  linesJson: text('lines_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const deliveryNotes = sqliteTable(
  'delivery_notes',
  {
    id: text('id').primaryKey(),
    poId: text('po_id').references(() => purchaseOrders.id),
    partnerId: text('partner_id').notNull().references(() => fiscalPartners.id),
    blNumber: text('bl_number').notNull(),
    deliveryDate: text('delivery_date').notNull(),
    hasWetStampVerified: integer('has_wet_stamp_verified').notNull().default(0),
    r2ScanKey: text('r2_scan_key'),
    linesQtyMilliJson: text('lines_qty_milli_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique().on(table.partnerId, table.blNumber)],
);

export const invoices = sqliteTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    direction: text('direction', { enum: INVOICE_DIRECTIONS }).notNull(),
    ublTypeCode: text('ubl_type_code', { enum: UBL_TYPE_CODES }).notNull(),
    isBtpProgressStatement: integer('is_btp_progress_statement').notNull().default(0),
    originInvoiceId: text('origin_invoice_id').references((): AnySQLiteColumn => invoices.id),
    posTicketId: text('pos_ticket_id').unique(),
    sequentialNumber: text('sequential_number').unique(),
    icvCounter: integer('icv_counter'),
    partnerId: text('partner_id').notNull().references(() => fiscalPartners.id),
    poId: text('po_id').references(() => purchaseOrders.id),
    issueDate: text('issue_date').notNull(),
    serviceDeliveryDate: text('service_delivery_date').notNull(),
    legalDueDate: text('legal_due_date').notNull(),
    currencyCode: text('currency_code').notNull().default('MAD'),
    bamExchangeRateMicro: integer('bam_exchange_rate_micro').notNull().default(1000000),
    totalHtCents: integer('total_ht_cents').notNull(),
    totalDeboursCents: integer('total_debours_cents').notNull().default(0),
    totalVatCents: integer('total_vat_cents').notNull(),
    rasVatCents: integer('ras_vat_cents').notNull().default(0),
    rasIrOrIsCents: integer('ras_ir_or_is_cents').notNull().default(0),
    stampDutyCents: integer('stamp_duty_cents').notNull().default(0),
    btpRetentionCents: integer('btp_retention_cents').notNull().default(0),
    btpRetentionReleasedAt: text('btp_retention_released_at'),
    nonDeductibleCashHtCents: integer('non_deductible_cash_ht_cents').notNull().default(0),
    nonDeductibleCashVatCents: integer('non_deductible_cash_vat_cents').notNull().default(0),
    totalTtcCents: integer('total_ttc_cents').notNull(),
    netPayableCents: integer('net_payable_cents').notNull(),
    paidCents: integer('paid_cents').notNull().default(0),
    dgiPaymentMethodId: integer('dgi_payment_method_id').notNull(),
    ublPaymentCode: text('ubl_payment_code', { enum: UBL_PAYMENT_CODES }).notNull(),
    clearanceState: text('clearance_state').notNull().default('BROUILLON'),
    cdvLifecycleStatus: text('cdv_lifecycle_status').notNull().default('NONE'),
    xhubUuid: text('xhub_uuid').unique(),
    xhubQrPayload: text('xhub_qr_payload'),
    threeWayMatchStatus: text('three_way_match_status', { enum: THREE_WAY_MATCH_STATUSES }).notNull().default('N_A'),
    ribCheckStatus: text('rib_check_status', { enum: RIB_CHECK_STATUSES }).notNull().default('OK'),
    disputeStatus: text('dispute_status', { enum: DISPUTE_STATUSES }).notNull().default('NONE'),
    disputeR2ProofKey: text('dispute_r2_proof_key'),
    dedupSupplierInvoiceBidx: text('dedup_supplier_invoice_bidx').unique(),
    previousPiHash: text('previous_pi_hash'),
    sha256Hash: text('sha256_hash'),
    aipArchiveId: text('aip_archive_id'),
    piiRestrictedFlag: integer('pii_restricted_flag').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_invoices_dedup_bidx').on(table.dedupSupplierInvoiceBidx),
    index('idx_inv_partner_date_dir').on(table.partnerId, table.direction, table.issueDate),
  ],
);

export const invoiceDeliveryLinks = sqliteTable(
  'invoice_delivery_links',
  {
    invoiceId: text('invoice_id').notNull().references(() => invoices.id),
    deliveryNoteId: text('delivery_note_id').notNull().references(() => deliveryNotes.id),
  },
  (table) => [primaryKey({ columns: [table.invoiceId, table.deliveryNoteId] })],
);

export const invoiceLines = sqliteTable(
  'invoice_lines',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id').notNull().references(() => invoices.id),
    lineNumber: integer('line_number').notNull(),
    isDisbursementDebours: integer('is_disbursement_debours').notNull().default(0),
    descriptionFrEnc: text('description_fr_enc').notNull(),
    descriptionArEnc: text('description_ar_enc'),
    quantityMilli: integer('quantity_milli').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    discountBps: integer('discount_bps').notNull().default(0),
    vatRateBps: integer('vat_rate_bps').notNull(),
    vatExemptionReasonCode: text('vat_exemption_reason_code'),
    lineHtCents: integer('line_ht_cents').notNull(),
    lineVatCents: integer('line_vat_cents').notNull(),
    pcgeAccountNumber: text('pcge_account_number').notNull(),
  },
  (table) => [unique().on(table.invoiceId, table.lineNumber)],
);
