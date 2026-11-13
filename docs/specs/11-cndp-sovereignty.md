<!--
ID canonique : Doc_11_CNDP_Souverainete   |   Fichier : docs/specs/11-cndp-sovereignty.md
Source : « Document 11 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_11_CNDP_Souverainete#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_11_CNDP_Souverainete »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 11 — Registre des Traitements CNDP, DPIA & Souveraineté des Données
Ce document établit le registre réglementaire des traitements de données à caractère personnel (Loi n° 09-08), l'analyse d'impact sur la vie privée (DPIA), le dossier de notifications CNDP (formulaires F211, F112, F115 et F118) ainsi que l'architecture d'homologation souveraine (Loi n° 05-20 et DNSSI de la DGSSI) de Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (siège social à Rabat, Maroc). Ses 12 sections nommées sont prêtes pour Hyperagent avec la portée Projet (Doc_11_CNDP_Souverainete).
## Section 01 — Qualification Juridique des Acteurs (Loi n° 09-08)
Conformément aux articles 1 et 23 de la Loi n° 09-08 relative à la protection des personnes physiques à l'égard du traitement des données à caractère personnel, SYNAPTIC SYSTEMS SARL AU agit sous deux qualifications juridiques distinctes et cloisonnées :
- Responsable de Traitement (Data Controller) : Pour la gestion des comptes utilisateurs SaaS, l'authentification, le contrôle KYB des dirigeants, la facturation des abonnements, la prospection commerciale et la sécurité de la plateforme.
- Sous-Traitant (Data Processor — Art. 23 Loi 09-08) : Pour l'ensemble des documents comptables, factures, journaux, déclarations État 9421, DRVT et tickets Fisca POS traités exclusivement sur instruction documentée des entreprises clientes et cabinets fiduciaires.
- Gouvernance DPO interne : SYNAPTIC SYSTEMS SARL AU désigne un Correspondant à la Protection des Données inscrit auprès de la CNDP à Rabat via le formulaire F115 et joignable à l'adresse dédiée dpo@fisca.ma.
- Principe Privacy-by-Design : Toute donnée personnelle stockée dans une base locataire est isolée par société, chiffrée au niveau applicatif et systématiquement anonymisée en mémoire vive avant tout appel IA externe.

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                   DOUBLE QUALIFICATION LOI N° 09-08 (CNDP RABAT)                     │
│                                                                                      │
│  1. SYNAPTIC SYSTEMS = RESPONSABLE DE TRAITEMENT (Control Plane)                     │
│     • Comptes SaaS, 2FA, KYB Dirigeants, Facturation Payzone/SIMT, Logs Sécurité     │
│     • Déclarations propres déposées par SYNAPTIC SYSTEMS (F211 + F112 + F115 + F118) │
│                                                                                      │
│  2. ENTREPRISE CLIENTE / CABINET OEC = RESPONSABLE | SYNAPTIC = SOUS-TRAITANT        │
│     • Tiers B2B/PP, Salariés État 9421, Bailleurs DRVT, Clients POS B2C->B2B         │
│     • Encadré par le Contrat DPA Art. 23 + Kit CNDP pré-rempli généré par Fisca      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## Section 02 — Cartographie des Données Personnelles (PII) & Registre des Traitements
Le registre interne maintenu par SYNAPTIC SYSTEMS SARL AU recense six traitements structurés couvrant l'ensemble du périmètre fonctionnel de Fisca :

| Réf. | Finalité du Traitement | Rôle SYNAPTIC | Catégories de PII Collectées | Régime CNDP |
|---|---|---|---|---|
| T-01 | Gestion des comptes SaaS, OAuth et 2FA | Responsable | Nom, email, téléphone +212, IP, journaux | Déclaration F211 |
| T-02 | Vérification KYB dirigeants et Loi 43-20 | Responsable | CNIE/CIN gérant, RC Modèle J, RIB, certificat | Autorisation F112 |
| T-03 | Facturation abonnements et recouvrement | Responsable | Contacts facturation, jeton Payzone, RIB SIMT | Déclaration F211 |
| T-04 | Scoring IA solvabilité et authenticité KYB | Responsable | Dirigeants publics OMPIC, métadonnées PDF | Autorisation F112 |
| T-05 | Tenue CGNC, xHub, POS, DRVT (Clients) | Sous-traitant | Noms PP, ICE, IF, adresses, téléphones WhatsApp | DPA Art. 23 + F211 |
| T-06 | Déclaration annuelle Paie État 9421 | Sous-traitant | Nom, CNIE/CIN, CNSS, PPR, famille, salaires | DPA Art. 23 + F112 |

