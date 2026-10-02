/**
 * Creating deployments. A deployment row in status "queued" IS the job the
 * worker picks up (oldest first, FOR UPDATE SKIP LOCKED). See ./status.ts for
 * the cancellation protocol shared with the worker.
 *
 * GitHub services: when `commit` is null the worker resolves the tip of the
 * tracked branch at build time and fills commitSha / commitMessage /
 * commitAuthor / commitBranch on the row; when it is set (redeploy, config,
 * rollback, webhook push) the worker builds exactly that commit.
 */

import type { Deployment as DeploymentRow, Service as ServiceRow } from "@/generated/prisma/client";
import type { DeploymentCommit, DeploymentTrigger } from "@/lib/types";

import { recordActivity } from "../activity";
import type { DbClient } from "../db";
import { emit } from "../events";
import { newId } from "../ids";
import { imageRepositoryFor } from "../services/names";
import { statusEntities } from "../services/status";
import { SUPERSEDED_ERROR } from "./status";

export interface EnqueueDeploymentInput {
  service: ServiceRow;
  trigger: DeploymentTrigger;
  /** Display name of whoever (or whatever) started it. */
  creator: string;
  commit?: DeploymentCommit | null;
  /** Reference to reuse (rollback); derived from the service source when omitted. */
  image?: string | null;
}

/**
 * Image a deployment of this service builds or pulls. GitHub builds are tagged
 * with the deployment id, so cleaning a service removes `imageRepositoryFor(id)`.
 */
export function imageReferenceFor(
  service: Pick<ServiceRow, "id" | "type" | "image" | "tag" | "pgVersion">,
  deploymentId: string,
): string {
  if (service.type === "docker") return `${service.image ?? ""}:${service.tag ?? "latest"}`;
  if (service.type === "postgres") return `postgres:${service.pgVersion ?? "17"}-alpine`;
  return `${imageRepositoryFor(service.id)}:${deploymentId}`;
}

/**
 * Cancels the in-flight deployments of a service: queued ones end now with
 * `queuedError`, running ones are flagged for the worker. Resolves with how
 * many deployments were touched. Status-conditional on purpose: the worker may
 * claim a queued deployment at any moment.
 */
export async function cancelInFlightDeployments(
  client: DbClient,
  serviceId: string,
  queuedError: string,
): Promise<number> {
  const queued = await client.deployment.updateMany({
    where: { serviceId, status: "queued" },
    data: { status: "cancelled", error: queuedError, finishedAt: new Date(), durationMs: 0 },
  });
  const running = await client.deployment.updateMany({
    where: { serviceId, status: { in: ["building", "deploying"] }, cancelRequested: false },
    data: { cancelRequested: true },
  });
  return queued.count + running.count;
}

/**
 * Queues a deployment of `service`. An in-flight deployment of the same
 * service is cancelled first (the newest one always wins). Sets
 * service.latestDeploymentId and service.status = "building", records the
 * activity and emits. Run it in a transaction: the lock on the service row
 * serialises concurrent deployments of the same service.
 */
export async function enqueueDeployment(
  client: DbClient,
  input: EnqueueDeploymentInput,
): Promise<DeploymentRow> {
  const { service, trigger, creator } = input;
  await client.$queryRaw`SELECT id FROM services WHERE id = ${service.id} FOR UPDATE`;

  // Running ones learn why from service.latestDeploymentId (see cancellationError).
  await cancelInFlightDeployments(client, service.id, SUPERSEDED_ERROR);

  const id = newId("dep");
  const commit = input.commit ?? null;
  const image = input.image ?? imageReferenceFor(service, id);
  const deployment = await client.deployment.create({
    data: {
      id,
      projectId: service.projectId,
      serviceId: service.id,
      status: "queued",
      trigger,
      commitSha: commit?.sha ?? null,
      commitMessage: commit?.message ?? null,
      commitAuthor: commit?.author ?? null,
      commitBranch: commit?.branch ?? null,
      image,
      creator,
      progress: 0,
      createdAt: new Date(),
    },
  });
  await client.service.update({
    where: { id: service.id },
    data: { latestDeploymentId: id, status: "building" },
  });

  const rollback = trigger === "rollback";
  const subject =
    commit?.message ??
    (service.type === "github" ? `${service.repo ?? ""}@${service.branch ?? ""}` : image);
  await recordActivity(
    {
      type: rollback ? "deployment.rolled_back" : "deployment.started",
      severity: rollback ? "warning" : "info",
      title: rollback ? "Restauration d’une version" : "Déploiement lancé",
      description: `${service.name} · ${subject}`,
      projectId: service.projectId,
      serviceId: service.id,
      deploymentId: id,
      actor: creator,
    },
    client,
  );
  await emit(
    ["deployments", ...statusEntities(service.type)],
    { projectId: service.projectId, serviceId: service.id, deploymentId: id },
    client,
  );
  return deployment;
}
