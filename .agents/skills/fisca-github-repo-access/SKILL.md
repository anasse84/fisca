---
name: fisca-github-repo-access
description: Clone et push authentifiés du dépôt privé anasse84/fisca via un jeton GitHub lu dans l'environnement du shell, jamais exposé. À utiliser pour clone, fetch, pull, push, ls-remote ou toute question d'accès Git au dépôt fisca.
---

# fisca-github-repo-access

Clone et pousse le dépôt privé `anasse84/fisca` avec un jeton injecté à l'exécution. Requis pour la Session S0 et toutes les sessions de boucle : le harnais `pnpm verify:fast` tourne sur un clone local. Le dépôt est privé : tout accès authentifié passe par ce skill.

## Règles

- Le jeton `GITHUB_TOKEN` n'apparaît jamais dans un message, un fichier, un commit ou une sortie de commande : pas d'echo, de printenv, de set -x ni de cat sur cette variable.
- Le jeton doit rester limité au seul dépôt `anasse84/fisca` (fine-grained) : Contents lecture/écriture, Pull requests lecture/écriture, Metadata lecture. Aucune permission d'administration, aucune suppression de dépôt.
- Toute commande git qui touche le réseau (clone, fetch, pull, push, ls-remote) passe par exécuter le script depuis le dossier scripts/ du skill avec les variables d'environnement du shell, en appelant le script `git-auth.sh`. Les commandes locales (status, add, commit, branch, log, diff) se lancent normalement, sans identifiants.
- Le script refuse tout force-push (`-f`, `--force`, `--force-with-lease`, `+branche`), toute suppression de branche distante (`--delete`, `:branche`), `--all`, `--mirror` et tout push vers `main` ou `master`. La fusion sur `main` passe par une Pull Request, réservée à Fisca-Lead-Orchestrator. Ces garde-fous ne remplacent pas la protection de branche GitHub sur `main`.
- Les Pull Requests, commentaires et fusions se font par l'intégration GitHub (actions MCP), pas par ce skill.

## Procédure

1. Le script est dans le dossier `scripts/` de ce skill ; note son chemin, ci-dessous `<chemin>`.
2. Clone :
   exécuter le script depuis le dossier scripts/ du skill avec les variables d'environnement du shell, avec la commande `bash <chemin>/git-auth.sh clone https://github.com/anasse84/fisca.git fisca`
3. Travail local, sans identifiants : `cd fisca && git checkout -b feat/...`, modifications, tests, `git add`, `git commit`.
4. Push :
   exécuter le script (variables d'environnement du shell) avec la commande `cd fisca && bash <chemin>/git-auth.sh push -u origin <branche>`
5. Mise à jour du clone :
   exécuter le script avec `cd fisca && bash <chemin>/git-auth.sh fetch origin` ou `pull --ff-only origin <branche>`.

Vérification rapide du jeton : `bash <chemin>/git-auth.sh ls-remote https://github.com/anasse84/fisca.git HEAD` répond sans erreur d'authentification.

## En cas d'échec

- Code de sortie 2 et « GITHUB_TOKEN absent » : la commande n'a pas été lancée avec les variables d'environnement du shell, ou le jeton n'est pas renseigné.
- Code de sortie 3 et « interdit » : un garde-fou a bloqué la commande (force-push, suppression, push vers main). Passe par une branche feat/* ou fix/* et une Pull Request.
- « could not read Username for 'https://github.com' » : git a été lancé sans le script ou hors environnement du shell avec le jeton.
- Erreur 401 ou 403 : le jeton n'a pas les permissions attendues sur `anasse84/fisca`. Ne tente pas un autre jeton ; signale la permission manquante.
- Réseau : la sortie du sandbox est HTTPS uniquement ; git over SSH ne passera pas, utilise toujours l'URL HTTPS.

## Dépôt vide : amorçage de main

Le 2026-11-12, le dépôt anasse84/fisca était vide : aucune branche, aucun commit, taille 0 Ko. Tant que main n'existe pas, aucune Pull Request n'est possible et la protection de branche ne peut pas être posée. Le script git-auth.sh refuse tout push vers main, donc le premier commit (README + docs/specs/) se fait par l'intégration GitHub, avec une action de création de fichier qui fonctionne sur un dépôt vide. Ordre à suivre : 1) commit d'amorçage sur main par le coordinateur ; 2) l'utilisateur protège main (PR obligatoire, force-push et suppression interdits) ; 3) S0 clone le dépôt et livre par Pull Request sur feat/w0-foundation.

## Vérification et expiration du jeton

- Jeton vérifié le 2026-11-12. Il est de type fine-grained : écriture acceptée sur fisca, refusée (403) sur tout autre dépôt. Il reste lisible sur les dépôts publics, ce qui est normal pour ce type de jeton.
- Le jeton expire le 2026-12-12 à 11:20 UTC. Avant cette date, l'utilisateur doit le régénérer dans GitHub (Regenerate token) puis recoller la nouvelle valeur dans le skill, sinon toutes les sessions perdent l'accès au dépôt.
- Contrôle rapide de l'écriture sans rien créer : `bash <chemin>/git-auth.sh push --dry-run origin HEAD:refs/heads/feat/smoke-dry-run`, lancé depuis un dépôt local temporaire dont l'origin pointe vers fisca.

## État du dépôt depuis le 2026-11-12 (remplace la section « Dépôt vide »)

La branche `main` existe désormais. Commit `e86281d` : README avec les règles de contribution. Commit `d1b6e7b` : `docs/specs/README.md` (index des 18 spécifications) et `docs/orchestration/cartographie-6-vagues.md` (cartographie convertie, avec un encadré « Écarts validés »). L'amorçage est terminé : ne jamais recréer `main` ni y écrire directement. Tout ajout ultérieur, y compris les spécifications, passe par une branche `feat/*` (par ex. `feat/docs-specs`) puis par une Pull Request.

Protection prévue sur `main` (ruleset GitHub posé par l'utilisateur) :
- Pull Request obligatoire avec 0 approbation requise. Tous les agents agissent sous le compte `anasse84`, et GitHub interdit d'approuver sa propre Pull Request.
- Force-push et suppression bloqués.
- Aucune liste de contournement.

Avant tout `pnpm install` après un clonage, le registre npm doit être autorisé dans le fil : voir la mémoire M11.

## Adaptation Antigravity

- « RunWithCredentials (skill …) » → « exécuter le script depuis le dossier scripts/ du skill avec les variables d'environnement du shell ».
- « Récupère le script avec FetchSkillScripts » → « le script est dans le dossier scripts/ de ce skill ».
- Dans `scripts/git-auth.sh`, deux messages/commentaires mentionnant RunWithCredentials ont été reformulés (logique inchangée).
- Les mentions « dans le skill » (jeton à renseigner/coller) désignent désormais la variable d'environnement `GITHUB_TOKEN` (voir ENV.md). La référence « mémoire M11 » (autorisation du registre npm dans le fil) est propre à Hyperagent et n'a pas d'équivalent exporté.
