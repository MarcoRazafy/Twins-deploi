#!/usr/bin/env bash
#
# Mini Railway - amorçage d'un serveur neuf (VPS Ubuntu).
#
#   bash scripts/server/bootstrap.sh [--user mini-railway] [--swap-gb 2] [--node-major 24]
#
# À lancer en root sur une machine fraîchement créée, avant setup.sh : il installe
# ce que setup.sh et install.sh supposent déjà présent. Depuis votre poste, sans
# copier le dépôt sur le serveur :
#
#   ssh root@SERVEUR 'bash -s -- --user mini-railway' < scripts/server/bootstrap.sh
#
# Idempotent : peut être relancé sans risque, il ne refait que ce qui manque.
#
# Ce que fait le script
#   1. Paquets     : Docker avec buildx (exigé par « docker build --progress »),
#                    PostgreSQL, NGINX, certbot, git et les outils de setup.sh.
#   2. Utilisateur : compte non-root de la plateforme, sans mot de passe ni sudo,
#                    joignable en SSH avec les clés déjà autorisées pour root.
#   3. Swap        : fichier d'échange, pour qu'un build ne sature pas la mémoire
#                    d'un petit serveur.
#   4. Node.js     : installé par nvm dans le compte de la plateforme, là où
#                    install.sh le cherche. Le paquet nodejs du système ne convient
#                    pas : install.sh recopie une installation autonome.

set -Eeuo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive
# ssh transmet les réglages régionaux du poste (LC_*), souvent absents du serveur.
for name in "${!LC_@}"; do unset "${name}"; done
umask 022

step() { printf '\n==> %s\n' "$1"; }
ok()   { printf '    [ok] %s\n' "$1"; }
info() { printf '    [..] %s\n' "$1"; }
warn() { printf '    [!!] %s\n' "$1" >&2; }
die()  { printf '\n[ERREUR] %s\n' "$1" >&2; exit 1; }
trap 'die "Échec à la ligne ${LINENO} : ${BASH_COMMAND}"' ERR

MR_USER="mini-railway"
SWAP_GB="2"
NODE_MAJOR="24"
NVM_VERSION="v0.40.3"
SWAP_FILE="/swapfile"
MIN_NODE_MAJOR=22

