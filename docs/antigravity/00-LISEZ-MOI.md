# Fisca sur Antigravity CLI : mode d'emploi de la migration

Rédigé le 2026-11-18 par le pilote (Fisca-Lead-Orchestrator, Hyperagent). État de départ : `main` à `0dfd3cc`, vagues 0 à 2 fusionnées, **66/132 tickets DONE**, pilotage arrêté avant J2 et la vague 3. Ce dossier transporte l'usine Fisca de Hyperagent vers **Google Antigravity CLI (`agy`)** sans rien perdre : agents, compétences, mémoires, rubriques, apprentissage, wiki, état, tables, procédures.

## Ce que contient le dépôt après migration

| Chemin | Rôle | Équivalent Hyperagent |
|---|---|---|
| `AGENTS.md` (constitution, déjà existante) + `.agents/rules/fisca-memoire-active.md` | Règles toujours actives (budget 20 000 jetons à partager) | Mémoires de haute importance |
| `.agents/agents/*.md` | 6 sous-agents (tableau : `docs/antigravity/agents-README.md`) | Agents nommés |
| `.agents/skills/<nom>/SKILL.md` | 15 compétences Fisca + `fisca-rubrics` + `fisca-project-memory` | Skills et rubrics |
| `.agents/mcp_config.json` | Serveurs MCP (GitHub) | Intégrations |
| `docs/memoire/` | Une fiche par mémoire, index, historique Hyperagent | Mémoires |
| `docs/wiki/` | Pages du wiki | Autowiki |
| `docs/state/` | `FISCA_STATE_AND_HANDOFF.md`, contexte de projet | Documents |
| `ops/state/` | `backlog.json/csv`, `contracts-registry.json/csv` | Tables |
| `ops/antigravity/` | Scripts : installation, voies, boucle du pilote, planification | Fils, rappels, Schedule |
| `docs/antigravity/` | Ce guide (00 à 10) | — |
| `docs/hyperagent-origine/` | Configurations d'origine, intactes (référence) | — |

## Ordre d'emploi (quatre étapes)

1. **Installer** : `docs/antigravity/01-installation.md` (une commande : `bash ops/antigravity/install.sh`).
2. **Faire adapter par Antigravity lui-même** : coller dans `agy`, un par un, les prompts M0 à M8 de `03-prompts-migration.md`. Choisir le modèle le plus fort de ton forfait (`agy models`).
3. **Fournir ce qui manque** : `04-prerequis-proprietaire.md` (tableau, avec les prompts à passer pour chaque élément).
4. **Déclencher** : `10-prompts-lancement-vagues.md` (vague 3 à S5, en automatique) ; fonctionnement : `09-orchestration-parallele.md` et `05-planification-automatique.md`.

## Ce qui change vraiment (à retenir)

- **Plus de fils Hyperagent** : une *voie* = un worktree git + une conversation `agy` reprise de tour en tour. Le pilote tourne en boucle (`pilot-loop.sh`) ; il lance les voies en arrière-plan (`tmux`).
- **Plus de tables** : le backlog vit dans `~/.fisca-runtime/state/backlog.json` (modifié par `backlog.mjs`), avec un instantané versionné dans `ops/state/` à chaque barrière.
- **Plus de rappels programmés par l'outil** : la boucle shell et `cron` remplacent `ScheduleWakeUp`.
- **Plus de crédit de plan Hyperagent** : le quota se lit dans `/usage` ; voir `08-modeles-quotas.md`.
- **Bonne nouvelle** : la machine du propriétaire a Docker, Java 21 et Maven. Les tests de conteneurs et la partie Java de `pnpm verify:gate`, impossibles dans le bac à sable Hyperagent, deviennent exécutables ; le Dockerfile `fiscal-java`, jamais construit, doit l'être (prompt de la vague 3).
- **Inchangé** : ERRATA (révision e + D-25), protocole de boucle, barrières QA, seuil 95/100, fusion par commit de fusion par le seul pilote, régime DGI/xHub provisoire (jamais « conforme DGI »).

## Règle de préséance (inchangée)
`docs/specs/ERRATA.md` > `docs/orchestration/*.md` > `.agents/skills/*` > `AGENTS.md` > mémoires. En cas de contradiction, l'agent suit le fichier de gauche et le signale dans « À trancher ».

## Honnêteté sur ce qui n'a pas été testé
Je n'ai pas pu exécuter `agy` depuis Hyperagent. Les scripts de `ops/antigravity/` sont validés syntaxiquement ; leur premier vrai test est le prompt **M7 (répétition à blanc)**. Certains noms de champs du JSON de sortie d'`agy` (`conversation_id`, `finished_reason`) viennent de la documentation publique : M7 les vérifie et corrige les scripts si besoin. Le format exact de `.agents/hooks.json` est à confirmer de la même façon (M5).
