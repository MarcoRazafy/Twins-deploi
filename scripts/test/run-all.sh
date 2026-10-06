#!/usr/bin/env bash
#
# TwinsDeploi - lance toute la suite de tests (unitaires, API, pipeline).
#
#   bash scripts/test/run-all.sh [--no-pipeline]
#
# Prépare la base jetable mini_railway_test (créée si possible, migrée), puis
# exécute vitest. Les tests du pipeline demandent Docker.

set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

PIPELINE=1
[[ "${1:-}" == "--no-pipeline" ]] && PIPELINE=0

if [[ -z "${PATH_NODE_SET:-}" ]] && ! command -v node >/dev/null 2>&1; then
  export PATH="$(ls -d ~/.nvm/versions/node/v2[2-9]*/bin 2>/dev/null | sort -V | tail -1):${PATH}"
fi

read_var() { # read_var FILE NAME
  [[ -r "$1" ]] || return 1
  sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*//p" "$1" | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  SRC=""
  for f in .env.test /etc/mini-railway/mini-railway.env .env.local; do
    SRC="$(read_var "$f" DATABASE_URL || true)"; [[ -n "${SRC}" ]] && break
  done
  [[ -n "${SRC}" ]] || { echo "TEST_DATABASE_URL manquant et aucun DATABASE_URL trouvé." >&2; exit 1; }
  TEST_DATABASE_URL="$(python3 - "$SRC" <<'PY'
import sys, urllib.parse as u
p = u.urlparse(sys.argv[1]); print(p._replace(path="/mini_railway_test", query="").geturl())
PY
)"
fi
export TEST_DATABASE_URL
case "${TEST_DATABASE_URL}" in *_test|*_test\?*) ;; *) echo "La base de test doit se terminer par _test : ${TEST_DATABASE_URL}" >&2; exit 1 ;; esac

# Création de la base si elle manque (le rôle de la plateforme ne peut pas créer de base : via postgres si possible).
if ! psql "${TEST_DATABASE_URL}" -Atc 'select 1' >/dev/null 2>&1; then
  OWNER="$(python3 -c 'import sys,urllib.parse as u; print(u.urlparse(sys.argv[1]).username or "")' "${TEST_DATABASE_URL}")"
  if command -v sudo >/dev/null 2>&1 && sudo -n -u postgres true 2>/dev/null; then
    sudo -n -u postgres psql -Atc "create database mini_railway_test owner \"${OWNER}\"" >/dev/null
  elif [[ -n "${PGPASSWORD:-}" ]] || createdb --version >/dev/null 2>&1; then
    createdb -O "${OWNER}" mini_railway_test 2>/dev/null || true
  fi
  psql "${TEST_DATABASE_URL}" -Atc 'select 1' >/dev/null 2>&1 || { echo "Base de test inaccessible : créez-la (sudo -u postgres createdb -O ${OWNER} mini_railway_test)." >&2; exit 1; }
fi

echo "==> Migrations sur la base de test"
DATABASE_URL="${TEST_DATABASE_URL}" npx prisma migrate deploy >/dev/null

echo "==> Tests unitaires + API"
npx vitest run --project unit --project api

if [[ ${PIPELINE} -eq 1 ]]; then
  if docker info >/dev/null 2>&1; then
    echo "==> Tests du pipeline (Docker)"
    npx vitest run --project pipeline
  else
    echo "==> Docker indisponible : tests du pipeline ignorés" >&2
  fi
fi
echo "Tous les tests sont passés."
