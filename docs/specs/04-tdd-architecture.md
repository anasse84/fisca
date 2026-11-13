<!--
ID canonique : Doc_04_TDD   |   Fichier : docs/specs/04-tdd-architecture.md
Source : « Document 04 » (DOCX remis le 2026-11-13), converti en Markdown.
Les ancres du backlog (Doc_04_TDD#Sxx) désignent les titres « ## Section xx » ci-dessous.
Corrections appliquées à la conversion : voir docs/specs/ERRATA.md (les entrées « Doc_04_TDD »).
En cas de contradiction, ERRATA.md prime sur ce texte.
-->

# Document 04 — Blueprint d'Architecture Technique TDD
Ce document constitue le dossier de conception technique (Technical Design Document) de Fisca (domaine fisca.ma), édité par SYNAPTIC SYSTEMS SARL AU (Rabat, Maroc). Il modélise le système selon le standard C4 (Contexte, Conteneurs, Composants) et fixe la stratégie multi-tenant, l'architecture hors-ligne du POS, l'orchestration asynchrone et l'adaptateur de portabilité souveraine en 12 sections nommées prêtes pour Hyperagent (Doc_04_TDD).
## Section 01 — Vue de Contexte Système (C4 Niveau 1) & Invariants
Fisca opère comme un nœud régalien et financier reliant en temps réel les entreprises marocaines, les cabinets d'expertise comptable, l'administration fiscale et l'écosystème bancaire.

```text
                  [Dirigeants PME / Caissiers POS]   [Fiduciaires OEC]   [DAF Grands Comptes]
                                  │                          │                    │
                                  ▼                          ▼                    ▼
┌──────────────────────┐    ┌──────────────────────────────────────────────────────────┐    ┌──────────────────────┐
│ Plateforme xHub DGI  │◄──►│                   PLATEFORME FISCA.MA                    │◄──►│ Barid eSign (DGSSI)  │
│ & Portail EDI SIMPL  │    │   Edge Cloudflare (Casa/Rabat) + Miroir Souverain Maroc  │    │ HSM CSC v2 & RFC3161 │
└──────────────────────┘    └─────┬──────────────────────┬───────────────────────┬─────┘    └──────────────────────┘
                                  │                      │                       │
                                  ▼                      ▼                       ▼
                      ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
                      │ Banques Maroc SIMT │  │ Infobip (WhatsApp  │  │ ERP Clients : Odoo │
                      │ Payzone & Factors  │  │ + SMS) & AWS SES   │  │ Sage 100/X3 & SAP  │
                      └────────────────────┘  └────────────────────┘  └────────────────────┘
```

- Exécution Edge au Maroc : Le trafic est terminé dans les points de présence Cloudflare de Casablanca et Rabat avec une latence réseau inférieure à 15 ms.
- Séparation neuro-symbolique stricte : Les modèles IA produisent uniquement du JSON validé par Zod, tandis que du code déterministe exécute 100 % de la fiscalité en centimes entiers.
- Loi séparée du moteur : Aucune règle fiscale ni cellule EDI n'est codée en dur ; tout est évalué depuis des tables déclaratives alimentées par le LLM Wiki.
- Souveraineté et réversibilité : Les données résident sous juridiction européenne reconnue par la CNDP avec réplication vers un miroir souverain au Maroc.
## Section 02 — Cartographie des Conteneurs & Monorepo (C4 Niveau 2)
Le dépôt GitHub privé fisca est structuré en Monorepo pnpm + Turborepo regroupant six conteneurs d'exécution distincts reliés par des contrats TypeScript partagés :

| Conteneur Monorepo | Technologie & Runtime | Domaine / Entrée | Langues Actives | Rôle Principal |
|---|---|---|---|---|
| marketing-astro | Astro 5 SSR sur Workers | fisca.ma | 6 langues | Acquisition SEO/GEO/AEO et outils gratuits |
| web-saas + capacitor | React 19, Vite, Tailwind v4 | app.fisca.ma / Mobile | 6 PME / 3 B2B | Portails PME, Fiduciaire OEC et Corporate |
| pos-pwa | React 19 + SQLite WASM | pos.fisca.ma / Tablette | 6 langues | Caisse tactile hors-ligne SCE Art. 145 CGI |
| api-hono | Hono v4, Workers, DO, D1 | api.fisca.ma / mcp | Multilingue | Cœur métier, E2EE, XSD, MCP et agents IA |
| containers/ | Java 21, Python 3.12, Camel | RPC interne isolé | Bilingue FR/AR | Validation PHIVE, Factur-X, Docling et ERP |
| standby-vps | Node Hono, Postgres, MinIO | Cas d'urgence / OIV | Multilingue | Miroir souverain Maroc et serveur de secours |

- Découplage Astro / React : Le site vitrine Astro génère du HTML pur zéro-JS superflu pour maximiser l'indexation SEO et IA, sans charger le bundle applicatif comptable.
- Mutualisation UI et Mobile : L'application web-saas et la caisse pos-pwa partagent la bibliothèque packages/ui-mercury et sont compilées en applications natives iOS/Android via Capacitor.
- Isolation des conteneurs lourds : Les bibliothèques Java et Python s'exécutent dans des microVMs Cloudflare Containers appelées uniquement par RPC privé depuis les Workers.
## Section 03 — Architecture des Composants Cœur (C4 Niveau 3)
L'application apps/api-hono délègue toute sa logique métier à dix packages internes purs (testables hors-ligne en moins de 5 secondes via Vitest) :
- packages/shared-types : Définit les types entiers (Centimes, Bps, Milli), les validateurs Modulo 97 (ICE 15 chiffres et RIB 24 chiffres), le moteur FSM et le contrat StorageAdapter.
- packages/db-schema : Contient les schémas Drizzle ORM séparés pour CONTROL_PLANE_DB et TENANT_DB, incluant les triggers d'inaltérabilité PAF du Grand Livre.
- packages/crypto-e2ee : Implémente E2eeFiscalCryptoEngine en WebCrypto pur (enveloppes RSA-OAEP multi-acteurs, liaison AAD, Blind Index HMAC-SHA256 et séquestre de Shamir 2-sur-3).
- packages/fiscal-ast : Exécute l'interpréteur déclaratif des règles du CGI et le compilateur Wiki-vers-AST (TVA 2026 à 20 %/10 %/0 %, espèces 5 000 MAD, RAS-TVA et Loi 69-21).
- packages/ubl-xades : Construit l'UBL 2.1, pilote le conteneur Java (ph-ubl / PHIVE / Mustangproject) et signe en XAdES-Baseline-T via Loi4320SignatureEngine (CSC API v2.0 + RFC 3161).
- packages/vault-merkle : Chiffre chaque paquet OAIS AIP en AES-256-GCM sur R2 et construit l'Arbre de Merkle quotidien réduisant l'horodatage à un seul jeton TSA par jour.
- packages/edi-simpl : Génère et valide par XSD les archives SIMPL-TVA v4.0, SIMPL-IS v2.0.3 (1 500+ codeEdi), État 9421, DRVT v2.0.3, État des Ventes et Loi 69-21.
- packages/fec-auditor : Exécute les 50+ contrôles préventifs (caisse 5161 créditrice, associé 3463 débiteur, cadrage TVA) et produit le FEC-MA à 24 colonnes ainsi que le SAF-T CGNC.
- packages/ai-agents : Orchestre les 11 agents proactifs neuro-symboliques, la mémoire SQLite Hindsight, l'anonymiseur PII en RAM et le serveur MCP OAuth 2.1.
- packages/billing-metering & factorflow : Liquide la facturation fiduciaire au dossier, les licences POS et l'escompte dynamique 48h avec registre anti-double mobilisation.
## Section 04 — Multi-Tenancy : Isolation Database-per-Tenant sur D1
Pour éliminer tout risque de fuite comptable inter-entreprises, Fisca applique le modèle Database-per-Tenant dès le forfait Solo jusqu'aux cabinets gérant 500 sociétés :
- Plan de contrôle central (CONTROL_PLANE_DB) : Stocke uniquement les comptes utilisateurs, les organisations, les abonnements, l'annuaire national morocco_company_directory et la table de routage tenant_databases (company_id → d1_database_uuid).
- Provisionnement instantané à la création d'un dossier : Lorsqu'une PME s'inscrit ou qu'un fiduciaire ajoute un client, un workflow appelle l'API Cloudflare D1 (--location=weur / juridiction eu conforme Art. 43 Loi 09-08 CNDP), applique les migrations SQL CGNC et scelle le GENESIS_HASH des six journaux en moins de 4 secondes.
- Résolution sécurisée côté serveur : Aucun identifiant de base n'est accepté depuis le navigateur ni depuis un outil IA ; le middleware Hono vérifie le jeton de session, contrôle l'appartenance de l'utilisateur (ou le mandat actif du cabinet OEC dans tenant_key_grants) et injecte l'instance Drizzle isolée dans le contexte de requête.
- Orchestrateur de migrations par vagues (Rolling Schema Migrator) : Chaque table TENANT_DB porte un numéro de version schema_version ; lors d'une mise à jour applicative, une file Cloudflare Queue migre les bases par lots de 50, et le middleware applique la migration à la volée (Just-in-Time) si un client ouvre son dossier avant le passage du lot.
- Marque blanche Fiduciaire & Souveraineté Grands Comptes : Cloudflare for SaaS route automatiquement les domaines personnalisés des cabinets (compta.moncabinet.ma) avec certificats TLS gérés, tandis que Cloudflare Hyperdrive permet aux clients de l'offre ENT_SOUVERAIN de brancher une base PostgreSQL physique hébergée à Casablanca ou Rabat.
## Section 05 — Architecture Offline-First de Fisca POS Tactile & POS Bridge
Un commerce ou restaurant marocain ne peut jamais bloquer sa file d'attente en caisse lors d'une coupure fibre ou 4G. Le conteneur apps/pos-pwa fonctionne selon une architecture Local-First autonome pendant 72 heures :

```ts
[Tablette / PC Caisse : React 19 + Service Worker PWA]
   ├──► Moteur SQLite WASM persistant sur OPFS (Catalogue, Prix, Taxes 2026, File Outbox)
   ├──► Séquenceur Local Préfixé (POS-M01-C02-2026-000841) + Chaînage SHA-256 immédiat (< 50 ms)
   ├──► Impression Thermique Directe ESC/POS (WebUSB / WebBluetooth / Socket IP local + KDS Cuisine)
   └──► Synchroniseur Résilient (Dès retour réseau) ──► POST /api/v1/pos/sync-batch (Idempotent)
                                                               │
                                   ┌───────────────────────────┴───────────────────────────┐
                                   ▼                                                       ▼
                     [Clôture Ticket Z Scellée R2]                         [Portail QR Conversion B2C -> B2B]
               (E-Reporting B2C + Écriture VTE + Lettrage TPE)       (Facture xHub DGI + Extourne B2C sans doublon)
```

- Stockage local OPFS inaltérable : Le moteur SQLite WASM monté sur Origin Private File System persiste sur disque local chaque ticket validé avec son empreinte SHA-256 liée au ticket précédent de ce terminal.
- Absence mathématique de collision hors-ligne : À l'activation d'une licence POS_TACTILE, le serveur attribue au terminal un préfixe exclusif (POS-{MAG}-{TERM}) ; trois tablettes encaissant simultanément sans internet conservent chacune une chaîne séquentielle continue sans aucun conflit à la reconnexion.
- Périphériques matériels universels : Le pilote TypeScript génère directement la séquence d'octets ESC/POS (bilingue FR/AR + QR Code TLV de conversion facture + ouverture tiroir-caisse RJ11) via WebUSB, WebBluetooth ou passerelle réseau locale pour les imprimantes Ethernet de cuisine.
- Neutralisation atomique B2C vers B2B : Lorsqu'un client professionnel scanne le QR Code de son ticket pour demander une facture avec son ICE à 15 chiffres, le backend vérifie UNIQUE(pos_ticket_id) : si le Ticket Z du jour est déjà clôturé en comptabilité, une écriture d'extourne B2C du même montant HT/TVA est passée dans la même transaction D1 que la facture B2B xHub afin d'interdire toute double taxation sur SIMPL-TVA et le CPC.
## Section 06 — Traitements Asynchrones, Files, Idempotence & DLQ
L'architecture répartit la charge asynchrone entre trois primitives complémentaires selon le besoin de cohérence transactionnelle :

| Primitive Cloudflare | Usage Métier dans Fisca | Garantie d'Exécution | Mécanisme d'Idempotence |
|---|---|---|---|
| Durable Objects | InvoiceSequencerDO & mémoire Hindsight | Cohérence forte mono-thread | Compteur SQLite transactionnel par société |
| Workflows | Clearance xHub DGI & relance du 10 du mois | Saga durable multi-étapes | ID d'instance déterministe wf-{company}-{doc} |
| Queues + DLQ | Lots OCR IA, exports EDI, réplication miroir | At-Least-Once par lots de 25 | Table processed_events (sha256 conservé 72h) |
| Cron Triggers | Arbre de Merkle 23h59, Loi 69-21, LTA 24 mois | Planification horaire exacte | Verrou par date batch_date UNIQUE |

- Protection contre les livraisons doubles (At-Least-Once) : Comme une file de messages peut rejouer un événement après un timeout réseau, chaque consommateur vérifie d'abord event_id dans la table locale processed_queue_messages avant toute écriture comptable ou envoi WhatsApp.
- Traitement des Dead-Letter Queues (DLQ) : Après épuisement des tentatives avec recul exponentiel (5s à 6h), le message atterrit dans sa file dlq-* dédiée, crée une alerte visible dans la console cabinet/admin et bascule la pièce en PIECE_A_CONTROLER sans jamais bloquer le reste du lot.
## Section 07 — Conteneurs Linux Isolés & Architecture des Connecteurs ERP
Certaines briques open-source de référence mondiale exigent un runtime JVM ou Python natif ; elles tournent dans des microVMs Cloudflare Containers pilotées à la demande avec mise en veille automatique à zéro requête :
- Container 1 — fiscal-java (Java 21 GraalVM/Temurin) : Embarque ph-ubl et PHIVE (validation XSD + Schematron EN 16931 / CIUS-MA), Mustangproject + Apache PDFBox (assemblage PDF/A-3b bilingue FR/AR avec police Noto Sans Arabic intégrée) et esig/dss pour l'extension PAdES-LTA. Un générateur UBL/XML-DSig pur TypeScript reste embarqué dans le Worker comme mode dégradé instantané.
- Container 2 — docling-python (Python 3.12 + FastAPI interne) : Exécute Docling (TableFormer) pour reconstruire sans perte les tableaux multi-pages des factures complexes et des relevés PDF des banques marocaines.
- Container 3 — camel-bridge (Apache Camel) : Fournit les connecteurs normalisés SAP IDoc/RFC, Oracle, Sage X3, SFTP et AS4 reliés aux réseaux privés des Grands Comptes via Cloudflare Tunnel et Hyperdrive.
- Connecteurs locaux packagés : Le module Odoo l10n_ma_edi_clearance (Python, v17 à v20) dialogue par webhooks signés HMAC-SHA256 sur validation de facture et sur chaque lettrage account.partial.reconcile, tandis que le service Windows Sage100EdgeAgent (.NET 8) extrait incrémentalement SQL Server (WITH (NOLOCK) sur cbMarq) et réinjecte exclusivement via Objets100cLib (IPMEncoder) ou fichiers .PNM à 108 caractères fixes.
## Section 08 — Pipeline Neuro-Symbolique IA, Model Tiering & Serveur MCP
Pour maintenir un coût marginal d'infrastructure inférieur ou égal à 5,00 MAD/mois par société active contre 50 000 EUR/an sur les architectures classiques, Cloudflare AI Gateway route chaque tâche selon trois niveaux stricts :
- Niveau 0 — Déterministe Pur (0,00 MAD — environ 75 % des flux) : Lecture directe du XML intégré aux factures Factur-X/UBL 2.1, parsing des relevés MT940 / CFONB 120 / camt.053, calculs CGI/CGNC, équilibrage Liasse IS et contrôles continus SQL.
- Niveau 1 — Vision Légère & Classification Rapide : Sur scans et photos WhatsApp, extraction typée via Clairic, Qwen2.5-VL, Nanonets-OCR-s (tampons et signatures) et AtlasOCR, suivie de la recherche vectorielle PCGE dans Cloudflare Vectorize et du routage binaire/choix via Clef-flash.
- Niveau 2 — Raisonnement sur Escalade Anonymisée : Réservé à l'analyse comparative N/N-1 du dossier de clôture, à la compilation de nouvelles lois du LLM Wiki et aux requêtes complexes du copilote, après remplacement en RAM de toutes les données identifiantes (noms, ICE, RIB, CIN) par des jetons pseudonymes réversibles.
- Gouvernance Hindsight, AI Crafters & MCP : Chaque société possède dans son Durable Object les trois tables mémoire Hindsight (world_facts, experiences, evolving_opinions), applique matériellement les 4 règles d'arrêt d'AI Crafters et expose ses outils typés sur mcp.fisca.ma/mcp via createMcpHandler (OAuth 2.1, traces OpenTelemetry GenAI et zéro outil de virement direct).
## Section 09 — Intégrations Externes, Timeouts & Disjoncteurs (Circuit Breakers)
Chaque appel réseau sortant est encapsulé dans un disjoncteur stockant son état d'ouverture dans Durable Object / KV afin d'éviter toute panne en cascade :

| Service Externe | Timeout Strict | Seuil Disjoncteur | Stratégie de Repli Automatique (Fallback) |
|---|---|---|---|
| API Nationale xHub DGI | 12 s | 5 erreurs 5xx / 1 min | Mise en file Cloudflare Workflows + scellement local provisoire |
| Barid eSign HSM & TSA | 8 s | 3 timeouts consécutifs | Mise en attente de signature différée + alerte tableau de bord |
| Infobip WhatsApp API | 10 s | Non remis sous 15 s | Bascule immédiate vers SMS expéditeur FISCA puis Email Amazon SES |
| Payzone Paiement | 15 s | 4 erreurs passerelle | File de réessai webhook + maintien période de grâce 14 jours |
| Portails DGI / CNSS KYB | 20 s | Captcha ou maintenance | Cache chiffré 30j + vérification forensique PDF locale + revue manuelle |

## Section 10 — Adaptateur de Portabilité (StorageAdapter) & Miroir Souverain
Conformément à notre choix architectural, 100 % du code métier est découplé des primitives Cloudflare via l'interface packages/shared-types/src/storage-adapter.ts. En production nominale, l'adaptateur utilise Cloudflare (D1 + R2 + Queues) tout en poussant une copie signée asynchrone vers le serveur miroir ; pour l'offre ENT_SOUVERAIN (Loi 05-20 DGSSI) ou en cas de bascule d'urgence PRA, le même code tourne sans modification sur PostgreSQL + MinIO WORM + BullMQ/Redis hébergés au Maroc :

```ts
export interface SqlStatementParams {
  readonly sql: string;
  readonly params: readonly (string | number | null)[];
}

export interface WormPutOptions {
  readonly retentionUntilIso: string; // Ex: Clôture + 10 ans + 1 jour (Art. 211 CGI)
  readonly sha256Hex: string;
  readonly customMetadata: Readonly<Record<string, string>>;
}

export interface TenantSqlDriver {
  readonly tenantId: string;
  query<TRow>(stmt: SqlStatementParams): Promise<readonly TRow[]>;
  executeBatchAtomically(statements: readonly SqlStatementParams[]): Promise<{ readonly totalChanges: number }>;
}

export interface WormVaultDriver {
  putImmutableObject(key: string, ciphertext: Uint8Array, options: WormPutOptions): Promise<{ readonly etag: string }>;
  getObjectBytes(key: string): Promise<{ readonly bytes: Uint8Array; readonly metadata: Readonly<Record<string, string>> } | null>;
}

export interface AsyncQueueDriver {
  enqueueIdempotent<TPayload>(
    queueName: string,
    idempotencyKey: string,
    payload: TPayload,
    delaySeconds?: number
  ): Promise<void>;
}

export interface FiscaInfrastructureAdapter {
  readonly providerMode: "CLOUDFLARE_EDGE" | "SOVEREIGN_MOROCCO_VPS";
  getControlPlaneDb(): TenantSqlDriver;
  getTenantDb(companyId: string): Promise<TenantSqlDriver>;
  getLegalVault(): WormVaultDriver;
  getQueue(): AsyncQueueDriver;
}

/**
 * Enveloppe de réplication asynchrone poussée vers le Miroir Souverain Maroc et rejouée en sens inverse lors du Failback
 */
export interface SignedReplicationDelta {
  readonly deltaId: string;
  readonly companyId: string;
  readonly sequenceMonotonic: number;
  readonly originProvider: "CLOUDFLARE_EDGE" | "SOVEREIGN_MOROCCO_VPS";
  readonly sqlBatchEncryptedB64: string;
  readonly r2AipKeysAdded: readonly string[];
  readonly latestJournalHashes: Readonly<Record<string, string>>;
  readonly hmacSignatureHex: string;
}
```

- Protocole de retour sans perte (Failback Bridge RPO = 0) : Si le trafic a basculé temporairement sur SOVEREIGN_MOROCCO_VPS, le retour vers CLOUDFLARE_EDGE active un verrou de lecture seule de 5 secondes, transmet tous les paquets SignedReplicationDelta accumulés vers l'API d'ingestion Cloudflare, vérifie l'égalité bit-à-bit des derniers entry_hash de chaque journal CGNC et des racines de Merkle, puis rouvre le trafic nominal.
## Section 11 — Configuration Maître Multi-Services (wrangler.toml)
Ce fichier configure l'application apps/api-hono en forçant la juridiction Union Européenne sur le stockage conformément à l'Article 43 de la Loi 09-08 (CNDP) :

```toml
name = "fisca-core-api"
main = "src/index.ts"
compatibility_date = "2026-11-01"
compatibility_flags = ["nodejs_compat"]

[vars]
INFRA_PROVIDER_MODE = "CLOUDFLARE_EDGE"
DGI_XHUB_ENVIRONMENT = "sandbox"

# 1. Base Maîtresse Control Plane (Juridiction UE - Liste blanche CNDP Loi 09-08)
[[d1_databases]]
binding = "CONTROL_PLANE_DB"
database_name = "fisca-control-plane-eu"
database_id = "00000000-0000-0000-0000-000000000000"

# 2. Coffre-fort Probant WORM 10 ans (Art. 211 CGI - Zéro frais d'Egress, Juridiction UE)
[[r2_buckets]]
binding = "R2_LEGAL_VAULT"
bucket_name = "fisca-worm-vault-10y-eu"
jurisdiction = "eu"

# 3. Cache Haute Vitesse des Entitlements, Règles AST Actives & Disjoncteurs
[[kv_namespaces]]
binding = "FISCA_FAST_KV"
id = "00000000000000000000000000000000"

# 4. Durable Objects : Séquenceur Fiscal sans trou, Mémoire Hindsight & Conteneurs Linux
[durable_objects]
bindings = [
  { name = "INVOICE_SEQUENCER", class_name = "InvoiceSequencerDO" },
  { name = "AGENT_HINDSIGHT_MEMORY", class_name = "AgentHindsightMemoryDO" },
  { name = "FISCAL_JAVA_CONTAINER", class_name = "FiscalJavaContainerDO" },
  { name = "DOCLING_PYTHON_CONTAINER", class_name = "DoclingPythonContainerDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["InvoiceSequencerDO", "AgentHindsightMemoryDO"]

# 5. MicroVMs Linux Serverless (ph-ubl, PHIVE, Mustangproject, esig/dss & Docling)
[[containers]]
class_name = "FiscalJavaContainerDO"
image = "../../containers/fiscal-java/Dockerfile"
max_instances = 20

[[containers]]
class_name = "DoclingPythonContainerDO"
image = "../../containers/docling-python/Dockerfile"
max_instances = 15

# 6. Workflows Durables (Clearance xHub DGI & Relances mensuelles)
[[workflows]]
name = "dgi-clearance-workflow"
binding = "DGI_CLEARANCE_WORKFLOW"
class_name = "DgiClearanceWorkflow"

# 7. Files Asynchrones (Ingestion OCR, Sync ERP & Miroir Souverain Maroc)
[[queues.producers]]
queue = "fisca-invoice-ingestion"
binding = "INVOICE_QUEUE"

[[queues.producers]]
queue = "fisca-sovereign-mirror"
binding = "SOVEREIGN_MIRROR_QUEUE"

# 8. Inférence Workers AI & Index Vectoriel CGNC / CGI
[ai]
binding = "AI"

[[vectorize]]
binding = "CGNC_VECTOR_INDEX"
index_name = "fisca-maroc-cgnc-cgi-v1"
```

## Section 12 — Observabilité, Sécurité Réseau & Validation du Harnais
- Sécurité périmétrique et chiffrement : Tous les échanges externes imposent TLS 1.3 (et authentification mutuelle mTLS vers xHub DGI, les passerelles ERP et le miroir souverain), complétés par des enclaves RAM sans disque pour le déchiffrement éphémère E2EE via HPKE (RFC 9180).
- Traçabilité OpenTelemetry bout-en-bout : Chaque requête HTTP, message Queue et décision d'agent IA émet un trace_id W3C normalisé (OpenTelemetry GenAI) corrélant l'écriture SQL, le coût en tokens et la pièce justificative R2 sans jamais journaliser de secret ni de donnée personnelle en clair.
- Critères d'acceptation TDD pour Hyperagent (Sessions S0 et Vague 1) : Le harnais automatisé doit prouver par tests d'intégration que le même jeu de 50 écritures comptables et de scellement AIP produit exactement les mêmes empreintes SHA-256 lorsqu'il est exécuté sur le pilote CLOUDFLARE_EDGE (Miniflare/Wrangler local) et sur le pilote SOVEREIGN_MOROCCO_VPS (SQLite/Postgres en mémoire).
