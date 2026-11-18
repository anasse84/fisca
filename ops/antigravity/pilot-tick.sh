#!/usr/bin/env bash
# Partie DÉTERMINISTE d'un tick : calcule le plan (ordre, actions) avec pilot-status.mjs, sans décider à la place du script.
# Usage : pilot-tick.sh [--completed S1A,G1] [--s5]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$HERE/env.sh"
git -C "$FISCA_MAIN" fetch --prune origin >/dev/null
RO="$FISCA_RT/main-ro"
[ -d "$RO" ] || git -C "$FISCA_MAIN" worktree add --detach "$RO" origin/main >/dev/null
git -C "$RO" checkout --detach origin/main >/dev/null 2>&1
MERGED=$(git -C "$FISCA_MAIN" branch -r --merged origin/main | sed 's# *origin/##' | grep -E '^(feat|fix)/' | paste -sd, -)
RUNNING=$("$HERE/lanes-status.sh" | sed -n 's/^RUNNING=//p')
COMPLETED=""; S5=""
while [ $# -gt 0 ]; do case "$1" in --completed) COMPLETED="$2"; shift 2;; --s5) S5="--s5"; shift;; *) shift;; esac; done
node "$RO/docs/orchestration/reference/pilot-status.mjs" \
  --backlog "$FISCA_RT/state/backlog.json" --scopes "$RO/.meta/session-scopes.json" \
  --merged-branches "$MERGED" --running "$RUNNING" --completed "$COMPLETED" \
  --state "$FISCA_RT/state/pilot-state.json" $S5 | tee "$FISCA_RT/tick/last-plan.txt"
