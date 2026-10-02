import type {
  GithubAccount,
  GithubBranch,
  GithubConnection,
  GithubRepo,
} from "@/lib/types";

import { hexString, seededRng } from "../generators/prng";
import type { MockDb } from "../schema";
import { OWNER_NAME, REPO, type SeedClock } from "./clock";

export const GITHUB_ACCOUNT: GithubAccount = {
  id: "gh_marcorazafy",
  login: "MarcoRazafy",
  name: OWNER_NAME,
  type: "user",
};

export const GITHUB_ORGANIZATIONS: GithubAccount[] = [
  { id: "gh_cancham_mg", login: "cancham-mg", name: "CanCham Madagascar", type: "organization" },
];

export const GITHUB_SCOPES = ["repo", "read:org", "workflow"];

const HERY = "Hery Rakotomalala";
const LALAINA = "Lalaina Andriamanana";

export interface SeedCommit {
  message: string;
  author: string;
}

/** Commits deployed by the seeded services, oldest first (the last one is HEAD of main). */
export const COMMITS: Record<keyof typeof REPO, SeedCommit[]> = {
  canchamApp: [
    { message: "feat(evenements): rappel par e-mail 48 h avant l’événement", author: OWNER_NAME },
    { message: "perf(annuaire): pagination côté serveur des entreprises", author: OWNER_NAME },
    { message: "fix(i18n): traductions manquantes du formulaire d’adhésion", author: HERY },
    { message: "feat(tableau-de-bord): indicateurs de cotisations par trimestre", author: OWNER_NAME },
    { message: "refactor(paiement): isole le client MVola dans un service dédié", author: OWNER_NAME },
    { message: "feat(factures): relance automatique des impayés", author: HERY },
    { message: "fix(factures): corrige le typage de la relance automatique", author: HERY },
    { message: "feat(evenements): ajoute la liste d’attente aux inscriptions", author: OWNER_NAME },
    { message: "fix(factures): corrige l’arrondi de la TVA sur les exports PDF", author: OWNER_NAME },
  ],
  storefront: [
    { message: "chore(deps): passe à next 15.4.6", author: OWNER_NAME },
    { message: "feat(livraison): estimation des frais pour La Réunion et la France", author: LALAINA },
    { message: "perf(images): formats AVIF et tailles adaptatives", author: OWNER_NAME },
    { message: "fix(paiement): message d’erreur quand la session MVola expire", author: LALAINA },
    { message: "style(accueil): nouvelle bannière de la récolte 2026", author: LALAINA },
    { message: "feat(produits): galerie zoomable sur les fiches vanille", author: LALAINA },
    { message: "fix(seo): balises canoniques des fiches produit", author: OWNER_NAME },
    { message: "feat(panier): conserve le panier entre deux visites", author: LALAINA },
  ],
  api: [
    { message: "test(commandes): cas limites des remises cumulées", author: OWNER_NAME },
    { message: "feat(clients): export RGPD des données personnelles", author: LALAINA },
    { message: "chore(ci): cache des dépendances pnpm", author: OWNER_NAME },
    { message: "feat(health): vérifie Redis et PostgreSQL au démarrage", author: LALAINA },
    { message: "fix(health): attend la connexion Redis avant de répondre", author: LALAINA },
    { message: "refactor(auth): jetons de rafraîchissement en base", author: OWNER_NAME },
    { message: "feat(catalogue): filtre par origine et par calibre", author: LALAINA },
    { message: "fix(stock): décrémente le stock dans la transaction", author: OWNER_NAME },
    { message: "feat(commandes): webhook de confirmation de paiement", author: OWNER_NAME },
  ],
  portfolio: [
    { message: "chore(deps): astro 5.2", author: OWNER_NAME },
    { message: "style: mode sombre par défaut", author: OWNER_NAME },
    { message: "fix(rss): dates au format RFC 822", author: OWNER_NAME },
    { message: "feat(blog): article sur l’auto-hébergement avec Docker", author: OWNER_NAME },
  ],
};

/** Hours since the last push on main of each deployed repository. */
export const LAST_PUSH_HOURS: Record<keyof typeof REPO, number> = {
  canchamApp: 5.4,
  storefront: 26.8,
  api: 17.2,
  portfolio: 252,
};

/** Deterministic commit sha: the same (repository, key) always gives the same one. */
export function seedSha(repo: string, key: string | number): string {
  return hexString(seededRng("sha", repo, key), 40);
}

interface BranchSeed {
  name: string;
  protected?: boolean;
  message: string;
  author: string;
  hoursAgo: number;
  /** Overrides the generated sha (HEAD of a deployed main branch). */
  sha?: string;
}

