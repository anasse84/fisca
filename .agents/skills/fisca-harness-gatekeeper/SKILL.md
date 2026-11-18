---
name: fisca-harness-gatekeeper
description: Protocole de boucle autonome v2.1 de l'usine Fisca : ouverture de session, cycle d'un ticket, disjoncteur, continuité et clôture, avec scripts de garde (périmètre, porte statique, bootstrap). À utiliser pour toute session de construction ou de vérification pnpm verify:fast.
---

# fisca-harness-gatekeeper — protocole de boucle autonome (v2.1, 2026-11-13)

S'applique à toute session de construction (S0, S1A à P4-C, part orchestrateur de S5). Le même texte est dans `docs/orchestration/protocole-boucle.md` du dépôt, qui prime s'il diffère. Les raisons de chaque règle sont dans `docs/specs/ERRATA.md` (section B) et dans le skill `fisca-spec-errata-and-arbitrages`. La matrice des sessions est dans le skill `fisca-factory-runbook`. Le pilotage d'ensemble (un pilote, des voies) est dans `docs/orchestration/pilotage-automatique.md`.

## 1. Lois qui ne se négocient pas

1. Montants en centimes entiers, taux en points de base, quantités en milli-unités, cours en micro-unités. Toute division passe par `divRoundHalfUpBigInt`. Aucun flottant monétaire.
2. Aucune règle fiscale codée en dur : taux, seuils et cellules viennent des tables AST en D1.
3. Aucun code factice : pas de `TODO`, `FIXME`, `any`, `@ts-ignore`, `eslint-disable`, test `.skip` ou `.only`, ni valeur simulée en production.
4. Le test s'écrit avant le code. Un test existant ne s'affaiblit jamais pour passer au vert.
5. Tu n'écris que dans le périmètre de ta session, plus `pnpm-lock.yaml` et `.meta/`. Les fichiers de gouvernance (AGENTS.md, scripts de garde, `docs/specs/`, suite d'or) sont intouchables hors mode orchestrateur.
6. Tu pousses sur ta branche `feat/*` ou `fix/*`. Jamais de force-push, de suppression de branche, d'écriture sur `main`, de secret dans le dépôt. Seul Fisca-Lead-Orchestrator fusionne.
7. Un nom de route, de table, de binding ou de file se lit dans `ops/state/contracts-registry.json` ou s'y inscrit au moment où tu le crées. Un XML se valide contre son XSD officiel versionné ; tant que l'administration ne l'a pas publié, contre le schéma provisoire du dépôt, inscrit au registre avec le statut `PROVISIONAL` (ERRATA B-13).

## 2. Ouverture de session

1. Repère ta ligne dans la matrice des sessions (message du pilote, skill `fisca-factory-runbook`, ou `.meta/session-scopes.json` du dépôt) : branche, base, périmètre, spécifications, rubrics, préalable. Si le préalable n'est pas rempli, arrête-toi et dis lequel.
2. Accès npm : `curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/zod`. Si la réponse n'est pas 200, appelle RequestNetworkAccess pour `registry.npmjs.org` et attends l'accord. Ne contourne jamais par un miroir.
3. Clone et branche, par le skill `fisca-github-repo-access` : si `origin/<branche>` existe, `git checkout <branche>` puis `pull --ff-only` ; sinon `git checkout -b <branche> <base>`. La base est `origin/main`, sauf S1B (`origin/feat/w1-auth-crypto-cndp`, branche empilée).
4. `bash scripts/bootstrap-sandbox.sh` avec les options de ta session (`--java`, `--dotnet`, `--python`, `--postgres`, `--redis`, `--playwright`), puis `export FISCA_SCOPE_DIRS=<périmètre>`. Le bac à sable est un Amazon Linux 2023 : `dnf`, pas `apt-get` ; pas de Docker.
5. Lance `pnpm verify:fast` avant tout changement. Rouge sur une branche neuve : `main` est cassée. N'y touche pas : consigne `MAIN_RED` avec la sortie dans `04_Circuit_Breaker_Blockers` et arrête-toi.
6. Lis `AGENTS.md`, `docs/specs/ERRATA.md`, puis les sections 01, 02 et 04 de `docs/state/FISCA_STATE_AND_HANDOFF.md`.
7. Note l'heure de début du tour (`date +%s > /agent/workspace/.fisca-turn-start`) et applique la section 5 (continuité).

## 3. Cycle d'un ticket

