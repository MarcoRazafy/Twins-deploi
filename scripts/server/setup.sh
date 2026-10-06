#!/usr/bin/env bash
#
# Mini Railway - préparation du serveur (Linux Mint / Ubuntu).
#
#   sudo bash scripts/server/setup.sh [--user NOM] [--base-domain mini-railway.test]
#
# Idempotent : peut être relancé sans risque, il ne refait que ce qui manque.
# Ne supprime rien et ne modifie aucune configuration existante hors des
# fichiers listés ci-dessous.
#
# Ce que fait le script
#   1. Docker      : service actif au démarrage, rotation des logs (seulement si
#                    /etc/docker/daemon.json n'existe pas), accès au socket pour
#                    l'utilisateur de la plateforme (groupe docker).
#   2. Répertoires : /var/lib/mini-railway, /var/log/mini-railway, /etc/mini-railway.
#   3. PostgreSQL  : rôle « mini_railway » + bases « mini_railway » et
#                    « mini_railway_shadow » (migrations Prisma). C'est la base
#                    interne de la plateforme ; les bases des projets sont des
#                    conteneurs PostgreSQL créés par la plateforme elle-même.
#   4. Secrets     : /etc/mini-railway/mini-railway.env (URL de la base, clé de
#                    chiffrement), lisible uniquement par l'utilisateur de la plateforme.
#   5. Assistants  : /usr/local/sbin/mini-railway-proxy, mini-railway-hosts et mini-railway-cert, les
#                    deux seules commandes que la plateforme peut lancer en root
#                    (règle /etc/sudoers.d/mini-railway). Ils n'acceptent que des
#                    données validées (nom d'hôte, port local), jamais de configuration.
#   6. Domaine local : ajoute le domaine de base à /etc/hosts (bloc géré).
#   7. NGINX       : /etc/nginx/conf.d/mini-railway.conf + /etc/nginx/mini-railway.d/.
#
# Remarque de sécurité : appartenir au groupe « docker » équivaut à un accès root
# sur la machine. Seul l'utilisateur de la plateforme y est ajouté ; le socket
# Docker n'est jamais exposé sur le réseau ni monté dans un conteneur.

set -Eeuo pipefail

# Ne dépend pas du PATH hérité (sudo -E, shell root personnalisé…).
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 022

# ─────────────────────────────── affichage ───────────────────────────────────
step() { printf '\n==> %s\n' "$1"; }
ok()   { printf '    [ok] %s\n' "$1"; }
info() { printf '    [..] %s\n' "$1"; }
warn() { printf '    [!!] %s\n' "$1" >&2; }
die()  { printf '\n[ERREUR] %s\n' "$1" >&2; exit 1; }
trap 'die "Échec à la ligne ${LINENO} : ${BASH_COMMAND}"' ERR

# ─────────────────────────────── paramètres ──────────────────────────────────
MR_USER="${SUDO_USER:-}"
BASE_DOMAIN="mini-railway.test"
ACME_EMAIL=""
ACME_DIR="/var/lib/mini-railway/acme"
DATA_DIR="/var/lib/mini-railway"
LOG_DIR="/var/log/mini-railway"
ETC_DIR="/etc/mini-railway"
ENV_FILE="${ETC_DIR}/mini-railway.env"
RESERVED_HOSTS_FILE="${ETC_DIR}/reserved-hosts"
DB_USER="mini_railway"
DB_NAME="mini_railway"
DB_SHADOW="mini_railway_shadow"
NGINX_CONF="/etc/nginx/conf.d/mini-railway.conf"
NGINX_DIR="/etc/nginx/mini-railway.d"
SBIN_DIR="/usr/local/sbin"
SUDOERS_FILE="/etc/sudoers.d/mini-railway"

