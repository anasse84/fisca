/**
 * ImmutableCgncLedgerEngine : moteur du grand livre CGNC immuable (ticket T-S1B-10).
 *
 * Sources : Doc_02 § 04 (FSM 03, visa en 3 niveaux), § 05 (VAT_CLEARING, effets LCN), § 11 (moteur de transitions) ;
 * Doc_06 § 05 (tables et triggers) ; Doc_09 § 06B et § 09 (hiérarchie OEC) ; ERRATA D-03, D-09, D-11.
 *
 * - Chaque action est autorisée par `evaluateAccessPolicy` (rôle, portefeuille, Step-Up 300 s, exercice clos).
 * - Chaque transition passe par `applyTransition` (shared-types) puis s'écrit en UN lot atomique
 *   (`TenantSqlDriver.executeBatchAtomically`) : UPDATE sous état attendu, effets liés, INSERT dans `state_transition_audit`.
 *   Le dernier ordre du lot est un INSERT dont la colonne NOT NULL `from_state` vaut NULL si la transition n'a pas eu lieu
 *   (ou a déjà eu lieu) : le lot entier est alors annulé, ce qui rend la concurrence sûre sur SQLite comme sur PostgreSQL.
 * - Horloge, UUIDv7, chiffrement des champs, empreintes et contrôles de pré-clôture sont INJECTÉS.
 * - Les triggers du socle restent la dernière ligne de défense ; le moteur vérifie d'abord et lève des erreurs typées.
 *
 * Points non fixés par les spécifications, laissés en paramètres explicites et NON devinés :
 * 1. octets hachés pour `entry_hash` et `closing_hash` (`LedgerHasher`) ; Doc_02 et Doc_06 fixent seulement le chaînage par
 *    journal depuis GENESIS_HASH et le format SHA-256 hexadécimal ;
 * 2. `source_document_type` d'une écriture d'à-nouveaux : depuis la migration tenant v9, OPENING_BALANCE la désigne et c'est la
 *    valeur par défaut de `generateOpeningJournal` (le paramètre reste admis pour une reprise explicite, hors REVERSAL).
 */
import {
  JOURNAL_ENTRY_FSM,
  FsmTransitionError,
  applyTransition,
  buildReversalEntryDraft,
  defineFsm,
  ensureSafeInteger,
  type ActorKind,
  type FsmDefinition,
  type FsmEntityState,
  type FsmEntityTable,
  type JournalEntryState,
  type SqlParam,
  type SqlStatementParams,
  type TenantSqlDriver,
} from '@fisca/shared-types';
import {
  evaluateAccessPolicy,
  type AuthorizationContext,
  type OrgPlanSegment,
  type PermissionAction,
  type RoleCode,
} from '@fisca/auth-rbac';
import {
  LEDGER_REVIEW_CYCLES,
  LEDGER_SOURCE_DOCUMENT_TYPES,
} from '@fisca/db-schema';
import {
  assertBalancedLines,
  computeOpeningBalanceLines,
  computeVatClearingMovements,
  invertLines,
  type EntrySide,
  type VatPendingLine,
  type VatPendingRole,
} from './ledger-calculations.ts';
import { LedgerError, mapDatabaseError } from './ledger-errors.ts';

export { LedgerError, mapDatabaseError, LEDGER_ERROR_CODES, type LedgerErrorCode } from './ledger-errors.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Contrats publics
// ---------------------------------------------------------------------------------------------------------------------

/** Statuts persistés d'une pièce. `CONTRE_PASSEE` n'existe pas (ERRATA D-03). */
export const LEDGER_ENTRY_STATES: readonly JournalEntryState[] = ['IA_PROPOSITION', 'DRAFT', 'REVISEE_CYCLE', 'POSTED'];

export type FiscalYearState = 'OPEN' | 'CLOSING' | 'CLOSED';

/** Doc_02 § 04 : OPEN → CLOSING (chef de mission), CLOSING → CLOSED (expert-comptable). */
export const FISCAL_YEAR_FSM: FsmDefinition<FiscalYearState> = defineFsm<FiscalYearState>({
  name: 'fiscal_year',
  states: ['OPEN', 'CLOSING', 'CLOSED'],
  initialStates: ['OPEN'],
  terminalStates: ['CLOSED'],
  rules: [
    { from: ['OPEN'], to: 'CLOSING', allowedActors: ['HUMAN_USER'] },
    { from: ['CLOSING'], to: 'CLOSED', allowedActors: ['HUMAN_USER'] },
  ],
});

export type LedgerSourceDocumentType = (typeof LEDGER_SOURCE_DOCUMENT_TYPES)[number];
export type LedgerReviewCycle = (typeof LEDGER_REVIEW_CYCLES)[number];
export type UblPaymentCode = '10_ESPECES' | '20_CHEQUE' | '30_VIREMENT' | '42_EFFET_LCN' | '48_CARTE' | '97_COMPENSATION';
const UBL_PAYMENT_CODES: readonly UblPaymentCode[] = ['10_ESPECES', '20_CHEQUE', '30_VIREMENT', '42_EFFET_LCN', '48_CARTE', '97_COMPENSATION'];
/** Code UBL d'un règlement par effet de commerce (LCN) : Doc_06 § 03, Doc_02 § 05. */
const LCN_PAYMENT_CODE: UblPaymentCode = '42_EFFET_LCN';

export interface LedgerClock {
  /** Instant courant, ISO 8601 UTC (`2026-11-13T10:00:00.000Z`). */
  nowIso(): string;
}

export interface LedgerIdSource {
  /** Un UUIDv7 neuf à chaque appel. */
  newId(): string;
}

export interface LedgerFieldCipher {
  /** Chiffre un champ `_enc` ; `aad` vaut `companyId|tableName|recordId|columnName` (loi 5). */
  encryptField(plaintext: string, aad: string): Promise<string>;
}

export interface EntryHashLine {
  readonly lineNumber: number;
  readonly lineId: string;
  readonly accountNumber: string;
  readonly auxiliaryAccount: string | null;
  readonly debitCents: number;
  readonly creditCents: number;
  readonly descriptionEnc: string;
  readonly isTaxDeductible: boolean;
  readonly table3ReintegrationCode: string | null;
}

/** Tout ce que la pièce scellée contient d'immuable ; le `LedgerHasher` choisit les octets hachés. */
export interface EntryHashInput {
  readonly companyId: string;
  readonly journalId: string;
  readonly journalCode: string;
  readonly fiscalYearId: string;
  readonly entryId: string;
  readonly sequenceNumber: number;
  readonly entryReference: string;
  readonly entryDate: string;
  readonly sourceDocumentType: string;
  readonly reversalOfEntryId: string | null;
  readonly invoiceId: string | null;
  readonly partnerId: string | null;
  readonly dgiClearanceUuid: string | null;
  readonly totalDebitCents: number;
  readonly totalCreditCents: number;
  readonly validatedAt: string;
  /** `journals.last_entry_hash` avant le scellement (GENESIS_HASH pour la première pièce du journal). */
  readonly previousEntryHash: string;
  /** Rang de la pièce dans la chaîne du journal (1 pour la première). */
  readonly chainPosition: number;
  readonly lines: readonly EntryHashLine[];
}

export interface ClosingHashInput {
  readonly companyId: string;
  readonly fiscalYearId: string;
  readonly fiscalYearCode: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly postedEntryCount: number;
  readonly closedAtIso: string;
  readonly journalHeads: readonly { readonly journalId: string; readonly journalCode: string; readonly lastEntryHash: string; readonly chainLength: number }[];
}

/** Formule d'empreinte injectée : SHA-256 hexadécimal minuscule de 64 caractères attendu. */
export interface LedgerHasher {
  computeEntryHash(input: EntryHashInput): Promise<string>;
  computeClosingHash(input: ClosingHashInput): Promise<string>;
}

/** Contrôles de pré-clôture hors périmètre du moteur (Doc_02 § 04 : 50 contrôles FEC ; Doc_14 § 04 : cadrage de TVA). */
export interface PreCloseControls {
  run(fiscalYearId: string): Promise<{ readonly passed: boolean; readonly detail: string }>;
}

export interface LedgerEngineDeps {
  readonly db: TenantSqlDriver;
  readonly companyId: string;
  readonly clock: LedgerClock;
  readonly ids: LedgerIdSource;
  readonly hasher: LedgerHasher;
  readonly cipher: LedgerFieldCipher;
  readonly preCloseControls: PreCloseControls;
}

/** Identité authentifiée de l'acteur, telle que résolue côté serveur (D-16). L'exercice clos et l'horloge viennent du moteur. */
export interface LedgerActor {
  readonly actorId: string;
  readonly role: RoleCode;
  readonly assignedCompanyIds: readonly string[];
  readonly orgPlanSegment: OrgPlanSegment;
  readonly activeHumanMembersCount: number;
  readonly subscriptionReadOnly: boolean;
  readonly canAccessPayrollPii: boolean;
  readonly mfaVerifiedAtEpochSec?: number | undefined;
}

