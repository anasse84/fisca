/**
 * Ports de l'orchestration de certification (POST /invoices/:id/certify). Tous injectés : séquenceur, signataire, Factur-X, coffre,
 * Workflow, horloge. Aucune dépendance à Cloudflare, au réseau ou à une base dans ce dossier hors `sql-repository.ts`.
 */
import type { UblInvoiceInput } from '../generator/input.ts';
import type { UblTypeCode } from '../generator/invoice-number.ts';
import type { InvoiceRowForPih } from '../generator/pih.ts';

export interface CertifiableInvoice {
  readonly id: string;
  readonly clearanceState: string;
  readonly cdvLifecycleStatus: string;
  /** Colonnes de `invoices` lues par le tuple PIH (numéro, ICV et empreinte précédente NULL tant que BROUILLON). */
  readonly row: InvoiceRowForPih;
  readonly typeCode: UblTypeCode;
  readonly issueYear: number;
  /** `invoices.sha256_hash` : PIH (empreinte D-22) de la facture, posé à la signature. */
  readonly sha256Hash: string | null;
  readonly aipArchiveId: string | null;
}

export interface NumberingResult {
  readonly sequentialNumber: string;
  readonly icvCounter: number;
  /** PIH de la facture précédente de la série. */
  readonly previousPiHash: string;
}

export interface NumberingTransition {
  readonly invoiceId: string;
  readonly numbering: NumberingResult;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly auditId: string;
  readonly nowIso: string;
}

export interface SignedTransition {
  readonly invoiceId: string;
  /** PIH de la facture (colonne `sha256_hash`, hypothèse : l'empreinte D-22 y est stockée). */
  readonly piHash: string;
  readonly aipArchiveId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly auditId: string;
  readonly nowIso: string;
}

/** Persistance des deux transitions de certification (lots atomiques, verrou optimiste sur l'état attendu). */
export interface InvoiceCertificationRepository {
  load(invoiceId: string): Promise<CertifiableInvoice | null>;
  /** BROUILLON → NUMEROTEE_VERROUILLEE : écrit numéro, ICV, empreinte précédente et l'audit. Lève CERTIFY_CONCURRENT_UPDATE. */
  commitNumbered(input: NumberingTransition): Promise<void>;
  /** NUMEROTEE_VERROUILLEE → SIGNEE_LOI_43_20 : écrit `sha256_hash`, `aip_archive_id` et l'audit. */
  commitSigned(input: SignedTransition): Promise<void>;
}

export interface AllocateNumberInput {
  readonly invoiceId: string;
  readonly typeCode: UblTypeCode;
  readonly issueYear: number;
  readonly requestedAtIso: string;
}

/** Séquenceur (InvoiceSequencerDO) : attribution idempotente par `invoiceId`. */
export interface InvoiceNumberAllocator {
  allocate(input: AllocateNumberInput): Promise<NumberingResult>;
  /** Enregistre le PIH calculé comme tête de chaîne de la série (le séquenceur actuel n'offre pas cet appel : SEAM_REQUEST). */
  recordInvoiceHash(input: { readonly invoiceId: string; readonly piHash: string }): Promise<void>;
}

export interface UblInputSource {
  /** Entrée du générateur UBL pour la facture numérotée, parties déchiffrées côté serveur ; ICE émetteur et identifiant acheteur pour le PIH. */
  build(invoiceId: string, numbering: NumberingResult): Promise<{ readonly ublInput: UblInvoiceInput; readonly emitterIce15: string; readonly buyerIdentifier?: string }>;
}

export interface XadesSigningPort {
  /** Signe le XML (XAdES-BASELINE-T). Le contrôle OID/ICE-IF est bloquant dans le client CSC ; `CertifyError` n'est pas requise : toute erreur est reclassée. */
  sign(xml: string, signingTime: Date): Promise<{ readonly signedXml: string }>;
}

export interface FacturXPort {
  build(input: { readonly invoiceId: string; readonly ublInput: UblInvoiceInput; readonly signedXml: string }): Promise<Uint8Array>;
}

export interface ArchivedSigned {
  readonly signedXml: string;
  readonly aipArchiveId: string;
}

export interface CertificationArchivePort {
  /** Reprise : archive déjà écrite pour cette facture (coffre WORM : immuable), ou null. */
  findSigned(invoiceId: string): Promise<ArchivedSigned | null>;
  /** Écrit l'AIP (XML signé + PDF Factur-X) ; idempotent par `invoiceId`. */
  archive(input: { readonly invoiceId: string; readonly signedXml: string; readonly facturXPdf: Uint8Array; readonly xmlSha256: string }): Promise<{ readonly aipArchiveId: string }>;
}

export interface ClearanceWorkflowStarter {
  /** Démarre DgiClearanceWorkflow ; identifiant d'instance = `invoiceId`, donc idempotent (instance existante : même identifiant). */
  startClearanceWorkflow(input: { readonly invoiceId: string; readonly companyId: string; readonly xmlSha256: string; readonly requestedAtIso: string }): Promise<{ readonly instanceId: string }>;
}

export interface CertifyClock {
  nowIso(): string;
}

export interface CertifyIdSource {
  newId(): string;
}

export interface CertifyPorts {
  readonly repository: InvoiceCertificationRepository;
  readonly allocator: InvoiceNumberAllocator;
  readonly ublSource: UblInputSource;
  readonly signer: XadesSigningPort;
  readonly facturX: FacturXPort;
  readonly archive: CertificationArchivePort;
  readonly workflow: ClearanceWorkflowStarter;
  readonly clock: CertifyClock;
  readonly ids: CertifyIdSource;
}
