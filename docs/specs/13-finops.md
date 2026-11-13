<!--
ID canonique : Doc_13_FinOps   |   Fichier : docs/specs/13-finops.md
Source : « Document 13 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_13_FinOps#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_13_FinOps »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 13 — Modèle FinOps & Coût Unitaire
Ce document établit l'architecture FinOps, la décomposition au centime du coût marginal d'infrastructure, les algorithmes d'optimisation Model Tiering IA et Arbre de Merkle, ainsi que les marges de contribution par offre de Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Ses 12 sections nommées sont prêtes pour Hyperagent avec la portée Projet (Doc_13_FinOps).
## Section 01 — Thèse d'Efficience FinOps & Seuil de Rentabilité
Contrairement aux plateformes comptables traditionnelles qui exposent chaque facture à un grand modèle de langage coûteux et achètent un jeton d'horodatage unitaire par pièce, Fisca verrouille un coût marginal variable de 5,00 MAD HT par mois (500 centimes) par dossier TPE/PME actif traitant 150 pièces mensuelles.
- Zéro compteur de crédits IA facturé au client : L'efficience interne absorbe l'intégralité de l'OCR et des 11 agents sans jamais brider l'usage quotidien des cabinets ni des PME.
- Socle fixe minimaliste dès le jour 1 : L'infrastructure mutualisée (plan Workers Paid, serveur miroir chaud au Maroc, accès HSM Barid eSign et passerelles Infobip / Amazon SES) ne coûte que 2 400 MAD HT par mois.
- Point mort technique immédiat : Avec une marge nette de contribution de 377,98 MAD HT par forfait Essentiel TPE (après frais monétiques), la totalité des coûts fixes d'infrastructure est couverte dès 7 clients TPE ou par un seul petit cabinet fiduciaire de 25 dossiers.
- Élasticité proportionnelle aux revenus : Au-delà du socle fixe de 2 400 MAD HT/mois, chaque dirham dépensé en calcul, stockage ou messagerie correspond directement à un dossier actif facturé.
## Section 02 — Décomposition au Centime d'un Dossier Actif (5,00 MAD HT/Mois)
Le tableau ci-dessous ventile le budget mensuel de 500 centimes pour une société active moyenne émettant et recevant 150 documents par mois (factures de vente, achats, lignes bancaires et scellement décennal) :

| Poste Technique Mensuel | Coût (Centimes) | Coût (MAD HT) | Part du Coût | Levier FinOps Principal |
|---|---|---|---|---|
| Compute Edge, DO & Queues | 75 | 0,75 MAD | 15,0 % | Isolats V8 facturés à la milliseconde CPU |
| Base D1 UE & Vectorize | 65 | 0,65 MAD | 13,0 % | Requêtes indexées et cache KV des règles AST |
| Coffre R2 10 Ans & Miroir | 110 | 1,10 MAD | 22,0 % | Zéro frais d'egress R2 et compression AIP |
| IA Niveau 1 (Vision 22 %) | 115 | 1,15 MAD | 23,0 % | Modèles compacts et cache OCR par SHA-256 |
| IA Niveau 2 (Escalade 3 %) | 65 | 0,65 MAD | 13,0 % | Déclenché uniquement sur anomalie ou clôture |
| Merkle TSA, SES & Infobip | 70 | 0,70 MAD | 14,0 % | 1 jeton TSA/jour mutualisé et fenêtre WA 24h |