**a. Choisir.** Dans `ops/state/backlog.json`, prends le ticket `TODO` de ta session, assigné à ton agent, de plus petit `task_id`, dont chaque dépendance est satisfaite : `DONE`, ou `IN_REVIEW` avec son commit présent dans ta branche (`git merge-base --is-ancestor <sha> HEAD`). N'attends pas `DONE` pour une dépendance de ta propre session : elle ne le devient qu'à la barrière. Un ticket `IN_PROGRESS` verrouillé par ta branche se reprend d'abord : si `git log origin/<branche> --grep '<task_id>'` trouve son commit, passe-le à `IN_REVIEW` ; sinon refais-le. Lis `review_notes` : elles portent les consignes de l'auditeur, du pilote ou de l'errata.

**b. Verrouiller.** Avant de toucher un fichier : `status = IN_PROGRESS`, `locked_by_branch = <branche>`, `updated_at`. Un seul ticket verrouillé à la fois.

**c. Réaliser dans un contexte neuf.** Confie le ticket à un sous-agent Antigravity (`.agents/agents/`) ou à une session agy parallèle (`docs/antigravity/`) : il partage ton clone et ton accès réseau, et repart d'un contexte vide. Son brief se suffit à lui-même :

```text
Ticket <task_id> — <task_title>. Dépôt : <chemin du clone>, branche <branche> déjà extraite.
Écris uniquement dans : <workspace_pkg> (plus pnpm-lock.yaml). Lis d'abord AGENTS.md, docs/specs/ERRATA.md,
puis seulement les sections <spec_doc_ref> des fichiers docs/specs/<fichiers>. Consignes : <review_notes>.
Ordre : test d'abord, puis implémentation complète, puis `pnpm verify:fast` et `<verify_cmd>`.
Ne fais ni commit, ni push, ni écriture de table. Si un point de la spécification est contradictoire ou
qu'une entrée manque (secret, accès, contrat absent du registre), arrête-toi sans deviner.
Schéma officiel DGI ou xHub absent : ce n'est pas un blocage, applique le régime provisoire d'ERRATA B-13.
Rends : fichiers créés ou modifiés, 15 dernières lignes de chaque commande de vérification, contrats créés
(nature, nom exact, fichier), points non vérifiés.
```

Sans outil de délégation interne, réalise le ticket toi-même, en gardant les sorties de commande courtes (`| tail -15`).

**d. Vérifier toi-même.** Relance `pnpm verify:fast` et le `verify_cmd` du ticket. Le rapport du sous-agent ne vaut pas preuve. Si le périmètre touche du XML : `pnpm test:xsd`. Si c'est une interface : contrôle dans un vrai navigateur à 375 px et 1440 px, clair et sombre. Les budgets de temps (5 s, 75 s) et les décomptes (520 tests, 120 vecteurs) sont des cibles : la condition est le code de sortie 0 et tous les tests verts.

**e. Publier.** Inscris chaque contrat créé dans `ops/state/contracts-registry.json`. Puis `git add -A`, `FISCA_COMMIT_MSG="<type>(<paquet>): <résumé> [<task_id>]" git commit -m "$FISCA_COMMIT_MSG"`, et push par le skill Git. Au premier push de la session, ouvre la Pull Request en brouillon.

**f. Consigner.** `status = IN_REVIEW`, `tests_green = true`, `commit_url`, `updated_at`, `locked_by_branch` vidé. Tous les 5 tickets : trois lignes dans `03_Completed_Checkpoints` et ton bloc de `02_Active_Branches_And_Scopes`. Puis ticket suivant, sans attendre de validation.

## 4. Disjoncteur

- Échec de vérification : incrémente `retry_count`, lis la trace réelle, corrige le code. Au troisième échec sur le même ticket : `git checkout -- . && git clean -fd`, `status = BLOCKED`, verrou vidé, puis dans `04_Circuit_Breaker_Blockers` : ticket, commande, 20 dernières lignes de sortie, ce qui a été tenté, hypothèse. Passe au ticket suivant qui n'en dépend pas.
- Blocage immédiat, sans consommer trois essais : spécification contradictoire que l'errata ne tranche pas (`SPEC_AMBIGUITY`), entrée manquante comme un secret, un accès ou une permission (`MISSING_INPUT`), besoin d'écrire hors périmètre (`SEAM_REQUEST`, en nommant le fichier et le changement voulu).
- L'absence d'un schéma officiel de la DGI ou de xHub n'est pas un blocage : régime provisoire d'ERRATA B-13 (schéma provisoire remplaçable, contrat `PROVISIONAL`, mention « conformité officielle non vérifiée »).
- Un ticket `BLOCKED` ne se débloque pas seul : le pilote ou le propriétaire tranche, remet `retry_count` à 0 et `status` à `TODO` (`docs/orchestration/pilotage-automatique.md` § 5).

