<!--
ID canonique : Doc_12_SLA_DPA_PRA_Reversibilite   |   Fichier : docs/specs/12-sla-dpa-pra-reversibility.md
Source : « Document 12 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_12_SLA_DPA_PRA_Reversibilite#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_12_SLA_DPA_PRA_Reversibilite »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 12 — Spécifications SLA, DPA, PRA & Réversibilité
Ce document formalise les engagements contractuels de disponibilité (SLA), l'accord de sous-traitance des données personnelles (DPA conforme à l'Article 23 de la Loi n° 09-08), le plan de reprise et de continuité d'activité à perte nulle (PRA / PCA avec bascule Multi-DNS et pont HTTP de retour) ainsi que le protocole de réversibilité décennale (ISO 14641 / Article 211 du CGI) de Fisca (fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (siège social à Rabat, Maroc). Ses 12 sections nommées sont prêtes à être importées dans Hyperagent avec la portée Projet (Doc_12_SLA_DPA_PRA_Reversibilite).
## Section 01 — Cadre Contractuel, Juridiction de Rabat & Hiérarchie Juridique
Toute souscription aux services Fisca (en ligne par validation 2FA/Payzone ou par contrat annuel signé pour les Grands Comptes et Fiduciaires) emporte adhésion pleine et entière au corpus contractuel suivant, régi exclusivement par le droit marocain avec compétence expresse attribuée au Tribunal de Commerce de Rabat :
- Contrat Principal / Conditions Générales B2B : Définit l'objet du service SaaS, la propriété intellectuelle exclusive du client sur ses écritures et pièces comptables, la tarification (Document 03) et la responsabilité plafonnée.
- Annexe 1 — Accord de Traitement des Données (DPA Art. 23 Loi n° 09-08) : Prévaut sur toute autre stipulation en matière de confidentialité, de résidence des données (Union Européenne Art. 43 ou Territoire Marocain Loi 05-20) et de sécurité.
- Annexe 2 — Convention de Niveau de Service (SLA) : Fixe les indicateurs mesurables de disponibilité, de latence, de support et le mécanisme automatique d'avoirs financiers.
- Annexe 3 — Plan de Continuité, PRA & Clause de Réversibilité ISO 14641 : Garantit contractuellement l'absence d'enfermement propriétaire (Zero Vendor Lock-in) et la restitution vérifiable hors-ligne sur 10 ans.
- Limitation claire du rôle d'éditeur logiciel : SYNAPTIC SYSTEMS SARL AU garantit l'exactitude arithmétique déterministe de ses moteurs, l'intégrité cryptographique des archives et la conformité XSD des fichiers générés, sans jamais se substituer au jugement professionnel de l'Expert-Comptable inscrit à l'OEC (Loi n° 15-89) ni agir comme établissement de paiement (Loi n° 103-12).
## Section 02 — Engagements de Niveau de Service (SLA 99,95 %) & Pics Fiscaux DGI
La disponibilité mensuelle est mesurée par tranches d'une minute sur l'ensemble des fonctions critiques (authentification, émission/réception xHub, saisie Grand Livre, synchronisation POS et exports EDI SIMPL) :

| Offre Souscrite | Disponibilité Garantie | Indisponibilité Max / 30j | Latence API Edge (p95) | Latence Clearance / OCR (p95) |
|---|---|---|---|---|
| Solo, TPE & PME | 99,90 % (9990 bps) | 43 min 12 s | Inférieure à 50 ms | Inférieure à 3,0 s / 2,5 s |
| Fiduciaire OEC | 99,90 % (9990 bps) | 43 min 12 s | Inférieure à 50 ms | Inférieure à 2,5 s / 2,0 s |
| Enterprise Corporate | 99,95 % (9995 bps) | 21 min 36 s | Inférieure à 35 ms | Inférieure à 2,0 s / 2,0 s |
| Fisca Souverain OIV | 99,95 % (9995 bps) | 21 min 36 s | Inférieure à 25 ms | Inférieure à 2,0 s / 2,0 s |

