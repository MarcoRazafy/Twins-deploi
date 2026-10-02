/**
 * Worker of TwinsDeploi (`npm run worker`): executes what the API only
 * records - queued deployments, jobs - and keeps the database in line with
 * Docker (monitor, metrics, scheduled backups).
 *
 * A single worker is active: the others wait on a PostgreSQL advisory lock.
 * Every loop iteration is isolated: an error is logged and the loop goes on.
 */

import { hostname } from "node:os";

import { Client } from "pg";

import { backupPlatformDatabase } from "../server/backups/platform";
import { scheduleAutomaticBackups } from "../server/backups/schedule";
import { db } from "../server/db";
import { claimNextDeployment, runDeployment } from "../server/deploy/pipeline";
import { recoverInterruptedDeployments } from "../server/deploy/recovery";
import { isDockerAvailable } from "../server/docker";
import { env } from "../server/env";
import { DOCKER_FREE_JOB_TYPES, JobRetry, runJob } from "../server/jobs/handlers";
import { claimNextJob, completeJob, enqueueJob, failJob, requeueInterruptedJobs } from "../server/jobs/queue";
import { purgeExpiredData, sampleMetrics } from "../server/metrics/sampler";
import { reconcileContainers } from "../server/monitor/reconcile";
import { getPlatformSettings } from "../server/platform-settings";
import { GIT_SYNC_INTERVAL_MS, syncGitServices } from "../server/sync/git-sync";

const APPLICATION_NAME = "mini-railway-worker";
/** Arbitrary constant shared by every worker of an installation. */
const ADVISORY_LOCK_KEY = "720031986421";

const IDLE_POLL_MS = 1_000;
const MONITOR_INTERVAL_MS = 10_000;
const SAMPLER_INTERVAL_MS = 15_000;
const SCHEDULER_INTERVAL_MS = 15_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LOCK_RETRY_MS = 3_000;
const LOCK_CHECK_MS = 5_000;
const DOCKER_WARNING_INTERVAL_MS = 60_000;
/** A heartbeat older than this means the worker that ran the deployment is gone. */
const STALE_AT_STARTUP_MS = 10_000;
const STALE_WHILE_RUNNING_MS = 30_000;
const SHUTDOWN_GRACE_MS = 25_000;

const workerId = `${hostname()}:${process.pid}`;
const shutdown = new AbortController();
let currentDeploymentId: string | null = null;

function log(scope: string, message: string): void {
  process.stdout.write(`${new Date().toISOString()} [${scope}] ${message.replace(/\s*\n\s*/g, " | ")}\n`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolves after `ms`, or as soon as the worker is asked to stop. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (shutdown.signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      shutdown.signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    shutdown.signal.addEventListener("abort", done, { once: true });
  });
}

// ─── single active worker ───────────────────────────────────────────────────

const lock: { held: boolean; client: Client | null; announcedWaiting: boolean } = {
  held: false,
  client: null,
  announcedWaiting: false,
};

function dropLockConnection(reason: string): void {
  const client = lock.client;
  if (!client) return;
  lock.client = null;
  if (lock.held && !shutdown.signal.aborted) {
    log("lock", `advisory lock lost (${reason}), work is paused until it is taken again`);
  }
  lock.held = false;
  client.removeAllListeners();
  client.on("error", () => {});
  void client.end().catch(() => {});
}

/** The lock lives on one dedicated connection: when it drops, the lock is gone and is taken again. */
async function maintainLock(): Promise<void> {
  while (!shutdown.signal.aborted) {
    try {
      if (!lock.client) {
        const client = new Client({ connectionString: env.databaseUrl, application_name: `${APPLICATION_NAME}-lock` });
        client.on("error", (error) => dropLockConnection(describe(error)));
        client.on("end", () => dropLockConnection("connection closed"));
        await client.connect();
        lock.client = client;
      }
      if (!lock.held) {
        const result = await lock.client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock($1::bigint) AS locked",
          [ADVISORY_LOCK_KEY],
        );
        if (result.rows[0]?.locked === true) {
          lock.held = true;
          lock.announcedWaiting = false;
          log("lock", "advisory lock acquired, this worker is active");
        } else if (!lock.announcedWaiting) {
          lock.announcedWaiting = true;
          log("lock", "another worker is active, waiting for the advisory lock");
        }
      } else {
        await lock.client.query("SELECT 1");
      }
    } catch (error) {
      log("lock", `database not reachable: ${describe(error)}`);
      dropLockConnection("connection error");
    }
    await pause(lock.held ? LOCK_CHECK_MS : LOCK_RETRY_MS);
  }
}

