/**
 * Erreurs typées du moteur AST (échec fermé, ADR-04) : aucune valeur par défaut n'est jamais substituée.
 * Chaque erreur porte un code stable, un message commençant par ce code et un détail lisible par machine.
 */
export const FISCAL_AST_ERROR_CODES = [
  /** Aucune règle de ce code n'existe dans les lignes fournies. */
  'RULE_NOT_FOUND',
  /** Le code existe, mais aucune ligne n'est en vigueur à la date demandée (avant la première ou après la dernière). */
  'RULE_NOT_IN_FORCE',
  /** Trou de calendrier entre deux lignes du même code à la date demandée (ou dans la chronologie vérifiée). */
  'RULE_GAP',
  /** Deux lignes du même code sont en vigueur le même jour. */
  'RULE_OVERLAP',
  /** La ligne de règle elle-même est illisible : dates, JSON ou schéma d'AST invalides. */
  'RULE_ROW_INVALID',
  /** La règle trouvée n'est pas du genre attendu par l'évaluateur appelé. */
  'RULE_KIND_MISMATCH',
  /** Entrée de l'évaluateur absente, non entière, négative ou hors forme. */
  'INPUT_INVALID',
  /** Date illisible ou impossible au calendrier. */
  'DATE_INVALID',
  /** Taux de TVA absent de la liste de la règle en vigueur. */
  'VAT_RATE_NOT_ALLOWED',
  /** Taux de TVA interdit à partir de 2026 (ADR-04, ERRATA D-04). */
  'ADR_04_LF2026_VAT_VIOLATION',
  /** Résultat hors des entiers sûrs. */
  'ARITHMETIC_OVERFLOW',
] as const;

export type FiscalAstErrorCode = (typeof FISCAL_AST_ERROR_CODES)[number];

export class FiscalAstError extends Error {
  readonly code: FiscalAstErrorCode;
  readonly detail: string;

  constructor(code: FiscalAstErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'FiscalAstError';
    this.code = code;
    this.detail = detail;
  }
}
