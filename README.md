# Fisca

SaaS marocain de facturation électronique et de comptabilité ([fisca.ma](https://fisca.ma)), édité par SYNAPTIC SYSTEMS SARL AU.

Ce dépôt est construit par l'usine logicielle Fisca (agents Hyperagent), vague par vague (S0 à S5), selon la cartographie `docs/orchestration/cartographie-6-vagues.md`. La structure du monorepo (pnpm + Turborepo) est créée par la Session 0 sur la branche `feat/w0-foundation`.

## Règles de contribution

- Travail uniquement sur des branches `feat/*` ou `fix/*` ; aucune écriture directe sur `main`.
- Fusion sur `main` uniquement par Pull Request, par Fisca-Lead-Orchestrator, après la barrière QA (note ≥ 95/100).
- Ni force-push, ni suppression de branche distante, ni suppression de dépôt.
- Aucun secret dans le dépôt (jetons, clés, mots de passe).

## Documentation

- `docs/specs/` : les 18 documents de spécification en Markdown, source de vérité fonctionnelle.
- `docs/orchestration/` : cartographie des vagues, branches dédiées et dossiers verrouillés par session.