- Clause spéciale « Sanctuarisation des Échéances Fiscales Marocaines » : Aucune maintenance programmée susceptible d'entraîner une coupure ou un ralentissement n'est autorisée du 15 au 21 de chaque mois (échéance mensuelle SIMPL-TVA, RAS-TVA et cotisations CNSS) ni du 15 février au 31 mars (échéances annuelles État 9421 au 28 février et SIMPL-IS / DRVT au 31 mars). Un verrou dans le pipeline GitHub Actions bloque tout déploiement de migration lourde pendant ces fenêtres.
- Maintenances hors périodes fiscales : Les mises à jour courantes s'exécutent à chaud sans interruption (Zero-Downtime Rolling Deploy). Toute intervention exceptionnelle nécessitant une fenêtre en lecture seule de quelques secondes est planifiée le dimanche entre 02h00 et 04h00 (heure du Maroc) avec préavis de 72 heures et exclue du calcul d'indisponibilité.
## Section 03 — Barème des Avoirs de Service (SLA Credits), GTR Support & Exclusions
En cas de non-respect du taux de disponibilité mensuel garanti, le client bénéficie d'un avoir commercial automatique (émis sous forme d'avoir électronique UBL 381 imputé sur l'échéance suivante) calculé en centimes entiers sur sa redevance mensuelle HT (ou sur le douzième de sa redevance annuelle HT) :

| Taux Observé sur le Mois | Équivalent en BPS | Taux d'Avoir SLA Accordé | Droit Complémentaire Client |
|---|---|---|---|
| Supérieur ou égal à la cible | 9990 ou 9995+ | 0 % (0 bps) | Service nominal conforme |
| Sous la cible jusqu'à 99,50 % | 9950 à 9989/9994 | 10 % (1000 bps) | Rapport d'incident post-mortem |
| De 99,00 % à 99,49 % | 9900 à 9949 | 25 % (2500 bps) | Plan d'action correctif prioritaire |
| Inférieur à 99,00 % | Moins de 9900 | 50 % (5000 bps) | Résiliation sans frais si 2 mois de suite |

