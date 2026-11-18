---
name: fisca-spec-errata-and-arbitrages
description: Corrections et arbitrages des 18 spécifications Fisca : préséance, écarts validés, blocages de procédure (régime provisoire DGI/xHub, voies), erreurs de conversion, contradictions tranchées, vérification fiscale. À consulter avant toute ambiguïté de spécification.
---

# fisca-spec-errata-and-arbitrages (révision b, 2026-11-13)

Condensé de `docs/specs/ERRATA.md`, attaché à ce skill (copie dans `scripts/ERRATA.md`) et présent dans le dépôt. Le fichier complet du dépôt fait foi ; lis-le en début de session. Les références A, B, C, D, E ci-dessous sont ses numéros d'entrée.

## Ordre de préséance

1. `docs/specs/ERRATA.md`. 2. Fichiers `ops/state/backlog.json` et `ops/state/contracts-registry.json`, et `.meta/session-scopes.json`. 3. `docs/orchestration/`. 4. Documents 01 à 18. 5. Tout document antérieur (cartographie des 6 vagues, fiches d'agents, prompts d'origine), périmé là où il diffère. Le dépôt prime sur un skill s'ils diffèrent.

Une contradiction que l'errata ne tranche pas ne se devine pas : ticket `BLOCKED`, classe `SPEC_AMBIGUITY`, question précise dans `04_Circuit_Breaker_Blockers`, et la boucle continue.

## A. Écarts validés

- Noms d'agents des documents → agents réels : `Fisca-Backend-Core-Builder` = `Fisca-Core-Backend-Fiscal` ; `Fisca-EDI-ERP-Specialist` = `Fisca-Containers-EDI-ERP` ; `Fisca-Frontend-POS-Builder` = `Fisca-Frontend-Mobile-Growth`.
- Branches : S0 sur `feat/w0-foundation` (et non `feat/w0-bootstrap`) ; S5 sur `feat/w5-release-v1.0.0` (et non `release/v1.0.0`) ; `audit/gate-N` est locale à l'auditeur. Seules `feat/*` et `fix/*` sont poussées.
- L'auditeur est en lecture seule sur GitHub : il termine son rapport par la ligne `VERDICT <barrière> : FAVORABLE` ou `DÉFAVORABLE` ; l'orchestrateur, qui pilote, la lit, fusionne, et pose le tag `v1.0.0` sur décision du propriétaire.
- P4-C est construit par `Fisca-Core-Backend-Fiscal`, pas par l'orchestrateur.
- Pas de statut `CHANGES_REQUESTED` : un refus d'audit remet le ticket à `TODO` avec `review_notes`.
- Colonnes réelles du backlog : `task_id, phase_num, session_id, assigned_agent, task_title, workspace_pkg, spec_doc_ref, depends_on, status, git_branch, locked_by_branch, retry_count, tests_green, rubric_score, verify_cmd, commit_url, review_notes, updated_at`.
- Les spécifications se lisent dans `docs/specs/` du clone, pas par @mention. Fichiers `NN-titre.md` ; une référence `Doc_04_TDD#S02` désigne `04-tdd-architecture.md`, « ## Section 02 ».

## B. Blocages de procédure corrigés (détail dans fisca-harness-gatekeeper)

- B-01 : `pnpm-lock.yaml` et `.meta/` toujours autorisés ; conflit de verrou résolu par `pnpm install`.
- B-02 : contrat d'échafaudage de S0 (squelette de tous les workspaces, `apps/api-hono` relié à tous les `@fisca/*`, manifeste de routes généré, surfaces web en `import.meta.glob`). Les routes ne portent que de la colle ; logique et dépendances tierces vont dans un paquet du périmètre. Seul un ajout de dépendances est admis dans le `package.json` du paquet englobant.
- B-04 : une dépendance est satisfaite si elle est `DONE`, ou `IN_REVIEW` avec son commit dans la branche. S1B est empilée sur la branche de S1A.
- B-05, B-06 : contexte neuf par sous-agent du fil ; ni fil neuf, ni Schedule pour continuer une session.
- B-07 : Amazon Linux 2023 (`dnf`), pas de Docker.
- B-08 : 5 s, 75 s, 520 tests, 120 vecteurs sont des cibles.
- B-09 : chaque session écrit ses vecteurs d'or dans `<paquet>/tests/golden/*.vectors.json` ; l'auditeur les recalcule.
- B-11 : jamais de marqueur `[BREAKING_MIGRATION]` avant la v1.0.0.
- B-12 : `.github/workflows/` exige la permission Workflows sur le jeton GitHub.
- **B-13 (révisé) : schémas officiels non publiés, régime provisoire, sans blocage.** Au 2026-11-13, le décret d'application de l'art. 145-IX du CGI n'est pas paru et ni la DGI ni xHub n'ont publié de spécification de la facture électronique. Facture : validation contre les XSD OASIS UBL 2.1 et EN 16931 (PHIVE) ; règles marocaines dans le profil remplaçable `packages/ubl-xades/profiles/cius-ma-provisional/` ; passerelle `ClearanceGateway` en pilote `simulated` seulement. SIMPL : XSD officiel de `docs/reference/dgi/` s'il y est, sinon XSD provisoire dérivé strictement de Doc_07 § 08 à § 10 dans `packages/edi-simpl/xsd/provisional/`. Contrats au statut `PROVISIONAL`, mention « conformité officielle non vérifiée », choix du schéma par `resolveSchema`. Interdit : présenter un schéma provisoire comme officiel, écrire « conforme », « homologué » ou « certifié » DGI ou xHub (l'état `--status-cleared` s'affiche « Validation simulée »), coder une date ou un seuil de la réforme. Remplacement par l'officiel : `docs/reference/dgi/README.md`.
- B-14 : `Objets100cLib` (Windows) derrière `ISageWriter`, hors solution Linux ; pas de build iOS ni Android.
- **B-15 : un fil ouvert par un autre fil ne peut ni ouvrir de fil ni programmer de rappel.** L'orchestrateur pilote depuis un fil ouvert par le propriétaire, ouvre une voie par file de travail, relance chaque voie, lit le verdict et fusionne (`docs/orchestration/pilotage-automatique.md`). L'ordre des actions est calculé par `docs/orchestration/reference/pilot-status.mjs`.
- **B-16 : la fusion se constate dans git** (branches ancêtres de `origin/main`), pas par le statut des tickets ; fusions par commit de fusion, jamais par squash.

