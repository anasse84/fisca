#!/usr/bin/env bash
# harness-check.sh — Porte statique L1 (version corrigée, 2026-11-13)
# Remplace le script de « Runbook S0 § 3.C ». Corrections : dossiers générés exclus, faux positifs CSS
# réduits, marqueurs étendus (.only, @ts-nocheck, xit), scan de secrets, messages nommant la règle.
# Usage : bash scripts/harness-check.sh            (depuis la racine du dépôt)
# Sortie : 0 = propre ; 1 = au moins une violation (chaque violation est imprimée avec fichier:ligne).
set -uo pipefail

FAIL=0
fail_gov() { # $1 = code d'erreur, $2 = message
  echo "ERREUR HARNAIS — $1 : $2"
  FAIL=1
}

# 0. Gouvernance : présence et cohérence (Doc_15 § 12, contrôle 1)
for f in AGENTS.md CLAUDE.md packages/db-schema/AGENTS.md containers/AGENTS.md apps/web-saas/AGENTS.md \
  scripts/harness-check.sh scripts/enforce-constitution.ts scripts/bootstrap-sandbox.sh .githooks/pre-commit \
  docs/specs/ERRATA.md .meta/session-scopes.json; do
  [ -s "$f" ] || fail_gov ERR_GOVERNANCE_MISSING "fichier de gouvernance absent ou vide : $f"
done
for n in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18; do
  ls docs/specs/"$n"-*.md >/dev/null 2>&1 || fail_gov ERR_SPEC_MISSING "spécification docs/specs/$n-*.md absente."
done
[ -x .githooks/pre-commit ] || fail_gov ERR_HOOK_NOT_EXECUTABLE ".githooks/pre-commit n'est pas exécutable (chmod +x)."
if [ -s .githooks/pre-commit ] && ! grep -q 'enforce-constitution' .githooks/pre-commit; then
  fail_gov ERR_HOOK_INCOHERENT ".githooks/pre-commit n'appelle pas scripts/enforce-constitution.ts."
fi
if [ -s CLAUDE.md ] && ! grep -q 'AGENTS.md' CLAUDE.md; then
  fail_gov ERR_CLAUDE_PARITY "CLAUDE.md ne renvoie pas à AGENTS.md (parité racine)."
fi
if [ -s .meta/session-scopes.json ] && [ -s scripts/enforce-constitution.ts ]; then
  node -e '
    const fs = require("node:fs");
    const scopes = JSON.parse(fs.readFileSync(".meta/session-scopes.json", "utf8"));
    const guard = fs.readFileSync("scripts/enforce-constitution.ts", "utf8");
    const missing = (scopes.protected_paths ?? []).filter((p) => !guard.includes("\"" + p + "\""));
    if (missing.length > 0) { console.log("chemins protégés absents du garde : " + missing.join(", ")); process.exit(1); }
  ' >/tmp/fisca-gov.$$ 2>&1 || fail_gov ERR_GOVERNANCE_DRIFT "$(cat /tmp/fisca-gov.$$) (.meta/session-scopes.json et enforce-constitution.ts divergent)."
  rm -f /tmp/fisca-gov.$$
fi
if [ "$(git config --get core.hooksPath 2>/dev/null || true)" != ".githooks" ]; then
  echo "AVERTISSEMENT HARNAIS — core.hooksPath n'est pas .githooks : lance bash scripts/bootstrap-sandbox.sh."
fi

SCAN_TARGETS=(apps packages connectors containers)
EXISTING=()
for dir in "${SCAN_TARGETS[@]}"; do
  [ -d "$dir" ] && EXISTING+=("$dir")
done
if [ "${#EXISTING[@]}" -eq 0 ]; then
  exit "$FAIL"
fi

EXCLUDES=(--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build --exclude-dir=.astro
  --exclude-dir=.turbo --exclude-dir=coverage --exclude-dir=.next --exclude-dir=target --exclude-dir=bin
  --exclude-dir=obj --exclude-dir=__pycache__ --exclude-dir=.venv --exclude-dir=.wrangler
  --exclude-dir=__fixtures__ --exclude-dir=xsd --exclude-dir=playwright-report --exclude-dir=test-results)
CODE_INCLUDES=(--include=*.ts --include=*.tsx --include=*.astro --include=*.js --include=*.mjs
  --include=*.java --include=*.kt --include=*.py --include=*.cs --include=*.sql)
TS_INCLUDES=(--include=*.ts --include=*.tsx --include=*.astro)

