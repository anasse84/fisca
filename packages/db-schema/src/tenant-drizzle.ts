/**
 * Schéma Drizzle (`drizzle-orm/sqlite-core`, compatible Cloudflare D1) de TENANT_DB, parties 1 à 3 (T-S1B-02, T-S1B-03 : caisse
 * POS, T-S1B-04 : grand livre CGNC). La vue `v_cgnc_trial_balance_6col` est déclarée ici en lecture seule.
 *
 * Le DDL de `tenant.ts` fait foi : ce fichier ne sert qu'au typage des requêtes. Un test compare tables, colonnes,
 * nullités, clés primaires, clés étrangères, contraintes UNIQUE et index à PRAGMA sur la base réelle. Les CHECK ne sont pas
 * répétés ici : ils vivent dans le DDL appliqué par les migrations, jamais généré par drizzle-kit.
 * Les tickets suivants ajoutent ici les tables de la migration v4.
 */

import { index, integer, primaryKey, sqliteTable, sqliteView, text, unique, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
  BANK_RECONCILIATION_STATES,
  CGNC_NORMAL_BALANCES,
  CGNC_VAT_REGIME_ROLES,
  DISPUTE_STATUSES,
  FISCAL_YEAR_STATUSES,
  INVOICE_DIRECTIONS,
  LEDGER_JOURNAL_TYPES,
  LEDGER_REVIEW_CYCLES,
  LEDGER_SOURCE_DOCUMENT_TYPES,
  LEDGER_STATUSES,
  PARTNER_ROLES,
  PARTNER_TAX_CATEGORIES,
  POS_B2B_CONVERSION_STATES,
  POS_SESSION_STATUSES,
  POS_TICKET_KINDS,
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

export const posSessions = sqliteTable('pos_sessions', {
  id: text('id').primaryKey(),
  terminalId: text('terminal_id').notNull(),
  cashierUserId: text('cashier_user_id').notNull(),
  openedAt: text('opened_at').notNull(),
  closedAt: text('closed_at'),
  openingFloatCents: integer('opening_float_cents').notNull(),
  expectedClosingCashCents: integer('expected_closing_cash_cents').notNull().default(0),
  blindCountedCashCents: integer('blind_counted_cash_cents'),
  cashVarianceCents: integer('cash_variance_cents'),
  status: text('status', { enum: POS_SESSION_STATUSES }).notNull(),
});

export const posTickets = sqliteTable('pos_tickets', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => posSessions.id),
  terminalId: text('terminal_id').notNull(),
  terminalSeqNumber: text('terminal_seq_number').notNull().unique(),
  issuedAt: text('issued_at').notNull(),
  ticketKind: text('ticket_kind', { enum: POS_TICKET_KINDS }).notNull(),
  originTicketId: text('origin_ticket_id').references((): AnySQLiteColumn => posTickets.id),
  ht20Cents: integer('ht_20_cents').notNull().default(0),
  vat20Cents: integer('vat_20_cents').notNull().default(0),
  ht10Cents: integer('ht_10_cents').notNull().default(0),
  vat10Cents: integer('vat_10_cents').notNull().default(0),
  ht0Cents: integer('ht_0_cents').notNull().default(0),
  stampDutyCents: integer('stamp_duty_cents').notNull().default(0),
  totalTtcCents: integer('total_ttc_cents').notNull(),
  paidCashCents: integer('paid_cash_cents').notNull().default(0),
  paidCardTpeCents: integer('paid_card_tpe_cents').notNull().default(0),
  paidDeliveryAppCents: integer('paid_delivery_app_cents').notNull().default(0),
  qrConversionToken: text('qr_conversion_token').notNull().unique(),
  b2bConversionState: text('b2b_conversion_state', { enum: POS_B2B_CONVERSION_STATES }).notNull().default('NONE'),
  convertedInvoiceId: text('converted_invoice_id').references(() => invoices.id),
  prevTicketSha256: text('prev_ticket_sha256').notNull(),
  ticketSha256: text('ticket_sha256').notNull(),
  ecdsaSignatureB64: text('ecdsa_signature_b64').notNull(),
});