- Exclusion stricte des données bancaires cartes : Aucun numéro PAN ni cryptogramme CVV n'est collecté par Fisca ; Payzone opère en redirection/iframe certifiée PCI-DSS et ne restitue qu'un jeton opaque.
- Justification du régime d'autorisation préalable F112 : En droit marocain (Article 12 de la Loi 09-08), tout traitement utilisant le numéro de la Carte Nationale d'Identité Électronique (CNIE) ou opérant un scoring automatisé relève d'une demande d'autorisation préalable F112 et non d'une simple déclaration F211.
## Section 03 — Résidence des Données, Juridiction UE (Art. 43) & Sous-Traitants Ultérieurs
Pour les offres standard PME, Fiduciaires et Corporate, l'hébergement primaire s'appuie sur la liste officielle des États assurant un niveau de protection suffisant établie par la Délibération CNDP n° 236-2015 (incluant tous les États membres de l'Union Européenne) :

| Sous-Traitant Ultérieur | Rôle Technique | Localisation Physique Verrouillée | Garanties Légales & Techniques |
|---|---|---|---|
| Cloudflare (D1 & R2) | Bases SQLite & Coffre WORM | Union Européenne (weur / eu) | Adéquation Art. 43 + DPA + Chiffrement |
| Amazon Web Services | Emailing SES & ingestion | UE (Paris eu-west-3 / Francfort) | Adéquation Art. 43 + TLS + Zéro stockage |
| Infobip Maroc / UE | WhatsApp Business & SMS FISCA | Interconnexion Casablanca + UE | Filiale Maroc + DPA + Purge message |
| Payzone (Maroc) | Paiement cartes & abonnements | Royaume du Maroc | Agréé Bank Al-Maghrib & PCI-DSS |
| Barid eSign (Al Barid) | HSM Signature Loi 43-20 & TSA | Royaume du Maroc | PSCE qualifié DGSSI (seul le hash transite) |
| Hébergeur Miroir / OIV | Réplication PRA & Souverain | Royaume du Maroc (Casa / Rabat) | 100 % territoire national (Loi 05-20) |

- Verrouillage technique de juridiction : Dans wrangler.toml, le paramètre jurisdiction = "eu" sur R2 garantit contractuellement et matériellement que les objets chiffrés ne quittent jamais les centres de données de l'Union Européenne, tandis que la réplication asynchrone alimente le serveur miroir situé au Maroc.
- Encadrement de l'option Google Sign-In : L'authentification OIDC Google ne transmet que l'identifiant technique de connexion (sub, email et nom) à l'initiative expresse de l'utilisateur (exception de l'Article 44 de la Loi 09-08 combinée au dossier F118).
## Section 04 — Dossier Prêt-à-Déposer auprès de la CNDP (F115, F211, F112 & F118)
Avant l'ouverture commerciale publique de fisca.ma, SYNAPTIC SYSTEMS SARL AU dépose séquentiellement auprès de la CNDP (Hay Riad, Rabat) les quatre dossiers réglementaires suivants :
- Étape 1 — Formulaire F115 (Registre Public & Désignation) : Déclaration de l'entité juridique SYNAPTIC SYSTEMS SARL AU (RC Rabat, ICE, IF) et désignation officielle du responsable de la conformité Loi 09-08.
- Étape 2 — Formulaires F211 (Déclarations Normales T-01 et T-03) : Notification de la gestion des comptes abonnés, de la facturation SaaS et du support client accompagnée des mentions d'information bilingues Français/Arabe.
- Étape 3 — Formulaires F112 (Autorisations Préalables T-02 et T-04) : Dépôt du dossier d'autorisation préalable justifiant la collecte de la CNIE du représentant légal (lutte contre l'usurpation d'ICE sur xHub DGI) et l'algorithme explicable de scoring documentaire KYB, accompagné des contrats types de sous-traitance et de l'architecture de chiffrement E2EE.
- Étape 4 — Formulaire F118 (Transferts Internationaux Art. 43 & 44) : Déposé immédiatement après enregistrement des récépissés F211 et F112 (règle de recevabilité CNDP), documentant l'hébergement dans l'Union Européenne (Cloudflare EU, AWS SES EU, Infobip EU) assorti des Clauses Contractuelles Types signées.
- Fonctionnalité produit « Kit Conformité CNDP Client en 1 Clic » : Comme chaque entreprise cliente et chaque fiduciaire demeure responsable de ses propres fichiers RH (État 9421) et tiers (DRVT), Fisca génère automatiquement dans les paramètres du dossier une annexe technique pré-remplie (mesures de sécurité Art. 23, localisation UE/Maroc, durées de conservation) que le client joint directement à sa propre déclaration F211 ou F112.
## Section 05 — Analyse d'Impact sur la Protection des Données (DPIA / AIPD)
Une analyse d'impact complète évalue la gravité et la vraisemblance de chaque risque résiduel (cotation de 1 à 4 pour chaque axe, score brut maximal de 16) :

