/**
 * API contract of TwinsDeploi.
 *
 * The whole frontend talks to the backend exclusively through the `Api`
 * interface below (via the TanStack Query hooks in `@/lib/queries`).
 *
 * Phase 1 (now)  : `@/lib/mock` implements it in the browser (in-memory DB,
 *                  localStorage persistence, simulated latency & deployments).
 * Phase 2 (later): an HTTP implementation (fetch → Next.js route handlers →
 *                  Prisma/PostgreSQL, Docker, GitHub, NGINX, DNS) replaces the
 *                  mock in `@/lib/api/index.ts`. Nothing else has to change.
 *
 * Conventions
 * - Every method is async and resolves with plain JSON-serialisable data.
 * - Failures reject with an `ApiError` whose `message` is user-facing French.
 * - Lists are returned newest-first unless stated otherwise.
 * - Mutations emit an `ApiEvent` on `api.events` listing the entity
 *   collections that changed, so every open view can refresh itself.
 */

import type {
  ActivityEvent,
  ApiToken,
  AuthSession,
  Builder,
  CommandRun,
  Container,
  ContainerAction,
  Database,
  DatabaseBackup,
  BuiltinVariable,
  DatabaseTable,
  DatabaseTableData,
  Deployment,
  DeploymentStatus,
  DockerHubImage,
  DockerImage,
  DockerSource,
  Domain,
  EnvVariable,
  GithubBranch,
  GithubConnection,
  GithubRepo,
  GithubSource,
  ID,
  LogLine,
  MemberRole,
  MetricRange,
  PlatformOverview,
  PlatformSettings,
  Position,
  Project,
  ProjectColor,
  ProjectSummary,
  QueryResult,
  Region,
  Service,
  ServiceConfig,
  ServiceConnection,
  ServiceMetrics,
  TeamMember,
  UserProfile,
} from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export type ApiErrorCode =
  | "not_found"
  | "validation"
  | "conflict"
  | "forbidden"
  | "unavailable"
  | "unknown";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** Offending input field, when applicable (lets forms show inline errors). */
  readonly field?: string;

  constructor(code: ApiErrorCode, message: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.field = field;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** User-facing (French) message for anything that was thrown. */
export function getErrorMessage(
  error: unknown,
  fallback = "Une erreur inattendue est survenue.",
): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Realtime
// ─────────────────────────────────────────────────────────────────────────────

export type Unsubscribe = () => void;

/**
 * Entity collections. Every TanStack Query key starts with one of these
 * names, so an event can invalidate exactly the affected queries.
 */
export const ENTITIES = [
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
  "github",
  "settings",
] as const;
export type EntityName = (typeof ENTITIES)[number];

/** "Something changed" notification (mock: in-process emitter, later: SSE). */
export interface ApiEvent {
  entities: EntityName[];
  projectId?: ID;
  serviceId?: ID;
  deploymentId?: ID;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────────────

export interface SetupInput {
  name: string;
  email: string;
  /** At least 10 characters. */
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface CreateProjectInput {
  /** 2–40 chars, unique (case-insensitive). */
  name: string;
  description?: string;
  color?: ProjectColor;
  region?: Region;
}

export type UpdateProjectInput = Partial<CreateProjectInput>;

export interface UpdateServiceInput {
  /** 2–40 chars, unique within the project. */
  name?: string;
  /** Merged into the current source. The source `type` can never change. */
  source?:
    | Partial<Omit<GithubSource, "type">>
    | Partial<Omit<DockerSource, "type">>;
  config?: Partial<ServiceConfig>;
  /** Object = attach/resize the volume, null = detach it. */
  volume?: { mountPath: string; sizeGb: number } | null;
}

export interface ImportRepoInput {
  projectId: ID;
  /** "owner/name" */
  repo: string;
  branch: string;
  rootDirectory?: string;
  autoDeploy?: boolean;
  /** Defaults to the repository name. */
  name?: string;
  builder?: Builder;
  /** Canvas position; the backend picks a free spot when omitted. */
  position?: Position;
}

export interface DeployImageInput {
  projectId: ID;
  /** Image without tag ("nginx", "ghcr.io/acme/api"). */
  image: string;
  /** Defaults to "latest". */
  tag?: string;
  /** Defaults to the last path segment of the image. */
  name?: string;
  port?: number;
  variables?: Array<{ key: string; value: string }>;
  position?: Position;
}

export interface CreateDatabaseInput {
  projectId: ID;
  /** Defaults to "Postgres" (suffixed when already taken). */
  name?: string;
  /** Major version: "17" (default), "16" or "15". */
  version?: string;
  /** Volume size, defaults to 5. */
  storageGb?: number;
  publicNetworking?: boolean;
  /**
   * When set, also connects that service to the new database: creates the
   * canvas connection and a `DATABASE_URL` reference variable on the service.
   */
  connectToServiceId?: ID;
  position?: Position;
}

export interface UpdateDatabaseInput {
  publicNetworking?: boolean;
  storageLimitMb?: number;
  maxConnections?: number;
}

export interface VariableFilter {
  /** All variables of the project (shared + every service) unless narrowed. */
  projectId?: ID;
  /**
   * - string    → only that service's own variables
   * - null      → only shared (project-level) variables (requires projectId)
   * - undefined → no narrowing
   */
  serviceId?: ID | null;
}

export interface CreateVariableInput {
  projectId: ID;
  /** null = shared variable. */
  serviceId: ID | null;
  /** Must match /^[A-Za-z_][A-Za-z0-9_]*$/ and be unique within its scope. */
  key: string;
  value: string;
  isSecret?: boolean;
}

export interface UpdateVariableInput {
  key?: string;
  value?: string;
  isSecret?: boolean;
}

export interface BulkUpsertVariablesInput {
  projectId: ID;
  serviceId: ID | null;
  entries: Array<{ key: string; value: string }>;
  /** true = variables of the scope that are absent from `entries` are deleted. */
  replace?: boolean;
}

export interface CreateDomainInput {
  serviceId: ID;
  /** Fully-qualified hostname, e.g. "app.exemple.mg". */
  hostname: string;
  /** Defaults to the service port. */
  targetPort?: number;
}

export interface UpdateDomainInput {
  targetPort?: number;
  forceHttps?: boolean;
}

export interface DeploymentFilter {
  projectId?: ID;
  serviceId?: ID;
  statuses?: DeploymentStatus[];
  limit?: number;
}

export interface ActivityFilter {
  projectId?: ID;
  unreadOnly?: boolean;
  limit?: number;
}

/** Recursive partial used for settings patches. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// ─────────────────────────────────────────────────────────────────────────────
// The contract
// ─────────────────────────────────────────────────────────────────────────────

export interface Api {
  auth: {
    /** Never rejects for an anonymous visitor: the status says what to do next. */
    getSession(): Promise<AuthSession>;
    /** First run only (no account yet): creates the owner account and signs in. */
    setup(input: SetupInput): Promise<AuthSession>;
    /** Rejects with `forbidden` on wrong credentials or too many attempts. */
    login(input: LoginInput): Promise<AuthSession>;
    logout(): Promise<void>;
  };

  projects: {
    list(): Promise<ProjectSummary[]>;
    get(id: ID): Promise<ProjectSummary>;
    create(input: CreateProjectInput): Promise<Project>;
    update(id: ID, patch: UpdateProjectInput): Promise<Project>;
    /** Cascades to services, deployments, variables, domains, databases… */
    delete(id: ID): Promise<void>;
  };

  services: {
    list(filter?: { projectId?: ID }): Promise<Service[]>;
    get(id: ID): Promise<Service>;
    /**
     * Applies immediately. The running deployment is NOT rebuilt: the UI
     * offers a "Redéployer" action that calls `deployments.trigger`.
     */
    update(id: ID, patch: UpdateServiceInput): Promise<Service>;
    /** Persists canvas positions (fast path: no artificial latency). */
    updatePositions(positions: Record<ID, Position>): Promise<void>;
    /** Cascades (deployments, variables, domains, connections, database…). */
    delete(id: ID): Promise<void>;
    /** stopped|crashed → restarting → online */
    start(id: ID): Promise<Service>;
    /** → stopped (container exits with code 0) */
    stop(id: ID): Promise<Service>;
    /** → restarting → online */
    restart(id: ID): Promise<Service>;

    listConnections(projectId: ID): Promise<ServiceConnection[]>;
    /**
     * `from` consumes `to`. When `to` is a PostgreSQL service, a
     * `DATABASE_URL=${{<DbName>.DATABASE_URL}}` variable is added to `from`
     * unless it already defines DATABASE_URL.
     * Rejects: same service, different projects, duplicate edge.
     */
    connect(input: {
      fromServiceId: ID;
      toServiceId: ID;
    }): Promise<ServiceConnection>;
    disconnect(connectionId: ID): Promise<void>;
  };

  deployments: {
    list(filter?: DeploymentFilter): Promise<Deployment[]>;
    get(id: ID): Promise<Deployment>;
    /**
     * Starts a new deployment (queued → building → deploying → active).
     * An in-flight deployment of the same service is cancelled first.
     */
    trigger(
      serviceId: ID,
      options?: { trigger?: "manual" | "redeploy" | "config" | "push" },
    ): Promise<Deployment>;
    /** Redeploys the commit/image of a past successful (`removed`) deployment. */
    rollback(deploymentId: ID): Promise<Deployment>;
    /** Only valid while queued/building/deploying. */
    cancel(deploymentId: ID): Promise<Deployment>;
    /** Every build + deploy line emitted so far, oldest first. */
    getLogs(deploymentId: ID): Promise<LogLine[]>;
    /** Pushes lines emitted after the call (no replay). */
    subscribeLogs(
      deploymentId: ID,
      onLines: (lines: LogLine[]) => void,
    ): Unsubscribe;
  };

  variables: {
    list(filter?: VariableFilter): Promise<EnvVariable[]>;
    create(input: CreateVariableInput): Promise<EnvVariable>;
    update(id: ID, patch: UpdateVariableInput): Promise<EnvVariable>;
    delete(id: ID): Promise<void>;
    /** Upserts by key within the scope (used by the raw .env editor). */
    bulkUpsert(input: BulkUpsertVariablesInput): Promise<EnvVariable[]>;
    /** PORT and the TWINS_* variables the platform hands to the service's container. */
    builtins(serviceId: ID): Promise<BuiltinVariable[]>;
  };

  domains: {
    list(filter?: { projectId?: ID; serviceId?: ID }): Promise<Domain[]>;
    /** Custom domain: created in `pending_dns` with the DNS records to set. */
    create(input: CreateDomainInput): Promise<Domain>;
    /** `<service>-production-xxxx.<baseDomain>`: active immediately. */
    generate(serviceId: ID): Promise<Domain>;
    update(id: ID, patch: UpdateDomainInput): Promise<Domain>;
    /**
     * Starts a DNS check: resolves with status `verifying`, then the domain
     * moves to `issuing_certificate` → `active` (or `error`) asynchronously.
     */
    verify(id: ID): Promise<Domain>;
    delete(id: ID): Promise<void>;
  };

  github: {
    getConnection(): Promise<GithubConnection>;
    /**
     * The real backend expects a fine-grained personal access token (read
     * access to contents and metadata) and validates it against GitHub; the
     * simulator ignores it and fakes an OAuth round-trip.
     */
    connect(input?: { token?: string }): Promise<GithubConnection>;
    disconnect(): Promise<void>;
    /** Rejects with `forbidden` when GitHub is not connected. */
    listRepos(params?: { query?: string; owner?: string }): Promise<GithubRepo[]>;
    listBranches(repo: string): Promise<GithubBranch[]>;
    /** Creates a GitHub service and triggers its first deployment. */
    importRepo(input: ImportRepoInput): Promise<Service>;
  };

  docker: {
    /** Stats (CPU/memory/network) fluctuate between calls. */
    listContainers(filter?: { projectId?: ID }): Promise<Container[]>;
    /** Same effect as services.start/stop/restart on the backing service. */
    containerAction(containerId: ID, action: ContainerAction): Promise<Container>;
    /** Last runtime log lines, oldest first. */
    getContainerLogs(containerId: ID): Promise<LogLine[]>;
    /** Pushes new runtime lines while the container is running. */
    subscribeContainerLogs(
      containerId: ID,
      onLines: (lines: LogLine[]) => void,
    ): Unsubscribe;
    listImages(): Promise<DockerImage[]>;
    /** Rejects with `conflict` when a container still uses the image. */
    removeImage(id: ID): Promise<void>;
    /** Removes every unused image. */
    pruneImages(): Promise<{ removed: number; reclaimedMb: number }>;
    /** Empty query = popular images. */
    searchHub(query: string): Promise<DockerHubImage[]>;
    /** Creates a Docker service and triggers its first deployment. */
    deployImage(input: DeployImageInput): Promise<Service>;
  };

  databases: {
    list(filter?: { projectId?: ID }): Promise<Database[]>;
    get(id: ID): Promise<Database>;
    getByService(serviceId: ID): Promise<Database>;
    /** Creates the PostgreSQL service (+ volume) and its first deployment. */
    create(input: CreateDatabaseInput): Promise<Database>;
    update(id: ID, patch: UpdateDatabaseInput): Promise<Database>;
    rotatePassword(id: ID): Promise<Database>;
    listTables(id: ID): Promise<DatabaseTable[]>;
    getTableData(
      id: ID,
      table: string,
      params?: { limit?: number; offset?: number },
    ): Promise<DatabaseTableData>;
    /** Read-only SQL console (the mock understands simple SELECTs). */
    runQuery(id: ID, sql: string): Promise<QueryResult>;
    /**
     * Command console of a database: starts one shell command line inside the
     * container of an APPLICATION service of the same project (`serviceId`, by
     * default the first one linked to the database) — e.g. `npm run db:migrate`.
     * No terminal. Resolves at once; follow the command with `getCommand`.
     * One command at a time per database (`conflict` otherwise).
     */
    startCommand(id: ID, command: string, serviceId?: ID): Promise<CommandRun>;
    /** State and output so far of a command of this database (`not_found` once forgotten). */
    getCommand(id: ID, runId: ID): Promise<CommandRun>;
    listBackups(id: ID): Promise<DatabaseBackup[]>;
    /** Resolves with an `in_progress` backup that completes asynchronously. */
    createBackup(id: ID, label?: string): Promise<DatabaseBackup>;
    restoreBackup(id: ID, backupId: ID): Promise<void>;
    deleteBackup(id: ID, backupId: ID): Promise<void>;
    // Deleting a database = `services.delete(database.serviceId)`.
  };

  metrics: {
    getServiceMetrics(serviceId: ID, range: MetricRange): Promise<ServiceMetrics>;
    getOverview(): Promise<PlatformOverview>;
  };

  activity: {
    list(filter?: ActivityFilter): Promise<ActivityEvent[]>;
    markRead(ids: ID[] | "all"): Promise<void>;
  };

  settings: {
    get(): Promise<PlatformSettings>;
    update(patch: DeepPartial<PlatformSettings>): Promise<PlatformSettings>;
    getProfile(): Promise<UserProfile>;
    /** `avatarUrl: null` removes the photo. */
    updateProfile(
      patch: Partial<Pick<UserProfile, "name" | "email" | "avatarUrl">>,
    ): Promise<UserProfile>;
    listTokens(): Promise<ApiToken[]>;
    /** `secret` is returned once and never retrievable again. */
    createToken(input: {
      name: string;
      expiresInDays?: number | null;
    }): Promise<{ token: ApiToken; secret: string }>;
    revokeToken(id: ID): Promise<void>;
    listMembers(): Promise<TeamMember[]>;
    inviteMember(input: { email: string; role: MemberRole }): Promise<TeamMember>;
    updateMember(id: ID, patch: { role: MemberRole }): Promise<TeamMember>;
    removeMember(id: ID): Promise<void>;
    /** Restores the demo dataset (mock only; a real backend would reject). */
    resetDemoData(): Promise<void>;
  };

  events: {
    subscribe(listener: (event: ApiEvent) => void): Unsubscribe;
  };
}