- Engagements de prise en charge Support (GTI / GTR) :
- Sévérité P1 (Critique — Blocage émission xHub, export EDI veille d'échéance ou panne globale) : Prise en charge humaine en moins de 15 minutes (24h/24 et 7j/7 durant les fenêtres fiscales pour Fiduciaires et Grands Comptes), solution de contournement en moins de 2 heures.
- Sévérité P2 (Majeure — Dégradation d'un connecteur ERP ou d'un agent IA sans perte comptable) : Prise en charge en moins de 2 heures ouvrées, résolution ou contournement sous 8 heures ouvrées.
- Sévérité P3 (Mineure — Question fonctionnelle, ergonomie ou demande d'évolution) : Réponse sous 8 heures ouvrées (08h30–18h30 heure de Rabat, du lundi au vendredi).
- Exclusions objectives du calcul SLA : Ne sont pas comptabilisées comme indisponibilité imputable à Fisca les pannes prouvées des serveurs gouvernementaux de la DGI (xHub ou portails SIMPL), du HSM externe Barid eSign, des réseaux interbancaires SIMT/Payzone ou de la connexion internet locale du client — situations durant lesquelles Fisca maintient néanmoins la saisie locale, les files durables Cloudflare Workflows et l'autonomie hors-ligne de 72 heures de Fisca POS.
## Section 04 — Accord de Sous-Traitance des Données (DPA — Article 23 Loi n° 09-08)
Conformément à l'Article 23 de la Loi n° 09-08 contrôlée par la CNDP, SYNAPTIC SYSTEMS SARL AU souscrit six obligations impératives envers chaque entreprise cliente et cabinet fiduciaire (Responsable de Traitement) :
- Finalité exclusive et interdiction d'entraînement IA : Traiter les données comptables, sociales (État 9421) et fiscales uniquement sur instruction documentée du client pour fournir les services souscrits, avec interdiction absolue d'utiliser les documents ou journaux clients pour entraîner ou affiner des modèles d'intelligence artificielle tiers ou mutualisés.
- Sécurité technique et organisationnelle (Art. 23 & 24) : Maintenir en permanence l'isolation physique d'une base SQLite par société, le chiffrement AES-256-GCM avec liaison AAD, l'anonymisation PII en RAM avant tout appel IA et le contrôle d'accès strict RBAC / ABAC / SoD détaillés aux Documents 09 et 10.
- Confidentialité du personnel : Soumettre tout collaborateur ou ingénieur d'astreinte de SYNAPTIC SYSTEMS SARL AU à un engagement écrit de secret professionnel survivant à la cessation de ses fonctions, sans aucun accès aux clés privées des dossiers en mode ZERO_KNOWLEDGE_E2EE.
- Encadrement strict des sous-traitants ultérieurs : N'autoriser que les sous-traitants listés au Document 11 (localisés au Maroc ou dans l'Union Européenne reconnue adéquate par l'Article 43 de la Loi 09-08). Tout ajout ou remplacement d'un sous-traitant ultérieur fait l'objet d'une notification écrite 30 jours à l'avance ; en cas d'objection légitime non résolue, le client peut exercer sa clause de réversibilité sans pénalité.
- Coopération aux droits des personnes et contrôles CNDP : Fournir dans l'interface les outils permettant de répondre sous 48 heures aux demandes d'accès/rectification et générer en 1 clic le kit technique pré-rempli pour les déclarations F211 et F112 du client.
- Notification de violation et droit d'audit : Alerter le client (et accompagner la notification au MA-CERT le cas échéant) sans délai et au plus tard dans les 24 heures suivant la découverte confirmée d'une violation de données, et mettre à disposition chaque année la synthèse d'audit sécurité PASSI ainsi qu'un droit d'audit dédié pour les contrats ENT_CORPORATE et ENT_SOUVERAIN (préavis de 15 jours ouvrés).
## Section 05 — Architecture PRA / PCA : Réplication Continue & Objectifs RPO Nul / RTO 60 s
Pour garantir qu'aucune panne majeure d'un opérateur cloud ne paralyse les entreprises marocaines ni ne perde un seul centime d'écriture comptable, Fisca associe son contrat FiscaInfrastructureAdapter (Document 04) à une réplication continue vers son infrastructure miroir souveraine au Maroc :

```text
[EXÉCUTION NOMINALE : CLOUDFLARE EDGE (PoP Casablanca / Rabat — D1 UE + R2 WORM UE)]
        │
        ├──► 1. Scellement synchrone transactionnel (D1 Batch + Paquet OAIS AIP R2)
        └──► 2. Émission immédiate sur SOVEREIGN_MIRROR_QUEUE d'un paquet SignedReplicationDelta
                     │  (Chiffré AES-256-GCM + Signé HMAC-SHA256 + Numéro monotone + Hash Journaux)
                     ▼ (Latence médiane de réplication inférieure à 2 secondes via mTLS)
[SERVEUR MIROIR CHAUD MAROC : apps/standby-vps (Node/Hono + PostgreSQL 16 + MinIO WORM + BullMQ)]
```

- Objectif de Point de Reprise (RPO = 0 perte nulle) : Toute écriture validée sur le navigateur ou sur une caisse Fisca POS conserve son Idempotency-Key et son tampon local dans IndexedDB / SQLite OPFS jusqu'à confirmation de persistance ; si une bascule survient pendant les 2 secondes de transit d'un delta asynchrone, le client rejoue automatiquement sa transaction signée sur le serveur de secours sans perte ni doublon.
- Objectif de Temps de Reprise (RTO inférieur à 60 secondes) : Le serveur standby-vps au Maroc maintient ses pools de connexions PostgreSQL 16, ses clés publiques EdDSA de vérification de session et les règles fiscales AST préchargées en mémoire, prêt à absorber le trafic instantanément sans démarrage à froid.
## Section 06 — Protocole de Bascule Automatisée Multi-DNS (Failover)
Afin d'éviter qu'une panne du plan de contrôle d'un fournisseur unique n'empêche la bascule elle-même, la résolution DNS de secours et la surveillance sont externalisées :
- Quorum de surveillance tri-régional indépendant : Trois sondes externes indépendantes situées à Casablanca, Paris et Francfort interrogent toutes les 15 secondes l'endpoint /api/v1/health/deep (qui vérifie une lecture réelle sur CONTROL_PLANE_DB et l'accès au coffre R2_LEGAL_VAULT).
- Seuil anti-battement (Anti-Flapping Quorum) : Le déclenchement automatique exige qu'au moins 2 sondes sur 3 enregistrent 3 échecs consécutifs (soit 45 secondes d'indisponibilité confirmée), écartant toute fausse alerte liée au routage local d'un seul opérateur télécom.
- Commutation DNS à TTL court (30 secondes) : L'orchestrateur bascule les enregistrements api.fisca.ma et app.fisca.ma vers les adresses IP marocaines protégées anti-DDoS du cluster standby-vps, tout en notifiant l'équipe d'astreinte SYNAPTIC SYSTEMS par SMS Infobip et appel vocal.
- Continuité transparente des sessions et séquences : Les utilisateurs connectés ne sont pas déconnectés (les jetons JWT EdDSA sont validés par la même clé publique), les tablettes Fisca POS poursuivent leurs encaissements sans latence et les factures urgentes sont scellées séquentiellement à partir du dernier icv_counter répliqué.
## Section 07 — Protocole de Retour Nominal sans Perte (Failback HTTP Bridge)
Le retour vers l'infrastructure nominale Cloudflare Edge après résolution de l'incident est l'étape la plus sensible d'un PRA comptable : il est strictement interdit de rouvrir le primaire tant que 100 % des écritures saisies sur le serveur de secours au Maroc n'ont pas été rapatriées et vérifiées cryptographiquement.