| Scénario de Risque Vie Privée | Score Brut | Mesures Techniques & Organisationnelles | Score Résiduel | Verdict |
|---|---|---|---|---|
| Accès illégitime aux salaires 9421 | 16 (Critique) | 1 base D1/société, _enc + AAD, attribut ABAC PII | 2 (Faible) | Validé |
| Fuite PII vers un fournisseur LLM | 12 (Élevé) | EphemeralRamPiiScrubber RAM + AI Gateway sans logs | 1 (Minimal) | Validé |
| Détournement d'accès ancien comptable | 12 (Élevé) | Révocation instantanée revoked_at dans tenant_key_grants | 1 (Minimal) | Validé |
| Usurpation de compte ou vol session | 12 (Élevé) | 2FA obligatoire OEC/DAF, Passkeys et Step-Up 300s | 2 (Faible) | Validé |
| Biais ou erreur du Scoring KYB | 9 (Modéré) | Règles déterministes explicables + revue humaine | 2 (Faible) | Validé |
| Indisponibilité ou perte d'archive | 12 (Élevé) | Double coffre R2 UE + Miroir Maroc + Shamir 2-sur-3 | 1 (Minimal) | Validé |

- Réexamen périodique de la DPIA : Toute modification du pipeline d'intelligence artificielle, ajout d'un sous-traitant ultérieur ou évolution réglementaire de la CNDP déclenche une révision versionnée de cette matrice.
## Section 06 — Articulation Légale : Droits Loi 09-08 vs Obligation Décennale Art. 211 CGI
Les personnes concernées disposent des droits d'information (Art. 5), d'accès (Art. 7), de rectification (Art. 8) et d'opposition pour motifs légitimes (Art. 9). Lorsqu'une demande porte sur des pièces comptables ou fiscales, le moteur applique l'arbitrage légal suivant :
- Droit d'accès (Art. 7 — Délai cible inférieur à 15 jours) : L'interface génère une archive JSON et PDF signée récapitulant toutes les données personnelles détenues sur le demandeur ainsi que l'historique des accès.
- Droit de rectification (Art. 8 vs Inaltérabilité Art. 145-I CGI) : Les coordonnées de la fiche tiers ou salarié sont mises à jour immédiatement pour l'avenir, mais les factures certifiées et écritures POSTED passées ne sont jamais réécrites ; le cas échéant, une pièce rectificative liée est émise afin de préserver la chaîne SHA-256.
- Droit d'opposition et de suppression (Art. 9 vs Conservation 10 ans Art. 211 CGI) : Le système purge immédiatement toute donnée non comptable (préférences marketing, historiques de conversation WhatsApp non liés à une pièce, brouillons non numérotés), mais place sous Verrouillage de Restriction Fiscal (pii_restricted_flag = 1) les enregistrements requis par le CGI (Factur-X, Grand Livre, État 9421, DRVT) jusqu'à l'expiration légale de 10 ans après clôture de l'exercice, suivie d'un effacement cryptographique automatique (Crypto-Shredding).
- Consentement et transparence sur le portail QR POS & WhatsApp : Lorsqu'un client scanne un ticket Fisca POS ou écrit au bot WhatsApp, un bandeau concis en 6 langues l'informe de la finalité fiscale, de l'identité du responsable de traitement et de l'adresse d'exercice de ses droits.
## Section 07 — Classification des Données selon le Référentiel DGSSI (Loi n° 05-20)
En cohérence avec la Loi n° 05-20 relative à la cybersécurité, la DNSSI et le guide national de classification des données publié par la DGSSI, chaque table et objet de Fisca porte un niveau de sensibilité explicite :

