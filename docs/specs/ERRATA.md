# ERRATA et arbitrages des spécifications Fisca

Version du 2026-11-13. Ce fichier prime sur les 18 documents de `docs/specs/` et sur les documents de procédure. Il est protégé : seul Fisca-Lead-Orchestrator le modifie, sur décision du propriétaire du projet.

## Ordre de préséance des sources

1. Ce fichier (`docs/specs/ERRATA.md`).
2. Les tables `fisca_master_backlog` et `fisca_contracts_registry`, et `.meta/session-scopes.json`.
3. `docs/orchestration/` (matrice des sessions, protocole de boucle, barrières QA).
4. Les documents 01 à 18 de `docs/specs/`.
5. Tout document antérieur (cartographie des 6 vagues, fiches d'agents, prompts d'origine) : périmé là où il diffère.

Une contradiction que ce fichier ne tranche pas ne se devine pas : le ticket passe en `BLOCKED` avec la question précise dans `04_Circuit_Breaker_Blockers`, et la boucle continue sur le ticket indépendant suivant.

## A. Écarts validés par rapport aux documents

| N° | Les documents disent | Ce qui s'applique |
|---|---|---|
| A-01 | Agents `Fisca-Backend-Core-Builder`, `Fisca-EDI-ERP-Specialist`, `Fisca-Frontend-POS-Builder` | Les agents réels sont `Fisca-Core-Backend-Fiscal`, `Fisca-Containers-EDI-ERP`, `Fisca-Frontend-Mobile-Growth`. `Fisca-Lead-Orchestrator` et `Fisca-QA-Security-Auditor` gardent leur nom. Un sixième agent, `Fisca-Wiki-Memory-Curator`, recoupe l'état chaque nuit. |
| A-02 | S0 sur `feat/w0-bootstrap` ; S5 sur `release/v1.0.0` ; barrières sur `audit/gate-N` | S0 sur `feat/w0-foundation`. S5 sur `feat/w5-release-v1.0.0` (seules les branches `feat/*` et `fix/*` sont poussées). `audit/gate-N` est une branche locale de l'auditeur, jamais poussée. |
| A-03 | L'auditeur fusionne sur `main` et crée le tag `v1.0.0` | L'auditeur est en lecture seule sur GitHub. Il rend son verdict, puis délègue la fusion à `Fisca-Lead-Orchestrator`, seul à fusionner (Pull Request, 0 approbation requise : tous les agents agissent sous le même compte GitHub). Le tag `v1.0.0` est posé par l'orchestrateur après le certificat final. |
| A-04 | P4-C (nœud souverain, Multi-DNS, CI/CD) est construit par l'orchestrateur | P4-C est construit par `Fisca-Core-Backend-Fiscal` : l'orchestrateur ne développe pas ce qu'il fusionne. S0, T-S5-01 et T-S5-03 restent à l'orchestrateur. |
| A-05 | Statut `CHANGES_REQUESTED` après un refus d'audit | Le ticket refusé repasse à `TODO` avec les consignes dans `review_notes`, et `retry_count` remis à 0. |
| A-06 | Colonnes du backlog : `ticket_id, wave_num, owner_agent, title, scope_dirs, spec_refs, commit_sha, qa_verdict` | Colonnes réelles : `task_id, phase_num, assigned_agent, task_title, workspace_pkg, spec_doc_ref, commit_url, rubric_score, review_notes`, plus `session_id, depends_on, status, git_branch, locked_by_branch, retry_count, tests_green, verify_cmd, updated_at`. |
| A-07 | Le juge doit être d'une autre famille de modèles | Tous les agents tournent sur Claude Sonnet 5.5. L'indépendance du jugement vient du modèle juge choisi à chaque évaluation de rubric (jamais « Same as thread ») et de la preuve console exigée. |
| A-08 | Les spécifications sont attachées par @mention | Elles se lisent dans `docs/specs/` du clone local, section par section. Chaque session ne lit que ses 3 à 5 documents (matrice de `docs/orchestration/README.md`). |
| A-09 | Serveur MCP `docs.mcp.cloudflare.com` | Intégration Cloudflare officielle, en consultation seule. L'outil `execute` est interdit ; la pré-production passe par le skill `fisca-cloudflare-staging-deploy`. |

## B. Blocages de procédure corrigés

Chacun de ces points aurait arrêté une boucle autonome. Le protocole corrigé est dans `docs/orchestration/protocole-boucle.md`.

