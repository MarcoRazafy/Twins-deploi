#!/usr/bin/env bash
#
# Mini Railway - installation (ou mise à jour) de la plateforme en service.
#
#   sudo bash scripts/server/install.sh [--user NOM] [--source DÉPÔT_GIT] [--branch main]
#                                       [--port 3100] [--node /chemin/vers/node]
#
# À lancer après scripts/server/setup.sh. Idempotent : relancez-le pour mettre à
# jour la plateforme à partir du dépôt Git.
#
# Ce que fait le script
#   1. Copie un Node.js récent dans /opt/mini-railway/runtime (le service ne
#      dépend plus de nvm ni du Node du système).
#   2. Clone ou met à jour le code dans /opt/mini-railway/app depuis le dépôt Git.
#   3. Installe les dépendances, applique les migrations de la base, construit Next.js.
#   4. Crée et démarre deux services systemd lancés au démarrage de la machine :
#        mini-railway-web     interface + API, à l'écoute sur 127.0.0.1 uniquement
#        mini-railway-worker  builds, déploiements, sauvegardes, surveillance
#   5. Publie la plateforme dans NGINX sur son domaine de base.

set -Eeuo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 022

step() { printf '\n==> %s\n' "$1"; }
ok()   { printf '    [ok] %s\n' "$1"; }
info() { printf '    [..] %s\n' "$1"; }
warn() { printf '    [!!] %s\n' "$1" >&2; }
die()  { printf '\n[ERREUR] %s\n' "$1" >&2; exit 1; }
trap 'die "Échec à la ligne ${LINENO} : ${BASH_COMMAND}"' ERR

MR_USER="${SUDO_USER:-}"
SOURCE=""
BRANCH="main"
WEB_PORT="3100"
NODE_BIN=""
APP_ROOT="/opt/mini-railway"
APP_DIR="${APP_ROOT}/app"
RUNTIME_DIR="${APP_ROOT}/runtime"
ENV_FILE="/etc/mini-railway/mini-railway.env"
UNIT_DIR="/etc/systemd/system"
PROXY_HELPER="/usr/local/sbin/mini-railway-proxy"
CERT_HELPER="/usr/local/sbin/mini-railway-cert"
MIN_NODE_MAJOR=22