export const posZClosures = sqliteTable(
  'pos_z_closures',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull().unique().references(() => posSessions.id),
    terminalId: text('terminal_id').notNull(),
    closureNumber: integer('closure_number').notNull(),
    businessDate: text('business_date').notNull(),
    netB2cHt20Cents: integer('net_b2c_ht_20_cents').notNull(),
    netB2cVat20Cents: integer('net_b2c_vat_20_cents').notNull(),
    netB2cHt10Cents: integer('net_b2c_ht_10_cents').notNull(),
    netB2cVat10Cents: integer('net_b2c_vat_10_cents').notNull(),
    netB2cHt0Cents: integer('net_b2c_ht_0_cents').notNull(),
    totalStampDutyCents: integer('total_stamp_duty_cents').notNull(),
    tpeGrossCents: integer('tpe_gross_cents').notNull(),
    glJournalEntryId: text('gl_journal_entry_id'),
    aipArchiveId: text('aip_archive_id'),
    prevZSha256: text('prev_z_sha256').notNull(),
    zSha256: text('z_sha256').notNull(),
  },
  (table) => [unique().on(table.terminalId, table.closureNumber)],
);

export const fiscalYears = sqliteTable('fiscal_years', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  status: text('status', { enum: FISCAL_YEAR_STATUSES }).notNull().default('OPEN'),
  simplIsModel: integer('simpl_is_model').notNull().default(1),
  provisionalVatProrataBps: integer('provisional_vat_prorata_bps').notNull().default(10000),
  definitiveVatProrataBps: integer('definitive_vat_prorata_bps'),
  closingHash: text('closing_hash'),
});

export const journals = sqliteTable('journals', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  journalType: text('journal_type', { enum: LEDGER_JOURNAL_TYPES }).notNull(),
  lastSequenceNumber: integer('last_sequence_number').notNull().default(0),
  lastEntryHash: text('last_entry_hash').notNull().default('GENESIS_HASH_00000000000000000000000000000000'),
});

export const cgncAccounts = sqliteTable('cgnc_accounts', {
  id: text('id').primaryKey(),
  accountNumber: text('account_number').notNull().unique(),
  labelFr: text('label_fr').notNull(),
  labelAr: text('label_ar'),
  cgncClass: integer('cgnc_class').notNull(),
  normalBalance: text('normal_balance', { enum: CGNC_NORMAL_BALANCES }).notNull(),
  isReconcilable: integer('is_reconcilable').notNull().default(0),
  vatRegimeRole: text('vat_regime_role', { enum: CGNC_VAT_REGIME_ROLES }).notNull().default('NONE'),
});

export const journalEntries = sqliteTable(
  'journal_entries',
  {
    id: text('id').primaryKey(),
    fiscalYearId: text('fiscal_year_id').notNull().references(() => fiscalYears.id),
    journalId: text('journal_id').notNull().references(() => journals.id),
    sequenceNumber: integer('sequence_number').notNull(),
    entryReference: text('entry_reference').notNull().unique(),
    entryDate: text('entry_date').notNull(),
    validatedAt: text('validated_at'),
    reviewCycle: text('review_cycle', { enum: LEDGER_REVIEW_CYCLES }).notNull().default('GENERAL'),
    status: text('status', { enum: LEDGER_STATUSES }).notNull().default('IA_PROPOSITION'),
    sourceDocumentType: text('source_document_type', { enum: LEDGER_SOURCE_DOCUMENT_TYPES }).notNull(),
    invoiceId: text('invoice_id').references(() => invoices.id),
    dgiClearanceUuid: text('dgi_clearance_uuid'),
    partnerId: text('partner_id').references(() => fiscalPartners.id),
    reversalOfEntryId: text('reversal_of_entry_id').references((): AnySQLiteColumn => journalEntries.id),
    totalDebitCents: integer('total_debit_cents').notNull(),
    totalCreditCents: integer('total_credit_cents').notNull(),
    previousEntryHash: text('previous_entry_hash'),
    entryHash: text('entry_hash'),
    piiRestrictedFlag: integer('pii_restricted_flag').notNull().default(0),
  },
  (table) => [
    unique().on(table.journalId, table.fiscalYearId, table.sequenceNumber),
    index('idx_je_fy_status_seq').on(table.fiscalYearId, table.status, table.journalId, table.sequenceNumber),
  ],
);

