import type { Service as ServiceRow } from "@/generated/prisma/client";
import type { Container, ContainerHealth, ContainerState } from "@/lib/types";

import { sha256Hex } from "../crypto";

/** What Docker says about the container right now; null when Docker is not reachable. */
export interface LiveContainer {
  /** "missing" when the container no longer exists. */
  state: ContainerState | "missing";
  health: ContainerHealth;
  exitCode: number | null;
  image: string;
  createdAt: Date | null;
}

export interface ContainerSample {
  cpuPercent: number;
  memoryMb: number;
  netRxKb: number;
  netTxKb: number;
}

export interface ContainerExtras {
  live: LiveContainer | null;
  /** Latest metric sample of the service, when recent enough. */
  sample: ContainerSample | null;
  /** Image and creation date of the deployment that runs, as recorded by the platform. */
  image: string;
  createdAt: Date;
}

/**
 * Public id of the container of a service: the first 12 characters of the
 * Docker id (like `docker ps`), or a stable stand-in while no id is known.
 */
export function publicContainerId(service: Pick<ServiceRow, "id" | "containerId">): string {
  const id = service.containerId ?? "";
  return /^[0-9a-f]{12}/.test(id) ? id.slice(0, 12) : sha256Hex(`container:${service.id}`).slice(0, 12);
}

/** State derived from the service status when Docker cannot be asked. */
function derivedState(service: ServiceRow): ContainerState {
  if (service.status === "online") return "running";
  if (service.status === "restarting") return "restarting";
  if (service.status === "stopped" || service.status === "crashed") return "exited";
  // building / deploying: the previous version keeps serving when there is one.
  return service.activeDeploymentId !== null ? "running" : "created";
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function toContainer(service: ServiceRow, extras: ContainerExtras): Container {
  const { live, sample } = extras;
  const state: ContainerState =
    live === null ? derivedState(service) : live.state === "missing" ? "exited" : live.state;
  const running = state === "running";
  // Images without a HEALTHCHECK report nothing: the platform's own check passed when the service went online.
  const health: ContainerHealth =
    live && live.health !== "none" ? live.health : running && service.status === "online" ? "healthy" : "none";
  const stats = running ? sample : null;
  return {
    id: publicContainerId(service),
    serviceId: service.id,
    projectId: service.projectId,
    name: service.containerName ?? service.slug,
    image: live && live.image !== "" ? live.image : extras.image,
    state,
    health,
    ports:
      running && service.hostPort !== null
        ? [{ host: service.hostPort, container: service.port, protocol: "tcp" }]
        : [],
    cpuPercent: stats ? round(stats.cpuPercent, 2) : 0,
    memoryUsageMb: stats ? Math.round(stats.memoryMb) : 0,
    memoryLimitMb: service.memoryLimitMb,
    networkRxMb: stats ? round(stats.netRxKb / 1024, 2) : 0,
    networkTxMb: stats ? round(stats.netTxKb / 1024, 2) : 0,
    restartCount: service.restartCount,
    exitCode: state === "exited" ? (live?.exitCode ?? null) : null,
    startedAt: running ? (service.startedAt?.toISOString() ?? null) : null,
    createdAt: (live?.createdAt ?? extras.createdAt).toISOString(),
  };
}
