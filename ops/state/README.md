# ops/state — état du backlog et registre des contrats

Export fidèle des deux tables Hyperagent de l'usine logicielle Fisca, au moment de l'export (les tables avaient `updated_at` le plus récent au 2026-11-13 ; état de pilotage au 2026-11-15, `main` = `0dfd3cc`).

| Fichier | Source | Lignes |
|---|---|---|
| `backlog.json` / `backlog.csv` | table `fisca_master_backlog` (`cmwczkg2001iq06ad9boev2sa`) | **132** |
| `contracts-registry.json` / `contracts-registry.csv` | table `fisca_contracts_registry` (`cmwczkg6801r106adzlsd3vrg`) | **237** |

Le JSON contient `tableId`, `title`, `columns` (nom, type, description), `rows` (toutes les colonnes, valeurs brutes telles que renvoyées, y compris la colonne technique `id` Hyperagent) ; le CSV contient les mêmes colonnes (UTF-8, en-tête, guillemets RFC 4180, booléens en `true/false`, valeurs absentes = cellule vide).

## Décompte des tickets par statut (backlog, 132 lignes)

| Statut | Tickets |
|---|---|
| **DONE** | **66** |
| TODO | 66 |
| IN_PROGRESS | 0 |
| IN_REVIEW | 0 |
| BLOCKED | 0 |
| **Total** | **132** |

Par session : S0 8 DONE · S1A 10 DONE · S1B 12 DONE · G1 3 DONE · P2-A 10 DONE · P2-B 12 DONE · P2-C 8 DONE · G2 3 DONE (= 66 DONE) ; P3-A 12 · P3-B 10 · P3-C 9 · G3 3 · P4-A 9 · P4-B 9 · P4-C 7 · G4 3 · S5 4 TODO (= 66 TODO).
Par agent : Core-Backend-Fiscal 48, Containers-EDI-ERP 31, Frontend-Mobile-Growth 29, QA-Security-Auditor 14, Lead-Orchestrator 10. Aucun verrou actif (`locked_by_branch` vide partout), `retry_count` = 0 partout.

Registre : 237 contrats — statuts LOCKED 153, DRAFT 54, PROVISIONAL 30 ; `verified=true` 78, `false` 159. Types : API_ROUTE 67, D1_TABLE 59, CODE_CONTRACT 36, D1_TRIGGER 24, WRANGLER_BINDING 13, ENV_SECRET 10, XSD_SCHEMA 10, MCP_TOOL 7, QUEUE_NAME 5, D1_INDEX 3, MCP_SERVER 1, D1_VIEW 1, D1_COLUMN 1.

## Colonnes du backlog (`fisca_master_backlog`)

