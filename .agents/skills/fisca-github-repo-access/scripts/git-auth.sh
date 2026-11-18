#!/usr/bin/env bash
# Exécute git avec le jeton GITHUB_TOKEN injecté (jamais affiché, jamais écrit sur disque).
# À lancer depuis le dossier du clone, avec GITHUB_TOKEN exporté dans l'environnement du shell.
# Usage : bash git-auth.sh <arguments git>
#   ex. : bash git-auth.sh clone https://github.com/anasse84/fisca.git fisca
#         bash git-auth.sh push -u origin feat/w0-foundation
# Garde-fous : refuse tout force-push, toute suppression de branche distante et tout push vers main ou master
# (la fusion sur main passe par une Pull Request, réservée à Fisca-Lead-Orchestrator).
set -euo pipefail

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "ERREUR : GITHUB_TOKEN absent. Exporter GITHUB_TOKEN dans l'environnement du shell avant de lancer ce script." >&2
  exit 2
fi
if [ "$#" -eq 0 ]; then
  echo "Usage : bash git-auth.sh <arguments git>   (ex. : clone https://github.com/anasse84/fisca.git fisca)" >&2
  exit 2
fi

if [ "$1" = "push" ]; then
  args=("${@:2}")
  remote=""
  refspecs=()
  i=0
  while [ "$i" -lt "${#args[@]}" ]; do
    arg="${args[$i]}"
    case "$arg" in
      -f|--force|--force-with-lease|--force-with-lease=*|--force-if-includes|--mirror|--delete|-d|--prune|--all)
        echo "ERREUR : option de push interdite ($arg) : ni force-push ni suppression." >&2
        exit 3 ;;
      -o|--push-option|--repo|--receive-pack|--exec)
        i=$((i + 1)) ;;
      -*) ;;
      *)
        if [ -z "$remote" ]; then remote="$arg"; else refspecs+=("$arg"); fi ;;
    esac
    i=$((i + 1))
  done
  current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [ "${#refspecs[@]}" -eq 0 ]; then
    refspecs=("$current")
  fi
  for spec in "${refspecs[@]}"; do
    case "$spec" in
      +*|:*)
        echo "ERREUR : refspec de force-push ou de suppression interdit ($spec)." >&2
        exit 3 ;;
    esac
    dest="${spec##*:}"
    dest="${dest#refs/heads/}"
    if [ "$dest" = "HEAD" ]; then dest="$current"; fi
    case "$dest" in
      main|master)
        echo "ERREUR : push direct vers $dest interdit : la fusion sur main passe par une Pull Request." >&2
        exit 3 ;;
    esac
  done
fi

export GIT_TERMINAL_PROMPT=0
exec git -c credential.helper='!f(){ echo username=x-access-token; echo password=$GITHUB_TOKEN; }; f' "$@"
