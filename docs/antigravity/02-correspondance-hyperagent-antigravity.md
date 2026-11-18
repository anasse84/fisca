# 02 — Correspondance Hyperagent → Antigravity

| Hyperagent | Antigravity / dépôt | Remarque |
|---|---|---|
| Agent nommé (6) | `.agents/agents/<nom>.md` (`subagent: true`, `tools`, `model`) ; session `agy -p --agent <nom>` | Original intact : `docs/hyperagent-origine/agents/` |
| Fil d'une voie (BACK-1…AUDIT) | worktree `~/fisca-factory/worktrees/<VOIE>` + conversation `agy` reprise (`--conversation`) + session `tmux fisca-<VOIE>` | `launch-lane.sh` |
| Pilote + `CreateAgentThread` + `SendThreadMessage` | `pilot-loop.sh` + `launch-lane.sh` ; relais = nouveau tour de la même conversation | `09-orchestration-parallele.md` |
| `ScheduleWakeUp` et échelle de rappels | boucle shell (`pilot-loop.sh`) ; `cron` ou « Scheduled Tasks » pour le curateur | `05` |
| Table `fisca_master_backlog` | `~/.fisca-runtime/state/backlog.json` + `backlog.mjs` ; instantané `ops/state/backlog.json` | statuts identiques |
| Table `fisca_contracts_registry` | `ops/state/contracts-registry.json` (modifié par PR) | lue par les agents |
| Document `FISCA_STATE_AND_HANDOFF` (5 sections) | `docs/state/FISCA_STATE_AND_HANDOFF.md` | mises à jour par `append` de section, jamais réécriture complète |
| Skills (`SKILL.md` + scripts) | `.agents/skills/<nom>/` (scripts dans `scripts/`) | `RunWithCredentials` → variables d'environnement du shell |
| Mémoires | `AGENTS.md` (règles essentielles) + `docs/memoire/` + skill `fisca-project-memory` | budget 20 000 jetons |
| Rubrics R1, R2, R3 + 6 rubriques d'agents | skill `fisca-rubrics` (`resources/`) | seuil 95/100 |
| Autowiki nocturne | agent `fisca-wiki-memory-curator` + `cron` 04:00 → PR `fix/wiki-AAAA-MM-JJ` | `06` |
| Apprentissage (suggestions mémoire/skill) | hook `Stop` + boîte `docs/memoire/_inbox/` triée par le curateur | `06` |
| Intégration GitHub (MCP) | `gh` + `git` ; option `.agents/mcp_config.json` | `07` |
| Politique d'accès (autonomie totale, pas de force-push, pas de suppression de dépôt) | `permissions` de `settings.json` (deny > ask > allow) | `07` |
| `RequestNetworkAccess` (npm bloqué) | inutile : réseau libre de la machine | — |
| Sous-agents `task` | sous-agents internes d'`agy` (`invoke_subagent`) | une voie ne doit pas en lancer deux sur les mêmes fichiers |
| Clone sur `main` entre deux tâches | clone principal **toujours sur main** ; le code se fait dans les worktrees | règle conservée |
| Ligne `ETAT PILOTE` | inchangée (fin de chaque tick) | |

Éléments **non repris** car propres à Hyperagent (consignés dans `docs/memoire/_historique-hyperagent/`) : erreur 402 des sous-agents, plafond de profondeur de délégation, lecture seule des tables inter-fils, filtre réseau npm du bac à sable, absence de Docker/Java.