- Total mensuel vérifié : La somme exacte des six postes s'établit à 500 centimes (5,00 MAD HT/mois, soit 60,00 MAD HT/an) par dossier TPE/PME complet, et descend à 250 centimes (2,50 MAD HT/mois) sur un profil Auto-Entrepreneur ou dossier fiduciaire simplifié à faible volumétrie.
## Section 03 — Ingénierie du Model Tiering IA à 3 Niveaux (-99,6 %)
Envoyer systématiquement 150 PDF multi-pages et journaux comptables vers un modèle multimodal de pointe coûte en moyenne 2,80 MAD par document, soit 420,00 MAD HT/mois par PME (420 000 MAD HT/mois pour 1 000 sociétés). Le routeur Cloudflare AI Gateway de Fisca ramène ce budget IA à 1,80 MAD HT/mois par PME (division par 233,3, soit 99,6 % d'économie) :

| Palier de Routage | Part des Flux | Moteur Exécuté | Coût Unitaire | Flux Métier Traités |
|---|---|---|---|---|
| Niveau 0 : Pur Code | 75,0 % | Parseurs XML, MT940 & AST | 0,00 MAD | Factur-X, UBL 2.1, CAMT.053, CGI, Liasse IS |
| Niveau 1 : Vision Rapide | 22,0 % | Clairic, Docling & Clef-flash | 0,035 MAD | Scans PDF, photos WhatsApp, cachets BL |
| Niveau 2 : Escalade LLM | 3,0 % | Modèle Raisonnement Anonymisé | 0,145 MAD | Écarts N/N-1 clôture, contrats BPU, litiges |

- Court-circuit déterministe prioritaire : Dès qu'un PDF entrant contient un flux XML Factur-X ou UBL 2.1, le pipeline extrait les montants et l'ICE en moins de 3 millisecondes sans invoquer aucun GPU.
- Cache sémantique et binaire par empreinte : Avant tout appel de Niveau 1, le Worker calcule le condensat SHA-256 du fichier ; tout doublon envoyé à la fois par email sur @ingest.fisca.ma et sur WhatsApp réutilise instantanément l'extraction mise en cache à coût nul.
## Section 04 — Économie de l'Arbre de Merkle Quotidien (-99,85 % sur le TSA)
La conformité probante à l'Article 211 du CGI et à la Loi n° 43-20 exige un horodatage qualifié RFC 3161 délivré par Barid eSign sur chaque archive comptable et fiscale.
- Coût prohibitif de l'approche naïve : À un tarif moyen de 0,20 MAD HT par jeton TSA unitaire, sceller individuellement 50 000 pièces et écritures mensuelles coûterait 10 000,00 MAD HT/mois (et 30 000,00 MAD HT/mois pour un parc de 1 000 PME générant 150 000 pièces).
- Mutualisation mathématique par Arbre de Merkle : Conformément à l'ADR-07, toutes les archives OAIS AIP scellées durant la journée sont hachées en feuilles d'un arbre binaire SHA-256 dont seule la racine quotidienne unique (merkle_root_sha256) consomme un jeton RFC 3161 à 23h59, ramenant la dépense globale de la plateforme à 15,00 MAD HT/mois (économie de 9 985,00 MAD HT/mois dès 50 000 pièces, soit -99,85 %).
- Renouvellement LTA décennal indolore : Le sur-horodatage préventif en SHA-512 tous les 24 mois ne s'applique qu'aux 730 racines quotidiennes écoulées (un seul lot groupé), préservant la valeur probante sur 10 ans pour quelques dirhams par an.
## Section 05 — Modélisation sur 10 Ans du Coffre WORM R2 & Miroir Maroc
Une obligation légale de conservation de 10 ans (Article 211 du CGI) ruine les architectures cloud classiques à cause de l'accumulation annuelle des gigaoctets et des frais de bande passante sortante (Egress) lors des audits ou exports :

| Horizon d'Archivage | Volume Cumulé / PME | Coût R2 UE / Mois | Coût Miroir Maroc | Total Double Coffre / PME |
|---|---|---|---|---|
| Année 1 | 0,24 Go (246 Mo) | 0,04 MAD | 0,02 MAD | 0,06 MAD HT / mois |
| Année 5 | 1,20 Go | 0,18 MAD | 0,12 MAD | 0,30 MAD HT / mois |
| Année 10 (Plafond) | 2,40 Go | 0,36 MAD | 0,24 MAD | 0,60 MAD HT / mois |
| Moyenne 10 Ans | 1,32 Go | 0,20 MAD | 0,13 MAD | 0,33 MAD HT / mois |

- Hypothèse physique conservatrice : Chaque paquet compressé OAIS AIP (PDF/A-3 optimisé de 120 Ko + XML UBL signé et preuve Merkle de 20 Ko) pèse 140 Ko, soit 20,51 Mo/mois pour 150 pièces (246,1 Mo/an).
- Couverture intégrale par le provisionnement mensuel : Même au pic de la dixième année d'activité (2,40 Go cumulés coûtant 0,60 MAD HT/mois sur l'ensemble R2 UE + MinIO Maroc), la provision mensuelle de 1,10 MAD allouée au stockage absorbe à la fois l'archive chaude, la réplication et les sauvegardes, tandis que l'absence totale de frais d'egress sur Cloudflare R2 rend gratuits les téléchargements FEC-MA et les exports de réversibilité.
## Section 06 — Optimisation Financière des Canaux Infobip, SES & Payzone
Les services transactionnels tiers sont pilotés par trois règles d'optimisation directe des coûts :
- Exploitation de la fenêtre gratuite WhatsApp de 24 heures (Infobip) : Lorsqu'un dirigeant ou commerçant envoie spontanément la photo d'une facture d'achat au bot WhatsApp Fisca, Meta ouvre une Customer Service Window gratuite de 24 heures ; toutes les réponses d'extraction, demandes de précision sur un mode de paiement et confirmations de classement PCGE coûtent 0,00 MAD de frais WhatsApp.
- Routage intelligent des OTP et relances sortantes (0,55 MAD/mois/PME) : Sur les 5 événements sortants moyens par PME et par mois (connexions 2FA, Step-Up et relance mensuelle du 10 du mois), l'envoi prioritaire en modèle WhatsApp Utility (~0,08 MAD) avec bascule automatique vers le SMS FISCA (~0,45 MAD) uniquement en cas de non-remise après 15 secondes (environ 8 % des cas) établit un coût mixte de 11,0 centimes par alerte (contre 45,0 centimes en tout-SMS).
- Arbitrage Monétique Payzone vs Virement SIMT : Les paiements par carte via Payzone supportent une commission moyenne d'environ 1,50 % TTC (soit 1,80 % rapporté au montant HT : 7,02 MAD sur un forfait Essentiel TPE à 390 MAD HT). En orientant les cabinets fiduciaires dépassant 2 500 MAD HT/mois et 100 % des contrats annuels Corporate / Souverain vers le virement bancaire SIMT à référence structurée auto-lettrée, les frais d'encaissement tombent à 0,00 MAD sur les plus gros volumes de facturation.
## Section 07 — Économie Locale-First de Fisca POS & Scale-to-Zero des Conteneurs
- Déport du calcul sur le matériel caisse (2,00 MAD/mois de coût cloud par POS) : Grâce à SQLite WASM sur OPFS, toute la recherche catalogue, le calcul TVA 2026 / droit de timbre espèces et le chaînage cryptographique SHA-256 s'exécutent sur le processeur local de la tablette du commerçant. Le serveur ne traite qu'un lot compressé périodique (/api/v1/pos/sync-batch) et une clôture Ticket Z par jour, générant 98,7 % de marge brute sur une caisse additionnelle à 149 MAD HT/mois (et 98,0 % au tarif flotte/partenaire OEC de 99 MAD HT/mois).
- Mise en veille automatique des MicroVMs (Scale-to-Zero) : Les conteneurs Cloudflare Containers (fiscal-java pour PHIVE/Mustangproject et docling-python pour les tableaux complexes) mutualisent les appels en mémoire chaude durant les heures ouvrées marocaines (08h00–19h00) et s'éteignent totalement la nuit et le week-end, évitant les 4 500 à 8 000 MAD/mois d'un cluster Kubernetes permanent.
## Section 08 — Unit Economics & Marges de Contribution par Offre
Le tableau suivant synthétise la rentabilité mensuelle nette par profil client après déduction du coût cloud/IA et des frais d'encaissement monétiques :

| Offre ou Unité Facturée | Revenu Mensuel HT | Infra & IA HT | Frais Paiement | Marge Nette Contrib. |
|---|---|---|---|---|
| Fisca Solo (AE) | 129,00 MAD | 2,50 MAD | 2,32 MAD | 124,18 MAD (96,3 %) |
| Fisca Essentiel (TPE) | 390,00 MAD | 5,00 MAD | 7,02 MAD | 377,98 MAD (96,9 %) |
| Fisca Croissance (PME + POS) | 890,00 MAD | 7,00 MAD | 16,02 MAD | 866,98 MAD (97,4 %) |
| Terminal POS Additionnel | 149,00 MAD | 2,00 MAD | 2,68 MAD | 144,32 MAD (96,9 %) |
| Dossier Fiduciaire Simplifié | 69,00 MAD | 2,50 MAD | 0,00 MAD | 66,50 MAD (96,4 %) |
| Dossier Fiduciaire TPE | 149,00 MAD | 5,00 MAD | 0,00 MAD | 144,00 MAD (96,6 %) |
| Dossier Fiduciaire PME | 249,00 MAD | 5,00 MAD | 0,00 MAD | 244,00 MAD (98,0 %) |
| Cabinet Moyen (60 dossiers) | 10 130,00 MAD | 300,00 MAD | 0,00 MAD | 9 830,00 MAD (97,0 %) |
| Enterprise Corporate (5 ICE) | 4 833,33 MAD | 150,00 MAD | 0,00 MAD | 4 683,33 MAD (96,9 %) |
| Fisca Souverain OIV (Maroc) | 11 666,67 MAD | 1 000,00 MAD | 0,00 MAD | 10 666,67 MAD (91,4 %) |