export interface DraftLineInput {
  readonly accountNumber: string;
  readonly debitCents: number;
  readonly creditCents: number;
  /** Texte en clair : chiffré par `LedgerFieldCipher` avec l'AAD de la ligne. */
  readonly description: string;
  readonly auxiliaryAccount?: string | null;
  readonly isTaxDeductible?: boolean;
  readonly table3ReintegrationCode?: string | null;
  /** Code de lettrage posé sur la ligne à l'écriture (reprise idempotente du lettrage bancaire) ; NULL par défaut. */
  readonly reconciliationCode?: string | null;
}

export interface CreateDraftInput {
  readonly journalId: string;
  readonly fiscalYearId: string;
  readonly entryDate: string;
  readonly reviewCycle: LedgerReviewCycle;
  /** `REVERSAL` et `VAT_CLEARING` passent par leurs méthodes dédiées. */
  readonly sourceDocumentType: LedgerSourceDocumentType;
  /** Choix explicite : une proposition IA attend le visa de l'aide-comptable, un brouillon humain est déjà soumis. */
  readonly initialState: 'IA_PROPOSITION' | 'DRAFT';
  readonly lines: readonly DraftLineInput[];
  readonly invoiceId?: string | null;
  readonly partnerId?: string | null;
  readonly dgiClearanceUuid?: string | null;
}

export interface DraftCreated {
  readonly entryId: string;
  readonly entryReference: string;
  readonly sequenceNumber: number;
  readonly status: 'IA_PROPOSITION' | 'DRAFT';
}

export interface EntryTransitionInput {
  readonly entryId: string;
  readonly idempotencyKey: string;
}

export interface EntryTransitionResult {
  readonly entryId: string;
  readonly fromState: JournalEntryState;
  readonly toState: JournalEntryState;
  /** `true` : la clé avait déjà été appliquée, rien n'a été réécrit. */
  readonly replayed: boolean;
  readonly entryHash?: string;
  readonly previousEntryHash?: string;
}

export interface CreateReversalDraftInput {
  readonly originalEntryId: string;
  readonly entryDate: string;
  readonly reasonText: string;
  /** Par défaut : l'exercice et le journal de l'originale (ouvre un autre exercice si l'originale est dans un exercice clos). */
  readonly fiscalYearId?: string;
  readonly journalId?: string;
}

/** Brouillon de contre-passation ; `replayed` : la contre-passation de cette pièce existait déjà, rendue sans second brouillon. */
export interface ReversalDraftCreated extends DraftCreated {
  readonly replayed: boolean;
}

export interface CreateVatClearingDraftInput {
  readonly invoiceEntryId: string;
  readonly journalId: string;
  readonly fiscalYearId: string;
  readonly entryDate: string;
  readonly settledBeforeCents: number;
  readonly settledNowCents: number;
  readonly paymentMethodCode: UblPaymentCode;
  /** Effet LCN : date d'encaissement bancaire effectif ; absente, la TVA reste en attente (Doc_02 § 05, Doc_14 § 04). */
  readonly lcnBankCollectionDate?: string | null;
  /** Obligatoire pour la TVA récupérable d'un achat : compte de charges ou d'immobilisations. */
  readonly recoverableTarget?: 'VAT_RECOVERABLE_CHARGES' | 'VAT_RECOVERABLE_IMMOB';
  /** Code de lettrage bancaire posé sur chaque ligne du brouillon : clé de reprise de `reconcileBankTransaction`. */
  readonly reconciliationCode?: string;
}

export interface VatClearingDraftCreated extends DraftCreated {
  readonly clearedCents: number;
}

export interface FiscalYearTransitionInput {
  readonly fiscalYearId: string;
  readonly idempotencyKey: string;
}

export interface FiscalYearTransitionResult {
  readonly fiscalYearId: string;
  readonly fromState: FiscalYearState;
  readonly toState: FiscalYearState;
  readonly replayed: boolean;
  readonly closingHash?: string;
}

export interface GenerateOpeningJournalInput {
  readonly closedFiscalYearId: string;
  readonly nextFiscalYear: { readonly id: string; readonly code: string; readonly startDate: string; readonly endDate: string };
  /** Journal de type OPENING (AN). */
  readonly journalId: string;
  readonly entryDate: string;
  /** Type source de l'à-nouveau ; OPENING_BALANCE par défaut (CHECK étendu par la migration tenant v9), REVERSAL refusé. */
  readonly sourceDocumentType?: LedgerSourceDocumentType;
}

export interface OpeningJournalGenerated {
  readonly fiscalYearId: string;
  readonly entryId: string;
  readonly entryReference: string;
  readonly totalDebitCents: number;
  readonly lineCount: number;
}

export type JournalChainVerdict =
  | { readonly valid: true; readonly length: number }
  | { readonly valid: false; readonly length: number; readonly brokenAtEntryId: string | null };

// ---------------------------------------------------------------------------------------------------------------------
// Constantes et lignes SQL
// ---------------------------------------------------------------------------------------------------------------------

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GENESIS_PREFIX = 'GENESIS_HASH_';
/** Caisse (loi 3) et comptes de suspens du lettrage (Doc_02 § 04) : numéros CGNC, pas des règles fiscales. */
const CASH_PREFIX = '5161';
const SUSPENSE_PREFIXES: readonly string[] = ['3497', '4497'];

interface ReversalRow {
  readonly id: string;
  readonly entry_reference: string;
  readonly sequence_number: number;
  readonly status: string;
  readonly entry_date: string;
  readonly journal_id: string;
  readonly fiscal_year_id: string;
}

interface EntryRow {
  readonly id: string;
  readonly fiscal_year_id: string;
  readonly journal_id: string;
  readonly sequence_number: number;
  readonly entry_reference: string;
  readonly entry_date: string;
  readonly validated_at: string | null;
  readonly review_cycle: string;
  readonly status: string;
  readonly source_document_type: string;
  readonly invoice_id: string | null;
  readonly dgi_clearance_uuid: string | null;
  readonly partner_id: string | null;
  readonly reversal_of_entry_id: string | null;
  readonly total_debit_cents: number;
  readonly total_credit_cents: number;
  readonly previous_entry_hash: string | null;
  readonly entry_hash: string | null;
}

interface LineRow {
  readonly id: string;
  readonly line_number: number;
  readonly account_id: string;
  readonly account_number: string;
  readonly cgnc_class: number;
  readonly vat_regime_role: string;
  readonly auxiliary_account: string | null;
  readonly description_enc: string;
  readonly debit_cents: number;
  readonly credit_cents: number;
  readonly is_tax_deductible: number | boolean;
  readonly table3_reintegration_code: string | null;
}

interface FiscalYearRow {
  readonly id: string;
  readonly code: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly status: FiscalYearState;
  readonly closing_hash: string | null;
}

interface JournalRow {
  readonly id: string;
  readonly code: string;
  readonly journal_type: string;
  readonly last_sequence_number: number;
  readonly last_entry_hash: string;
}

interface AuditRow {
  readonly entity_table: string;
  readonly entity_id: string;
  readonly from_state: string;
  readonly to_state: string;
  readonly actor_id: string;
  readonly idempotency_key: string;
}

interface PreparedLine {
  readonly accountId: string;
  readonly accountNumber: string;
  readonly debitCents: number;
  readonly creditCents: number;
  readonly description: string;
  readonly auxiliaryAccount: string | null;
  readonly isTaxDeductible: boolean;
  readonly table3ReintegrationCode: string | null;
  readonly reconciliationCode: string | null;
}

interface SealPlan {
  readonly entryHash: string;
  readonly previousEntryHash: string;
  /** Rang de la pièce dans la chaîne du journal après scellement. */
  readonly chainPosition: number;
}

interface InsertEntrySpec {
  readonly journal: JournalRow;
  readonly fiscalYear: FiscalYearRow;
  readonly entryDate: string;
  readonly reviewCycle: LedgerReviewCycle;
  readonly sourceDocumentType: LedgerSourceDocumentType;
  readonly status: 'IA_PROPOSITION' | 'DRAFT';
  readonly lines: readonly PreparedLine[];
  readonly invoiceId: string | null;
  readonly partnerId: string | null;
  readonly dgiClearanceUuid: string | null;
  readonly reversalOfEntryId: string | null;
  /** Instructions à placer AVANT l'insertion de la pièce (création de l'exercice suivant). */
  readonly leadingStatements?: readonly SqlStatementParams[];
}

const ENTRY_COLUMNS = `je.id, je.fiscal_year_id, je.journal_id, je.sequence_number, je.entry_reference, je.entry_date, je.validated_at,
  je.review_cycle, je.status, je.source_document_type, je.invoice_id, je.dgi_clearance_uuid, je.partner_id, je.reversal_of_entry_id,
  je.total_debit_cents, je.total_credit_cents, je.previous_entry_hash, je.entry_hash`;

const LINE_COLUMNS = `jel.id, jel.line_number, jel.account_id, ca.account_number, ca.cgnc_class, ca.vat_regime_role, jel.auxiliary_account,
  jel.description_enc, jel.debit_cents, jel.credit_cents, jel.is_tax_deductible, jel.table3_reintegration_code`;

