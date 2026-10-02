# Mini Railway — Design system

Référence visuelle : l'interface de Railway (thème sombre). Toute la palette a été
échantillonnée sur la capture de référence, puis déclarée en tokens dans
`src/app/globals.css`. Ce document est la source de vérité pour l'apparence, le
mouvement et le ton de l'interface. **Toute nouvelle UI doit le respecter.**

## 1. Principes

1. **Sombre, calme, dense.** Surfaces presque noires teintées de violet, bordures
   discrètes, beaucoup de texte blanc/gris. Le violet est un **accent** (action
   principale, sélection, focus, liens), jamais un fond de page.
2. **Un seul CTA principal par écran** (`<Button>` variante `default`). Le reste est
   `secondary`, `outline` ou `ghost`.
3. **L'état du système est toujours visible** : statut des services, progression
   des déploiements, chargements (skeletons), succès/erreurs (toasts), vides (empty
   states). Aucune action ne reste sans retour visuel.
4. **Tout fonctionne.** Pas de bouton décoratif, pas de « bientôt disponible ». Une
   action visible a un effet (simulé par le mock) et un retour.
5. **Icônes Lucide uniquement** (+ `brand-icons.tsx` pour GitHub/Docker/PostgreSQL/
   NGINX). Jamais d'emoji.
6. **Français** pour toute l'interface (voir le glossaire §11). Le code, lui, est en
   anglais.

## 2. Tokens de couleur

Ne jamais écrire de valeur hexadécimale dans un composant : utiliser les utilitaires
Tailwind générés par les tokens.

| Rôle | Utilitaire | Valeur | Usage |
| --- | --- | --- | --- |
| Fond d'app / canvas | `bg-background` | `#140f1c` | Page, sidebar, canvas du workspace |
| Surface niveau 1 | `bg-card` | `#191322` | Cartes, panneaux, tableaux |
| Surface niveau 2 | `bg-secondary` / `bg-muted` | `#211c2d` | Lignes mises en avant, champs, boutons secondaires |
| Surface niveau 3 | `bg-accent` | `#2c2733` | Survol, élément de navigation actif |
| Menus, popovers, toasts | `bg-popover` | `#1d1727` | Tout ce qui flotte |
| Texte principal | `text-foreground` | `#f4f2f7` | Titres, valeurs |
| Texte secondaire | `text-muted-foreground` | `#9a95a8` | Descriptions, libellés, métadonnées |
| Texte tertiaire | `text-subtle` | `#6b657a` | Placeholders, séparateurs « · », désactivé (jamais pour une info utile) |
| Bordure | `border-border` | `#2a2534` | Bordure par défaut (appliquée globalement) |
| Bordure forte | `border-border-strong` | `#3a3446` | Survol de carte, champs, séparateurs d'onglets |
| Primaire | `bg-primary` / `text-primary-foreground` | `#9d32cf` / blanc | Bouton principal |
| Marque | `brand-50 … brand-950` | `#c777e9` (400), `#9d32cf` (600), `#690393` (800) | Liens `text-brand-400`, sélection `border-brand-800`, halos |
| Succès | `text-success`, `bg-success/10`, `border-success/25` | `#3fb27f` | En ligne, actif, valide |
| Info / en cours | `text-info`, `bg-info/10`, `border-info/25` | `#5a9cf0` | Build, déploiement, vérification |
| Avertissement | `text-warning`, `bg-warning/10`, `border-warning/25` | `#dbb938` | En attente, attention requise |
| Danger | `text-destructive`, `bg-destructive/10`, `border-destructive/30` | `#e5525f` | Échec, crash, suppression |
| Graphiques | `var(--chart-1…5)` | violet, bleu, vert, jaune, rouge | Séries Recharts |

Fonds teintés : toujours `couleur/10` (ou `/15`) + texte de la couleur pleine +
bordure `couleur/25`. Exemple : `bg-success/10 text-success border border-success/25`.

