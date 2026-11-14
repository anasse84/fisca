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

/**
 * Limites CONNUES du profil provisoire de signature (hors PHIVE : aucune de ces limites n'est une règle EN 16931, donc aucune n'entre
 * dans KNOWN_PHIVE_DEVIATIONS). Liste unique, testée dans `tests/known-phive-deviations.test.ts` ; chaque ligne renvoie au README.
 * Elle ne dit rien de conformité : le profil est provisoire et non qualifié (ERRATA B-13).
 */
export interface KnownProfileLimitation {
  /** Identifiant stable de la limite. */
  readonly id: string;
  /** Énoncé de la limite, en une phrase. */
  readonly statement: string;
  /** Comportement du paquet face à cette limite. */
  readonly behavior: string;
}

export const KNOWN_PROFILE_LIMITATIONS: readonly KnownProfileLimitation[] = [
  {
    id: 'SIGNING_CERTIFICATE_V2_REFUSED_BY_XSD',
    statement:
      'xades:SigningCertificateV2 (EN 319 132-1, IssuerSerialV2) est refusé par le XSD OASIS UBL 2.1 vendorisé (UBL-XAdESv132-2.1.xsd ne définit que SigningCertificate) ; xmllint le refuse.',
    behavior: 'xades:SigningCertificate (V1, condensé SHA-256 et ds:X509IssuerSerial) est émis par défaut ; SigningCertificateV2 reste une option explicite, non validée au XSD.',
  },
  {
    id: 'SERIAL_NUMBER_OVER_24_DIGITS_REFUSED_BY_XMLLINT',
    statement:
      'Un numéro de série de certificat de plus de 24 chiffres décimaux dans ds:X509SerialNumber (xs:integer, non borné dans le schéma) est refusé par xmllint (libxml2 2.10.x : 24 chiffres valides, 25 refusés).',
    behavior: 'signUblXades échoue fermé avec UBL_SIGNATURE_SERIAL_UNSUPPORTED ; l’option allowLongSerialNumber émet le XML malgré tout (non validé par xmllint).',
  },
  {
    id: 'PADES_CLASSIC_XREF_ONLY',
    statement: 'PAdES : xref classique seulement ; un PDF à flux xref ou à flux d’objets (PDF/A-3b Factur-X courant) n’est pas pris en charge.',
    behavior: 'Échec fermé PDF_UNSUPPORTED_STRUCTURE.',
  },
  {
    id: 'RFC3161_PARTIAL_CHECK',
    statement: 'Contrôle RFC 3161 partiel : structure, empreinte, nonce et genTime seulement ; signature de la TSA, chaîne de certification et révocation non évaluées.',
    behavior: 'Le résultat de vérification porte trust = NOT_EVALUATED ; aucun horodatage n’est présenté comme qualifié.',
  },
  {
    id: 'FACTURX_EMBEDS_UBL_NOT_CII',
    statement:
      'Factur-X : UBL embarqué en ubl-invoice.xml, fx:ConformanceLevel=UBL21-PROVISIONAL (valeur non standard) ; écart avec le standard Factur-X qui exige CII.',
    behavior: 'Profil provisoire : le PDF produit n’est pas présenté comme un Factur-X standard ; aucune conformité Factur-X n’est revendiquée.',
  },
];
