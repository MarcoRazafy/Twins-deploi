import type { Service } from "@/generated/prisma/client";

import type { DbClient } from "../db";
import { enqueueJob } from "../jobs/queue";
import { imageRepositoryFor, repoDirectoryFor, volumeNameFor } from "./names";

/** Relations `enqueueServiceCleanup` reads next to the row: load them with `include: CLEANUP_INCLUDE`. */
export const CLEANUP_INCLUDE = {
  domains: { select: { hostname: true } },
  database: { select: { id: true } },
} as const;

export type ServiceToClean = Service & {
  domains: Array<{ hostname: string }>;
  database: { id: string } | null;
};

/**
 * Captures what the worker needs to remove a service for good (container,
 * volume, proxy entries, images, clone, backups) and enqueues the
 * `cleanup.service` job. Call it BEFORE deleting the service row, in the same
 * transaction.
 */
export function enqueueServiceCleanup(
  client: DbClient,
  service: ServiceToClean,
  runAt?: Date,
): Promise<string> {
  const github = service.type === "github";
  return enqueueJob(
    client,
    "cleanup.service",
    {
      serviceId: service.id,
      projectId: service.projectId,
      serviceName: service.name,
      containerName: service.containerName,
      volumeName: volumeNameFor(service.id),
      hostnames: service.domains.map((domain) => domain.hostname),
      imageRepository: github ? imageRepositoryFor(service.id) : null,
      repoDir: github ? repoDirectoryFor(service.id) : null,
      databaseId: service.database?.id ?? null,
    },
    runAt,
  );
}