## C. Code de référence amputé à la conversion (corrigé dans docs/specs/)

- Doc 07 § 11, webhook : message signé = `${timestampSecHeader}.${rawBodyText}`.
- Doc 08 § 11, `formatCentimesMad` : `${signPrefix}${groupedWhole},${centimesPart} ${currency}`.
- Doc 09 § 02, mot de passe : `pbkdf2_sha512$100000$${saltHex}$${hashHex}`.
- Doc 10 § 04 et § 11, AAD : `${companyId}|${tableName}|${recordId}|${columnName}`.
- Doc 12 § 11, manifeste DIP : ligne `${relativePath}|${sizeBytes}|${sha256Hex}` ; en-tête `${companyIce}|${companyIf}|${exportedAtIso}`.
- Doc 18 § 11, hreflang : `https://fisca.ma/${LOCALE_URL_PREFIX[loc]}/${cleanSlug}`.
- Doc 15 § 11, garde de constitution : ne pas retranscrire ; prendre `docs/orchestration/reference/enforce-constitution.ts`.
- Messages d'erreur réparés dans Doc 02, 03, 06 et 11.

Si un gabarit de chaîne d'un document contient encore `{nom}` sans `$`, c'est le même défaut : rétablis `${nom}` et signale-le.

## D. Contradictions tranchées

- D-01 : PBKDF2-HMAC-SHA512 à 100 000 itérations avec pepper (pas Argon2id). Passkeys et PRF restent.
- D-02 : 12 rôles = 10 humains + 2 techniques ; ajouter `COMMERCIAL_FACTURATION` au CHECK de `organization_memberships`.
- D-03 : la contre-passation est une nouvelle écriture (`reversal_of_entry_id`), jamais un changement de statut d'une pièce `POSTED`. Ajouter un trigger `BEFORE INSERT` refusant `POSTED` à l'insertion.
- D-04 : `vat_rate_bps IN (2000, 1000, 0)` reste strict ; 7 % et 14 % sont convertis à l'import ; les exercices antérieurs entrent par le journal AN.
- D-05 : relances d'impayé J0, J+3, J+7, J+12 ; lecture seule à J+15.
- D-06 : table `fiduciary_dossier_meters` (`ACTIVE`, `ARCHIVED`) ; remise de 1 500 bps dès 100 dossiers.
- D-07 : `packages/shared-types/src/` : `fsm-engine.ts`, `infra-adapter.ts`, `invariants.ts`, `api-contracts.ts`.
- D-08 : files `fisca-invoice-ingestion`, `fisca-xhub-clearance`, `fisca-erp-sync-outbound`, `fisca-sovereign-mirror`, `fisca-notifications` ; files d'erreurs `dlq-fisca-<nom>`.
- D-09 : `Math.round((a * b) / c)` du code de référence (Doc 03 § 11, Doc 12 § 11) est interdit ; `divRoundHalfUpBigInt`. Les vecteurs attendus ne changent pas.
- D-11 : triggers PL/pgSQL équivalents pour PostgreSQL 16 ; parité prouvée par le comportement.
- D-12 : l'anonymiseur masque aussi CIN, IF et CNSS.
- D-13 : VEC-CGI-02, 46 jours de retard et non 45 ; résultat inchangé (44 500 centimes).
- D-14 : Lighthouse ≥ 98 en médiane de 3 passes ; sous 95, clause éliminatoire.
- D-16 : `X-Fisca-Company-Id` sélectionne un dossier que le serveur vérifie ; jamais un argument d'outil IA ou MCP.
- D-17 : s'ajoutent à l'arborescence : `apps/pos-pwa`, `packages/auth-rbac`, `compliance-cndp`, `qa-harness`, `external-integrations`, `pra-reversibility`, `ops/`.
- D-18 : `openapi.json` est généré, non commité par les sessions ; verrouiller un contrat = passer ses lignes du registre à `LOCKED`.
- D-19 : `processed_queue_messages`, `whatsapp_optin_at`, `unsubscribed_at`, `pii_restricted_flag` sont à définir par S1B ; `tax_regimes_catalog` et `company_billing_meters` n'existent pas.
- D-20 : cumul mensuel d'espèces (Doc 01) : il faut onze factures de 4 800 MAD TTC, pas neuf ; franchissement à la onzième, excédent de 2 800 MAD TTC.
- D-21 : les « Annexe V » des documents 03, 10, 12, 13, 14, 17 et 18 (code Python de vérification numérique, réexécutable par `python3 docs/specs/verification/verify-annexes.py`) sont des pièces justificatives : aucune exigence nouvelle, flottants interdits en production, rien à copier dans un paquet, pas à lire pour réaliser un ticket.

