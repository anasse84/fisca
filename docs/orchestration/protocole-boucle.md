# Protocole de boucle autonome Fisca (v2, 2026-11-13)

S'applique à toute session de construction (S0, S1A à P4-C, part orchestrateur de S5). Il remplace les « prompts maîtres » d'origine là où ils diffèrent ; les raisons sont dans `docs/specs/ERRATA.md` (section B).

## 1. Lois qui ne se négocient pas

1. Montants en centimes entiers, taux en points de base, quantités en milli-unités, cours en micro-unités. Toute division passe par `divRoundHalfUpBigInt`. Aucun flottant monétaire.
2. Aucune règle fiscale codée en dur : taux, seuils et cellules viennent des tables AST en D1.
3. Aucun code factice : pas de `TODO`, `FIXME`, `any`, `@ts-ignore`, `eslint-disable`, test `.skip` ou `.only`, ni valeur simulée en production.
4. Le test s'écrit avant le code. Un test existant ne s'affaiblit jamais pour passer au vert.
5. Tu n'écris que dans le périmètre de ta session, plus `pnpm-lock.yaml` et `.meta/`. Les fichiers de gouvernance (AGENTS.md, scripts de garde, `docs/specs/`, suite d'or) sont intouchables hors mode orchestrateur.
6. Tu pousses sur ta branche `feat/*` ou `fix/*`. Jamais de force-push, de suppression de branche, d'écriture sur `main`, de secret dans le dépôt. Seul Fisca-Lead-Orchestrator fusionne.
7. Un nom de route, de table, de binding ou de file se lit dans `fisca_contracts_registry` ou s'y inscrit au moment où tu le crées. Un XML ne se valide que contre son XSD officiel versionné.

## 2. Ouverture de session

1. Repère ta ligne dans la matrice des sessions (`.meta/session-scopes.json` ou `docs/orchestration/README.md`) : branche, base, périmètre, spécifications, rubrics, préalable. Si le préalable n'est pas rempli, arrête-toi et dis lequel.
2. Accès npm : `curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/zod`. Si la réponse n'est pas 200, appelle RequestNetworkAccess pour `registry.npmjs.org` et attends l'accord. Ne contourne jamais par un miroir.
3. Clone et branche, par le skill `fisca-github-repo-access` : si `origin/<branche>` existe, `git checkout <branche>` puis `pull --ff-only` ; sinon `git checkout -b <branche> <base>`. La base est `origin/main`, sauf S1B (`origin/feat/w1-auth-crypto-cndp`).
4. `bash scripts/bootstrap-sandbox.sh` avec les options de ta session (`--java`, `--dotnet`, `--python`, `--postgres`, `--redis`, `--playwright`), puis `export FISCA_SCOPE_DIRS=<périmètre>`.
5. Lance `pnpm verify:fast` avant tout changement. Rouge sur une branche neuve : `main` est cassée. N'y touche pas : consigne `MAIN_RED` avec la sortie dans `04_Circuit_Breaker_Blockers` et arrête-toi.
6. Lis `AGENTS.md`, `docs/specs/ERRATA.md`, puis les sections 01, 02 et 04 de FISCA_STATE_AND_HANDOFF.
7. Programme le rappel de continuité (section 5).

## 3. Cycle d'un ticket

**a. Choisir.** Dans `fisca_master_backlog`, prends le ticket `TODO` de ta session, assigné à ton agent, de plus petit `task_id`, dont chaque dépendance est satisfaite : `DONE`, ou `IN_REVIEW` avec son commit présent dans ta branche (`git merge-base --is-ancestor <sha> HEAD`). Un ticket `IN_PROGRESS` verrouillé par ta branche se reprend d'abord : si `git log origin/<branche> --grep '<task_id>'` trouve son commit, passe-le à `IN_REVIEW` ; sinon refais-le. Lis `review_notes` : elles portent les consignes de l'auditeur ou de l'errata.

**b. Verrouiller.** Avant de toucher un fichier : `status = IN_PROGRESS`, `locked_by_branch = <branche>`, `updated_at`. Un seul ticket verrouillé à la fois.

**c. Réaliser dans un contexte neuf.** Confie le ticket à un sous-agent du fil (outil de délégation interne) : il partage ton clone et ton accès réseau, et repart d'un contexte vide. Son brief se suffit à lui-même :

```text
Ticket <task_id> — <task_title>. Dépôt : <chemin du clone>, branche <branche> déjà extraite.
Écris uniquement dans : <workspace_pkg> (plus pnpm-lock.yaml). Lis d'abord AGENTS.md, docs/specs/ERRATA.md,
puis seulement les sections <spec_doc_ref> des fichiers docs/specs/<fichiers>. Consignes : <review_notes>.
Ordre : test d'abord, puis implémentation complète, puis `pnpm verify:fast` et `<verify_cmd>`.
Ne fais ni commit, ni push, ni écriture de table. Si un point de la spécification est contradictoire ou
qu'une entrée manque (schéma XSD, secret, contrat absent du registre), arrête-toi sans deviner.
Rends : fichiers créés ou modifiés, 15 dernières lignes de chaque commande de vérification, contrats créés
(nature, nom exact, fichier), points non vérifiés.
```

