/**
 * service.action: the API recorded the intent (status "stopped" or
 * "restarting"); this acts on the container and moves the status on. Every
 * status write is conditional: the user may have asked for something else since.
 */

import type { Service } from "@/generated/prisma/client";

import { recordActivity, SYSTEM_ACTOR } from "../../activity";
import { db } from "../../db";
import { enqueueDeployment } from "../../deployments/enqueue";
import {
  inspectContainer,
  isDockerError,
  listContainers,
  restartContainer,
  startContainer,
  stopContainer,
} from "../../docker";
import { publishServiceDomains, unpublishServiceDomains } from "../../domains/publish";
import { emit } from "../../events";
import { toDeploymentCommit } from "../../mappers/deployment";
import { statusEntities } from "../../services/status";
import { MAX_JOB_ATTEMPTS, type JobPayloads } from "../queue";
import { JobRetry } from "./retry";

const RUNNING_CHECKS = 10;
const RUNNING_CHECK_INTERVAL_MS = 500;
const RETRY_AFTER_MS = 5_000;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function stop(service: Service): Promise<void> {
  // By label, not only by name: a deployment may have switched containers since the request.
  const containers = await listContainers({ serviceId: service.id });
  for (const container of containers) {
    if (container.state === "running" || container.state === "restarting" || container.state === "paused") {
      await stopContainer(container.name);
    }
  }
  await unpublishServiceDomains(service.id);
  await emit(statusEntities(service.type), { projectId: service.projectId, serviceId: service.id });
}

/** The container is gone (pruned by hand, host reinstalled): only a new deployment brings the service back. */
async function redeploy(serviceId: string): Promise<void> {
  await db().$transaction(async (tx) => {
    const service = await tx.service.findUnique({ where: { id: serviceId } });
    if (!service || service.status !== "restarting") return;
    const last = await tx.deployment.findFirst({
      where: { serviceId, status: { in: ["active", "crashed", "removed"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    await enqueueDeployment(tx, {
      service,
      trigger: "redeploy",
      creator: SYSTEM_ACTOR,
      commit: last ? toDeploymentCommit(last) : null,
    });
  });
}

async function markCrashed(service: Service): Promise<void> {
  const links = { projectId: service.projectId, serviceId: service.id };
  const { count } = await db().service.updateMany({
    where: { id: service.id, status: "restarting" },
    data: { status: "crashed" },
  });
  if (count === 0) return;
  await recordActivity({
    type: "service.crashed",
    severity: "error",
    title: "Le service n’a pas démarré",
    description: service.name,
    ...links,
    notify: true,
  });
  await emit(statusEntities(service.type), links);
}

async function startOrRestart(service: Service, action: "start" | "restart", attempts: number): Promise<void> {
  // Stopped again, or a deployment took over: nothing to do any more.
  if (service.status !== "restarting") return;
  const name = service.containerName;
  try {
    const container = name === null ? null : await inspectContainer(name);
    if (name === null || container === null) {
      await redeploy(service.id);
      return;
    }
    if (action === "restart" && container.running) await restartContainer(name);
    else await startContainer(name);

    let running = false;
    for (let check = 0; check < RUNNING_CHECKS && !running; check += 1) {
      const current = await inspectContainer(name);
      if (current?.running) running = true;
      else if (!current || current.state === "exited" || current.state === "dead") break;
      else await wait(RUNNING_CHECK_INTERVAL_MS);
    }
    if (!running) {
      await markCrashed(service);
      return;
    }
  } catch (error) {
    if (isDockerError(error)) {
      console.error(`[jobs] docker ${error.action} failed for ${service.id}: ${error.stderrTail}`);
      await markCrashed(service);
      return;
    }
    // Docker itself is not reachable: try again, then give the service a truthful status.
    if (attempts >= MAX_JOB_ATTEMPTS) await markCrashed(service);
    throw new JobRetry(error instanceof Error ? error.message : "docker is not reachable", RETRY_AFTER_MS);
  }

  const links = { projectId: service.projectId, serviceId: service.id };
  const changed = await db().$transaction(async (tx) => {
    const { count } = await tx.service.updateMany({
      where: { id: service.id, status: "restarting" },
      data: {
        status: "online",
        startedAt: new Date(),
        ...(action === "restart" ? { restartCount: { increment: 1 } } : {}),
      },
    });
    if (count === 0) return false;
    if (service.activeDeploymentId !== null) {
      await tx.deployment.updateMany({
        where: { id: service.activeDeploymentId, status: "crashed" },
        data: { status: "active", error: null },
      });
    }
    await emit(["deployments", ...statusEntities(service.type)], links, tx);
    return true;
  });
  if (changed) await publishServiceDomains(service.id);
}

export async function handleServiceAction(
  payload: JobPayloads["service.action"],
  attempts: number,
): Promise<void> {
  if (typeof payload.serviceId !== "string") return;
  const service = await db().service.findUnique({ where: { id: payload.serviceId } });
  if (!service) return;
  if (payload.action === "stop") {
    try {
      await stop(service);
    } catch (error) {
      throw new JobRetry(error instanceof Error ? error.message : "docker stop failed", RETRY_AFTER_MS);
    }
    return;
  }
  if (payload.action === "start" || payload.action === "restart") {
    await startOrRestart(service, payload.action, attempts);
  }
}