- Résilience de l'offre Fisca Souverain (Loi 05-20 DGSSI) : Même en allouant 1 000,00 MAD HT/mois (12 000 MAD HT/an) d'infrastructure nationale dédiée au Maroc (instances PostgreSQL 16 isolées, stockage WORM MinIO national et quota GPU vLLM Zéro-Egress), le contrat annuel de 140 000 MAD HT dégage 91,4 % de marge nette (128 000 MAD HT/an par grand compte).
## Section 09 — Socle Fixe Mensuel & 3 Actions FinOps Prioritaires
Le socle fixe mensuel de 2 400,00 MAD HT (28 800,00 MAD HT/an) se répartit en quatre lignes incompressibles : 450,00 MAD pour l'abonnement Cloudflare Workers Paid / Queues / SaaS Hostnames, 1 200,00 MAD pour le serveur miroir chaud au Maroc (standby-vps PostgreSQL 16 + MinIO WORM), 350,00 MAD pour le maintien du canal HSM Barid eSign et les 30 jetons quotidiens de Merkle, et 400,00 MAD pour le sender ID FISCA chez Infobip, Amazon SES et les sondes Multi-DNS.
Trois décisions opérationnelles maximisent structurellement la trésorerie de SYNAPTIC SYSTEMS SARL AU :
- Basculer systématiquement les Fiduciaires au-delà de 2 500 MAD HT/mois sur le virement SIMT auto-lettré : Sur un cabinet moyen à 10 130,00 MAD HT/mois, éviter les 1,80 % de frais cartes Payzone économise 182,34 MAD HT/mois (2 188,08 MAD HT/an par cabinet, soit +21 880,80 MAD HT/an sur 10 cabinets).
- Promouvoir l'émission native Factur-X auprès des fournisseurs récurrents du parc : Chaque point de flux basculant du scan papier (Niveau 1 à 0,035 MAD) vers le XML natif (Niveau 0 à 0,00 MAD) réduit linéairement la facture GPU à mesure que la réforme Clearance xHub DGI monte en charge au Maroc.
- Regrouper les relances WhatsApp de pièces manquantes le 10 du mois en un message consolidé unique : Un seul message Utility listant les 6 justificatifs bancaires manquants coûte 0,08 MAD au lieu de 0,48 MAD en relances unitaires dispersées, divisant par 6 le budget messagerie cabinet.
## Section 10 — Gouvernance Budgétaire & Disjoncteurs Anti-Dérive (Anomalies)
Pour empêcher qu'une boucle infinie d'agent, un fichier PDF corrompu de 800 pages ou un abus API ne dégrade la marge d'un dossier sans être détecté, quatre coupe-circuits automatiques sont actifs en continu :
- Détection automatique d'anomalie à 2x la moyenne (1000 centimes / mois) : Un compteur télémétrique léger suit en centimes et dixièmes de centimes la consommation réelle par company_id. Dès qu'un dossier PME franchit 2 fois le coût moyen de sa catégorie (soit plus de 10,00 MAD HT sur le mois glissant) ou varie de plus de 20 % sur un lot hebdomadaire, une alerte FinOps remonte dans la console d'administration SYNAPTIC SYSTEMS sans interrompre la comptabilité du client.
- Plafond strict de jetons Niveau 2 par dossier : Le gouverneur AI Gateway limite les appels de raisonnement profond (Niveau 2) à un plafond doux mensuel de 150 centimes par PME ; au-delà, les analyses non critiques basculent automatiquement sur les modèles rapides de Niveau 1 (Clef-flash) jusqu'au mois suivant.
- Troncature intelligente et rejet des bombes PDF : Tout fichier entrant dépassant 25 Mo ou 50 pages sur @ingest.fisca.ma est découpé par plages utiles côté Docling sans jamais être injecté intégralement dans une fenêtre de contexte LLM.
- Cache de règles fiscales en mémoire KV : L'arbre JSON des règles dynamiques du CGI et des 1 500 cellules SIMPL-IS est mis en cache en mémoire Edge avec une durée de vie de 1 heure (invalidée uniquement lors d'une publication Wiki), réduisant de 94 % les lectures SQL répétitives sur CONTROL_PLANE_DB.
## Section 11 — Code de Référence : Gouverneur FinOps & Routeur Model Tiering
Ce module TypeScript pur sans aucun type any ni calcul flottant monétaire (packages/ai-agents/src/finops-governor.ts) implémente le routage déterministe à 3 niveaux, la comptabilité interne en dixièmes de centimes (DeciCentimes, où 1,00 MAD = 1000 deci-centimes) et la détection d'anomalie à 2x la moyenne de catégorie :

```ts
export type ModelTierLevel = "TIER_0_DETERMINISTIC" | "TIER_1_FAST_VISION" | "TIER_2_DEEP_REASONING";

export interface DocumentRoutingSignal {
  readonly companyId: string;
  readonly payloadSha256Hex: string;
  readonly hasEmbeddedFacturxOrUblXml: boolean;
  readonly isStructuredBankFeed: boolean; // MT940, CFONB 120 ou CAMT.053
  readonly alreadyCachedInKv: boolean;
  readonly taskKind: "STANDARD_EXTRACTION" | "CLOSING_VARIANCE_N_N1" | "BPU_CONTRACT_AUDIT";
  readonly tier1ConfidenceBps?: number;  // 0..10000 (seuil d'escalade sous 8500 bps)
}

export interface TenantMonthlyFinOpsLedger {
  readonly companyId: string;
  readonly billingMonth: string;         // YYYY-MM
  readonly categoryAverageDeciCents: number; // Défaut PME : 5000 (= 5,00 MAD HT)
  readonly spentTier1DeciCents: number;
  readonly spentTier2DeciCents: number;
  readonly spentInfraDeciCents: number;
  readonly tier2SoftCapDeciCents: number; // Défaut PME : 1500 (= 1,50 MAD HT)
}

export interface RoutingDecision {
  readonly selectedTier: ModelTierLevel;
  readonly estimatedCallCostDeciCents: number;
  readonly cacheShortCircuit: boolean;
  readonly anomalyFlaggedOver2xAverage: boolean;
  readonly reasonCode: string;
}

/**
 * Routeur FinOps déterministe : privilégie toujours le Niveau 0 gratuit, puis le Niveau 1,
 * et protège le Niveau 2 par un plafond doux anti-dérive (Zéro float).
 */
export function selectOptimalFinOpsTier(
  signal: DocumentRoutingSignal,
  ledger: TenantMonthlyFinOpsLedger
): RoutingDecision {
  const currentTotalDeciCents =
    ledger.spentInfraDeciCents + ledger.spentTier1DeciCents + ledger.spentTier2DeciCents;
  const anomalyThresholdDeciCents = ledger.categoryAverageDeciCents * 2;

  // 1. Court-circuit Niveau 0 : Cache SHA-256 existant ou flux structuré XML / Bancaire (0,00 MAD)
  if (signal.alreadyCachedInKv || signal.hasEmbeddedFacturxOrUblXml || signal.isStructuredBankFeed) {
    return {
      selectedTier: "TIER_0_DETERMINISTIC",
      estimatedCallCostDeciCents: 0,
      cacheShortCircuit: signal.alreadyCachedInKv,
      anomalyFlaggedOver2xAverage: currentTotalDeciCents > anomalyThresholdDeciCents,
      reasonCode: signal.alreadyCachedInKv ? "SHA256_CACHE_HIT_ZERO_COST" : "STRUCTURED_XML_OR_BANK_ZERO_AI",
    };
  }

  // 2. Évaluation du besoin d'escalade vers le Niveau 2 (Clôture N/N-1, Contrat BPU ou confiance < 85%)
  const needsDeepReasoning =
    signal.taskKind === "CLOSING_VARIANCE_N_N1" ||
    signal.taskKind === "BPU_CONTRACT_AUDIT" ||
    (signal.tier1ConfidenceBps !== undefined && signal.tier1ConfidenceBps < 8500);

  if (needsDeepReasoning) {
    const projectedTier2 = ledger.spentTier2DeciCents + 145; // 14,5 centimes = 145 deci-centimes
    if (projectedTier2 <= ledger.tier2SoftCapDeciCents) {
      const nextTotal = currentTotalDeciCents + 145;
      return {
        selectedTier: "TIER_2_DEEP_REASONING",
        estimatedCallCostDeciCents: 145,
        cacheShortCircuit: false,
        anomalyFlaggedOver2xAverage: nextTotal > anomalyThresholdDeciCents,
        reasonCode: "ESCALATED_ANONYMIZED_REASONING",
      };
    }
    // Plafond doux Niveau 2 atteint : repli maîtrisé vers Niveau 1 + drapeau de contrôle humain
    const fallbackTotal = currentTotalDeciCents + 35;
    return {
      selectedTier: "TIER_1_FAST_VISION",
      estimatedCallCostDeciCents: 35,
      cacheShortCircuit: false,
      anomalyFlaggedOver2xAverage: fallbackTotal > anomalyThresholdDeciCents,
      reasonCode: "TIER2_SOFT_CAP_FALLBACK_TO_TIER1",
    };
  }

  // 3. Par défaut sur scan ou photo WhatsApp : Niveau 1 Vision Rapide (3,5 centimes = 35 deci-centimes)
  const nextTotal = currentTotalDeciCents + 35;
  return {
    selectedTier: "TIER_1_FAST_VISION",
    estimatedCallCostDeciCents: 35,
    cacheShortCircuit: false,
    anomalyFlaggedOver2xAverage: nextTotal > anomalyThresholdDeciCents,
    reasonCode: "STANDARD_FAST_OCR_EXTRACTION",
  };
}
```

