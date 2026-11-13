import type { FiscalAstErrorCode } from './errors.ts';

/**
 * Erreurs typées du compilateur Wiki-vers-AST (échec fermé, ADR-04) : chaque erreur porte un code stable
 * et un message qui commence par ce code. Aucune valeur fiscale par défaut n'est jamais substituée.
 */
export const WIKI_COMPILER_ERROR_CODES = [
  /** Le texte de la source n'est pas du JSON strict (ou contient une valeur non JSON). */
  'WIKI_SOURCE_MALFORMED',
  /** Une clé apparaît deux fois dans le même objet, ou un taux est répété dans une liste. */
  'WIKI_SOURCE_DUPLICATE_FIELD',
  /** La source ne respecte pas le schéma strict (champ absent, genre inconnu, valeur hors bornes). */
  'WIKI_SOURCE_SCHEMA_INVALID',
  /** Clé inconnue refusée par le schéma strict. */
  'WIKI_UNKNOWN_FIELD',
  /** Article de loi absent, vide ou blanc. */
  'WIKI_ARTICLE_MISSING',
  /** Date d'effet absente, illisible, impossible, ou fin antérieure au début. */
  'WIKI_DATE_INVALID',
  /** Taux de TVA absent de la liste admise à la date d'effet (ADR-04, ERRATA D-04). */
  'WIKI_VAT_RATE_NOT_ALLOWED',
  /** Montant, taux ou durée non entier, négatif ou hors des entiers sûrs. */
  'WIKI_AMOUNT_NOT_INTEGER',
  /** Identifiant de règle ou horloge fournis par l'appelant invalides. */
  'COMPILER_PARAMETER_INVALID',
  /** L'AST produit (ou la ligne fournie à la promotion) est refusé par les schémas de rule-ast. */
  'AST_INVALID',
  /** Transition de statut absente de la FSM du cycle de vie d'une règle. */
  'FSM_TRANSITION_REFUSED',
  /** Moins de cas de test que le minimum exigé pour la promotion. */
  'PROMOTION_CASES_INSUFFICIENT',
  /** Un cas de test est mal formé, répété ou vise un autre genre de règle. */
  'PROMOTION_CASE_INVALID',
  /** Au moins un cas exécuté contre le moteur échoue. */
  'PROMOTION_CASE_FAILED',
] as const;

export type WikiCompilerErrorCode = (typeof WIKI_COMPILER_ERROR_CODES)[number];

/** Résultat d'un cas exécuté (ou seulement listé quand la promotion est refusée avant exécution). */
export interface CaseOutcome {
  readonly caseId: string;
  readonly passed: boolean;
  readonly detail: string;
}

export class WikiCompilerError extends Error {
  readonly code: WikiCompilerErrorCode;
  readonly detail: string;
  /** Cas concernés, pour les refus de promotion ; vide pour les erreurs de compilation. */
  readonly caseOutcomes: readonly CaseOutcome[];
  /** Code d'erreur du moteur quand l'erreur enveloppe une FiscalAstError. */
  readonly engineCode: FiscalAstErrorCode | null;

  constructor(code: WikiCompilerErrorCode, detail: string, caseOutcomes: readonly CaseOutcome[] = [], engineCode: FiscalAstErrorCode | null = null) {
    super(`${code}: ${detail}`);
    this.name = 'WikiCompilerError';
    this.code = code;
    this.detail = detail;
    this.caseOutcomes = caseOutcomes;
    this.engineCode = engineCode;
  }
}
