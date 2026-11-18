---
name: fisca-cloudflare-staging-deploy
description: Déploiement de pré-production (staging) de Fisca sur Cloudflare via wrangler avec identifiants lus dans l'environnement du shell, jamais exposés. À utiliser pour déployer, tester à blanc ou vérifier une ressource fisca-staging-*.
---

# fisca-cloudflare-staging-deploy

Déploie et vérifie l'environnement de pré-production (staging) de Fisca sur Cloudflare sans jamais exposer d'identifiant.

## Règles

- Ne colle, n'affiche et ne journalise jamais un jeton Cloudflare (ni `CLOUDFLARE_API_TOKEN` ni `CF_STAGING_API_TOKEN`) dans un prompt, un message, un fichier ou un commit. Pas de `echo`, `env`, `printenv` ni `set -x` sur ces variables.
- Ce skill ne sert qu'à la pré-production : ne cible que des ressources dont le nom commence par `fisca-staging-`. Le jeton fourni est restreint à ces ressources ; si une commande vise autre chose (production comprise), arrête-toi et signale-le au lieu de chercher un contournement.
- Avant tout déploiement, vérifie dans la configuration wrangler du paquet que le nom de la ressource ciblée commence bien par `fisca-staging-`.

## Identifiants

Deux variables d'environnement du shell (voir `ENV.md`) :

- `CF_STAGING_API_TOKEN` : jeton API Cloudflare restreint aux ressources préfixées `fisca-staging-*`.
- `CF_ACCOUNT_ID` : identifiant du compte Cloudflare.

## Exécution

Passe toujours par le script attaché `cf-staging-wrangler.sh`, exécuté depuis le dossier scripts/ du skill avec les variables d'environnement du shell, depuis le dossier du Worker ou de l'application à déployer dans le dépôt `fisca`. Le script mappe `CF_STAGING_API_TOKEN` vers `CLOUDFLARE_API_TOKEN` et `CF_ACCOUNT_ID` vers `CLOUDFLARE_ACCOUNT_ID`, puis exécute `pnpm exec wrangler` avec les arguments reçus, sans jamais afficher les valeurs.

1. Le script est dans le dossier `scripts/` de ce skill ; note son chemin.
2. Vérifie l'authentification : `cd <dossier du paquet> && bash <chemin du script> whoami`.
3. Fais un essai à blanc : `bash <chemin du script> deploy --dry-run`, avec l'option d'environnement prévue par la configuration wrangler du paquet.
4. Déploie avec la même commande sans `--dry-run`, puis vérifie le résultat (URL ou sortie de wrangler) avant de déclarer le déploiement réussi.

## En cas d'échec

- Code de sortie 2 et message « CF_STAGING_API_TOKEN ou CF_ACCOUNT_ID absent » : le script n'a pas été lancé avec les variables d'environnement du shell, ou les identifiants ne sont pas encore renseignés.
- Erreur d'authentification ou d'autorisation Cloudflare : le jeton ne couvre pas la ressource visée. Ne tente pas un autre jeton ; signale la ressource et la permission manquante.
- `wrangler` introuvable : installe les dépendances du dépôt (`pnpm install`) puis relance.

## Adaptation Antigravity

- « Hyperagent les injecte comme variables d'environnement » / « section Scripts and credentials du skill » → variables d'environnement du shell (`ENV.md`).
- « RunWithCredentials (skill …) » → « exécuter le script depuis le dossier scripts/ du skill avec les variables d'environnement du shell ».
- « Récupère le script avec FetchSkillScripts » → « le script est dans le dossier scripts/ de ce skill ».
- Dans `scripts/cf-staging-wrangler.sh`, commentaire et message d'erreur reformulés (logique inchangée).
