/**
 * Shape of the in-browser database. Records are the public domain types,
 * plus a few private fields the simulator needs (stripped before a value
 * leaves the API).
 */

import type {
  ActivityEvent,
  ApiToken,
  Container,
  Database,
  DatabaseBackup,
  Deployment,
  DockerImage,
  Domain,
  EnvVariable,
  GithubBranch,
  GithubConnection,
  GithubRepo,
  ID,
  ISODate,
  PlatformSettings,
  Project,
  Service,
  ServiceConnection,
  TeamMember,
  UserProfile,
} from "@/lib/types";

/** Bump when the stored shape changes: older payloads are replaced by a fresh seed. */
export const DB_VERSION = 1;

export type DatasetKey = "cancham" | "boutique" | "observatoire";

export interface ContainerRecord extends Container {
  /** When the process last exited (stop or crash); anchors the runtime logs. */
  stoppedAt: ISODate | null;
}

/** `containers` is derived from the container list on every read. */
export type ImageRecord = Omit<DockerImage, "containers">;

export interface DatabaseRecord extends Database {
  /** Demo tables served by the data browser; null = empty database. */
  dataset: DatasetKey | null;
  /** Port of the public TCP proxy, kept across toggles of public networking. */
  proxyPort: number | null;
}

/** Why a service is currently `restarting` (survives a page reload). */
export interface PendingRestart {
  kind: "start" | "restart" | "restore";
  /** Set for `restore`: the backup being restored. */
  backupId?: ID;
}

export interface MockDb {
  seededAt: ISODate;
  projects: Project[];
  services: Service[];
  connections: ServiceConnection[];
  deployments: Deployment[];
  variables: EnvVariable[];
  domains: Domain[];
  containers: ContainerRecord[];
  images: ImageRecord[];
  databases: DatabaseRecord[];
  backups: DatabaseBackup[];
  activity: ActivityEvent[];
  github: {
    connection: GithubConnection;
    repos: GithubRepo[];
    /** Keyed by "owner/name". */
    branches: Record<string, GithubBranch[]>;
  };
  settings: PlatformSettings;
  profile: UserProfile;
  members: TeamMember[];
  tokens: ApiToken[];
  /** Keyed by service id. */
  pendingRestarts: Record<ID, PendingRestart>;
}

export const IN_FLIGHT_STATUSES = ["queued", "building", "deploying"] as const;

export function isInFlight(deployment: Pick<Deployment, "status">): boolean {
  return (
    deployment.status === "queued" ||
    deployment.status === "building" ||
    deployment.status === "deploying"
  );
}
