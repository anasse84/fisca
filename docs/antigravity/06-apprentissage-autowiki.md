# 06 — Apprentissage continu et autowiki sur Antigravity

Hyperagent apprenait de deux façons : (1) il proposait des **mémoires, skills, rubriques** à partir des conversations ; (2) l'**autowiki** reconstruisait chaque nuit des pages à partir des mémoires, conversations et documents. Antigravity n'a pas d'équivalent natif : on le reconstruit avec des fichiers, un hook et le curateur.

## Boucle d'apprentissage
```
[chaque tour d'agent] ──Stop hook──▶ docs/memoire/_inbox/AAAA-MM-JJ.md   (leçons brutes, datées, signées par l'agent)
                                         │
              04:00 (cron) curate.sh ◀───┘
                    │ trie chaque entrée :
                    ├─ nouvelle fiche  → docs/memoire/<catégorie>/<slug>.md (+ INDEX.md)
                    ├─ fiche existante → mise à jour (journal des modifications en tête)
                    ├─ règle toujours active → proposition de ligne pour AGENTS.md (jamais écrite sans PR)
                    ├─ procédure répétable → proposition de skill ou mise à jour (.agents/skills/…)
                    └─ rejet motivé (trop local, déjà couvert, non vérifiable)
                    │ recoupe docs/state et ops/state avec git (statuts, SHA de main, compteur de tickets)
                    │ met à jour docs/wiki/*.md (une page par sujet : personne, organisation, produit, outil, projet, processus, politique)
                    ▼
              PR fix/wiki-AAAA-MM-JJ (fusionnée par le pilote, jamais par le curateur)
```

## Format d'une entrée de boîte (`_inbox`)
```md
## 2026-11-20 14:05 — fisca-core-backend-fiscal — ticket T-P3B-04
- Type : décision-propriétaire | piège | règle | procédure
- Énoncé : <une phrase>
- Preuve : <fichier:ligne, commit, ou message du propriétaire>
- Portée : <paquet, session>
- Confiance : RECOUPÉ | NON RECOUPÉ
```

## Règles du curateur (reprises de la mémoire Hyperagent)
- Rapport d'exécution **en français** (la règle « en anglais » venait des juges d'évaluation d'Hyperagent ; elle n'est pas reprise, voir `AGENTS.md` § 7). Si tu préfères l'anglais, change-le dans `.agents/agents/fisca-wiki-memory-curator.md`.
- Toute **ambiguïté signalée** comporte les six éléments : la question précise ; la lecture A et la lecture B, chacune avec sa citation ; la source de chaque lecture ; sa recommandation ; l'impact si on se trompe ; la date. Signaler sans ces éléments est insuffisant.
- Ne jamais écraser une donnée fiscale ou financière sur la seule foi de la boîte : exiger une source (spécification, ERRATA, décision datée du propriétaire).
- Ne modifie que `docs/wiki`, `docs/memoire`, `docs/state`, `ops/state`, jamais le code.

## Rubriques et suivi des verdicts
- Les rubriques vivent dans `.agents/skills/fisca-rubrics/resources/` (R1, R2, R3 v2 et les six rubriques d'agents).
- L'auditeur ajoute une ligne à `ops/state/verdicts.jsonl` à chaque verdict (barrière, tour, scores R1/R2/R3, réserves).
- `weekly-trends.sh` (agent curateur) compare les verdicts, signale les critères faibles de façon répétée et propose soit une **modification de rubrique** (si les scores contredisent l'évidence), soit un **durcissement de skill ou d'agent** (si l'agent échoue sur la même chose) : l'équivalent de l'analyse d'historique d'évaluations et du backtest d'amélioration d'Hyperagent. Le backtest se fait en rejouant un ticket sur une branche de test avec la modification.

## Hooks
Un hook `Stop` exécute une commande ou injecte une consigne à la fin d'un tour. Le prompt **M5** demande à `agy` de créer `.agents/hooks.json` d'après la documentation courante et de le tester ; je ne fige pas ici un format que je n'ai pas pu exécuter. Événements disponibles d'après la documentation : `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`. Un second hook utile : `PreToolUse` refusant `git commit` si `bash scripts/harness-check.sh` est rouge (portage du garde de périmètre).