Sans outil de délégation interne, réalise le ticket toi-même, en gardant les sorties de commande courtes (`| tail -15`).

**d. Vérifier toi-même.** Relance `pnpm verify:fast` et le `verify_cmd` du ticket. Le rapport du sous-agent ne vaut pas preuve. Si le périmètre touche du XML : `pnpm test:xsd`. Si c'est une interface : contrôle dans un vrai navigateur à 375 px et 1440 px, clair et sombre.

**e. Publier.** Inscris chaque contrat créé dans `fisca_contracts_registry`. Puis `git add -A`, `FISCA_COMMIT_MSG="<type>(<paquet>): <résumé> [<task_id>]" git commit -m "$FISCA_COMMIT_MSG"`, et push par le skill Git. Au premier push de la session, ouvre la Pull Request en brouillon.

**f. Consigner.** `status = IN_REVIEW`, `tests_green = true`, `commit_url`, `updated_at`, `locked_by_branch` vidé. Tous les 5 tickets : trois lignes dans `03_Completed_Checkpoints` et ton bloc de `02_Active_Branches_And_Scopes`. Puis ticket suivant.

## 4. Disjoncteur

- Échec de vérification : incrémente `retry_count`, lis la trace réelle, corrige le code. Au troisième échec sur le même ticket : `git checkout -- . && git clean -fd`, `status = BLOCKED`, verrou vidé, puis dans `04_Circuit_Breaker_Blockers` : ticket, commande, 20 dernières lignes de sortie, ce qui a été tenté, hypothèse. Passe au ticket suivant qui n'en dépend pas.
- Blocage immédiat, sans consommer trois essais : spécification contradictoire que l'errata ne tranche pas (`SPEC_AMBIGUITY`), entrée manquante comme un XSD officiel ou un secret (`MISSING_INPUT`), besoin d'écrire hors périmètre (`SEAM_REQUEST`, en nommant le fichier et le changement voulu).
- Un ticket `BLOCKED` ne se débloque pas seul : l'orchestrateur ou le propriétaire tranche, remet `retry_count` à 0 et `status` à `TODO`.

## 5. Continuité sans intervention

- En début de tour, annule tes rappels en attente, puis programme un rappel dans ce même fil à 60 minutes avec la note : « RELAIS FISCA <SESSION_ID> : reprends le protocole de boucle à l'étape 3 sur la branche <branche>. S'il ne reste aucun ticket TODO de la session, clôture (étape 6). » Si le tour s'interrompt (durée limite, erreur), le rappel relance la session dans le fil où npm est déjà autorisé.
- Le clone local peut disparaître entre deux tours : refais alors l'ouverture de session (étapes 2 à 5 de la section 2). Rien n'est perdu, chaque ticket étant poussé.
- N'ouvre pas de fil neuf pour continuer : il n'aurait ni l'accord npm ni ton clone. À défaut d'outil de rappel seulement, délègue à une instance de ton propre agent avec un brief autonome et préviens que l'accès npm devra être accordé dans ce fil ; à défaut encore, consigne l'état et arrête-toi.
- Ne compte pas sur un Schedule : ses écritures sont limitées pour les agents constructeurs.

## 6. Clôture de session

Quand il ne reste aucun ticket `TODO` ou `IN_PROGRESS` de la session :

1. `pnpm verify:fast` vert sur la tête de branche, et `node scripts/enforce-constitution.ts --range origin/main` sans violation.
2. Exporte les lignes de ta session dans `.meta/backlog-snapshot-<SESSION_ID>.json`, commit et push.
3. Passe la Pull Request en « prête pour revue » : tickets livrés, tickets bloqués avec leur cause, commandes de vérification et leur dernière sortie, contrats ajoutés.
4. Mets à jour ton bloc de `02_Active_Branches_And_Scopes` (session close, PR, nombre de tickets `IN_REVIEW` et `BLOCKED`) et annule le rappel.
5. Termine par une ligne : `SESSION <ID> CLOSE — <n> IN_REVIEW, <m> BLOCKED — PR <url>`.

## 7. Écritures autorisées dans FISCA_STATE_AND_HANDOFF

| Section | Qui écrit |
|---|---|
| `01_Current_Wave_Status` | orchestrateur, auditeur (au verdict) |
| `02_Active_Branches_And_Scopes` | chaque session, son propre bloc seulement |
| `03_Completed_Checkpoints` | toute session, par ajout |
| `04_Circuit_Breaker_Blockers` | toute session, par ajout |
| `05_QA_Gate_Verdicts` | auditeur seulement |

Toujours par section, jamais en réécrivant le document.
