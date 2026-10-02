/**
 * What a service goes back to when a deployment ends without going live
 * (failed, cancelled, interrupted). See the contract in deployments/status.ts.
 */

import { db } from "../db";
import { inspectContainer } from "../docker";
import { emit } from "../events";
import { statusEntities } from "../services/status";

type Settled = "online" | "crashed" | "stopped";

/**
 * Restores the status of a service still marked building / deploying, unless
 * another of its deployments is in flight. "online" when its live container
 * runs, "stopped" when it was stopped on purpose before the deployment,
 * "crashed" otherwise. Resolves with the status written, null when nothing changed.
 */
export async function settleServiceStatus(
  serviceId: string,
  finishedDeploymentId: string,
): Promise<Settled | null> {
  const service = await db().service.findUnique({ where: { id: serviceId } });
  if (!service || (service.status !== "building" && service.status !== "deploying")) return null;

  let target: Settled = "crashed";
  if (service.activeDeploymentId !== null && service.containerName !== null) {
    const active = await db().deployment.findUnique({
      where: { id: service.activeDeploymentId },
      select: { status: true },
    });
    target = active?.status === "active" ? "online" : "crashed";
    try {
      const container = await inspectContainer(service.containerName);
      if (!container) target = "crashed";
      else if (container.running) target = "online";
      else if (target === "online") target = "stopped";
    } catch {
      // Docker not reachable: trust the database.
    }
  }

  const written = await db().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM services WHERE id = ${serviceId} FOR UPDATE`;
    const others = await tx.deployment.count({
      where: {
        serviceId,
        id: { not: finishedDeploymentId },
        status: { in: ["queued", "building", "deploying"] },
      },
    });
    if (others > 0) return false;
    const { count } = await tx.service.updateMany({
      where: { id: serviceId, status: { in: ["building", "deploying"] } },
      data: { status: target },
    });
    if (count === 0) return false;
    await emit(statusEntities(service.type), { projectId: service.projectId, serviceId }, tx);
    return true;
  });
  return written ? target : null;
}
