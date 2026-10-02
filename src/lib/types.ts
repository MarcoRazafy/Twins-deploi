/**
 * Domain model of Mini Railway.
 *
 * These types are the single source of truth shared by the UI, the query hooks
 * and the API layer. They are deliberately serialisable (no Date objects, no
 * class instances) so the same shapes can cross an HTTP boundary once the real
 * backend (Next.js route handlers + Prisma/PostgreSQL) replaces the mock.
 */

/** ISO-8601 timestamp (UTC), e.g. "2026-10-01T20:19:57.000Z". */
export type ISODate = string;
export type ID = string;

export interface Position {
  x: number;
  y: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Projects
// ─────────────────────────────────────────────────────────────────────────────

export const PROJECT_COLORS = [
  "purple",
  "blue",
  "green",
  "amber",
  "pink",
  "cyan",
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

/** One server, one region: the machine in Analamanga, Madagascar. */
export const REGIONS = ["mg-analamanga"] as const;
export type Region = (typeof REGIONS)[number];

export interface Project {
  id: ID;
  name: string;
  /** URL-safe unique identifier derived from the name. */
  slug: string;
  description: string;
  color: ProjectColor;
  /** Single environment in v1; kept as a field so multi-env can land later. */
  environment: string;
  region: Region;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Compact service info embedded in project summaries (cards, switchers). */
export interface ServicePreview {
  id: ID;
  name: string;
  type: ServiceType;
  status: ServiceStatus;
}

export interface ProjectStats {
  services: number;
  databases: number;
  online: number;
  inProgress: number;
  crashed: number;
  stopped: number;
  domains: number;
  variables: number;
  deployments: number;
}

/** What list/detail endpoints return: the project plus denormalised stats. */
export interface ProjectSummary extends Project {
  stats: ProjectStats;
  services: ServicePreview[];
  lastDeployment: Pick<
    Deployment,
    "id" | "serviceId" | "status" | "createdAt"
  > | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Services
// ─────────────────────────────────────────────────────────────────────────────

export type ServiceType = "github" | "docker" | "postgres";

/**
 * Runtime status of a service as shown on workspace cards.
 * - building/deploying mirror the in-flight deployment
 * - restarting is a transient state after start/restart actions
 */
export type ServiceStatus =
  | "online"
  | "building"
  | "deploying"
  | "restarting"
  | "crashed"
  | "stopped";

export interface GithubSource {
  type: "github";
  /** "owner/name" */
  repo: string;
  branch: string;
  /** "/" when the app lives at the repo root. */
  rootDirectory: string;
  /** Redeploy automatically on push to `branch`. */
  autoDeploy: boolean;
}

export interface DockerSource {
  type: "docker";
  /** Image without tag, e.g. "redis" or "ghcr.io/acme/worker". */
  image: string;
  tag: string;
}

export interface PostgresSource {
  type: "postgres";
  /** Major version, e.g. "17". */
  version: string;
}

export type ServiceSource = GithubSource | DockerSource | PostgresSource;

export interface ServiceVolume {
  name: string;
  mountPath: string;
  sizeGb: number;
  usedGb: number;
}

export type RestartPolicy = "always" | "on-failure" | "never";
export type Builder = "nixpacks" | "dockerfile";

export interface ServiceConfig {
  /** Port the container listens on. */
  port: number;
  /** Only meaningful for GitHub services. */
  builder: Builder;
  /** Empty string = auto-detected. */
  buildCommand: string;
  /** Empty string = auto-detected / image default. */
  startCommand: string;
  /** Empty string = healthcheck disabled. */
  healthcheckPath: string;
  restartPolicy: RestartPolicy;
  replicas: number;
  /** vCPU */
  cpuLimit: number;
  memoryLimitMb: number;
}

export interface Service {
  id: ID;
  projectId: ID;
  name: string;
  /** Discriminated union — `service.source.type` is the service type. */
  source: ServiceSource;
  status: ServiceStatus;
  /** Top-left corner of the card on the workspace canvas (canvas units). */
  position: Position;
  volume: ServiceVolume | null;
  config: ServiceConfig;
  /** Denormalised primary public hostname (null when not exposed). */
  primaryDomain: string | null;
  /** Deployment currently serving traffic. */
  activeDeploymentId: ID | null;
  /** Most recent deployment regardless of status. */
  latestDeploymentId: ID | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/**
 * Directed edge on the workspace canvas: `from` consumes `to`
 * (e.g. an app → its PostgreSQL database).
 */
export interface ServiceConnection {
  id: ID;
  projectId: ID;
  fromServiceId: ID;
  toServiceId: ID;
  createdAt: ISODate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deployments & logs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * - queued → building → deploying → active   (happy path)
 * - failed: build or deploy step failed
 * - crashed: was active, then the process exited
 * - cancelled: aborted by a user while in flight
 * - removed: superseded by a newer successful deployment (can be rolled back to)
 */
export type DeploymentStatus =
  | "queued"
  | "building"
  | "deploying"
  | "active"
  | "failed"
  | "crashed"
  | "cancelled"
  | "removed";

export type DeploymentTrigger =
  | "initial"
  | "push"
  | "manual"
  | "redeploy"
  | "rollback"
  | "config";

export interface DeploymentCommit {
  sha: string;
  message: string;
  author: string;
  branch: string;
}

export interface Deployment {
  id: ID;
  projectId: ID;
  serviceId: ID;
  status: DeploymentStatus;
  trigger: DeploymentTrigger;
  /** Present for GitHub services. */
  commit: DeploymentCommit | null;
  /** Image reference that was (or is being) deployed. */
  image: string | null;
  /** Display name of whoever/whatever triggered it. */
  creator: string;
  /** 0–100, meaningful while queued/building/deploying; 100 once finished. */
  progress: number;
  createdAt: ISODate;
  startedAt: ISODate | null;
  finishedAt: ISODate | null;
  /** Build + deploy duration, set once finished. */
  durationMs: number | null;
  /** Human-readable reason when failed/crashed/cancelled. */
  error: string | null;
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "success";
export type LogStream = "build" | "deploy" | "runtime";

export interface LogLine {
  id: string;
  ts: ISODate;
  level: LogLevel;
  stream: LogStream;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment variables
// ─────────────────────────────────────────────────────────────────────────────

export interface EnvVariable {
  id: ID;
  projectId: ID;
  /** null = shared variable available to every service of the project. */
  serviceId: ID | null;
  key: string;
  /**
   * Raw value. May contain references such as `${{Postgres.DATABASE_URL}}`
   * or `${{shared.API_KEY}}` (resolved server-side at deploy time).
   */
  value: string;
  /** Sealed values are masked in the UI by default. */
  isSecret: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domains
// ─────────────────────────────────────────────────────────────────────────────

export type DomainKind = "generated" | "custom";

/**
 * pending_dns → verifying → issuing_certificate → active
 * `error` when DNS verification or certificate issuance failed.
 */
export type DomainStatus =
  | "pending_dns"
  | "verifying"
  | "issuing_certificate"
  | "active"
  | "error";

export type SslStatus = "none" | "pending" | "issued" | "error";

export interface DnsRecord {
  type: "CNAME" | "A" | "TXT";
  /** Host/name field to create at the DNS provider ("@", "app", "_verify.app"…). */
  name: string;
  value: string;
  ttl: number;
  verified: boolean;
}

export interface Domain {
  id: ID;
  projectId: ID;
  serviceId: ID;
  hostname: string;
  kind: DomainKind;
  status: DomainStatus;
  /** Container port NGINX proxies to. */
  targetPort: number;
  /** Records the user must create (empty for generated domains). */
  dnsRecords: DnsRecord[];
  ssl: {
    status: SslStatus;
    issuer: string | null;
    expiresAt: ISODate | null;
  };
  forceHttps: boolean;
  createdAt: ISODate;
  verifiedAt: ISODate | null;
  lastCheckedAt: ISODate | null;
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub
// ─────────────────────────────────────────────────────────────────────────────

export interface GithubAccount {
  id: ID;
  login: string;
  name: string;
  type: "user" | "organization";
}

export interface GithubConnection {
  connected: boolean;
  account: GithubAccount | null;
  organizations: GithubAccount[];
  scopes: string[];
  connectedAt: ISODate | null;
}

export interface GithubRepo {
  id: ID;
  owner: string;
  name: string;
  /** "owner/name" */
  fullName: string;
  description: string;
  private: boolean;
  /** Primary language as reported by GitHub ("TypeScript", "Python"…). */
  language: string | null;
  /** Detected framework ("Next.js", "NestJS", "Django"…). */
  framework: string | null;
  defaultBranch: string;
  stars: number;
  pushedAt: ISODate;
}

export interface GithubBranch {
  name: string;
  isDefault: boolean;
  protected: boolean;
  lastCommit: {
    sha: string;
    message: string;
    author: string;
    date: ISODate;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Docker
// ─────────────────────────────────────────────────────────────────────────────

export type ContainerState =
  | "running"
  | "restarting"
  | "paused"
  | "exited"
  | "created";

export type ContainerHealth = "healthy" | "unhealthy" | "starting" | "none";

export interface ContainerPort {
  host: number;
  container: number;
  protocol: "tcp" | "udp";
}

/** One container per service (replicas are not modelled individually in v1). */
export interface Container {
  /** 12-char hex id, like `docker ps`. */
  id: ID;
  serviceId: ID;
  projectId: ID;
  name: string;
  image: string;
  state: ContainerState;
  health: ContainerHealth;
  ports: ContainerPort[];
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  networkRxMb: number;
  networkTxMb: number;
  restartCount: number;
  exitCode: number | null;
  startedAt: ISODate | null;
  createdAt: ISODate;
}

export type ContainerAction = "start" | "stop" | "restart";

export interface DockerImage {
  id: ID;
  repository: string;
  tag: string;
  sizeMb: number;
  createdAt: ISODate;
  /** Number of containers currently using this image. */
  containers: number;
}

/** Entry of the (mock) Docker Hub catalogue used by the "deploy an image" flow. */
export interface DockerHubImage {
  name: string;
  description: string;
  official: boolean;
  /** Human formatted, e.g. "1B+". */
  pulls: string;
  stars: number;
  category: "database" | "cache" | "web" | "tool" | "runtime" | "monitoring";
  tags: string[];
  defaultTag: string;
  defaultPort: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL databases
// ─────────────────────────────────────────────────────────────────────────────

export interface Database {
  id: ID;
  /** The workspace service backing this database (1:1). */
  serviceId: ID;
  projectId: ID;
  name: string;
  engine: "postgres";
  version: string;
  /** Mirrors the backing service status. */
  status: ServiceStatus;
  /** Private network host, e.g. "postgres.railway.internal". */
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** postgresql://user:pass@host:port/db on the private network. */
  internalUrl: string;
  publicNetworking: boolean;
  /** TCP proxy URL, null when public networking is disabled. */
  publicUrl: string | null;
  storageUsedMb: number;
  storageLimitMb: number;
  connections: number;
  maxConnections: number;
  extensions: string[];
  createdAt: ISODate;
}

export interface DatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface DatabaseTable {
  schema: string;
  name: string;
  rowCount: number;
  sizeKb: number;
  columns: DatabaseColumn[];
}

export type DatabaseCell = string | number | boolean | null;
export type DatabaseRow = Record<string, DatabaseCell>;

export interface DatabaseTableData {
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  /** Total rows in the table (for pagination). */
  total: number;
}

export interface QueryResult {
  /** e.g. "SELECT", "INSERT" */
  command: string;
  columns: string[];
  rows: DatabaseRow[];
  rowCount: number;
  durationMs: number;
}

export type BackupStatus = "in_progress" | "completed" | "failed";

export interface DatabaseBackup {
  id: ID;
  databaseId: ID;
  label: string;
  type: "automatic" | "manual";
  status: BackupStatus;
  sizeMb: number;
  createdAt: ISODate;
  completedAt: ISODate | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────────────────

export const METRIC_RANGES = ["1h", "6h", "24h", "7d"] as const;
export type MetricRange = (typeof METRIC_RANGES)[number];

export interface MetricPoint {
  /** Epoch milliseconds. */
  t: number;
  v: number;
}

export interface ServiceMetrics {
  serviceId: ID;
  range: MetricRange;
  /** Percent of the CPU limit (0–100). */
  cpu: MetricPoint[];
  /** MB */
  memory: MetricPoint[];
  /** KB/s */
  networkIn: MetricPoint[];
  /** KB/s */
  networkOut: MetricPoint[];
  /** Requests per minute (apps) or queries per minute (databases). */
  requests: MetricPoint[];
  /** p95 response time in ms. */
  responseTime: MetricPoint[];
  limits: { cpu: number; memoryMb: number };
}

export interface PlatformOverview {
  projects: number;
  services: {
    total: number;
    online: number;
    inProgress: number;
    crashed: number;
    stopped: number;
  };
  databases: number;
  domains: { total: number; active: number; pending: number };
  deployments: {
    last24h: number;
    /** 0–100 over the last 7 days. */
    successRate: number;
    avgDurationMs: number;
    inProgress: number;
  };
  /** Oldest → newest, one entry per day for the last 14 days. */
  deploymentsPerDay: Array<{
    /** ISO date of the day at 00:00 local. */
    date: ISODate;
    succeeded: number;
    failed: number;
  }>;
  /** Host-level resource usage. */
  resources: {
    cpuPercent: number;
    memoryUsedMb: number;
    memoryTotalMb: number;
    diskUsedGb: number;
    diskTotalGb: number;
  };
  /** Last 24h, host-level. */
  usage: {
    cpu: MetricPoint[];
    memory: MetricPoint[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity / notifications
// ─────────────────────────────────────────────────────────────────────────────

export type ActivityType =
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "service.created"
  | "service.deleted"
  | "service.crashed"
  | "service.restarted"
  | "service.stopped"
  | "service.started"
  | "deployment.started"
  | "deployment.succeeded"
  | "deployment.failed"
  | "deployment.cancelled"
  | "deployment.rolled_back"
  | "variable.updated"
  | "domain.added"
  | "domain.verified"
  | "domain.removed"
  | "database.created"
  | "backup.completed"
  | "backup.restored"
  | "github.connected"
  | "github.disconnected"
  | "settings.updated";

export type ActivitySeverity = "info" | "success" | "warning" | "error";

export interface ActivityEvent {
  id: ID;
  type: ActivityType;
  severity: ActivitySeverity;
  /** Short French sentence, e.g. "Déploiement réussi". */
  title: string;
  /** Extra context, e.g. "cancham-app · fix: correction du formulaire". */
  description: string;
  projectId: ID | null;
  serviceId: ID | null;
  deploymentId: ID | null;
  actor: string;
  /** Doubles as the notification read flag. */
  read: boolean;
  createdAt: ISODate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform settings
// ─────────────────────────────────────────────────────────────────────────────

export type MemberRole = "owner" | "admin" | "developer" | "viewer";

export interface UserProfile {
  id: ID;
  name: string;
  email: string;
  role: MemberRole;
}

/**
 * - authenticated: `user` is set
 * - unauthenticated: sign-in required
 * - setup_required: no account exists yet, the first one becomes the owner
 */
export type AuthStatus = "authenticated" | "unauthenticated" | "setup_required";

export interface AuthSession {
  status: AuthStatus;
  user: UserProfile | null;
}

export interface TeamMember {
  id: ID;
  name: string;
  email: string;
  role: MemberRole;
  status: "active" | "invited";
  joinedAt: ISODate;
}

export interface ApiToken {
  id: ID;
  name: string;
  /** First characters of the secret, safe to display ("mr_live_a1b2…"). */
  prefix: string;
  createdAt: ISODate;
  lastUsedAt: ISODate | null;
  expiresAt: ISODate | null;
}

export interface PlatformSettings {
  workspaceName: string;
  /** Suffix of generated domains, e.g. "up.mini-railway.app". */
  baseDomain: string;
  defaultRegion: Region;
  deployments: {
    autoDeploy: boolean;
    buildTimeoutMin: number;
    /** How many past deployments are kept per service for rollbacks. */
    retention: number;
    defaultBuilder: Builder;
  };
  docker: {
    socketPath: string;
    registryUrl: string;
    defaultCpuLimit: number;
    defaultMemoryLimitMb: number;
    autoPrune: boolean;
  };
  nginx: {
    clientMaxBodySizeMb: number;
    proxyReadTimeoutSec: number;
    gzip: boolean;
    http2: boolean;
    forceHttps: boolean;
  };
  dns: {
    provider: "manual" | "cloudflare";
    /** Public IPv4 of the host, target of A records. */
    serverIp: string;
    /** Target of CNAME records for custom domains. */
    cnameTarget: string;
  };
  notifications: {
    deploySucceeded: boolean;
    deployFailed: boolean;
    serviceCrashed: boolean;
    domainIssues: boolean;
    weeklyDigest: boolean;
    email: boolean;
    inApp: boolean;
  };
}
