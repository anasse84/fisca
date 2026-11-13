/**
 * Schémas Zod des routes REST v1 du socle comptable (ticket T-S1B-12 ; Doc_07 § 01, § 02, § 11).
 *
 * Réutilise les schémas gelés de `@fisca/shared-types` (`Ice15Schema` : 15 chiffres et clé modulo 97 ; `ProblemDetailsSchema`)
 * sans les redéfinir. Les schémas de requête et de réponse des quatre routes n'existent pas encore dans `api-contracts.ts` :
 * ils vivent ici (contrat créé par ce ticket) ; voir la demande de couture du rapport pour les y déplacer.
 * Zéro flottant : tous les montants sont des centimes entiers (`_cents`, ADR-03).
 */
import { z } from 'zod';
import { LEDGER_REVIEW_CYCLES, LEDGER_SOURCE_DOCUMENT_TYPES } from '@fisca/db-schema';
import { CentimesIntSchema, Ice15Schema, ProblemDetailsSchema, isReadableIsoDate } from '@fisca/shared-types';

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isReadableIsoDate, { message: 'Date calendaire AAAA-MM-JJ inexistante.' });

/** Identifiants du grand livre : UUIDv7 produits par le moteur (`LedgerIdSource`). */
const LedgerIdSchema = z.uuid({ version: 'v7' });

/** Enveloppe RFC 9457 : celle de shared-types (instance et issues[] y figurent depuis la PR n° 10), sans type local divergent. */
export const ProblemBodySchema = ProblemDetailsSchema;

// ---------------------------------------------------------------- GET /api/v1/directory/ice/:ice (CTR-API-10)

export const IceParamSchema = z.strictObject({ ice: Ice15Schema });

export const IceLookupResponseSchema = z.strictObject({
  ice: Ice15Schema,
  identifiantFiscal: z.string(),
  rcNumber: z.string().nullable(),
  rcTribunal: z.string().nullable(),
  raisonSocialeFr: z.string(),
  raisonSocialeAr: z.string().nullable(),
  legalForm: z.string().nullable(),
  shareCapitalCents: CentimesIntSchema.nullable(),
  addressAdc450: z.string(),
  verifiedCount: z.number().int().nonnegative(),
});
export type IceLookupResponse = z.infer<typeof IceLookupResponseSchema>;

// ---------------------------------------------------------------- POST /api/v1/ledger/entries/:id/post (CTR-API-11)

export const LedgerEntryParamSchema = z.strictObject({ id: LedgerIdSchema });

export const PostEntryRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('SEAL') }),
  z.strictObject({
    action: z.literal('REVERSE'),
    entryDate: IsoDateSchema,
    reasonText: z.string().trim().min(3).max(500),
    fiscalYearId: z.string().min(1).max(64).optional(),
    journalId: z.string().min(1).max(64).optional(),
  }),
]);
export type PostEntryRequest = z.infer<typeof PostEntryRequestSchema>;

const JournalEntryStateSchema = z.enum(['IA_PROPOSITION', 'DRAFT', 'REVISEE_CYCLE', 'POSTED']);

export const PostEntryResponseSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('SEAL'),
    entryId: z.string(),
    fromState: JournalEntryStateSchema,
    toState: JournalEntryStateSchema,
    replayed: z.boolean(),
    entryHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    previousEntryHash: z.string().optional(),
  }),
  z.strictObject({
    action: z.literal('REVERSE'),
    reversalEntryId: z.string(),
    reversalOfEntryId: z.string(),
    entryReference: z.string(),
    sequenceNumber: z.number().int().positive(),
    status: z.enum(['IA_PROPOSITION', 'DRAFT']),
  }),
]);
export type PostEntryResponse = z.infer<typeof PostEntryResponseSchema>;

// ---------------------------------------------------------------- POST /api/v1/ledger/entries (CTR-API-45)

const DraftLineRequestSchema = z.strictObject({
  accountNumber: z.string().min(1).max(32),
  debitCents: CentimesIntSchema.nonnegative(),
  creditCents: CentimesIntSchema.nonnegative(),
  description: z.string().max(500),
  auxiliaryAccount: z.string().min(1).max(64).nullable().optional(),
  isTaxDeductible: z.boolean().optional(),
  table3ReintegrationCode: z.string().min(1).max(32).nullable().optional(),
  reconciliationCode: z.string().min(1).max(64).nullable().optional(),
});

/** Le moteur arbitre tout le reste : équilibre, exercice, journal, comptes, types réservés (REVERSAL, VAT_CLEARING). */
export const CreateDraftRequestSchema = z.strictObject({
  journalId: z.string().min(1).max(64),
  fiscalYearId: z.string().min(1).max(64),
  entryDate: IsoDateSchema,
  reviewCycle: z.enum(LEDGER_REVIEW_CYCLES),
  sourceDocumentType: z.enum(LEDGER_SOURCE_DOCUMENT_TYPES),
  /** `POSTED` ne s'atteint que par le scellement (ERRATA D-03) : seuls les deux états préparatoires sont acceptés. */
  initialState: z.enum(['IA_PROPOSITION', 'DRAFT']).default('DRAFT'),
  lines: z.array(DraftLineRequestSchema).min(1).max(500),
  invoiceId: z.string().min(1).max(64).nullable().optional(),
  partnerId: z.string().min(1).max(64).nullable().optional(),
  dgiClearanceUuid: z.string().min(1).max(64).nullable().optional(),
});
export type CreateDraftRequest = z.infer<typeof CreateDraftRequestSchema>;