usage() {
  cat <<'EOF'
Mini Railway - installation (ou mise à jour) de la plateforme en service.

  sudo bash scripts/server/install.sh [options]

Options
  --user NOM       Compte Linux qui exécute la plateforme (défaut : l'utilisateur sudo)
  --source DÉPÔT   Dépôt Git à installer : chemin local ou URL (défaut : ce dépôt)
  --branch NOM     Branche à installer (défaut : main)
  --port PORT      Port local de l'interface (défaut : 3100)
  --node CHEMIN    Binaire Node.js à utiliser (défaut : le plus récent trouvé, >= 22)
  -h, --help       Affiche cette aide
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)   [[ $# -ge 2 ]] || die "--user attend une valeur";   MR_USER="$2"; shift 2 ;;
    --source) [[ $# -ge 2 ]] || die "--source attend une valeur"; SOURCE="$2"; shift 2 ;;
    --branch) [[ $# -ge 2 ]] || die "--branch attend une valeur"; BRANCH="$2"; shift 2 ;;
    --port)   [[ $# -ge 2 ]] || die "--port attend une valeur";   WEB_PORT="$2"; shift 2 ;;
    --node)   [[ $# -ge 2 ]] || die "--node attend une valeur";   NODE_BIN="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Option inconnue : $1 (voir --help)" ;;
  esac
done

# ─────────────────────────────── vérifications ───────────────────────────────
[[ ${EUID} -eq 0 ]] || die "Lancez ce script avec sudo : sudo bash scripts/server/install.sh"
[[ -n "${MR_USER}" ]] || die "Impossible de déterminer l'utilisateur : précisez --user NOM"
[[ "${MR_USER}" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "Nom d'utilisateur invalide : ${MR_USER}"
[[ "${MR_USER}" != "root" ]] || die "La plateforme ne doit pas tourner en root : précisez --user NOM"
id -u "${MR_USER}" >/dev/null 2>&1 || die "L'utilisateur ${MR_USER} n'existe pas"
MR_GROUP="$(id -gn "${MR_USER}")"
MR_HOME="$(getent passwd "${MR_USER}" | cut -d: -f6)"

[[ "${WEB_PORT}" =~ ^[0-9]{4,5}$ ]] && (( WEB_PORT >= 1024 && WEB_PORT <= 65535 )) || die "Port invalide : ${WEB_PORT}"
(( WEB_PORT < 20000 || WEB_PORT > 29999 )) || die "Le port ${WEB_PORT} est dans la plage réservée aux conteneurs (20000-29999)"
[[ "${BRANCH}" =~ ^[A-Za-z0-9._/-]+$ && "${BRANCH}" != -* ]] || die "Nom de branche invalide : ${BRANCH}"

[[ -f "${ENV_FILE}" ]] || die "${ENV_FILE} est absent : lancez d'abord sudo bash scripts/server/setup.sh"
[[ -x "${PROXY_HELPER}" ]] || die "${PROXY_HELPER} est absent : lancez d'abord sudo bash scripts/server/setup.sh"
for cmd in git curl systemctl runuser install cp; do
  command -v "${cmd}" >/dev/null 2>&1 || die "Commande introuvable : ${cmd}"
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${SOURCE}" ]]; then
  SOURCE="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi
[[ "${SOURCE}" != -* ]] || die "Source invalide : ${SOURCE}"

BASE_DOMAIN="$(sed -n 's/^MINI_RAILWAY_BASE_DOMAIN=//p' "${ENV_FILE}" | tail -n 1)"
[[ -n "${BASE_DOMAIN}" ]] || die "MINI_RAILWAY_BASE_DOMAIN est absent de ${ENV_FILE}"

cd /

# Exécute une commande avec les droits de l'utilisateur de la plateforme.
as_user() {
  runuser -u "${MR_USER}" -- env -i \
    HOME="${MR_HOME}" USER="${MR_USER}" LOGNAME="${MR_USER}" LANG="${LANG:-C.UTF-8}" \
    PATH="${RUNTIME_DIR}/node/bin:/usr/local/bin:/usr/bin:/bin" \
    NEXT_TELEMETRY_DISABLED=1 \
    "$@"
}

step "Vérifications"
ok "Utilisateur de la plateforme : ${MR_USER}"
ok "Source : ${SOURCE} (branche ${BRANCH})"
ok "Domaine : ${BASE_DOMAIN} -> 127.0.0.1:${WEB_PORT}"
if [[ -d "${SOURCE}" ]]; then
  as_git_head="$(runuser -u "${MR_USER}" -- git -C "${SOURCE}" rev-parse --verify --quiet "refs/heads/${BRANCH}" || true)"
  [[ -n "${as_git_head}" ]] || die "Le dépôt ${SOURCE} n'a aucun commit sur la branche ${BRANCH} : validez le code (git commit) avant d'installer."
  if [[ -n "$(runuser -u "${MR_USER}" -- git -C "${SOURCE}" status --porcelain 2>/dev/null | head -n 1)" ]]; then
    warn "Le dépôt source contient des modifications non validées : elles ne seront pas installées."
  fi
fi

# ─────────────────────────────── 1. Node.js ──────────────────────────────────
step "Node.js"
node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if [[ -z "${NODE_BIN}" ]]; then
  # Le plus récent des Node installés par nvm, sinon celui du système.
  NODE_BIN="$(find "${MR_HOME}/.nvm/versions/node" -mindepth 3 -maxdepth 3 -path '*/bin/node' 2>/dev/null \
    | xargs -r -n 1 readlink -f | sort -u -V | tail -n 1 || true)"
  [[ -n "${NODE_BIN}" ]] || NODE_BIN="$(command -v node || true)"
fi
[[ -n "${NODE_BIN}" && -x "${NODE_BIN}" ]] || die "Node.js introuvable : installez Node ${MIN_NODE_MAJOR}+ (nvm install --lts) ou précisez --node CHEMIN"
NODE_BIN="$(readlink -f "${NODE_BIN}")"
(( $(node_major "${NODE_BIN}") >= MIN_NODE_MAJOR )) \
  || die "Node.js $("${NODE_BIN}" -v) est trop ancien : il faut la version ${MIN_NODE_MAJOR} ou plus (précisez --node CHEMIN)"

NODE_VERSION="$("${NODE_BIN}" -v)"
NODE_ROOT="$(dirname "$(dirname "${NODE_BIN}")")"
[[ -x "${NODE_ROOT}/bin/node" && -d "${NODE_ROOT}/lib/node_modules/npm" ]] \
  || die "${NODE_ROOT} n'est pas une installation Node.js complète (npm manquant) : précisez --node CHEMIN"

install -d -o root -g root -m 755 "${APP_ROOT}" "${RUNTIME_DIR}"
if [[ ! -x "${RUNTIME_DIR}/node-${NODE_VERSION}/bin/node" ]]; then
  rm -rf "${RUNTIME_DIR}/node-${NODE_VERSION}.tmp"
  cp -a "${NODE_ROOT}" "${RUNTIME_DIR}/node-${NODE_VERSION}.tmp"
  chown -R root:root "${RUNTIME_DIR}/node-${NODE_VERSION}.tmp"
  mv "${RUNTIME_DIR}/node-${NODE_VERSION}.tmp" "${RUNTIME_DIR}/node-${NODE_VERSION}"
fi
ln -sfn "node-${NODE_VERSION}" "${RUNTIME_DIR}/node"
ok "Node.js ${NODE_VERSION} dans ${RUNTIME_DIR}/node"

# ─────────────────────────────── 2. Code ─────────────────────────────────────
step "Code de la plateforme"
units_exist=0
if [[ -f "${UNIT_DIR}/mini-railway-web.service" ]]; then
  units_exist=1
  systemctl stop mini-railway-worker.service mini-railway-web.service >/dev/null 2>&1 || true
  info "Services arrêtés le temps de la mise à jour"
fi

[[ ! -L "${APP_DIR}" ]] || die "${APP_DIR} est un lien symbolique : remplacez-le par un vrai répertoire"
install -d -o "${MR_USER}" -g "${MR_GROUP}" -m 750 "${APP_DIR}"
if [[ -d "${APP_DIR}/.git" ]]; then
  as_user git -C "${APP_DIR}" remote set-url origin "${SOURCE}"
  as_user git -C "${APP_DIR}" fetch --quiet --prune origin
  as_user git -C "${APP_DIR}" checkout --quiet -B "${BRANCH}" "origin/${BRANCH}"
  as_user git -C "${APP_DIR}" reset --quiet --hard "origin/${BRANCH}"
  ok "Code mis à jour ($(as_user git -C "${APP_DIR}" rev-parse --short HEAD))"
else
  as_user git clone --quiet --branch "${BRANCH}" -- "${SOURCE}" "${APP_DIR}"
  ok "Code cloné ($(as_user git -C "${APP_DIR}" rev-parse --short HEAD))"
fi

# ─────────────────────────────── 3. Build ────────────────────────────────────
step "Dépendances, base de données et build (quelques minutes)"
as_user bash -c "cd '${APP_DIR}' && npm ci --no-audit --no-fund --loglevel=error"
ok "Dépendances installées"
as_user bash -c "cd '${APP_DIR}' && npx prisma migrate deploy" >/dev/null
ok "Migrations de la base appliquées"
as_user bash -c "cd '${APP_DIR}' && NEXT_PUBLIC_API_MODE=http npm run build" >/dev/null
ok "Interface construite (mode backend réel)"

# ─────────────────────────────── 4. Services ─────────────────────────────────
step "Services systemd"
unit_common() {
  cat <<EOF
User=${MR_USER}
Group=${MR_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=PATH=${RUNTIME_DIR}/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Restart=on-failure
RestartSec=3
# Pas de NoNewPrivileges ni de ProtectSystem : la plateforme appelle ses deux
# assistants via sudo, qui doivent pouvoir écrire dans /etc/nginx et /etc/hosts.
EOF
}

cat > "${UNIT_DIR}/mini-railway-web.service.tmp" <<EOF
[Unit]
Description=Mini Railway - interface et API
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
$(unit_common)
ExecStart=${RUNTIME_DIR}/node/bin/node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${WEB_PORT}

[Install]
WantedBy=multi-user.target
EOF

cat > "${UNIT_DIR}/mini-railway-worker.service.tmp" <<EOF
[Unit]
Description=Mini Railway - worker (builds, déploiements, sauvegardes)
After=network-online.target postgresql.service docker.service
Wants=network-online.target docker.service

[Service]
Type=simple
$(unit_common)
ExecStart=${RUNTIME_DIR}/node/bin/node node_modules/tsx/dist/cli.mjs src/worker/main.ts
KillSignal=SIGTERM
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
EOF

for unit in mini-railway-web mini-railway-worker; do
  chmod 644 "${UNIT_DIR}/${unit}.service.tmp"
  mv -f "${UNIT_DIR}/${unit}.service.tmp" "${UNIT_DIR}/${unit}.service"
done
systemctl daemon-reload
systemctl enable --quiet mini-railway-web.service mini-railway-worker.service
systemctl restart mini-railway-web.service mini-railway-worker.service
ok "mini-railway-web et mini-railway-worker démarrés et activés au démarrage"

healthy=0
for _ in $(seq 1 45); do
  if curl -fsS -o /dev/null -m 3 "http://127.0.0.1:${WEB_PORT}/login"; then healthy=1; break; fi
  sleep 1
done
if [[ ${healthy} -eq 1 ]]; then
  ok "L'interface répond sur 127.0.0.1:${WEB_PORT}"
else
  warn "L'interface ne répond pas encore : journalctl -u mini-railway-web -n 50"
fi
systemctl is-active --quiet mini-railway-worker.service \
  && ok "Worker actif" \
  || warn "Le worker ne tourne pas : journalctl -u mini-railway-worker -n 50"

# ─────────────────────────────── 5. NGINX ────────────────────────────────────
step "Publication dans NGINX"
PLATFORM_URL="http://${BASE_DOMAIN}"
"${PROXY_HELPER}" apply --host "${BASE_DOMAIN}" --port "${WEB_PORT}" --platform --read-timeout 300 --max-body-mb 200 >/dev/null
ok "http://${BASE_DOMAIN} -> 127.0.0.1:${WEB_PORT}"

# Domaine public : certificat Let's Encrypt pour l'interface elle-même (le défi
# HTTP-01 passe par le vhost HTTP qui vient d'être écrit).
if [[ ! "${BASE_DOMAIN}" =~ \.(test|localhost)$ ]] && [[ -x "${CERT_HELPER}" ]] && command -v certbot >/dev/null 2>&1; then
  ACME_EMAIL="$(sed -n 's/^MINI_RAILWAY_ACME_EMAIL=//p' "${ENV_FILE}" | tail -n 1)"
  cert_args=(issue --host "${BASE_DOMAIN}")
  [[ -n "${ACME_EMAIL}" ]] && cert_args+=(--email "${ACME_EMAIL}")
  if "${CERT_HELPER}" "${cert_args[@]}" >/dev/null 2>"${TMPDIR:-/tmp}/mini-railway-cert.err"; then
    "${PROXY_HELPER}" apply --host "${BASE_DOMAIN}" --port "${WEB_PORT}" --platform --read-timeout 300 --max-body-mb 200 --tls --force-https >/dev/null
    PLATFORM_URL="https://${BASE_DOMAIN}"
    ok "Certificat Let's Encrypt actif : https://${BASE_DOMAIN} (HTTP redirigé)"
  else
    warn "Pas de certificat pour ${BASE_DOMAIN} (l'interface reste en HTTP) : $(tail -n 3 "${TMPDIR:-/tmp}/mini-railway-cert.err" | tr '\n' ' ')"
    warn "Vérifiez que ${BASE_DOMAIN} pointe vers l'adresse IP publique de ce serveur et que le port 80 est joignable depuis Internet, puis relancez ce script."
  fi
  rm -f "${TMPDIR:-/tmp}/mini-railway-cert.err"
fi

cat <<EOF

Installation terminée.

  Interface      ${PLATFORM_URL}
  Code           ${APP_DIR}$([[ ${units_exist} -eq 1 ]] && printf ' (mis à jour)')
  Journaux       journalctl -u mini-railway-web -f
                 journalctl -u mini-railway-worker -f
  État           systemctl status mini-railway-web mini-railway-worker
  Mise à jour    git commit dans le dépôt source, puis relancer ce script

À la première visite, l'interface vous demande de créer le compte propriétaire.
EOF
