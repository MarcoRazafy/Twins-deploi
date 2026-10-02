#!/usr/bin/env bash
#
# Mini Railway / TwinsDeploi - accès depuis les autres appareils du réseau local.
#
#   sudo bash scripts/server/lan-access.sh [--interface wlp3s0] [--remove]
#
# Idempotent. Ce que fait le script
#   1. Lance un petit serveur DNS (dnsmasq) à l'écoute sur l'interface du réseau
#      local uniquement : tous les noms en .test pointent vers ce serveur, les
#      autres noms sont transmis au DNS habituel de la machine.
#   2. Ouvre le pare-feu (ufw) au réseau local seulement : DNS (53) et web (80).
#
# Sur l'autre appareil, il suffit de mettre l'adresse de ce serveur comme DNS.
# Avec --remove, tout est retiré.

set -Eeuo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 022
# ufw traduit sa sortie : on force la langue par défaut pour pouvoir la lire.
export LC_ALL=C LANG=C

ok()   { printf '    [ok] %s\n' "$1"; }
warn() { printf '    [!!] %s\n' "$1" >&2; }
die()  { printf '\n[ERREUR] %s\n' "$1" >&2; exit 1; }
trap 'die "Échec à la ligne ${LINENO} : ${BASH_COMMAND}"' ERR

IFACE=""
REMOVE=0
CONF="/etc/mini-railway/dnsmasq.conf"
UNIT="/etc/systemd/system/mini-railway-dns.service"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interface) [[ $# -ge 2 ]] || die "--interface attend une valeur"; IFACE="$2"; shift 2 ;;
    --remove) REMOVE=1; shift ;;
    -h|--help) sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Option inconnue : $1" ;;
  esac
done

[[ ${EUID} -eq 0 ]] || die "Lancez ce script avec sudo"

if [[ ${REMOVE} -eq 1 ]]; then
  systemctl disable --now mini-railway-dns.service >/dev/null 2>&1 || true
  rm -f "${UNIT}" "${CONF}"
  systemctl daemon-reload
  if command -v ufw >/dev/null 2>&1; then
    while read -r num; do
      [[ -n "${num}" ]] && yes | ufw delete "${num}" >/dev/null 2>&1 || true
    done < <(ufw status numbered 2>/dev/null | grep 'mini-railway-lan' | sed -E 's/^\[ *([0-9]+)\].*/\1/' | sort -rn)
  fi
  ok "Accès réseau local retiré"
  exit 0
fi

command -v dnsmasq >/dev/null 2>&1 || die "dnsmasq est introuvable (paquet dnsmasq-base)"
[[ -d /etc/mini-railway ]] || die "Lancez d'abord scripts/server/setup.sh"

if [[ -z "${IFACE}" ]]; then
  IFACE="$(ip -4 route show default | awk '{for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit }}')"
fi
[[ "${IFACE}" =~ ^[a-zA-Z0-9_.-]{1,15}$ ]] || die "Interface réseau invalide : ${IFACE}"
ADDR_CIDR="$(ip -4 -o addr show dev "${IFACE}" scope global | awk '{print $4; exit}')"
[[ -n "${ADDR_CIDR}" ]] || die "Aucune adresse IPv4 sur ${IFACE}"
ADDR="${ADDR_CIDR%/*}"
[[ "${ADDR}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Adresse invalide : ${ADDR}"
SUBNET="$(ip -4 route show dev "${IFACE}" scope link | awk '$1 ~ /\// {print $1; exit}')"
[[ "${SUBNET}" =~ ^[0-9.]+/[0-9]+$ ]] || die "Réseau local introuvable sur ${IFACE}"

printf '\n==> Serveur DNS local (%s, %s)\n' "${IFACE}" "${ADDR}"
cat > "${CONF}.tmp" <<EOF
# Géré par scripts/server/lan-access.sh
port=53
interface=${IFACE}
except-interface=lo
bind-dynamic
no-hosts
no-resolv
server=127.0.0.53
address=/test/${ADDR}
cache-size=500
EOF
chmod 644 "${CONF}.tmp"
mv -f "${CONF}.tmp" "${CONF}"
dnsmasq --test --conf-file="${CONF}" >/dev/null 2>&1 || die "Configuration dnsmasq refusée"

cat > "${UNIT}.tmp" <<EOF
[Unit]
Description=Mini Railway - DNS du réseau local (.test)
After=network-online.target systemd-resolved.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/sbin/dnsmasq --keep-in-foreground --conf-file=${CONF}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
chmod 644 "${UNIT}.tmp"
mv -f "${UNIT}.tmp" "${UNIT}"
systemctl daemon-reload
systemctl enable --quiet mini-railway-dns.service
systemctl restart mini-railway-dns.service
sleep 1
systemctl is-active --quiet mini-railway-dns.service || die "Le serveur DNS ne démarre pas (journalctl -u mini-railway-dns)"
ok "Tous les noms .test répondent ${ADDR}"

printf '\n==> Pare-feu\n'
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw allow from "${SUBNET}" to any port 80 proto tcp comment 'mini-railway-lan' >/dev/null
  ufw allow from "${SUBNET}" to any port 53 proto udp comment 'mini-railway-lan' >/dev/null
  ufw allow from "${SUBNET}" to any port 53 proto tcp comment 'mini-railway-lan' >/dev/null
  ok "Ports 80 et 53 ouverts pour ${SUBNET} uniquement"
else
  ok "ufw inactif : rien à ouvrir"
fi

cat <<EOF

Accès réseau local prêt.

  Sur l'autre appareil : DNS = ${ADDR}
  Puis ouvrir          : http://<nom>.test

Si l'adresse de ce serveur change (${ADDR}), relancez ce script.
EOF
