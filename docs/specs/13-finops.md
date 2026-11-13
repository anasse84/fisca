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