// ─── Docker availability ────────────────────────────────────────────────────

let dockerWasAvailable: boolean | null = null;
let lastDockerWarning = 0;

async function dockerReady(): Promise<boolean> {
  const status = await isDockerAvailable();
  if (status.available) {
    if (dockerWasAvailable === false) log("docker", "Docker is reachable again");
    dockerWasAvailable = true;
    return true;
  }
  if (dockerWasAvailable !== false || Date.now() - lastDockerWarning >= DOCKER_WARNING_INTERVAL_MS) {
    lastDockerWarning = Date.now();
    log("docker", `Docker is not reachable: ${status.reason}. Deployments stay queued, Docker jobs stay pending`);
  }
  dockerWasAvailable = false;
  return false;
}

// ─── loops ──────────────────────────────────────────────────────────────────

/**
 * Runs `iteration` until shutdown. It returns true to be called again at once
 * (more work may be waiting), false to wait `intervalMs`.
 */
async function loop(scope: string, intervalMs: number, iteration: () => Promise<boolean>): Promise<void> {
  while (!shutdown.signal.aborted) {
    let again = false;
    try {
      again = lock.held ? await iteration() : false;
    } catch (error) {
      log(scope, `iteration failed: ${describe(error)}`);
    }
    if (!again) await pause(intervalMs);
  }
}

async function deploymentIteration(): Promise<boolean> {
  if (!(await dockerReady())) return false;
  const id = await claimNextDeployment(workerId);
  if (id === null) return false;
  currentDeploymentId = id;
  log("deploy", `deployment ${id} started`);
  try {
    await runDeployment(id, { signal: shutdown.signal, workerId });
    const row = await db().deployment.findUnique({ where: { id }, select: { status: true } });
    log("deploy", `deployment ${id} ended: ${row?.status ?? "deleted"}`);
  } finally {
    currentDeploymentId = null;
  }
  return true;
}

async function jobIteration(): Promise<boolean> {
  const job = (await dockerReady()) ? await claimNextJob(workerId) : await claimNextJob(workerId, DOCKER_FREE_JOB_TYPES);
  if (!job) return false;
  try {
    await runJob(job);
    await completeJob(job.id);
    log("jobs", `${job.type} ${job.id} done`);
  } catch (error) {
    if (error instanceof JobRetry) {
      await failJob(job.id, error.message, { retryAfterMs: error.retryAfterMs });
      log("jobs", `${job.type} ${job.id} will be retried (attempt ${job.attempts}): ${error.message}`);
    } else {
      await failJob(job.id, describe(error));
      log("jobs", `${job.type} ${job.id} failed: ${describe(error)}`);
    }
  }
  return true;
}

async function monitorIteration(): Promise<boolean> {
  if ((await isDockerAvailable()).available) await reconcileContainers();
  return false;
}

async function samplerIteration(): Promise<boolean> {
  if ((await isDockerAvailable()).available) await sampleMetrics();
  return false;
}

async function gitSyncIteration(): Promise<boolean> {
  await syncGitServices({ signal: shutdown.signal, log: (message) => log("git-sync", message) });
  return false;
}

/** Runs `task` when `everyMs` passed since its last run; a failing task is logged and tried again next period. */
function periodic(scope: string, everyMs: number, firstRunAfterMs: number, task: () => Promise<void>): () => Promise<void> {
  let nextRun = Date.now() + firstRunAfterMs;
  return async () => {
    if (Date.now() < nextRun) return;
    nextRun = Date.now() + everyMs;
    try {
      await task();
    } catch (error) {
      log(scope, `failed: ${describe(error)}`);
    }
  };
}