Contrastes vérifiés (WCAG AA) : `foreground`, `muted-foreground`, `success`, `info`,
`warning`, `destructive`, `brand-400` sur `card` ≥ 4.5:1 ; blanc sur `primary` 5.5:1.
`text-subtle` est sous 4.5:1 : décoratif uniquement.

## 3. Surfaces et élévation

| Élément | Recette |
| --- | --- |
| Carte | `rounded-xl border bg-card` (+ `surface-highlight` pour les cartes « héro ») |
| Carte cliquable | carte + `transition-colors hover:border-border-strong hover:bg-secondary/40` + `whileHover={{ y: -2 }}` |
| Carte sélectionnée | carte + `ring-brand-glow` (bordure `brand-800` + halo) |
| Ligne en relief dans une carte | `rounded-lg bg-secondary px-3 py-2.5` |
| Champ | composants shadcn (`Input`, `Select`…) sans surcharge de couleur |
| Flottant | `bg-popover border border-border-strong shadow-xl shadow-black/40` (déjà porté par shadcn) |
| Zone de danger | `rounded-xl border border-destructive/30 bg-destructive/5` |
| Grille du canvas | `bg-background bg-dot-grid` (points `--canvas-dot`, pas de 24 px) |

Pas d'ombres portées sur les cartes posées (le relief vient des bordures) ; les
ombres sont réservées aux éléments flottants et au glisser-déposer.

## 4. Typographie

- **Inter** (`font-sans`) pour tout ; **JetBrains Mono** (`font-mono`) pour logs,
  identifiants, SHA, variables, URLs de connexion, valeurs techniques.
- Taille de base de l'interface : 14 px (`text-sm`, posée sur `body`).

| Rôle | Classes |
| --- | --- |
| Titre de page | `text-xl font-semibold tracking-tight` (`sm:text-2xl`) |
| Titre de section / carte | `text-base font-medium` |
| Titre de sous-section | `text-sm font-medium` |
| Corps | `text-sm` |
| Secondaire | `text-sm text-muted-foreground` |
| Légende, métadonnées | `text-xs text-muted-foreground` |
| Sur-titre de groupe | `text-xs font-medium text-muted-foreground` (casse normale, pas de capitales) |
| Valeur KPI | `text-2xl font-semibold tabular` |
| Code / technique | `font-mono text-[13px]` |

Chiffres qui changent (durées, métriques, compteurs) : toujours `tabular`.
Longs identifiants : `truncate` + `title` (ou tooltip) pour la valeur complète.

## 5. Mise en page

- Conteneur de page : `<PageContainer>` (`max-w-[1400px]`, `px-4 sm:px-6 lg:px-8`,
  `py-6`). Le workspace est la seule page plein cadre.
- En-tête de page : `<PageHeader>` (titre, description, actions à droite).
- Rythme vertical : 24 px entre sections (`space-y-6`), 16 px dans une carte
  (`p-4`, `sm:p-5`), 8–12 px entre éléments liés. Échelle 4/8 px uniquement.
- Rayons : cartes `rounded-xl`, boutons/champs `rounded-lg`, pastilles
  `rounded-md`/`rounded-full`.
- Points de rupture : mobile < 640, `sm` 640, `md` 768, `lg` 1024, `xl` 1280.
  **Chaque écran doit fonctionner à 375 px** : pas de défilement horizontal de la
  page, grilles qui passent à une colonne, tableaux dans un conteneur
  `overflow-x-auto` avec colonnes secondaires masquées (`hidden md:table-cell`),
  actions regroupées dans un menu « … ».
- z-index : contenu 0, éléments collants 10, panneau de service 20, contrôles du
  canvas 30, overlays shadcn 50. Jamais de `z-[9999]`.

## 6. Composants

### Boutons (`@/components/ui/button`)

