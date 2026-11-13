#!/usr/bin/env bash
# ensure-postgres.sh — garantit un PostgreSQL 16 joignable pour les tests de parité SQL (db-schema, api-hono).
# Appelé par le globalSetup de vitest : `pnpm verify:fast` ne dépend plus d'un `--postgres` oublié (MAIN_RED du 2026-11-13).
#   - serveur déjà joignable (conteneur de CI, instance locale)  : ne fait rien ;
#   - FISCA_TEST_PG_URL fournie mais injoignable                 : échec franc, on ne démarre rien à la place de l'appelant ;
#   - URL par défaut (postgres://fisca@127.0.0.1:54329/postgres) : démarre le serveur du bac à sable (bootstrap --postgres, idempotent).
# Aucun test n'est ignoré : si PostgreSQL ne peut pas être joint, ce script sort en erreur et la suite échoue.
set -euo pipefail

DEFAULT_URL="postgres://fisca@127.0.0.1:54329/postgres"
URL="${FISCA_TEST_PG_URL:-$DEFAULT_URL}"
HOSTPORT="${URL#*@}"; HOSTPORT="${HOSTPORT%%/*}"
HOST="${HOSTPORT%%:*}"; PORT="${HOSTPORT##*:}"
[ "$PORT" = "$HOSTPORT" ] && PORT=5432

reachable() { (exec 3<>"/dev/tcp/${HOST}/${PORT}") 2>/dev/null; }

if reachable; then exit 0; fi

if [ -n "${FISCA_TEST_PG_URL:-}" ] && [ "$URL" != "$DEFAULT_URL" ]; then
  echo "[ensure-postgres] ERREUR : FISCA_TEST_PG_URL=${HOST}:${PORT} est injoignable. Démarre ce serveur ; aucun test PostgreSQL n'est ignoré." >&2
  exit 1
fi

# Verrou : db-schema et api-hono lancent leur globalSetup en parallèle sous turbo ; un seul démarre le serveur.
if command -v flock >/dev/null 2>&1; then
  exec 9>"${TMPDIR:-/tmp}/fisca-ensure-postgres.lock"
  flock 9
  if reachable; then exit 0; fi
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[ensure-postgres] PostgreSQL absent sur ${HOST}:${PORT} : démarrage par bootstrap-sandbox.sh --postgres" >&2
# 9>&- : le serveur lance en arriere-plan ne doit pas heriter (et garder ouvert) le descripteur du verrou.
bash "${HERE}/bootstrap-sandbox.sh" --postgres >&2 9>&-
for _ in $(seq 1 20); do reachable && exit 0; sleep 0.5; done
echo "[ensure-postgres] ERREUR : PostgreSQL toujours injoignable sur ${HOST}:${PORT} après le bootstrap." >&2
exit 1
