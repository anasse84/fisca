# Préparation de la vague 3 (P3-A, P3-B, P3-C, barrière G3)

Rédigé par le pilote le 2026-11-14, à partir de `main` `3496824`, de l'ERRATA révision e, des lignes du backlog et de la section 04 du document d'état. Il ne remplace ni le backlog ni les spécifications : il rassemble ce qu'une voie doit savoir avant de commencer, pour qu'aucune information absente ne la bloque. Chaque point « manque » porte une étiquette : **PROPOSITION DU PILOTE (à valider)** (reste dans l'esprit des arbitrages existants, le pilote l'applique sauf avis contraire) ou **À TRANCHER PAR LE PROPRIÉTAIRE** (question exacte, option par défaut). Les entrées externes sont aussi dans `prerequis-proprietaire.md`.

## 0. Avant de lancer la vague 3

| N° | Préalable | État | Qui |
|---|---|---|---|
| J-1 | Ticket de jonction « J2 » (voir section 4) : migration v12, `ESC_POS_TCP_IP`, genèse de 45 caractères dans `InvoiceSequencerDO`, demandes de jonction de P2-A, chiffrement des réponses d'idempotence, permission d'export EDI | **Non fait, non autorisé** (le propriétaire a demandé l'arrêt après la vague 2) | BACK-1, audité, avant P3-A |
| J-2 | Cahiers des charges EDI de la DGI (SIMPL-TVA, SIMPL-IS, 9421, DRVT, Loi 69-21) | Annoncés par le propriétaire, **non reçus** dans le fil du pilote | Propriétaire : `docs/reference/dgi/` + `SOURCE.md` |
| J-3 | Décision sur la liste des cellules SIMPL-IS et leurs `codeEdi` (voir T-P3A-05) | Ouverte | Propriétaire |
| J-4 | Fournisseur d'inférence et accès réseau aux poids de modèles (voir T-P3B-01 et T-P3B-03) | Ouverte | Propriétaire |
| J-5 | Plan comptable de production : amorce avec `vat_regime_role` (34551 `VAT_RECOVERABLE_IMMOB`, 34552 `VAT_RECOVERABLE_CHARGES`, 34558 `VAT_RECOVERABLE_PENDING`, 44558 `VAT_COLLECTED_PENDING`, 44551 `VAT_COLLECTED_DUE`) | Non fait | Ticket de jonction ou P4-C |
| J-6 | Bootstrap des voies : P3-A `--java`, P3-B `--python`, P3-C `--java --dotnet --python` ; npm : `RequestNetworkAccess` une fois par fil | — | Voies |

## 1. Socle disponible sur `main` (à réutiliser, jamais à recopier)

| Besoin | Où | Remarque |
|---|---|---|
| Schéma XML provisoire résolu par un seul point | `packages/ubl-xades/src/schema-resolver.ts` (`resolveSchema`), `profile.ts`, `profiles/cius-ma-provisional/` | Patron à reprendre pour SIMPL : officiel si présent dans `docs/reference/dgi/`, sinon provisoire marqué |
| Validation XSD hors ligne | `pnpm test:xsd` (script `packages/ubl-xades/scripts/test-xsd.ts`, xmllint) | À étendre ou à dupliquer pour `packages/edi-simpl` (SEAM : script racine déjà `pnpm --filter @fisca/ubl-xades test:xsd`) |
| Écarts connus d'un profil provisoire | `packages/ubl-xades/src/known-phive-deviations.ts` | Patron : une constante unique, un test qui affirme exactement la liste |
| Balance à 6 colonnes | vue `v_cgnc_trial_balance_6col` (`packages/db-schema/src/tenant.ts`, `tenant-drizzle.ts` : `cgncTrialBalance6col`) | Source du DSL SIMPL-IS |
| Règles fiscales datées | `packages/fiscal-ast` (`DynamicFiscalAstEngine`, `FISCAL_RULE_CODES`, tables `dynamic_fiscal_rules`) | Aucun taux ni plafond en dur (loi 2) |
| Grand livre | `apps/api-hono/src/core/immutable-cgnc-ledger-engine.ts` et routes `ledger` | Gelé : lecture seulement |
| Coffre et scellement | `packages/vault-merkle` (AIP, racine quotidienne, RFC 3161) | Pour le scellement R2 de T-P3A-12 |
| Webhooks signés | `verifySignedWebhookPayload` (`packages/shared-types/src/api-contracts.ts`), tolérance 300 s | Pour P3-C |
| Routeurs à ports | `createLedgerRoutes`, `createInvoicesRoutes`, `createPosRoutes`, `createAuthRoutes` | Patron de toute nouvelle route (ADR-19) ; pas de gestionnaire `fetch` de production avant P4-C |
| Erreurs normalisées | `ProblemDetailsSchema`, `apps/api-hono/src/core/problem-details.ts` | `errorCode` stable, `detail` fixe |
| Idempotence | `apps/api-hono/src/core/idempotency.ts`, table `idempotency_records` | Réserve : base64 non chiffré (avant G3) |
| Validateurs | `Ice15Schema`, validateur de RIB (`packages/shared-types/src/rib.ts`), `assertValidCompanyId` | |
| Pseudonymisation | `EphemeralRamPiiScrubber` (`packages/crypto-e2ee`) | À durcir avant P3-B (ICE collé à une lettre, retour à la ligne, tiret bas) |
| Garde SQL Sage | garde `NOLOCK` par table (PR n° 8), générateur `.PNM` testé (`qa-harness`, `assertValidSage100PnmBuffer`) | D-22 |

## 2. Décisions déjà prises qui s'appliquent

- **ERRATA B-13 et directive T-P3A-01 (D-23)** : si les XSD officiels sont absents, on ne bloque pas (`MISSING_INPUT` exclu) ; XSD structurels stricts dérivés de Doc_07 §§ 08 à 10, validés par xmllint, marqués `PROVISIONAL_STRUCTURAL_XSD_PENDING_OFFICIAL_DGI_PACK` ; jamais « conforme DGI ».
- **FEC** : 18 colonnes standard dans l'ordre confirmé (JournalCode, JournalLib, EcritureNum, EcritureDate, CompteNum, CompteLib, CompAuxNum, CompAuxLib, PieceRef, PieceDate, EcritureLib, Debit, Credit, EcritureLet, DateLet, ValidDate, Montantdevise, Idevise) + 6 extensions marocaines (TiersIF, TiersICE, ClearanceUUID, ModePaiementDGI, EntryHashSHA256, PrevHashSHA256) ; mention « Profil Fisca Art. 211 CGI en attente d'arrêté technique DGI » (D-23).
- **Comptes** : 34551 = TVA récupérable sur immobilisations, 34552 = sur charges ; le moteur choisit par rôle de plan, jamais par numéro (ADR-21).
- **Sage** : `.PNM` de 108 caractères (D-22) ; `Objets100cLib` derrière `ISageWriter` dans un projet `net8.0-windows` (B-14).
- **Régime provisoire** : « Validation simulée », jamais « conforme », « homologué » ou « certifié ».
- **Idempotence et en-tête** : `X-Fisca-Company-Id` au format `[A-Za-z0-9_-]{1,64}` ; `Idempotency-Key` UUIDv7, 72 h.
- **Tuple d'empreinte** : voir ADR-15 ; deux amorces (45 caractères pour le grand livre et le PIH, 64 zéros pour le POS).
- **Route CTR-API-12** : acceptera 0 candidate pour la mise en suspens 3497/4497 (D-23) : à monter en jonction (le cœur est gelé).
- **Scrubber et injection** : à durcir avant P3-B (G1).

## 3. Session P3-A (voie EDI-1) : XSD SIMPL, exporteurs, FEC, route EDI

Branche `feat/w3-edi-simpl-fec` (voir `.meta/session-scopes.json`). Périmètre : `packages/edi-simpl`, `packages/fec-auditor`, `apps/api-hono/src/routes/edi`.

| Ticket | À réutiliser | Manques, incohérences, oublis détectés | Proposition ou question |
|---|---|---|---|
| T-P3A-01 : XSD et validateur | `resolveSchema` (patron), `docs/reference/dgi/` | Le titre dit « schémas officiels » alors qu'ils ne sont pas publiés ; Doc_07 § 12 situe les XSD dans `packages/edi-simpl/xsd/`, et le garde de périmètre n'autorise pas `docs/reference/` | **PROPOSITION DU PILOTE** : officiels lus dans `docs/reference/dgi/<sujet>/` (dépôt par le propriétaire, PR du pilote) ; provisoires dans `packages/edi-simpl/xsd/provisional/` avec l'en-tête `PROVISOIRE — dérivé de Doc_07, non publié par la DGI` ; un seul point `resolveSimplSchema` ; un script `test:xsd` propre au paquet, appelé par le script racine |
| T-P3A-02 : SIMPL-TVA v4.0 | Doc_07 § 08 : `prorata` entre `tx` et `mp`, `mp/id` de 1 à 7, unicité `(if_fournisseur, num_facture)`, `mht + tva == ttc` au centime | Règles de rejet connues seulement par le texte de Doc_07 ; `prorata` entier de 0 à 100 alors que la base porte `deduction_prorata_pct`, entier de 0 à 100 (exception posée dans `packages/db-schema/AGENTS.md`) | **PROPOSITION** : XSD structurel strict + contrôles métier en TypeScript ; vecteurs chiffrés marqués `NON RECOUPÉ` |
| T-P3A-03 : RAS-TVA (Art. 117) | `fiscal-ast` : `RAS_TVA_ART_117` | Taux 75 % / 100 %, seuil de 5 000 MAD TTC et délai de 6 mois de l'attestation : valeurs de Doc_07, `NON RECOUPÉ` (ERRATA section E) ; les lire de l'AST, pas du code | **PROPOSITION** : aucune valeur codée en dur ; vecteur d'or VEC-CGI-03 réutilisé |
| T-P3A-04 : Loi 69-21 (ADC500B-23I) | `fiscal-ast` : `PAYMENT_DELAY_LAW_69_21`, VEC-CGI-02 (46 jours, 2 mois entamés, 360 bps, 44 500 c) | Délais 60 / 120 / 180 j et `Math.ceil` : `Math.ceil` sur un montant en dirhams est une arithmétique décimale interdite par la loi 1 (flottant) | **PROPOSITION** : arrondi au dirham supérieur par division entière de centimes (`ceilDivBigInt`), test des cas limites ; jamais `Math.ceil` sur un nombre |
| T-P3A-05 : DSL sur `v_cgnc_trial_balance_6col` | vue, colonne `mapping_rule_json` (Doc_06 § 02) | **Les « 5 opérateurs » ne sont énumérés dans aucune spécification** (seul un commentaire de DDL les mentionne) ; **la table des 1 500+ cellules et leurs `codeEdi` n'existe pas dans le dépôt** ; seules sont citées par Doc_07 § 09 les cellules 14045 à 14052, 14061 à 14064, 18009, 18010, 18012, 18013 et les cellules exclues 11501 à 11504 | **À TRANCHER PAR LE PROPRIÉTAIRE** : (a) fournir la table complète (cellule, `codeEdi`, règle, tableau) ou le XSD officiel, (b) nommer les 5 opérateurs. **Option par défaut** : sous-ensemble documenté (les cellules citées par Doc_07) avec un ensemble d'opérateurs minimal et nommé par le ticket (somme, différence, constante, référence de compte, signe), marqué provisoire |
| T-P3A-06 : ZIP SIMPL-IS | Doc_07 § 09 (< 1 Mo, totaux Tableaux 3, 4, 8, omission 11501 à 11504) | Dépend de T-P3A-05 | Même option par défaut |
| T-P3A-07 : État des ventes par client | Vue de balance, plan comptable | Contrôle « CA B2B + POS B2C == classe 71 » exige le plan comptable de production (comptes 7111, 7119, 7129, 3421) non amorcé ; comptes 7119 et 7129 cités sans définition | **PROPOSITION** : le test utilise le plan de test du harnais ; l'amorce de production est le préalable J-5 |
| T-P3A-08 : DRVT (3 archives) | `fiscal-ast` | RAS 5 % / 10 %, loyers 10 % / 15 % dès 120 000 MAD bruts par an, balise `exercicePrelevement`, `typeVersementIS` de 1 à 6 : `NON RECOUPÉ` | **PROPOSITION** : valeurs dans l'AST datée, vecteurs `NON RECOUPÉ` listés pour l'expert-comptable (T-S5-03) |
| T-P3A-09 : État 9421 | 38 balises de tête + 10 collections ; `PAYROLL_9421_READ_EXPORT` ; `can_access_payroll_pii` | Données personnelles (CNIE, CNSS, salaires) : jamais en clair dans les journaux ; export réservé aux rôles autorisés | **PROPOSITION** : tests d'absence de PII dans les messages d'erreur ; chiffrement `_enc` respecté |
| T-P3A-10 : FEC-MA et SAF-T | `FEC_MA_PROVISIONAL_PROFILE` (copie dans `apps/marketing-astro`, hors périmètre) | La liste des colonnes existe en double (site et futur `fec-auditor`) ; le SAF-T « CGNC v2.0 » n'a aucune spécification de structure dans le dépôt | **PROPOSITION** : `packages/fec-auditor` porte la constante de référence ; un test du site (P4 ou jonction) la compare ; SAF-T : structure provisoire dérivée de l'OCDE v2.00, marquée provisoire. **À TRANCHER** : fournir la spécification SAF-T CGNC si elle existe |
| T-P3A-11 : 50+ contrôles FEC, score /100 | Doc_07 § 10, Doc_14 § 04 | La liste des « 50+ contrôles » n'est pas fournie en un seul endroit | **PROPOSITION** : inventaire dérivé des tables et déclencheurs réels, numéroté, un test par contrôle ; la barrière G3 revoit la liste |
| T-P3A-12 : route `/api/v1/edi/:declarationType` | patron `createInvoicesRoutes` ; `vault-merkle` | **Aucune permission d'export EDI n'existe** dans `PERMISSION_ACTIONS` (Doc_07 : rôle « Chef de Mission »), et `auth-rbac` est gelé ; le routeur ne peut pas être monté en production avant P4-C | **PROPOSITION** : ajouter `EDI_EXPORT` (rôles CHEF_MISSION, EXPERT_COMPTABLE_OEC, OWNER_GERANT en direct) dans le ticket de jonction J2 avant P3-A ; la route reste un routeur à ports |

Contraintes de P3-A : `FISCA_REQUIRE_PHIVE` ne s'applique pas à SIMPL ; xmllint seul. Les exports sont des archives : ne jamais persister de PII en clair.

## 4. Session P3-B (voie BACK-1) : IA, OCR, agents, MCP, achats

Branche `feat/w3-ai-agents-mcp`. Périmètre : `containers/docling-python`, `packages/ai-agents`, `apps/api-hono/src/routes/purchases`, `apps/api-hono/src/routes/mcp`.

| Ticket | À réutiliser | Manques, incohérences, oublis détectés | Proposition ou question |
|---|---|---|---|
| T-P3B-01 : conteneur docling | `bootstrap-sandbox.sh --python` | Poids TableFormer « vérifiés SHA-256 » : **provenance, version et empreintes absentes du dépôt** ; accès réseau aux poids non vérifié ; Docker absent (image jamais construite) | **À TRANCHER PAR LE PROPRIÉTAIRE** : fournir les poids et leurs empreintes ou autoriser leur téléchargement. **Option par défaut** : le conteneur prend les poids par un chemin monté, le test vérifie l'empreinte par un fichier d'empreintes versionné, sans modèle réel (pytest avec faux poids) |
| T-P3B-02 : model tiering | ports d'inférence ; Doc_13 §§ 03, 10, 11 | Paliers et coûts de Doc_13 sont des modèles non mesurés ; plafond du Niveau 2 et alerte à 2x | **PROPOSITION** : paramètres injectés, pas de montant codé en dur ; tests de bascule en centimes entiers |
| T-P3B-03 : pipeline OCR niveau 1 | scrubber d'ICE, filtre d'injection | Moteurs cités (Clairic, Qwen2.5-VL, Nanonets-OCR-s, AtlasOCR) : l'inférence réelle passe par Workers AI (Doc_04 § 08), **aucun accès ni clé en bac à sable** ; scrubber et filtre à durcir **avant ce ticket** | **PROPOSITION** : port d'inférence + double de test déterministe ; durcissement du scrubber (ICE collé à une lettre, retour à la ligne, tiret bas, épellation) comme premier critère d'acceptation |
| T-P3B-04 à T-P3B-06 : 11 agents | Doc_04 § 08, Doc_07 § 10 | Les noms des 11 agents sont listés une fois (Doc_04) ; mémoire Hindsight : DO exporté | **PROPOSITION** : un agent = un module, port + tests ; aucun agent n'écrit dans le grand livre (`canMutateLedgerDirectly = false`) |
| T-P3B-07 : 4 règles d'arrêt | Doc_10 § 06 | — | Tests par règle (PIECE_A_CONTROLER, SUSPENS_AMBIGU_3497_4497, zéro cause inventée, check e-mail) |
| T-P3B-08 : Hindsight et OpenTelemetry GenAI | `AgentHindsightMemoryDO` | Aucun collecteur OpenTelemetry défini | **PROPOSITION** : exporter derrière un port, aucun envoi réseau dans les tests |
| T-P3B-09 : routes `purchases/ingest` et SSE | client `apps/web-saas/src/pme/sse-fetch.ts` | **Le format des 4 événements SSE (CTR-API-22) n'a aucun code serveur ; le client de P2-B consomme un format provisoire** ; pas de permission `PURCHASES_INGEST` (utiliser `LEDGER_SAVE_DRAFT` ou `PO_CREATE` ?) | **PROPOSITION** : le serveur adopte le format du client (documenté en tête de `sse-fetch.ts`), contrat passé de `PROVISIONAL` à `LOCKED` à G3 ; permission : `LEDGER_SAVE_DRAFT` (aide-comptable). **À valider.** |
| T-P3B-10 : serveur MCP | `MCP_DRAFT_SCOPE = 'mcp:draft'` ; `AI_MCP_ACTOR` | `/.well-known/mcp.json` du site est publié **sans portées OAuth** ; OAuth 2.1 + PKCE : aucune implémentation ; aucun outil n'accepte d'identifiant de société | **PROPOSITION** : classes Read, Audit, Draft ; portées dérivées de `MCP_DRAFT_SCOPE` ; mise à jour de `mcp.json` du site en jonction |

## 5. Session P3-C (voie EDI-2) : intégrations, ERP, connecteurs

Branche `feat/w3-erp-third-party`. Périmètre : `packages/external-integrations`, `apps/api-hono/src/routes/webhooks`, `apps/api-hono/src/routes/erp`, `connectors/odoo-l10n-ma`, `connectors/sage100-dotnet`, `containers/camel-bridge`.

| Ticket | À réutiliser | Manques, incohérences, oublis détectés | Proposition ou question |
|---|---|---|---|
| T-P3C-01 : OTP Infobip 15 s | Doc_17 §§ 02, 03, 11 | Aucun compte Infobip ; tout est simulé hors ligne (Doc_17 § 12) | Double de test déterministe ; compte réel : prérequis S5 |
| T-P3C-02 à T-P3C-05 : bot WhatsApp, SES, Payzone, DirectInfo OMPIC | `verifySignedWebhookPayload` | En-têtes de signature propres à chaque fournisseur à spécifier ; Payzone : deux circuits (MIT 3DS2 et BYO-MID, Loi 103-12) | **PROPOSITION** : un adaptateur par fournisseur, ports et doubles ; aucune clé dans le dépôt |
| T-P3C-06 : module Odoo | `HMAC X-SaaS-Signature` (HMAC-SHA256 du corps JSON trié) | Odoo n'est pas installable dans le bac à sable ; **les routes `/api/v1/erp/odoo/*` sont construites en T-P3C-08, après ce ticket** | **PROPOSITION** : définir les contrats (CTR-API-23 à 28) dès T-P3C-06 et tester le module contre un serveur double ; pytest avec doubles Odoo |
| T-P3C-07 : Sage100EdgeAgent | `--dotnet`, garde `NOLOCK`, `ISageWriter` | Projet `net8.0-windows` exclu de la solution Linux ; SQL Server absent | xUnit sur doubles ; `IPMEncoder` non testable ici (consigné) |
| T-P3C-08 : exporteur `.PNM` et routes `/api/v1/erp/*` | `assertValidSage100PnmBuffer` ; D-22 | Pas de permission ERP dédiée : `ERP_CONNECTOR_AGENT` n'a que `INVOICE_CREATE_DRAFT` et `LEDGER_SAVE_DRAFT` | **PROPOSITION** : routes en brouillon seulement (jamais d'écriture définitive) |
| T-P3C-09 : camel-bridge et OData BI | `--java` | « Vues analytiques agrégées » non spécifiées ; SAP, Oracle et Sage X3 absents ; image non construisible | **À TRANCHER PAR LE PROPRIÉTAIRE** : liste des vues OData. **Option par défaut** : une vue de balance et une de TVA, lecture seule, marquées provisoires ; tests Camel sur doubles |

