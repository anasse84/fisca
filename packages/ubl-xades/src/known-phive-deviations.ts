/**
 * Écarts PHIVE (EN 16931) CONNUS du profil provisoire cius-ma-provisional : liste unique, source de vérité du contrôle croisé
 * (`tests/phive-crosscheck.test.ts`). Profil provisoire, écarts PHIVE connus : BR-CL-10, BR-CL-11, BR-CO-09, BR-CL-24 (ERRATA B-13).
 *
 * Retrait : à la parution du profil officiel, supprimer la constante (une ligne par règle) ; le test échoue tant qu'une règle de
 * la liste ne se produit plus, ou qu'une règle absente de la liste apparaît.
 */
export interface KnownPhiveDeviation {
  /** Identifiant de la règle EN 16931 signalée par PHIVE. */
  readonly ruleId: string;
  /** Raison de l'écart, en une phrase. */
  readonly reason: string;
  /** Ticket ou décision d'origine. */
  readonly origin: string;
}

export const KNOWN_PHIVE_DEVIATIONS: readonly KnownPhiveDeviation[] = [
  {
    ruleId: 'BR-CL-10',
    reason: 'Le mapping Doc_07 porte l’ICE et les identifiants sous des schemeID MA:*, absents de la liste de schémas d’identification d’EN 16931.',
    origin: 'T-P2A-02, mapping d’identifiants Doc_07 MA:* (ERRATA B-13)',
  },
  {
    ruleId: 'BR-CL-11',
    reason: 'Le mapping Doc_07 porte l’identifiant fiscal sous le schemeID MA:IF, absent de la liste de schémas d’EN 16931.',
    origin: 'T-P2A-02, mapping d’identifiants Doc_07 MA:* (ERRATA B-13)',
  },
  {
    ruleId: 'BR-CO-09',
    reason: 'L’identifiant TVA du vendeur (IF sans préfixe de pays) ne respecte pas le préfixe ISO 3166 exigé par EN 16931.',
    origin: 'T-P2A-02, mapping d’identifiants Doc_07 MA:* (ERRATA B-13)',
  },
  {
    ruleId: 'BR-CL-24',
    reason: 'L’empreinte PIH est jointe en text/plain, type MIME absent de la liste d’EN 16931.',
    origin: 'T-P2A-03, décision du pilote : PIH conservé en text/plain',
  },
];

/** Identifiants de règles, triés (comparaison directe avec la sortie PHIVE). */
export const KNOWN_PHIVE_DEVIATION_RULE_IDS: readonly string[] = KNOWN_PHIVE_DEVIATIONS.map((deviation) => deviation.ruleId).sort();
