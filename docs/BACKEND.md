# Mini Railway — Architecture backend

Le backend implémente **le même contrat `Api`** que le simulateur (`src/lib/api/contract.ts`).
L'interface ne change pas : on bascule d'une implémentation à l'autre avec
`NEXT_PUBLIC_API_MODE=http` (défaut : `mock`).

## 1. Vue d'ensemble

```
Navigateur ──HTTP──► NGINX (:80) ──► Next.js (UI + /api)          ┐
                                        │  Prisma                   │ même base de code
                                        ▼                           │ (src/server/**)
                              PostgreSQL « mini_railway »           │
                                        ▲                           │
                              Worker (tsx src/worker/main.ts) ──────┘
                                        │  CLI docker / git, assistants sudo
                                        ▼
                    Docker Engine (conteneurs des projets) · NGINX · /etc/hosts
```

| Processus | Rôle |
| --- | --- |
| **web** (`next dev` / `next start`) | Interface, RPC `/api/rpc`, flux SSE, webhooks. Ne fait aucun travail long. |
| **worker** (`npm run worker`) | File de tâches : builds, déploiements, vérification DNS, sauvegardes, surveillance des conteneurs, métriques, synchronisation Git. |
| **terminal** (`npm run terminal`) | Console du serveur : WebSocket ↔ pseudo-terminal, pour le propriétaire uniquement (section 11). Écoute sur la boucle locale, refuse tout tant que la console n'est pas activée. |

Tous partagent PostgreSQL (état + file de tâches + notifications `LISTEN/NOTIFY`).

## 2. Arborescence

```
prisma/schema.prisma, prisma/migrations/      Schéma et migrations (Prisma 7, client généré dans src/generated/prisma)
prisma.config.ts                              Configuration de la CLI Prisma
src/server/                                   Code serveur partagé web + worker (jamais importé côté client)
  env.ts            Chargement et validation de l'environnement
  db.ts             Client Prisma (singleton) + connexion pg dédiée à LISTEN
  ids.ts            Identifiants préfixés (prj_, svc_, con_, dep_, var_, dom_, db_, bkp_, act_, usr_, ses_, tok_, job_)
  crypto.ts         AES-256-GCM (secrets), scrypt (mots de passe), SHA-256 (jetons), aléa
  errors.ts         Fabriques d'ApiError (notFound, validation, conflict, forbidden…)
  events.ts         emitEvent(ApiEvent) → pg_notify ; subscribeEvents(listener) ← LISTEN
  activity.ts       recordActivity(...) (journal + notifications)
  mappers/<domaine>.ts  Lignes Prisma → types de src/lib/types.ts (dates en chaînes ISO)
  rules.ts          Règles de validation partagées (noms, slugs, clés, hôtes, bornes)
  context.ts        Context { user, role } + contrôle d'accès
  api/<namespace>.ts  Implémentation serveur de chaque espace du contrat
  api/index.ts      createServerApi(ctx): Api (assemble les espaces)
  exec.ts           run(cmd, args, opts) : exécution de commandes SANS shell, flux ligne à ligne
  docker/           Enveloppe de la CLI docker (réseaux, volumes, conteneurs, images, stats, logs)
  git/              Enveloppe de la CLI git (clone, fetch, ls-remote) + client REST GitHub
  builder/          Détection du projet et génération de Dockerfile
  deploy/           Pipeline de déploiement (machine à états)
  proxy.ts          Appels aux assistants sudo mini-railway-proxy / mini-railway-hosts
  claude/           Page « Claude Code » : appel de l'assistant mini-railway-claude, traduction de son flux
  terminal/         Console du serveur : contrôles de la poignée de main, sessions, pseudo-terminal, interrupteur
  databases/        Conteneurs PostgreSQL des projets (connexion, tables, requêtes, sauvegardes)
  metrics/          Échantillonnage docker stats + agrégation
  jobs/             File de tâches générique (table jobs) et planificateur
src/worker/main.ts                            Point d'entrée du worker
src/terminal/main.ts                          Point d'entrée du service de terminal (console du serveur)
scripts/terminal/pty-bridge.py                Pseudo-terminal d'une session de console (lancé par le service)
src/app/api/rpc/route.ts                      POST /api/rpc
src/app/api/events/route.ts                   GET  /api/events (SSE)
src/app/api/logs/deployments/[id]/route.ts    GET  SSE des logs de build/déploiement
src/app/api/logs/containers/[id]/route.ts     GET  SSE des logs d'exécution
src/app/api/webhooks/github/route.ts          POST webhook GitHub (signature HMAC)
src/app/api/claude/route.ts                   GET état, POST un tour de Claude Code (SSE)
next.config.ts                                Réécriture /api/terminal/ws → service de terminal (WebSocket)
src/lib/api/http.ts                           createHttpApi(): Api (client du RPC + EventSource)
scripts/server/                               bootstrap.sh, setup.sh, doctor.sh, install.sh, unités systemd, assistants root
```