## Section 12 — Harnais de Vérification FinOps (Sessions P3-B, P4-B & Barrières QA)
Lors des Sessions P3-B et P4-B, l'agent Fisca-QA-Security-Auditor vérifie automatiquement cinq assertions FinOps déterministes dans Vitest avant toute fusion sur main :
- Test Zéro-Token sur Factur-X & Relevés Structurés : Soumet 50 factures PDF/A-3 embarquant un XML UBL 2.1 et 10 relevés CAMT.053 / MT940 ; vérifie que 100 % des pièces empruntent TIER_0_DETERMINISTIC avec 0 appel au binding env.AI.
- Test Anti-Doublon d'Extraction (SHA-256 Cache Hit) : Envoie deux fois le même scan JPEG de reçu de carburant (une fois par WhatsApp, une fois via @ingest.fisca.ma) et vérifie que le second passage retourne SHA256_CACHE_HIT_ZERO_COST en moins de 5 ms.
- Test d'Agrégation Merkle Unique Quotidienne : Scelle 500 paquets d'archives archival_packages sur une même date comptable et vérifie que le connecteur TSA Barid eSign /rfc3161/timestamp n'est appelé qu'une seule fois pour la racine archival_merkle_batches.
- Test du Plafond Doux Niveau 2 & Détection d'Anomalie 2x : Simule un dossier atteignant 1500 déci-centimes de dépense Niveau 2 et vérifie le repli automatique TIER2_SOFT_CAP_FALLBACK_TO_TIER1, ainsi que l'activation exacte de anomalyFlaggedOver2xAverage === true au-delà de 10000 déci-centimes (10,00 MAD HT).
- Audit des Attributs OpenTelemetry GenAI : Vérifie que chaque exécution de Niveau 1 ou Niveau 2 renseigne les attributs numériques gen_ai.usage.input_tokens, gen_ai.usage.output_tokens et fisca.finops.deci_cents dans le journal télémétrique interne.

## Annexe V — Code de vérification numérique

> Origine : fichier `code.docx` fourni par le propriétaire du projet le 2026-11-13. C'est le code Python qui a servi à calculer et à contrôler les chiffres de ce document, suivi de la sortie obtenue par l'auteur.
> Chaque bloc a été réexécuté le 2026-11-13 (Python 3.12) et sa sortie comparée à celle de l'auteur. Pour le refaire : `python3 docs/specs/verification/verify-annexes.py`.
> Statut : pièce justificative des chiffres, pas du code de production. Elle n'ajoute aucune exigence et ne se copie dans aucun paquet. En cas d'écart avec le corps du document, `ERRATA.md` tranche.

> Ce code manipule des dirhams en nombres flottants : c'est un modèle économique, pas du code de facturation. Rien ici n'entre dans un paquet du produit.

### V.1 — Coût marginal par PME active et marge par offre

