/**
 * cleanup.service / cleanup.project: what a deleted service or project leaves
 * behind in Docker, in the proxy and on disk. The rows are already gone: the
 * payload is all we know, and nothing in it is trusted to build a path or a
 * Docker name unless it matches what the platform itself would have generated.
 */

import { rm } from "node:fs/promises";
import path from "node:path";

import { backupDirectoryFor } from "../../databases/backups";
import {
  isDockerError,
  listContainers,
  listImages,
  removeContainer,
  removeImage,
  removeNetwork,
  removeVolume,
} from "../../docker";
import { env } from "../../env";
import { emit } from "../../events";
import { unpublishHost } from "../../proxy";
import { imageRepositoryFor, projectNetworkName, repoDirectoryFor, volumeNameFor } from "../../services/names";
import type { JobPayloads } from "../queue";
import { JobRetry } from "./retry";

const GENERATED_ID = /^[a-z]{2,4}_[a-z0-9]{6,40}$/;
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,200}$/;
const RETRY_AFTER_MS = 5_000;

function describe(error: unknown): string {
  return isDockerError(error) ? `docker ${error.action}: ${error.kind}` : error instanceof Error ? error.message : "error";
}

export async function handleCleanupService(payload: JobPayloads["cleanup.service"]): Promise<void> {
  const { serviceId } = payload;
  if (typeof serviceId !== "string" || !GENERATED_ID.test(serviceId)) return;
  const problems: string[] = [];

  // Containers: by label first (a build may have created one the row never knew), then by name.
  const names = new Set<string>();
  for (const container of await listContainers({ serviceId })) names.add(container.name);
  if (typeof payload.containerName === "string" && CONTAINER_NAME.test(payload.containerName)) {
    names.add(payload.containerName);
  }
  for (const name of names) {
    try {
      await removeContainer(name);
    } catch (error) {
      problems.push(`container ${name}: ${describe(error)}`);
    }
  }

  try {
    await removeVolume(volumeNameFor(serviceId));
  } catch (error) {
    problems.push(`volume: ${describe(error)}`);
  }

  if (payload.imageRepository !== null && payload.imageRepository === imageRepositoryFor(serviceId)) {
    try {
      for (const image of await listImages({ reference: payload.imageRepository })) {
        await removeImage(`${image.repository}:${image.tag}`).catch((error: unknown) => {
          if (!isDockerError(error, "not_found")) throw error;
        });
      }
    } catch (error) {
      problems.push(`images: ${describe(error)}`);
    }
  }

  for (const hostname of Array.isArray(payload.hostnames) ? payload.hostnames : []) {
    if (typeof hostname !== "string") continue;
    const result = await unpublishHost(hostname);
    if (!result.ok && result.reason === "failed") problems.push(`proxy entry ${hostname}`);
  }

  // Only the clone the platform would have created for this id, and only under the data directory.
  if (payload.repoDir !== null) {
    const expected = repoDirectoryFor(serviceId);
    const root = path.resolve(env.dataDir, "repos");
    const target = path.resolve(String(payload.repoDir));
    if (target === expected && path.dirname(target) === root) {
      await rm(target, { recursive: true, force: true });
    } else {
      console.error(`[jobs] refused to remove a repository directory outside the data directory (service ${serviceId})`);
    }
  }

  if (typeof payload.databaseId === "string" && GENERATED_ID.test(payload.databaseId)) {
    await rm(backupDirectoryFor(payload.databaseId), { recursive: true, force: true });
  }

  if (problems.length > 0) throw new JobRetry(problems.join("; "), RETRY_AFTER_MS);
  await emit(["containers", "images", "metrics"], {
    projectId: typeof payload.projectId === "string" ? payload.projectId : undefined,
  });
}

export async function handleCleanupProject(payload: JobPayloads["cleanup.project"]): Promise<void> {
  const { projectId } = payload;
  if (typeof projectId !== "string" || !GENERATED_ID.test(projectId)) return;
  try {
    await removeNetwork(projectNetworkName(projectId));
  } catch (error) {
    // Containers of the project are still attached: their cleanup jobs have not finished yet.
    throw new JobRetry(`network: ${describe(error)}`, RETRY_AFTER_MS);
  }
}
