#!/usr/bin/env bash
# Lance wrangler avec les identifiants de pré-production (staging) Cloudflare de Fisca.
# À exécuter avec CF_STAGING_API_TOKEN et CF_ACCOUNT_ID exportés dans le shell,
# depuis le dossier du Worker ou de l'application à déployer dans le dépôt fisca.
# Les valeurs des identifiants ne sont jamais affichées.
set -euo pipefail

if [ -z "${CF_STAGING_API_TOKEN:-}" ] || [ -z "${CF_ACCOUNT_ID:-}" ]; then
  echo "ERREUR : CF_STAGING_API_TOKEN ou CF_ACCOUNT_ID absent. Exporter ces variables d'environnement dans le shell avant de lancer ce script." >&2
  exit 2
fi

if [ "$#" -eq 0 ]; then
  echo "Usage : cf-staging-wrangler.sh <arguments wrangler>   (ex. : whoami, ou deploy --dry-run)" >&2
  exit 2
fi

export CLOUDFLARE_API_TOKEN="$CF_STAGING_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"

exec pnpm exec wrangler "$@"