| Niveau DGSSI | Libellé de Classification | Données Fisca Concernées | Exigence d'Hébergement & Chiffrement |
|---|---|---|---|
| Niveau C1 | Public / Ouvert | Pages Astro fisca.ma, barèmes CGI du Wiki | Cache Edge mondial public, TLS 1.3 |
| Niveau C2 | Diffusion Interne | Métriques anonymisées, catalogues génériques | Stockage UE + Miroir Maroc chiffré |
| Niveau C3 | Sensible Entreprise | Factures PME, Grand Livre, État 9421, DRVT | 1 base D1 isolée UE + Miroir Maroc + E2EE |
| Niveau C4 | Sensible Souverain (OIV) | Comptabilité Banques, Assurances, OIV, État | 100 % Territoire Marocain + Zero-Egress |

## Section 08 — Architecture de l'Offre « Fisca Souverain » (100 % Maroc — Loi 05-20)
Pour les entités assujetties à la Loi n° 05-20, aux directives de Bank Al-Maghrib et au contrôle de l'ACAPS (contrat annuel ENT_SOUVERAIN à 140 000 MAD HT/an), Fisca bascule intégralement sur son architecture nationale sans aucun transit de données hors des frontières marocaines :
- Hébergement physique qualifié au Maroc : Déploiement sur infrastructure cloud souveraine située à Casablanca / Rabat (datacenters Tier III/IV au Maroc ou appliance privée sur site client) exécutant le pilote SOVEREIGN_MOROCCO_VPS (Node/Hono, PostgreSQL 16 haute disponibilité, MinIO WORM en mode Object Lock Compliance et Redis/BullMQ).
- Inférence IA Souveraine à Zéro-Egress : Aucun appel vers Workers AI ni API étrangère n'est émis ; l'extraction documentaire et les agents neuro-symboliques tournent localement au Maroc sur serveurs GPU dédiés via vLLM exécutant des modèles à poids ouverts audités par empreinte SHA-256 (Docling, Qwen2.5-VL et Nanonets-OCR-s auto-hébergés).
- Confiance cryptographique nationale : Chiffrement Zero-Knowledge E2EE obligatoire avec clés maîtresses conservées dans le HSM client au Maroc, signatures et horodatages qualifiés via Barid eSign (agréé DGSSI) et connectivité privée IPsec / MPLS vers l'ERP du grand compte.
- Dossier d'homologation DNSSI livré clé en main : SYNAPTIC SYSTEMS SARL AU remet au RSSI du client la matrice de conformité DNSSI, la nomenclature logicielle (SBOM CycloneDX signée), le rapport d'audit d'intrusion annuel par un prestataire qualifié (PASSI) et le connecteur Syslog temps réel vers son SOC.
## Section 09 — Protocole de Gestion des Violations de Données & Notification MACERT / CNDP
En cas de suspicion d'incident de sécurité affectant la confidentialité ou l'intégrité d'un dossier, une procédure chronométrée en quatre phases se déclenche immédiatement :
- T0 à T+1h (Confinement & Gel Forensique) : Révocation immédiate des jetons ou certificats suspects, isolation du conteneur ou du compte affecté et capture signée des journaux OpenTelemetry sans altération des preuves.
- T+1h à T+12h (Qualification d'Impact PII & OIV) : Identification précise des dossiers touchés et vérification cryptographique (si seules des enveloppes chiffrées Zero-Knowledge E2EE avec clé intacte côté client sont concernées, l'absence de lisibilité est prouvée mathématiquement).
- Moins de 24h (Alerte Client Sous-Traitant & MACERT DGSSI) : Notification circonstanciée au client Responsable de Traitement (conformément au contrat DPA) et, pour tout client relevant de la Loi n° 05-20, déclaration immédiate d'incident cyber auprès du MA-CERT (DGSSI).
- Moins de 72h (Notification CNDP & Remédiation) : Dépôt de la notification d'incident auprès de la CNDP (par SYNAPTIC SYSTEMS pour les traitements T-01 à T-04, ou en appui direct du client pour T-05 et T-06) suivi d'un post-mortem correctif intégré au harnais de tests.
## Section 10 — Gouvernance des Cookies, Traceurs & Mentions Légales Multilingues
- Zéro traceur publicitaire tiers : Ni le site public fisca.ma (Astro) ni l'application métier app.fisca.ma n'intègrent de pixels publicitaires tiers (pas de Meta Pixel, Google Ads ni courtiers de données), éliminant toute fuite du comportement financier des dirigeants marocains.
- Mesure d'audience respectueuse sans cookie intrusif : L'analyse de fréquentation du site vitrine repose sur une télémétrie agrégée sans suivi individuel inter-sites ; seuls les cookies techniques strictement nécessaires à la session authentifiée (HttpOnly, Secure, SameSite=Strict), à la langue choisie et à la protection anti-bot Turnstile sont déposés par défaut.
- Mentions d'information Loi 09-08 dans les 6 langues : Chaque formulaire d'inscription, page de contact, portail QR Fisca POS et premier message du bot WhatsApp affiche clairement l'identité de SYNAPTIC SYSTEMS SARL AU, la finalité, le numéro de récépissé/autorisation CNDP dès attribution et les modalités d'exercice des droits sur dpo@fisca.ma.
## Section 11 — Code de Référence : Garde Souveraine Loi 05-20 & Arbitre DSAR Loi 09-08 / CGI
Ce module TypeScript pur sans aucun type any (packages/compliance-cndp/src/privacy-sovereignty-engine.ts) verrouille matériellement le zéro-egress sur les dossiers souverains et résout automatiquement les demandes de suppression de données personnelles face à l'Article 211 du CGI :

