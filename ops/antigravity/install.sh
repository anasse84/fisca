#!/usr/bin/env bash
# Installation de l'usine Fisca sur la machine du propriétaire (macOS/Linux ; sous Windows : WSL2).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; . "$HERE/env.sh"
need() { command -v "$1" >/dev/null 2>&1 || { echo "MANQUE : $1 — $2"; MISSING=1; }; }
MISSING=0
need git "https://git-scm.com"; need node "Node 24 LTS (nvm install 24)"; need pnpm "corepack enable && corepack prepare pnpm@latest --activate"
need gh "https://cli.github.com puis : gh auth login (jeton avec les droits Contents, Pull requests et Workflows)"
need tmux "brew install tmux | apt install tmux"; need jq "brew install jq | apt install jq"
need java "JDK 21 (Temurin) — requis pour containers/fiscal-java et verify:gate"; need mvn "Maven 3.9+"
need docker "Docker Desktop ou Engine — requis pour les conteneurs et les tests Testcontainers (voir docs/antigravity/04)"
[ "$MISSING" = 0 ] || { echo "Installe ce qui manque puis relance."; exit 1; }
command -v agy >/dev/null 2>&1 || curl -fsSL https://antigravity.google/cli/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
gh auth status >/dev/null 2>&1 || { echo "Lance d'abord : gh auth login"; exit 1; }
[ -d "$FISCA_MAIN/.git" ] || git clone "$FISCA_REPO_URL" "$FISCA_MAIN"
git -C "$FISCA_MAIN" fetch --prune origin && git -C "$FISCA_MAIN" checkout main && git -C "$FISCA_MAIN" pull --ff-only
# État vivant initial : instantané du dépôt (ops/state) vers le runtime
[ -f "$FISCA_RT/state/backlog.json" ] || node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1]));fs.writeFileSync(process.argv[2],JSON.stringify(Array.isArray(r)?r:r.rows,null,2))' "$FISCA_MAIN/ops/state/backlog.json" "$FISCA_RT/state/backlog.json"
# Réglages agy : ne remplace jamais un fichier existant
SET="$HOME/.gemini/antigravity-cli/settings.json"; mkdir -p "$(dirname "$SET")"
[ -f "$SET" ] && echo "settings.json existe déjà : compare avec ops/antigravity/settings.example.json" || cp "$HERE/settings.example.json" "$SET"
(cd "$FISCA_MAIN" && pnpm install --frozen-lockfile)
echo "--- Vérifications ---"
agy --version || true; agy models || true
echo "Test à blanc : cd $FISCA_MAIN && agy -p 'Réponds OK' --output-format json | jq 'keys'"
echo "Installation terminée. Suite : docs/antigravity/03-prompts-migration.md (prompt M0)."
