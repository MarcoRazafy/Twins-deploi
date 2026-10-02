import type { Prisma, Service as ServiceRow } from "@/generated/prisma/client";
import type { Api } from "@/lib/api/contract";
import type { DeploymentCommit, DeploymentTrigger } from "@/lib/types";

import { recordActivity } from "../activity";
import { requireUser, type Context } from "../context";
import { db, type DbClient } from "../db";
import { enqueueDeployment } from "../deployments/enqueue";
import { readLogTail } from "../deployments/logs";
import {
  CANCELLED_ERROR,
  DEPLOYMENT_STATUSES,
  IN_FLIGHT_STATUSES,
  isInFlight,
} from "../deployments/status";
import { conflict, notFound, validation } from "../errors";
import { emit } from "../events";
import { toDeployment, toDeploymentCommit } from "../mappers/deployment";
import { asRecord, asString } from "../rules";
import { statusEntities } from "../services/status";

/** Safety net of `list` (retention keeps histories short anyway). */
const MAX_LIST = 1000;

/** Triggers a client may ask for; "initial" and "rollback" are internal. */
const CLIENT_TRIGGERS: readonly DeploymentTrigger[] = ["manual", "redeploy", "config", "push"];

function readTrigger(value: unknown): DeploymentTrigger {
  if (value === undefined) return "manual";
  const trigger = CLIENT_TRIGGERS.find((candidate) => candidate === value);
  if (trigger === undefined) {
    throw validation("Ce type de déploiement n’est pas disponible.", "trigger");
  }
  return trigger;
}

/**
 * Which commit a new deployment of a GitHub service builds. "redeploy" and
 * "config" rebuild the commit that is already live; "manual" and "push" leave it
 * to the worker, which builds the tip of the tracked branch and records it.
 */
async function resolveCommit(
  client: DbClient,
  service: ServiceRow,
  trigger: DeploymentTrigger,
): Promise<DeploymentCommit | null> {
  if (service.type !== "github" || (trigger !== "redeploy" && trigger !== "config")) return null;
  const currentId = service.activeDeploymentId ?? service.latestDeploymentId;
  if (currentId === null) return null;
  const current = await client.deployment.findUnique({ where: { id: currentId } });
  return current ? toDeploymentCommit(current) : null;
}

export function createDeploymentsApi(ctx: Context): Api["deployments"] {
  const actor = (): string => requireUser(ctx).name;

  return {
    async list(rawFilter) {
      const filter = asRecord(rawFilter);
      const where: Prisma.DeploymentWhereInput = {};
      if (typeof filter.projectId === "string") where.projectId = filter.projectId;
      if (typeof filter.serviceId === "string") where.serviceId = filter.serviceId;
      const requested = filter.statuses;
      if (Array.isArray(requested) && requested.length > 0) {
        // Unknown statuses match nothing, like in the simulator.
        where.status = { in: DEPLOYMENT_STATUSES.filter((status) => requested.includes(status)) };
      }
      const limit =
        typeof filter.limit === "number" && Number.isInteger(filter.limit) && filter.limit >= 0
          ? Math.min(filter.limit, MAX_LIST)
          : MAX_LIST;
      const rows = await db().deployment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      return rows.map(toDeployment);
    },

    async get(id) {
      const row = await db().deployment.findUnique({ where: { id: asString(id) } });
      if (!row) throw notFound("Déploiement");
      return toDeployment(row);
    },

    async trigger(serviceId, rawOptions) {
      const author = actor();
      const trigger = readTrigger(asRecord(rawOptions).trigger);
      return db().$transaction(async (tx) => {
        const service = await tx.service.findUnique({ where: { id: asString(serviceId) } });
        if (!service) throw notFound("Service");
        const commit = await resolveCommit(tx, service, trigger);
        const row = await enqueueDeployment(tx, { service, trigger, creator: author, commit });
        return toDeployment(row);
      });
    },

    async rollback(deploymentId) {
      const author = actor();
      return db().$transaction(async (tx) => {
        const target = await tx.deployment.findUnique({
          where: { id: asString(deploymentId) },
          include: { service: true },
        });
        if (!target) throw notFound("Déploiement");
        if (target.status !== "removed") {
          throw conflict("Seule une ancienne version déployée avec succès peut être restaurée.");
        }
        const row = await enqueueDeployment(tx, {
          service: target.service,
          trigger: "rollback",
          creator: author,
          commit: toDeploymentCommit(target),
          image: target.image,
        });
        return toDeployment(row);
      });
    },

    async cancel(deploymentId) {
      const author = actor();
      return db().$transaction(async (tx) => {
        const deployment = await tx.deployment.findUnique({
          where: { id: asString(deploymentId) },
          include: { service: true },
        });
        if (!deployment) throw notFound("Déploiement");
        if (!isInFlight(deployment.status)) throw conflict("Ce déploiement n’est plus en cours.");
        const { service } = deployment;

        // Queued: cancelled right now. Conditional on the status, because the
        // worker may have claimed it a moment ago.
        const cancelledNow = await tx.deployment.updateMany({
          where: { id: deployment.id, status: "queued" },
          data: { status: "cancelled", error: CANCELLED_ERROR, finishedAt: new Date(), durationMs: 0 },
        });
        if (cancelledNow.count === 0) {
          // Running: the worker stops it at its next checkpoint (see deployments/status.ts).
          await tx.deployment.update({ where: { id: deployment.id }, data: { cancelRequested: true } });
        } else {
          // Nothing else in flight: the service goes back to what it was serving.
          const others = await tx.deployment.count({
            where: {
              serviceId: service.id,
              id: { not: deployment.id },
              status: { in: [...IN_FLIGHT_STATUSES] },
            },
          });
          if (others === 0 && (service.status === "building" || service.status === "deploying")) {
            await tx.service.update({
              where: { id: service.id },
              data: { status: service.activeDeploymentId !== null ? "online" : "crashed" },
            });
          }
        }

        await recordActivity(
          {
            type: "deployment.cancelled",
            severity: "warning",
            title: "Déploiement annulé",
            description: `${service.name} · ${deployment.commitMessage ?? deployment.image ?? ""}`,
            projectId: deployment.projectId,
            serviceId: deployment.serviceId,
            deploymentId: deployment.id,
            actor: author,
          },
          tx,
        );
        await emit(
          ["deployments", ...statusEntities(service.type)],
          {
            projectId: deployment.projectId,
            serviceId: deployment.serviceId,
            deploymentId: deployment.id,
          },
          tx,
        );
        const row = await tx.deployment.findUniqueOrThrow({ where: { id: deployment.id } });
        return toDeployment(row);
      });
    },

    async getLogs(deploymentId) {
      const id = asString(deploymentId);
      const exists = await db().deployment.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw notFound("Déploiement");
      return readLogTail(id);
    },

    // Served by GET /api/logs/deployments/<id> (see src/app/api/logs).
    subscribeLogs() {
      throw new Error("subscribeLogs is served over SSE, not through RPC.");
    },
  };
}