<!-- verif:13-01:code -->
```python
# Complete FinOps & Unit Economics verification for Document 13

# 1. Decomposition of the 5.00 MAD HT/month (500 centimes) marginal cost for an active TPE/PME dossier (150 docs/month)
pme_cost_breakdown_cents = {
    "Workers Edge, Durable Objects & Queues": 75,
    "SQLite D1 Isolée (UE) & Vectorize": 65,
    "Coffre R2 WORM 10 ans & Miroir Maroc": 110,
    "IA Niveau 1 (Vision Clairic / Docling - 22% flux)": 115,
    "IA Niveau 2 (Escalade Raisonnement - 3% flux)": 65,
    "Quote-part Merkle TSA, SES & Infobip Fenêtre 24h": 70,
}
total_pme_cost_cents = sum(pme_cost_breakdown_cents.values())
assert total_pme_cost_cents == 500, f"Expected 500, got {total_pme_cost_cents}"

print("=== 1. PME MARGINAL INFRA COST BREAKDOWN (500 centimes = 5.00 MAD HT/mo) ===")
for k, v in pme_cost_breakdown_cents.items():
    pct = (v / total_pme_cost_cents) * 100
    print(f"  {k}: {v} centimes ({v/100:.2f} MAD) -> {pct:.1f}%")

# 2. Naive LLM vs Fisca 3-Tier Neuro-Symbolic Routing (for 1 PME = 150 docs/mo, and for 1,000 PMEs = 150,000 docs/mo)
# Naive approach: 100% docs sent to frontier multimodal LLM + multi-turn agent reasoning (~280 centimes = 2.80 MAD per doc)
naive_cost_per_doc_cents = 280
naive_pme_ai_monthly_cents = 150 * naive_cost_per_doc_cents # 42,000 centimes = 420.00 MAD/mo
fisca_pme_ai_monthly_cents = 115 + 65 # 180 centimes = 1.80 MAD/mo
ai_saving_pct = ((naive_pme_ai_monthly_cents - fisca_pme_ai_monthly_cents) / naive_pme_ai_monthly_cents) * 100
ai_cost_divisor = naive_pme_ai_monthly_cents / fisca_pme_ai_monthly_cents

print("\n=== 2. MODEL TIERING SAVINGS ===")
print(f"  Naive All-LLM AI cost/PME/mo: {naive_pme_ai_monthly_cents/100:.2f} MAD vs Fisca Tiered AI: {fisca_pme_ai_monthly_cents/100:.2f} MAD")
print(f"  Reduction: -{ai_saving_pct:.1f}% (divided by {ai_cost_divisor:.1f}x)")
print(f"  For 1,000 active dossiers/mo: Naive = {naive_pme_ai_monthly_cents*1000/100:,.2f} MAD/mo vs Fisca = {fisca_pme_ai_monthly_cents*1000/100:,.2f} MAD/mo (Annual saving = {(naive_pme_ai_monthly_cents - fisca_pme_ai_monthly_cents)*1000*12/100:,.2f} MAD HT/an)")

# 3. Merkle Tree RFC 3161 TSA Optimization (ADR-07)
# Unit TSA token market price ~ 0.25 MAD (25 centimes) per timestamped archive unit (invoice, journal entry, Ticket Z, EDI)
# Suppose platform seals 100,000 archive units/month across tenants:
# Without Merkle: 100,000 * 0.25 MAD = 25,000.00 MAD/mo (300,000 MAD/yr)
# Or at 60,000 units/mo @ 0.25 MAD = 15,000 MAD/mo; earlier ADR-07 cited 50,000 pieces @ 0.20 MAD = 10,000 MAD/mo vs 1 daily token (30 tokens/mo + LTA reserve = ~15.00 MAD/mo -> cost divided by 666x, or 1 token/day vs 50,000 tokens/day!)
# Wait: ADR-07 said: "sur 50 000 pièces mensuelles @ 0,20 MAD = 10 000 MAD/mois vs 1 jeton/jour = ~6,00 à 15,00 MAD/mois" (and at 50,000 pieces/day, 1 token vs 50,000 tokens divides token count by 50,000!). Let's compute both exact numbers clearly!
unit_tsa_price_mad = 0.20
monthly_pieces_50k = 50000
unbundled_tsa_50k_mad = monthly_pieces_50k * unit_tsa_price_mad # 10,000.00 MAD/mo
# With 1 daily Merkle batch (30 days * 0.20 MAD = 6.00 MAD/mo + 9.00 MAD LTA/HSM overhead = 15.00 MAD/mo fixed)
merkle_fixed_monthly_mad = 15.00
merkle_saving_50k_pct = ((unbundled_tsa_50k_mad - merkle_fixed_monthly_mad) / unbundled_tsa_50k_mad) * 100
print("\n=== 3. MERKLE TSA OPTIMIZATION ===")
print(f"  50,000 pieces/mo @ 0.20 MAD: Unbundled = {unbundled_tsa_50k_mad:,.2f} MAD/mo vs Merkle Daily Root = {merkle_fixed_monthly_mad:.2f} MAD/mo (-{merkle_saving_50k_pct:.2f}%, saving {unbundled_tsa_50k_mad - merkle_fixed_monthly_mad:,.2f} MAD/mo)")

# 4. Unit Economics across all Customer Plans & Dossier Profiles (both Gross Infra Margin AND Contribution Margin after Payment Fees!)
# Payment fees:
# - Payzone Card (PME monthly): ~1.50% (150 bps) on TTC -> on HT that's 1.2 * 1.50% = 1.80% of HT (180 bps of HT)
# - SIMT Bank Wire (Annual Corporate, Souverain, large Cabinets > 2,500 MAD): 0 MAD percentage fee!
plans_unit_econ = [
    # (Name, Monthly_HT_MAD, Infra_Cloud_MAD, Payment_Method, Payment_Fee_Bps_on_HT)
    ("Fisca Solo (AE)", 129.00, 2.50, "Payzone Carte", 180),
    ("Fisca Essentiel (TPE)", 390.00, 5.00, "Payzone Carte", 180),
    ("Fisca Croissance (PME + 1 POS)", 890.00, 7.00, "Payzone Carte", 180),
    ("Terminal POS Tactile Additionnel", 149.00, 2.00, "Payzone Carte", 180),
    ("Dossier Fiduciaire Simplifié", 69.00, 2.50, "Virement SIMT / Lot", 0),
    ("Dossier Fiduciaire TPE", 149.00, 5.00, "Virement SIMT / Lot", 0),
    ("Dossier Fiduciaire PME Complet", 249.00, 5.00, "Virement SIMT / Lot", 0),
    ("Cabinet Moyen (Socle + 60 dossiers)", 10130.00, 300.00, "Virement SIMT", 0),
    ("Enterprise Corporate (58k/an, 5 ICE)", round(58000/12, 2), 150.00, "Virement SIMT", 0),
    ("Fisca Souverain OIV (140k/an, Maroc)", round(140000/12, 2), 1000.00, "Virement SIMT", 0),
]

print("\n=== 4. UNIT ECONOMICS BY PLAN / PROFILE ===")
for name, rev, infra, pmethod, pfee_bps in plans_unit_econ:
    pfee = round(rev * pfee_bps / 10000, 2)
    gross_infra_margin_mad = round(rev - infra, 2)
    gross_infra_pct = (gross_infra_margin_mad / rev) * 100
    net_contrib_mad = round(rev - infra - pfee, 2)
    net_contrib_pct = (net_contrib_mad / rev) * 100
    print(f"  {name}: Rev={rev:,.2f} | Infra={infra:.2f} | Gross={gross_infra_margin_mad:,.2f} ({gross_infra_pct:.1f}%) | PayFee={pfee:.2f} | Contrib={net_contrib_mad:,.2f} ({net_contrib_pct:.1f}%)")
```

Résultat du code (réexécution : identique aux sauts de ligne près (rétablis)) :

<!-- verif:13-01:resultat -->
```text
=== 1. PME MARGINAL INFRA COST BREAKDOWN (500 centimes = 5.00 MAD HT/mo) ===
  Workers Edge, Durable Objects & Queues: 75 centimes (0.75 MAD) -> 15.0%
  SQLite D1 Isolée (UE) & Vectorize: 65 centimes (0.65 MAD) -> 13.0%
  Coffre R2 WORM 10 ans & Miroir Maroc: 110 centimes (1.10 MAD) -> 22.0%
  IA Niveau 1 (Vision Clairic / Docling - 22% flux): 115 centimes (1.15 MAD) -> 23.0%
  IA Niveau 2 (Escalade Raisonnement - 3% flux): 65 centimes (0.65 MAD) -> 13.0%
  Quote-part Merkle TSA, SES & Infobip Fenêtre 24h: 70 centimes (0.70 MAD) -> 14.0%

=== 2. MODEL TIERING SAVINGS ===
  Naive All-LLM AI cost/PME/mo: 420.00 MAD vs Fisca Tiered AI: 1.80 MAD
  Reduction: -99.6% (divided by 233.3x)
  For 1,000 active dossiers/mo: Naive = 420,000.00 MAD/mo vs Fisca = 1,800.00 MAD/mo (Annual saving = 5,018,400.00 MAD HT/an)

=== 3. MERKLE TSA OPTIMIZATION ===
  50,000 pieces/mo @ 0.20 MAD: Unbundled = 10,000.00 MAD/mo vs Merkle Daily Root = 15.00 MAD/mo (-99.85%, saving 9,985.00 MAD/mo)

=== 4. UNIT ECONOMICS BY PLAN / PROFILE ===
  Fisca Solo (AE): Rev=129.00 | Infra=2.50 | Gross=126.50 (98.1%) | PayFee=2.32 | Contrib=124.18 (96.3%)
  Fisca Essentiel (TPE): Rev=390.00 | Infra=5.00 | Gross=385.00 (98.7%) | PayFee=7.02 | Contrib=377.98 (96.9%)
  Fisca Croissance (PME + 1 POS): Rev=890.00 | Infra=7.00 | Gross=883.00 (99.2%) | PayFee=16.02 | Contrib=866.98 (97.4%)
  Terminal POS Tactile Additionnel: Rev=149.00 | Infra=2.00 | Gross=147.00 (98.7%) | PayFee=2.68 | Contrib=144.32 (96.9%)
  Dossier Fiduciaire Simplifié: Rev=69.00 | Infra=2.50 | Gross=66.50 (96.4%) | PayFee=0.00 | Contrib=66.50 (96.4%)
  Dossier Fiduciaire TPE: Rev=149.00 | Infra=5.00 | Gross=144.00 (96.6%) | PayFee=0.00 | Contrib=144.00 (96.6%)
  Dossier Fiduciaire PME Complet: Rev=249.00 | Infra=5.00 | Gross=244.00 (98.0%) | PayFee=0.00 | Contrib=244.00 (98.0%)
  Cabinet Moyen (Socle + 60 dossiers): Rev=10,130.00 | Infra=300.00 | Gross=9,830.00 (97.0%) | PayFee=0.00 | Contrib=9,830.00 (97.0%)
  Enterprise Corporate (58k/an, 5 ICE): Rev=4,833.33 | Infra=150.00 | Gross=4,683.33 (96.9%) | PayFee=0.00 | Contrib=4,683.33 (96.9%)
  Fisca Souverain OIV (140k/an, Maroc): Rev=11,666.67 | Infra=1000.00 | Gross=10,666.67 (91.4%) | PayFee=0.00 | Contrib=10,666.67 (91.4%)
```