```text
Phase 1 (Observation 10 min) ──► Cloudflare Edge répond 100 % sain sans erreur pendant 600s
         │
Phase 2 (Rattrapage à chaud) ──► Standby VPS pousse par lots mTLS tous les SignedReplicationDelta vers D1 & R2
         │
Phase 3 (Gel atomique <= 5s) ──► Passage en DRAIN_READ_ONLY (5s max) + envoi du dernier lot résiduel
         │
Phase 4 (Parité SHA-256)     ──► Contrôle égalité stricte des 6 last_entry_hash CGNC + compteurs Séquenceur
         │
Phase 5 (Bascule DNS retour) ──► Commutation DNS vers Cloudflare Edge + réouverture complète des écritures
```

- Verrou de parité bloquant : Si la comparaison bit-à-bit entre standby-vps et Cloudflare D1 révèle le moindre écart sur un last_entry_hash d'un des 6 journaux (AN, ACH, VTE, BNQ, CAI, OD) ou sur le nombre d'unités d'archives archival_packages, le Failback avorte automatiquement et maintient la production sur le serveur marocain jusqu'à résolution complète.
## Section 08 — Réversibilité Contractuelle & Export Décennal en 1 Clic (ISO 14641)
À tout instant de la vie du contrat — et même lorsque le compte est suspendu en lecture seule pour impayé à J+15 (RESTRICTED_READ_ONLY, conformément au Document 03) — le dirigeant ou l'expert-comptable mandaté dispose d'un bouton permanent générant un Paquet d'Information de Diffusion (DIP) conforme aux normes ISO 14721 (OAIS) et ISO 14641 :

| Répertoire de l'Archive ZIP | Fichiers Contenus | Format Ouvert Standard | Usage Métier & Fiscal Immédiat |
|---|---|---|---|
| /01_DATABASE/ | Base complète + tables | .sqlite, .sql, .csv UTF-8 | Reprise directe dans tout autre logiciel ou ERP |
| /02_FEC_AND_SAFT/ | Audit légal Art. 211 CGI | FEC 24 col. .txt + SAF-T .xml | Remise immédiate à un vérificateur de la DGI |
| /03_INVOICES_XHUB/ | Ventes & Achats scellés | UBL 2.1 XAdES + Factur-X PDF/A-3 | Preuve commerciale et fiscale bilingue FR/AR |
| /04_EDI_SIMPL_POS/ | Déclarations & Tickets Z | .xml / .zip SIMPL + JSON POS | Historique TVA, IS, 9421, DRVT, Loi 69-21 et Caisse |
| /05_CRYPTO_PROOFS/ | Preuves & Vérificateur | MANIFEST.json + .tst + .mjs | Vérification mathématique hors-ligne sur 10 ans |

