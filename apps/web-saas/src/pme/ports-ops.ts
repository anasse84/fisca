/**
 * Ports injectables de la boîte d'achats, du rapprochement bancaire et du radar Loi 69-21 (T-P2B-08).
 *
 * ROUTES ABSENTES DU REGISTRE (aucune n'est devinée ; voir le rapport du ticket) :
 *  - lecture du relevé bancaire, des écritures ouvertes et des suggestions de rapprochement ;
 *  - liste des factures clients en retard / radar Loi 69-21 (calcul de pénalité côté serveur) ;
 *  - dépôt de preuves de litige (fichiers + empreinte SHA-256) et politique d'upload ;
 *  - CTR-API-21 / CTR-API-22 (ingestion, flux SSE) existent au registre à l'état DRAFT sans code serveur.
 * Aucune règle fiscale ici : retard, pénalité, gel, plafonds de fichier et modes de règlement arrivent des ports.
 * Montants en centimes entiers, scores en points de base entiers.
 */
import type { RecoverableTarget, UblPaymentCode } from './pme-api.ts';
import type { IsoDate } from './ports.ts';

// ---------------------------------------------------------------- rapprochement bancaire

/** Ligne du relevé importé. `amountCents` signé : positif = encaissement, négatif = décaissement. */
export interface BankStatementLine {
  readonly id: string;
  readonly valueDate: IsoDate;
  readonly label: string;
  readonly amountCents: number;
  /** Mode de règlement déduit de l'import ; absent : l'utilisateur le choisit parmi `BankContext.paymentMethods`. */
  readonly paymentMethodCode?: UblPaymentCode;
  readonly lcnBankCollectionDate?: IsoDate;
  readonly recoverableTarget?: RecoverableTarget;
}

/** Écriture de facture ouverte, candidate au lettrage (identifiant UUIDv7 du grand livre). */
export interface BankEntryCandidate {
  readonly invoiceEntryId: string;
  readonly reference: string;
  readonly partnerLabel: string;
  /** Reste dû en centimes (total TTC moins déjà réglé). */
  readonly openCents: number;
  readonly settledBeforeCents: number;
  readonly dueDate: IsoDate;
}

/** Suggestion fournie par le port (jamais calculée ici). `scoreBps` entier 0..10000. */
export interface ReconcileSuggestion {
  readonly bankTransactionId: string;
  readonly candidateEntryIds: readonly string[];
  readonly scoreBps: number;
}

/** Contexte comptable fourni par l'hôte pour le corps de CTR-API-12. */
export interface BankContext {
  readonly journalId: string;
  readonly fiscalYearId: string;
  /** Modes de règlement proposés à l'utilisateur quand la ligne n'en porte pas. */
  readonly paymentMethods: readonly UblPaymentCode[];
}

export interface BankWorkspace {
  readonly context: BankContext;
  readonly lines: readonly BankStatementLine[];
  readonly entries: readonly BankEntryCandidate[];
  readonly suggestions: readonly ReconcileSuggestion[];
}

export interface BankReconciliationSource {
  loadWorkspace(signal?: AbortSignal): Promise<BankWorkspace>;
}

// ---------------------------------------------------------------- radar Loi 69-21

export type DisputeStatus = 'none' | 'documented';

/** Facture cliente en retard : jours, pénalité et gel viennent du serveur (aucune règle de pénalité dans l'interface). */
export interface LateInvoice {
  readonly invoiceId: string;
  readonly number: string;
  readonly customerName: string;
  readonly dueDate: IsoDate;
  readonly amountDueCents: number;
  readonly daysLate: number;
  readonly penaltyCents: number;
  /** Décidé par le serveur selon le statut du litige : l'interface n'applique aucune logique de gel. */
  readonly penaltyFrozen: boolean;
  readonly disputeStatus: DisputeStatus;
}

export interface LateInvoiceRadar {
  readonly asOfDate: IsoDate;
  readonly invoices: readonly LateInvoice[];
}

export interface LateInvoiceRadarSource {
  loadRadar(signal?: AbortSignal): Promise<LateInvoiceRadar>;
}

/** Politique d'upload fournie par le port : aucune taille ni aucun type n'est écrit dans l'interface. */
export interface EvidencePolicy {
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly allowedMimeTypes: readonly string[];
}

export interface EvidenceFile {
  readonly file: File;
  /** SHA-256 hexadécimal minuscule (64 caractères) calculé côté client par WebCrypto. */
  readonly sha256Hex: string;
}

export type EvidenceOutcome =
  | { readonly ok: true; readonly disputeStatus: DisputeStatus; readonly penaltyFrozen: boolean }
  | { readonly ok: false; readonly errorCode: string };

/** Dépôt de preuves de litige. Aucune route au registre : à spécifier (rapport T-P2B-08). */
export interface DisputeEvidencePort {
  loadPolicy(signal?: AbortSignal): Promise<EvidencePolicy>;
  submitEvidence(invoiceId: string, files: readonly EvidenceFile[], signal?: AbortSignal): Promise<EvidenceOutcome>;
}
