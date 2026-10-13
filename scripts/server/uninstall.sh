#!/usr/bin/env bash
#
# Mini Railway - désinstallation des services (ne touche ni aux données ni aux
# conteneurs des projets).
#
#   sudo bash scripts/server/uninstall.sh [--purge-app]
#
# Arrête et supprime les deux services systemd et retire la plateforme de NGINX.
# Avec --purge-app, supprime aussi /opt/mini-railway (code et Node embarqué).
# Les données (/var/lib/mini-railway), la base PostgreSQL, la configuration
# (/etc/mini-railway) et ce qu'a installé setup.sh restent en place.

set -Eeuo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

ok()  { printf '    [ok] %s\n' "$1"; }
die() { printf '\n[ERREUR] %s\n' "$1" >&2; exit 1; }

PURGE_APP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-app) PURGE_APP=1; shift ;;
    -h|--help) sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Option inconnue : $1" ;;
  esac
done

[[ ${EUID} -eq 0 ]] || die "Lancez ce script avec sudo : sudo bash scripts/server/uninstall.sh"

ENV_FILE="/etc/mini-railway/mini-railway.env"
PROXY_HELPER="/usr/local/sbin/mini-railway-proxy"

for unit in mini-railway-terminal mini-railway-worker mini-railway-web; do
  if [[ -f "/etc/systemd/system/${unit}.service" ]]; then
    systemctl disable --now "${unit}.service" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${unit}.service"
    ok "Service ${unit} arrêté et supprimé"
  fi
done
systemctl daemon-reload

if [[ -x "${PROXY_HELPER}" && -f "${ENV_FILE}" ]]; then
  base_domain="$(sed -n 's/^MINI_RAILWAY_BASE_DOMAIN=//p' "${ENV_FILE}" | tail -n 1)"
  if [[ -n "${base_domain}" ]]; then
    "${PROXY_HELPER}" remove --host "${base_domain}" --platform >/dev/null 2>&1 || true
    ok "${base_domain} retiré de NGINX"
  fi
fi

if [[ ${PURGE_APP} -eq 1 ]]; then
  [[ ! -L /opt/mini-railway ]] || die "/opt/mini-railway est un lien symbolique : suppression annulée"
  rm -rf /opt/mini-railway
  ok "/opt/mini-railway supprimé"
fi

printf '\nServices désinstallés. Données, base et configuration conservées.\n'