## E. Substance fiscale : ce qui est vérifié

Les vecteurs d'or prouvent que le code calcule ce que les spécifications demandent, pas que les spécifications disent la loi. Chaque fichier de vecteurs porte l'article de loi, la date de la règle et un état : `RECOUPÉ`, `NON RECOUPÉ` ou `PROVISOIRE`. Un vecteur `NON RECOUPÉ` ne bloque rien ; il alimente la liste que le propriétaire soumet à son expert-comptable avant la mise en production (T-S5-03). État au 2026-11-13 : plafonds d'espèces de 5 000 DH par jour et 50 000 DH par mois et par fournisseur recoupés (art. 11-II et 106-II), mais la base TTC ou HT du plafond est discutée : c'est un paramètre daté en D1 (`cap_basis`, TTC par défaut). Le taux directeur de Bank Al-Maghrib de la loi 69-21 est une donnée datée de D1. Le reste (RAS-TVA, auto-entrepreneur, BTP, clé de l'ICE, facture électronique) n'est pas recoupé : détail dans la section E du fichier complet.

## Révision b (2026-11-13) — prime sur les entrées ci-dessus

- **B-13 révisé : schémas DGI/xHub non publiés = régime provisoire, jamais un blocage.** Facture électronique : XSD OASIS UBL 2.1 + EN 16931 (PHIVE), règles marocaines dans le profil remplaçable `cius-ma-provisional`, passerelle `ClearanceGateway` en pilote `simulated` seul. SIMPL : XSD officiel de `docs/reference/dgi/` s'il existe, sinon XSD provisoire dérivé de Doc_07 § 08–10 dans `packages/edi-simpl/xsd/provisional/`. Contrat `PROVISIONAL` (garde ce statut à la barrière), choix du schéma par `resolveSchema(kind, version)`. Interdit : présenter un schéma provisoire comme officiel, écrire « conforme/homologué DGI », coder une date ou un seuil de la réforme ; l'état `--status-cleared` s'affiche « Validation simulée ».
- **B-15** : l'auditeur ne délègue pas la fusion et les voies ne programment pas de rappel ; le pilote (Fisca-Lead-Orchestrator) relance et fusionne.
- **B-16** : la fusion se constate dans git (branches ancêtres de origin/main), par commit de fusion.
- **D-20** : cumul mensuel d'espèces — onze factures de 4 800 MAD TTC, franchissement à la onzième, excédent 2 800 MAD scindé.
- **D-21** : les « Annexe V » (docs 03, 10, 12, 13, 14, 17, 18) sont du code de vérification Python, réexécutable par `python3 docs/specs/verification/verify-annexes.py` ; pas d'exigence, pas de code de production.
- **Section E** : chaque vecteur d'or porte l'article, la date et l'état `RECOUPÉ`, `NON RECOUPÉ` ou `PROVISOIRE` ; base du plafond d'espèces paramétrée (`cap_basis`, TTC par défaut) ; taux directeur BAM donnée datée de D1.

## Adaptation Antigravity

- « attaché à ce skill (FetchSkillScripts) » → « attaché à ce skill (copie dans `scripts/ERRATA.md`) ».
- « Tables `fisca_master_backlog` et `fisca_contracts_registry` » → fichiers `ops/state/backlog.json` et `ops/state/contracts-registry.json` du dépôt.
- Non modifiés faute d'équivalent défini : références aux « fils »/« voies »/« rappels »/« Schedule » (à lire comme sous-agent Antigravity `.agents/agents/` ou session agy parallèle `docs/antigravity/`), et `04_Circuit_Breaker_Blockers` (section de `docs/state/FISCA_STATE_AND_HANDOFF.md`).
