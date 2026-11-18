#!/usr/bin/env bash
# Lance (ou relance) une voie en arrière-plan dans tmux, dans son worktree git.
# Usage : launch-lane.sh <VOIE> <SESSION> <BRANCHE> <BRIEF.md> [base=origin/main]
# Le brief est le message GATE/DISPATCH complet (autosuffisant). Une voie = une conversation agy reprise à chaque tour.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$HERE/env.sh"
LANE="$1"; SESSION="$2"; BRANCH="$3"; BRIEF="$4"; BASE="${5:-origin/main}"
AGENT="$(jq -r --arg l "$LANE" '.lanes[$l].agent' "$HERE/lanes.json")"
[ "$AGENT" != "null" ] || { echo "voie inconnue : $LANE"; exit 1; }
STATUS_DIR="$FISCA_RT/lanes/$LANE"; mkdir -p "$STATUS_DIR"
if [ "$(cat "$STATUS_DIR/status" 2>/dev/null)" = "RUNNING" ] && tmux has-session -t "fisca-$LANE" 2>/dev/null; then
  echo "voie $LANE déjà en cours"; exit 0; fi
git -C "$FISCA_MAIN" fetch --prune origin
WT="$FISCA_WT/$LANE"
if [ ! -d "$WT/.git" ] && [ ! -f "$WT/.git" ]; then
  if git -C "$FISCA_MAIN" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git -C "$FISCA_MAIN" worktree add -B "$BRANCH" "$WT" "origin/$BRANCH"
  else git -C "$FISCA_MAIN" worktree add -B "$BRANCH" "$WT" "$BASE"; fi
else
  git -C "$WT" fetch origin
  git -C "$WT" checkout "$BRANCH" 2>/dev/null || git -C "$WT" checkout -B "$BRANCH" "$( git -C "$WT" show-ref --verify --quiet "refs/remotes/origin/$BRANCH" && echo origin/$BRANCH || echo "$BASE")"
fi
HEAD_SHA="$(git -C "$WT" rev-parse HEAD)"
cp "$BRIEF" "$STATUS_DIR/brief.md"
{ echo; echo "---"; echo "CONTEXTE D'EXÉCUTION : voie $LANE, session $SESSION, branche attendue $BRANCH, tête attendue $HEAD_SHA."; \
  echo "Vérifie 'git branch --show-current' et 'git rev-parse HEAD' avant d'écrire ; arrête-toi s'ils diffèrent."; \
  echo "Écris ton rapport final (verdict, commits, tests, réserves) dans la réponse ; colle tout correctif en entier ou pousse la branche fix/*."; } >> "$STATUS_DIR/brief.md"
echo "$SESSION" > "$STATUS_DIR/session"; echo "$BRANCH" > "$STATUS_DIR/branch"; echo QUEUED > "$STATUS_DIR/status"
MODEL="$FISCA_MODEL_LANE"; [ "$LANE" = "AUDIT" ] && MODEL="$FISCA_MODEL_AUDIT"
tmux kill-session -t "fisca-$LANE" 2>/dev/null || true
tmux new-session -d -s "fisca-$LANE" -c "$WT" "bash '$HERE/run-agent.sh' '$AGENT' '$STATUS_DIR/brief.md' '$WT' '$STATUS_DIR' '$FISCA_LANE_TIMEOUT' '$MODEL' 2>&1 | tee -a '$FISCA_RT/logs/$LANE.log'"
echo "voie $LANE lancée : session $SESSION, branche $BRANCH, worktree $WT (tmux attach -t fisca-$LANE)"