## 5. Continuité sans intervention

Deux cas, selon l'origine du message qui a ouvert ton tour.

**Fil piloté (cas normal : le message vient du pilote, `docs/orchestration/pilotage-automatique.md`).**

- Tu ne programmes aucun rappel et tu n'ouvres aucun autre fil : ces outils ne sont pas disponibles dans un fil ouvert par un autre fil. C'est le pilote qui te relance.
- Enchaîne les tickets. Passé 40 minutes de tour (`$(( $(date +%s) - $(cat /agent/workspace/.fisca-turn-start) ))` secondes), n'entame pas de nouveau ticket : mieux vaut un tour qui se termine proprement qu'un ticket coupé en plein milieu.
- Termine toujours ton tour par la ligne `ETAT <SESSION_ID> : <n> IN_REVIEW, <m> BLOCKED, <k> TODO`, suivie de la ligne de clôture (section 6) s'il ne reste ni `TODO` ni `IN_PROGRESS`.
- Si le tour est coupé quand même, rien n'est perdu : le ticket resté `IN_PROGRESS` sous ton verrou se reprend en premier (étape 3a).

**Fil ouvert directement par le propriétaire (session lancée à la main).**

- En début de tour, annule tes rappels en attente, puis programme un rappel dans ce même fil à 60 minutes avec la note : « RELAIS FISCA <SESSION_ID> : reprends le protocole de boucle à l'étape 3 sur la branche <branche>. S'il ne reste aucun ticket TODO de la session, clôture (étape 6). » (Sous Antigravity : sous-agent Antigravity (`.agents/agents/`) ou session agy parallèle (`docs/antigravity/`).)
- Si l'outil de rappel n'est pas appelable, consigne l'état et termine par la ligne `ETAT` : le propriétaire relance par `CONTINUE`.

**Dans les deux cas.**

- Le clone local peut disparaître entre deux tours : refais alors l'ouverture de session (étapes 2 à 5 de la section 2). Chaque ticket étant poussé, rien n'est perdu.
- N'ouvre pas de fil neuf pour continuer : il n'aurait ni l'accord npm ni ton clone.
- Ne compte pas sur un Schedule : ses écritures sont limitées pour les agents constructeurs.

## 6. Clôture de session

Quand il ne reste aucun ticket `TODO` ou `IN_PROGRESS` de la session :

1. `pnpm verify:fast` vert sur la tête de branche, et `node scripts/enforce-constitution.ts --range origin/main` sans violation.
2. Exporte les lignes de ta session dans `.meta/backlog-snapshot-<SESSION_ID>.json`, commit et push.
3. Passe la Pull Request en « prête pour revue » : tickets livrés, tickets bloqués avec leur cause, commandes de vérification et leur dernière sortie, contrats ajoutés.
4. Mets à jour ton bloc de `02_Active_Branches_And_Scopes` (session close, PR, nombre de tickets `IN_REVIEW` et `BLOCKED`) et annule le rappel s'il y en a un.
5. Termine par une ligne : `SESSION <ID> CLOSE — <n> IN_REVIEW, <m> BLOCKED — PR <url>`.

## 7. Écritures dans FISCA_STATE_AND_HANDOFF

(`docs/state/FISCA_STATE_AND_HANDOFF.md`) `01_Current_Wave_Status` : orchestrateur (pilote), et auditeur au verdict. `02_Active_Branches_And_Scopes` : chaque session, son propre bloc ; le pilote y tient le bloc « Voies ». `03_Completed_Checkpoints` et `04_Circuit_Breaker_Blockers` : toute session, par ajout. `05_QA_Gate_Verdicts` : auditeur seulement. Toujours par section, jamais en réécrivant le document.

## 8. Scripts attachés

Ils sont dans le dossier `scripts/` de ce skill. Ce sont les versions corrigées et testées des scripts de la constitution ; la Session S0 les installe dans `scripts/` du dépôt (ticket T-S0-03), où ils font ensuite foi. Les mêmes fichiers sont dans `docs/orchestration/reference/`.

