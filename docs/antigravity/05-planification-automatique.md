# 05 — Programmer des agents pour qu'ils se déclenchent automatiquement

Trois mécanismes existent sur Antigravity. Ils ne se valent pas :

| Mécanisme | Fréquence | Survit à un redémarrage ? | Modèle | Usage conseillé pour Fisca |
|---|---|---|---|---|
| **`cron` / `systemd` / `launchd`** appelant `agy -p` (ops/antigravity/run-agent.sh) | libre (cron 5 champs) | **oui** (le système l'exécute) | **tu choisis** (`--model`) | **Référence** : boucle du pilote, curateur nocturne, instantanés |
| **Scheduled Tasks** (panneau du client bureau) | cron récurrent uniquement | oui (sidecar) | **fixé : Gemini 3.5 Flash** | Curateur nocturne seulement (travail léger) ; les droits doivent être accordés **à l'avance** au niveau du projet |
| **`/schedule`** dans une conversation | unique ou récurrent | **non** : annulé si le processus `agy` est tué | selon la conversation | Rappels courts pendant une session interactive |

## Recette recommandée

### 1. Le pilote en boucle (construction automatique)
```bash
tmux new -d -s fisca-pilot 'cd ~/fisca-factory/fisca && bash ops/antigravity/pilot-loop.sh 8'
tmux ls ; tmux attach -t fisca-pilot     # regarder ; Ctrl-b d pour détacher
touch ~/.fisca-runtime/STOP              # arrêt propre après le tour en cours
```
La boucle relance un tour du pilote toutes les 8 minutes (réglable) ; chaque tour fait un tick complet (lire les voies, calculer le plan, lancer, auditer, fusionner). Elle s'arrête sur `STOP_OWNER`, `COMPLETE` ou le fichier `STOP`.

### 2. Le curateur nocturne (04:00 heure du Maroc), crontab
```cron
CRON_TZ=Africa/Casablanca
0 4 * * *   cd $HOME/fisca-factory/fisca && bash ops/antigravity/curate.sh >> $HOME/.fisca-runtime/logs/curate.log 2>&1
30 4 * * 1  cd $HOME/fisca-factory/fisca && bash ops/antigravity/weekly-trends.sh >> $HOME/.fisca-runtime/logs/trends.log 2>&1
```
`curate.sh`, `weekly-trends.sh` et `install-schedules.sh` sont écrits par le prompt **M5/M6**. Sur macOS : `launchd` (modèles dans `ops/antigravity/launchd/`) ; sur Linux : `systemd --user` avec `OnCalendar=*-*-* 04:00:00` et `Persistent=true`.

### 3. Machine allumée
- Linux/serveur : pas de souci. macOS : `caffeinate -dimsu &` ou Réglages → Énergie. Windows : WSL2 + désactiver la veille.
- Un petit VPS Linux (4 vCPU, 8 Go) dédié convient pour le pilote et les voies ; garde Docker pour les tests de conteneurs.

### 4. Scheduled Tasks du client bureau (option)
Créer le projet Fisca, accorder au niveau du projet les permissions dont la tâche a besoin (Écriture dans `docs/`, `ops/`, `git`, `gh pr`), **faire un essai à blanc**, puis créer la tâche : cron `0 4 * * *`, prompt « lance ops/antigravity/curate.sh ». Les tâches utilisent Gemini 3.5 Flash.

## Pièges connus
- Un tour sans permission accordée **ne s'arrête pas** : l'action est refusée et listée dans `denied_actions` ; `run-agent.sh` l'écrit dans `denied_actions.txt` et le pilote corrige (règle `allow`).
- Toujours un `--print-timeout` : sans lui, un tour attend indéfiniment les tâches de fond. Code de sortie 3 = timeout ou erreur d'API ; `finished_reason` ∈ {`print_timeout`, `interrupted`, `error`} = incomplet.
- Quota épuisé : la boucle attend 15 minutes puis recommence (`08-modeles-quotas.md`).
