/** Traduction des erreurs typées POS en ProblemDetails : textes constants, jamais de valeur du ticket, de l'ICE ni du jeton. */
import { PosError, type PosErrorCode } from '@fisca/ubl-xades/pos';
import { ProblemError, type ProblemInput } from '../../core/problem-details.ts';

const fixed = (status: number, errorCode: string, title: string, detail: string): ProblemInput => ({ status, errorCode, title, detail });

export const POS_PROBLEMS: Readonly<Record<PosErrorCode, ProblemInput>> = {
  POS_FIELDS_INVALID: fixed(422, 'POS_FIELDS_INVALID', 'Champs invalides', 'Les champs du lot ne respectent pas le contrat POS.'),
  POS_SIGNATURE_FORMAT_UNKNOWN: fixed(422, 'POS_SIGNATURE_FORMAT_UNKNOWN', 'Format de signature inconnu', 'Le format de la signature est inconnu.'),
  POS_TERMINAL_KEY_INVALID: fixed(503, 'POS_TERMINAL_KEY_INVALID', 'Clé de terminal indisponible', "La clé publique du terminal est inutilisable : contactez le support."),
  POS_TERMINAL_UNKNOWN: fixed(403, 'POS_TERMINAL_UNKNOWN', 'Terminal non autorisé', "Ce terminal n'est pas autorisé pour ce dossier."),
  POS_TERMINAL_INACTIVE: fixed(403, 'POS_TERMINAL_INACTIVE', 'Terminal désactivé', 'La licence de ce terminal est désactivée.'),
  POS_TERMINAL_COMPANY_MISMATCH: fixed(403, 'POS_TERMINAL_UNKNOWN', 'Terminal non autorisé', "Ce terminal n'est pas autorisé pour ce dossier."),
  POS_BATCH_CONFLICT: fixed(409, 'POS_BATCH_CONFLICT', 'Conflit de synchronisation', 'Un identifiant ou une séquence existe déjà avec un contenu différent : le lot est refusé.'),
  POS_SYNC_UNAVAILABLE: fixed(503, 'POS_SYNC_UNAVAILABLE', 'Synchronisation indisponible', 'Aucun ticket du lot n’a été enregistré : réessayez.'),
  POS_TOKEN_UNKNOWN: fixed(404, 'POS_QR_NOT_FOUND', 'Ticket introuvable', 'Aucun ticket convertible ne correspond à ce code.'),
  POS_TICKET_ALREADY_CONVERTED: fixed(409, 'POS_TICKET_ALREADY_CONVERTED', 'Ticket déjà converti', 'Ce ticket a déjà été converti en facture.'),
  POS_TICKET_NOT_CONVERTIBLE: fixed(422, 'POS_TICKET_NOT_CONVERTIBLE', 'Ticket non convertible', 'Ce ticket ne peut pas être converti en facture.'),
  POS_Z_ENTRY_PENDING: fixed(409, 'POS_Z_ENTRY_PENDING', 'Clôture en cours de comptabilisation', 'La clôture du jour est en cours de comptabilisation : réessayez plus tard.'),
  POS_CLIENT_ICE_INVALID: fixed(422, 'POS_CLIENT_ICE_INVALID', 'ICE invalide', "L'ICE saisi est invalide."),
  POS_CONVERSION_FAILED: fixed(503, 'POS_CONVERSION_FAILED', 'Conversion indisponible', "La conversion n'a pas été enregistrée : réessayez."),
};

export function problemOfPos(error: PosError): ProblemError {
  const base = POS_PROBLEMS[error.code];
  return new ProblemError(error.issues.length === 0 ? base : { ...base, issues: error.issues.map((issue) => ({ path: issue.path, message: issue.code })) });
}

export async function translatedPos<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw error instanceof PosError ? problemOfPos(error) : error;
  }
}
