/**
 * Job handlers of the worker: one per type of jobs/queue.ts. A handler
 * resolves when the job is done (also when there is nothing left to do),
 * throws JobRetry to be run again later, and anything else to fail for good.
 */

import { pruneImages } from "../../docker";
import { handleDomainCertificate } from "../../domains/publish";
import { handleDomainVerify } from "../../domains/verify";
import { emit } from "../../events";
import type { ClaimedJob, JobType } from "../queue";
import { handleBackupCreate, handleBackupRestore } from "./backup";
import { handleCleanupProject, handleCleanupService } from "./cleanup";
import { JobRetry } from "./retry";
import { handleServiceAction } from "./service-action";

export { JobRetry };

/** Jobs that need no Docker: they keep running while Docker is not reachable. */
export const DOCKER_FREE_JOB_TYPES: readonly JobType[] = ["domain.verify", "domain.certificate"];

async function handleImagePrune(): Promise<void> {
  const result = await pruneImages();
  if (result.removed > 0) await emit(["images", "metrics"]);
}

export async function runJob(job: ClaimedJob): Promise<void> {
  switch (job.type) {
    case "service.action":
      return handleServiceAction(job.payload, job.attempts);
    case "cleanup.service":
      return handleCleanupService(job.payload);
    case "cleanup.project":
      return handleCleanupProject(job.payload);
    case "domain.verify":
      return handleDomainVerify(job.payload);
    case "domain.certificate":
      return handleDomainCertificate(job.payload);
    case "backup.create":
      return handleBackupCreate(job.payload);
    case "backup.restore":
      return handleBackupRestore(job.payload);
    case "image.prune":
      return handleImagePrune();
  }
}