- Zéro frais de sortie (Zero Egress Fee) : Grâce au stockage sur Cloudflare R2 exempt de frais de bande passante sortante, SYNAPTIC SYSTEMS SARL AU ne facture aucun frais d'extraction de données lors d'un export de réversibilité standard en libre-service.
- Auto-suffisance probante sur 10 ans sans Fisca : Le script autonome verify-archive-offline.mjs inclus dans /05_CRYPTO_PROOFS/ utilise uniquement le module standard node:crypto (zéro paquet npm externe) pour recalculer chaque empreinte SHA-256, remonter chaque branche merkle_proof_json jusqu'à la racine quotidienne et vérifier la chaîne continue du Grand Livre CGNC sur n'importe quel ordinateur en 2036, même hors-ligne.
- Portabilité granulaire pour les Fiduciaires : Lorsqu'un client quitte un cabinet comptable (ou inversement lorsqu'un cabinet exporte l'ensemble de son portefeuille), l'isolation 1 base D1 par société permet d'exporter un seul dossier en quelques secondes sans jamais exposer une seule ligne des autres clients du cabinet.
## Section 09 — Sort des Données en Fin de Contrat : Décharge Art. 211 vs Coffre Dormant
Lorsqu'une organisation résilie son abonnement Fisca, le droit fiscal marocain (Article 211 du CGI et Article 22 de la Loi n° 9-88 imposant 10 ans de conservation des livres et pièces justificatives) interdit toute destruction aveugle non concertée. Deux voies contractuelles explicites sont proposées au client durant un préavis de réversibilité de 30 jours :
- Voie 1 — Restitution Intégrale, Décharge Signée & Destruction Certifiée : Le client télécharge son archive complète DIP ISO 14641, vérifie son empreinte SHA-256 et signe électroniquement (2FA / Loi 43-20) un Procès-Verbal de Réception et de Transfert de Garde Décennale Art. 211 CGI. Dès signature et à l'issue d'un délai de sécurité de 30 jours, Fisca procède à la purge de la base TENANT_DB, à la destruction cryptographique irréversible des clés d'enveloppe (Crypto-Shredding conforme NIST SP 800-88 Rev. 1 Purge) et remet au client un Certificat Numérique de Destruction horodaté.
- Voie 2 — Maintien en Coffre-Fort Légal Dormant 10 Ans (CANCELED_WORM_PRESERVED) : Si le client préfère déléguer à Fisca le maintien en condition probante de ses archives passées (incluant le ré-horodatage préventif LTA en SHA-512 tous les 24 mois et l'accès permanent en lecture seule pour tout contrôle fiscal ultérieur), son dossier bascule en coffre dormant verrouillé jusqu'à la date exacte clôture + 10 ans + 1 jour, suivie de sa purge automatique.
## Section 10 — Séquestre Logiciel (Escrow Grands Comptes) & Exercices PRA Périodiques
- Clause d'Escrow / Séquestre de Continuité (ENT_CORPORATE & ENT_SOUVERAIN) : Pour répondre aux exigences prudentielles de Bank Al-Maghrib (directive sur l'externalisation cloud des établissements de crédit) et des OIV, SYNAPTIC SYSTEMS SARL AU dépose trimestriellement une archive chiffrée et reproductible (code source du Monorepo, images Docker fiscal-java, docling-python et standby-vps, scripts de déploiement souverain) auprès d'un agent d'entiercement convenu, assortie d'une licence d'exploitation interne non exclusive activable uniquement en cas de liquidation judiciaire sans repreneur ou d'arrêt définitif de la maintenance.
- Cadence contractuelle des exercices PRA :
- Mensuel (Automatisé) : Restauration complète d'une base D1 témoin et d'un lot d'archives R2 dans un environnement isolé avec exécution des 50 contrôles d'intégrité FEC-MA.
- Semestriel (Test grandeur nature) : Exercice complet de bascule Failover vers l'infrastructure miroir marocaine suivi du protocole de Failback à perte nulle, sanctionné par un rapport d'audit horodaté communicable aux Commissaires aux Comptes et RSSI clients.
## Section 11 — Code de Référence : Orchestrateur Failback RPO=0, Avoirs SLA & Manifeste DIP
Ce module TypeScript pur sans aucun type any (packages/pra-reversibility/src/failback-and-dip.ts) implémente le calculateur d'avoirs SLA en centimes entiers, le vérificateur bloquant de parité cryptographique avant Failback et le constructeur de manifeste de réversibilité ISO 14641 :

