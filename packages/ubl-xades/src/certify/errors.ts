/** Erreurs typées de l'orchestration de certification. Messages constants : jamais de contenu de facture ni de donnée personnelle. */
export type CertifyErrorCode =
  | 'CERTIFY_INVOICE_NOT_FOUND'
  | 'CERTIFY_STATE_INVALID'
  | 'CERTIFY_CONCURRENT_UPDATE'
  | 'CERTIFY_INVOICE_DATA_INVALID'
  | 'CERTIFY_EMITTER_CERTIFICATE_MISMATCH'
  | 'CERTIFY_SOURCE_UNAVAILABLE'
  | 'CERTIFY_NUMBERING_UNAVAILABLE'
  | 'CERTIFY_SIGNATURE_UNAVAILABLE'
  | 'CERTIFY_FACTURX_UNAVAILABLE'
  | 'CERTIFY_ARCHIVE_UNAVAILABLE'
  | 'CERTIFY_WORKFLOW_UNAVAILABLE'
  | 'CDV_INVOICE_NOT_FOUND'
  | 'CDV_NOT_CLEARED'
  | 'CDV_TRANSITION_INVALID'
  | 'CDV_GATEWAY_REJECTED'
  | 'CDV_GATEWAY_UNAVAILABLE';

const MESSAGES: Readonly<Record<CertifyErrorCode, string>> = {
  CERTIFY_INVOICE_NOT_FOUND: 'Facture introuvable.',
  CERTIFY_STATE_INVALID: "L'état de la facture ne permet pas la certification.",
  CERTIFY_CONCURRENT_UPDATE: 'La facture a été modifiée en parallèle.',
  CERTIFY_INVOICE_DATA_INVALID: 'Les données de la facture sont invalides.',
  CERTIFY_EMITTER_CERTIFICATE_MISMATCH: "Le certificat de signature ne correspond pas à l'émetteur.",
  CERTIFY_SOURCE_UNAVAILABLE: 'Les données de la facture sont momentanément indisponibles.',
  CERTIFY_NUMBERING_UNAVAILABLE: 'Le séquenceur de numérotation est indisponible.',
  CERTIFY_SIGNATURE_UNAVAILABLE: 'Le service de signature est indisponible.',
  CERTIFY_FACTURX_UNAVAILABLE: 'Le service Factur-X est indisponible.',
  CERTIFY_ARCHIVE_UNAVAILABLE: "Le coffre d'archivage est indisponible.",
  CERTIFY_WORKFLOW_UNAVAILABLE: 'Le démarrage de la clearance est indisponible.',
  CDV_INVOICE_NOT_FOUND: 'Facture introuvable.',
  CDV_NOT_CLEARED: "La facture n'est pas déposée auprès de xHub.",
  CDV_TRANSITION_INVALID: 'Transition de statut CDV refusée.',
  CDV_GATEWAY_REJECTED: 'La passerelle a refusé le statut CDV.',
  CDV_GATEWAY_UNAVAILABLE: 'La passerelle xHub est indisponible.',
};

/** `issues` : chemins de champs en défaut (jamais de valeurs), repris dans `issues[]` de ProblemDetails. */
export interface CertifyIssue {
  readonly path: string;
  readonly code: string;
}

export class CertifyError extends Error {
  readonly code: CertifyErrorCode;
  readonly issues: readonly CertifyIssue[];

  constructor(code: CertifyErrorCode, issues: readonly CertifyIssue[] = []) {
    super(`${code}: ${MESSAGES[code]}`);
    this.name = 'CertifyError';
    this.code = code;
    this.issues = issues;
  }
}
