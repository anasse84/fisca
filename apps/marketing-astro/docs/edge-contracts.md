# Contrats du Worker `fisca-marketing` (T-P2C-08) : tous PROVISIONAL

Aucun de ces contrats n'est inscrit à `fisca_contracts_registry`. Ils sont choisis dans ce ticket, restent `PROVISIONAL`, et sont à
inscrire au registre puis à créer en P4 (provisionnement Cloudflare). Aucune valeur de secret ni identifiant de ressource n'est dans le dépôt.

## Routes

| Méthode et chemin | Rôle | Authentification |
|---|---|---|
| `POST /api/internal/wiki-events` | Événement « règle AST activée / page Wiki publiée » | HMAC-SHA256, en-têtes `X-Fisca-Timestamp` (secondes) et `X-Fisca-Signature` (hex) ; message signé `${timestamp}.${corps brut}` ; tolérance d'horloge 300 s par défaut ; `Content-Type: application/json` obligatoire (le contrôle d'origine d'Astro refuse sinon) |
| `POST /api/handoff` | Émet le lien signé vers `https://app.fisca.ma/` | Origine identique (pas de cookie) |
| `GET /<clé IndexNow>.txt` | Fichier de clé IndexNow | Servi seulement si le nom correspond à la liaison |

Corps de l'événement : `{ "eventId": "[A-Za-z0-9_-]{8,64}", "kind": "AST_RULE_ACTIVATED" | "WIKI_PAGE_PUBLISHED", "occurredAt": "<ISO 8601 UTC>", "pages": [{ "locale": "<préfixe d'URL>", "slug": "..." }] }` ; `pages` vide ou absent = tout le registre. `occurredAt` devient `dateModified`.

## Paramètre du lien signé

Nom de requête `fisca_handoff` : `https://app.fisca.ma/?fisca_handoff=v1.<charge utile base64url>.<signature hex>`.
Charge utile : `{ "v": 1, "ice": "<15 chiffres>", "n": "<nonce base64url>", "exp": <secondes epoch> }`.
Signature : HMAC-SHA256(secret, `fisca-handoff-v1.` + charge utile base64url). Durée de vie : paramètre (variable `MARKETING_HANDOFF_TTL_SECONDS`, 10 à 900 s, défaut 120 s).
À brancher quand la route d'inscription de l'application sera spécifiée ; `verifyHandoffToken` (src/edge/handoff.ts) est la vérification de référence, avec un port `NonceStore` à adosser à un stockage atomique côté application.

## Liaisons à créer en P4 (noms choisis ici)

| Nom | Type | Usage |
|---|---|---|
| `MARKETING_EDGE_KV` | KV | compteurs `tel:`, fraîcheur `fresh:`, événements traités `evt:` |
| `MARKETING_WIKI_WEBHOOK_SECRET` | secret | HMAC de l'événement Wiki |
| `MARKETING_INDEXNOW_KEY` | secret | clé IndexNow (8 à 128 caractères `a-zA-Z0-9-`) |
| `MARKETING_HANDOFF_SECRET` | secret | HMAC du lien vers l'application |
| `MARKETING_HANDOFF_TTL_SECONDS` | variable | durée de vie du lien, en secondes (optionnelle) |
| `MARKETING_SITEMAP_PING_URLS` | variable | modèles d'URL de ping, `{sitemap}` remplacé (optionnelle ; vide par défaut) |

`wrangler.jsonc` ne déclare volontairement aucun `kv_namespaces` : il exigerait un identifiant de ressource qui n'existe pas encore.
Sans liaison, le site fonctionne : télémétrie, fraîcheur et cache edge sont ignorés, les routes répondent 503 ou 404.