```ts
const TEXT_ENCODER = new TextEncoder();

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? TEXT_ENCODER.encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 1. Calculateur déterministe d'avoirs SLA en centimes entiers et points de base (Zéro float)
 */
export interface SlaEvaluationInput {
  readonly monthlyBaseFeeHtCents: number;
  readonly targetUptimeBps: 9990 | 9995;     // 99,90% PME/OEC ou 99,95% Corporate/Souverain
  readonly totalMinutesInMonth: number;      // Ex: 43200 pour un mois de 30 jours
  readonly unexcusedDowntimeMinutes: number; // Hors maintenances autorisées et pannes externes DGI/Barid
}

export interface SlaEvaluationResult {
  readonly observedUptimeBps: number;
  readonly slaBreached: boolean;
  readonly creditRateBps: 0 | 1000 | 2500 | 5000;
  readonly creditAmountHtCents: number;
}

export function evaluateMonthlySlaCredit(input: SlaEvaluationInput): SlaEvaluationResult {
  if (
    !Number.isSafeInteger(input.monthlyBaseFeeHtCents) ||
    input.totalMinutesInMonth <= 0 ||
    input.unexcusedDowntimeMinutes < 0
  ) {
    throw new Error("SLA_INVALID_INPUT_PARAMETERS");
  }

  const clampedDown = Math.min(input.unexcusedDowntimeMinutes, input.totalMinutesInMonth);
  const upMinutes = input.totalMinutesInMonth - clampedDown;
  const observedUptimeBps = Math.floor((upMinutes * 10000) / input.totalMinutesInMonth);

  if (observedUptimeBps >= input.targetUptimeBps) {
    return {
      observedUptimeBps,
      slaBreached: false,
      creditRateBps: 0,
      creditAmountHtCents: 0,
    };
  }

  const creditRateBps: 1000 | 2500 | 5000 =
    observedUptimeBps >= 9950 ? 1000 : observedUptimeBps >= 9900 ? 2500 : 5000;

  const creditAmountHtCents = Math.round((input.monthlyBaseFeeHtCents * creditRateBps) / 10000);
  return {
    observedUptimeBps,
    slaBreached: true,
    creditRateBps,
    creditAmountHtCents,
  };
}

/**
 * 2. Vérificateur bloquant de parité cryptographique avant Failback (Standby Maroc -> Cloudflare Edge)
 */
export interface NodeLedgerParitySnapshot {
  readonly companyId: string;
  readonly pendingOutboxDeltasCount: number;
  readonly lastInvoiceIcvCounter: number;
  readonly archivedAipCount: number;
  readonly journalTailHashes: Readonly<Record<"AN" | "ACH" | "VTE" | "BNQ" | "CAI" | "OD", string>>;
}

export interface FailbackParityVerdict {
  readonly readyForDnsCutover: boolean;
  readonly mismatches: readonly string[];
}

export function verifyFailbackCryptographicParity(
  standbyMorocco: NodeLedgerParitySnapshot,
  cloudflarePrimary: NodeLedgerParitySnapshot
): FailbackParityVerdict {
  const mismatches: string[] = [];

  if (standbyMorocco.companyId !== cloudflarePrimary.companyId) {
    mismatches.push("COMPANY_ID_MISMATCH");
  }
  if (standbyMorocco.pendingOutboxDeltasCount !== 0) {
    mismatches.push(`PENDING_DELTAS_NOT_DRAINED:${standbyMorocco.pendingOutboxDeltasCount}`);
  }
  if (standbyMorocco.lastInvoiceIcvCounter !== cloudflarePrimary.lastInvoiceIcvCounter) {
    mismatches.push(
      `ICV_COUNTER_DRIFT:standby=${standbyMorocco.lastInvoiceIcvCounter},cf=${cloudflarePrimary.lastInvoiceIcvCounter}`
    );
  }
  if (standbyMorocco.archivedAipCount !== cloudflarePrimary.archivedAipCount) {
    mismatches.push(
      `AIP_ARCHIVE_COUNT_DRIFT:standby=${standbyMorocco.archivedAipCount},cf=${cloudflarePrimary.archivedAipCount}`
    );
  }

  const journals = ["AN", "ACH", "VTE", "BNQ", "CAI", "OD"] as const;
  for (const jCode of journals) {
    if (standbyMorocco.journalTailHashes[jCode] !== cloudflarePrimary.journalTailHashes[jCode]) {
      mismatches.push(`JOURNAL_HASH_DRIFT_${jCode}`);
    }
  }

  return {
    readyForDnsCutover: mismatches.length === 0,
    mismatches,
  };
}

/**
 * 3. Constructeur & Vérificateur de Manifeste de Réversibilité Décennale (OAIS DIP — ISO 14641 / Art. 211 CGI)
 */
export interface DipArchiveFileEntry {
  readonly relativePath: string; // Ex: '02_FEC_AND_SAFT/12345678FEC20261231.txt'
  readonly sizeBytes: number;
  readonly sha256Hex: string;
  readonly merkleBatchId?: string;
}

export interface Iso14641DipManifest {
  readonly standard: "ISO-14641-OAIS-DIP-MA-ART211";
  readonly exportedAtIso: string;
  readonly companyIce: string;
  readonly companyIf: string;
  readonly filesCount: number;
  readonly totalBytes: number;
  readonly files: readonly DipArchiveFileEntry[];
  readonly globalManifestSha256: string;
}

export async function buildIso14641DipManifest(params: {
  readonly exportedAtIso: string;
  readonly companyIce: string;
  readonly companyIf: string;
  readonly files: readonly DipArchiveFileEntry[];
}): Promise<Iso14641DipManifest> {
  const sortedFiles = [...params.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const totalBytes = sortedFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

  const canonicalDigestInput = sortedFiles
    .map((f) => `${f.relativePath}|${f.sizeBytes}|${f.sha256Hex}`)
    .join("\n");
  const globalManifestSha256 = await sha256Hex(
    `${params.companyIce}|${params.companyIf}|${params.exportedAtIso}\n${canonicalDigestInput}`
  );

  return {
    standard: "ISO-14641-OAIS-DIP-MA-ART211",
    exportedAtIso: params.exportedAtIso,
    companyIce: params.companyIce,
    companyIf: params.companyIf,
    filesCount: sortedFiles.length,
    totalBytes,
    files: sortedFiles,
    globalManifestSha256,
  };
}
```

