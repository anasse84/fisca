/**
 * Erreurs typées de la logique POS (synchronisation hors-ligne, conversion QR B2C → B2B). Messages constants : jamais de contenu
 * de ticket, de jeton QR, d'ICE ni de raison sociale (aucune donnée personnelle dans les erreurs ni les journaux).
 */
export type PosErrorCode =
  | 'POS_FIELDS_INVALID'
  | 'POS_SIGNATURE_FORMAT_UNKNOWN'
  | 'POS_TERMINAL_KEY_INVALID'
  | 'POS_TERMINAL_UNKNOWN'
  | 'POS_TERMINAL_INACTIVE'
  | 'POS_TERMINAL_COMPANY_MISMATCH'
  | 'POS_BATCH_CONFLICT'
  | 'POS_SYNC_UNAVAILABLE'
  | 'POS_TOKEN_UNKNOWN'
  | 'POS_TICKET_ALREADY_CONVERTED'
  | 'POS_TICKET_NOT_CONVERTIBLE'
  | 'POS_Z_ENTRY_PENDING'
  | 'POS_CLIENT_ICE_INVALID'
  | 'POS_CONVERSION_FAILED';

const MESSAGES: Readonly<Record<PosErrorCode, string>> = {
  POS_FIELDS_INVALID: 'Champs de ticket ou de clôture invalides.',
  POS_SIGNATURE_FORMAT_UNKNOWN: 'Format de signature inconnu.',
  POS_TERMINAL_KEY_INVALID: 'Clé publique du terminal invalide.',
  POS_TERMINAL_UNKNOWN: 'Terminal inconnu.',
  POS_TERMINAL_INACTIVE: 'Terminal désactivé.',
  POS_TERMINAL_COMPANY_MISMATCH: "Le terminal n'appartient pas à ce dossier.",
  POS_BATCH_CONFLICT: 'Conflit : identifiant ou séquence déjà enregistré avec un contenu différent.',
  POS_SYNC_UNAVAILABLE: 'Synchronisation momentanément indisponible.',
  POS_TOKEN_UNKNOWN: 'Jeton inconnu ou expiré.',
  POS_TICKET_ALREADY_CONVERTED: 'Ticket déjà converti.',
  POS_TICKET_NOT_CONVERTIBLE: 'Ce ticket ne peut pas être converti.',
  POS_Z_ENTRY_PENDING: "L'écriture comptable du Ticket Z n'est pas encore comptabilisée.",
  POS_CLIENT_ICE_INVALID: 'ICE invalide.',
  POS_CONVERSION_FAILED: 'Conversion momentanément indisponible.',
};

/** `issues` : chemins de champs en défaut et codes, jamais de valeurs. */
export interface PosIssue {
  readonly path: string;
  readonly code: string;
}

export class PosError extends Error {
  readonly code: PosErrorCode;
  readonly issues: readonly PosIssue[];

  constructor(code: PosErrorCode, issues: readonly PosIssue[] = []) {
    super(`${code}: ${MESSAGES[code]}`);
    this.name = 'PosError';
    this.code = code;
    this.issues = issues;
  }
}