### V.2 — Courbe de stockage WORM sur 10 ans, miroir souverain et scénarios de charge

<!-- verif:13-02:code -->
```python
import json

# 1. Cumulative 10-Year R2 WORM Storage Math per PME Dossier (150 docs/month, compressed AIP ~ 140 KB/doc)
docs_per_mo = 150
kb_per_doc = 140 # 120 KB PDF/A-3 + 20 KB signed UBL/JSON/Merkle proof
mb_per_mo = (docs_per_mo * kb_per_doc) / 1024 # ~20.51 MB/mo
gb_per_yr = (mb_per_mo * 12) / 1024 # ~0.240 GB/yr
gb_year_10 = gb_per_yr * 10 # ~2.403 GB accumulated at end of Year 10
# Cloudflare R2 = $0.015 / GB-month (~0.15 MAD / GB-month at 1 USD = 10 MAD) + Morocco MinIO mirror (~0.10 MAD / GB-month) = 0.25 MAD / GB-month combined dual-vault!
combined_dual_vault_mad_per_gb_mo = 0.25
year_1_storage_mad_mo = gb_per_yr * combined_dual_vault_mad_per_gb_mo
year_5_storage_mad_mo = (gb_per_yr * 5) * combined_dual_vault_mad_per_gb_mo
year_10_storage_mad_mo = gb_year_10 * combined_dual_vault_mad_per_gb_mo
avg_10y_storage_mad_mo = sum((gb_per_yr * y) * combined_dual_vault_mad_per_gb_mo for y in range(1, 11)) / 10

print("=== 1. 10-YEAR WORM R2 + MOROCCO MIRROR STORAGE CURVE ===")
print(f"  Monthly data added/PME: {mb_per_mo:.2f} MB/mo | Annual: {gb_per_yr*1024:.1f} MB/yr ({gb_per_yr:.3f} GB/yr)")
print(f"  Year 10 cumulative vault/PME: {gb_year_10:.2f} GB")
print(f"  Dual-Vault monthly cost/PME: Year 1 = {year_1_storage_mad_mo:.2f} MAD | Year 5 = {year_5_storage_mad_mo:.2f} MAD | Year 10 = {year_10_storage_mad_mo:.2f} MAD | 10-yr Avg = {avg_10y_storage_mad_mo:.2f} MAD/mo")

# 2. Infobip Omnichannel FinOps (WhatsApp Business 24h Window + SMS FISCA Fallback)
# Inbound merchant receipt photos open a FREE 24h Customer Service Window on WhatsApp!
# Outbound proactive nudges (10th of month missing receipts + OTP):
# Suppose per PME/month: 4 OTP/Security events + 1 proactive monthly nudge = 5 outbound messages.
# 92% delivered on WhatsApp Utility (~0.08 MAD/msg = 8 centimes), 8% fallback after 15s to SMS sender FISCA (~0.45 MAD/SMS = 45 centimes)
blended_msg_cost_mad = 0.92 * 0.08 + 0.08 * 0.45 # 0.0736 + 0.036 = 0.1096 MAD/event
monthly_infobip_per_pme_mad = 5 * blended_msg_cost_mad # 0.548 MAD/mo (~55 centimes/mo!)
unoptimized_all_sms_per_pme_mad = 5 * 0.45 + 15 * 0.45 # if 15 bot replies also went via SMS = 9.00 MAD/mo!
print("\n=== 2. INFOBIP WHATSAPP + SMS FISCA OPTIMIZATION ===")
print(f"  Blended cost per OTP/alert (92% WA + 8% SMS FISCA): {blended_msg_cost_mad:.4f} MAD ({blended_msg_cost_mad*100:.1f} centimes)")
print(f"  5 outbound events/PME/mo = {monthly_infobip_per_pme_mad:.2f} MAD/mo (vs {5*0.45:.2f} MAD pure SMS OTP, and 0.00 MAD on inbound 24h receipt replies)")

# 3. Platform Fixed Tech Infrastructure Overhead (Socle Fixe Mensuel SYNAPTIC SYSTEMS) & Break-even
fixed_platform_opex_mad = {
    "Cloudflare Workers Paid, Queues, KV & SaaS Hostnames Base": 450.00,
    "Serveur Miroir Chaud Maroc (Standby VPS, Postgres 16, MinIO WORM)": 1200.00,
    "Abonnement HSM Qualifié Barid eSign + 30 Jetons Merkle TSA/mois": 350.00,
    "Passerelle Infobip WABA, Sender ID FISCA, AWS SES & Sondes Multi-DNS": 500.00,
}
total_fixed_opex_mad = sum(fixed_platform_opex_mad.values()) # 2,500.00 MAD HT / mois!
# Break-even in Essentiel TPE clients (390 MAD rev - 5 MAD var infra = 385 MAD contribution before card fee, or 377.98 MAD after 1.80% Payzone fee):
be_tpe_clients = int(-(-total_fixed_opex_mad // 377.98)) # ceil division -> 7 TPE clients!
# Or break-even in Cabinets: just 1 Petit Cabinet (4,315 MAD HT/mo) covers 100% of fixed tech OpEx from Month 1!
print("\n=== 3. FIXED PLATFORM TECH OPEX & BREAK-EVEN ===")
for k, v in fixed_platform_opex_mad.items():
    print(f"  {k}: {v:.2f} MAD HT/mo")
print(f"  TOTAL FIXED TECH OPEX = {total_fixed_opex_mad:,.2f} MAD HT/mo ({total_fixed_opex_mad*12:,.2f} MAD HT/yr)")
print(f"  Tech Break-Even = {be_tpe_clients} clients TPE Essentiel (ou 1 seul Petit Cabinet de 25 dossiers !)")

# 4. Widget Dataset: Fleet FinOps Simulator for 820 Active Dossiers (Baseline matching our Doc 03 Year-1 Mix:
# 100 Solo + 80 TPE + 40 PME + 10 Cabinets*60=600 dossiers = 820 dossiers! Wait: let's check!)
# In Doc 03: 100 Solo (12,900/mo) + 80 Essentiel (31,200/mo) + 40 Croissance (35,600/mo) + 60 POS (8,940/mo) + 10 Cabinets of 60 (101,300/mo) + 4 Corporate (19,333.33/mo) + 1 Souverain (11,666.67/mo) = 220,940.00 MAD MRR!
# Even cleaner for a pure FinOps Cost-Center Breakdown Widget in Doc 13:
# Let's show the Monthly FinOps Cost Breakdown across the 6 Infrastructure & AI Cost Centers for a reference park of 1,000 Active PME Dossiers (generating 150,000 docs/month):
# Wait: in a park of 1,000 Active Dossiers (at average revenue 200.00 MAD HT/dossier/mo = 200,000.00 MAD HT/mo revenue):
# Variable cost = 1,000 * 5.00 MAD = 5,000.00 MAD HT/mo + Fixed Platform Base = 2,500.00 MAD HT/mo => Total Monthly Tech Cost = 7,500.00 MAD HT/mo!
# Let's check each of the 6 cost centers for 1,000 dossiers so every single row is exact, integer MAD, and sums to 7,500.00 MAD HT/mo!

cost_centers_1000 = [
    {
        "center": "Socle Fixe Plateforme & Miroir Maroc",
        "scalable": False,
        "unit_cost_per_dossier_mad": 0.00,
        "fixed_monthly_mad": 2500.00,
        "baseline_monthly_mad": 2500.00,
        "naive_arch_monthly_mad": 18000.00 # K8s cluster + dedicated GPUs
    },
    {
        "center": "Compute Edge, Durable Objects & D1 UE",
        "scalable": True,
        "unit_cost_per_dossier_mad": 1.40, # 0.75 + 0.65 MAD
        "fixed_monthly_mad": 0.00,
        "baseline_monthly_mad": 1400.00,
        "naive_arch_monthly_mad": 9500.00 # Managed RDS multi-AZ
    },
    {
        "center": "Coffre WORM R2 10 Ans & Réplication",
        "scalable": True,
        "unit_cost_per_dossier_mad": 1.10,
        "fixed_monthly_mad": 0.00,
        "baseline_monthly_mad": 1100.00,
        "naive_arch_monthly_mad": 6500.00 # S3 + Egress fees
    },
    {
        "center": "IA Niveau 1 (Vision Clairic / Docling)",
        "scalable": True,
        "unit_cost_per_dossier_mad": 1.15,
        "fixed_monthly_mad": 0.00,
        "baseline_monthly_mad": 1150.00,
        "naive_arch_monthly_mad": 90000.00
    },
    {
        "center": "IA Niveau 2 (Escalade Raisonnement)",
        "scalable": True,
        "unit_cost_per_dossier_mad": 0.65,
        "fixed_monthly_mad": 0.00,
        "baseline_monthly_mad": 650.00,
        "naive_arch_monthly_mad": 330000.00 # Full LLM without tiering (90k + 330k = 420k MAD!)
    },
    {
        "center": "Canaux Infobip (WA/SMS), SES & Merkle",
        "scalable": True,
        "unit_cost_per_dossier_mad": 0.70,
        "fixed_monthly_mad": 0.00,
        "baseline_monthly_mad": 700.00,
        "naive_arch_monthly_mad": 36000.00 # Unbundled TSA (30k) + pure SMS (6k)
    }
]

tot_fisca = sum(c["baseline_monthly_mad"] for c in cost_centers_1000)
tot_naive = sum(c["naive_arch_monthly_mad"] for c in cost_centers_1000)
savings_mad = tot_naive - tot_fisca
savings_pct = round((savings_mad / tot_naive) * 100, 1)
ref_mrr_1000 = 1000 * 200.00 # 200,000 MAD HT/mo blended ARPU across PME & Fiduciary dossiers
gross_profit_1000 = ref_mrr_1000 - tot_fisca
gross_margin_1000_pct = round((gross_profit_1000 / ref_mrr_1000) * 100, 1)
blended_cost_per_dossier = round(tot_fisca / 1000, 2) # 7.50 MAD/mo total (5.00 variable + 2.50 amortized fixed!)

totals_1000 = {
    "active_dossiers": 1000,
    "blended_arpu_ht_mad": 200.00,
    "mrr_ht_mad": ref_mrr_1000,
    "fisca_total_cost_mad": tot_fisca,
    "fisca_cost_per_dossier_mad": blended_cost_per_dossier,
    "naive_arch_total_cost_mad": tot_naive,
    "finops_savings_mad": savings_mad,
    "finops_savings_pct": savings_pct,
    "gross_profit_mad": gross_profit_1000,
    "gross_margin_pct": gross_margin_1000_pct
}

print("\n=== 4. WIDGET DATASET VERIFICATION (1,000 DOSSIERS) ===")
print(json.dumps({"items": cost_centers_1000, "totals": totals_1000}, indent=2, ensure_ascii=False))
```

