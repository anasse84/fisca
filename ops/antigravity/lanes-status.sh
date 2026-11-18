#!/usr/bin/env bash
# Affiche l'état de toutes les voies : VOIE SESSION STATUT (QUEUED|RUNNING|DONE|INCOMPLETE|ERROR).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$HERE/env.sh"
for d in "$FISCA_RT"/lanes/*/; do l=$(basename "$d"); printf '%s\t%s\t%s\t%s\n' "$l" "$(cat "$d/session" 2>/dev/null)" "$(cat "$d/status" 2>/dev/null)" "$(cat "$d/finished_at" 2>/dev/null)"; done
# --running et --completed pour pilot-status.mjs :
RUN=$(for d in "$FISCA_RT"/lanes/*/; do s=$(cat "$d/status" 2>/dev/null); [ "$s" = RUNNING ] || [ "$s" = QUEUED ] && cat "$d/session"; done | paste -sd, -)
echo "RUNNING=$RUN"
