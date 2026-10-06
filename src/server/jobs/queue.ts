/**
 * Generic job queue (table `jobs`) for everything the API must not do itself:
 * container actions, cleanups of deleted things, DNS checks, backups, image
 * pruning. Deployments are NOT jobs: a `queued` deployment row is its own job.
 *
 * Producers (API namespaces) call `enqueueJob` inside their transaction, so a
 * job exists if and only if the write that needs it committed. The worker loop
 * calls `claimNextJob`, runs the handler, then `completeJob` or `failJob`.
 *
 * Times are always passed as JS dates, never produced by SQL `now()`: Prisma
 * stores `timestamp(3)` columns as UTC.
 */

import { Prisma } from "@/generated/prisma/client";

import { db, type DbClient } from "../db";
import { newId } from "../ids";

export const JOB_TYPES = [
  "service.action",
  "cleanup.service",
  "cleanup.project",
  "domain.verify",
  "domain.certificate",
  "backup.create",
  "backup.restore",
  "image.prune",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/**
 * What a deleted service leaves behind, captured BEFORE its rows are deleted.
 * The worker must find containers by the `mini-railway.service` label (the
 * name is null when the service was never deployed, and a build may still be
 * running), and check that `repoDir` lies under MINI_RAILWAY_DATA_DIR before
 * removing it.
 */
export interface CleanupServicePayload {
  serviceId: string;
  projectId: string;
  /** For logs only. */
  serviceName: string;
  containerName: string | null;
  /** Docker volume `mr-<serviceId>-data`, whether or not one is attached right now. */
  volumeName: string;
  /** Hostnames of its domains: proxy entries (and /etc/hosts entries) to remove. */
  hostnames: string[];
  /** Repository of the images built for a GitHub service (all tags); null otherwise. */
  imageRepository: string | null;
  /** Local clone of a GitHub service; null otherwise. */
  repoDir: string | null;
  /** Managed PostgreSQL database of the service, whose backups directory goes too. */
  databaseId: string | null;
}

export interface JobPayloads {
  "service.action": { serviceId: string; action: "start" | "stop" | "restart" };
  "cleanup.service": CleanupServicePayload;
  /** The Docker network `mr-<projectId>`; runs after the cleanup.service jobs of the same deletion. */
  "cleanup.project": { projectId: string; network: string };
  "domain.verify": { domainId: string };
  "domain.certificate": { domainId: string };
  "backup.create": { databaseId: string; backupId: string };
  "backup.restore": { databaseId: string; backupId: string };
  "image.prune": Record<string, never>;
}

/** A claimed job, typed per job type. */
export type ClaimedJob = {
  [T in JobType]: { id: string; type: T; payload: JobPayloads[T]; attempts: number };
}[JobType];

/** After this many attempts a job that asks for a retry is failed for good. */
export const MAX_JOB_ATTEMPTS = 5;

const MAX_ERROR_LENGTH = 2000;

/** Returns the job id. `runAt` defaults to now. */
export async function enqueueJob<T extends JobType>(
  client: DbClient,
  type: T,
  payload: JobPayloads[T],
  runAt: Date = new Date(),
): Promise<string> {
  const id = newId("job");
  await client.job.create({
    data: {
      id,
      type,
      // Payloads are plain JSON; interfaces just lack the index signature Prisma asks for.
      payload: payload as unknown as Prisma.InputJsonObject,
      runAt,
    },
  });
  return id;
}

interface RawJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

/**
 * Atomically takes the oldest due job (FOR UPDATE SKIP LOCKED), marks it
 * running for `workerId` and counts the attempt. Null when nothing is due.
 * Rows of an unknown type are never claimed. `types` narrows what is taken (the
 * worker leaves Docker jobs pending while Docker is not reachable).
 */
export async function claimNextJob(
  workerId: string,
  types: readonly JobType[] = JOB_TYPES,
): Promise<ClaimedJob | null> {
  if (types.length === 0) return null;
  const now = new Date();
  const rows = await db().$queryRaw<RawJob[]>`
    UPDATE jobs
    SET status = 'running', "lockedBy" = ${workerId}, "lockedAt" = ${now}, attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending' AND "runAt" <= ${now} AND type IN (${Prisma.join([...types])})
      ORDER BY "runAt" ASC, "createdAt" ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload, attempts`;
  const row = rows[0];
  if (!row) return null;

  const type = JOB_TYPES.find((candidate) => candidate === row.type);
  if (type === undefined) {
    await failJob(row.id, "Unknown job type.");
    return null;
  }
  // Payloads are only ever written by enqueueJob, which types them per job type.
  return { id: row.id, type, payload: row.payload, attempts: row.attempts } as ClaimedJob;
}

export async function completeJob(id: string): Promise<void> {
  await db().job.update({
    where: { id },
    data: { status: "done", finishedAt: new Date(), error: null },
  });
}

/**
 * Records a failure. With `retryAfterMs` the job goes back to pending (until
 * MAX_JOB_ATTEMPTS is reached), otherwise it is failed for good. `message`
 * must not contain secrets.
 */
export async function failJob(
  id: string,
  message: string,
  options: { retryAfterMs?: number } = {},
): Promise<void> {
  const job = await db().job.findUnique({ where: { id }, select: { attempts: true } });
  if (!job) return;
  const error = message.slice(0, MAX_ERROR_LENGTH);
  if (options.retryAfterMs !== undefined && job.attempts < MAX_JOB_ATTEMPTS) {
    await db().job.update({
      where: { id },
      data: {
        status: "pending",
        runAt: new Date(Date.now() + options.retryAfterMs),
        lockedBy: null,
        lockedAt: null,
        error,
      },
    });
    return;
  }
  await db().job.update({
    where: { id },
    data: { status: "failed", finishedAt: new Date(), error },
  });
}

/**
 * Puts back to pending the jobs left `running` by a worker that died. Call it
 * at startup with 0 (there is a single worker); jobs must be idempotent.
 */
export async function requeueInterruptedJobs(staleAfterMs = 0): Promise<number> {
  const result = await db().job.updateMany({
    where: { status: "running", lockedAt: { lte: new Date(Date.now() - staleAfterMs) } },
    data: { status: "pending", lockedBy: null, lockedAt: null },
  });
  return result.count;
}