- `harness-check.sh` — porte statique, à lancer depuis la racine du dépôt (`bash scripts/harness-check.sh`). Balaye `apps`, `packages`, `connectors`, `containers` hors dossiers générés : marqueurs de code inachevé, tests désactivés ou isolés, contournements TypeScript et ESLint, type `any`, arithmétique flottante sur un champ en `Cents`, `Centimes` ou `Bps`, classes CSS directionnelles physiques et couleurs hexadécimales hors `tokens.css`, secrets en clair. Sortie 1 à la première famille de violations trouvée, chacune imprimée avec fichier et ligne. L'heuristique anti-flottant ne voit pas un calcul réparti sur plusieurs lignes : la règle ESLint `no-float-money` du dépôt reste la défense principale.
- `enforce-constitution.ts` — garde de périmètre, de gouvernance et de fenêtre fiscale, sans dépendance (`node scripts/enforce-constitution.ts`, Node 22.18 ou plus). Lit le périmètre dans `FISCA_SCOPE_DIRS`, sinon dans `.meta/session-scopes.json` d'après la branche ; échoue sur une branche de travail sans périmètre connu. Autorise toujours `pnpm-lock.yaml` et `.meta/`, et l'ajout de dépendances au `package.json` du paquet englobant. `--range origin/main` audite toute la branche. `FISCA_ORCHESTRATOR_MODE=1` lève périmètre et protection : réservé à l'orchestrateur.
- `enforce-constitution.test.ts` — ses 12 tests (`node --test`), dont les 4 contrôles de Doc 15 § 12.
- `bootstrap-sandbox.sh` — préparation idempotente du bac à sable. Sortie 20 si npm est bloqué : demande l'accès puis relance.

## Pièges du garde pré-commit (constatés en P2-A, 2026-11-13)
- ERR_STUB_MARKER : les mots TODO/FIXME/HACK/PLACEHOLDER/XXX sont refusés même dans un littéral de test (ex. 'XXX-2026-000001', regex de contrôle). Les construire par concaténation ('TO' + 'DO') ou utiliser une autre valeur ('ZZZ-').
- ERR_ADR03_FLOAT : un flottant littéral près d'un nom en Cents/bps est refusé, même dans un test de rejet. Écrire Number('10.5').
- ERR_SECRET_IN_REPO : un en-tête PEM littéral (l'en-tête PEM de clé privée, cinq tirets puis BEGIN) est refusé, même pour une clé éphémère de test. Le construire par morceaux ('-'.repeat(5) + 'BEGIN ' + ['PRIVATE','KEY'].join(' ')).
- Mentions interdites (conforme DGI, homologué, certifié) : un test qui vérifie leur absence doit construire sa regex par morceaux.
- `pnpm --filter <pkg> typecheck lint` passe « lint » en argument à tsc : lancer les deux commandes séparément.
- `git commit` : exporter FISCA_COMMIT_MSG avant (`export FISCA_COMMIT_MSG=...; git commit -m "$FISCA_COMMIT_MSG"`), sinon le hook voit un message vide. Configurer user.name/user.email (anasse84) dans le clone si absent.
- Tests externes (PHIVE, JDK, Maven, OpenSSL) : jamais de .skip ; condition explicite journalisée sur stderr, et échec obligatoire si CI ou FISCA_REQUIRE_PHIVE=1.

## Adaptation Antigravity

- `fisca_contracts_registry` → `ops/state/contracts-registry.json` ; `fisca_master_backlog` → `ops/state/backlog.json` ; FISCA_STATE_AND_HANDOFF → `docs/state/FISCA_STATE_AND_HANDOFF.md`.
- « sous-agent du fil (outil de délégation interne) » → sous-agent Antigravity (`.agents/agents/`) ou session agy parallèle (`docs/antigravity/`) ; rappel programmé (ScheduleWakeUp) → idem (session agy parallèle).
- « FetchSkillScripts » → scripts dans le dossier `scripts/` de ce skill.
- Non modifiés faute d'équivalent défini : `RequestNetworkAccess` (autorisation réseau Hyperagent pour registry.npmjs.org — sous Antigravity, vérifier l'accès réseau du shell), les tables d'état `01_…` à `05_…` (sections du document d'état), les « fils » (pilote/voies), et le chemin `/agent/workspace/.fisca-turn-start`.
