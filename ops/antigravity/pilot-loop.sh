#!/usr/bin/env bash
# Boucle du pilote : un tour agy (agent fisca-lead-orchestrator) toutes les N minutes, jusqu'à STOP_OWNER, COMPLETE
# ou présence du fichier $FISCA_RT/STOP. À lancer dans tmux : tmux new -d -s fisca-pilot 'bash ops/antigravity/pilot-loop.sh'
# Usage : pilot-loop.sh [intervalle_minutes=8] [prompt_file=ops/antigravity/prompts/tick.md]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$HERE/env.sh"
EVERY="${1:-8}"; PROMPT="${2:-$FISCA_MAIN/ops/antigravity/prompts/tick.md}"
OUT="$FISCA_RT/lanes/PILOTE"; mkdir -p "$OUT"
while true; do
  [ -f "$FISCA_RT/STOP" ] && { echo "STOP demandé"; break; }
  P="$PROMPT"; [ -f "$FISCA_RT/state/amorcage.done" ] || P="$FISCA_MAIN/ops/antigravity/prompts/amorcage.md"
  bash "$HERE/run-agent.sh" fisca-lead-orchestrator "$P" "$FISCA_MAIN" "$OUT" "$FISCA_PILOT_TIMEOUT" "$FISCA_MODEL_PILOT"
  [ "$P" != "$PROMPT" ] && [ "$(cat "$OUT/status")" = DONE ] && touch "$FISCA_RT/state/amorcage.done"
  cp "$OUT/response.md" "$FISCA_RT/tick/$(date +%Y%m%dT%H%M%S).md" 2>/dev/null
  tail -n 3 "$OUT/response.md" 2>/dev/null
  if grep -qE 'STOP_OWNER|^COMPLETE' "$OUT/response.md" 2>/dev/null; then echo "ARRÊT : le pilote demande le propriétaire ou a terminé"; break; fi
  # Après un échec d'API ou un quota épuisé, attendre plus longtemps
  [ "$(cat "$OUT/status")" = ERROR ] && sleep 900
  sleep $((EVERY*60))
done
