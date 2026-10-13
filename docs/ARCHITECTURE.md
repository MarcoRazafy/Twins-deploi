# Mini Railway — Architecture frontend

Phase 1 : **frontend uniquement**. Toutes les données viennent d'un backend simulé
dans le navigateur. L'architecture est conçue pour que la phase 2 (routes Next.js,
Prisma/PostgreSQL, GitHub, Docker, NGINX, DNS) se branche **sans réécrire l'UI**.

## 1. Stack

| Domaine | Choix |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict |
| Style | Tailwind CSS 4 (tokens dans `src/app/globals.css`), shadcn/ui (base Radix, style `radix-nova`) |
| Icônes | lucide-react + `src/components/icons/brand-icons.tsx` |
| Animation | Motion (`motion/react`) |
| Données | TanStack Query 5 au-dessus d'un contrat d'API typé |
| État UI local | Zustand (`src/stores/`) |
| Graphiques | Recharts via `@/components/ui/chart` |
| Notifications | sonner |

> Next.js 16 diffère des versions antérieures. En cas de doute, lire la doc embarquée
> dans `node_modules/next/dist/docs/` (voir `AGENTS.md`).

## 2. Arborescence

```
src/
├─ app/                        Routes (fichiers fins : métadonnées + <Suspense> + vue)
│  ├─ layout.tsx               Polices, <html class="dark">, <Providers>
│  ├─ globals.css              Tokens de design
│  └─ (platform)/              Coquille applicative (sidebar + barre du haut)
│     ├─ dashboard/            /dashboard
│     ├─ projects/             /projects, /projects/[projectId] (workspace), …/settings
│     ├─ workspace/            /workspace → dernier projet ouvert
│     ├─ github/ docker/ databases/ variables/ domains/ deployments/ settings/
│     ├─ console/              /console : terminal sur le serveur (propriétaire, vrai backend)
├─ features/<feature>/         Un dossier par domaine fonctionnel
│  ├─ index.ts                 API publique de la feature (seul point d'import externe)
│  └─ components/, hooks/, lib/  Interne à la feature
├─ components/
│  ├─ ui/                      shadcn/ui (généré — ne pas modifier sans raison)
│  ├─ shared/                  Kit partagé (PageHeader, StatusBadge, LogViewer…)
│  ├─ layout/                  Coquille : sidebar, barre du haut, palette de commandes
│  ├─ icons/                   Icônes de marque
│  └─ providers.tsx            QueryClient, Motion, Tooltip, Toaster, temps réel
├─ hooks/                      Hooks génériques (URL state, clipboard, hotkeys…)
├─ stores/                     Stores Zustand (état UI uniquement)
└─ lib/
   ├─ types.ts                 Modèle de domaine (source de vérité)
   ├─ api/contract.ts          Interface `Api`, entrées, `ApiError`, événements
   ├─ api/index.ts             `export const api: Api` ← point de bascule mock/HTTP
   ├─ mock/                    Backend simulé (DB mémoire + localStorage + simulateur)
   ├─ queries/                 Hooks TanStack Query (seul accès aux données pour l'UI)
   ├─ routes.ts                Constructeurs d'URL + conventions de query-string
   ├─ status.ts                Statuts → libellé, ton, icône
   ├─ format.ts                Dates, durées, tailles (fr-FR)
   ├─ motion.ts                Tokens et variantes d'animation
   └─ constants.ts             Constantes partagées
```

## 3. Couches et règles de dépendance

```
app/ (routes)  →  features/*  →  components/shared, components/ui, hooks, stores
                      │
                      └────────→  lib/queries  →  lib/api (contrat)  →  lib/mock
                                                         ↑
                                              lib/types (partout)
```

1. **L'UI ne touche jamais `api` ni `lib/mock` directement.** Elle passe par les hooks
   de `@/lib/queries` (`useProjects()`, `useCreateProject()`…).
2. **Une feature n'importe une autre feature que par son `index.ts`**
   (`import { VariablesEditor } from "@/features/variables"`), jamais par un chemin
   interne.