function invalid(detail: string): LedgerError {
  return new LedgerError('LEDGER_INVALID_INPUT', detail);
}

function actorKindOf(role: RoleCode): ActorKind {
  return role === 'ERP_CONNECTOR_AGENT' || role === 'AI_MCP_ACTOR' ? 'DETERMINISTIC_SYSTEM' : 'HUMAN_USER';
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function assertIsoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw invalid(`${label} doit être une date ISO AAAA-MM-JJ.`);
  }
  return value;
}

function assertKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalid('idempotencyKey ne peut pas être vide.');
  }
  return value;
}

function wrapFsm<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof FsmTransitionError) {
      throw new LedgerError('LEDGER_FSM_REJECTED', error.message, { fsmCode: error.code });
    }
    throw error;
  }
}

function toBoolean(value: number | boolean): boolean {
  return value === true || value === 1;
}

export class ImmutableCgncLedgerEngine {
  constructor(private readonly deps: LedgerEngineDeps) {}

  // -------------------------------------------------------------------------------------------------------------------
  // (1) Brouillon
  // -------------------------------------------------------------------------------------------------------------------

  async createDraft(actor: LedgerActor, input: CreateDraftInput): Promise<DraftCreated> {
    if (input.initialState !== 'IA_PROPOSITION' && input.initialState !== 'DRAFT') {
      throw new LedgerError('LEDGER_INVALID_INITIAL_STATE', `état initial ${String(input.initialState)} refusé : POSTED ne s'atteint que par le scellement (D-03).`);
    }
    if (!includes(LEDGER_SOURCE_DOCUMENT_TYPES, input.sourceDocumentType)) {
      throw invalid(`sourceDocumentType inconnu : ${String(input.sourceDocumentType)}.`);
    }
    if (input.sourceDocumentType === 'REVERSAL' || input.sourceDocumentType === 'VAT_CLEARING') {
      throw invalid(`${input.sourceDocumentType} se crée par sa méthode dédiée (createReversalDraft, createVatClearingDraft).`);
    }
    return this.insertDraft(actor, {
      journalId: input.journalId,
      fiscalYearId: input.fiscalYearId,
      entryDate: input.entryDate,
      reviewCycle: input.reviewCycle,
      sourceDocumentType: input.sourceDocumentType,
      status: input.initialState,
      lines: input.lines,
      invoiceId: input.invoiceId ?? null,
      partnerId: input.partnerId ?? null,
      dgiClearanceUuid: input.dgiClearanceUuid ?? null,
      reversalOfEntryId: null,
    });
  }

  // -------------------------------------------------------------------------------------------------------------------
  // (2) Visa en trois niveaux : aide-comptable, chef de mission, expert-comptable OEC (qui appose son visa en scellant)
  // -------------------------------------------------------------------------------------------------------------------

  /** Niveau 1 : l'aide-comptable vérifie la proposition (IA_PROPOSITION → DRAFT). */
  submitDraft(actor: LedgerActor, input: EntryTransitionInput): Promise<EntryTransitionResult> {
    return this.transitionEntry(actor, input, { from: 'IA_PROPOSITION', to: 'DRAFT', permission: 'LEDGER_SAVE_DRAFT' });
  }

  /** Niveau 2 : le chef de mission appose son visa de cycle (DRAFT → REVISEE_CYCLE). */
  visaCycle(actor: LedgerActor, input: EntryTransitionInput): Promise<EntryTransitionResult> {
    return this.transitionEntry(actor, input, { from: 'DRAFT', to: 'REVISEE_CYCLE', permission: 'LEDGER_VISA_CYCLE' });
  }

  /** Niveau 3 : l'expert-comptable (ou le gérant en direct, Doc_09 § 06B) scelle (REVISEE_CYCLE → POSTED), Step-Up exigé. */
  sealEntry(actor: LedgerActor, input: EntryTransitionInput): Promise<EntryTransitionResult> {
    return this.transitionEntry(actor, input, { from: 'REVISEE_CYCLE', to: 'POSTED', permission: 'LEDGER_POST_IMMUTABLE' });
  }

  // -------------------------------------------------------------------------------------------------------------------
  // (4) Contre-passation (D-03)
  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Contre-passation (D-03), unique par pièce : `uq_journal_entries_reversal_of` (v8) l'impose en base. REPRISE IDEMPOTENTE : si
   * la contre-passation existe déjà, ou si l'écriture perd une course sur cette unicité, la demande est rejouée quand elle est
   * identique (même date, même journal, même exercice) et que la contre-passation est encore un brouillon : la pièce existante
   * est rendue avec `replayed: true` et aucun second brouillon n'est créé. Le motif n'entre pas dans la comparaison : il est
   * chiffré avec un aléa propre à chaque écriture, donc non comparable en clair. Toute autre demande sur une pièce déjà
   * contre-passée reste `LEDGER_ALREADY_REVERSED`.
   */
  async createReversalDraft(actor: LedgerActor, input: CreateReversalDraftInput): Promise<ReversalDraftCreated> {
    assertIsoDate(input.entryDate, 'entryDate');
    if (typeof input.reasonText !== 'string' || input.reasonText.trim().length === 0) {
      throw invalid('reasonText (motif de la contre-passation) ne peut pas être vide.');
    }
    const original = await this.loadEntry(input.originalEntryId);
    const reversalId = this.newId();
    const draft = wrapFsmReversal(() =>
      buildReversalEntryDraft({
        reversedEntryId: original.id,
        reversalEntryId: reversalId,
        reversedEntryState: original.status as JournalEntryState,
      }),
    );
    const existing = await this.findReversalOf(original.id);
    if (existing !== undefined) {
      return this.replayReversal(original, existing, input);
    }
    const originalLines = await this.loadLines(original.id);
    const inverted = invertLines(
      originalLines.map((line) => ({
        accountNumber: line.account_number,
        debitCents: Number(line.debit_cents),
        creditCents: Number(line.credit_cents),
        description: `Contre-passation ${original.entry_reference} : ${input.reasonText}`,
        auxiliaryAccount: line.auxiliary_account,
        isTaxDeductible: toBoolean(line.is_tax_deductible),
        table3ReintegrationCode: line.table3_reintegration_code,
      })),
    );
    try {
      const created = await this.insertDraft(
        actor,
        {
          journalId: input.journalId ?? original.journal_id,
          fiscalYearId: input.fiscalYearId ?? original.fiscal_year_id,
          entryDate: input.entryDate,
          reviewCycle: original.review_cycle as LedgerReviewCycle,
          sourceDocumentType: 'REVERSAL',
          status: draft.status,
          lines: inverted,
          invoiceId: original.invoice_id,
          partnerId: original.partner_id,
          dgiClearanceUuid: null,
          reversalOfEntryId: draft.reversal_of_entry_id,
        },
        draft.entryId,
      );
      return { ...created, replayed: false };
    } catch (error) {
      if (error instanceof LedgerError && error.code === 'LEDGER_CONCURRENCY_CONFLICT') {
        // Course perdue : unicité de reversal_of_entry_id (ou de la séquence du journal) violée par une demande concurrente.
        const raced = await this.findReversalOf(original.id);
        if (raced !== undefined) {
          return this.replayReversal(original, raced, input);
        }
      }
      throw error;
    }
  }

  private async findReversalOf(originalEntryId: string): Promise<ReversalRow | undefined> {
    const rows = await this.query<ReversalRow>(
      'SELECT id, entry_reference, sequence_number, status, entry_date, journal_id, fiscal_year_id FROM journal_entries WHERE reversal_of_entry_id = ? LIMIT 1',
      [originalEntryId],
    );
    return rows[0];
  }