- **B-01 — `pnpm-lock.yaml` hors périmètre.** Tout `pnpm add` modifie le verrou racine, que le garde de périmètre rejetait. `pnpm-lock.yaml` et `.meta/` sont toujours autorisés. À la barrière, un conflit sur le verrou se résout par `pnpm install` (pnpm fusionne le verrou lui-même), jamais à la main.
- **B-02 — Fichiers de jonction sans propriétaire.** `apps/api-hono/package.json`, `wrangler.toml`, `src/index.ts`, et leurs équivalents de `apps/web-saas`, n'appartiennent au périmètre d'aucune session. Contrat d'échafaudage de S0 : S0 crée le squelette de tous les workspaces de `.meta/session-scopes.json` (manifeste `@fisca/<nom>`, scripts `typecheck`, `lint`, `test:unit`, `test`, tsconfig, point d'entrée), déclare dans `apps/api-hono/package.json` tous les paquets `@fisca/*` en `workspace:*`, et monte les routes par un manifeste généré (`scripts/gen-route-manifest.ts` parcourt `apps/api-hono/src/routes/*/index.ts` ; fichier généré ignoré par Git). `apps/web-saas` charge ses surfaces par `import.meta.glob`. Une session au périmètre partiel peut ajouter des dépendances au `package.json` du paquet englobant, rien d'autre. Les routes ne contiennent que de la colle : toute logique et toute dépendance tierce vont dans un paquet du périmètre.
- **B-03 — Garde de périmètre dépendant d'une variable oubliée.** Sans `FISCA_SCOPE_DIRS`, le garde laissait tout passer. Il lit maintenant le périmètre de la branche dans `.meta/session-scopes.json` et échoue sur une branche inconnue (`ERR_SCOPE_UNDEFINED`).
- **B-04 — Interblocage des dépendances.** Les documents exigent des dépendances `DONE`, alors qu'un ticket ne devient `DONE` qu'à la barrière : 127 dépendances internes aux sessions bloquaient chaque session après son premier ticket, et S1B attendait une barrière G1 qui l'attendait. Règle : une dépendance est satisfaite si elle est `DONE`, ou si elle est `IN_REVIEW` et que son commit est un ancêtre de la branche de travail. S1B est une branche empilée, créée depuis `origin/feat/w1-auth-crypto-cndp` quand tous les tickets S1A sont `IN_REVIEW`. Les tickets de barrière démarrent quand tous les tickets des sessions auditées sont `IN_REVIEW`.
- **B-05 — Auto-délégation vers un fil neuf.** Un fil neuf perd l'accès npm (accord donné fil par fil) et la profondeur de délégation est plafonnée. La fraîcheur de contexte s'obtient dans le fil de session : chaque ticket est confié à un sous-agent du fil (même clone, même réseau, contexte neuf). La continuité s'obtient par un rappel programmé dans le même fil.
- **B-06 — Relais planifié sans droit d'écriture.** Les exécutions planifiées des constructeurs sont limitées en écriture. Le relais passe par un rappel dans le fil de session, pas par un Schedule.
- **B-07 — Bac à sable.** Amazon Linux 2023 : `dnf` et non `apt-get`, `sudo` sans mot de passe, pas de Docker. Java 21, Maven, .NET 8, Python 3.12, PostgreSQL 16 et Redis 6 s'installent par `dnf` ; les bibliothèques de Chromium sont présentes. Les conteneurs se testent par leur code (Maven, pytest, xUnit), pas par `docker build` ; MinIO n'est pas simulé (contrat `WormVaultDriver` testé sur un pilote mémoire).
- **B-08 — Budgets de temps et décomptes.** « `pnpm verify:fast` en moins de 5 s », « 520 tests » et « 120 vecteurs » sont des cibles. La condition de passage est : code de sortie 0, tous les tests verts, tous les scénarios nommés couverts. Un dépassement de budget se note, il ne bloque pas.
- **B-09 — Auteur des vecteurs d'or.** Seuls VEC-CGI-01 à 06 ont un auteur (S0). Chaque session écrit les vecteurs de ses règles dans `<paquet>/tests/golden/*.vectors.json`, avec l'article de loi et le calcul détaillé. L'auditeur recalcule chaque valeur attendue à la barrière. Après la barrière, modifier une valeur attendue exige le mode orchestrateur.
- **B-10 — Tests adverses de l'auditeur.** L'auditeur écrit ses tests dans `packages/qa-harness/src/adversarial/` sur sa branche locale. Pour les conserver, il joint le correctif (`git format-patch`) à sa délégation ; l'orchestrateur l'applique avec la fusion de la vague.
- **B-11 — Marqueur `[BREAKING_MIGRATION]`.** Avant la v1.0.0, il n'existe aucune donnée de production : aucune migration ne porte ce marqueur pendant les vagues de construction.
- **B-12 — Jeton GitHub sans permission Workflows.** Pousser un fichier sous `.github/workflows/` est refusé par GitHub sans la permission « Workflows : lecture et écriture ». À ajouter au jeton avant P4-C. De même, la vérification obligatoire `ci-pr-gate` ne s'exige dans la protection de `main` qu'après la fusion de P4-C.
- **B-13 — Schémas officiels absents.** Les XSD de la DGI (SIMPL-TVA v4.0, RAS-TVA, SIMPL-IS v2.0.3, État 9421, DRVT v2.0.3, ADC500B-23I), le profil UBL CIUS-MA de xHub et leurs cahiers des charges ne sont pas dans le dépôt, et `tax.gov.ma` refuse le bac à sable. Ils doivent être déposés dans `docs/reference/dgi/` avant la vague 2 (UBL) et la vague 3 (SIMPL). Aucun schéma n'est écrit de mémoire : sans schéma officiel, le ticket est `BLOCKED`.
- **B-14 — Bibliothèques propriétaires.** `Objets100cLib` (Sage 100) est une bibliothèque COM Windows : elle vit derrière l'interface `ISageWriter` dans un projet `net8.0-windows` exclu de la solution construite sous Linux. Le générateur `.PNM` et le garde SQL sont testés sous Linux. Les versions iOS et Android de Capacitor ne se compilent pas dans le bac à sable : configuration et build web seulement.