3. `components/shared` et `components/ui` ne dépendent d'aucune feature.
4. `lib/` ne dépend ni de `components/` ni de `features/`.
5. Les pages (`app/**/page.tsx`) restent des Server Components fins : métadonnées,
   `<Suspense>`, puis la vue de la feature (Client Component).

## 4. Données

### Contrat (`src/lib/api/contract.ts`)

L'interface `Api` décrit toutes les opérations, groupées par domaine (`projects`,
`services`, `deployments`, `variables`, `domains`, `github`, `docker`, `databases`,
`metrics`, `activity`, `settings`, `events`). Les erreurs sont des `ApiError`
(`code`, `message` en français affichable, `field` optionnel pour les formulaires).

### Backend simulé (`src/lib/mock/`)

- Base en mémoire initialisée depuis un jeu de démo, **persistée dans
  `localStorage`** (clé `mini-railway:db`) : l'état survit au rechargement.
- Latence artificielle sur chaque appel (les skeletons et états de chargement sont
  donc réels).
- **Simulateur** : les déploiements progressent tout seuls
  (`queued → building → deploying → active`), émettent des logs en continu ; la
  vérification DNS, les sauvegardes et les redémarrages évoluent dans le temps.
- Chaque écriture émet un `ApiEvent` (`api.events`) listant les collections
  modifiées.
- Réinitialisation : Settings → Zone de danger → « Réinitialiser les données de
  démo » (`api.settings.resetDemoData()`).
- Débogage (dev uniquement) : `window.__miniRailway` expose `{ api, reset(),
  setLatency(factor) }`.

### Hooks (`src/lib/queries/`)

- Un fichier par domaine, tout est ré-exporté par `@/lib/queries`.
- Les clés de requête commencent par le nom de la collection (`["deployments", …]`).
  Le pont temps réel (`useRealtimeSync`, monté dans `Providers`) écoute
  `api.events` et invalide les requêtes des collections touchées : toutes les vues
  ouvertes se mettent à jour sans code spécifique.
- Requêtes : `useXxx(args, options?)` → résultat TanStack standard
  (`data`, `isPending`, `isError`, `error`, `refetch`).
- Mutations : `useVerbXxx()` → `mutate(variables, { onSuccess, onError })` /
  `mutateAsync`. **Les hooks ne déclenchent pas de toast** : c'est le composant
  appelant qui décide du retour utilisateur.
- Logs en flux : `useDeploymentLogs(id)` et `useContainerLogs(id)` combinent
  l'historique et l'abonnement et renvoient `{ lines, isLoading, isStreaming }`.

## 5. Conventions d'URL

Toujours construire les liens avec `routes` (`@/lib/routes`).