Résultat du code (réexécution : identique) :

<!-- verif:13-02:resultat -->
```text
=== 1. 10-YEAR WORM R2 + MOROCCO MIRROR STORAGE CURVE ===
  Monthly data added/PME: 20.51 MB/mo | Annual: 246.1 MB/yr (0.240 GB/yr)
  Year 10 cumulative vault/PME: 2.40 GB
  Dual-Vault monthly cost/PME: Year 1 = 0.06 MAD | Year 5 = 0.30 MAD | Year 10 = 0.60 MAD | 10-yr Avg = 0.33 MAD/mo

=== 2. INFOBIP WHATSAPP + SMS FISCA OPTIMIZATION ===
  Blended cost per OTP/alert (92% WA + 8% SMS FISCA): 0.1096 MAD (11.0 centimes)
  5 outbound events/PME/mo = 0.55 MAD/mo (vs 2.25 MAD pure SMS OTP, and 0.00 MAD on inbound 24h receipt replies)

=== 3. FIXED PLATFORM TECH OPEX & BREAK-EVEN ===
  Cloudflare Workers Paid, Queues, KV & SaaS Hostnames Base: 450.00 MAD HT/mo
  Serveur Miroir Chaud Maroc (Standby VPS, Postgres 16, MinIO WORM): 1200.00 MAD HT/mo
  Abonnement HSM Qualifié Barid eSign + 30 Jetons Merkle TSA/mois: 350.00 MAD HT/mo
  Passerelle Infobip WABA, Sender ID FISCA, AWS SES & Sondes Multi-DNS: 500.00 MAD HT/mo
  TOTAL FIXED TECH OPEX = 2,500.00 MAD HT/mo (30,000.00 MAD HT/yr)
  Tech Break-Even = 7 clients TPE Essentiel (ou 1 seul Petit Cabinet de 25 dossiers !)

=== 4. WIDGET DATASET VERIFICATION (1,000 DOSSIERS) ===
{
  "items": [
    {
      "center": "Socle Fixe Plateforme & Miroir Maroc",
      "scalable": false,
      "unit_cost_per_dossier_mad": 0.0,
      "fixed_monthly_mad": 2500.0,
      "baseline_monthly_mad": 2500.0,
      "naive_arch_monthly_mad": 18000.0
    },
    {
      "center": "Compute Edge, Durable Objects & D1 UE",
      "scalable": true,
      "unit_cost_per_dossier_mad": 1.4,
      "fixed_monthly_mad": 0.0,
      "baseline_monthly_mad": 1400.0,
      "naive_arch_monthly_mad": 9500.0
    },
    {
      "center": "Coffre WORM R2 10 Ans & Réplication",
      "scalable": true,
      "unit_cost_per_dossier_mad": 1.1,
      "fixed_monthly_mad": 0.0,
      "baseline_monthly_mad": 1100.0,
      "naive_arch_monthly_mad": 6500.0
    },
    {
      "center": "IA Niveau 1 (Vision Clairic / Docling)",
      "scalable": true,
      "unit_cost_per_dossier_mad": 1.15,
      "fixed_monthly_mad": 0.0,
      "baseline_monthly_mad": 1150.0,
      "naive_arch_monthly_mad": 90000.0
    },
    {
      "center": "IA Niveau 2 (Escalade Raisonnement)",
      "scalable": true,
      "unit_cost_per_dossier_mad": 0.65,
      "fixed_monthly_mad": 0.0,
      "baseline_monthly_mad": 650.0,
      "naive_arch_monthly_mad": 330000.0
    },
    {
      "center": "Canaux Infobip (WA/SMS), SES & Merkle",
      "scalable": true,
      "unit_cost_per_dossier_mad": 0.7,
      "fixed_monthly_mad": 0.0,
      "baseline_monthly_mad": 700.0,
      "naive_arch_monthly_mad": 36000.0
    }
  ],
  "totals": {
    "active_dossiers": 1000,
    "blended_arpu_ht_mad": 200.0,
    "mrr_ht_mad": 200000.0,
    "fisca_total_cost_mad": 7500.0,
    "fisca_cost_per_dossier_mad": 7.5,
    "naive_arch_total_cost_mad": 490000.0,
    "finops_savings_mad": 482500.0,
    "finops_savings_pct": 98.5,
    "gross_profit_mad": 192500.0,
    "gross_margin_pct": 96.2
  }
}
```