interface RepoSeed {
  owner: string;
  name: string;
  description: string;
  private: boolean;
  language: string | null;
  framework: string | null;
  stars: number;
  /** The first branch is the default one. */
  branches: BranchSeed[];
}

function headOf(key: keyof typeof REPO): BranchSeed {
  const commits = COMMITS[key];
  const head = commits[commits.length - 1];
  return {
    name: "main",
    protected: true,
    message: head.message,
    author: head.author,
    hoursAgo: LAST_PUSH_HOURS[key] + 0.02,
    sha: seedSha(REPO[key], commits.length - 1),
  };
}

const REPOS: RepoSeed[] = [
  {
    owner: "MarcoRazafy",
    name: "cancham-app",
    description: "Portail des membres de la CanCham : adhésions, événements et facturation.",
    private: true,
    language: "TypeScript",
    framework: "Next.js",
    stars: 0,
    branches: [
      headOf("canchamApp"),
      { name: "develop", message: "feat(membres): fusion des fiches en double", author: HERY, hoursAgo: 3.6 },
      { name: "feat/paiement-mvola", message: "feat(paiement): callback de confirmation MVola", author: OWNER_NAME, hoursAgo: 29 },
      { name: "fix/export-factures", message: "fix(factures): encodage UTF-8 des exports CSV", author: HERY, hoursAgo: 74 },
    ],
  },
  {
    owner: "MarcoRazafy",
    name: "boutique-vanille-storefront",
    description: "Vitrine e-commerce de Boutique Vanille : catalogue, panier et paiement mobile.",
    private: true,
    language: "TypeScript",
    framework: "Next.js",
    stars: 0,
    branches: [
      headOf("storefront"),
      { name: "staging", message: "feat(checkout): paiement en plusieurs fois", author: LALAINA, hoursAgo: 8.2 },
      { name: "feat/panier-persistant", message: "test(panier): scénarios de reprise de session", author: LALAINA, hoursAgo: 31 },
    ],
  },
  {
    owner: "MarcoRazafy",
    name: "boutique-vanille-api",
    description: "API de commande, de catalogue et de paiement de Boutique Vanille.",
    private: true,
    language: "TypeScript",
    framework: "NestJS",
    stars: 0,
    branches: [
      headOf("api"),
      { name: "develop", message: "feat(expeditions): suivi des colis Colissimo", author: OWNER_NAME, hoursAgo: 6.4 },
      { name: "feat/webhooks-paiement", message: "feat(paiement): signature des webhooks Orange Money", author: LALAINA, hoursAgo: 52 },
    ],
  },
  {
    owner: "MarcoRazafy",
    name: "mini-railway",
    description: "PaaS maison inspiré de Railway : déploiements, bases PostgreSQL et domaines.",
    private: false,
    language: "TypeScript",
    framework: "Next.js",
    stars: 48,
    branches: [
      { name: "main", protected: true, message: "feat(workspace): connexions animées entre les services", author: OWNER_NAME, hoursAgo: 1.4 },
      { name: "develop", message: "feat(domaines): vérification DNS en arrière-plan", author: OWNER_NAME, hoursAgo: 0.8 },
      { name: "feat/workspace-canvas", message: "feat(canvas): zoom centré sur le curseur", author: OWNER_NAME, hoursAgo: 20 },
      { name: "feat/docker-engine", message: "feat(docker): flux des logs de conteneur", author: OWNER_NAME, hoursAgo: 44 },
      { name: "fix/ssl-renouvellement", message: "fix(ssl): renouvelle les certificats 30 jours avant expiration", author: OWNER_NAME, hoursAgo: 96 },
    ],
  },
  {
    owner: "MarcoRazafy",
    name: "jirama-delestage-api",
    description: "API communautaire des horaires de délestage par quartier.",
    private: false,
    language: "Python",
    framework: "FastAPI",
    stars: 64,
    branches: [
      { name: "main", protected: true, message: "fix(horaires): fuseau Indian/Antananarivo pour les créneaux", author: OWNER_NAME, hoursAgo: 61 },
      { name: "feat/notifications-sms", message: "feat(alertes): envoi de SMS avant une coupure", author: OWNER_NAME, hoursAgo: 130 },
    ],
  },
  {
    owner: "MarcoRazafy",
    name: "taxi-be-tracker",
    description: "Suivi en temps réel des lignes de taxi-be d’Antananarivo.",
    private: false,
    language: "Python",
    framework: "Django",
    stars: 31,
    branches: [
      { name: "main", protected: true, message: "feat(lignes): ajoute les arrêts de la ligne 119", author: OWNER_NAME, hoursAgo: 212 },
      { name: "develop", message: "refactor(carte): tuiles vectorielles hors ligne", author: OWNER_NAME, hoursAgo: 190 },
    ],
  },
  {
    owner: "MarcoRazafy",
    name: "portfolio",
    description: "Site personnel et blog technique.",
    private: false,
    language: "Astro",
    framework: "Astro",
    stars: 12,
    branches: [
      headOf("portfolio"),
      { name: "redesign-2026", message: "style(accueil): nouvelle grille de projets", author: OWNER_NAME, hoursAgo: 340 },
    ],
  },
  {
    owner: "MarcoRazafy",
    name: "facturation-pdf",
    description: "Générateur de factures PDF avec les mentions légales malgaches (NIF, STAT).",
    private: false,
    language: "Go",
    framework: null,
    stars: 7,
    branches: [
      { name: "main", protected: true, message: "fix(pdf): césure des libellés longs", author: OWNER_NAME, hoursAgo: 410 },
      { name: "v2", message: "feat(modeles): gabarit de facture d’avoir", author: OWNER_NAME, hoursAgo: 388 },
    ],
  },
  {
    owner: "cancham-mg",
    name: "site-vitrine",
    description: "Site institutionnel de la Chambre de commerce Canada–Madagascar.",
    private: false,
    language: "Astro",
    framework: "Astro",
    stars: 3,
    branches: [
      { name: "main", protected: true, message: "content(actualites): compte rendu du gala annuel", author: HERY, hoursAgo: 49 },
      { name: "preprod", message: "feat(adhesion): formulaire de demande en ligne", author: HERY, hoursAgo: 27 },
    ],
  },
  {
    owner: "cancham-mg",
    name: "annuaire-membres",
    description: "Annuaire public des entreprises membres.",
    private: true,
    language: "PHP",
    framework: "Laravel",
    stars: 0,
    branches: [
      { name: "main", protected: true, message: "fix(recherche): accents ignorés dans les noms d’entreprise", author: HERY, hoursAgo: 118 },
      { name: "develop", message: "feat(fiches): logo et réseaux sociaux des membres", author: HERY, hoursAgo: 92 },
      { name: "feat/recherche-avancee", message: "feat(recherche): filtres par secteur et par ville", author: OWNER_NAME, hoursAgo: 150 },
    ],
  },
  {
    owner: "cancham-mg",
    name: "evenements-api",
    description: "API des événements et des inscriptions de la chambre.",
    private: true,
    language: "TypeScript",
    framework: "NestJS",
    stars: 0,
    branches: [
      { name: "main", protected: true, message: "feat(inscriptions): quota par entreprise membre", author: OWNER_NAME, hoursAgo: 77 },
      { name: "develop", message: "chore(deps): met à jour prisma 6.3", author: HERY, hoursAgo: 55 },
    ],
  },
  {
    owner: "cancham-mg",
    name: "newsletter-service",
    description: "Service d’envoi de la lettre d’information mensuelle.",
    private: true,
    language: "Go",
    framework: null,
    stars: 0,
    branches: [
      { name: "main", protected: true, message: "fix(envoi): reprise après une limite de débit SMTP", author: OWNER_NAME, hoursAgo: 290 },
      { name: "feat/modeles-mjml", message: "feat(modeles): gabarits MJML responsives", author: HERY, hoursAgo: 270 },
    ],
  },
];

