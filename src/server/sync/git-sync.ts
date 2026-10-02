/**
 * Automatic deployments of GitHub services: the worker compares the tip of
 * each tracked branch with the last commit seen (service.lastCommitSha) every
 * minute, and the webhook route does the same as soon as GitHub reports a push.
 *
 * lastCommitSha moves when the deployment is queued, not when it succeeds: a
 * commit that fails to build is not queued again and again.
 */

import type { Service } from "@/generated/prisma/client";
import type { DeploymentCommit } from "@/lib/types";

import { SYSTEM_ACTOR } from "../activity";
import { db } from "../db";
import { enqueueDeployment } from "../deployments/enqueue";
import { IN_FLIGHT_STATUSES } from "../deployments/status";
import { resolveBranchTip } from "../git/repository";

export const GIT_SYNC_INTERVAL_MS = 60_000;
const CONCURRENCY = 3;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export type SyncStatus = "queued" | "unchanged" | "skipped";

export interface SyncOutcome {
  serviceId: string;
  status: SyncStatus;
  /** English, for logs and the webhook answer. */
  reason?: string;
  sha?: string;
  deploymentId?: string;
}

/** What a signed push event already tells about the new tip: saves a round trip to the remote. */
export interface KnownTip {
  sha: string;
  message?: string;
  author?: string;
}

function eligibility(service: Service): string | null {
  if (service.type !== "github" || service.repo === null || service.branch === null) return "not a GitHub service";
  if (!service.autoDeploy) return "automatic deployments are disabled";
  if (service.activeDeploymentId === null) return "no live deployment";
  return null;
}

async function hasInFlightDeployment(serviceId: string, client: Pick<ReturnType<typeof db>, "deployment"> = db()): Promise<boolean> {
  const count = await client.deployment.count({
    where: { serviceId, status: { in: [...IN_FLIGHT_STATUSES] } },
  });
  return count > 0;
}

/**
 * Queues a "push" deployment when the tracked branch of the service moved.
 * Rejects when the remote cannot be read (French ApiError) or the database fails.
 */
export async function checkServiceForNewCommit(serviceId: string, known?: KnownTip): Promise<SyncOutcome> {
  const service = await db().service.findUnique({ where: { id: serviceId } });
  if (!service) return { serviceId, status: "skipped", reason: "service not found" };
  const refusal = eligibility(service);
  if (refusal !== null) return { serviceId, status: "skipped", reason: refusal };
  if (await hasInFlightDeployment(serviceId)) {
    return { serviceId, status: "skipped", reason: "a deployment is in progress" };
  }
  const { repo, branch } = service;
  if (repo === null || branch === null) return { serviceId, status: "skipped", reason: "not a GitHub service" };

  const tip = known && SHA_PATTERN.test(known.sha) ? known.sha : await resolveBranchTip(repo, branch);
  if (tip === null) return { serviceId, status: "skipped", reason: `branch ${branch} not found on the remote` };

  return db().$transaction(async (tx): Promise<SyncOutcome> => {
    // Under the row lock: the loop and a webhook may look at the same push at the same time.
    await tx.$queryRaw`SELECT id FROM services WHERE id = ${serviceId} FOR UPDATE`;
    const current = await tx.service.findUnique({ where: { id: serviceId } });
    if (!current) return { serviceId, status: "skipped", reason: "service not found" };
    const changed = eligibility(current);
    if (changed !== null) return { serviceId, status: "skipped", reason: changed };
    if (current.repo !== repo || current.branch !== branch) {
      return { serviceId, status: "skipped", reason: "the source changed meanwhile" };
    }
    if (await hasInFlightDeployment(serviceId, tx)) {
      return { serviceId, status: "skipped", reason: "a deployment is in progress" };
    }

    let seen = current.lastCommitSha;
    if (seen === null && current.activeDeploymentId !== null) {
      const active = await tx.deployment.findUnique({
        where: { id: current.activeDeploymentId },
        select: { commitSha: true },
      });
      seen = active?.commitSha ?? null;
    }
    if (seen === tip) return { serviceId, status: "unchanged", sha: tip };

    await tx.service.update({ where: { id: serviceId }, data: { lastCommitSha: tip } });
    // Message and author are replaced by the pipeline once the commit is fetched.
    const commit: DeploymentCommit = {
      sha: tip,
      message: known?.message?.trim() || `Commit ${tip.slice(0, 7)}`,
      author: known?.author?.trim() ?? "",
      branch,
    };
    const deployment = await enqueueDeployment(tx, {
      service: current,
      trigger: "push",
      creator: SYSTEM_ACTOR,
      commit,
    });
    return { serviceId, status: "queued", sha: tip, deploymentId: deployment.id };
  });
}

export interface GitSyncOptions {
  signal?: AbortSignal;
  /** One line per event worth a worker log (queued deployment, failing service). */
  log?: (message: string) => void;
}

/** One pass over every service in automatic deployment. A failing service never stops the pass. */
export async function syncGitServices(options: GitSyncOptions = {}): Promise<{ checked: number; queued: number }> {
  const services = await db().service.findMany({
    where: { type: "github", autoDeploy: true, activeDeploymentId: { not: null }, repo: { not: null }, branch: { not: null } },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  let queued = 0;
  for (let start = 0; start < services.length; start += CONCURRENCY) {
    if (options.signal?.aborted) break;
    await Promise.all(
      services.slice(start, start + CONCURRENCY).map(async (service) => {
        try {
          const outcome = await checkServiceForNewCommit(service.id);
          if (outcome.status === "queued") {
            queued += 1;
            options.log?.(
              `${service.name} (${service.id}): new commit ${outcome.sha?.slice(0, 7) ?? ""}, deployment ${outcome.deploymentId ?? ""} queued`,
            );
          }
        } catch (error) {
          options.log?.(`${service.name} (${service.id}): ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
  }
  return { checked: services.length, queued };
}
