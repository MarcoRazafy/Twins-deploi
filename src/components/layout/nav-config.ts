import {
  FolderKanban,
  FolderPlus,
  Globe,
  LayoutDashboard,
  Rocket,
  Settings,
  Variable,
  Workflow,
} from "lucide-react";

import { DockerIcon, GithubIcon, PostgresIcon } from "@/components/icons/brand-icons";
import type { IconComponent } from "@/components/shared/render-icon";
import { API_MODE } from "@/lib/api";
import { APP_NAME } from "@/lib/constants";
import { routes } from "@/lib/routes";
import type { MemberRole } from "@/lib/types";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: IconComponent;
  /** Extra search terms for the command palette (synonyms, English names). */
  keywords: string[];
  isActive: (pathname: string) => boolean;
  /** Hidden below this role (the server enforces it; this only avoids a dead link). */
  minimumRole?: MemberRole;
  /** Needs the real backend: hidden against the in-browser simulator. */
  backendOnly?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  items: readonly NavItem[];
}

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** `/projects/<id>` and deeper: the workspace of a project (not the project list). */
const PROJECT_PAGE = /^\/projects\/[^/]+/;

const dashboard: NavItem = {
  id: "dashboard",
  label: "Dashboard",
  href: routes.dashboard(),
  icon: LayoutDashboard,
  keywords: ["accueil", "home", "vue d’ensemble"],
  isActive: (pathname) => isUnder(pathname, "/dashboard"),
};

const projects: NavItem = {
  id: "projects",
  label: "Projets",
  href: routes.projects(),
  icon: FolderKanban,
  keywords: ["project", "liste des projets"],
  // Only the list itself: a single project is the "Workspace" entry.
  isActive: (pathname) => pathname === "/projects",
};

const workspace: NavItem = {
  id: "workspace",
  label: "Workspace",
  href: routes.workspaceIndex(),
  icon: Workflow,
  keywords: ["canvas", "services", "espace de travail"],
  isActive: (pathname) => isUnder(pathname, "/workspace") || PROJECT_PAGE.test(pathname),
};

const github: NavItem = {
  id: "github",
  label: "GitHub",
  href: routes.github(),
  icon: GithubIcon,
  keywords: ["git", "dépôt", "repository", "repo", "import"],
  isActive: (pathname) => isUnder(pathname, "/github"),
};

const docker: NavItem = {
  id: "docker",
  label: "Docker",
  href: routes.docker(),
  icon: DockerIcon,
  keywords: ["conteneur", "container", "image", "registry"],
  isActive: (pathname) => isUnder(pathname, "/docker"),
};

const databases: NavItem = {
  id: "databases",
  label: "PostgreSQL",
  href: routes.databases(),
  icon: PostgresIcon,
  keywords: ["postgres", "base de données", "database", "sql", "sauvegarde"],
  isActive: (pathname) => isUnder(pathname, "/databases"),
};

const variables: NavItem = {
  id: "variables",
  label: "Variables",
  href: routes.variables(),
  icon: Variable,
  keywords: ["env", "environnement", "secret", "variables d’environnement"],
  isActive: (pathname) => isUnder(pathname, "/variables"),
};

const domains: NavItem = {
  id: "domains",
  label: "Domaines",
  href: routes.domains(),
  icon: Globe,
  keywords: ["domaine", "dns", "ssl", "https", "certificat"],
  isActive: (pathname) => isUnder(pathname, "/domains"),
};

const deployments: NavItem = {
  id: "deployments",
  label: "Déploiements",
  href: routes.deployments(),
  icon: Rocket,
  keywords: ["déploiement", "deploy", "build", "logs", "historique"],
  isActive: (pathname) => isUnder(pathname, "/deployments"),
};

/** Pinned to the bottom of the sidebar, outside the groups. */
export const SETTINGS_ITEM: NavItem = {
  id: "settings",
  label: "Settings",
  href: routes.settings(),
  icon: Settings,
  keywords: ["réglages", "paramètres", "profil", "jetons", "tokens", "équipe", "membres"],
  isActive: (pathname) => isUnder(pathname, "/settings"),
};

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "platform", label: "Plateforme", items: [dashboard, projects, workspace] },
  { id: "resources", label: "Ressources", items: [github, docker, databases] },
  { id: "configuration", label: "Configuration", items: [variables, domains] },
  { id: "activity", label: "Activité", items: [deployments] },
];

/** Every page, in sidebar order. */
export const NAV_ITEMS: readonly NavItem[] = [
  ...NAV_GROUPS.flatMap((group) => group.items),
  SETTINGS_ITEM,
];

const ROLE_RANK: Record<MemberRole, number> = { viewer: 0, developer: 1, admin: 2, owner: 3 };

/** Whether the entry is shown to a member with `role` (null while the session loads). */
export function isNavItemVisible(item: NavItem, role: MemberRole | null): boolean {
  if (item.backendOnly && API_MODE !== "http") return false;
  if (item.minimumRole === undefined) return true;
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[item.minimumRole];
}

export interface QuickCreateAction {
  id: string;
  label: string;
  href: string;
  icon: IconComponent;
  keywords: string[];
}

/** Shared by the "Nouveau" menu of the top bar and the command palette. */
export const QUICK_CREATE_ACTIONS: readonly QuickCreateAction[] = [
  {
    id: "new-project",
    label: "Nouveau projet",
    href: routes.projects({ new: true }),
    icon: FolderPlus,
    keywords: ["créer", "projet", "create", "project"],
  },
  {
    id: "import-github",
    label: "Importer un dépôt GitHub",
    href: routes.github({ new: true }),
    icon: GithubIcon,
    keywords: ["créer", "dépôt", "repository", "repo", "git", "import"],
  },
  {
    id: "deploy-docker",
    label: "Déployer une image Docker",
    href: routes.docker({ new: true }),
    icon: DockerIcon,
    keywords: ["créer", "conteneur", "container", "image", "deploy"],
  },
  {
    id: "create-database",
    label: "Créer une base PostgreSQL",
    href: routes.databases({ new: true }),
    icon: PostgresIcon,
    keywords: ["créer", "postgres", "base de données", "database", "sql"],
  },
  {
    id: "add-domain",
    label: "Ajouter un domaine",
    href: routes.domains({ new: true }),
    icon: Globe,
    keywords: ["créer", "domaine", "domain", "dns", "ssl"],
  },
];

/** What the top bar shows for the current URL. */
export type RouteContext =
  | { kind: "page"; title: string }
  | { kind: "project"; projectId: string; page: "workspace" | "settings" }
  | {
      kind: "detail";
      entity: "database" | "deployment";
      id: string;
      parent: { label: string; href: string };
    };

export function resolveRouteContext(pathname: string): RouteContext {
  const [section, id, sub] = pathname.split("/").filter(Boolean);

  if (section === "projects" && id) {
    return { kind: "project", projectId: id, page: sub === "settings" ? "settings" : "workspace" };
  }
  if (section === "databases" && id) {
    return {
      kind: "detail",
      entity: "database",
      id,
      parent: { label: databases.label, href: databases.href },
    };
  }
  if (section === "deployments" && id) {
    return {
      kind: "detail",
      entity: "deployment",
      id,
      parent: { label: deployments.label, href: deployments.href },
    };
  }

  const item = NAV_ITEMS.find((candidate) => candidate.href === `/${section ?? ""}`);
  return { kind: "page", title: item?.label ?? APP_NAME };
}