| Colonne | Type | Rôle |
|---|---|---|
| `task_id` | texte | Identifiant unique du ticket (ex. `T-S0-01`, `T-P2B-10`, `T-G2-01`). Unique sur les 132 lignes. |
| `phase_num` | nombre | Numéro de phase du plan de construction. |
| `workspace_pkg` | texte | Paquet ou dossier du monorepo concerné (ex. `apps/api-hono`, `.meta`) ; liste séparée par des virgules possible. |
| `task_title` | texte | Intitulé court. |
| `spec_doc_ref` | texte | Référence spec, ex. `Doc_04_TDD#S02` = `04-tdd-architecture.md`, section 02. |
| `assigned_agent` | texte | Agent responsable (Fisca-Lead-Orchestrator, Fisca-Core-Backend-Fiscal, Fisca-Containers-EDI-ERP, Fisca-Frontend-Mobile-Growth, Fisca-QA-Security-Auditor). |
| `locked_by_branch` | texte | Branche qui verrouille le ticket ; à renseigner **avant** de toucher un fichier, pour éviter les collisions entre voies parallèles ; vide quand le ticket est libre. |
| `status` | texte | `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`, `BLOCKED`. |
| `retry_count` | nombre | Échecs de validation consécutifs sur la même erreur (circuit breaker à 3). |
| `tests_green` | booléen | La suite de tests du ticket passe. |
| `rubric_score` | nombre | Score de rubrique sur 100 (seuil d'acceptation 95). |
| `commit_url` | url | Lien du commit ou de la PR. |
| `updated_at` | date | Dernière mise à jour de la ligne. |
| `session_id` | texte | Session du plan (S0, S1A, S1B, G1, P2-A/B/C, G2, P3-A/B/C, G3, P4-A/B/C, G4, S5). |
| `depends_on` | texte | Tickets prérequis (séparés par des virgules). |
| `review_notes` | texte | Notes de revue/refus de l'auditeur, consignes de l'orchestrateur, pointeurs vers `docs/orchestration/`. |
| `git_branch` | texte | Branche de travail prévue pour le ticket (`feat/*` ou `fix/*`). |
| `verify_cmd` | texte | Commande de vérification du ticket (ex. `pnpm verify:gate`). |
| `id` | texte | Identifiant technique de la ligne côté Hyperagent. |

## Colonnes du registre (`fisca_contracts_registry`)

`contract_id` (ex. `CTR-BND-01`) · `resource_kind` (API_ROUTE, D1_TABLE, WRANGLER_BINDING, ENV_SECRET, QUEUE_NAME, XSD_SCHEMA, MCP_TOOL…) · `exact_name` (nom exact à utiliser dans le code — aucun nom inventé) · `defined_in_file` · `payload_or_schema_summary` · `verified` (vrai une fois l'existence et le nom vérifiés dans le dépôt) · `producer_session` · `consumer_sessions` · `status` (`DRAFT`, `LOCKED`, `PROVISIONAL`) · `doc_section_ref` · `id` (technique). `PROVISIONAL` = contrat adossé à un schéma DGI/xHub non publié (régime provisoire, ERRATA B-13 révisé).

## Règles de statut

États : **TODO → IN_PROGRESS → IN_REVIEW → DONE**, avec **BLOCKED** en cas de blocage.

- `TODO` : prêt à être pris si toutes les dépendances sont satisfaites. Une dépendance est satisfaite si le ticket est `DONE`, ou `IN_REVIEW` avec son commit dans la branche.
- `IN_PROGRESS` : le constructeur a renseigné `locked_by_branch` (et `git_branch`) puis travaille. Un seul verrou par ticket ; lots de 5 tickets au plus par voie.
- `IN_REVIEW` : travail livré sur la branche, `commit_url` renseigné, en attente d'audit.
- `DONE` : audité FAVORABLE (`rubric_score` ≥ 95 sur chaque rubrique engagée, `tests_green` vrai) **et** fusion constatée dans git (merge commit sur `main`, jamais squash). Un ticket de barrière (G1…G4, S5) n'est `DONE` qu'une fois la fusion observée dans git.
- Refus d'audit : retour à `TODO` avec `review_notes` ; `retry_count` +1.
- `BLOCKED` : dépendance externe ou circuit breaker déclenché ; motif en `review_notes` et en section 04 de `docs/state/FISCA_STATE_AND_HANDOFF.md`.
- `retry_count` : nombre d'échecs de validation **consécutifs sur la même erreur** ; remis à 0 après un succès ou un changement d'erreur.
- **Circuit breaker à 3** : à `retry_count = 3`, on s'arrête (pas de 4ᵉ tentative) : le ticket passe `BLOCKED`, le blocage est consigné en section `04_Circuit_Breaker_Blockers` avec l'erreur, les 3 tentatives et la décision attendue, et l'orchestrateur/propriétaire arbitre.
- `locked_by_branch` : miroir de la section `02_Active_Branches_And_Scopes`. Vérifier avant toute écriture qu'il est vide ou égal à sa propre branche ; libérer (vider) à la fusion ou à l'abandon. Un verrou orphelin est signalé au curateur/orchestrateur, jamais effacé sans preuve git.
- **Seuil de score : 95/100** par rubrique (R1, R2, R3) — voir `.agents/skills/fisca-rubrics/SKILL.md`. Le verdict de l'auditeur finit par `VERDICT <barrière> : FAVORABLE/DÉFAVORABLE`.
- Branches : `feat/*` et `fix/*` uniquement ; fusion sur `main` réservée à Fisca-Lead-Orchestrator ; pas de force-push ; pas de suppression de dépôt.

## Anomalies constatées dans l'export (conservées telles quelles)

1. **Types hétérogènes** : `tests_green` est le booléen `true` pour 0 ligne et la **chaîne** `"true"` pour 60 lignes DONE (les 72 autres sont de vrais booléens `false`/…) ; `retry_count` est la chaîne `"0"` pour 3 lignes (`T-S1B-12`, `T-P2B-05`, `T-P2B-10`) ; `rubric_score` est une chaîne (`"95"`, `"97"`) quand il est présent. JSON fidèle (valeurs brutes) ; le CSV normalise les booléens.
2. **`rubric_score` absent** (clé non présente) pour 69 lignes dont 3 DONE (`T-G2-01/02/03`) ; les scores G2 (R1 100, R2 97, R3 97) sont dans le document d'état, section 05, pas dans la table.
3. **Lignes DONE sans `tests_green` vrai** : `T-G1-01/02/03` et `T-G2-01/02/03` (tickets de barrière : `tests_green=false`), et sans `commit_url` pour `T-G1-01`, `T-G1-02`, `T-G2-01/02/03`.
4. Comptes confirmés : **66 DONE sur 132**, 66 TODO, aucun IN_PROGRESS/IN_REVIEW/BLOCKED, aucun verrou.
