# Mini Railway

Plateforme PaaS inspirée de Railway : projets, workspace visuel, dépôts GitHub,
conteneurs Docker, bases PostgreSQL, variables d'environnement, domaines et
déploiements.

> **Phase 1 — frontend uniquement.** Toute l'interface est fonctionnelle, mais les
> données viennent d'un backend simulé dans le navigateur (persisté dans
> `localStorage`). Le vrai backend (routes Next.js, Prisma/PostgreSQL, Docker, GitHub,
> NGINX, DNS) se branchera derrière le contrat d'API sans réécrire l'interface.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:3000 (ou le port libre suivant)
```

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement (Turbopack) |
| `npm run build` / `npm run start` | Build et serveur de production |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint (règles React 19 incluses) |
| `npm run qa:shot -- --url /dashboard --out /tmp/dashboard.png` | Capture d'écran + erreurs console via le Chrome du système |
| `npm test` | Toute la suite vitest (unitaires, API, pipeline Docker) |
| `npm run test:all` | Idem, en préparant d'abord la base de test (`scripts/test/run-all.sh`) |

## HTTPS

Les domaines publics reçoivent automatiquement un certificat Let's Encrypt (assistant
`scripts/server/bin/mini-railway-cert`, défi HTTP-01, renouvellement par le worker). Il faut que le
nom pointe vers l'adresse IP publique du serveur et que le port 80 soit joignable depuis Internet.
`scripts/server/setup.sh --acme-email vous@exemple.com` installe certbot et enregistre l'adresse de
contact ; `install.sh` met aussi l'interface en HTTPS quand le domaine de base est public.

## Tests

Trois projets vitest (`vitest.config.mts`), lancés ensemble par `npm test` ou un par un :

| Commande | Contenu | Besoin |
| --- | --- | --- |
| `npm run test:unit` | fonctions pures (règles, variables, chiffrement, simulateur navigateur) | rien |
| `npm run test:api` | l'API serveur appelée en direct, chaque test sur base vide | PostgreSQL : base `mini_railway_test` |
| `npm run test:pipeline` | de vrais déploiements (image, conteneur, redéploiement, échec, nettoyage) | Docker |

`bash scripts/test/run-all.sh` crée la base de test si elle manque, applique les migrations puis
lance tout (`--no-pipeline` pour sauter Docker). La base de test est déduite du `DATABASE_URL`
de `.env.local` ou `/etc/mini-railway/mini-railway.env` (nom remplacé par `mini_railway_test`),
ou fixée par `TEST_DATABASE_URL` ; son nom doit finir par `_test` car chaque test vide les tables.
`.github/workflows/ci.yml` rejoue lint, types, tests unitaires et API à chaque push, puis le pipeline.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui (Radix) ·
Lucide · Motion · TanStack Query · Zustand · Recharts.

## Écrans

| Route | Écran |
| --- | --- |
| `/dashboard` | Vue globale : indicateurs, projets, déploiements en cours, activité |
| `/projects` | Création, configuration et suppression des projets |
| `/projects/[id]` | **Workspace** : canvas des services (cartes déplaçables, connexions, zoom) et panneau de service |
| `/projects/[id]/settings` | Réglages d'un projet |
| `/github` | Connexion GitHub, import de dépôts, choix des branches |
| `/docker` | Conteneurs (état, ressources, logs, actions) et images |
| `/databases`, `/databases/[id]` | Bases PostgreSQL : données, connexion, sauvegardes, réglages |
| `/variables` | Variables d'environnement par service et variables partagées |
| `/domains` | Domaines générés et personnalisés, DNS, SSL |
| `/deployments`, `/deployments/[id]` | Historique, statuts et logs en direct |
| `/settings` | Configuration de la plateforme |
| `/dev/kit` | Guide de style vivant du kit de composants (outil interne) |

## Données de démonstration

- Le jeu de démo reprend un projet **CanCham** (application + PostgreSQL) et trois
  autres projets couvrant tous les états (en ligne, build en cours, en erreur, arrêté).
- Les déploiements progressent réellement dans le temps (file d'attente → build →
  déploiement → actif) avec logs en flux continu.
- Ajouter une variable `FAIL_BUILD=1` à un service fait échouer son prochain build ;
  un domaine se terminant par `.invalid` échoue à la vérification DNS.
- Tout réinitialiser : **Settings → Zone de danger → Réinitialiser les données de démo**.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — couches, conventions, contrat d'API et
  passage au vrai backend.
- [`docs/DESIGN.md`](docs/DESIGN.md) — tokens, composants, règles de mouvement, glossaire.