| Variante | Quand |
| --- | --- |
| `default` | L'action principale de l'écran ou du dialogue (une seule) |
| `secondary` | Actions secondaires visibles |
| `outline` | Actions neutres dans une barre d'outils, « Annuler » |
| `ghost` | Boutons icône, actions de ligne, navigation |
| `destructive` | Suppression/arrêt (toujours confirmé) |
| `link` | Lien en ligne dans du texte |

- Bouton icône seul : `size="icon"` (ou `icon-sm`) + `aria-label` + `Tooltip`.
- Pendant une mutation : `disabled` + `<Spinner />` à la place de l'icône, le
  libellé ne change pas de largeur.
- Icône avant le libellé : `<Plus data-icon="inline-start" />`.

### Formulaires

- `Field`, `FieldLabel`, `FieldDescription`, `FieldError` de `@/components/ui/field`.
  Toujours un libellé visible ; l'aide sous le champ ; l'erreur sous le champ
  (`aria-invalid` sur le champ).
- Validation à la soumission et au blur, pas à chaque frappe. Les erreurs de l'API
  (`ApiError.field`) s'affichent sous le champ concerné, sinon en toast.
- `Enter` soumet, `Échap` ferme. Le premier champ reçoit le focus à l'ouverture.

### Dialogues

- Création/édition : `Dialog` (`sm:max-w-md` pour un formulaire, `sm:max-w-2xl` pour
  un sélecteur). Titre + description courte, pied : `Annuler` (`outline`) puis
  l'action (`default`).
- Destructif : `<ConfirmDialog tone="danger">`. Pour la suppression d'un projet,
  d'un service ou d'une base, exiger la saisie du nom (`confirmText`).
- À la réussite : fermer, toast de succès, la liste se met à jour toute seule.

### Tableaux

- Dans une carte : `rounded-xl border bg-card overflow-hidden`, tableau shadcn.
- En-tête : `text-xs font-medium text-muted-foreground`, fond `bg-secondary/40`.
- Lignes : `hover:bg-accent/40`, clic sur la ligne = ouvrir le détail quand il y en
  a un ; actions dans un `DropdownMenu` déclenché par `MoreHorizontal`.
- Barre d'outils au-dessus : `SearchInput` à gauche, filtres (`Select`) puis CTA à
  droite.

### Statuts

Toujours via `<StatusBadge>` / `<StatusDot>` (`@/components/shared/status-badge`),
alimentés par `@/lib/status.ts`. La couleur n'est jamais le seul signal : un
libellé (et souvent une icône) l'accompagne.

| Ton | Couleur | Statuts |
| --- | --- | --- |
| `success` | vert | service `online`, déploiement `active`, conteneur `running`, domaine `active`, SSL `issued`, sauvegarde `completed` |
| `info` (pulsation) | bleu | `building`, `deploying`, `queued`, `restarting`, `verifying`, `issuing_certificate`, `in_progress` |
| `warning` | jaune | domaine `pending_dns`, conteneur `paused`, SSL `pending` |
| `danger` | rouge | `crashed`, `failed`, `error`, conteneur `exited` avec code ≠ 0 |
| `neutral` | gris | `stopped`, `removed`, `cancelled`, `created`, `exited` (code 0) |

### Retours

- **Toasts** (`sonner`) : `toast.success("Projet créé")`, `toast.error(getErrorMessage(e))`.
  Un toast = une phrase courte, éventuellement une `description` et une `action`
  (« Redéployer », « Annuler »). Jamais de toast pour une simple navigation.
- **Skeletons** : reproduisent la forme du contenu final (mêmes hauteurs, mêmes
  colonnes) pour éviter tout saut de mise en page. `Skeleton` de shadcn.
- **Vide** : `<EmptyState>` avec icône, titre, phrase d'aide et action principale.
- **Erreur de chargement** : `<ErrorState>` avec bouton « Réessayer ».

## 7. Mouvement (Motion)

Import : `import { motion, AnimatePresence } from "motion/react"`. Les tokens vivent
dans `@/lib/motion.ts` — **ne pas inventer de durées ou de courbes locales**.

