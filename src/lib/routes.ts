/**
 * Central route builders. Always link through these helpers so URLs (and the
 * query-string conventions below) stay consistent across features.
 *
 * Query-string conventions
 * - project=<projectId>  filters a platform page on one project
 * - service=<serviceId>  filters on one service (or selects it in the workspace)
 * - tab=<name>           active tab (workspace service panel, database detail)
 * - section=<name>       active settings section
 * - new=1                opens the page's primary creation dialog on arrival
 */

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === false || value === "") continue;
    params.set(key, value === true ? "1" : String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export const routes = {
  home: () => "/",
  dashboard: () => "/dashboard",

  projects: (query?: { new?: boolean }) => withQuery("/projects", query),
  /** Workspace canvas of a project, optionally with a service panel open. */
  workspace: (projectId: string, query?: { service?: string; tab?: string; new?: boolean }) =>
    withQuery(`/projects/${projectId}`, query),
  /** Sidebar entry: resolves to the last opened project's workspace. */
  workspaceIndex: () => "/workspace",
  projectSettings: (projectId: string) => `/projects/${projectId}/settings`,

  github: (query?: { project?: string; new?: boolean }) => withQuery("/github", query),
  docker: (query?: { project?: string; new?: boolean; tab?: string }) =>
    withQuery("/docker", query),

  databases: (query?: { project?: string; new?: boolean }) => withQuery("/databases", query),
  database: (databaseId: string, query?: { tab?: string }) =>
    withQuery(`/databases/${databaseId}`, query),

  variables: (query?: { project?: string; service?: string; new?: boolean }) =>
    withQuery("/variables", query),
  domains: (query?: { project?: string; service?: string; new?: boolean }) =>
    withQuery("/domains", query),

  deployments: (query?: { project?: string; service?: string; status?: string }) =>
    withQuery("/deployments", query),
  deployment: (deploymentId: string) => `/deployments/${deploymentId}`,

  /** Chat with Claude Code running on the server (real backend only). */
  claude: () => "/claude",

  /** Terminal on the server itself, for the owner (real backend only). */
  serverConsole: () => "/console",

  settings: (section?: string) => withQuery("/settings", { section }),
} as const;

/** Service panel tabs of the workspace (`?tab=`). */
export const SERVICE_TABS = [
  "deployments",
  "variables",
  "metrics",
  "logs",
  "data",
  "console",
  "connect",
  "backups",
  "settings",
] as const;
export type ServiceTab = (typeof SERVICE_TABS)[number];

/** Settings sections (`?section=`). */
export const SETTINGS_SECTIONS = [
  "general",
  "profile",
  "projects",
  "members",
  "tokens",
  "integrations",
  "infrastructure",
  "notifications",
  "console",
  "danger",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
