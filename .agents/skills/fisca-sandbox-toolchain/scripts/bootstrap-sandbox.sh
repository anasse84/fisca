#!/usr/bin/env bash
# bootstrap-sandbox.sh — Préparation idempotente du bac à sable (version corrigée, 2026-11-13)
# Remplace le script de « Runbook S0 § 3.B », qui supposait apt-get. Le bac à sable Hyperagent est un
# Amazon Linux 2023 (dnf, sudo sans mot de passe, pas de Docker). Vérifié le 2026-11-13.
#
# Usage : bash scripts/bootstrap-sandbox.sh [--java] [--dotnet] [--python] [--postgres] [--redis] [--playwright]
#   sans option : hooks Git, xmllint, accès npm, pnpm install.
# Codes de sortie : 0 prêt ; 20 registre npm bloqué (demander l'accès) ; 21 outil système impossible à installer.
set -euo pipefail

log() { echo "[Fisca Sandbox] $*"; }

pkg_install() { # $@ = paquets ; choisit dnf (Amazon Linux/Fedora) ou apt-get (Debian/Ubuntu)
  local sudo_cmd=""
  if [ "$(id -u)" -ne 0 ]; then
    if sudo -n true 2>/dev/null; then sudo_cmd="sudo -n"; else log "sudo indisponible : installe manuellement $*"; return 21; fi
  fi
  if command -v dnf >/dev/null 2>&1; then
    $sudo_cmd dnf install -y -q "$@"
  elif command -v apt-get >/dev/null 2>&1; then
    $sudo_cmd apt-get update -qq && $sudo_cmd apt-get install -y -qq "$@"
  else
    log "aucun gestionnaire de paquets reconnu (dnf, apt-get)"; return 21
  fi
}

# 1. Hooks Git constitutionnels
if [ -d .githooks ]; then
  git config core.hooksPath .githooks
  chmod +x .githooks/* scripts/*.sh 2>/dev/null || true
  log "hooks Git activés (.githooks)."
fi

# 2. xmllint (validation XSD)
if ! command -v xmllint >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then pkg_install libxml2; else pkg_install libxml2-utils; fi
fi

# 3. Registre npm : bloqué par défaut dans chaque fil Hyperagent (mémoire M11)
NPM_CODE="$(curl -s -o /dev/null -m 10 -w '%{http_code}' https://registry.npmjs.org/zod || echo 000)"
if [ "$NPM_CODE" != "200" ]; then
  log "NPM_BLOCKED (HTTP $NPM_CODE) : appelle RequestNetworkAccess avec le domaine registry.npmjs.org, puis relance ce script."
  exit 20
fi

# 4. Dépendances Node (lockfile gelé d'abord ; repli si le lockfile doit évoluer)
if [ -f package.json ]; then
  command -v pnpm >/dev/null 2>&1 || npm install -g pnpm@10.34.7  # version de packageManager
  pnpm install --frozen-lockfile --prefer-offline || pnpm install
fi

# 5. Chaînes d'outils optionnelles, selon la session
for opt in "$@"; do
  case "$opt" in
    --java)       # PHIVE, ph-ubl, Mustangproject (sessions P2-A, P3-C, G2, G3)
      command -v java >/dev/null 2>&1 || pkg_install java-21-amazon-corretto-headless maven || pkg_install openjdk-21-jdk-headless maven
      java -version 2>&1 | head -1 ;;
    --dotnet)     # Sage100EdgeAgent, xUnit (sessions P3-C, G3)
      command -v dotnet >/dev/null 2>&1 || pkg_install dotnet-sdk-8.0
      dotnet --version ;;
    --python)     # Docling, module Odoo, pytest (sessions P3-B, P3-C, G3)
      command -v python3.12 >/dev/null 2>&1 || pkg_install python3.12 || pkg_install python3.12-venv
      python3.12 --version ;;
    --postgres)   # parité SQL D1/PostgreSQL 16 (sessions S1B, P4-B, P4-C, G1, G4)
      command -v initdb >/dev/null 2>&1 || pkg_install postgresql16-server || pkg_install postgresql-16
      PGDIR="${FISCA_PGDATA:-$HOME/.fisca-pg16}"
      if [ ! -d "$PGDIR/base" ]; then initdb -D "$PGDIR" -U fisca --auth=trust >/dev/null; fi
      pg_ctl -D "$PGDIR" status >/dev/null 2>&1 || pg_ctl -D "$PGDIR" -o "-p 54329 -k /tmp" -l "$PGDIR/server.log" start >/dev/null
      log "PostgreSQL 16 prêt : postgres://fisca@127.0.0.1:54329/postgres" ;;
    --redis)      # BullMQ du nœud souverain (sessions P4-C, G4)
      command -v redis6-server >/dev/null 2>&1 || command -v redis-server >/dev/null 2>&1 || pkg_install redis6 || pkg_install redis-server
      (redis6-cli -p 63799 ping >/dev/null 2>&1 || redis-cli -p 63799 ping >/dev/null 2>&1) || \
        (redis6-server --port 63799 --daemonize yes >/dev/null 2>&1 || redis-server --port 63799 --daemonize yes >/dev/null)
      log "Redis prêt : redis://127.0.0.1:63799" ;;
    --playwright) # E2E, Lighthouse (sessions P2-B, P2-C, P4-A, G2, G4) — les bibliothèques système Chromium sont déjà présentes
      # Playwright n'est pas une dépendance de la racine : on utilise celui d'un workspace qui le déclare (apps/marketing-astro),
      # sinon le paquet est téléchargé à la volée (registre npm et CDN Playwright joignables, accord npm du fil requis).
      if pnpm exec playwright --version >/dev/null 2>&1; then
        pnpm exec playwright install chromium
      elif pnpm --filter @fisca/marketing-astro exec playwright --version >/dev/null 2>&1; then
        pnpm --filter @fisca/marketing-astro exec playwright install chromium
      else
        pnpm dlx playwright install chromium
      fi
      log "Chromium (Playwright) prêt." ;;
    *) log "option inconnue : $opt" ;;
  esac
done

log "Environnement prêt."