## Section 12 — Harnais de Chaos Engineering & Vérification QA (Sessions P4-B & S5)
Lors de la Session P4-B, de la Barrière QA G4 et de la Session finale S5, l'agent Fisca-QA-Security-Auditor exécute cinq contrôles déterministes bloquants :
- Simulation Complète Failover -> Écriture -> Failback (RPO = 0) : Coupe l'accès simulé au pilote CLOUDFLARE_EDGE, vérifie la bascule vers SOVEREIGN_MOROCCO_VPS, émet 15 factures xHub séquentielles, 1 clôture Ticket Z Fisca POS et 20 écritures CGNC POSTED, déclenche le pont HTTP de retour et vérifie que verifyFailbackCryptographicParity retourne readyForDnsCutover === true avec zéro écart de hash et zéro trou de numérotation.
- Test de Blocage Failback sur Dérive d'Empreinte : Altère volontairement d'un octet le last_entry_hash du journal VTE côté cible et vérifie que l'orchestrateur refuse immédiatement la commutation DNS (JOURNAL_HASH_DRIFT_VTE).
- Audit d'Autonomie de l'Archive de Réversibilité ISO 14641 : Génère l'archive complète .zip d'un dossier test (incluant FEC-MA 24 colonnes, UBL XAdES, Factur-X, déclarations SIMPL et preuves de Merkle), l'extrait dans un répertoire temporaire vierge sans réseau et exécute node verify-archive-offline.mjs qui doit retourner un code de sortie 0 sur 100 % des fichiers.
- Vecteurs Mathématiques Avoirs SLA : Vérifie que sur un cabinet facturé 1013000 centimes HT/mois (10 130,00 MAD HT, cible 9990 bps) subissant 260 minutes d'indisponibilité sur 43 200 minutes (9939 bps), evaluateMonthlySlaCredit accorde exactement 25 % (2500 bps), soit 253250 centimes HT (2 532,50 MAD HT).
- Verrou de Sanctuarisation des Fenêtres Fiscales DGI : Simule dans le script de pré-déploiement CI/CD une date comprise entre le 15 et le 21 du mois (ex. 2026-11-19) sur une migration SQL marquée perturbatrice et vérifie son rejet automatique.

