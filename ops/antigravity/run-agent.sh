#!/usr/bin/env bash
# Exécute UN tour d'un agent en mode headless et normalise le résultat.
# Usage : run-agent.sh <agent> <prompt_file> <workdir> <out_dir> [timeout_s] [model]
# Sortie dans <out_dir> : result.json, conversation_id, status (DONE|INCOMPLETE|ERROR), response.md
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$HERE/env.sh"
AGENT="$1"; PROMPT_FILE="$2"; WORKDIR="$3"; OUT="$4"; TO="${5:-$FISCA_LANE_TIMEOUT}"; MODEL="${6:-}"
mkdir -p "$OUT"; cd "$WORKDIR" || exit 1
ARGS=(-p "$(cat "$PROMPT_FILE")" --agent "$AGENT" --output-format json --print-timeout "$TO" --effort "$FISCA_EFFORT")
[ -n "$MODEL" ] && ARGS+=(--model "$MODEL")
[ -f "$OUT/conversation_id" ] && ARGS+=(--conversation "$(cat "$OUT/conversation_id")")
echo RUNNING > "$OUT/status"
# shellcheck disable=SC2086
agy "${ARGS[@]}" $AGY_FLAGS > "$OUT/result.json" 2> "$OUT/stderr.log"; CODE=$?
node -e '
const fs=require("fs"); const o=process.argv[1];
let j={}; try{ j=JSON.parse(fs.readFileSync(o+"/result.json","utf8")); }catch(e){}
const id=j.conversation_id||j.conversationId||j.conversation?.id; if(id) fs.writeFileSync(o+"/conversation_id", String(id));
const fr=j.finished_reason||j.finishedReason||"";
const resp=j.response??j.result??"";
fs.writeFileSync(o+"/response.md", typeof resp==="string"?resp:JSON.stringify(resp,null,2));
const denied=(j.denied_actions||[]).length;
fs.writeFileSync(o+"/denied_actions.txt", JSON.stringify(j.denied_actions||[]));
const code=Number(process.argv[2]);
const ok = code===0 && !["print_timeout","interrupted","error"].includes(fr);
fs.writeFileSync(o+"/status", ok ? "DONE" : (code===3||fr==="print_timeout" ? "INCOMPLETE" : "ERROR"));
if(denied) console.error("ACTIONS REFUSÉES : "+denied+" (voir denied_actions.txt ; ajouter des règles allow)");
' "$OUT" "$CODE"
date -Is > "$OUT/finished_at"
exit "$CODE"
