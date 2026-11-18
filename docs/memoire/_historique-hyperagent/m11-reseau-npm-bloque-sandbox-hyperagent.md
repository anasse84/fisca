---
id_source: cmwdk1ipd02nt07ad433dmcsa
category: tools_and_workflows
importance: 5
tags: ["fisca", "réseau", "npm", "pnpm", "sandbox", "RequestNetworkAccess"]
whenToUse: "Avant toute installation de dépendances (pnpm install, npm, npx) dans une session Fisca, et lors de la conception des relais planifiés."
date_creation: 2026-11-12T12:59:28Z
titre: "M11 — Accès réseau du sandbox Hyperagent (npm bloqué, RequestNetworkAccess)"
applicabilite: non applicable à Antigravity
---
# M11 — Accès réseau du sandbox Hyperagent (npm bloqué, RequestNetworkAccess)

> **Non applicable à Antigravity** — mémoire propre à Hyperagent, conservée pour historique uniquement. Ne pas appliquer ces règles.

## Contenu intégral (inchangé)

[Fisca · M11 — Accès réseau du sandbox] Dans chaque fil, le filtre réseau d'Hyperagent bloque registry.npmjs.org (et registry.yarnpkg.com) tant que le domaine n'est pas autorisé : npm et pnpm échouent en 403 « blocked by network policy ». Remède : appeler RequestNetworkAccess avec le domaine registry.npmjs.org ; l'utilisateur doit approuver, et l'accord ne vaut que pour ce fil (un autre fil repart sans accord). Joignables sans accord (relevé du 2026-11-12) : github.com, PyPI et files.pythonhosted.org, Maven Central, Gradle, NuGet, nodejs.org, api.adoptium.net, astral.sh. Conséquences : demander l'accès npm dès le début de chaque session de construction ; un relais planifié doit continuer dans le fil de session déjà autorisé (threadStrategy continue) plutôt qu'ouvrir un fil neuf ; ne jamais contourner le filtre par un miroir npm.