## Annexe V — Code de vérification numérique

> Origine : fichier `code.docx` fourni par le propriétaire du projet le 2026-11-13. C'est le code Python qui a servi à calculer et à contrôler les chiffres de ce document, suivi de la sortie obtenue par l'auteur.
> Chaque bloc a été réexécuté le 2026-11-13 (Python 3.12) et sa sortie comparée à celle de l'auteur. Pour le refaire : `python3 docs/specs/verification/verify-annexes.py`.
> Statut : pièce justificative des chiffres, pas du code de production. Elle n'ajoute aucune exigence et ne se copie dans aucun paquet. En cas d'écart avec le corps du document, `ERRATA.md` tranche.

> Les crédits attendus (253 250, 48 333 et 583 334 centimes) font foi. En production : `divRoundHalfUpBigInt` (ERRATA D-09).

### V.1 — Seuils de disponibilité, indisponibilité maximale sur 30 jours et crédits de service

<!-- verif:12-01:code -->
```python
# Verify exact SLA uptime thresholds, max monthly downtime (30-day month = 43,200 min = 2,592,000 sec), and SLA credit calculations in integer centimes / bps

seconds_30d = 30 * 24 * 3600 # 2,592,000 seconds

for sla_bps in [9995, 9990, 9950, 9900]:
    uptime_pct = sla_bps / 100
    max_down_sec = seconds_30d * (10000 - sla_bps) / 10000
    mins = int(max_down_sec // 60)
    secs = int(round(max_down_sec % 60))
    print(f"SLA {uptime_pct:.2f}% ({sla_bps} bps): max downtime/30d = {max_down_sec:.0f}s ({mins}m {secs:02d}s)")

# SLA Credit tiers (in bps of monthly fee HT):
# For ENT_SOUVERAIN (140,000 MAD/yr -> monthly base equivalent = round(14000000 / 12) = 1,166,667 centimes) or CROISSANCE_PME (89,000 centimes/mo) or Cabinet 60 dossiers (1,013,000 centimes/mo):
# Tier 1: < target SLA down to 99.50% (9950 bps) -> 10% credit (1000 bps)
# Tier 2: 99.00% (9900 bps) to 99.49% (9949 bps) -> 25% credit (2500 bps)
# Tier 3: < 99.00% (< 9900 bps) -> 50% credit (5000 bps)

def compute_sla_credit_cents(monthly_fee_ht_cents: int, target_sla_bps: int, observed_uptime_bps: int) -> int:
    if observed_uptime_bps >= target_sla_bps:
        return 0
    if observed_uptime_bps >= 9950:
        credit_bps = 1000
    elif observed_uptime_bps >= 9900:
        credit_bps = 2500
    else:
        credit_bps = 5000
    return round((monthly_fee_ht_cents * credit_bps) / 10000)

print("Cabinet 10,130 MAD HT @ 99.40% (target 99.90%):", compute_sla_credit_cents(1013000, 9990, 9940), "centimes")
print("Corporate 58,000 MAD/yr (monthly base 483,333c) @ 99.92% (target 99.95%):", compute_sla_credit_cents(483333, 9995, 9992), "centimes")
print("Souverain 140,000 MAD/yr (monthly base 1,166,667c) @ 98.80% (target 99.95%):", compute_sla_credit_cents(1166667, 9995, 9880), "centimes")
```

Résultat du code (réexécution : identique) :

<!-- verif:12-01:resultat -->
```text
SLA 99.95% (9995 bps): max downtime/30d = 1296s (21m 36s)
SLA 99.90% (9990 bps): max downtime/30d = 2592s (43m 12s)
SLA 99.50% (9950 bps): max downtime/30d = 12960s (216m 00s)
SLA 99.00% (9900 bps): max downtime/30d = 25920s (432m 00s)
Cabinet 10,130 MAD HT @ 99.40% (target 99.90%): 253250 centimes
Corporate 58,000 MAD/yr (monthly base 483,333c) @ 99.92% (target 99.95%): 48333 centimes
Souverain 140,000 MAD/yr (monthly base 1,166,667c) @ 98.80% (target 99.95%): 583334 centimes
```