usage() {
  cat <<'EOF'
Mini Railway - amorçage d'un serveur neuf (VPS Ubuntu).

  bash scripts/server/bootstrap.sh [options]

Options
  --user NOM        Compte Linux qui exécutera la plateforme (défaut : mini-railway)
  --swap-gb N       Taille du fichier d'échange en Go, 0 pour ne pas en créer (défaut : 2)
  --node-major N    Version majeure de Node.js à installer (défaut : 24)
  -h, --help        Affiche cette aide
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)       [[ $# -ge 2 ]] || die "--user attend une valeur";       MR_USER="$2"; shift 2 ;;
    --swap-gb)    [[ $# -ge 2 ]] || die "--swap-gb attend une valeur";    SWAP_GB="$2"; shift 2 ;;
    --node-major) [[ $# -ge 2 ]] || die "--node-major attend une valeur"; NODE_MAJOR="$2"; shift 2 ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "Option inconnue : $1 (voir --help)" ;;
  esac
done

# ─────────────────────────────── vérifications ───────────────────────────────
[[ ${EUID} -eq 0 ]] || die "Lancez ce script en root (ou avec sudo)"
[[ "${MR_USER}" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "Nom d'utilisateur invalide : ${MR_USER}"
[[ "${MR_USER}" != "root" ]] || die "La plateforme ne doit pas tourner en root : précisez --user NOM"
[[ "${SWAP_GB}" =~ ^[0-9]{1,2}$ ]] || die "Taille de swap invalide : ${SWAP_GB}"
[[ "${NODE_MAJOR}" =~ ^[0-9]{2}$ ]] && (( NODE_MAJOR >= MIN_NODE_MAJOR )) \
  || die "Version de Node.js invalide : ${NODE_MAJOR} (il faut ${MIN_NODE_MAJOR} ou plus)"
command -v apt-get >/dev/null 2>&1 || die "apt-get introuvable : ce script ne gère que Ubuntu et Debian"

cd /

# ─────────────────────────────── 1. Paquets ──────────────────────────────────
step "Paquets (quelques minutes)"
packages=(ca-certificates curl git openssl python3 acl sudo postgresql nginx certbot)
# Un Docker déjà en place (docker-ce…) est conservé : les deux distributions s'excluent.
command -v docker >/dev/null 2>&1 || packages+=(docker.io docker-buildx)
apt-get update -q >/dev/null
apt-get install -y -q "${packages[@]}" >/dev/null
docker buildx version >/dev/null 2>&1 \
  || die "Docker est installé sans buildx : ajoutez le paquet docker-buildx (ou docker-buildx-plugin avec docker-ce)"
ok "$(docker --version | cut -d, -f1), buildx $(docker buildx version | awk '{ print $2 }')"
ok "$(psql --version), NGINX $(nginx -v 2>&1 | sed 's|.*nginx/||'), $(certbot --version 2>/dev/null | head -n 1)"

# ─────────────────────────────── 2. Utilisateur ──────────────────────────────
step "Utilisateur de la plateforme"
if id -u "${MR_USER}" >/dev/null 2>&1; then
  ok "Compte ${MR_USER} déjà présent"
else
  useradd --create-home --shell /bin/bash "${MR_USER}"
  ok "Compte ${MR_USER} créé (sans mot de passe : connexion par clé SSH uniquement)"
fi
MR_GROUP="$(id -gn "${MR_USER}")"
MR_HOME="$(getent passwd "${MR_USER}" | cut -d: -f6)"

# Mêmes clés que root, pour envoyer le code (git push) depuis le poste de développement.
if [[ -e "${MR_HOME}/.ssh/authorized_keys" ]]; then
  ok "Clés SSH de ${MR_USER} déjà en place"
elif [[ -s /root/.ssh/authorized_keys ]]; then
  install -d -o "${MR_USER}" -g "${MR_GROUP}" -m 700 "${MR_HOME}/.ssh"
  install -o "${MR_USER}" -g "${MR_GROUP}" -m 600 /root/.ssh/authorized_keys "${MR_HOME}/.ssh/authorized_keys"
  ok "Clés SSH de root autorisées pour ${MR_USER}"
else
  warn "root n'a aucune clé SSH : ajoutez la vôtre dans ${MR_HOME}/.ssh/authorized_keys pour envoyer le code"
fi

# ─────────────────────────────── 3. Swap ─────────────────────────────────────
step "Mémoire d'échange"
if [[ "${SWAP_GB}" -eq 0 ]]; then
  info "Aucun fichier d'échange demandé (--swap-gb 0)"
elif [[ -n "$(swapon --show --noheadings 2>/dev/null)" ]]; then
  ok "Swap déjà actif ($(swapon --show=NAME,SIZE --noheadings | tr -s ' ' | paste -sd, -))"
else
  if [[ ! -e "${SWAP_FILE}" ]]; then
    fallocate -l "${SWAP_GB}G" "${SWAP_FILE}"
    chmod 600 "${SWAP_FILE}"
    mkswap "${SWAP_FILE}" >/dev/null
  fi
  swapon "${SWAP_FILE}"
  grep -q "^${SWAP_FILE} " /etc/fstab || printf '%s none swap sw 0 0\n' "${SWAP_FILE}" >> /etc/fstab
  ok "Swap de ${SWAP_GB} Go actif (${SWAP_FILE}, conservé au redémarrage)"
fi

# ─────────────────────────────── 4. Node.js ──────────────────────────────────
step "Node.js"
node_bin() {
  find "${MR_HOME}/.nvm/versions/node" -mindepth 3 -maxdepth 3 -path "*/v${NODE_MAJOR}.*/bin/node" 2>/dev/null \
    | sort -V | tail -n 1
}

if [[ -z "$(node_bin)" ]]; then
  info "Installation de Node.js ${NODE_MAJOR} par nvm…"
  if [[ ! -s "${MR_HOME}/.nvm/nvm.sh" ]]; then
    runuser -l "${MR_USER}" -c "set -o pipefail; curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh | bash" >/dev/null 2>&1 \
      || die "nvm n'a pas pu être installé (pas de réseau ?)"
  fi
  runuser -l "${MR_USER}" -c ". ~/.nvm/nvm.sh && nvm install ${NODE_MAJOR}" >/dev/null 2>&1 \
    || die "nvm n'a pas pu installer Node.js ${NODE_MAJOR}"
fi
NODE_BIN="$(node_bin)"
[[ -n "${NODE_BIN}" && -x "${NODE_BIN}" ]] || die "Node.js ${NODE_MAJOR} introuvable dans ${MR_HOME}/.nvm après l'installation"
ok "Node.js $("${NODE_BIN}" -v) (${NODE_BIN})"

# ─────────────────────────────── résumé ──────────────────────────────────────
cat <<EOF

Amorçage terminé.

  Utilisateur   ${MR_USER} (${MR_HOME})
  Node.js       ${NODE_BIN}

À faire ensuite
  1. Copiez le dépôt de la plateforme dans le compte ${MR_USER} (git push ou git clone).
  2. Depuis ce dépôt, en root :
       bash scripts/server/setup.sh --user ${MR_USER} --base-domain DOMAINE --acme-email EMAIL
       bash scripts/server/install.sh --user ${MR_USER}
EOF
