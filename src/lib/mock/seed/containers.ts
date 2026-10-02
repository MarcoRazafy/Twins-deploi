import type { ContainerState, Deployment, Project, Service } from "@/lib/types";

import { imageId, imageSizeMb, parseReference } from "../domain/images";
import { containerName } from "../domain/services";
import { hexString, seededRng } from "../generators/prng";
import type { ContainerRecord, ImageRecord } from "../schema";
import { REPO, SVC, type SeedClock } from "./clock";
import { seedSha } from "./github";

/** When the two services that are not running went down (hours before seeding). */
const STOPPED_HOURS_AGO: Record<string, number> = {
  [SVC.boutiqueWorker]: 2.9,
  [SVC.portfolioSite]: 144,
};

export function seedContainers(
  clock: SeedClock,
  services: Service[],
  projects: Project[],
  deployments: Deployment[],
): ContainerRecord[] {
  return services.map((service, index): ContainerRecord => {
    const project = projects.find((item) => item.id === service.projectId);
    const history = deployments.filter((item) => item.serviceId === service.id);
    // The image on disk is the one of the last release that actually started.
    const release =
      history.find((item) => item.status === "active") ??
      history.find((item) => item.status === "crashed") ??
      history[history.length - 1];

    let state: ContainerState = "running";
    let exitCode: number | null = null;
    if (service.status === "crashed") {
      state = "exited";
      exitCode = 1;
    } else if (service.status === "stopped") {
      state = "exited";
      exitCode = 0;
    } else if (service.status === "building") {
      state = "created";
    }

    const healthy =
      state === "running" &&
      (service.source.type === "postgres" || service.config.healthcheckPath !== "");
    const stoppedHoursAgo = STOPPED_HOURS_AGO[service.id];

    return {
      id: hexString(seededRng("container", service.id), 12),
      serviceId: service.id,
      projectId: service.projectId,
      name: containerName(project ?? { slug: "projet" }, service),
      image: release?.image ?? "scratch",
      state,
      health: healthy ? "healthy" : "none",
      ports: [{ host: 32_768 + index, container: service.config.port, protocol: "tcp" }],
      cpuPercent: 0,
      memoryUsageMb: 0,
      memoryLimitMb: service.config.memoryLimitMb,
      networkRxMb: 0,
      networkTxMb: 0,
      restartCount: service.id === SVC.boutiqueWorker ? 5 : 0,
      exitCode,
      startedAt: state === "created" ? null : (release?.finishedAt ?? null),
      createdAt: release?.createdAt ?? service.createdAt,
      stoppedAt: stoppedHoursAgo === undefined ? null : clock.hoursAgo(stoppedHoursAgo),
    };
  });
}

/** Images referenced by the containers, plus leftovers nothing uses any more. */
export function seedImages(
  clock: SeedClock,
  containers: ContainerRecord[],
  registryHost: string,
): ImageRecord[] {
  const images = new Map<string, ImageRecord>();
  const add = (reference: string, createdAt: string) => {
    const { repository, tag } = parseReference(reference);
    const id = imageId(repository, tag);
    if (!images.has(id)) {
      images.set(id, { id, repository, tag, sizeMb: imageSizeMb(repository, tag), createdAt });
    }
  };

  for (const container of containers) add(container.image, container.createdAt);

  // Previous builds and base images left behind by older deployments.
  const canchamSha = seedSha(REPO.canchamApp, 7).slice(0, 7);
  const storefrontSha = seedSha(REPO.storefront, 6).slice(0, 7);
  add(`${registryHost}/cancham/cancham-app:${canchamSha}`, clock.hoursAgo(48.6));
  add(`${registryHost}/boutique-vanille/storefront:${storefrontSha}`, clock.hoursAgo(79.1));
  add("ghcr.io/boutique-vanille/worker:1.8.1", clock.hoursAgo(45.5));
  add("metabase/metabase:v0.49.22", clock.hoursAgo(1702));
  add("node:20-alpine", clock.hoursAgo(900));
  add("nginx:1.27-alpine", clock.hoursAgo(1300));

  return [...images.values()];
}