## C. Corrections de conversion (gabarits de chaînes amputés)

Le rendu des documents d'origine a supprimé le texte compris entre deux signes `$`. Les fichiers de `docs/specs/` sont corrigés.

| Document | Emplacement | Texte corrigé |
|---|---|---|
| Doc_02 § 11 | `assertValidTransition` | `[${req.entityTable}:${req.entityId}]` |
| Doc_03 § 11 | `computeDailyProrataCents` | `day=${startDayOfMonth}, daysInMonth=${daysInMonth}` |
| Doc_03 § 06 | éligibilité Mowakaba | CA ≤ 200 M MAD HT |
| Doc_06 § 10 | `ensureTenantSchemaUpToDate` | `Migration v${migration.version} (${migration.name}) altérée.` |
| Doc_07 § 11 | `verifySignedWebhookPayload` | message signé = `${timestampSecHeader}.${rawBodyText}` |
| Doc_08 § 11 | `formatCentimesMad` | `${signPrefix}${groupedWhole},${centimesPart} ${currency}` |
| Doc_09 § 02 | `hashPasswordWorkerSafe` | `pbkdf2_sha512$100000$${saltHex}$${hashHex}` |
| Doc_10 § 04 et § 11 | AAD | `${companyId}\|${tableName}\|${recordId}\|${columnName}` |
| Doc_11 § 11 | deux messages d'erreur | `[${target.serviceName}] (${target.destinationCountryIso2})` |
| Doc_12 § 11 | manifeste DIP | ligne `${relativePath}\|${sizeBytes}\|${sha256Hex}` ; en-tête `${companyIce}\|${companyIf}\|${exportedAtIso}` |
| Doc_15 § 11 | deux messages d'erreur | le fichier fautif est nommé ; voir `docs/orchestration/reference/enforce-constitution.ts` |
| Doc_18 § 11 | `buildMultilingualAlternates` | `https://fisca.ma/${LOCALE_URL_PREFIX[loc]}/${cleanSlug}` |

Dans le runbook S0, les valeurs perdues sont : `pnpm verify:fast` (cible : moins de 5 s), seuil de rubric ≥ 95/100, parallélisme ×3.

## D. Contradictions entre documents