usage() {
  cat <<'EOF'
Mini Railway - préparation du serveur (Linux Mint / Ubuntu).

  sudo bash scripts/server/setup.sh [--user NOM] [--base-domain mini-railway.test]

Options
  --user NOM            Compte Linux qui exécute la plateforme (défaut : l'utilisateur sudo)
  --base-domain DOMAINE Domaine de base des applications (défaut : mini-railway.test)
  --acme-email EMAIL    Adresse donnée à Let's Encrypt (avis d'expiration). Optionnel.
  -h, --help            Affiche cette aide
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)        [[ $# -ge 2 ]] || die "--user attend une valeur"; MR_USER="$2"; shift 2 ;;
    --base-domain) [[ $# -ge 2 ]] || die "--base-domain attend une valeur"; BASE_DOMAIN="$2"; shift 2 ;;
    --acme-email)  [[ $# -ge 2 ]] || die "--acme-email attend une valeur"; ACME_EMAIL="$2"; shift 2 ;;
    -h|--help)     usage; exit 0 ;;
    *)             die "Option inconnue : $1 (voir --help)" ;;
  esac
done

# ─────────────────────────────── vérifications ───────────────────────────────
[[ ${EUID} -eq 0 ]] || die "Lancez ce script avec sudo : sudo bash scripts/server/setup.sh"

[[ -n "${MR_USER}" ]] || die "Impossible de déterminer l'utilisateur : précisez --user NOM"
[[ "${MR_USER}" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "Nom d'utilisateur invalide : ${MR_USER}"
[[ "${MR_USER}" != "root" ]] || die "La plateforme ne doit pas tourner en root : précisez --user NOM"
id -u "${MR_USER}" >/dev/null 2>&1 || die "L'utilisateur ${MR_USER} n'existe pas"
MR_GROUP="$(id -gn "${MR_USER}")"

BASE_DOMAIN="${BASE_DOMAIN,,}"
[[ "${BASE_DOMAIN}" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$ ]] \
  || die "Domaine de base invalide : ${BASE_DOMAIN}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for helper in mini-railway-proxy mini-railway-hosts mini-railway-cert; do
  [[ -f "${SCRIPT_DIR}/bin/${helper}" ]] || die "Fichier manquant : ${SCRIPT_DIR}/bin/${helper}"
done
if [[ -n "${ACME_EMAIL}" ]]; then
  [[ "${ACME_EMAIL}" =~ ^[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}$ ]] || die "Adresse e-mail invalide : ${ACME_EMAIL}"
fi

for cmd in docker psql pg_lsclusters pg_isready nginx python3 visudo runuser openssl systemctl install; do
  command -v "${cmd}" >/dev/null 2>&1 || die "Commande introuvable : ${cmd}. Installez d'abord Docker, PostgreSQL et NGINX."
done

# postgres (via runuser) ne peut pas lire le répertoire personnel de l'utilisateur :
# on se place à la racine pour éviter des avertissements « permission denied ».
cd /

step "Vérifications"
ok "Utilisateur de la plateforme : ${MR_USER} (groupe ${MR_GROUP})"
ok "Domaine de base : ${BASE_DOMAIN}"
avail_kb="$(df --output=avail -k / | tail -n 1 | tr -d ' ')"
if [[ "${avail_kb}" -lt $((10 * 1024 * 1024)) ]]; then
  warn "Espace disque libre : $((avail_kb / 1024 / 1024)) Go. Prévoyez au moins 10 à 15 Go : les images Docker et les builds en consomment beaucoup."
else
  ok "Espace disque libre : $((avail_kb / 1024 / 1024)) Go"
fi

# ─────────────────────────────── 1. Docker ───────────────────────────────────
step "Docker"
systemctl enable --now containerd.service docker.service >/dev/null 2>&1 || true
systemctl is-active --quiet docker.service || die "Le service Docker ne démarre pas (journalctl -u docker)"
ok "Service actif et lancé au démarrage"

DAEMON_JSON="/etc/docker/daemon.json"
if [[ ! -e "${DAEMON_JSON}" ]]; then
  # live-restore est incompatible avec le mode Swarm.
  live_restore=', "live-restore": true'
  if [[ "$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null)" == "active" ]]; then
    live_restore=''
  fi
  install -d -o root -g root -m 755 /etc/docker
  printf '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" }%s }\n' "${live_restore}" \
    > "${DAEMON_JSON}.mini-railway.tmp"
  chmod 644 "${DAEMON_JSON}.mini-railway.tmp"
  mv -f "${DAEMON_JSON}.mini-railway.tmp" "${DAEMON_JSON}"
  if [[ -z "$(docker ps -q 2>/dev/null)" ]]; then
    if systemctl restart docker.service && systemctl is-active --quiet docker.service; then
      ok "Rotation des logs des conteneurs configurée (${DAEMON_JSON})"
    else
      # Ne jamais laisser Docker à l'arrêt : on retire le fichier et on relance.
      rm -f "${DAEMON_JSON}"
      systemctl reset-failed docker.service >/dev/null 2>&1 || true
      systemctl restart docker.service || true
      systemctl is-active --quiet docker.service || die "Docker ne redémarre plus (journalctl -u docker)"
      warn "Docker a refusé ${DAEMON_JSON} : fichier retiré, configuration d'origine conservée"
    fi
  else
    warn "${DAEMON_JSON} créé, mais des conteneurs tournent : redémarrez Docker plus tard (sudo systemctl restart docker)"
  fi
else
  info "${DAEMON_JSON} existe déjà : laissé tel quel"
fi

if id -nG "${MR_USER}" | tr ' ' '\n' | grep -qx docker; then
  ok "${MR_USER} appartient déjà au groupe docker"
else
  usermod -aG docker "${MR_USER}"
  ok "${MR_USER} ajouté au groupe docker (effectif à la prochaine ouverture de session)"
fi

# Le groupe n'est pris en compte qu'à la prochaine connexion : une ACL donne
# l'accès tout de suite aux sessions déjà ouvertes. Elle reste en place tant que
# l'unité docker.socket n'est pas recréée (redémarrage de la machine) ; à ce
# moment le groupe docker a pris le relais.
if command -v setfacl >/dev/null 2>&1 && [[ -S /var/run/docker.sock ]] \
  && setfacl -m "u:${MR_USER}:rw" /var/run/docker.sock 2>/dev/null; then
  ok "Accès immédiat au socket Docker pour la session en cours"
else
  info "Accès à Docker effectif à la prochaine ouverture de session (ou via : sg docker -c \"commande\")"
fi

# ─────────────────────────────── 2. Répertoires ──────────────────────────────
step "Répertoires"
# root ne crée que les répertoires de premier niveau (parents appartenant à root).
# Les sous-répertoires sont créés avec les droits de l'utilisateur : un lien
# symbolique placé là plus tard ne peut donc jamais être suivi en root.
for dir in "${DATA_DIR}" "${LOG_DIR}" "${ETC_DIR}"; do
  [[ ! -L "${dir}" ]] || die "${dir} est un lien symbolique : remplacez-le par un vrai répertoire"
done
install -d -o "${MR_USER}" -g "${MR_GROUP}" -m 750 "${DATA_DIR}" "${LOG_DIR}"
runuser -u "${MR_USER}" -- install -d -m 750 \
  "${DATA_DIR}/repos" "${DATA_DIR}/builds" "${DATA_DIR}/tmp" \
  "${DATA_DIR}/backups" "${DATA_DIR}/backups/platform" "${DATA_DIR}/backups/databases"
install -d -o root -g root -m 755 "${ETC_DIR}"
ok "${DATA_DIR} (dépôts, builds, sauvegardes), ${LOG_DIR}, ${ETC_DIR}"

# ─────────────────────────────── fichier d'environnement ─────────────────────
# Le répertoire appartient à root : les fichiers temporaires y sont à l'abri.
# Le fichier final n'est lisible que par l'utilisateur de la plateforme.
env_get() {
  [[ -f "${ENV_FILE}" ]] || return 0
  sed -n "s/^$1=//p" "${ENV_FILE}" | tail -n 1
}

env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  if [[ -f "${ENV_FILE}" ]]; then
    grep -v -E "^${key}=" "${ENV_FILE}" > "${tmp}" || true
  else
    printf '# Mini Railway - généré par scripts/server/setup.sh. Ne pas versionner.\n' > "${tmp}"
  fi
  printf '%s=%s\n' "${key}" "${value}" >> "${tmp}"
  chown "${MR_USER}":"${MR_GROUP}" "${tmp}"
  chmod 600 "${tmp}"
  mv -f "${tmp}" "${ENV_FILE}"
}

env_set_default() {
  [[ -n "$(env_get "$1")" ]] || env_set "$1" "$2"
}

# ─────────────────────────────── 3. PostgreSQL ───────────────────────────────
step "PostgreSQL"
systemctl enable --now postgresql.service >/dev/null 2>&1 || true
PG_PORT="$(pg_lsclusters -h 2>/dev/null | awk '$4 == "online" { print $3; exit }')"
[[ "${PG_PORT}" =~ ^[0-9]+$ ]] || die "Aucun cluster PostgreSQL en ligne (pg_lsclusters)"
for _ in $(seq 1 30); do
  pg_isready -q -h 127.0.0.1 -p "${PG_PORT}" && break
  sleep 1
done
pg_isready -q -h 127.0.0.1 -p "${PG_PORT}" || die "PostgreSQL ne répond pas sur 127.0.0.1:${PG_PORT}"
ok "Service actif sur 127.0.0.1:${PG_PORT}"

pg_sql() {
  runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -p "${PG_PORT}" -d postgres "$@"
}

# Réutilise le mot de passe déjà enregistré pour rester idempotent.
DB_PASSWORD=""
existing_url="$(env_get DATABASE_URL)"
if [[ "${existing_url}" =~ ^postgresql://${DB_USER}:([0-9a-f]{32,})@ ]]; then
  DB_PASSWORD="${BASH_REMATCH[1]}"
else
  DB_PASSWORD="$(openssl rand -hex 24)"
fi

# Le mot de passe (hexadécimal) passe par l'entrée standard, jamais par la ligne
# de commande, pour ne pas apparaître dans la liste des processus.
if [[ "$(pg_sql -Atc "SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}'")" == "1" ]]; then
  # Seul le mot de passe est resynchronisé : les attributs du rôle ne sont pas modifiés.
  pg_sql <<SQL
ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
SQL
  ok "Rôle ${DB_USER} déjà présent (mot de passe synchronisé)"
else
  pg_sql <<SQL
CREATE ROLE ${DB_USER} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${DB_PASSWORD}';
SQL
  ok "Rôle ${DB_USER} créé"
fi

for database in "${DB_NAME}" "${DB_SHADOW}"; do
  if [[ "$(pg_sql -Atc "SELECT 1 FROM pg_database WHERE datname = '${database}'")" == "1" ]]; then
    ok "Base ${database} déjà présente"
  else
    pg_sql -c "CREATE DATABASE ${database} OWNER ${DB_USER} ENCODING 'UTF8' TEMPLATE template0"
    ok "Base ${database} créée"
  fi
  pg_sql -c "REVOKE ALL ON DATABASE ${database} FROM PUBLIC"
done

if PGPASSWORD="${DB_PASSWORD}" psql -X -h 127.0.0.1 -p "${PG_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -Atc 'SELECT 1' >/dev/null 2>&1; then
  ok "Connexion vérifiée avec le rôle ${DB_USER}"
else
  warn "Connexion par mot de passe refusée sur 127.0.0.1 : vérifiez pg_hba.conf (ligne « host all all 127.0.0.1/32 scram-sha-256 »)"
fi

# ─────────────────────────────── 4. Secrets ──────────────────────────────────
step "Configuration et secrets"
env_set DATABASE_URL "postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/${DB_NAME}?schema=public"
env_set SHADOW_DATABASE_URL "postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/${DB_SHADOW}?schema=public"
env_set_default MINI_RAILWAY_SECRET_KEY "$(openssl rand -hex 32)"
env_set MINI_RAILWAY_DATA_DIR "${DATA_DIR}"
env_set MINI_RAILWAY_LOG_DIR "${LOG_DIR}"
env_set MINI_RAILWAY_BASE_DOMAIN "${BASE_DOMAIN}"
env_set MINI_RAILWAY_PROXY_HELPER "${SBIN_DIR}/mini-railway-proxy"
env_set MINI_RAILWAY_HOSTS_HELPER "${SBIN_DIR}/mini-railway-hosts"
env_set MINI_RAILWAY_CERT_HELPER "${SBIN_DIR}/mini-railway-cert"
[[ -n "${ACME_EMAIL}" ]] && env_set MINI_RAILWAY_ACME_EMAIL "${ACME_EMAIL}"
ok "${ENV_FILE} (lisible par ${MR_USER} uniquement)"

# Noms que seule la plateforme peut publier (voir mini-railway-proxy --platform).
printf '# Mini Railway - géré par scripts/server/setup.sh\n%s\n' "${BASE_DOMAIN}" > "${RESERVED_HOSTS_FILE}.tmp"
chmod 644 "${RESERVED_HOSTS_FILE}.tmp"
mv -f "${RESERVED_HOSTS_FILE}.tmp" "${RESERVED_HOSTS_FILE}"

# ─────────────────────────────── 5. Assistants root ──────────────────────────
step "Assistants privilégiés"
install -o root -g root -m 755 "${SCRIPT_DIR}/bin/mini-railway-proxy" "${SBIN_DIR}/mini-railway-proxy"
install -o root -g root -m 755 "${SCRIPT_DIR}/bin/mini-railway-hosts" "${SBIN_DIR}/mini-railway-hosts"
install -o root -g root -m 755 "${SCRIPT_DIR}/bin/mini-railway-cert" "${SBIN_DIR}/mini-railway-cert"
ok "${SBIN_DIR}/mini-railway-proxy, mini-railway-hosts et mini-railway-cert"

sudoers_tmp="$(mktemp)"
cat > "${sudoers_tmp}" <<EOF
# Mini Railway - géré par scripts/server/setup.sh
# Les trois seules commandes que la plateforme peut exécuter en root.
${MR_USER} ALL=(root) NOPASSWD: ${SBIN_DIR}/mini-railway-proxy, ${SBIN_DIR}/mini-railway-hosts, ${SBIN_DIR}/mini-railway-cert
EOF
if visudo -cf "${sudoers_tmp}" >/dev/null 2>&1; then
  install -o root -g root -m 440 "${sudoers_tmp}" "${SUDOERS_FILE}"
  rm -f "${sudoers_tmp}"
  ok "${SUDOERS_FILE}"
else
  rm -f "${sudoers_tmp}"
  die "Règle sudoers invalide : rien n'a été installé dans /etc/sudoers.d"
fi

# ─────────────────────────────── 6. Domaine local ────────────────────────────
step "Domaine local"
if [[ "${BASE_DOMAIN}" =~ \.(test|localhost)$ ]]; then
  "${SBIN_DIR}/mini-railway-hosts" add "${BASE_DOMAIN}" >/dev/null
  ok "${BASE_DOMAIN} pointe vers 127.0.0.1 (/etc/hosts, bloc géré)"
else
  info "${BASE_DOMAIN} est un domaine public : créez ses enregistrements DNS chez votre registrar"
fi

# ─────────────────────────────── 6 bis. HTTPS (Let's Encrypt) ────────────────
step "HTTPS (Let's Encrypt)"
# Dossier du défi HTTP-01, servi par chaque vhost sous /.well-known/acme-challenge/.
install -d -o root -g root -m 755 "${ACME_DIR}"
if command -v certbot >/dev/null 2>&1; then
  ok "certbot présent ($(certbot --version 2>/dev/null | head -n 1 || echo 'version inconnue'))"
elif command -v apt-get >/dev/null 2>&1; then
  info "Installation de certbot (apt-get)…"
  if DEBIAN_FRONTEND=noninteractive apt-get install -y -q certbot >/dev/null 2>&1; then
    ok "certbot installé"
  else
    warn "certbot n'a pas pu être installé (pas de réseau ?) : les domaines publics resteront en HTTP. Installez-le plus tard : sudo apt-get install certbot"
  fi
else
  warn "certbot introuvable et apt-get absent : les domaines publics resteront en HTTP"
fi
# Le renouvellement est fait par le worker de la plateforme (mini-railway-cert renew, deux fois par jour) :
# le timer de certbot ferait doublon et ne rechargerait pas NGINX.
systemctl disable --now certbot.timer >/dev/null 2>&1 || true

# ─────────────────────────────── 7. NGINX ────────────────────────────────────
# En dernier : un problème NGINX (port 80 occupé…) ne bloque pas le reste.
step "NGINX"
install -d -o root -g root -m 755 "${NGINX_DIR}"

write_nginx_conf() {
  local with_hash_size="$1"
  {
    printf '# Mini Railway - géré par scripts/server/setup.sh\n'
    printf 'map $http_upgrade $mini_railway_connection_upgrade {\n    default upgrade;\n    %s      close;\n}\n' "''"
    if [[ "${with_hash_size}" == "1" ]]; then
      # Les domaines générés sont longs : la taille par défaut (64) peut ne pas suffire.
      printf 'server_names_hash_bucket_size 128;\n'
    fi
    printf 'include %s/*.conf;\n' "${NGINX_DIR}"
  } > "${NGINX_CONF}"
  chmod 644 "${NGINX_CONF}"
}

nginx_previous=""
[[ -f "${NGINX_CONF}" ]] && nginx_previous="$(cat "${NGINX_CONF}")"

write_nginx_conf 1
if ! nginx -t >/dev/null 2>&1; then
  # Directive déjà définie ailleurs : on s'en passe.
  write_nginx_conf 0
fi
if ! nginx -t >/dev/null 2>&1; then
  if [[ -n "${nginx_previous}" ]]; then printf '%s\n' "${nginx_previous}" > "${NGINX_CONF}"; else rm -f "${NGINX_CONF}"; fi
  die "NGINX refuse la configuration (sudo nginx -t pour le détail). Rien n'a été modifié côté NGINX."
fi

systemctl enable nginx.service >/dev/null 2>&1 || true
if systemctl is-active --quiet nginx.service; then
  systemctl reload nginx.service || die "NGINX refuse de recharger sa configuration (journalctl -u nginx)"
else
  systemctl start nginx.service || die "NGINX ne démarre pas : le port 80 est probablement occupé par un autre serveur (Apache/XAMPP ?). Arrêtez-le (sudo /opt/lampp/lampp stop) puis relancez ce script. Détail : journalctl -u nginx"
fi
ok "${NGINX_CONF} + ${NGINX_DIR}/ (configuration validée et rechargée)"

# ─────────────────────────────── résumé ──────────────────────────────────────
cat <<EOF

Préparation terminée.

  Utilisateur        ${MR_USER}
  Données            ${DATA_DIR}
  Configuration      ${ENV_FILE}
  Base PostgreSQL    ${DB_NAME} (rôle ${DB_USER}, 127.0.0.1:${PG_PORT})
  Domaine de base    ${BASE_DOMAIN}

À faire ensuite
  1. Fermez puis rouvrez votre session (ou redémarrez) quand vous le pourrez :
     l'appartenance au groupe docker devient alors permanente.
  2. Vérifiez l'ensemble sans sudo :  bash scripts/server/doctor.sh
EOF
