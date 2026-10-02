import type {
  Service as ServiceRow,
  ServiceConnection as ConnectionRow,
} from "@/generated/prisma/client";
import type {
  Builder,
  RestartPolicy,
  Service,
  ServiceConfig,
  ServiceConnection,
  ServiceSource,
  ServiceVolume,
} from "@/lib/types";

function toBuilder(value: string): Builder {
  return value === "dockerfile" ? "dockerfile" : "nixpacks";
}

function toRestartPolicy(value: string): RestartPolicy {
  return value === "always" || value === "never" ? value : "on-failure";
}

export function toServiceConfig(row: ServiceRow): ServiceConfig {
  return {
    port: row.port,
    builder: toBuilder(row.builder),
    buildCommand: row.buildCommand,
    startCommand: row.startCommand,
    healthcheckPath: row.healthcheckPath,
    restartPolicy: toRestartPolicy(row.restartPolicy),
    replicas: row.replicas,
    cpuLimit: row.cpuLimit,
    memoryLimitMb: row.memoryLimitMb,
  };
}

/** The union is built from the columns that belong to the service type. */
export function toServiceSource(row: ServiceRow): ServiceSource {
  switch (row.type) {
    case "github":
      return {
        type: "github",
        repo: row.repo ?? "",
        branch: row.branch ?? "",
        rootDirectory: row.rootDirectory,
        autoDeploy: row.autoDeploy,
      };
    case "docker":
      return { type: "docker", image: row.image ?? "", tag: row.tag ?? "latest" };
    case "postgres":
      return { type: "postgres", version: row.pgVersion ?? "" };
  }
}

/** Disk usage is not measured yet: usedGb is always 0. */
export function toServiceVolume(row: ServiceRow): ServiceVolume | null {
  if (row.volumeName === null) return null;
  return {
    name: row.volumeName,
    mountPath: row.volumeMountPath ?? "",
    sizeGb: row.volumeSizeGb ?? 0,
    usedGb: 0,
  };
}

export function toService(row: ServiceRow): Service {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    source: toServiceSource(row),
    status: row.status,
    position: { x: row.positionX, y: row.positionY },
    volume: toServiceVolume(row),
    config: toServiceConfig(row),
    primaryDomain: row.primaryDomain,
    activeDeploymentId: row.activeDeploymentId,
    latestDeploymentId: row.latestDeploymentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toServiceConnection(row: ConnectionRow): ServiceConnection {
  return {
    id: row.id,
    projectId: row.projectId,
    fromServiceId: row.fromServiceId,
    toServiceId: row.toServiceId,
    createdAt: row.createdAt.toISOString(),
  };
}