- **D-01 — Mot de passe (Doc_09 § 02).** La version initiale (Argon2id) est remplacée par PBKDF2-HMAC-SHA512, 100 000 itérations, sel de 16 octets et pepper : Argon2id n'existe pas dans le WebCrypto des Workers. Passkeys WebAuthn et extension PRF restent valables.
- **D-02 — Rôles (Doc_06 § 02 contre Doc_09 § 05).** Le CHECK de `organization_memberships.role_code` oublie `COMMERCIAL_FACTURATION` : il compte 10 rôles humains. `ERP_CONNECTOR_AGENT` et `AI_MCP_ACTOR` sont des identités techniques, hors de cette table. Total : 12 rôles (10 humains et 2 techniques, et non « 9 et 3 »).
- **D-03 — Contre-passation (Doc_02 § 04 contre Doc_06 § 05).** `POSTED → CONTRE_PASSEE` n'est pas un changement de statut : le trigger interdit tout UPDATE d'une pièce `POSTED` et le statut n'existe pas dans le CHECK. La contre-passation est une nouvelle écriture liée par `reversal_of_entry_id`. Durcissement à ajouter : un trigger `BEFORE INSERT` refuse l'insertion directe d'une écriture au statut `POSTED`.
- **D-04 — TVA 2026 (Doc_06 contre Doc_14 VEC-CGI-05).** Le CHECK `vat_rate_bps IN (2000, 1000, 0)` reste strict. Une pièce importée à 7 % ou 14 % est convertie avant enregistrement ; les exercices antérieurs à 2026 entrent par le journal d'ouverture AN, pas comme lignes de facture.
- **D-05 — Relances d'impayé (Doc_02 § 08 contre Doc_03 § 09 et Doc_17 § 05).** Le calendrier est J0, J+3, J+7, J+12, puis lecture seule à J+15.
- **D-06 — Compteur fiduciaire (Doc_02 § 08 contre Doc_03 § 10).** La table est `fiduciary_dossier_meters`, statuts `ACTIVE` et `ARCHIVED`. La remise dès 100 dossiers vaut 1 500 bps (le « 8 500 bps » de Doc_02 est le multiplicateur).
- **D-07 — Noms de fichiers du socle.** `packages/shared-types/src/fsm-engine.ts`, `infra-adapter.ts` (interface `FiscaInfrastructureAdapter`, appelée StorageAdapter dans Doc_04), `invariants.ts`, `api-contracts.ts`.
- **D-08 — Files Cloudflare.** Noms : `fisca-invoice-ingestion`, `fisca-xhub-clearance`, `fisca-erp-sync-outbound`, `fisca-sovereign-mirror`, `fisca-notifications`, chacune avec sa file d'erreurs `dlq-fisca-<nom>` (Doc_16). Les noms de Doc_02 § 12 sont périmés.
- **D-09 — Arithmétique du code de référence (Doc_03 § 11, Doc_12 § 11).** `Math.round((a * b) / c)` est une division flottante, interdite par la Loi 1. Utiliser `divRoundHalfUpBigInt`. Les vecteurs attendus ne changent pas (7450, 12450, 244500, 206560, 253250). `Math.trunc(x / 100)` et `%` restent admis pour l'affichage (`FiscalPrimitives.tsx`).
- **D-10 — Prorata (Doc_06 § 06).** `deduction_prorata_pct` reste un entier de 0 à 100 parce que le XSD SIMPL-TVA l'impose ; `fiscal_years` garde les bps. Conversion : pct = bps / 100, exacte par construction.
- **D-11 — Portabilité SQL (Doc_06).** Les triggers sont écrits en SQLite. PostgreSQL 16 reçoit des triggers PL/pgSQL équivalents ; la parité se prouve par le comportement (mêmes erreurs, mêmes empreintes), pas par un DDL identique.
- **D-12 — Anonymiseur (Doc_10 § 11 contre § 12).** Les tests exigent zéro fuite de CIN, IF et CNSS, que le code de référence ne masque pas. Ajouter les motifs CIN (`[A-Z]{1,2}\d{5,7}`), IF et CNSS fournis par le contexte du dossier.
- **D-13 — VEC-CGI-02 (Doc_14 § 03).** Le retard est de 46 jours, pas 45. Le résultat (2 mois entamés, 44 500 centimes) est inchangé.
- **D-14 — Lighthouse (Doc_18 § 12 contre rubric R3).** Exigence : au moins 98 en médiane de 3 passes. Entre 95 et 97, le critère perd des points ; sous 95, clause éliminatoire.
- **D-15 — Registre d'images (Doc_16 § 07).** `ghcr.io/synaptic-systems-ma/...` devient un paramètre `FISCA_IMAGE_REGISTRY`.
- **D-16 — En-tête `X-Fisca-Company-Id` (Doc_07 § 01 contre Doc_04 § 04).** L'en-tête sélectionne un dossier parmi ceux de l'utilisateur ; le serveur le vérifie contre les appartenances et les mandats, puis résout lui-même la base. Il n'est jamais un argument d'outil IA ou MCP.
- **D-17 — Topologie.** S'ajoutent à l'arborescence d'origine : `apps/pos-pwa`, `packages/auth-rbac`, `packages/compliance-cndp`, `packages/qa-harness`, `packages/external-integrations`, `packages/pra-reversibility`, `ops/`.
- **D-18 — `openapi.json` (Doc_07 § 12).** C'est un artefact généré (`pnpm --filter @fisca/api-hono openapi:gen`), que les sessions ne commitent pas : `packages/shared-types` est gelé après la vague 1 et trois sessions parallèles le modifieraient. L'orchestrateur commite `.meta/openapi.snapshot.json` à chaque fusion de barrière. « Verrouiller le contrat » signifie passer ses lignes `API_ROUTE` à `LOCKED` dans le registre.
- **D-19 — Objets cités sans DDL.** `processed_queue_messages` (idempotence des files, Doc_04 § 06), les colonnes `whatsapp_optin_at` et `unsubscribed_at` (Doc_17 § 02) et `pii_restricted_flag` (Doc_11 § 06) n'ont pas de DDL dans Doc_06. S1B les définit dans `packages/db-schema` et les inscrit au registre. `tax_regimes_catalog` et `company_billing_meters` n'existent pas : utiliser `dynamic_fiscal_rules` et `fiduciary_dossier_meters`.