const scheduled = [
  periodic("recovery", SCHEDULER_INTERVAL_MS, SCHEDULER_INTERVAL_MS, async () => {
    const recovered = await recoverInterruptedDeployments(STALE_WHILE_RUNNING_MS, currentDeploymentId);
    for (const id of recovered) log("recovery", `deployment ${id} had no heartbeat: marked failed`);
  }),
  periodic("purge", HOUR_MS, 60_000, async () => {
    const purged = await purgeExpiredData();
    if (purged.samples + purged.sessions > 0) {
      log("purge", `removed ${purged.samples} metric samples and ${purged.sessions} expired sessions`);
    }
  }),
  periodic("backups", HOUR_MS, 30_000, async () => {
    const queued = await scheduleAutomaticBackups();
    if (queued > 0) log("backups", `queued ${queued} automatic database backups`);
  }),
  periodic("backups", HOUR_MS, 45_000, async () => {
    const file = await backupPlatformDatabase();
    if (file !== null) log("backups", `platform database dumped to ${file}`);
  }),
  periodic("prune", DAY_MS, DAY_MS, async () => {
    if (!(await getPlatformSettings()).docker.autoPrune) return;
    await enqueueJob(db(), "image.prune", {});
    log("prune", "queued the daily image prune");
  }),
];

async function schedulerIteration(): Promise<boolean> {
  for (const run of scheduled) {
    if (shutdown.signal.aborted) break;
    await run();
  }
  return false;
}

// ─── lifecycle ──────────────────────────────────────────────────────────────

async function startupRecovery(): Promise<void> {
  const requeued = await requeueInterruptedJobs();
  if (requeued > 0) log("recovery", `${requeued} interrupted jobs put back in the queue`);
  const recovered = await recoverInterruptedDeployments(STALE_AT_STARTUP_MS);
  for (const id of recovered) log("recovery", `deployment ${id} was interrupted: marked failed`);
}

async function main(): Promise<void> {
  // Names the pooled connections of this process in pg_stat_activity.
  process.env.PGAPPNAME ??= APPLICATION_NAME;
  log("worker", `starting ${workerId} (data directory ${env.dataDir})`);

  let signals = 0;
  const onSignal = (name: string): void => {
    signals += 1;
    if (signals > 1) {
      log("worker", `${name} received again, exiting immediately`);
      process.exit(1);
    }
    log("worker", `${name} received: stopping, the running deployment is interrupted`);
    shutdown.abort();
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  // A dropped database connection can surface outside any await: the loops recover by themselves.
  process.on("uncaughtException", (error) => log("worker", `uncaught exception: ${describe(error)}`));
  process.on("unhandledRejection", (error) => log("worker", `unhandled rejection: ${describe(error)}`));

  const locking = maintainLock();
  while (!lock.held && !shutdown.signal.aborted) await pause(200);

  while (lock.held && !shutdown.signal.aborted) {
    try {
      await startupRecovery();
      break;
    } catch (error) {
      log("recovery", `startup recovery failed, retrying: ${describe(error)}`);
      await pause(LOCK_RETRY_MS);
    }
  }
  if (!shutdown.signal.aborted) log("worker", "ready");

  const loops = Promise.allSettled([
    loop("deploy", IDLE_POLL_MS, deploymentIteration),
    loop("jobs", IDLE_POLL_MS, jobIteration),
    loop("monitor", MONITOR_INTERVAL_MS, monitorIteration),
    loop("metrics", SAMPLER_INTERVAL_MS, samplerIteration),
    loop("scheduler", SCHEDULER_INTERVAL_MS, schedulerIteration),
    loop("git-sync", GIT_SYNC_INTERVAL_MS, gitSyncIteration),
    locking,
  ]);

  await new Promise<void>((resolve) => {
    if (shutdown.signal.aborted) resolve();
    else shutdown.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  const finished = await Promise.race([
    loops.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SHUTDOWN_GRACE_MS).unref()),
  ]);
  if (!finished) log("worker", "some work did not stop in time, exiting anyway");

  dropLockConnection("shutdown");
  await db()
    .$disconnect()
    .catch(() => {});
  log("worker", "stopped");
  process.exit(0);
}

void main().catch((error: unknown) => {
  log("worker", `fatal: ${describe(error)}`);
  process.exit(1);
});
