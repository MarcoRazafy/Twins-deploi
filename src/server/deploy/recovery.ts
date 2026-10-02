/**
 * Deployments left building / deploying by a worker that died: without a
 * recent heartbeat they are failed, what they created is removed and their
 * service gets its status back.
 */

import { recordActivity } from "../activity";
import { db } from "../db";
import { appendLogs } from "../deployments/logs";
import { isDockerAvailable, listContainers, removeContainer } from "../docker";
import { emit } from "../events";
import { statusEntities } from "../services/status";
import { INTERRUPTED_ERROR } from "./pipeline";
import { settleServiceStatus } from "./service-status";

/** Resolves with the ids of the deployments that were failed. `excludeId` is the one this worker is running. */
export async function recoverInterruptedDeployments(
  staleAfterMs: number,
  excludeId: string | null = null,
): Promise<string[]> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const rows = await db().deployment.findMany({
    where: {
      status: { in: ["building", "deploying"] },
      ...(excludeId !== null ? { id: { not: excludeId } } : {}),
      OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: cutoff } }],
    },
    include: { service: { select: { name: true, type: true, containerName: true } } },
  });

  const recovered: string[] = [];
  for (const row of rows) {
    // Its container never went live (it would be "active"): remove it when Docker can be asked.
    if ((await isDockerAvailable()).available) {
      try {
        for (const container of await listContainers({ deploymentId: row.id })) {
          if (container.name !== row.service.containerName) await removeContainer(container.name);
        }
      } catch (error) {
        console.error(`[recovery] could not remove the container of ${row.id}:`, error instanceof Error ? error.message : error);
      }
    }
    await appendLogs(row.id, [
      {
        level: "error",
        stream: row.status === "building" ? "build" : "deploy",
        message: "Deployment interrupted by a platform restart",
      },
    ]);
    const now = new Date();
    const { count } = await db().deployment.updateMany({
      where: { id: row.id, status: { in: ["building", "deploying"] } },
      data: {
        status: "failed",
        error: INTERRUPTED_ERROR,
        finishedAt: now,
        durationMs: Math.max(0, now.getTime() - (row.startedAt ?? row.createdAt).getTime()),
      },
    });
    if (count === 0) continue;
    await settleServiceStatus(row.serviceId, row.id);
    const links = { projectId: row.projectId, serviceId: row.serviceId, deploymentId: row.id };
    await recordActivity({
      type: "deployment.failed",
      severity: "error",
      title: "Échec du déploiement",
      description: `${row.service.name} · ${INTERRUPTED_ERROR}`,
      ...links,
      notify: true,
    });
    await emit(["deployments", ...statusEntities(row.service.type)], links);
    recovered.push(row.id);
  }
  return recovered;
}
