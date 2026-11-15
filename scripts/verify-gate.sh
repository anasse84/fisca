#!/usr/bin/env bash
# verify-gate.sh : commande de vérification des barrières QA (G1 à G4) et de la session S5 (`pnpm verify:gate`).
# Définie par le pilote le 2026-11-14 (le backlog la citait sans qu'elle existe). À valider à G3.
#   1. pnpm verify:fast        (typage, lint, tests unitaires de tous les paquets, gardes statiques) ;
#   2. pnpm test:xsd           (validation XSD de tous les XML générés) ;
#   3. tests de @fisca/ubl-xades avec FISCA_REQUIRE_PHIVE=1 : le contrôle croisé PHIVE (EN 16931) échoue au lieu d'être sauté.
# Pré-requis : Java 21 (bash scripts/bootstrap-sandbox.sh --java). Turbo ne transmet pas JAVA_HOME : il est exporté ici.
# Options : --browser ajoute la preuve OPFS de la caisse et Lighthouse (bash scripts/bootstrap-sandbox.sh --playwright d'abord).
# Mémoire : le bac à sable a 4 Go ; TURBO_CONCURRENCY vaut 1 par défaut.
# Codes de sortie : 0 tout vert ; 1 une étape a échoué ; 21 Java 21 absent.
set -euo pipefail

with_browser=0
for arg in "$@"; do
  case "$arg" in
    --browser) with_browser=1 ;;
    *) echo "[verify:gate] option inconnue : $arg" >&2; exit 1 ;;
  esac
done

if ! command -v java >/dev/null 2>&1; then
  echo "[verify:gate] Java 21 absent : lance bash scripts/bootstrap-sandbox.sh --java (PHIVE est obligatoire à une barrière)." >&2
  exit 21
fi
JAVA_HOME="$(java -XshowSettings:properties -version 2>&1 | sed -n 's/^ *java\.home = //p' | head -1)"
export JAVA_HOME
export TURBO_CONCURRENCY="${TURBO_CONCURRENCY:-1}"

echo "[verify:gate] 1/3 pnpm verify:fast"
pnpm verify:fast
echo "[verify:gate] 2/3 pnpm test:xsd"
pnpm test:xsd
echo "[verify:gate] 3/3 @fisca/ubl-xades avec PHIVE obligatoire"
FISCA_REQUIRE_PHIVE=1 pnpm --filter @fisca/ubl-xades test

if [ "$with_browser" -eq 1 ]; then
  echo "[verify:gate] navigateur : preuve OPFS de la caisse"
  pnpm --filter @fisca/pos-pwa test:e2e
  echo "[verify:gate] navigateur : Lighthouse du site"
  pnpm --filter @fisca/marketing-astro lighthouse:check
fi
echo "[verify:gate] OK"