| Token | Valeur | Usage |
| --- | --- | --- |
| `DURATION.fast` | 0.15 s | survol, pression, sorties |
| `DURATION.base` | 0.22 s | entrées d'éléments, changements d'état |
| `DURATION.slow` | 0.35 s | panneaux, transitions de page |
| `EASE.out` | `[0.16, 1, 0.3, 1]` | toutes les entrées |
| `EASE.inOut` | `[0.65, 0, 0.35, 1]` | déplacements |
| `SPRING.snappy` | ressort raide | indicateurs partagés (`layoutId`), glisser-déposer |
| `SPRING.smooth` | ressort doux | panneaux, cartes, zoom du canvas |

Patterns obligatoires :

- **Entrée de page** : fondu + montée de 8 px (`<PageContainer>` s'en charge).
- **Listes et grilles** : `<Stagger>` / `<StaggerItem>` (décalage 40 ms, max ~12
  éléments animés). Ajout/retrait : `AnimatePresence` + `layout`.
- **Indicateur actif** (onglets, navigation) : pastille/soulignement partagé via
  `layoutId` + `SPRING.snappy`.
- **Cartes cliquables** : `whileHover={{ y: -2 }}`, `whileTap={{ scale: 0.985 }}`.
- **Panneau latéral** : glisse depuis la droite (`x: 24 → 0`, fondu), sortie plus
  rapide que l'entrée.
- **Chiffres** : `<AnimatedNumber>` pour les KPI ; **progression** : barre animée.
- **Overlays shadcn** (dialogues, menus, popovers, tooltips) : garder leurs
  animations CSS intégrées, ne pas les doubler avec Motion.

Règles :

- N'animer que `transform` et `opacity` (jamais `width`/`height`/`top`/`left`, sauf
  `layout` de Motion).
- Micro-interactions 150–250 ms ; rien au-delà de 400 ms ; sortie ≈ 65 % de l'entrée.
- Toute animation exprime une cause → effet. Les seules animations infinies
  autorisées : spinners, pulsation d'un statut « en cours », pointillés d'une
  connexion en déploiement, shimmer d'un skeleton.
- `prefers-reduced-motion` est respecté globalement (`<MotionConfig
  reducedMotion="user">` + règle CSS) : ne jamais conditionner une information à
  une animation.

## 8. Workspace (canvas)

- Fond `bg-background bg-dot-grid`, dans un cadre arrondi (`rounded-xl border`)
  séparé des bords de la fenêtre, comme sur la référence.
- **Carte de service** : 272 × 136 px (`CANVAS` dans `@/lib/constants`),
  `rounded-xl border bg-card`. Icône de marque + nom en `font-medium`, sous-titre
  (domaine principal ou image), statut en bas (`StatusDot` + libellé). Un volume
  attaché apparaît comme un **pied de carte** de 44 px collé sous la carte (icône
  disque + nom du volume), exactement comme « postgres-volume » sur la référence.
- Sélection : `ring-brand-glow`. Survol : bordure `border-strong`. Glisser :
  légère élévation (`shadow-2xl shadow-black/50`, `scale: 1.02`).
- **Connexions** : courbes de Bézier en pointillés (`stroke-dasharray: 4 4`,
  `stroke: var(--border-strong)`), flèche vers la dépendance. Quand le service
  source est en cours de déploiement, les pointillés défilent (`animate-dash-flow`)
  en `--info`.
- **Contrôles** en bas à gauche, empilés verticalement dans des boutons
  `bg-card border` : grille on/off, zoom +, zoom −, ajuster à l'écran, annuler,
  rétablir. Niveau de zoom affiché.
- Interactions : glisser le fond = déplacer la vue ; molette/pincement = zoom
  centré sur le curseur ; clic sur une carte = ouvrir le panneau du service ;
  clic droit = menu contextuel (canvas ou carte) ; flèches = déplacer la carte
  sélectionnée ; `Échap` = fermer le panneau.
