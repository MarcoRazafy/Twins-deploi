import type { QueryClient } from "@tanstack/react-query";

import type {
  ActivityFilter,
  Api,
  DeploymentFilter,
  EntityName,
  VariableFilter,
} from "@/lib/api";
import type { ID, MetricRange } from "@/lib/types";

/** An id that may not be known yet: the query stays disabled until it is. */
export type MaybeId = ID | null | undefined;

export interface QueryHookOptions {
  enabled?: boolean;
}

export interface PollingQueryOptions extends QueryHookOptions {
  /** Milliseconds between two refetches, or `false` to stop polling. */
  refetchInterval?: number | false;
}

export type ServiceFilter = NonNullable<Parameters<Api["services"]["list"]>[0]>;
export type DomainFilter = NonNullable<Parameters<Api["domains"]["list"]>[0]>;
export type ContainerFilter = NonNullable<Parameters<Api["docker"]["listContainers"]>[0]>;
export type DatabaseFilter = NonNullable<Parameters<Api["databases"]["list"]>[0]>;
export type GithubReposParams = NonNullable<Parameters<Api["github"]["listRepos"]>[0]>;
export type TableDataParams = NonNullable<Parameters<Api["databases"]["getTableData"]>[2]>;
export type LogStreamKind = "deployment" | "container";

type KeyOf<Prefix extends string> = readonly [Prefix, ...unknown[]];

/** Compile-time guard: every key of a group starts with that group's entity name. */
type KeyFactories = {
  [Prefix in EntityName | "logs"]: Record<
    string,
    KeyOf<Prefix> | ((...args: never[]) => KeyOf<Prefix>)
  >;
};

/**
 * Every key starts with an entity name so an `ApiEvent` can invalidate by
 * prefix. Log streams use "logs": they are fed by subscriptions, not events.
 * Filters are always objects (`{}` when absent) so equivalent calls share a key.
 */
export const queryKeys = {
  projects: {
    all: ["projects"] as const,
    list: () => ["projects", "list"] as const,
    detail: (id: MaybeId) => ["projects", "detail", id ?? null] as const,
  },
  services: {
    all: ["services"] as const,
    lists: () => ["services", "list"] as const,
    list: (filter: ServiceFilter = {}) => ["services", "list", filter] as const,
    details: () => ["services", "detail"] as const,
    detail: (id: MaybeId) => ["services", "detail", id ?? null] as const,
  },
  connections: {
    all: ["connections"] as const,
    list: (projectId: MaybeId) => ["connections", "list", projectId ?? null] as const,
  },
  deployments: {
    all: ["deployments"] as const,
    list: (filter: DeploymentFilter = {}) => ["deployments", "list", filter] as const,
    detail: (id: MaybeId) => ["deployments", "detail", id ?? null] as const,
  },
  variables: {
    all: ["variables"] as const,
    list: (filter: VariableFilter = {}) => ["variables", "list", filter] as const,
    builtins: (serviceId: ID) => ["variables", "builtins", serviceId] as const,
  },
  domains: {
    all: ["domains"] as const,
    list: (filter: DomainFilter = {}) => ["domains", "list", filter] as const,
  },
  containers: {
    all: ["containers"] as const,
    list: (filter: ContainerFilter = {}) => ["containers", "list", filter] as const,
  },
  images: {
    all: ["images"] as const,
    list: () => ["images", "list"] as const,
    hub: (query: string) => ["images", "hub", query] as const,
  },
  databases: {
    all: ["databases"] as const,
    list: (filter: DatabaseFilter = {}) => ["databases", "list", filter] as const,
    detail: (id: MaybeId) => ["databases", "detail", id ?? null] as const,
    byService: (serviceId: MaybeId) => ["databases", "by-service", serviceId ?? null] as const,
    tables: (id: MaybeId) => ["databases", "tables", id ?? null] as const,
    tableData: (id: MaybeId, table: string | null | undefined, params: TableDataParams = {}) =>
      ["databases", "table-data", id ?? null, table ?? null, params] as const,
  },
  backups: {
    all: ["backups"] as const,
    list: (databaseId: MaybeId) => ["backups", "list", databaseId ?? null] as const,
  },
  metrics: {
    all: ["metrics"] as const,
    service: (serviceId: MaybeId, range: MetricRange) =>
      ["metrics", "service", serviceId ?? null, range] as const,
    overview: () => ["metrics", "overview"] as const,
  },
  activity: {
    all: ["activity"] as const,
    lists: () => ["activity", "list"] as const,
    list: (filter: ActivityFilter = {}) => ["activity", "list", filter] as const,
  },
  github: {
    all: ["github"] as const,
    connection: () => ["github", "connection"] as const,
    repos: (params: GithubReposParams = {}) => ["github", "repos", params] as const,
    branches: (repo: string | null | undefined) => ["github", "branches", repo ?? null] as const,
  },
  settings: {
    all: ["settings"] as const,
    platform: () => ["settings", "platform"] as const,
    profile: () => ["settings", "profile"] as const,
    tokens: () => ["settings", "tokens"] as const,
    members: () => ["settings", "members"] as const,
    serverConsole: () => ["settings", "server-console"] as const,
  },
  logs: {
    all: ["logs"] as const,
    stream: (kind: LogStreamKind, id: MaybeId) => ["logs", kind, id ?? null] as const,
  },
} as const satisfies KeyFactories;

