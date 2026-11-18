# PROJECT_CONTEXT — document de contexte du projet « Fisca »

> Export fidèle du document Hyperagent `cmweat8da01vp07ad4z3sjxni` (titre « Fisca », description « Project document for Fisca », version 8, créé 2026-11-13T01:28:51Z, mis à jour 2026-11-13T06:47:40Z). Les sections sont dans l'ordre d'origine. Contenu arrêté au 2026-11-13 (tour 2) : l'état ultérieur est dans `FISCA_STATE_AND_HANDOFF.md`.

## Goals

_Define your project goals here._

## Critical Facts

- **Référentiel en vigueur : v2 du 2026-11-13.** 17 sessions, 132 tickets : S0 → pont S0 → S1A → S1B → G1 → P2-A/B/C → G2 → P3-A/B/C → G3 → P4-A/B/C → G4 → S5. L'ancienne « cartographie des 6 vagues » est périmée.
- **Où lire quoi.** Matrice des sessions, messages de lancement, barrières et fusion : skill `fisca-factory-runbook` et `docs/orchestration/README.md`. Protocole de boucle : skill `fisca-harness-gatekeeper`. Corrections et arbitrages : skill `fisca-spec-errata-and-arbitrages` et `docs/specs/ERRATA.md` (prime sur les 18 documents). Bac à sable : skill `fisca-sandbox-toolchain`.
- **Dépôt.** `anasse84/fisca`, Pull Request n° 1 (`feat/docs-specs`) : 18 spécifications `docs/specs/NN-titre.md`, errata, guide d'exécution, scripts de garde de référence, `.meta/session-scopes.json`, graines. À fusionner avant S0.
- **Agents réels** (les documents emploient d'autres noms) : Fisca-Lead-Orchestrator, Fisca-Core-Backend-Fiscal (= Backend-Core-Builder), Fisca-Containers-EDI-ERP (= EDI-ERP-Specialist), Fisca-Frontend-Mobile-Growth (= Frontend-POS-Builder), Fisca-QA-Security-Auditor, Fisca-Wiki-Memory-Curator. Tous sur Claude Sonnet 5.5.
- **Supports partagés** (créés dans le fil cmwcz46ow02jh07ad5hd5dkpj, liés aux 6 agents, en lecture seule depuis les autres fils) : table `fisca_master_backlog` (cmwczkg2001iq06ad9boev2sa), table `fisca_contracts_registry` (cmwczkg6801r106adzlsd3vrg), document `FISCA_STATE_AND_HANDOFF` (cmwczkgbj01nc07ad7i2cqcee, 5 sections : 01_Current_Wave_Status, 02_Active_Branches_And_Scopes, 03_Completed_Checkpoints, 04_Circuit_Breaker_Blockers, 05_QA_Gate_Verdicts).
- **Règles qui diffèrent des documents.** S0 sur `feat/w0-foundation` ; S5 sur `feat/w5-release-v1.0.0` ; auditeur en lecture seule sur GitHub, fusion par l'orchestrateur ; P4-C construit par Core-Backend-Fiscal ; S1B empilée sur la branche de S1A ; dépendance satisfaite si DONE, ou IN_REVIEW avec son commit dans la branche ; refus d'audit = retour à TODO avec `review_notes`.
- **Boucle autonome.** Un ticket par sous-agent du fil (même clone, même accès npm, contexte neuf) ; continuité par rappel dans le même fil ; ni fil neuf ni Schedule ; accès npm à accorder une fois par fil.

### Mise à jour du 2026-11-13 (tour 2, fil cmwefsofj00sc07ad6nt99wu0)

- **Dépôt** : `main` de `anasse84/fisca` porte les PR n° 1, 2 et 3 (dernier commit de fusion `cc8ddff`). Référentiel v2.1. Aucun code produit : S0 n'a pas démarré. `main` n'est toujours pas protégée.
- **Code de vérification (code.docx)** : intégré en « Annexe V » à la fin des documents 03, 10, 12, 13, 14, 17, 18 ; 13 blocs réexécutés, 13/13 sorties identiques (`python3 docs/specs/verification/verify-annexes.py`).
- **DGI / xHub** : au 2026-11-13, décret d'application de l'art. 145-IX du CGI non paru, aucune spécification technique publiée (profil UBL, XSD, Schematron, API). Recoupé par plusieurs sources de sept. et oct. 2026. Régime provisoire en place (ERRATA B-13 révisé) : rien ne bloque.
- **Mécanique Hyperagent vérifiée par essai** : un fil ouvert par un autre fil ne peut ni ouvrir de fil (« Spawn depth cap reached ») ni programmer de rappel ; l'auditeur ne voit pas l'orchestrateur ; les fichiers d'un fil persistent d'un tour à l'autre ; un sous-agent `task` partage le système de fichiers ; l'orchestrateur dispose de l'action de fusion GitHub ; l'accord réseau npm vaut par fil et se donne aussi depuis la boîte de réception.
- **Bac à sable, vérifié avec npm ouvert** : `pnpm add` (3 s), Vitest, `tsc --noEmit` strict, Playwright Chromium (126 Mo en 12 s, captures 375 px clair et 1440 px sombre, RTL), `bootstrap-sandbox.sh --playwright` sortie 0.
- **Agents** : les corrections d'instructions des 3 constructeurs et de l'auditeur demandées au tour 1 sont appliquées (récitées par les agents). Rubrics R1, R2, R3 v2 enregistrées ; les anciennes existent encore en double ; l'auditeur a épinglé « QA & Security Auditor Performance Evaluation » et ses instructions parlent encore de « 4 critères » pour R2.
- **Substance fiscale** : plafonds d'espèces 5 000 DH/jour et 50 000 DH/mois par fournisseur recoupés (art. 11-II, 106-II) ; base TTC ou HT discutée entre praticiens ; le reste des vecteurs n'est pas recoupé contre les textes (ERRATA section E).

## Research & Findings

_Accumulated research and discoveries._

## Decisions

- 2026-11-13 — Le référentiel d'exécution est celui de la Phase C (matrice finale et CSV de 132 tickets), adapté aux agents et aux politiques déjà en place. Détail des écarts : `docs/specs/ERRATA.md`, section A.
- 2026-11-13 — Les tables existantes gardent leurs colonnes (`task_id`, `assigned_agent`, `workspace_pkg`, `locked_by_branch`, `review_notes`…) ; s'y ajoutent `git_branch` et `verify_cmd` (backlog), `contract_id`, `producer_session`, `consumer_sessions`, `status`, `doc_section_ref` (registre).
- 2026-11-13 — Le document d'état passe aux 5 sections de la Phase C ; l'historique de mise en place est conservé en section 03.
- 2026-11-13 — Rubrics R1, R2 et R3 proposées en version 2 (5 critères, clauses éliminatoires) ; elles remplacent celles du 2026-11-12 une fois enregistrées et épinglées.
- 2026-11-13 — Budgets de temps (5 s, 75 s) et décomptes (520 tests, 120 vecteurs) sont des cibles ; la condition de passage est le code de sortie 0 et tous les tests verts.

### Décisions du 2026-11-13 (tour 2)

- **Pilotage automatique par un pilote et 7 voies** (ERRATA B-15) : Fisca-Lead-Orchestrator pilote depuis un fil ouvert par le propriétaire ; voies BACK-1, BACK-2, EDI-1, EDI-2, FRONT-1, FRONT-2, AUDIT ; le pilote relance les voies, lit la ligne VERDICT et fusionne. Remplace « l'auditeur délègue la fusion » et « chaque session programme son rappel », infaisables dans un fil délégué.
- **L'ordre des actions est calculé**, pas décidé de tête : `docs/orchestration/reference/pilot-status.mjs` (14 tests, simulation complète des 132 tickets).
- **La fusion se constate dans git** (B-16) ; fusions par commit de fusion, jamais par squash.
- **Arrêt avant S5 par défaut** : la release ne part que sur `RELEASE S5 : OUI` ; le tag v1.0.0 reste au propriétaire.
- **Schémas non publiés = régime provisoire, sans blocage** (B-13 révisé) : profil `cius-ma-provisional`, XSD SIMPL provisoires dérivés de Doc_07, contrats `PROVISIONAL`, `ClearanceGateway` simulée ; interdiction d'afficher une conformité officielle.
- **Le dépôt prime sur les skills** s'ils diffèrent : les mises à jour de skills passent par une carte à valider, les agents lisent donc d'abord `docs/orchestration/` et `ERRATA.md` de leur clone.
- **Annexes V = pièces justificatives** (D-21), pas des exigences.

## Tasks

### Todo (propriétaire du projet)

- Enregistrer les cartes de skills (8) et de rubrics (3) proposées dans le fil cmwefsofj00sc07ad6nt99wu0 ; épingler les rubrics v2 à l'auditeur et archiver les trois anciennes.
- Corriger deux passages des instructions des 3 agents constructeurs et de l'auditeur (règle de dépendance, rythme, écritures de l'auditeur) : texte fourni dans le même fil.
- Fusionner la Pull Request n° 1 du dépôt fisca, puis protéger `main` (PR obligatoire, 0 approbation, force-push et suppression bloqués).
- Lancer S0 dans un fil de Fisca-Lead-Orchestrator (message de lancement dans le skill `fisca-factory-runbook`) et accorder l'accès npm à ce fil.
- Avant la vague 2 : déposer le profil UBL CIUS-MA de xHub dans `docs/reference/dgi/`. Avant la vague 3 : les XSD officiels de la DGI.
- Avant P4-C : ajouter la permission « Workflows » au jeton GitHub ; le régénérer avant le 2026-12-12.