export const CreateDraftResponseSchema = z.strictObject({
  entryId: z.string(),
  entryReference: z.string(),
  sequenceNumber: z.number().int().positive(),
  status: z.enum(['IA_PROPOSITION', 'DRAFT']),
});
export type CreateDraftResponse = z.infer<typeof CreateDraftResponseSchema>;

// ---------------------------------------------------------------- POST /api/v1/ledger/entries/:id/submit (CTR-API-46)

/** Aucun champ : l'état de départ et l'acteur viennent du moteur et du jeton, jamais du corps. */
export const SubmitEntryRequestSchema = z.strictObject({});

export const SubmitEntryResponseSchema = z.strictObject({
  entryId: z.string(),
  fromState: JournalEntryStateSchema,
  toState: JournalEntryStateSchema,
  replayed: z.boolean(),
});
export type SubmitEntryResponse = z.infer<typeof SubmitEntryResponseSchema>;

// ---------------------------------------------------------------- POST /api/v1/ledger/entries/:id/visa (CTR-API-48)

/** Aucun champ : visa PIÈCE PAR PIÈCE (`engine.visaCycle`) ; ni code de cycle ni acteur dans le corps. */
export const VisaEntryRequestSchema = z.strictObject({});

export const VisaEntryResponseSchema = z.strictObject({
  entryId: z.string(),
  fromState: JournalEntryStateSchema,
  toState: JournalEntryStateSchema,
  replayed: z.boolean(),
});
export type VisaEntryResponse = z.infer<typeof VisaEntryResponseSchema>;

// ---------------------------------------------------------------- GET /api/v1/ledger/verify-chain (CTR-API-47)

export const VerifyChainQuerySchema = z.strictObject({ journalId: z.string().min(1).max(64) });

export const VerifyChainResponseSchema = z.strictObject({
  journalId: z.string(),
  valid: z.boolean(),
  length: z.number().int().nonnegative(),
  /** Première pièce dont l'empreinte ne se rejoue pas ; null si la chaîne est intacte ou si seule la tête du journal diverge. */
  brokenAtEntryId: z.string().nullable(),
});
export type VerifyChainResponse = z.infer<typeof VerifyChainResponseSchema>;

// ---------------------------------------------------------------- POST /api/v1/banking/reconcile (CTR-API-12)

export const UBL_PAYMENT_CODES = ['10_ESPECES', '20_CHEQUE', '30_VIREMENT', '42_EFFET_LCN', '48_CARTE', '97_COMPENSATION'] as const;

export const ReconcileRequestSchema = z.strictObject({
  bankTransactionId: z.string().min(1).max(64),
  journalId: z.string().min(1).max(64),
  fiscalYearId: z.string().min(1).max(64),
  entryDate: IsoDateSchema,
  paymentMethodCode: z.enum(UBL_PAYMENT_CODES),
  lcnBankCollectionDate: IsoDateSchema.optional(),
  recoverableTarget: z.enum(['VAT_RECOVERABLE_CHARGES', 'VAT_RECOVERABLE_IMMOB']).optional(),
  candidates: z
    .array(
      z.strictObject({
        invoiceEntryId: LedgerIdSchema,
        settledBeforeCents: CentimesIntSchema.nonnegative(),
      }),
    )
    .min(1)
    .max(20),
});
export type ReconcileRequest = z.infer<typeof ReconcileRequestSchema>;

export const ReconcileResponseSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('MATCHED_FULL'),
    bankTransactionId: z.string(),
    reconciliationCode: z.string(),
    invoiceEntryId: z.string(),
    clearingEntryId: z.string(),
    clearedCents: CentimesIntSchema,
  }),
  z.strictObject({
    outcome: z.literal('MATCHED_PARTIAL'),
    bankTransactionId: z.string(),
    reconciliationCode: z.string(),
    invoiceEntryId: z.string(),
    clearingEntryId: z.string(),
    clearedCents: CentimesIntSchema,
  }),
  z.strictObject({
    outcome: z.literal('SUSPENS_AMBIGU_3497_4497'),
    bankTransactionId: z.string(),
    reconciliationCode: z.string(),
    candidateCount: z.number().int().min(2),
  }),
  z.strictObject({ outcome: z.literal('NO_MATCH'), bankTransactionId: z.string() }),
]);
export type ReconcileResponse = z.infer<typeof ReconcileResponseSchema>;

// ---------------------------------------------------------------- GET /api/v1/health/deep (CTR-API-13)

export const HEALTH_DEPENDENCY_NAMES = ['control_plane_db', 'legal_vault'] as const;

export const HealthDeepResponseSchema = z.strictObject({
  status: z.enum(['UP', 'DOWN']),
  checkedAt: z.string(),
  dependencies: z.array(
    z.strictObject({ name: z.enum(HEALTH_DEPENDENCY_NAMES), status: z.enum(['UP', 'DOWN']), latencyMs: z.number().int().nonnegative() }),
  ),
});
export type HealthDeepResponse = z.infer<typeof HealthDeepResponseSchema>;