/** Everything that mirrors the lifecycle of a service: status, container, database, counters. */
export const SERVICE_STATE_ENTITIES = [
  "services",
  "containers",
  "projects",
  "databases",
  "metrics",
  "activity",
] as const satisfies readonly EntityName[];

/** A deployment moves the status of its service. */
export const DEPLOYMENT_ENTITIES = [
  "deployments",
  ...SERVICE_STATE_ENTITIES,
] as const satisfies readonly EntityName[];

/** A service created by a repository import, an image deployment or a new database. */
export const SERVICE_CREATED_ENTITIES = [
  "services",
  "containers",
  "variables",
  "deployments",
  "projects",
  "metrics",
  "activity",
] as const satisfies readonly EntityName[];

/** Deleting a project or a service reaches every collection except GitHub and settings. */
export const CASCADE_ENTITIES = [
  "projects",
  "services",
  "connections",
  "deployments",
  "variables",
  "domains",
  "containers",
  "images",
  "databases",
  "backups",
  "metrics",
  "activity",
] as const satisfies readonly EntityName[];

/**
 * Invalidates every query of the given entities (prefix match). Active queries
 * refetch, the others are marked stale for their next mount. The promise
 * settles once the active refetches are done.
 */
export async function invalidateEntities(
  queryClient: QueryClient,
  entities: readonly EntityName[],
): Promise<void> {
  await Promise.all(
    entities.map((entity) =>
      queryClient.invalidateQueries({
        queryKey: [entity],
        predicate: (query) => !targetsDeleted(query.queryKey),
      }),
    ),
  );
}

/**
 * Ids being deleted (or already gone). A view that still shows the deleted
 * item for a moment (open panel, settings page about to navigate away) must
 * not refetch it: a real backend answers "not found" to those requests.
 */
const deletedIds = new Set<string>();

export function markDeleted(id: string): void {
  deletedIds.add(id);
}

/** The deletion failed: the item is still there and refreshes as usual. */
export function unmarkDeleted(id: string): void {
  deletedIds.delete(id);
}

function targetsDeleted(queryKey: readonly unknown[]): boolean {
  if (deletedIds.size === 0) return false;
  return queryKey.some((part) => {
    if (typeof part === "string") return deletedIds.has(part);
    if (typeof part !== "object" || part === null) return false;
    return Object.values(part).some((value) => typeof value === "string" && deletedIds.has(value));
  });
}

/**
 * Invalidation for deletions: active queries refetch (not awaited), and cached
 * queries nobody watches are dropped so a later mount shows a loading state
 * instead of the removed item.
 */
export function purgeEntities(queryClient: QueryClient, entities: readonly EntityName[]): void {
  for (const entity of entities) {
    queryClient.removeQueries({ queryKey: [entity], type: "inactive" });
  }
  void invalidateEntities(queryClient, entities);
}