### In Progress

_Rien._

### Done

- 2026-11-13 — Lecture et recoupement des 18 spécifications et des 9 documents de procédure ; errata ; guide d'exécution v2 ; scripts de garde corrigés et testés ; Pull Request n° 1 ; document d'état restructuré ; mémoires mises à jour.
- 2026-11-13 — Backlog (132 tickets) et registre (149 contrats) importés dans les tables liées par Fisca-Lead-Orchestrator ; backlog comparé champ par champ à la graine, 0 écart.

### État au 2026-11-13 (tour 2)

- [x] PR n° 2 et n° 3 créées et fusionnées par Fisca-Lead-Orchestrator.
- [x] Rubric R1 v2, critère R1-C4, alignée sur le régime provisoire.
- [x] FISCA_STATE_AND_HANDOFF : sections 01, 02, 03 à jour (v2.1, bloc Voies).
- [ ] Propriétaire : enregistrer les 4 cartes de skills (gatekeeper v2.1, runbook v2.1, errata révision b, dgi-xsd § 4).
- [ ] Propriétaire : protéger `main` ; renouveler le jeton GitHub avec la permission Workflows ; « Run time limit » au maximum sur les 5 agents ; retirer les anciennes rubrics R1 à R3 et épingler les v2 à l'auditeur ; corriger « 4 critères » dans les instructions de l'auditeur.
- [ ] Propriétaire : envoyer le message de lancement unique à Fisca-Lead-Orchestrator, puis accorder npm aux 8 fils depuis la boîte de réception.
- [ ] À observer au premier lancement (non vérifiable avant) : reprise automatique du pilote à la fin d'une voie, rappels programmés depuis un tour de reprise, relais vers une voie depuis un tour de reprise. Secours prévu : le mot `CONTINUE`.

## Notes

_Miscellaneous notes and observations._
