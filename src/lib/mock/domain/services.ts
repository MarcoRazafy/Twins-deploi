import type { EntityName } from "@/lib/api/contract";
import { CANVAS } from "@/lib/constants";
import type {
  ContainerHealth,
  ContainerState,
  ID,
  PlatformSettings,
  Position,
  Project,
  Service,
  ServiceConfig,
  ServiceSource,
  ServiceStatus,
  ServiceVolume,
} from "@/lib/types";

import { conflict, invalid } from "../errors";
import { newContainerId, newId } from "../ids";
import type { ContainerRecord, MockDb } from "../schema";
import { iso, sameName, slugify, uniqueName } from "../text";
import { cancelTimer, timerKey } from "../timers";

export function defaultConfig(
  settings: PlatformSettings,
  overrides: Partial<ServiceConfig> = {},
): ServiceConfig {
  return {
    port: 3000,
    builder: settings.deployments.defaultBuilder,
    buildCommand: "",
    startCommand: "",
    healthcheckPath: "",
    restartPolicy: "on-failure",
    replicas: 1,
    cpuLimit: settings.docker.defaultCpuLimit,
    memoryLimitMb: settings.docker.defaultMemoryLimitMb,
    ...overrides,
  };
}

// ─── Canvas placement ────────────────────────────────────────────────────────

const ORIGIN = 96;
const MIN_GAP = 48;
const COLUMNS = 4;

function snapUp(value: number): number {
  return Math.ceil(value / CANVAS.grid) * CANVAS.grid;
}

/**
 * First free cell of a 4-column layout aligned on the dot grid. Every card is
 * treated as if it carried a volume footer, so a volume attached later never
 * makes two cards touch.
 */
export function findFreePosition(existing: Array<Pick<Service, "position">>): Position {
  const width = CANVAS.cardWidth;
  const height = CANVAS.cardHeight + CANVAS.volumeHeight;
  const stepX = snapUp(width + MIN_GAP + 40);
  const stepY = snapUp(height + MIN_GAP + 12);

  const collides = (x: number, y: number) =>
    existing.some(
      ({ position }) =>
        x < position.x + width + MIN_GAP &&
        position.x < x + width + MIN_GAP &&
        y < position.y + height + MIN_GAP &&
        position.y < y + height + MIN_GAP,
    );

  for (let row = 0; row < 250; row += 1) {
    for (let col = 0; col < COLUMNS; col += 1) {
      const x = ORIGIN + col * stepX;
      const y = ORIGIN + row * stepY;
      if (!collides(x, y)) return { x, y };
    }
  }
  return { x: ORIGIN, y: ORIGIN + 250 * stepY };
}

function isPosition(value: Position | undefined): value is Position {
  return value !== undefined && Number.isFinite(value.x) && Number.isFinite(value.y);
}

// ─── Names ───────────────────────────────────────────────────────────────────

export function assertServiceName(
  db: MockDb,
  projectId: ID,
  name: string,
  exceptId?: ID,
): string {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 40) {
    throw invalid("Le nom du service doit contenir entre 2 et 40 caractères.", "name");
  }
  const taken = db.services.some(
    (service) =>
      service.projectId === projectId && service.id !== exceptId && sameName(service.name, trimmed),
  );
  if (taken) throw conflict("Un service porte déjà ce nom dans ce projet.", "name");
  return trimmed;
}

/** An explicit name must be free; a default one is suffixed until it is. */
export function resolveServiceName(
  db: MockDb,
  projectId: ID,
  explicit: string | undefined,
  fallback: string,
): string {
  if (explicit !== undefined && explicit.trim() !== "") {
    return assertServiceName(db, projectId, explicit);
  }
  const base = fallback.trim().slice(0, 36);
  const taken = db.services
    .filter((service) => service.projectId === projectId)
    .map((service) => service.name);
  return uniqueName(base.length >= 2 ? base : "service", taken);
}

// ─── Records ─────────────────────────────────────────────────────────────────

export function addService(
  db: MockDb,
  input: {
    project: Project;
    name: string;
    source: ServiceSource;
    config: ServiceConfig;
    volume: ServiceVolume | null;
    position?: Position;
  },
): Service {
  const now = iso();
  const siblings = db.services.filter((service) => service.projectId === input.project.id);
  const service: Service = {
    id: newId("svc"),
    projectId: input.project.id,
    name: input.name,
    source: input.source,
    status: "building",
    position: isPosition(input.position)
      ? { x: input.position.x, y: input.position.y }
      : findFreePosition(siblings),
    volume: input.volume,
    config: input.config,
    primaryDomain: null,
    activeDeploymentId: null,
    latestDeploymentId: null,
    createdAt: now,
    updatedAt: now,
  };
  db.services.unshift(service);
  input.project.updatedAt = now;
  return service;
}

export function containerOf(db: MockDb, serviceId: ID): ContainerRecord | undefined {
  return db.containers.find((container) => container.serviceId === serviceId);
}

export function containerName(project: Pick<Project, "slug">, service: Pick<Service, "name">): string {
  return `${project.slug}-${slugify(service.name)}`;
}

