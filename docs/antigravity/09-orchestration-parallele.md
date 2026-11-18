# 09 — Lancer plusieurs agents en parallèle et en séquence (comme sur Hyperagent)

## Le modèle

```
PILOTE (tmux fisca-pilot, clone principal, reste sur main)
  │  pilot-loop.sh → un tour d'agent fisca-lead-orchestrator toutes les ~8 min
  │  chaque tour = un TICK : lanes-status → pilot-status.mjs → ACTION → launch-lane / audit / fusion
  ├─ VOIE BACK-1   (tmux fisca-BACK-1,  worktree worktrees/BACK-1,  conversation agy reprise)
  ├─ VOIE EDI-1    …
  ├─ VOIE FRONT-1  …
  └─ VOIE AUDIT    (lecture seule, modèle le plus fort)
État : ~/.fisca-runtime/{state/backlog.json, lanes/<VOIE>/{status,session,branch,brief.md,response.md,result.json,conversation_id}}
Vérité du fusionné : git (`git branch -r --merged origin/main`), pas les statuts.
```

### Séquentiel
Le pilote ne décide pas l'ordre : `pilot-status.mjs` le calcule depuis `depends_on` du backlog, les branches déjà fusionnées et les voies en cours. Exemples : G3 ne démarre que quand P3-A, P3-B, P3-C sont `IN_REVIEW` ; la vague 4 ne démarre qu'après fusion de G3 ; S5 exige `RELEASE S5 : OUI`.

### Parallèle
Deux sessions s'exécutent en même temps si (1) leurs voies sont différentes, (2) leurs périmètres de chemins (`.meta/session-scopes.json`) sont disjoints. Vague 3 : P3-A (EDI-1), P3-B (BACK-1), P3-C (EDI-2) en parallèle. Vague 4 : P4-A (FRONT-1), P4-B (BACK-1), P4-C (BACK-2) ; P4-B attend que BACK-1 soit libre.

### Une voie : un tour
`launch-lane.sh <VOIE> <SESSION> <BRANCHE> <brief.md>` : crée ou met à jour le worktree sur la branche, ajoute au brief la branche et le SHA de tête attendus, puis lance `run-agent.sh` dans une session tmux. `run-agent.sh` appelle `agy -p … --agent … --conversation <id> --print-timeout …` et écrit `status` (`DONE`, `INCOMPLETE`, `ERROR`), `response.md`, `denied_actions.txt`. Relancer la même voie **reprend la même conversation** : la voie garde son contexte.

### Relais (équivalent de SendThreadMessage)
Le pilote réécrit un brief (message GATE/DISPATCH/« reprends où tu en étais ») et relance `launch-lane.sh` : c'est un nouveau tour de la même conversation.

### Sous-agents internes
Une voie peut, dans son tour, déléguer à des sous-agents d'`agy` (`invoke_subagent`), qui héritent de ses permissions. Règle : **jamais deux sous-agents sur les mêmes fichiers** ; un seul ticket verrouillé à la fois sur une branche (protocole-boucle § 3).

## Commandes utiles
```bash
bash ops/antigravity/lanes-status.sh          # état des voies
tmux attach -t fisca-BACK-1                    # suivre une voie (Ctrl-b d pour détacher)
tail -f ~/.fisca-runtime/logs/EDI-1.log
node ops/antigravity/backlog.mjs count         # {"total":132,"DONE":66,...}
touch ~/.fisca-runtime/STOP                    # arrêt propre du pilote
rm ~/.fisca-runtime/STOP && tmux new -d -s fisca-pilot 'bash ops/antigravity/pilot-loop.sh 8'   # reprise
```

## Sans script : à la main, dans le client
Ouvre une conversation par voie (« New Worktree » dans le client bureau, ou `/worktree` dans `agy`), `/agent fisca-<…>`, colle le brief. C'est plus lent et sans relance automatique : réserve-le au dépannage.

## Ce qui est identique à Hyperagent
Un pilote et sept voies ; une voie est réutilisée d'une session à l'autre ; le pilote relance ; les statuts du backlog ; l'auditeur en lecture seule ; la fusion par le seul pilote ; la ligne `ETAT PILOTE` ; `STOP_OWNER` pour les blocages durs.

## Ce qui est différent
La voie a un vrai worktree (plus de clone partagé entre voie et sous-agent : le risque d'écrasement disparaît) ; les rappels sont une boucle shell ; l'état ne passe plus par des tables.
