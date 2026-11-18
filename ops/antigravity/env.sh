#!/usr/bin/env bash
# Variables communes. À sourcer : . ops/antigravity/env.sh
# Aucun secret ici : les jetons viennent de `gh auth login` et de l'environnement du shell.
export FISCA_REPO_URL="${FISCA_REPO_URL:-https://github.com/anasse84/fisca.git}"
export FISCA_HOME="${FISCA_HOME:-$HOME/fisca-factory}"            # dossier racine de l'usine
export FISCA_MAIN="${FISCA_MAIN:-$FISCA_HOME/fisca}"              # clone principal (reste sur main)
export FISCA_WT="${FISCA_WT:-$FISCA_HOME/worktrees}"              # un worktree git par voie
export FISCA_RT="${FISCA_RT:-$HOME/.fisca-runtime}"               # état d'exécution (hors dépôt)
export FISCA_TZ="${FISCA_TZ:-Africa/Casablanca}"
# Modèle et effort : vérifier les identifiants réels avec `agy models`.
export FISCA_MODEL_PILOT="${FISCA_MODEL_PILOT:-}"                 # vide = modèle par défaut du compte
export FISCA_MODEL_LANE="${FISCA_MODEL_LANE:-}"
export FISCA_MODEL_AUDIT="${FISCA_MODEL_AUDIT:-}"                 # prendre le modèle le plus fort disponible
export FISCA_MAX_LANES="${FISCA_MAX_LANES:-4}"                         # voies simultanées au plus (quota)
export FISCA_EFFORT="${FISCA_EFFORT:-high}"
export FISCA_LANE_TIMEOUT="${FISCA_LANE_TIMEOUT:-3300}"           # secondes par tour de voie
export FISCA_PILOT_TIMEOUT="${FISCA_PILOT_TIMEOUT:-3300}"
export AGY_FLAGS="${AGY_FLAGS:---sandbox}"                        # voir docs/antigravity/07-permissions.md
mkdir -p "$FISCA_RT"/{state,lanes,logs,tick} "$FISCA_WT"
