/**
 * Port `ClearanceGateway` vers la passerelle nationale xHub (Doc_17 § 07, ERRATA B-13 révisé le 2026-11-13).
 *
 * Aucun point d'accès, en-tête ni code retour xHub n'est défini : ni la DGI ni xHub n'ont publié de spécification technique (B-13).
 * Seul le pilote `simulated` est livré ; aucun pilote `live` n'existe. Tout ce qui dépasse Doc_07 / Doc_17 est marqué « hypothèse ».
 * Les messages d'erreur sont constants : jamais de contenu de facture ni de donnée personnelle.
 */

/** Seul mode livré (B-13). Un mode `live` ne sera ajouté qu'à la parution des spécifications officielles. */
export type ClearanceGatewayMode = 'simulated';

/** État affiché tant que seul le pilote `simulated` existe (AGENTS.md § 4 : jamais « certifiée DGI »). */
export const SIMULATED_DISPLAY_STATE = 'Validation simulée' as const;

const DISPLAY_STATE_OF_MODE: Readonly<Record<ClearanceGatewayMode, typeof SIMULATED_DISPLAY_STATE>> = { simulated: SIMULATED_DISPLAY_STATE };

export function displayStateOfGateway(mode: ClearanceGatewayMode): typeof SIMULATED_DISPLAY_STATE {
  return DISPLAY_STATE_OF_MODE[mode];
}

/** Données de soumission : identifiants techniques seulement (hypothèse : le contrat réel de métadonnées xHub est inconnu). */
export interface ClearanceSubmitMetadata {
  readonly invoiceId: string;
  /** SHA-256 hexadécimal minuscule du XML signé soumis. */
  readonly xmlSha256: string;
  /** Clé de dédoublonnage = invoiceId + sha256 du XML (hypothèse : xHub n'est pas supposé la reconnaître ; le pilote simulé oui). */
  readonly idempotencyKey: string;
}

export interface ClearanceReceipt {
  readonly xhubUuid: string;
  /** Instant ISO 8601 UTC de réception. */
  readonly receivedAt: string;
}

export type ClearanceGatewayErrorKind = 'transient' | 'permanent';

/** Erreur typée : `transient` (réseau, 5xx, délai dépassé → réessai) ou `permanent` (rejet métier → aucun réessai). */
export class ClearanceGatewayError extends Error {
  readonly kind: ClearanceGatewayErrorKind;
  /** Code court sans donnée personnelle (hypothèse : format libre, car aucun code xHub n'est publié). */
  readonly code: string;

  constructor(kind: ClearanceGatewayErrorKind, code: string) {
    super(`CLEARANCE_GATEWAY_${kind === 'transient' ? 'TRANSIENT' : 'PERMANENT'}: ${code}`);
    this.name = 'ClearanceGatewayError';
    this.kind = kind;
    this.code = code;
  }
}

export const CLEARANCE_ERROR_CODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export type ClearanceRemoteStatus =
  | { readonly state: 'RECEIVED'; readonly xhubUuid: string }
  | { readonly state: 'REJECTED'; readonly xhubUuid: string; readonly code: string }
  | { readonly state: 'UNKNOWN' };

/** Statuts CDV que Fisca émet vers xHub (Doc_07 § 02 ligne 40). */
export const CDV_EMITTABLE_STATUSES = ['APPROUVEE', 'EN_LITIGE_SUSPENDUE', 'ENCAISSEE'] as const;
export type CdvEmittableStatus = (typeof CDV_EMITTABLE_STATUSES)[number];

/** Émission d'un statut CDV. HYPOTHÈSE : contrat de métadonnées inconnu (B-13) ; identifiants techniques et motif libre court seulement. */
export interface CdvEmissionMetadata {
  readonly invoiceId: string;
  readonly xhubUuid: string;
  readonly status: CdvEmittableStatus;
  /** Motif libre (HYPOTHÈSE : transmis tel quel, 500 caractères au plus) ; jamais journalisé. */
  readonly reason?: string;
  /** Dédoublonnage : `cdv:{invoiceId}:{status}` (le pilote simulé le reconnaît ; xHub : inconnu). */
  readonly idempotencyKey: string;
}

export interface CdvEmissionReceipt {
  /** Instant ISO 8601 UTC de prise en compte. */
  readonly emittedAt: string;
}

export interface ClearanceGateway {
  readonly mode: ClearanceGatewayMode;
  /** Soumet le XML signé. Lève `ClearanceGatewayError` (transitoire ou permanente). */
  submit(invoiceXmlSigned: string, metadata: ClearanceSubmitMetadata): Promise<ClearanceReceipt>;
  getStatus(xhubUuid: string): Promise<ClearanceRemoteStatus>;
  /** Émet un statut CDV vers xHub (HYPOTHÈSE : aucune méthode xHub publiée). Lève `ClearanceGatewayError`. */
  emitCdv(metadata: CdvEmissionMetadata): Promise<CdvEmissionReceipt>;
}