- **Panneau de service** : s'ouvre à droite par-dessus le canvas (≈ 62 % de la
  largeur sur grand écran, plein écran sur mobile), `bg-card border-l`. En-tête :
  icône + nom + bouton fermer ; onglets soulignés (`UnderlineTabs`) ; contenu
  défilant.

## 9. Accessibilité et ergonomie (liste de contrôle)

- Focus visible partout (anneau shadcn) ; ordre de tabulation = ordre visuel.
- Tout est utilisable au clavier : dialogues (`Échap`), menus (flèches), onglets,
  canvas (flèches, `+`/`−`, `Suppr` avec confirmation).
- Boutons icône : `aria-label`. Champs : `label` associé. Images décoratives :
  `aria-hidden`.
- Zones mises à jour en direct (logs, statut) : `aria-live="polite"` quand c'est
  pertinent ; chargement : `aria-busy`.
- Cibles tactiles ≥ 32 px (≥ 40 px sur mobile pour les actions principales),
  espacées d'au moins 8 px.
- Actions destructives : séparées visuellement, confirmées, et annoncées par un
  toast.
- Pas de dépendance au survol : toute action visible au survol est aussi
  accessible via un menu « … » ou le focus clavier.
- Textes tronqués : valeur complète en `title`/tooltip.
- Nombres, dates, durées : formatés en `fr-FR` via `@/lib/format`.

## 10. Kit partagé

À utiliser avant d'écrire quoi que ce soit de nouveau (détail des props dans le
code de `src/components/shared/` et `src/hooks/`) :

`PageContainer`, `PageHeader`, `SectionCard`, `StatCard`, `StatusBadge`,
`StatusDot`, `ServiceIcon`, `ProjectAvatar`, `UserAvatar`, `EmptyState`,
`ErrorState`, `ConfirmDialog`, `CopyButton`, `CopyField`, `SecretValue`,
`LogViewer`, `SearchInput`, `RelativeTime`, `MetricChart`, `Sparkline`,
`ProgressBar`, `AnimatedNumber`, `UnderlineTabs`, `CodeBlock`, `TableShell`,
`FadeIn`, `Stagger`, `StaggerItem`, `ProjectSelect`, `ServiceSelect`, `Logo`.

Hooks : `useQueryParam`, `useDebouncedValue`, `useCopyToClipboard`, `useHotkey`,
`useNow`, `useIsMobile`.

## 11. Ton et glossaire

Phrases courtes, à l'infinitif pour les actions (« Créer un projet », « Redéployer »),
tutoiement/vouvoiement évités quand c'est possible, vouvoiement sinon. Pas de point
d'exclamation. Apostrophe typographique `’` dans les textes JSX (évite l'erreur ESLint
`react/no-unescaped-entities`).

| Concept | Terme dans l'interface |
| --- | --- |
| Dashboard | Dashboard |
| Projects / Project | Projets / Projet |
| Workspace (canvas) | Workspace |
| Service | Service |
| Deployment / Deploy | Déploiement / Déployer |
| Redeploy / Rollback | Redéployer / Restaurer cette version |
| Build | Build |
| Logs | Logs |
| Environment variables | Variables d’environnement |
| Shared variables | Variables partagées |
| Secret (sealed) | Secret |
| Domain / Custom domain | Domaine / Domaine personnalisé |
| Generated domain | Domaine généré |
| Database | Base de données |
| Backup / Restore | Sauvegarde / Restaurer |
| Container / Image | Conteneur / Image |
| Repository / Branch | Dépôt / Branche |
| Settings | Settings (titre de la page) · « Réglages » pour un projet ou un service |
| Danger zone | Zone de danger |
| Online / Stopped / Crashed | En ligne / Arrêté / En erreur |
| Create / Save / Cancel / Delete | Créer / Enregistrer / Annuler / Supprimer |
| Copy / Copied | Copier / Copié |
| Search / Filter | Rechercher / Filtrer |
| All projects | Tous les projets |