  private replayReversal(original: EntryRow, existing: ReversalRow, input: CreateReversalDraftInput): ReversalDraftCreated {
    const sameRequest =
      existing.entry_date === input.entryDate &&
      existing.journal_id === (input.journalId ?? original.journal_id) &&
      existing.fiscal_year_id === (input.fiscalYearId ?? original.fiscal_year_id);
    const status = existing.status === 'IA_PROPOSITION' || existing.status === 'DRAFT' ? existing.status : null;
    if (!sameRequest || status === null) {
      throw new LedgerError('LEDGER_ALREADY_REVERSED', `la pièce ${original.entry_reference} est déjà contre-passée par ${existing.id}.`);
    }
    return { entryId: existing.id, entryReference: existing.entry_reference, sequenceNumber: Number(existing.sequence_number), status, replayed: true };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // (5) VAT_CLEARING et effets LCN
  // -------------------------------------------------------------------------------------------------------------------

  async createVatClearingDraft(actor: LedgerActor, input: CreateVatClearingDraftInput): Promise<VatClearingDraftCreated> {
    assertIsoDate(input.entryDate, 'entryDate');
    if (!includes(UBL_PAYMENT_CODES, input.paymentMethodCode)) {
      throw invalid(`paymentMethodCode inconnu : ${String(input.paymentMethodCode)}.`);
    }
    const settledBefore = ensureAmount(input.settledBeforeCents, 'settledBeforeCents');
    const settledNow = ensureAmount(input.settledNowCents, 'settledNowCents');
    if (input.lcnBankCollectionDate !== undefined && input.lcnBankCollectionDate !== null) {
      assertIsoDate(input.lcnBankCollectionDate, 'lcnBankCollectionDate');
    }
    if (input.paymentMethodCode === LCN_PAYMENT_CODE && (input.lcnBankCollectionDate ?? null) === null) {
      throw new LedgerError(
        'LEDGER_VAT_CLEARING_DEFERRED_LCN',
        "la remise d'un effet (42_EFFET_LCN) ne libère pas la TVA : elle attend l'encaissement bancaire effectif (Doc_02 § 05, Doc_14 § 04).",
      );
    }
    const invoice = await this.loadEntry(input.invoiceEntryId);
    if (invoice.status !== 'POSTED') {
      throw new LedgerError('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE', `la pièce ${invoice.entry_reference} est ${invoice.status} : seule une pièce POSTED se liquide.`);
    }
    if (invoice.source_document_type !== 'INVOICE' && invoice.source_document_type !== 'CREDIT_NOTE') {
      throw invalid(`la liquidation vise une pièce INVOICE ou CREDIT_NOTE (reçu : ${invoice.source_document_type}).`);
    }
    const lines = await this.loadLines(invoice.id);
    const pending: VatPendingLine[] = [];
    for (const line of lines) {
      if (line.vat_regime_role === 'VAT_COLLECTED_PENDING' || line.vat_regime_role === 'VAT_RECOVERABLE_PENDING') {
        const side: EntrySide = Number(line.debit_cents) > 0 ? 'DEBIT' : 'CREDIT';
        pending.push({
          lineNumber: Number(line.line_number),
          accountNumber: line.account_number,
          role: line.vat_regime_role,
          side,
          amountCents: Number(side === 'DEBIT' ? line.debit_cents : line.credit_cents),
        });
      }
    }
    if (pending.length === 0) {
      throw new LedgerError('LEDGER_NOTHING_TO_CLEAR', `la pièce ${invoice.entry_reference} ne porte aucune TVA d'attente.`);
    }
    const targets: Partial<Record<VatPendingRole, string>> = {};
    for (const role of new Set(pending.map((p) => p.role))) {
      const targetRole = role === 'VAT_COLLECTED_PENDING' ? 'VAT_COLLECTED_DUE' : input.recoverableTarget;
      if (targetRole === undefined) {
        throw new LedgerError('LEDGER_VAT_TARGET_REQUIRED', 'recoverableTarget (charges ou immobilisations) est obligatoire pour la TVA récupérable.');
      }
      targets[role] = await this.resolveAccountByVatRole(targetRole);
    }
    const movements = computeVatClearingMovements({
      pendingLines: pending,
      invoiceTtcCents: Number(invoice.total_debit_cents),
      settledBeforeCents: settledBefore,
      settledNowCents: settledNow,
      targetByPendingRole: targets,
    });
    const clearingLines = movements.flatMap((movement): DraftLineInput[] => {
      const label = `VAT_CLEARING ${invoice.entry_reference} ligne ${movement.sourceLineNumber}`;
      const pendingLine: DraftLineInput = {
        accountNumber: movement.pendingAccountNumber,
        debitCents: movement.pendingSide === 'DEBIT' ? movement.amountCents : 0,
        creditCents: movement.pendingSide === 'CREDIT' ? movement.amountCents : 0,
        description: label,
        ...(input.reconciliationCode === undefined ? {} : { reconciliationCode: input.reconciliationCode }),
      };
      const targetLine: DraftLineInput = {
        accountNumber: movement.targetAccountNumber,
        debitCents: movement.pendingSide === 'CREDIT' ? movement.amountCents : 0,
        creditCents: movement.pendingSide === 'DEBIT' ? movement.amountCents : 0,
        description: label,
        ...(input.reconciliationCode === undefined ? {} : { reconciliationCode: input.reconciliationCode }),
      };
      return [pendingLine, targetLine];
    });
    const created = await this.insertDraft(actor, {
      journalId: input.journalId,
      fiscalYearId: input.fiscalYearId,
      entryDate: input.entryDate,
      reviewCycle: 'FISCAL',
      sourceDocumentType: 'VAT_CLEARING',
      status: 'DRAFT',
      lines: clearingLines,
      invoiceId: invoice.invoice_id,
      partnerId: invoice.partner_id,
      dgiClearanceUuid: null,
      reversalOfEntryId: null,
    });
    return { ...created, clearedCents: movements.reduce((sum, m) => sum + m.amountCents, 0) };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // (7) Clôture d'exercice et journal d'à-nouveaux
  // -------------------------------------------------------------------------------------------------------------------

  /** OPEN → CLOSING : chef de mission (Doc_02 § 04). La génération des brouillons de cut-off n'est pas portée par ce ticket. */
  beginFiscalYearClosing(actor: LedgerActor, input: FiscalYearTransitionInput): Promise<FiscalYearTransitionResult> {
    return this.transitionFiscalYear(actor, input, { from: 'OPEN', to: 'CLOSING', permission: 'LEDGER_VISA_CYCLE' });
  }

  /** CLOSING → CLOSED : expert-comptable signataire, Step-Up exigé ; scelle `closing_hash`. */
  closeFiscalYear(actor: LedgerActor, input: FiscalYearTransitionInput): Promise<FiscalYearTransitionResult> {
    return this.transitionFiscalYear(actor, input, { from: 'CLOSING', to: 'CLOSED', permission: 'LEDGER_POST_IMMUTABLE' });
  }

  /**
   * Journal d'ouverture AN dans le NOUVEL exercice : une écriture DRAFT reprenant les soldes de bilan (classes 1 à 5) de
   * l'exercice clos, créée avec l'exercice suivant dans un seul lot atomique. Elle se scelle ensuite par le circuit de visa normal.
   */
  async generateOpeningJournal(actor: LedgerActor, input: GenerateOpeningJournalInput): Promise<OpeningJournalGenerated> {
    const next = input.nextFiscalYear;
    assertIsoDate(next.startDate, 'nextFiscalYear.startDate');
    assertIsoDate(next.endDate, 'nextFiscalYear.endDate');
    assertIsoDate(input.entryDate, 'entryDate');
    const openingSourceType: LedgerSourceDocumentType = input.sourceDocumentType ?? 'OPENING_BALANCE';
    if (!includes(LEDGER_SOURCE_DOCUMENT_TYPES, openingSourceType) || openingSourceType === 'REVERSAL') {
      throw invalid(`sourceDocumentType invalide pour un à-nouveau : ${String(openingSourceType)}.`);
    }
    if (next.startDate > next.endDate || input.entryDate < next.startDate || input.entryDate > next.endDate) {
      throw invalid("l'écriture d'à-nouveaux doit être datée dans le nouvel exercice.");
    }
    const existingNext = await this.findFiscalYear(next.id);
    this.authorize(actor, 'LEDGER_POST_IMMUTABLE', existingNext?.status === 'CLOSED', this.deps.clock.nowIso());

    const closed = await this.requireFiscalYear(input.closedFiscalYearId);
    if (closed.status !== 'CLOSED') {
      throw new LedgerError('LEDGER_FISCAL_YEAR_NOT_CLOSED', `l'exercice ${closed.code} est ${closed.status} : l'ouverture suit la clôture.`);
    }
    if (next.startDate <= closed.end_date) {
      throw invalid("le nouvel exercice doit commencer après la fin de l'exercice clos.");
    }
    if (existingNext !== undefined && existingNext.status !== 'OPEN') {
      throw new LedgerError('LEDGER_FISCAL_YEAR_NOT_OPEN', `le nouvel exercice ${existingNext.code} est ${existingNext.status}.`);
    }
    const journal = await this.requireJournal(input.journalId);
    if (journal.journal_type !== 'OPENING') {
      throw invalid(`le journal ${journal.code} n'est pas de type OPENING.`);
    }
    const already = await this.query<{ n: number }>('SELECT COUNT(*) AS n FROM journal_entries WHERE fiscal_year_id = ? AND journal_id = ?', [next.id, journal.id]);
    if (Number(already[0]?.n ?? 0) > 0) {
      throw new LedgerError('LEDGER_OPENING_ALREADY_GENERATED', `le journal ${journal.code} contient déjà des écritures dans ${next.code}.`);
    }
    const balances = await this.query<{ account_number: string; cgnc_class: number; net: number }>(
      `SELECT ca.account_number AS account_number, ca.cgnc_class AS cgnc_class,
              CAST(COALESCE(SUM(jel.debit_cents - jel.credit_cents), 0) AS BIGINT) AS net
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.entry_id
         JOIN cgnc_accounts ca ON ca.id = jel.account_id
        WHERE je.fiscal_year_id = ? AND je.status = 'POSTED'
        GROUP BY ca.account_number, ca.cgnc_class`,
      [closed.id],
    );
    const openingLines = computeOpeningBalanceLines(
      balances.map((b) => ({ accountNumber: b.account_number, cgncClass: Number(b.cgnc_class), netCents: Number(b.net) })),
    );

    const nextYear: FiscalYearRow = { id: next.id, code: next.code, start_date: next.startDate, end_date: next.endDate, status: 'OPEN', closing_hash: null };
    const leading: SqlStatementParams[] =
      existingNext === undefined
        ? [{ sql: `INSERT INTO fiscal_years (id, code, start_date, end_date, status) VALUES (?, ?, ?, ?, 'OPEN')`, params: [next.id, next.code, next.startDate, next.endDate] }]
        : [];
    const prepared = await this.prepareLines(
      openingLines.map((line) => ({
        accountNumber: line.accountNumber,
        debitCents: line.debitCents,
        creditCents: line.creditCents,
        description: `Report à nouveau ${closed.code} compte ${line.accountNumber}`,
      })),
    );
    const created = await this.writeEntry({
      journal,
      fiscalYear: nextYear,
      entryDate: input.entryDate,
      reviewCycle: 'GENERAL',
      sourceDocumentType: openingSourceType,
      status: 'DRAFT',
      lines: prepared,
      invoiceId: null,
      partnerId: null,
      dgiClearanceUuid: null,
      reversalOfEntryId: null,
      leadingStatements: leading,
    });
    const total = assertBalancedLines(openingLines);
    return {
      fiscalYearId: next.id,
      entryId: created.entryId,
      entryReference: created.entryReference,
      totalDebitCents: Number(total.debit),
      lineCount: openingLines.length,
    };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // (3) Vérification de la chaîne d'un journal
  // -------------------------------------------------------------------------------------------------------------------

  /** Rejoue la chaîne depuis GENESIS_HASH avec le `LedgerHasher` injecté : chaque maillon, la tête et la longueur. */
  async verifyJournalChain(journalId: string): Promise<JournalChainVerdict> {
    const journal = await this.requireJournal(journalId);
    const posted = await this.query<{ id: string; previous_entry_hash: string; entry_hash: string }>(
      `SELECT id, previous_entry_hash, entry_hash FROM journal_entries WHERE journal_id = ? AND status = 'POSTED'`,
      [journalId],
    );
    const byPrevious = new Map(posted.map((row) => [row.previous_entry_hash, row]));
    let cursor = await this.genesisOf(journal);
    let length = 0;
    while (true) {
      const next = byPrevious.get(cursor);
      if (next === undefined) break;
      length += 1;
      const recomputed = await this.deps.hasher.computeEntryHash(await this.buildHashInput(next.id, cursor, length));
      if (recomputed !== next.entry_hash) {
        return { valid: false, length, brokenAtEntryId: next.id };
      }
      cursor = next.entry_hash;
    }
    const headMatches = journal.last_entry_hash === cursor && Number(journal.last_sequence_number) === length && posted.length === length;
    return headMatches ? { valid: true, length } : { valid: false, length, brokenAtEntryId: null };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Écriture d'un brouillon (commun à createDraft, createReversalDraft, createVatClearingDraft)
  // -------------------------------------------------------------------------------------------------------------------

  private async insertDraft(
    actor: LedgerActor,
    spec: {
      readonly journalId: string;
      readonly fiscalYearId: string;
      readonly entryDate: string;
      readonly reviewCycle: LedgerReviewCycle;
      readonly sourceDocumentType: LedgerSourceDocumentType;
      readonly status: 'IA_PROPOSITION' | 'DRAFT';
      readonly lines: readonly DraftLineInput[];
      readonly invoiceId: string | null;
      readonly partnerId: string | null;
      readonly dgiClearanceUuid: string | null;
      readonly reversalOfEntryId: string | null;
    },
    entryId?: string,
  ): Promise<DraftCreated> {
    assertIsoDate(spec.entryDate, 'entryDate');
    if (!includes(LEDGER_REVIEW_CYCLES, spec.reviewCycle)) {
      throw invalid(`reviewCycle inconnu : ${String(spec.reviewCycle)}.`);
    }
    if (!Array.isArray(spec.lines)) {
      throw invalid('lines doit être un tableau.');
    }
    assertBalancedLines(spec.lines);

    const fiscalYear = await this.requireFiscalYear(spec.fiscalYearId);
    if (fiscalYear.status === 'CLOSED') {
      throw new LedgerError('LEDGER_FISCAL_YEAR_CLOSED', `l'exercice ${fiscalYear.code} est clos : aucune écriture (Doc_09 § 07).`);
    }
    if (fiscalYear.status === 'CLOSING' && spec.sourceDocumentType !== 'CUTOFF_OD' && spec.sourceDocumentType !== 'REVERSAL') {
      throw new LedgerError(
        'LEDGER_FISCAL_YEAR_NOT_OPEN',
        `l'exercice ${fiscalYear.code} est en clôture : seules les écritures de clôture (CUTOFF_OD) et les contre-passations sont admises.`,
      );
    }
    this.authorize(actor, 'LEDGER_SAVE_DRAFT', false, this.deps.clock.nowIso());
    if (spec.entryDate < fiscalYear.start_date || spec.entryDate > fiscalYear.end_date) {
      throw invalid(`entryDate ${spec.entryDate} hors de l'exercice ${fiscalYear.code}.`);
    }
    const journal = await this.requireJournal(spec.journalId);
    const prepared = await this.prepareLines(spec.lines);
    const created = await this.writeEntry(
      {
        journal,
        fiscalYear,
        entryDate: spec.entryDate,
        reviewCycle: spec.reviewCycle,
        sourceDocumentType: spec.sourceDocumentType,
        status: spec.status,
        lines: prepared,
        invoiceId: spec.invoiceId,
        partnerId: spec.partnerId,
        dgiClearanceUuid: spec.dgiClearanceUuid,
        reversalOfEntryId: spec.reversalOfEntryId,
      },
      entryId,
    );
    return { ...created, status: spec.status };
  }

  private async prepareLines(
    lines: readonly {
      readonly accountNumber: string;
      readonly debitCents: number;
      readonly creditCents: number;
      readonly description: string;
      readonly auxiliaryAccount?: string | null;
      readonly isTaxDeductible?: boolean;
      readonly table3ReintegrationCode?: string | null;
      readonly reconciliationCode?: string | null;
    }[],
  ): Promise<PreparedLine[]> {
    const numbers = [...new Set(lines.map((l) => l.accountNumber))];
    const accounts = new Map<string, string>();
    for (const number of numbers) {
      const rows = await this.query<{ id: string }>('SELECT id FROM cgnc_accounts WHERE account_number = ?', [number]);
      const row = rows[0];
      if (row === undefined) {
        throw new LedgerError('LEDGER_UNKNOWN_ACCOUNT', `compte CGNC inconnu : ${number}.`);
      }
      accounts.set(number, row.id);
    }
    return lines.map((line) => {
      if (typeof line.description !== 'string' || line.description.length === 0) {
        throw new LedgerError('LEDGER_INVALID_LINE', `la ligne du compte ${line.accountNumber} n'a pas de libellé.`);
      }
      return {
        accountId: accounts.get(line.accountNumber) ?? '',
        accountNumber: line.accountNumber,
        debitCents: line.debitCents,
        creditCents: line.creditCents,
        description: line.description,
        auxiliaryAccount: line.auxiliaryAccount ?? null,
        isTaxDeductible: line.isTaxDeductible ?? true,
        table3ReintegrationCode: line.table3ReintegrationCode ?? null,
        reconciliationCode: line.reconciliationCode ?? null,
      };
    });
  }

  private async writeEntry(spec: InsertEntrySpec, presetEntryId?: string): Promise<{ entryId: string; entryReference: string; sequenceNumber: number }> {
    const totals = assertBalancedLines(spec.lines);
    const entryId = presetEntryId ?? this.newId();
    const maxRows = await this.query<{ m: number }>(
      'SELECT COALESCE(MAX(sequence_number), 0) AS m FROM journal_entries WHERE journal_id = ? AND fiscal_year_id = ?',
      [spec.journal.id, spec.fiscalYear.id],
    );
    const sequenceNumber = Number(maxRows[0]?.m ?? 0) + 1;
    const entryReference = `${spec.journal.code}/${spec.fiscalYear.code}/${String(sequenceNumber).padStart(6, '0')}`;
    const statements: SqlStatementParams[] = [
      ...(spec.leadingStatements ?? []),
      {
        sql: `INSERT INTO journal_entries (id, fiscal_year_id, journal_id, sequence_number, entry_reference, entry_date, review_cycle, status,
                source_document_type, invoice_id, dgi_clearance_uuid, partner_id, reversal_of_entry_id, total_debit_cents, total_credit_cents)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          entryId,
          spec.fiscalYear.id,
          spec.journal.id,
          sequenceNumber,
          entryReference,
          spec.entryDate,
          spec.reviewCycle,
          spec.status,
          spec.sourceDocumentType,
          spec.invoiceId,
          spec.dgiClearanceUuid,
          spec.partnerId,
          spec.reversalOfEntryId,
          Number(totals.debit),
          Number(totals.credit),
        ],
      },
    ];
    for (const [index, line] of spec.lines.entries()) {
      const lineId = this.newId();
      const descriptionEnc = await this.deps.cipher.encryptField(line.description, `${this.deps.companyId}|journal_entry_lines|${lineId}|description_enc`);
      statements.push({
        sql: `INSERT INTO journal_entry_lines (id, entry_id, line_number, account_id, auxiliary_account, description_enc, debit_cents, credit_cents,
                is_tax_deductible, table3_reintegration_code, reconciliation_code)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          lineId,
          entryId,
          index + 1,
          line.accountId,
          line.auxiliaryAccount,
          descriptionEnc,
          line.debitCents,
          line.creditCents,
          line.isTaxDeductible ? 1 : 0,
          line.table3ReintegrationCode,
          line.reconciliationCode,
        ],
      });
    }
    await this.write(statements);
    return { entryId, entryReference, sequenceNumber };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Transition d'une écriture (visa 1, visa 2, scellement)
  // -------------------------------------------------------------------------------------------------------------------

  private async transitionEntry(
    actor: LedgerActor,
    input: EntryTransitionInput,
    spec: { readonly from: JournalEntryState; readonly to: JournalEntryState; readonly permission: PermissionAction },
  ): Promise<EntryTransitionResult> {
    const key = assertKey(input.idempotencyKey);
    if ((await this.replayOf(actor, key, 'journal_entries', input.entryId, spec.from, spec.to)) !== null) {
      return this.entryResultFromReplay(input.entryId, spec);
    }
    const entry = await this.loadEntry(input.entryId);
    const fiscalYear = await this.requireFiscalYear(entry.fiscal_year_id);
    if (fiscalYear.status === 'CLOSED') {
      throw new LedgerError('LEDGER_FISCAL_YEAR_CLOSED', `l'exercice ${fiscalYear.code} est clos : transition refusée.`);
    }
    const nowIso = this.deps.clock.nowIso();
    this.authorize(actor, spec.permission, false, nowIso);
    if (entry.status === 'POSTED') {
      throw new LedgerError('LEDGER_ENTRY_ALREADY_POSTED', `la pièce ${entry.entry_reference} est déjà scellée (POSTED) ; seule une contre-passation la corrige.`);
    }
    if (entry.status !== spec.from) {
      throw new LedgerError('LEDGER_ENTRY_NOT_IN_EXPECTED_STATE', `la pièce ${entry.entry_reference} est ${entry.status} : ${spec.from} attendu pour passer à ${spec.to}.`);
    }

    const auditId = this.newId();
    const state = await this.entityState<JournalEntryState>('journal_entries', entry.id, spec.from);
    const applied = wrapFsm(() =>
      applyTransition(
        JOURNAL_ENTRY_FSM,
        state,
        {
          entityTable: 'journal_entries',
          entityId: entry.id,
          expectedFromState: spec.from,
          targetState: spec.to,
          actorKind: actorKindOf(actor.role),
          actorId: actor.actorId,
          idempotencyKey: key,
        },
        [],
        { nowIso, auditId },
      ),
    );

    let statements: SqlStatementParams[];
    let sealed: SealPlan | null = null;
    if (spec.to === 'POSTED') {
      sealed = await this.prepareSeal(entry, nowIso);
      const journalId = entry.journal_id;
      statements = [
        {
          sql: `UPDATE journal_entries SET status = 'POSTED', validated_at = ?, previous_entry_hash = ?, entry_hash = ? WHERE id = ? AND status = 'REVISEE_CYCLE'`,
          params: [nowIso, sealed.previousEntryHash, sealed.entryHash, entry.id],
        },
        {
          sql: `UPDATE journals SET last_entry_hash = ?, last_sequence_number = last_sequence_number + 1 WHERE id = ? AND last_entry_hash = ? AND last_sequence_number = ?`,
          params: [sealed.entryHash, journalId, sealed.previousEntryHash, sealed.chainPosition - 1],
        },
        guardedAudit(applied.audit, {
          guardSql: `EXISTS (SELECT 1 FROM journal_entries WHERE id = ? AND status = 'POSTED' AND entry_hash = ?)
                     AND EXISTS (SELECT 1 FROM journals WHERE id = ? AND last_entry_hash = ? AND last_sequence_number = ?)`,
          guardParams: [entry.id, sealed.entryHash, journalId, sealed.entryHash, sealed.chainPosition],
        }),
      ];
    } else {
      statements = [
        { sql: `UPDATE journal_entries SET status = ? WHERE id = ? AND status = ?`, params: [spec.to, entry.id, spec.from] },
        guardedAudit(applied.audit, { guardSql: `EXISTS (SELECT 1 FROM journal_entries WHERE id = ? AND status = ?)`, guardParams: [entry.id, spec.to] }),
      ];
    }
    try {
      await this.write(statements);
    } catch (error) {
      if (error instanceof LedgerError && error.code === 'LEDGER_CONCURRENCY_CONFLICT') {
        const raced = await this.replayOf(actor, key, 'journal_entries', entry.id, spec.from, spec.to);
        if (raced !== null) {
          return this.entryResultFromReplay(entry.id, spec);
        }
        const after = await this.loadEntry(entry.id);
        if (after.status === 'POSTED') {
          throw new LedgerError('LEDGER_ENTRY_ALREADY_POSTED', `la pièce ${entry.entry_reference} a été scellée par une autre demande.`, { origin: 'DATABASE' });
        }
      }
      throw error;
    }
    return {
      entryId: entry.id,
      fromState: spec.from,
      toState: spec.to,
      replayed: false,
      ...(sealed === null ? {} : { entryHash: sealed.entryHash, previousEntryHash: sealed.previousEntryHash }),
    };
  }

  /** Vérifie équilibre et caisse 5161 (le moteur d'abord, les triggers ensuite), puis calcule l'empreinte chaînée. */
  private async prepareSeal(entry: EntryRow, nowIso: string): Promise<SealPlan> {
    const lines = await this.loadLines(entry.id);
    const amounts = lines.map((l) => ({ debitCents: Number(l.debit_cents), creditCents: Number(l.credit_cents) }));
    const totals = assertBalancedLines(amounts);
    if (totals.debit !== BigInt(entry.total_debit_cents) || totals.credit !== BigInt(entry.total_credit_cents)) {
      throw new LedgerError('LEDGER_UNBALANCED', `les lignes (${totals.debit} / ${totals.credit}) ne bouclent pas avec la pièce (${entry.total_debit_cents} / ${entry.total_credit_cents}).`);
    }
    const cashLines = lines.filter((l) => l.account_number.startsWith(CASH_PREFIX));
    if (cashLines.some((l) => Number(l.credit_cents) > 0)) {
      const posted = await this.query<{ net: number }>(
        `SELECT CAST(COALESCE(SUM(jel.debit_cents - jel.credit_cents), 0) AS BIGINT) AS net
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.entry_id
           JOIN cgnc_accounts ca ON ca.id = jel.account_id
          WHERE je.status = 'POSTED' AND ca.account_number LIKE ?`,
        [`${CASH_PREFIX}%`],
      );
      let projected = BigInt(posted[0]?.net ?? 0);
      for (const line of cashLines) {
        projected += BigInt(line.debit_cents) - BigInt(line.credit_cents);
      }
      if (projected < 0n) {
        throw new LedgerError('LEDGER_NEGATIVE_CASH', `le scellement rendrait la caisse ${CASH_PREFIX} créditrice (${projected} centimes).`);
      }
    }
    const journal = await this.requireJournal(entry.journal_id);
    const previousEntryHash = journal.last_entry_hash;
    const chainPosition = Number(journal.last_sequence_number) + 1;
    const hashInput = await this.buildHashInput(entry.id, previousEntryHash, chainPosition, nowIso);
    const entryHash = await this.deps.hasher.computeEntryHash(hashInput);
    if (typeof entryHash !== 'string' || !SHA256_HEX.test(entryHash)) {
      throw new LedgerError('LEDGER_HASH_INVALID', "le LedgerHasher doit rendre un SHA-256 hexadécimal minuscule de 64 caractères.");
    }
    return { entryHash, previousEntryHash, chainPosition };
  }

  private async buildHashInput(entryId: string, previousEntryHash: string, chainPosition: number, validatedAtOverride?: string): Promise<EntryHashInput> {
    const entry = await this.loadEntry(entryId);
    const journal = await this.requireJournal(entry.journal_id);
    const lines = await this.loadLines(entryId);
    return {
      companyId: this.deps.companyId,
      journalId: journal.id,
      journalCode: journal.code,
      fiscalYearId: entry.fiscal_year_id,
      entryId: entry.id,
      sequenceNumber: Number(entry.sequence_number),
      entryReference: entry.entry_reference,
      entryDate: entry.entry_date,
      sourceDocumentType: entry.source_document_type,
      reversalOfEntryId: entry.reversal_of_entry_id,
      invoiceId: entry.invoice_id,
      partnerId: entry.partner_id,
      dgiClearanceUuid: entry.dgi_clearance_uuid,
      totalDebitCents: Number(entry.total_debit_cents),
      totalCreditCents: Number(entry.total_credit_cents),
      validatedAt: validatedAtOverride ?? entry.validated_at ?? '',
      previousEntryHash,
      chainPosition,
      lines: lines.map((line) => ({
        lineNumber: Number(line.line_number),
        lineId: line.id,
        accountNumber: line.account_number,
        auxiliaryAccount: line.auxiliary_account,
        debitCents: Number(line.debit_cents),
        creditCents: Number(line.credit_cents),
        descriptionEnc: line.description_enc,
        isTaxDeductible: toBoolean(line.is_tax_deductible),
        table3ReintegrationCode: line.table3_reintegration_code,
      })),
    };
  }

  private entryResultFromReplay(entryId: string, spec: { readonly from: JournalEntryState; readonly to: JournalEntryState }): Promise<EntryTransitionResult> {
    return this.loadEntry(entryId).then((entry) => ({
      entryId,
      fromState: spec.from,
      toState: spec.to,
      replayed: true,
      ...(spec.to === 'POSTED' && entry.entry_hash !== null && entry.previous_entry_hash !== null
        ? { entryHash: entry.entry_hash, previousEntryHash: entry.previous_entry_hash }
        : {}),
    }));
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Transition d'un exercice (ouverture de clôture, clôture)
  // -------------------------------------------------------------------------------------------------------------------

  private async transitionFiscalYear(
    actor: LedgerActor,
    input: FiscalYearTransitionInput,
    spec: { readonly from: FiscalYearState; readonly to: FiscalYearState; readonly permission: PermissionAction },
  ): Promise<FiscalYearTransitionResult> {
    const key = assertKey(input.idempotencyKey);
    if ((await this.replayOf(actor, key, 'fiscal_years', input.fiscalYearId, spec.from, spec.to)) !== null) {
      return this.fiscalYearReplay(input.fiscalYearId, spec);
    }
    const fiscalYear = await this.requireFiscalYear(input.fiscalYearId);
    if (fiscalYear.status === 'CLOSED') {
      throw new LedgerError('LEDGER_FISCAL_YEAR_CLOSED', `l'exercice ${fiscalYear.code} est clos (état terminal).`);
    }
    const nowIso = this.deps.clock.nowIso();
    this.authorize(actor, spec.permission, false, nowIso);
    if (fiscalYear.status !== spec.from) {
      throw new LedgerError(
        spec.to === 'CLOSED' ? 'LEDGER_FISCAL_YEAR_NOT_CLOSING' : 'LEDGER_FISCAL_YEAR_NOT_OPEN',
        `l'exercice ${fiscalYear.code} est ${fiscalYear.status} : ${spec.from} attendu pour passer à ${spec.to}.`,
      );
    }
    const auditId = this.newId();
    const state = await this.entityState<FiscalYearState>('fiscal_years', fiscalYear.id, spec.from);
    const applied = wrapFsm(() =>
      applyTransition(
        FISCAL_YEAR_FSM,
        state,
        {
          entityTable: 'fiscal_years',
          entityId: fiscalYear.id,
          expectedFromState: spec.from,
          targetState: spec.to,
          actorKind: actorKindOf(actor.role),
          actorId: actor.actorId,
          idempotencyKey: key,
        },
        [],
        { nowIso, auditId },
      ),
    );

    let statements: SqlStatementParams[];
    let closingHash: string | null = null;
    if (spec.to === 'CLOSED') {
      const snapshot = await this.preClose(fiscalYear, nowIso);
      closingHash = snapshot.closingHash;
      statements = [
        {
          sql: `UPDATE fiscal_years SET status = 'CLOSED', closing_hash = ?
                 WHERE id = ? AND status = 'CLOSING'
                   AND NOT EXISTS (SELECT 1 FROM journal_entries WHERE fiscal_year_id = ? AND status <> 'POSTED')
                   AND (SELECT COUNT(*) FROM journal_entries WHERE fiscal_year_id = ? AND status = 'POSTED') = ?`,
          params: [closingHash, fiscalYear.id, fiscalYear.id, fiscalYear.id, snapshot.postedEntryCount],
        },
        guardedAudit(applied.audit, {
          guardSql: `EXISTS (SELECT 1 FROM fiscal_years WHERE id = ? AND status = 'CLOSED' AND closing_hash = ?)`,
          guardParams: [fiscalYear.id, closingHash],
        }),
      ];
    } else {
      statements = [
        { sql: `UPDATE fiscal_years SET status = ? WHERE id = ? AND status = ?`, params: [spec.to, fiscalYear.id, spec.from] },
        guardedAudit(applied.audit, { guardSql: `EXISTS (SELECT 1 FROM fiscal_years WHERE id = ? AND status = ?)`, guardParams: [fiscalYear.id, spec.to] }),
      ];
    }
    try {
      await this.write(statements);
    } catch (error) {
      if (error instanceof LedgerError && error.code === 'LEDGER_CONCURRENCY_CONFLICT') {
        const raced = await this.replayOf(actor, key, 'fiscal_years', fiscalYear.id, spec.from, spec.to);
        if (raced !== null) {
          return this.fiscalYearReplay(fiscalYear.id, spec);
        }
      }
      throw error;
    }
    return { fiscalYearId: fiscalYear.id, fromState: spec.from, toState: spec.to, replayed: false, ...(closingHash === null ? {} : { closingHash }) };
  }

  private async fiscalYearReplay(fiscalYearId: string, spec: { readonly from: FiscalYearState; readonly to: FiscalYearState }): Promise<FiscalYearTransitionResult> {
    const fiscalYear = await this.requireFiscalYear(fiscalYearId);
    return {
      fiscalYearId,
      fromState: spec.from,
      toState: spec.to,
      replayed: true,
      ...(spec.to === 'CLOSED' && fiscalYear.closing_hash !== null ? { closingHash: fiscalYear.closing_hash } : {}),
    };
  }

  /** Contrôles de pré-clôture : pièces non scellées, suspens soldés, contrôles injectés ; puis empreinte de clôture. */
  private async preClose(fiscalYear: FiscalYearRow, nowIso: string): Promise<{ readonly closingHash: string; readonly postedEntryCount: number }> {
    const unposted = await this.query<{ n: number }>(`SELECT COUNT(*) AS n FROM journal_entries WHERE fiscal_year_id = ? AND status <> 'POSTED'`, [fiscalYear.id]);
    if (Number(unposted[0]?.n ?? 0) > 0) {
      throw new LedgerError('LEDGER_UNPOSTED_ENTRIES_REMAIN', `${Number(unposted[0]?.n)} pièce(s) non scellée(s) dans ${fiscalYear.code} : à sceller ou supprimer avant la clôture.`);
    }
    for (const prefix of SUSPENSE_PREFIXES) {
      const rows = await this.query<{ net: number }>(
        `SELECT CAST(COALESCE(SUM(jel.debit_cents - jel.credit_cents), 0) AS BIGINT) AS net
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.entry_id
           JOIN cgnc_accounts ca ON ca.id = jel.account_id
          WHERE je.fiscal_year_id = ? AND je.status = 'POSTED' AND ca.account_number LIKE ?`,
        [fiscalYear.id, `${prefix}%`],
      );
      const net = BigInt(rows[0]?.net ?? 0);
      if (net !== 0n) {
        throw new LedgerError('LEDGER_SUSPENSE_NOT_CLEARED', `le compte de suspens ${prefix} n'est pas soldé à zéro (${net} centimes).`);
      }
    }
    const verdict = await this.deps.preCloseControls.run(fiscalYear.id);
    if (!verdict.passed) {
      throw new LedgerError('LEDGER_PRECLOSE_CONTROLS_FAILED', verdict.detail);
    }
    const journals = await this.query<JournalRow>('SELECT id, code, journal_type, last_sequence_number, last_entry_hash FROM journals ORDER BY code', []);
    const count = await this.query<{ n: number }>(`SELECT COUNT(*) AS n FROM journal_entries WHERE fiscal_year_id = ? AND status = 'POSTED'`, [fiscalYear.id]);
    const postedEntryCount = Number(count[0]?.n ?? 0);
    const closingHash = await this.deps.hasher.computeClosingHash({
      companyId: this.deps.companyId,
      fiscalYearId: fiscalYear.id,
      fiscalYearCode: fiscalYear.code,
      startDate: fiscalYear.start_date,
      endDate: fiscalYear.end_date,
      postedEntryCount,
      closedAtIso: nowIso,
      journalHeads: journals.map((j) => ({ journalId: j.id, journalCode: j.code, lastEntryHash: j.last_entry_hash, chainLength: Number(j.last_sequence_number) })),
    });
    if (typeof closingHash !== 'string' || !SHA256_HEX.test(closingHash)) {
      throw new LedgerError('LEDGER_HASH_INVALID', 'le LedgerHasher doit rendre un SHA-256 hexadécimal minuscule de 64 caractères pour closing_hash.');
    }
    return { closingHash, postedEntryCount };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Infrastructure interne
  // -------------------------------------------------------------------------------------------------------------------

  private authorize(actor: LedgerActor, action: PermissionAction, fiscalYearClosed: boolean, nowIso: string): void {
    const epochMs = Date.parse(nowIso);
    const context: AuthorizationContext = {
      actorId: actor.actorId,
      role: actor.role,
      companyId: this.deps.companyId,
      assignedCompanyIds: actor.assignedCompanyIds,
      orgPlanSegment: actor.orgPlanSegment,
      activeHumanMembersCount: actor.activeHumanMembersCount,
      subscriptionReadOnly: actor.subscriptionReadOnly,
      fiscalYearClosed,
      canAccessPayrollPii: actor.canAccessPayrollPii,
      mfaVerifiedAtEpochSec: actor.mfaVerifiedAtEpochSec,
      nowEpochSec: Math.floor(epochMs / 1000),
    };
    const decision = evaluateAccessPolicy(action, context);
    if (!decision.allowed) {
      throw new LedgerError('LEDGER_ACCESS_DENIED', `${decision.denialCode} : ${decision.denialMessage}`, { denialCode: decision.denialCode });
    }
  }

  /**
   * Rejeu d'une clé d'idempotence : même acteur, même entité, même transition → résultat déjà enregistré, rien n'est réécrit.
   * Une clé déjà utilisée pour autre chose est refusée (aucune fusion silencieuse).
   */
  private async replayOf(
    actor: LedgerActor,
    key: string,
    entityTable: FsmEntityTable,
    entityId: string,
    from: string,
    to: string,
  ): Promise<AuditRow | null> {
    const rows = await this.query<AuditRow>(
      'SELECT entity_table, entity_id, from_state, to_state, actor_id, idempotency_key FROM state_transition_audit WHERE idempotency_key = ?',
      [key],
    );
    const found = rows[0];
    if (found === undefined) {
      return null;
    }
    if (found.entity_table !== entityTable || found.entity_id !== entityId || found.from_state !== from || found.to_state !== to || found.actor_id !== actor.actorId) {
      throw new LedgerError('LEDGER_IDEMPOTENCY_KEY_REUSED', `la clé ${key} a déjà servi à une autre transition.`);
    }
    if (!actor.assignedCompanyIds.includes(this.deps.companyId)) {
      throw new LedgerError('LEDGER_ACCESS_DENIED', 'ABAC_TENANT_OUT_OF_SCOPE : dossier hors du portefeuille de l\'acteur.', { denialCode: 'ABAC_TENANT_OUT_OF_SCOPE' });
    }
    return found;
  }

  private async entityState<TState extends string>(table: FsmEntityTable, entityId: string, state: TState): Promise<FsmEntityState<TState>> {
    const rows = await this.query<{ idempotency_key: string }>('SELECT idempotency_key FROM state_transition_audit WHERE entity_table = ? AND entity_id = ?', [table, entityId]);
    return { entityTable: table, entityId, state, version: rows.length, appliedIdempotencyKeys: rows.map((r) => r.idempotency_key) };
  }

  private newId(): string {
    const id = this.deps.ids.newId();
    if (typeof id !== 'string' || !UUID_V7.test(id)) {
      throw new LedgerError('LEDGER_INVALID_ID_SOURCE', `l'identifiant injecté n'est pas un UUIDv7 : ${String(id)}.`);
    }
    return id;
  }

  private async query<TRow>(sql: string, params: readonly SqlParam[]): Promise<readonly TRow[]> {
    try {
      return await this.deps.db.query<TRow>({ sql, params });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private async write(statements: readonly SqlStatementParams[]): Promise<void> {
    try {
      await this.deps.db.executeBatchAtomically(statements);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  private async loadEntry(entryId: string): Promise<EntryRow> {
    const rows = await this.query<EntryRow>(`SELECT ${ENTRY_COLUMNS} FROM journal_entries je WHERE je.id = ?`, [entryId]);
    const row = rows[0];
    if (row === undefined) {
      throw new LedgerError('LEDGER_UNKNOWN_ENTRY', `pièce inconnue : ${entryId}.`);
    }
    return row;
  }

  private loadLines(entryId: string): Promise<readonly LineRow[]> {
    return this.query<LineRow>(
      `SELECT ${LINE_COLUMNS} FROM journal_entry_lines jel JOIN cgnc_accounts ca ON ca.id = jel.account_id WHERE jel.entry_id = ? ORDER BY jel.line_number`,
      [entryId],
    );
  }

  private async findFiscalYear(id: string): Promise<FiscalYearRow | undefined> {
    const rows = await this.query<FiscalYearRow>('SELECT id, code, start_date, end_date, status, closing_hash FROM fiscal_years WHERE id = ?', [id]);
    return rows[0];
  }

  private async requireFiscalYear(id: string): Promise<FiscalYearRow> {
    const row = await this.findFiscalYear(id);
    if (row === undefined) {
      throw new LedgerError('LEDGER_UNKNOWN_FISCAL_YEAR', `exercice inconnu : ${id}.`);
    }
    return row;
  }

  private async requireJournal(id: string): Promise<JournalRow> {
    const rows = await this.query<JournalRow>('SELECT id, code, journal_type, last_sequence_number, last_entry_hash FROM journals WHERE id = ?', [id]);
    const row = rows[0];
    if (row === undefined) {
      throw new LedgerError('LEDGER_UNKNOWN_JOURNAL', `journal inconnu : ${id}.`);
    }
    return row;
  }

  private async genesisOf(journal: JournalRow): Promise<string> {
    const rows = await this.query<{ previous_entry_hash: string }>(
      `SELECT previous_entry_hash FROM journal_entries WHERE journal_id = ? AND status = 'POSTED' AND previous_entry_hash LIKE ? LIMIT 1`,
      [journal.id, `${GENESIS_PREFIX}%`],
    );
    return rows[0]?.previous_entry_hash ?? `${GENESIS_PREFIX}00000000000000000000000000000000`;
  }

  private async resolveAccountByVatRole(role: string): Promise<string> {
    const rows = await this.query<{ account_number: string }>('SELECT account_number FROM cgnc_accounts WHERE vat_regime_role = ? ORDER BY account_number', [role]);
    if (rows.length !== 1 || rows[0] === undefined) {
      throw new LedgerError('LEDGER_VAT_ACCOUNT_UNRESOLVED', `${rows.length} compte(s) portent le rôle ${role} : un seul est attendu.`);
    }
    return rows[0].account_number;
  }
}

function ensureAmount(value: unknown, label: string): number {
  try {
    return ensureSafeInteger(value, label);
  } catch (error) {
    throw new LedgerError('LEDGER_INVALID_AMOUNT', `${label} : ${error instanceof Error ? error.message : String(error)}`);
  }
}

function wrapFsmReversal<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof FsmTransitionError) {
      const code = error.code === 'FSM_REVERSAL_REQUIRES_POSTED' ? 'LEDGER_REVERSAL_REQUIRES_POSTED' : 'LEDGER_FSM_REJECTED';
      throw new LedgerError(code, error.message, { fsmCode: error.code });
    }
    throw error;
  }
}

interface AuditEvent {
  readonly id: string;
  readonly entityTable: FsmEntityTable;
  readonly entityId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly actorKind: ActorKind;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly proofRef: string;
  readonly createdAtIso: string;
}

/**
 * INSERT dans `state_transition_audit` dont `from_state` (NOT NULL) vaut NULL tant que la garde n'est pas satisfaite : garde
 * propre à la transition ET absence de toute trace antérieure de la même transition. Placé en DERNIER dans le lot, il annule
 * tout si la transition n'a pas eu lieu (concurrence), sur SQLite comme sur PostgreSQL.
 */
function guardedAudit(audit: AuditEvent, guard: { readonly guardSql: string; readonly guardParams: readonly SqlParam[] }): SqlStatementParams {
  return {
    sql: `INSERT INTO state_transition_audit (id, entity_table, entity_id, from_state, to_state, actor_kind, actor_id, idempotency_key, proof_ref, created_at)
          SELECT CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT),
                 CASE WHEN ${guard.guardSql}
                       AND NOT EXISTS (SELECT 1 FROM state_transition_audit WHERE entity_table = ? AND entity_id = ? AND from_state = ? AND to_state = ?)
                      THEN CAST(? AS TEXT) ELSE NULL END,
                 CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT)`,
    params: [
      audit.id,
      audit.entityTable,
      audit.entityId,
      ...guard.guardParams,
      audit.entityTable,
      audit.entityId,
      audit.fromState,
      audit.toState,
      audit.fromState,
      audit.toState,
      audit.actorKind,
      audit.actorId,
      audit.idempotencyKey,
      audit.proofRef,
      audit.createdAtIso,
    ],
  };
}