export function addContainer(
  db: MockDb,
  project: Project,
  service: Service,
  image: string,
): ContainerRecord {
  const usedPorts = new Set(
    db.containers.flatMap((container) => container.ports.map((port) => port.host)),
  );
  let hostPort = 32_768;
  while (usedPorts.has(hostPort)) hostPort += 1;

  const record: ContainerRecord = {
    id: newContainerId(),
    serviceId: service.id,
    projectId: service.projectId,
    name: containerName(project, service),
    image,
    state: "created",
    health: "none",
    ports: [{ host: hostPort, container: service.config.port, protocol: "tcp" }],
    cpuPercent: 0,
    memoryUsageMb: 0,
    memoryLimitMb: service.config.memoryLimitMb,
    networkRxMb: 0,
    networkTxMb: 0,
    restartCount: 0,
    exitCode: null,
    startedAt: null,
    createdAt: iso(),
    stoppedAt: null,
  };
  db.containers.unshift(record);
  return record;
}

function healthOf(service: Service, state: ContainerState): ContainerHealth {
  if (state === "restarting") return "starting";
  if (state !== "running") return "none";
  return service.source.type === "postgres" || service.config.healthcheckPath ? "healthy" : "none";
}

/** The container (re)starts with the current configuration of its service. */
export function markContainerRunning(db: MockDb, service: Service, image?: string | null): void {
  const container = containerOf(db, service.id);
  if (!container) return;
  const project = db.projects.find((item) => item.id === service.projectId);
  if (project) container.name = containerName(project, service);
  if (image) container.image = image;
  container.state = "running";
  container.health = healthOf(service, "running");
  container.exitCode = null;
  container.startedAt = iso();
  container.stoppedAt = null;
  container.memoryLimitMb = service.config.memoryLimitMb;
  container.ports = container.ports.map((port, index) =>
    index === 0 ? { ...port, container: service.config.port } : port,
  );
}

export function markContainerRestarting(db: MockDb, service: Service): void {
  const container = containerOf(db, service.id);
  if (!container) return;
  container.state = "restarting";
  container.health = healthOf(service, "restarting");
  container.exitCode = null;
}

export function markContainerExited(db: MockDb, service: Service, exitCode: number): void {
  const container = containerOf(db, service.id);
  if (!container) return;
  container.state = "exited";
  container.health = "none";
  container.exitCode = exitCode;
  container.stoppedAt = iso();
}

/** Updates the service (and the mirror kept on its database record). */
export function setServiceStatus(db: MockDb, service: Service, status: ServiceStatus): void {
  service.status = status;
  service.updatedAt = iso();
  const database = db.databases.find((item) => item.serviceId === service.id);
  if (database) database.status = status;
}

/** Collections whose queries depend on a service status. */
export function statusEntities(service: Service): EntityName[] {
  const entities: EntityName[] = ["services", "containers", "projects", "metrics"];
  if (service.source.type === "postgres") entities.push("databases");
  return entities;
}

/** Framework of the repository behind a GitHub service (its language when unknown). */
export function stackHint(db: MockDb, service: Service): string | null {
  const source = service.source;
  if (source.type !== "github") return null;
  const repo = db.github.repos.find((item) => item.fullName === source.repo);
  return repo?.framework ?? repo?.language ?? null;
}

// ─── Cascade ─────────────────────────────────────────────────────────────────

/** Removes services and everything they own. Images stay behind, unused. */
export function removeServices(db: MockDb, serviceIds: ReadonlySet<ID>): void {
  const databaseIds = new Set(
    db.databases.filter((item) => serviceIds.has(item.serviceId)).map((item) => item.id),
  );

  for (const deployment of db.deployments) {
    if (serviceIds.has(deployment.serviceId)) cancelTimer(timerKey.deployment(deployment.id));
  }
  for (const domain of db.domains) {
    if (serviceIds.has(domain.serviceId)) cancelTimer(timerKey.domain(domain.id));
  }
  for (const backup of db.backups) {
    if (databaseIds.has(backup.databaseId)) cancelTimer(timerKey.backup(backup.id));
  }
  for (const serviceId of serviceIds) {
    cancelTimer(timerKey.service(serviceId));
    delete db.pendingRestarts[serviceId];
  }

  db.services = db.services.filter((item) => !serviceIds.has(item.id));
  db.deployments = db.deployments.filter((item) => !serviceIds.has(item.serviceId));
  db.domains = db.domains.filter((item) => !serviceIds.has(item.serviceId));
  db.containers = db.containers.filter((item) => !serviceIds.has(item.serviceId));
  db.variables = db.variables.filter(
    (item) => item.serviceId === null || !serviceIds.has(item.serviceId),
  );
  db.connections = db.connections.filter(
    (item) => !serviceIds.has(item.fromServiceId) && !serviceIds.has(item.toServiceId),
  );
  db.databases = db.databases.filter((item) => !databaseIds.has(item.id));
  db.backups = db.backups.filter((item) => !databaseIds.has(item.databaseId));

  // The audit trail survives, without links to entities that no longer exist.
  for (const event of db.activity) {
    if (event.serviceId !== null && serviceIds.has(event.serviceId)) {
      event.serviceId = null;
      event.deploymentId = null;
    }
  }
}

/** Entity collections touched by `removeServices`. */
export const CASCADE_ENTITIES: EntityName[] = [
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
  "projects",
];