export function connectedGithub(connectedAt: string): GithubConnection {
  return {
    connected: true,
    account: { ...GITHUB_ACCOUNT },
    organizations: GITHUB_ORGANIZATIONS.map((organization) => ({ ...organization })),
    scopes: [...GITHUB_SCOPES],
    connectedAt,
  };
}

export function seedGithub(clock: SeedClock): MockDb["github"] {
  const repos: GithubRepo[] = [];
  const branches: Record<string, GithubBranch[]> = {};

  for (const repo of REPOS) {
    const fullName = `${repo.owner}/${repo.name}`;
    branches[fullName] = repo.branches.map((branch, index) => ({
      name: branch.name,
      isDefault: index === 0,
      protected: branch.protected ?? false,
      lastCommit: {
        sha: branch.sha ?? seedSha(fullName, branch.name),
        message: branch.message,
        author: branch.author,
        date: clock.hoursAgo(branch.hoursAgo),
      },
    }));
    repos.push({
      id: `repo_${repo.owner}_${repo.name}`.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      owner: repo.owner,
      name: repo.name,
      fullName,
      description: repo.description,
      private: repo.private,
      language: repo.language,
      framework: repo.framework,
      defaultBranch: repo.branches[0].name,
      stars: repo.stars,
      pushedAt: clock.hoursAgo(Math.min(...repo.branches.map((branch) => branch.hoursAgo))),
    });
  }

  return { connection: connectedGithub(clock.daysAgo(120)), repos, branches };
}