export const journalEntryLines = sqliteTable(
  'journal_entry_lines',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id').notNull().references(() => journalEntries.id),
    lineNumber: integer('line_number').notNull(),
    accountId: text('account_id').notNull().references(() => cgncAccounts.id),
    auxiliaryAccount: text('auxiliary_account'),
    descriptionEnc: text('description_enc').notNull(),
    debitCents: integer('debit_cents').notNull().default(0),
    creditCents: integer('credit_cents').notNull().default(0),
    isTaxDeductible: integer('is_tax_deductible').notNull().default(1),
    table3ReintegrationCode: text('table3_reintegration_code'),
    reconciliationCode: text('reconciliation_code'),
    reconciledAt: text('reconciled_at'),
    piiRestrictedFlag: integer('pii_restricted_flag').notNull().default(0),
  },
  (table) => [unique().on(table.entryId, table.lineNumber), index('idx_jel_entry_account').on(table.entryId, table.accountId)],
);

export const bankTransactions = sqliteTable('bank_transactions', {
  id: text('id').primaryKey(),
  bankCode: text('bank_code').notNull(),
  statementDate: text('statement_date').notNull(),
  valueDate: text('value_date').notNull(),
  rawLabelEnc: text('raw_label_enc').notNull(),
  referenceCode: text('reference_code'),
  amountCents: integer('amount_cents').notNull(),
  reconciliationState: text('reconciliation_state', { enum: BANK_RECONCILIATION_STATES }).notNull().default('UNMATCHED'),
  reconciliationCode: text('reconciliation_code'),
  glEntryId: text('gl_entry_id').references(() => journalEntries.id),
});

export const fixedAssetsRegister = sqliteTable('fixed_assets_register', {
  id: text('id').primaryKey(),
  acquisitionInvoiceId: text('acquisition_invoice_id').references(() => invoices.id),
  assetAccountNumber: text('asset_account_number').notNull(),
  labelEnc: text('label_enc').notNull(),
  acquisitionDate: text('acquisition_date').notNull(),
  acquisitionHtCents: integer('acquisition_ht_cents').notNull(),
  acquisitionTtcCents: integer('acquisition_ttc_cents').notNull(),
  isPassengerVehicle: integer('is_passenger_vehicle').notNull().default(0),
  fiscalDepreciableCapCents: integer('fiscal_depreciable_cap_cents'),
  initialVatDeductedCents: integer('initial_vat_deducted_cents').notNull().default(0),
  initialProrataBps: integer('initial_prorata_bps').notNull().default(10000),
  vatRetentionMonthsRequired: integer('vat_retention_months_required').notNull().default(60),
  disposalDate: text('disposal_date'),
  depreciationRateBps: integer('depreciation_rate_bps').notNull(),
});

/** Balance générale à 6 colonnes (SIMPL-IS v2.0.3), vue existante : le DDL de `tenant.ts` la crée, Drizzle ne fait que la typer. */
export const cgncTrialBalance6col = sqliteView('v_cgnc_trial_balance_6col', {
  fiscalYearId: text('fiscal_year_id').notNull(),
  accountNumber: text('account_number').notNull(),
  cgncClass: integer('cgnc_class').notNull(),
  openingDebitCents: integer('opening_debit_cents').notNull(),
  openingCreditCents: integer('opening_credit_cents').notNull(),
  mvtDebitCents: integer('mvt_debit_cents').notNull(),
  mvtCreditCents: integer('mvt_credit_cents').notNull(),
  totalDebitCents: integer('total_debit_cents').notNull(),
  totalCreditCents: integer('total_credit_cents').notNull(),
  netBalanceCents: integer('net_balance_cents').notNull(),
}).existing();
