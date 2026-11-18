# Variables d'environnement — fisca-cloudflare-staging-deploy

| Nom | Obligatoire | Description |
|---|---|---|
| `CF_STAGING_API_TOKEN` | oui | Jeton API Cloudflare restreint aux ressources préfixées `fisca-staging-*`. Mappé par le script vers `CLOUDFLARE_API_TOKEN`. Valeur non exportée ici. |
| `CF_ACCOUNT_ID` | oui | Identifiant du compte Cloudflare. Mappé vers `CLOUDFLARE_ACCOUNT_ID`. Valeur non exportée ici. |
