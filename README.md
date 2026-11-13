# Fisca

SaaS marocain de facturation électronique et de comptabilité ([fisca.ma](https://fisca.ma)), édité par SYNAPTIC SYSTEMS SARL AU.

Ce dépôt est construit par l'usine logicielle Fisca (agents Hyperagent), vague par vague (S0 à S5), selon le guide d'exécution `docs/orchestration/README.md` (17 sessions, 132 tickets). La structure du monorepo (pnpm + Turborepo) est créée par la Session 0 sur la branche `feat/w0-foundation`.

## Règles de contribution

- Travail uniquement sur des branches `feat/*` ou `fix/*` ; aucune écriture directe sur `main`.
- Fusion sur `main` uniquement par Pull Request, par Fisca-Lead-Orchestrator, après la barrière QA (note ≥ 95/100).
- Ni force-push, ni suppression de branche distante, ni suppression de dépôt.
- Aucun secret dans le dépôt (jetons, clés, mots de passe).

## Documentation

- `docs/specs/` : les 18 documents de spécification en Markdown, source de vérité fonctionnelle.
- `docs/specs/ERRATA.md` : corrections et arbitrages, qui priment sur les 18 documents.
- `docs/orchestration/` : matrice des sessions, protocole de boucle, barrières QA, bac à sable, scripts de garde de référence.
- `docs/reference/dgi/` : schémas XSD et cahiers des charges officiels de la DGI, à déposer par le propriétaire du projet.
- `.meta/` : matrice des sessions lisible par les scripts, graines du backlog et du registre des contrats.