## 3. Environnement

Chargé par `src/server/env.ts` dans cet ordre, sans écraser l'existant : variables du
processus, `.env.local`, `.env`, puis `/etc/mini-railway/mini-railway.env` (écrit par
`scripts/server/setup.sh`).

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL`, `SHADOW_DATABASE_URL` | Base interne et base « shadow » des migrations |
| `MINI_RAILWAY_CERT_HELPER`, `MINI_RAILWAY_ACME_EMAIL` | Assistant Let's Encrypt (HTTPS automatique) et e-mail de contact optionnel |
| `MINI_RAILWAY_SECRET_KEY` | 32 octets en hexadécimal : clé de chiffrement des secrets |
| `MINI_RAILWAY_DATA_DIR` | Dépôts clonés, contextes de build, sauvegardes (`/var/lib/mini-railway`) |
| `MINI_RAILWAY_BASE_DOMAIN` | Domaine de base des domaines générés (`mini-railway.test`) |
| `MINI_RAILWAY_PROXY_HELPER`, `MINI_RAILWAY_HOSTS_HELPER` | Chemins des assistants sudo (absents en dev sans setup : le proxy est alors ignoré avec un avertissement) |
| `MINI_RAILWAY_CLAUDE_HELPER` | Assistant de la page « Claude Code » (`setup.sh --claude-code`). Absent = page désactivée |
| `MINI_RAILWAY_TERMINAL_PORT` | Port local du service de terminal (défaut `3101`). Lu aussi par `next.config.ts` **au build** pour la réécriture |
| `NEXT_PUBLIC_API_MODE` | `http` = vrai backend, sinon simulateur |

## 4. Transport : RPC unique

Le contrat `Api` est exposé tel quel, sans table de routes à maintenir.

```
POST /api/rpc
En-têtes : Content-Type: application/json, X-Mini-Railway: 1
Corps    : { "method": "projects.create", "args": [ { "name": "Démo" } ] }
Succès   : 200 { "result": <valeur JSON> }
Erreur   : 4xx/5xx { "error": { "code": "conflict", "message": "…", "field": "name" } }
```

- `method` doit être `<espace>.<méthode>` présent dans le contrat (liste blanche construite
  à partir de l'objet serveur ; `events.subscribe` et les `subscribe*` sont exclus).
- Codes HTTP : `validation` 400, `forbidden` 403 (401 si non connecté), `not_found` 404,
  `conflict` 409, `unavailable` 503, `unknown` 500. Une erreur inattendue est journalisée
  côté serveur et renvoyée comme `unknown` avec un message générique (jamais de trace).
- Protection CSRF : en-tête `X-Mini-Railway` obligatoire et `Origin` identique à l'hôte.
- Côté client, `createHttpApi()` est un `Proxy` typé par `Api` : `api.x.y(...args)` →
  `fetch('/api/rpc')`, et relance une `ApiError` à partir du corps d'erreur.

Abonnements (SSE, `text/event-stream`, en-tête `X-Accel-Buffering: no`, ping toutes les 25 s) :

| Contrat | Route | Messages |
| --- | --- | --- |
| `events.subscribe` | `GET /api/events` | `data: <ApiEvent JSON>` |
| `deployments.subscribeLogs(id)` | `GET /api/logs/deployments/<id>?after=<seq>` | `data: <LogLine[] JSON>`, puis `event: end` quand le déploiement est terminé et vidé |
| `docker.subscribeContainerLogs(id)` | `GET /api/logs/containers/<id>` | `data: <LogLine[] JSON>` (suit `docker logs -f`) |

## 5. Authentification et droits

- Comptes dans `users` (mot de passe haché avec scrypt), sessions dans `sessions`.
  Cookie `mr_session` : valeur aléatoire de 32 octets, `HttpOnly`, `SameSite=Lax`, `Secure`
  en HTTPS, 30 jours glissants ; seule son empreinte SHA-256 est stockée.
- Premier lancement : tant qu'aucun utilisateur n'existe, `auth.getSession()` renvoie
  `setup_required` et `auth.setup()` crée le compte propriétaire.
- Jetons d'API : `Authorization: Bearer mr_live_…` (empreinte SHA-256 en base).
- Limitation des tentatives de connexion : 5 échecs → blocage 1 minute par adresse.
- Rôles : `viewer` lecture seule (`list*`, `get*`, `search*`) ; `developer` tout sauf
  `settings.*` en écriture et la gestion des membres ; `admin` et `owner` tout. Le
  propriétaire ne peut être ni supprimé ni rétrogradé. Seul `owner` peut lire ou changer
  l'interrupteur de la console du serveur (`settings.getServerConsole` / `setServerConsole`).
- `auth.*` est le seul espace accessible sans session.

## 6. Temps réel

Chaque écriture appelle `emitEvent({ entities, projectId?, serviceId?, deploymentId? })`
qui exécute `pg_notify('mini_railway_events', json)`. Le processus web garde une connexion
`LISTEN` et rediffuse aux clients SSE ; le worker émet par le même canal. Le pont
`useRealtimeSync` côté interface invalide alors les requêtes concernées.

## 7. Implémentation des espaces du contrat

- Un fichier par espace dans `src/server/api/`, exportant `create<Space>Api(ctx)`.
- Le simulateur (`src/lib/mock/api/*`) fait foi pour la sémantique : mêmes validations,
  mêmes messages français, mêmes cascades, mêmes événements. On porte la logique sur Prisma.
- Toute écriture : validation → transaction Prisma → `recordActivity` si pertinent →
  `emitEvent`. Les valeurs renvoyées passent par les mappers.
- L'API ne parle jamais à Docker directement pour une opération longue ou destructive : elle
  met à jour la base et dépose une tâche (`jobs`) ou un déploiement `queued` que le worker exécute.
- Les secrets (valeurs de variables, mots de passe de bases, jeton GitHub) sont chiffrés au
  repos et déchiffrés uniquement pour répondre à un utilisateur autorisé ou pour un déploiement.

## 8. Worker

Boucle unique, un seul worker actif (verrou consultatif PostgreSQL) :

1. **Déploiements** : prend le plus ancien `queued` (`FOR UPDATE SKIP LOCKED`), un à la fois.
2. **Tâches** (`jobs`) : `service.action` (démarrer/arrêter/redémarrer un conteneur), `cleanup.service` et
   `cleanup.project` (conteneurs, volumes, réseaux, images, entrées proxy d'éléments supprimés),
   `domain.verify`, `backup.create`, `backup.restore`, `image.prune`.
3. **Périodiques** : surveillance des conteneurs (10 s), métriques (15 s), synchronisation
   Git des services en déploiement automatique (60 s), sauvegardes planifiées (quotidien),
   purge des métriques et des sessions expirées (horaire).

Au démarrage, tout déploiement resté `building`/`deploying` sans battement récent passe en
`failed` (« Interrompu par un redémarrage de la plateforme ») et le service retrouve son état.

### Pipeline d'un déploiement

`queued → building → deploying → active` (ou `failed` / `cancelled`). `progress`, les logs
(`deployment_logs`, numérotés par `seq`) et un battement (`heartbeatAt`) sont mis à jour en
continu ; `cancelRequested` est vérifié entre les étapes et tue la commande en cours.

| Source | Étape « building » |
| --- | --- |
| Dépôt GitHub | `git clone/fetch` dans `<data>/repos/<serviceId>` → Dockerfile du dépôt, sinon Dockerfile généré (`src/server/builder`) → `docker build --progress=plain` |
| Image Docker | `docker pull <image>:<tag>` |
| PostgreSQL | `docker pull postgres:<version>-alpine` |

Étape « deploying » (identique pour tous) :

1. Réseau du projet `mr-<projectId>` créé si besoin ; volume nommé `mr-<serviceId>-data` si le service a un volume.
2. Port hôte libre dans **20000–29999**, publié sur la boucle locale uniquement.
3. `docker run -d` avec : `--name mr-<slug projet>-<slug service>-<suffixe>`, `--network mr-<projectId>`,
   alias réseau `<slug>` et `<slug>.railway.internal`, `-p 127.0.0.1:<hostPort>:<port>`,
   `--env-file` (fichier 0600 supprimé après le lancement), `--memory`, `--cpus`, `--pids-limit 512`,
   `--security-opt no-new-privileges`, `--cap-drop NET_RAW`, `--restart no` (la politique du service est appliquée par `docker update` une fois le contrôle de santé passé : un plantage au démarrage est vu comme tel, avec son code de sortie),
   étiquettes `mini-railway.managed=true`, `.project`, `.service`, `.deployment`.
   Jamais de `--privileged`, de réseau hôte, de montage du socket Docker ni de montage de chemin de l'hôte.
4. Contrôle de santé : `GET http://127.0.0.1:<hostPort><healthcheckPath>` (ou connexion TCP si
   le chemin est vide ; `pg_isready` pour PostgreSQL), 60 s maximum.
5. Bascule : les domaines du service sont republiés vers le nouveau port (`mini-railway-proxy apply`),
   l'ancien conteneur est arrêté puis supprimé, l'ancien déploiement passe en `removed`.
6. En cas d'échec : le nouveau conteneur est supprimé après capture de ses derniers logs, l'ancien continue de servir.

Variables injectées : variables partagées du projet, puis variables du service (elles
priment), références `${{Service.CLE}}` et `${{shared.CLE}}` résolues, puis les variables
de la plateforme (`src/lib/variables/builtin.ts`, elles priment sur tout) : `PORT`,
`TWINS_PUBLIC_DOMAIN`, `TWINS_PRIVATE_DOMAIN` (`<slug>.twinsdeploi.internal`, alias réseau
du conteneur dans le projet), `TWINS_PROJECT_NAME`, `TWINS_PROJECT_ID`, `TWINS_SERVICE_NAME`,
`TWINS_SERVICE_ID`, `TWINS_ENVIRONMENT_NAME`, `TWINS_REGION`, `TWINS_DEPLOYMENT_ID` et, avec un
volume, `TWINS_VOLUME_NAME` et `TWINS_VOLUME_MOUNT_PATH`. Le préfixe `TWINS_` est réservé.
Un autre service du projet les référence avec `${{Service.TWINS_PUBLIC_DOMAIN}}` ;
l'API `variables.builtins(serviceId)` les expose à l'interface (page Variables d'un service).

### Générateur de Dockerfile (`builder: "nixpacks"`)

Si le binaire `nixpacks` est installé il est utilisé ; sinon la plateforme génère un
Dockerfile multi-étapes pour : Next.js et applications Node (npm, pnpm, yarn, bun détectés
par le fichier de verrouillage), sites statiques (`index.html`), Python
(`requirements.txt`). Le choix est écrit dans les logs de build. Avec `builder: "dockerfile"`,
le Dockerfile du dépôt est obligatoire.

## 9. Domaines et réseau

- Les conteneurs ne sont joignables que par NGINX. La plateforme n'écrit jamais de
  configuration NGINX : elle appelle `sudo -n mini-railway-proxy apply --host <hôte> --port <hostPort>`.
- Domaines locaux (`.test`, `.localhost`) : `sudo -n mini-railway-hosts add <hôte>` puis proxy,
  actifs immédiatement (pas de TLS en local).
- Domaines publics : enregistrements DNS affichés à l'utilisateur, vérification réelle par
  résolution DNS (`dns.resolve`), puis proxy.
- HTTPS automatique (`src/server/domains/tls.ts`, assistant `mini-railway-cert`) : une fois un
  domaine public servi en HTTP, le job `domain.certificate` demande un certificat Let's Encrypt
  (défi HTTP-01 : chaque vhost sert `/.well-known/acme-challenge/` depuis `/var/lib/mini-railway/acme`),
  puis réécrit le vhost avec `--tls` (et `--force-https` selon le domaine). Statuts :
  `issuing_certificate` / `ssl.status = pending` pendant la demande, `active` + `issued` ensuite,
  `active` + `ssl.status = error` si Let's Encrypt refuse (le site reste en HTTP, le message explique
  pourquoi ; « Vérifier » relance la demande, un déploiement ne la relance pas). Le worker lance
  `mini-railway-cert renew` toutes les 12 h et met à jour les dates d'expiration. Sans l'assistant
  (`MINI_RAILWAY_CERT_HELPER` absent) ou pour un nom local, rien ne change : HTTP seulement.
  `MINI_RAILWAY_ACME_EMAIL` (optionnel) est transmis à Let's Encrypt. L'interface elle-même reçoit son
  certificat dans `install.sh` quand le domaine de base est public.
- Domaine généré : `<service>-<projet>-<4 hex>.<MINI_RAILWAY_BASE_DOMAIN>`.

## 10. Bases PostgreSQL des projets

Un conteneur `postgres:<version>-alpine` par base, avec volume nommé, sur le réseau du projet
(hôte interne `<slug>.railway.internal:5432`) et publié sur la boucle locale pour la plateforme.
Tables, données et console SQL passent par `pg` (console en lecture seule :
`default_transaction_read_only`, délai de 5 s, 500 lignes). L'onglet « Tables » ajoute, modifie et
supprime des lignes une à une (`databases.insertRow` / `updateRow` / `deleteRow`) : colonnes vérifiées
contre le schéma lu sur le serveur, valeurs passées en paramètres, ligne désignée par sa clé primaire
complète (tables sans clé primaire : console SQL), transaction validée seulement si exactement une ligne
est touchée. Sauvegardes : `pg_dump -Fc` via
`docker exec` vers `<data>/backups/databases/<id>/`, restauration par `pg_restore`.
Console de commandes (onglet « Console » d'une base, `src/server/databases/console.ts`) : elle est
affichée sur la base mais exécute des **commandes de l'application** (`npm run db:migrate`,
`npx prisma migrate deploy`) : une ligne à la fois, par `sh -c`, **dans le conteneur d'un service
applicatif du même projet** (`docker exec`), là où se trouvent le code et ses variables (`DATABASE_URL`…).
Cible : le service demandé, sinon le premier service applicatif relié à la base sur le canvas ; jamais
une base, jamais un autre projet. `databases.startCommand` lance la commande et répond aussitôt ;
`databases.getCommand` rend son état et sa sortie, que l'interface relit chaque seconde (une migration ou
un `npx` qui télécharge son paquet dure des minutes). Les exécutions vivent dans la mémoire du processus
web (oubliées 15 min après leur fin, ou à son redémarrage), une seule à la fois par base. Pas de terminal
ni d'état conservé entre deux lignes, sortie lue ligne à ligne (64 Kio par flux, la fin est gardée), rôle
`developer` au minimum. Délai : la plateforme n'attend pas plus de 15 min mais **ne tue rien dans le
conteneur** (les enfants d'une commande tuée de l'extérieur deviennent orphelins du PID 1 : l'application
ou, dans un conteneur PostgreSQL, le postmaster, qui redémarre alors en récupération).
La base interne de la plateforme est sauvegardée chaque jour dans `<data>/backups/platform/`.

## 11. Règles de sécurité du code serveur

- **Aucun shell** : toute commande passe par `run(cmd, args[])` (`spawn` sans `shell`),
  les arguments viennent de valeurs validées (identifiants générés, slugs, ports entiers).
  Deux exceptions, voulues : la console d'une base passe la ligne saisie, en un seul argument,
  au shell **du conteneur du service applicatif visé** (rien n'est interprété sur l'hôte) ; et la
  **console du serveur**, qui est un shell interactif **sur l'hôte** (voir plus bas).
- **Aucun secret** dans la ligne de commande, les logs ou les messages d'erreur : jeton
  GitHub transmis à git par variables `GIT_CONFIG_*`, variables des conteneurs par `--env-file`.
- Chemins construits uniquement à partir d'identifiants générés, sous `MINI_RAILWAY_DATA_DIR`.
- Webhooks GitHub : signature `X-Hub-Signature-256` vérifiée en temps constant.
- Les entrées utilisateur (noms, hôtes, clés, commandes de démarrage) sont validées par `rules.ts`.

### Page « Claude Code » : l'exception assumée

La page `/claude` (`src/features/claude-code`) est un chat avec Claude Code exécuté **sur le
serveur, en root, sans confirmation** : c'est l'équivalent de la commande `claude` dans un
terminal root. Elle sort donc volontairement des règles ci-dessus et n'existe que si
`sudo bash scripts/server/setup.sh --claude-code` l'a activée (`--no-claude-code` la retire).

- `POST /api/claude` `{ prompt, sessionId?, cwd? }` : session ou jeton d'API, en-tête CSRF, rôle
  `developer` au minimum, un tour à la fois par utilisateur (4 au total). Réponse SSE d'événements
  `ClaudeEvent` (`src/lib/claude-events.ts`) : `session`, `text`, `tool`, `tool_result`, `done`, `error`.
- `src/server/claude/run.ts` lance `sudo -n mini-railway-claude run --cwd <dossier> [--resume <uuid>]`.
  Le message part sur stdin (jamais en argument) ; stdin reste ouvert et **sa fermeture annule le
  tour** (bouton Arrêter, onglet fermé, redémarrage du processus web) : l'assistant tue alors tout
  le groupe de processus de Claude Code.
- L'assistant lance `claude -p --output-format stream-json` avec le compte Claude de root
  (`/root/.claude`) et une liste d'outils autorisés d'avance (Bash, Edit, Write, Read…). Il ne
  valide que la forme de l'appel (UUID, dossier existant) : **qui peut l'appeler est root**.
- Les conversations affichées vivent dans le `localStorage` du navigateur ; le serveur ne garde que
  les sessions de Claude Code (`/root/.claude/projects`) et une ligne de journal par tour
  (`[claude] turn started by <e-mail> …`, sans le message).
- Un tour qui redémarre `mini-railway-web` coupe son propre flux : préférer un redémarrage manuel.

### Console du serveur : un shell sur l'hôte, pour le propriétaire

L'entrée « Console » de la barre latérale (`/console`, `src/features/server-console`) ouvre un
terminal interactif sur le serveur lui-même (xterm.js dans le navigateur), dans le dossier de
la plateforme : administration, et `claude` (Claude Code) en plein écran. C'est la deuxième
entorse à la règle « aucun shell », et la plus large : **le modèle de sécurité devient
« quiconque contrôle le compte propriétaire a un shell sur le serveur », dès que la console est
activée.** Le compte n'a qu'un mot de passe, sans second facteur : la console est donc
**désactivée par défaut** et doit le rester hors des moments où elle sert.

Chemin d'une session :

```
Navigateur ──wss──► NGINX ──► Next.js (réécriture /api/terminal/ws, next.config.ts)
                                 └──► mini-railway-terminal (127.0.0.1:3101, src/terminal/main.ts)
                                        └──► scripts/terminal/pty-bridge.py ──► shell de connexion (pty)
```

Un route handler ne peut pas accepter un WebSocket : Next.js ne fait que relayer la poignée de
main, **il ne vérifie rien**. Tous les contrôles sont dans le service (`src/server/terminal/`),
à l'ouverture puis tout au long de la session :

| Règle | Où | Détail |
| --- | --- | --- |
| Même origine | `policy.ts` | En-tête `Origin` **obligatoire** et égal à l'hôte appelé (`X-Forwarded-Host`). Un WebSocket n'est pas couvert par la same-origin policy : sans ce contrôle, n'importe quel site ouvert dans le navigateur du propriétaire pourrait s'y connecter. |
| Session du propriétaire | `server.ts` | Cookie `mr_session` valide et rôle `owner`. Les jetons d'API sont refusés (`401`), les autres rôles aussi (`403`). |
| Console activée | `settings.ts` | Ligne `settings` de clé `server-console`, à part du document « platform » : `settings.update` ne peut pas la modifier. Absente = désactivée (`403`). |
| Activation | `api/settings.ts` | `settings.setServerConsole` : propriétaire, depuis une session du navigateur, **mot de passe redemandé** (5 échecs → blocage 1 minute, comme la connexion). Désactiver ne demande rien. |
| Deux sessions au plus | `server.ts` | Tous onglets confondus, sessions détachées comprises ; la troisième est fermée avec le code `4002`. |
| Reprise | `server.ts` | Une session survit à sa connexion : quitter la page la **détache**, le shell continue et ses 256 derniers Ko de sortie sont gardés. La connexion suivante du **même** compte s'y rattache (`?session=<id>`, ou à défaut la plus récente session détachée) et reçoit cette sortie ; `?new=1` en ouvre une autre. Reprise depuis un autre onglet : le premier est fermé avec `4007`. |
| Inactivité | `server.ts` | Fermeture après 30 minutes sans saisie ni reprise, page ouverte ou non (`CONSOLE_LIMITS`, `src/lib/server-console.ts`). |
| Revalidation | `server.ts` | Toutes les 10 s : interrupteur toujours activé, cookie toujours valide, toujours propriétaire. Se déconnecter ou désactiver la console ferme les terminaux ouverts. Trois échecs de vérification de suite (base injoignable) les ferment aussi. |
| Fin de session | `shell.ts`, `pty-bridge.py` | Bouton « Fermer la session » (message `{"type":"close"}`, code `4006`), inactivité, déconnexion ou console désactivée : le shell reçoit SIGHUP, puis tout ce qu'il a lancé est tué (SIGHUP, SIGTERM, SIGKILL), **y compris ce qui s'est détaché** (`setsid`, `nohup`, `tmux`) : les processus sont retrouvés par leur session et par la variable `MINI_RAILWAY_CONSOLE=<id>` de leur environnement. |
| Journal | `server.ts` | Chaque ouverture et chaque fermeture dans l'activité (`console.opened`, `console.closed`) avec l'e-mail, l'adresse IP, la cause et la durée ; activation et désactivation aussi. Les refus sont dans `journalctl -u mini-railway-terminal`, avec l'adresse. Ce qui est tapé n'est **pas** enregistré. |

Ce que le shell est, et n'est pas :

- Il tourne avec le **compte de la plateforme** (celui des services, jamais root : le service et
  `pty-bridge.py` refusent de démarrer en root). Aucune règle sudo n'a été ajoutée pour lui.
- L'unité systemd `mini-railway-terminal` pose `NoNewPrivileges=yes` : `sudo` et tout binaire
  setuid échouent depuis un terminal, **y compris les assistants root de la plateforme**
  (`mini-railway-proxy`, `mini-railway-claude`…). `KillMode=control-group` : arrêter le service
  tue tous les terminaux.
- Son environnement est reconstruit (`HOME`, `PATH`, `TERM=xterm-256color`…) : `DATABASE_URL` et
  `MINI_RAILWAY_SECRET_KEY` n'y sont pas. **Ce n'est pas une barrière** : le compte peut lire
  `/etc/mini-railway/mini-railway.env` et le code, donc tous les secrets de la plateforme.
- **Le compte de la plateforme appartient au groupe `docker`**, et l'accès au démon Docker
  équivaut à root sur l'hôte (`docker run -v /:/host …`). « Pas root » décrit donc l'identité du
  shell, pas une limite de ce qu'un attaquant peut atteindre avec. Pour retirer Docker à la
  console (au prix de `docker ps`, `docker logs`…), ajouter `InaccessiblePaths=/run/docker.sock`
  à l'unité `mini-railway-terminal`.
- Redémarrer `mini-railway-web` coupe les connexions (elles passent par lui) mais pas les
  shells : ils restent détachés et la page les reprend. Redémarrer `mini-railway-terminal`,
  lui, les arrête tous.

Restreindre la console à un réseau privé (Tailscale) n'est pas en place. Ce serait : un contrôle
de l'adresse du client dans `admit()` (plage `100.64.0.0/10`), et surtout un moyen d'atteindre
l'interface **par** ce réseau (vhost sur le nom ou l'adresse Tailscale, certificat par
`tailscale cert`), puisqu'une requête faite au domaine public arrive toujours par l'adresse publique.

## 12. Commandes

```bash
npm run db:migrate        # applique les migrations (prisma migrate deploy)
npm run db:migrate:dev    # crée une migration en développement
npm run worker            # lance le worker
npm run terminal          # lance le service de terminal (console du serveur)
npm run dev               # interface + API (lancer le worker dans un second terminal)
npm test                  # tests unitaires + API + pipeline (voir README, section Tests)
npm run test:all          # idem après préparation de la base mini_railway_test
```

## 13. Tests

- `tests/unit` : fonctions pures, sans base ni Docker.
- `tests/api` : `createServerApi(ctx)` appelé en direct sur la base `mini_railway_test`
  (`tests/helpers/setup-env.ts` force `DATABASE_URL`, une clé de chiffrement de test, un
  répertoire de données temporaire et retire les helpers privilégiés : les domaines sont
  enregistrés mais pas publiés). `resetDatabase()` vide les tables avant chaque test.
- `tests/pipeline` : `runDeployment` avec le vrai Docker, images publiques minuscules, projets
  préfixés `pipetest`, nettoyage par labels `projectId`/`serviceId` même en cas d'échec.
- Console du serveur : `tests/unit/server/terminal-*.test.ts` (contrôles purs, et un vrai
  pseudo-terminal : taille, environnement, aucun processus orphelin) et
  `tests/api/server-console.test.ts` (interrupteur, puis le service réel attaqué en WebSocket :
  refus sans session, autre rôle, autre origine, console désactivée ; limite de sessions,
  inactivité, déconnexion, journal). Les cas avec shell sont ignorés quand la suite tourne en root.
- Intégration continue : `.github/workflows/ci.yml` (PostgreSQL 16 en service, Node 24).
