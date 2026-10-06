#!/usr/bin/env bash
#
# Mini Railway - diagnostic du serveur (sans sudo, ne modifie rien).
#
#   bash scripts/server/doctor.sh
#
# Vérifie que la préparation faite par setup.sh est opérationnelle pour
# l'utilisateur courant. Code de sortie : 0 si tout est bon, 1 sinon.

set -uo pipefail

ENV_FILE="/etc/mini-railway/mini-railway.env"
failures=0

pass() { printf '  [ok] %s\n' "$1"; }
fail() { printf '  [KO] %s\n' "$1"; failures=$((failures + 1)); }
warn() { printf '  [!!] %s\n' "$1"; }
note() { printf '  [..] %s\n' "$1"; }
section() { printf '\n%s\n' "$1"; }

env_get() {
  [[ -r "${ENV_FILE}" ]] || return 0
  sed -n "s/^$1=//p" "${ENV_FILE}" | tail -n 1
}

section "Système"
if command -v node >/dev/null 2>&1; then pass "Node.js $(node -v)"; else fail "Node.js introuvable dans le PATH"; fi
if command -v git >/dev/null 2>&1; then pass "$(git --version)"; else fail "git introuvable"; fi
avail_gb=$(( $(df --output=avail -k / | tail -n 1 | tr -d ' ') / 1024 / 1024 ))
if [[ ${avail_gb} -ge 10 ]]; then
  pass "Espace disque libre : ${avail_gb} Go"
elif [[ ${avail_gb} -ge 2 ]]; then
  note "Espace disque libre : ${avail_gb} Go - insuffisant pour construire des images (10 Go recommandés) : libérez de l'espace avant le premier déploiement"
else
  fail "Espace disque libre : ${avail_gb} Go - disque presque plein"
fi

section "Docker"
if docker info >/dev/null 2>&1; then
  pass "Accès au moteur Docker ($(docker version --format '{{.Server.Version}}' 2>/dev/null))"
  if id -nG | tr ' ' '\n' | grep -qx docker; then
    pass "Session membre du groupe docker"
  else
    note "Accès accordé par ACL pour cette session : reconnectez-vous pour le rendre permanent (groupe docker)"
  fi
  if docker image inspect busybox:stable >/dev/null 2>&1; then
    if docker run --rm --pull never --network none busybox:stable true >/dev/null 2>&1; then
      pass "Lancement d'un conteneur de test"
    else
      fail "Le conteneur de test ne démarre pas"
    fi
  else
    note "Conteneur de test non lancé (image busybox:stable absente ; « docker pull busybox:stable » active ce test)"
  fi
else
  fail "Pas d'accès au socket Docker : lancez « sudo bash scripts/server/setup.sh »"
fi
if [[ -f /etc/docker/daemon.json ]]; then pass "/etc/docker/daemon.json présent"; else note "/etc/docker/daemon.json absent (rotation des logs non configurée)"; fi

section "Configuration"
if [[ -r "${ENV_FILE}" ]]; then
  pass "${ENV_FILE} lisible"
  for key in DATABASE_URL SHADOW_DATABASE_URL MINI_RAILWAY_SECRET_KEY MINI_RAILWAY_DATA_DIR MINI_RAILWAY_BASE_DOMAIN; do
    if [[ -n "$(env_get "${key}")" ]]; then pass "${key} défini"; else fail "${key} manquant"; fi
  done
else
  fail "${ENV_FILE} illisible : lancez « sudo bash scripts/server/setup.sh »"
fi

data_dir="$(env_get MINI_RAILWAY_DATA_DIR)"
data_dir="${data_dir:-/var/lib/mini-railway}"
for dir in "${data_dir}" "${data_dir}/repos" "${data_dir}/builds" "${data_dir}/backups"; do
  if [[ -d "${dir}" && -w "${dir}" ]]; then pass "${dir} accessible en écriture"; else fail "${dir} absent ou non accessible en écriture"; fi
done

section "PostgreSQL"
database_url="$(env_get DATABASE_URL)"
# Le mot de passe passe par l'environnement, jamais par la ligne de commande
# (visible dans la liste des processus).
if [[ "${database_url}" =~ ^postgresql://([^:@/]+):([^@/]+)@([^:/]+):([0-9]+)/([^?]+) ]]; then
  export PGUSER="${BASH_REMATCH[1]}" PGPASSWORD="${BASH_REMATCH[2]}" PGHOST="${BASH_REMATCH[3]}" \
    PGPORT="${BASH_REMATCH[4]}" PGDATABASE="${BASH_REMATCH[5]}"
  if psql -X -Atc 'SELECT 1' >/dev/null 2>&1; then
    pass "Connexion à la base interne (PostgreSQL $(psql -X -Atc 'SHOW server_version' 2>/dev/null))"
  else
    fail "Connexion à la base interne impossible avec DATABASE_URL"
  fi
  unset PGPASSWORD
elif [[ -n "${database_url}" ]]; then
  fail "DATABASE_URL au format inattendu"
else
  fail "DATABASE_URL indisponible"
fi

section "NGINX et domaines"
if systemctl is-active --quiet nginx; then pass "Service nginx actif"; else fail "Service nginx inactif"; fi
if [[ -f /etc/nginx/conf.d/mini-railway.conf && -d /etc/nginx/mini-railway.d ]]; then
  pass "Inclusion /etc/nginx/mini-railway.d en place"
else
  fail "Configuration NGINX de Mini Railway absente"
fi
if command -v certbot >/dev/null 2>&1; then pass "certbot installé (HTTPS automatique des domaines publics)"; else warn "certbot absent : les domaines publics resteront en HTTP (sudo apt-get install certbot)"; fi
for helper in mini-railway-proxy mini-railway-hosts mini-railway-cert; do
  probe=(list)
  [[ "${helper}" == "mini-railway-cert" ]] && probe=(status --host doctor-check.example.com)
  if sudo -k -n "/usr/local/sbin/${helper}" "${probe[@]}" >/dev/null 2>&1; then
    pass "Assistant ${helper} utilisable sans mot de passe"
  else
    fail "Assistant ${helper} indisponible (règle /etc/sudoers.d/mini-railway)"
  fi
done
base_domain="$(env_get MINI_RAILWAY_BASE_DOMAIN)"
if [[ -n "${base_domain}" ]]; then
  if getent hosts "${base_domain}" >/dev/null 2>&1; then
    pass "${base_domain} résolu ($(getent hosts "${base_domain}" | awk '{print $1}' | head -n 1))"
  else
    fail "${base_domain} ne se résout pas"
  fi
fi

printf '\n'
if [[ ${failures} -eq 0 ]]; then
  printf 'Tout est opérationnel.\n'
  exit 0
fi
printf '%d point(s) à corriger.\n' "${failures}"
exit 1