| Paramètre | Rôle |
| --- | --- |
| `project=<id>` | Filtre une page plateforme sur un projet |
| `service=<id>` | Filtre sur un service, ou sélectionne le service dans le workspace |
| `tab=<nom>` | Onglet actif (panneau de service, détail d'une base) |
| `section=<nom>` | Section active des Settings |
| `new=1` | Ouvre le dialogue de création principal de la page à l'arrivée |

L'état partageable (filtres, onglet, sélection) vit dans l'URL via `useQueryParam`
(`router.replace`, sans défilement). Les pages enveloppent déjà leur vue dans
`<Suspense>` (obligatoire avec `useSearchParams` en build de production).

## 6. API publique des features

| Feature | Exports (`@/features/<feature>`) |
| --- | --- |
| `dashboard` | `DashboardView` |
| `projects` | `ProjectsView`, `ProjectSettingsView`, `ProjectCard`, `CreateProjectDialog`, `DeleteProjectDialog` |
| `workspace` | `WorkspaceView`, `WorkspaceIndexView` |
| `services` | `ServicePanel`, `ServiceMetricsPanel` |
| `github` | `GithubView`, `ImportRepoDialog`, `GithubSourceSettings` |
| `docker` | `DockerView`, `DeployImageDialog`, `DockerSourceSettings`, `ServiceRuntimeLogs` |
| `databases` | `DatabasesView`, `DatabaseDetailView`, `CreateDatabaseDialog`, `DatabaseConnectionPanel`, `DatabaseDataPanel`, `DatabaseBackupsPanel`, `DatabaseSettingsPanel` |
| `variables` | `VariablesView`, `VariablesEditor` |
| `domains` | `DomainsView`, `ServiceDomains`, `AddDomainDialog` |
| `deployments` | `DeploymentsView`, `DeploymentDetailView`, `DeploymentList`, `ServiceDeployments`, `DeploymentLogs` |
| `settings` | `SettingsView` |
| `server-console` | `ServerConsoleView` (terminal xterm.js relié au service de terminal par WebSocket ; protocole dans `src/lib/server-console.ts`) |

Les dialogues de création sont contrôlés (`open` / `onOpenChange`) pour être
réutilisés depuis le workspace, le dashboard ou la palette de commandes.

## 7. Conventions de code

- TypeScript strict, aucun `any`. Types de domaine importés de `@/lib/types`.
- Fichiers en `kebab-case.tsx`, composants en `PascalCase`, hooks `useXxx`.
- `"use client"` uniquement en tête des fichiers qui utilisent hooks, événements ou
  APIs navigateur.
- Classes conditionnelles avec `cn()` (`@/lib/utils`).
- Aucune valeur de couleur en dur, aucune durée d'animation locale : tokens
  uniquement (voir `docs/DESIGN.md`).
- Textes d'interface en français ; identifiants et commentaires en anglais.
- Les règles ESLint de React 19 (React Compiler) sont actives et bloquantes :
  - pas de `setState` synchrone dans le corps d'un `useEffect` (dériver pendant le
    rendu, `useSyncExternalStore`, `key` pour réinitialiser, ou `setState` dans un
    callback d'événement/abonnement/timer) ;
  - pas de lecture/écriture de `ref.current` pendant le rendu ;
  - pas de `Date.now()`, `new Date()` ni `Math.random()` pendant le rendu
    (utiliser `useNow()`, `useId()`, ou calculer dans un handler/effet) ;
  - pas de composant déclaré dans un composant ;
  - pas de mutation de props, d'état ou de valeurs renvoyées par un hook.
- `params` et `searchParams` des pages sont des `Promise` (Next.js 16).

## 8. Vérification

```bash
npm run typecheck      # next typegen + tsc --noEmit
npm run lint           # eslint (règles React 19 incluses)
npm run build          # build de production
node scripts/qa/shot.mjs --url /dashboard --out /tmp/dashboard.png   # capture + erreurs console
```

`scripts/qa/shot.mjs` pilote le Chrome du système (playwright-core), exécute des
actions (clic, saisie, glisser…) et remonte les erreurs console. Il cible
automatiquement le serveur `next dev` en cours (lu dans `.next/dev/lock`).

## 9. Passage au vrai backend (phase 2)

1. Écrire le schéma Prisma à partir de `src/lib/types.ts` (les entités et leurs
   relations y sont déjà normalisées : `Project 1—n Service`, `Service 1—n
   Deployment`, `Service 1—n Domain`, `Service 1—1 Database`, etc.).
2. Implémenter les route handlers (`src/app/api/**`) ou Server Actions qui
   respectent les signatures de `Api`.
3. Créer `src/lib/api/http.ts` (`createHttpApi(): Api`, basé sur `fetch`) et
   remplacer l'implémentation dans `src/lib/api/index.ts`. Pour migrer
   progressivement, composer : `{ ...mockApi, projects: httpApi.projects }`.
4. Remplacer `api.events` par un flux SSE/WebSocket qui émet les mêmes `ApiEvent` ;
   les logs (`subscribeLogs`) deviennent un flux du même type.
5. Supprimer `src/lib/mock/` quand tous les domaines sont branchés.

Rien dans `features/`, `components/` ni `lib/queries/` n'a besoin de changer.