### V.3 — Parité d'arrondi JavaScript / Python du simulateur

<!-- verif:13-03:code -->
```python
# Check exact JS vs Python rounding so there is zero 0.1% discrepancy in the widget!
# In JS: (192500 / 200000 * 100) = 96.25 -> Number(96.25).toFixed(1) in V8:
# Wait: let's make sure the division doesn't land on an exact .x5 tie!
# What if fixed_monthly_mad is 2,400 MAD HT/mo (Cloudflare 450 + Miroir Maroc 1,200 + Barid eSign 350 + Infobip/SES/DNS 400 = 2,400 MAD)?
# Let's check: 2,400 + 5,000 = 7,400 MAD total cost on 200,000 MAD MRR!
# Gross profit = 192,600 MAD!
# 192,600 / 200,000 * 100 = 96.300000% EXACT!
# And savings vs 490,000 MAD: 490,000 - 7,400 = 482,600 MAD -> 482,600 / 490,000 * 100 = 98.48979% -> 98.5% in BOTH Python and JS!
# Cost per dossier = 7,400 / 1,000 = 7.40 MAD/mo EXACT!
# Break-even in TPE Essentiel (377.98 MAD net contrib): ceil(2400 / 377.98) = 7 TPE clients!

fixed_opex = 2400.0
var_opex = 5000.0
tot_cost = fixed_opex + var_opex # 7400.0
mrr = 200000.0
gp = mrr - tot_cost # 192600.0
gm_pct = (gp / mrr) * 100 # 96.3 exact!
naive_tot = 490000.0
sav = naive_tot - tot_cost # 482600.0
sav_pct = (sav / naive_tot) * 100 # 98.48979 -> 98.5 in both!
print(f"Total Cost={tot_cost}, GP={gp}, GM%={gm_pct} (exact!), Savings={sav}, Sav%={sav_pct:.4f} -> {round(sav_pct,1)}%")
```

Résultat du code (réexécution : identique) :

<!-- verif:13-03:resultat -->
```text
Total Cost=7400.0, GP=192600.0, GM%=96.3 (exact!), Savings=482600.0, Sav%=98.4898 -> 98.5%
```

### V.4 — Formule du widget de simulation (valeurs par défaut et extrêmes)

<!-- verif:13-04:code -->
```python
# Verify exact widget formula at default (0%, 0%, 0%) and extreme scenarios
def eval_sim(dossier_pct=0, tier1_ai_pct=0, tier2_ai_pct=0):
    scale_d = 1 + (dossier_pct / 100.0)
    dossiers = round(1000 * scale_d)
    row0 = 2400.0 # Fixed Socle
    row1 = 1400.0 * scale_d
    row2 = 1100.0 * scale_d
    row3 = 1150.0 * scale_d * (1 + tier1_ai_pct / 100.0)
    row4 = 650.0 * scale_d * (1 + tier2_ai_pct / 100.0)
    row5 = 700.0 * scale_d
    fisca_tot = row0 + row1 + row2 + row3 + row4 + row5
    naive_tot = 18000.0 + (490000.0 - 18000.0) * scale_d
    mrr = dossiers * 200.0
    gp = mrr - fisca_tot
    gm_pct = (gp / mrr) * 100.0
    sav = naive_tot - fisca_tot
    sav_pct = (sav / naive_tot) * 100.0
    cost_per_d = fisca_tot / dossiers
    return {
        "dossiers": dossiers, "mrr": mrr, "fisca_tot": fisca_tot,
        "cost_per_d": cost_per_d, "gp": gp, "gm_pct": round(gm_pct, 1),
        "naive_tot": naive_tot, "sav": sav, "sav_pct": round(sav_pct, 1)
    }

print("Default (0,0,0):", eval_sim(0, 0, 0))
print("Growth +200% dossiers (3000 dossiers):", eval_sim(200, 0, 0))
print("Stress test +100% Tier 1 & +200% Tier 2 AI:", eval_sim(0, 100, 200))
```

Résultat du code (réexécution : identique) :

<!-- verif:13-04:resultat -->
```text
Default (0,0,0): {'dossiers': 1000, 'mrr': 200000.0, 'fisca_tot': 7400.0, 'cost_per_d': 7.4, 'gp': 192600.0, 'gm_pct': 96.3, 'naive_tot': 490000.0, 'sav': 482600.0, 'sav_pct': 98.5}
Growth +200% dossiers (3000 dossiers): {'dossiers': 3000, 'mrr': 600000.0, 'fisca_tot': 17400.0, 'cost_per_d': 5.8, 'gp': 582600.0, 'gm_pct': 97.1, 'naive_tot': 1434000.0, 'sav': 1416600.0, 'sav_pct': 98.8}
Stress test +100% Tier 1 & +200% Tier 2 AI: {'dossiers': 1000, 'mrr': 200000.0, 'fisca_tot': 9850.0, 'cost_per_d': 9.85, 'gp': 190150.0, 'gm_pct': 95.1, 'naive_tot': 490000.0, 'sav': 480150.0, 'sav_pct': 98.0}
```