report() { # $1 = code d'erreur, $2 = message, $3 = lignes trouvées (vide = aucune violation)
  local hits="$3"
  if [ -n "$hits" ]; then
    printf '%s\n' "$hits" | head -40
    echo "ERREUR HARNAIS — $1 : $2"
    FAIL=1
  fi
}

# 1. Code inachevé ou factice (tous langages)
HITS="$(grep -rnE '\b(TODO|FIXME|PLACEHOLDER|HACK|XXX)\b' "${EXCLUDES[@]}" "${CODE_INCLUDES[@]}" "${EXISTING[@]}" || true)"
report ERR_STUB_MARKER "marqueur de code inachevé interdit (Loi 10)." "$HITS"

# 2. Tests désactivés ou isolés, contournements du compilateur et du linter
HITS="$(grep -rnE '\b(it|test|describe)\.(skip|only)\(|\b(xit|xdescribe|xtest)\(|@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable' \
  "${EXCLUDES[@]}" "${TS_INCLUDES[@]}" --include=*.js --include=*.mjs "${EXISTING[@]}" || true)"
report ERR_BYPASS "test désactivé/isolé ou contournement TypeScript/ESLint interdit." "$HITS"

# 3. Type any explicite
HITS="$(grep -rnE ':\s*any\b(\[\])?\s*[;,)=>{|&]|:\s*any\s*$|<any>|\bas\s+any\b|Array<any>|Record<[^>]*,\s*any>' \
  "${EXCLUDES[@]}" --include=*.ts --include=*.tsx "${EXISTING[@]}" || true)"
report ERR_UNSAFE_ANY_TYPE "type any interdit." "$HITS"

# 4. Flottants monétaires (heuristique ; la règle ESLint no-float-money reste la défense principale)
HITS="$(grep -rnE 'parseFloat\(|\b[A-Za-z0-9_]*(Cents|_cents|Centimes|Bps|_bps)\b\s*/\s*[A-Za-z0-9_(]|\b[A-Za-z0-9_]*(Cents|_cents|Centimes|Bps|_bps)\b\s*[:=]\s*-?[0-9]+\.[0-9]+' \
  "${EXCLUDES[@]}" --include=*.ts --include=*.tsx --exclude=FiscalPrimitives.tsx "${EXISTING[@]}" \
  | grep -vE '^\S+:[0-9]+:\s*(//|\*)' || true)"
report ERR_ADR03_FLOAT "arithmétique flottante sur centimes/bps interdite : utiliser divRoundHalfUpBigInt." "$HITS"

# 5. CSS directionnel physique et couleurs hexadécimales hors tokens.css (interfaces seulement)
UI=()
for uidir in packages/ui-mercury apps/web-saas apps/pos-pwa apps/marketing-astro apps/mobile-capacitor; do
  [ -d "$uidir" ] && UI+=("$uidir")
done
if [ "${#UI[@]}" -gt 0 ]; then
  HITS="$(grep -rnE "(^|[[:space:]\"'\`:])-?(ml|mr|pl|pr)-(\[|[0-9]|px|auto)|[[:space:]\"'\`:]text-(left|right)\b|[[:space:]\"'\`:](rounded|border)-(l|r|tl|tr|bl|br)(-|\b)|[[:space:]\"'\`:](left|right)-(\[|[0-9]|px|auto|full)" \
    "${EXCLUDES[@]}" --include=*.tsx --include=*.astro "${UI[@]}" || true)"
  report ERR_UI_PHYSICAL_CSS "classes logiques seulement (ms-, me-, ps-, pe-, start-, end-, text-start, text-end)." "$HITS"
  HITS="$(grep -rnE '#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b' "${EXCLUDES[@]}" --include=*.tsx --include=*.astro --include=*.css \
    --exclude=tokens.css "${UI[@]}" \
    | grep -vE '&#[0-9]+;|href=|id=|url\(#' || true)"
  report ERR_UI_RAW_HEX "couleur hexadécimale hors tokens.css : utiliser les variables sémantiques." "$HITS"
fi

# 6. Secrets en clair (tout le dépôt suivi par Git, hors verrous de dépendances)
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  HITS="$(git ls-files -z -- . ':!pnpm-lock.yaml' ':!*.lock' ':!docs/specs/*' \
    | xargs -0 -r grep -nIE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}' 2>/dev/null || true)"
  report ERR_SECRET_IN_REPO "secret en clair : les secrets vivent dans Cloudflare Secrets Store ou dans un skill." "$HITS"
fi

exit "$FAIL"
