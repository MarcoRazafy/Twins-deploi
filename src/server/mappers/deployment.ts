import type { Deployment as DeploymentRow } from "@/generated/prisma/client";
import type { Deployment, DeploymentCommit, DeploymentTrigger } from "@/lib/types";

const TRIGGERS: readonly DeploymentTrigger[] = [
  "initial",
  "push",
  "manual",
  "redeploy",
  "rollback",
  "config",
];

/** Null until a commit is known (GitHub services only). */
export function toDeploymentCommit(
  row: Pick<DeploymentRow, "commitSha" | "commitMessage" | "commitAuthor" | "commitBranch">,
): DeploymentCommit | null {
  if (row.commitSha === null) return null;
  return {
    sha: row.commitSha,
    message: row.commitMessage ?? "",
    author: row.commitAuthor ?? "",
    branch: row.commitBranch ?? "",
  };
}

export function toDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    projectId: row.projectId,
    serviceId: row.serviceId,
    status: row.status,
    // Only written with a typed value; the fallback protects against hand-edited rows.
    trigger: TRIGGERS.find((trigger) => trigger === row.trigger) ?? "manual",
    commit: toDeploymentCommit(row),
    image: row.image,
    creator: row.creator,
    progress: row.progress,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    error: row.error,
  };
}