## 6. Barrière G3 (voie AUDIT)

- Commande : `pnpm verify:gate` (`scripts/verify-gate.sh`, à valider au premier usage ; Java 21, `--dotnet` et `--python` pour la vague). Rubrics R1, R2 et R3 ; seuil de 95 sur chacune.
- À vérifier en plus des tickets T-G3 : parité des empreintes (inchangées), absence de textes « conforme DGI », durcissement du scrubber et du filtre d'injection effectif, chiffrement des réponses d'idempotence (réserve de G1 avant G3), le « Journal des amendements » des spécifications 07, 14, 17 complété (ERRATA F).
- Fusion dans l'ordre des dépendances ; les branches de la vague 3 sont indépendantes entre elles sauf `edi-simpl` et `fec-auditor` : P3-A seule.
- Tests adverses de l'auditeur : versés en patch ; le pilote les intègre.

## 7. Ticket de jonction « J2 » proposé (avant P3-A)

Périmètre : `packages/db-schema` (migration v12), `apps/api-hono/src/core` (chiffrement des réponses d'idempotence, `InvoiceSequencerDO` aligné sur la genèse de 45 caractères et appel en deux temps `sealInvoiceHash` + `public_invoice_index`), `apps/api-hono/src/index.ts` (ré-export de `DgiClearanceWorkflow`, `env.resolveClearancePorts`, export des Durable Objects), `apps/api-hono/wrangler.toml` (file `fisca-xhub-clearance`), `packages/auth-rbac` (permission `EDI_EXPORT`), plan comptable de production (amorce des rôles de TVA). Branche `fix/w2-junctions`, voie BACK-1, audité par une barrière courte ; **non lancé** : en attente de l'autorisation du propriétaire.

## 8. Questions numérotées pour le propriétaire

1. Dépôt des cahiers des charges EDI de la DGI dans `docs/reference/dgi/` (non reçus) ; sinon accord explicite pour les XSD structurels provisoires.
2. Table des cellules SIMPL-IS et de leurs `codeEdi` ; noms des 5 opérateurs du DSL ; sinon sous-ensemble documenté.
3. Spécification du SAF-T « CGNC v2.0 » si elle existe.
4. Poids de modèles (TableFormer) et leurs empreintes, ou autorisation de téléchargement ; fournisseur d'inférence (Workers AI) et clés pour les environnements réels.
5. Liste des vues OData BI.
6. Autorisation du ticket de jonction J2 et de la vague 3.