```ts
import { z } from "zod";

export const SovereigntyPolicySchema = z.enum([
  "STANDARD_CNDP_EU_ADEQUACY",     // Offres PME, Fiduciaires & Corporate (UE Art. 43 + Miroir Maroc)
  "STRICT_DGSSI_LAW_05_20_MOROCCO" // Offre Fisca Souverain (100% Territoire Marocain, Zéro-Egress)
]);
export type SovereigntyPolicy = z.infer<typeof SovereigntyPolicySchema>;

export interface OutboundServiceTarget {
  readonly serviceName: string;
  readonly destinationCountryIso2: string; // Ex: 'MA', 'FR', 'DE', 'IE', 'US'
  readonly hasCndpF118Authorization: boolean;
  readonly carriesPersonalOrFiscalData: boolean;
}

// Liste des États UE/EEE reconnus adéquats (Délibération CNDP n° 236-2015) + Maroc
const CNDP_ADEQUATE_ISO2: ReadonlySet<string> = new Set([
  "MA", "FR", "DE", "IE", "NL", "BE", "ES", "IT", "LU", "PT", "AT", "SE", "FI", "DK"
]);

/**
 * 1. Coupe-circuit réseau déterministe : bloque tout flux non conforme à la Loi 09-08 ou à la Loi 05-20 (DGSSI)
 */
export function assertSovereignEgressAllowed(
  policy: SovereigntyPolicy,
  target: OutboundServiceTarget
): void {
  if (policy === "STRICT_DGSSI_LAW_05_20_MOROCCO") {
    if (target.destinationCountryIso2 !== "MA") {
      throw new Error(
        `DGSSI_LAW_05_20_EGRESS_BLOCKED: Flux vers [${target.serviceName}] (${target.destinationCountryIso2}) interdit en mode Souverain Maroc.`
      );
    }
    return;
  }

  if (!target.carriesPersonalOrFiscalData) {
    return;
  }

  const isAdequate = CNDP_ADEQUATE_ISO2.has(target.destinationCountryIso2);
  if (!isAdequate && !target.hasCndpF118Authorization) {
    throw new Error(
      `CNDP_ART_43_44_TRANSFER_BLOCKED: Transfert vers [${target.serviceName}] (${target.destinationCountryIso2}) interdit sans adéquation CNDP ou autorisation F118.`
    );
  }
}

/**
 * 2. Arbitre automatique Droit de Suppression (Art. 9 Loi 09-08) vs Conservation 10 ans (Art. 211 CGI)
 */
export interface SubjectRecordDescriptor {
  readonly recordId: string;
  readonly tableName: string;
  readonly category:
    | "MARKETING_OR_PREFERENCE"
    | "UNNUMBERED_DRAFT"
    | "POSTED_ACCOUNTING_OR_INVOICE"
    | "SIMPL_PAYROLL_9421_OR_DRVT";
  readonly fiscalYearClosedDateIso?: string; // YYYY-MM-DD
}

export interface DsarErasureDecision {
  readonly recordId: string;
  readonly action: "IMMEDIATE_HARD_DELETE" | "RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY";
  readonly legalBasis: string;
  readonly scheduledCryptoShredDateIso?: string;
}

export function evaluateCndpErasureAgainstCgiArt211(
  record: SubjectRecordDescriptor,
  nowDateIso: string
): DsarErasureDecision {
  if (record.category === "MARKETING_OR_PREFERENCE" || record.category === "UNNUMBERED_DRAFT") {
    return {
      recordId: record.recordId,
      action: "IMMEDIATE_HARD_DELETE",
      legalBasis: "Loi 09-08 Art. 9 — Aucune obligation fiscale de conservation applicable.",
    };
  }

  // Calcul de l'échéance décennale Art. 211 CGI : Clôture d'exercice + 10 ans + 1 jour
  const baseYear = record.fiscalYearClosedDateIso
    ? Number.parseInt(record.fiscalYearClosedDateIso.slice(0, 4), 10)
    : Number.parseInt(nowDateIso.slice(0, 4), 10);
  const expiryIso = `${baseYear + 10}-12-31`;

  if (nowDateIso > expiryIso) {
    return {
      recordId: record.recordId,
      action: "IMMEDIATE_HARD_DELETE",
      legalBasis: "Expiration du délai décennal Art. 211 CGI — Destruction cryptographique autorisée.",
    };
  }

  return {
    recordId: record.recordId,
    action: "RESTRICT_AND_SEAL_UNTIL_ART211_EXPIRY",
    legalBasis:
      "Primauté légale Art. 211 & 145-I CGI (conservation probante 10 ans) — Restriction d'accès appliquée.",
    scheduledCryptoShredDateIso: `${baseYear + 11}-01-01`,
  };
}
```

