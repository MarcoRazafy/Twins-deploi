/**
 * Container monitor: reconciles what the database believes with `docker ps -a`.
 * Only services that should be running are looked at ("online"), plus crashed
 * ones that Docker's restart policy may bring back. Services that are
 * building, deploying, restarting or stopped on purpose are never touched.
 */

import type { Service } from "@/generated/prisma/client";

import { recordActivity } from "../activity";
import { db } from "../db";
import { inspectContainers, listContainers, type ContainerDetails, type ContainerSummary } from "../docker";
import { emit } from "../events";
import { statusEntities } from "../services/status";

/** A container start this much later than the one we recorded is a restart we did not make. */
const RESTART_TOLERANCE_MS = 3_000;

async function markCrashed(service: Service, error: string): Promise<void> {
  const links = { projectId: service.projectId, serviceId: service.id };
  await db().$transaction(async (tx) => {
    // Conditional on the container too: a deployment may have switched containers since we looked.
    const { count } = await tx.service.updateMany({
      where: { id: service.id, status: "online", containerName: service.containerName },
      data: { status: "crashed" },
    });
    if (count === 0) return;
    if (service.activeDeploymentId !== null) {
      await tx.deployment.updateMany({
        where: { id: service.activeDeploymentId, status: "active" },
        data: { status: "crashed", error },
      });
    }
    await recordActivity(
      {
        type: "service.crashed",
        severity: "error",
        title: "Service en panne",
        description: `${service.name} · ${error}`,
        ...links,
        deploymentId: service.activeDeploymentId,
        notify: true,
      },
      tx,
    );
    await emit(["deployments", ...statusEntities(service.type)], links, tx);
  });
}

async function markRecovered(service: Service, startedAt: Date): Promise<void> {
  const links = { projectId: service.projectId, serviceId: service.id };
  await db().$transaction(async (tx) => {
    const { count } = await tx.service.updateMany({
      where: { id: service.id, status: "crashed", containerName: service.containerName },
      data: { status: "online", startedAt, restartCount: { increment: 1 } },
    });
    if (count === 0) return;
    if (service.activeDeploymentId !== null) {
      await tx.deployment.updateMany({
        where: { id: service.activeDeploymentId, status: "crashed" },
        data: { status: "active", error: null },
      });
    }
    await recordActivity(
      {
        type: "service.restarted",
        title: "Service redémarré automatiquement",
        description: service.name,
        ...links,
        notify: true,
      },
      tx,
    );
    await emit(["deployments", ...statusEntities(service.type)], links, tx);
  });
}

async function reconcileOne(
  service: Service,
  summary: ContainerSummary | undefined,
  details: ContainerDetails | undefined,
): Promise<void> {
  const running = summary?.state === "running" && details?.running === true;

  if (service.status === "crashed") {
    if (running) await markRecovered(service, details.startedAt ?? new Date());
    return;
  }

  if (!summary) {
    await markCrashed(service, "Le conteneur du service n’existe plus.");
    return;
  }
  if (summary.state === "exited" || summary.state === "dead") {
    const code = details?.exitCode ?? summary.exitCode ?? -1;
    await markCrashed(service, `Le conteneur s’est arrêté (code de sortie ${code}).`);
    return;
  }
  // Restarted by Docker's restart policy between two looks: count it.
  if (
    running &&
    details.startedAt !== null &&
    service.startedAt !== null &&
    details.startedAt.getTime() - service.startedAt.getTime() > RESTART_TOLERANCE_MS
  ) {
    const { count } = await db().service.updateMany({
      where: { id: service.id, status: "online", containerName: service.containerName },
      data: { startedAt: details.startedAt, restartCount: { increment: 1 } },
    });
    if (count > 0) {
      await emit(statusEntities(service.type), { projectId: service.projectId, serviceId: service.id });
    }
  }
}

/** One pass. Resolves with the number of services looked at. */
export async function reconcileContainers(): Promise<number> {
  const services = await db().service.findMany({
    where: { containerName: { not: null }, status: { in: ["online", "crashed"] } },
  });
  if (services.length === 0) return 0;

  const summaries = new Map((await listContainers()).map((container) => [container.name, container]));
  const existing = services.flatMap((service) =>
    service.containerName !== null && summaries.has(service.containerName) ? [service.containerName] : [],
  );
  const details = new Map((await inspectContainers(existing)).map((container) => [container.name, container]));

  for (const service of services) {
    const name = service.containerName ?? "";
    try {
      await reconcileOne(service, summaries.get(name), details.get(name));
    } catch (error) {
      console.error(`[monitor] could not reconcile ${service.id}:`, error instanceof Error ? error.message : error);
    }
  }
  return services.length;
}