## Section 12 — Harnais d'Audit de Conformité CNDP & DGSSI (Rubric R2)
Lors de la Session S1A, de la Session P4-B et des Barrières QA, l'agent Fisca-QA-Security-Auditor vérifie automatiquement cinq assertions réglementaires bloquantes :
- Vérification statique de résidence UE dans wrangler.toml : Échoue immédiatement si un bucket R2 de production omet jurisdiction = "eu" ou si un connecteur SES pointe vers une région hors Union Européenne.
- Test Coupe-Circuit Souverain Loi 05-20 : Exécute une requête complète d'ingestion, d'imputation comptable et de génération XML sur un dossier configuré en STRICT_DGSSI_LAW_05_20_MOROCCO et vérifie que toute tentative d'appel sortant vers un domaine hors .ma / IP marocaine lève DGSSI_LAW_05_20_EGRESS_BLOCKED.
- Test Arbitrage DSAR Loi 09-08 vs Article 211 CGI : Simule une demande de suppression d'un salarié présent à la fois dans les préférences de notifications et dans l'État 9421 d'un exercice non prescrit ; vérifie la purge physique de la notification et le maintien scellé de la ligne État 9421 jusqu'à clôture + 10 ans + 1 jour.
- Contrôle Zéro-Tracker Tiers sur Astro & SaaS : Analyse les requêtes réseau sous Playwright sur fisca.ma et app.fisca.ma pour confirmer zéro appel vers des régies publicitaires ou polices externes Google Fonts.
- Présence des Mentions Loi 09-08 en 6 Langues : Vérifie dans les dictionnaires i18n l'existence non vide des clés légales CNDP et du contact dpo@fisca.ma sur les 6 langues publiques/PME et les 3 langues institutionnelles.
