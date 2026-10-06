/**
 * Deployment pipeline: queued -> building -> deploying -> active (or failed /
 * cancelled). One deployment at a time, run by the worker.
 *
 * Contract with the API (see deployments/status.ts): the row is the job;
 * `cancelRequested` is honoured at every checkpoint and kills the running
 * command; every write of a final state is conditional on the row still being
 * building / deploying; the previous container keeps serving until the new one
 * passed its health check.
 */

import net from "node:net";

import type { Deployment, ManagedDatabase, Service } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/contract";
import type { LogLevel, LogStream } from "@/lib/types";

import { recordActivity } from "../activity";
import { randomHex } from "../crypto";
import { db } from "../db";
import { imageReferenceFor } from "../deployments/enqueue";
import { appendLogs, type LogInput } from "../deployments/logs";
import { cancellationError } from "../deployments/status";
import {
  DockerError,
  ensureNetwork,
  ensureVolume,
  execInContainer,
  inspectContainer,
  inspectImage,
  isDockerError,
  listContainers,
  listImages,
  pullImage,
  removeContainer,
  removeImage,
  runContainer,
  stopContainer,
  tailLogs,
  type ContainerSpec,
  type DockerRestartPolicy,
} from "../docker";
import { publishServiceDomains } from "../domains/publish";
import { emit } from "../events";
import { getPlatformSettings } from "../platform-settings";
import { imageRepositoryFor, projectNetworkName } from "../services/names";
import { statusEntities } from "../services/status";
import { buildContainerEnvironment, removeEnvFile, writeEnvFile } from "./env-file";
import { privateDomainOf } from "@/lib/variables/builtin";
import { allocateHostPort } from "./ports";
import { settleServiceStatus } from "./service-status";
import { prepareGithubImage } from "./sources/github";

export const INTERRUPTED_ERROR = "Interrompu par un redémarrage de la plateforme";
const INTERNAL_ERROR = "Le déploiement a échoué à cause d’une erreur interne de la plateforme.";

const HEARTBEAT_INTERVAL_MS = 2_000;
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_INTERVAL_MS = 1_000;
const PROBE_TIMEOUT_MS = 3_000;
const CRASH_LOG_LINES = 50;
const PORT_ATTEMPTS = 3;
const LOG_FLUSH_MS = 250;
const LOG_FLUSH_LINES = 100;

export interface RunDeploymentOptions {
  /** Aborted when the worker shuts down: the deployment ends failed with INTERRUPTED_ERROR. */
  signal: AbortSignal;
  workerId: string;
}

type StopReason = "cancelled" | "interrupted" | "vanished";

/** Thrown at a checkpoint when the deployment must stop. */
class Stopped extends Error {
  constructor(readonly reason: StopReason) {
    super(`deployment ${reason}`);
    this.name = "Stopped";
  }
}

/** A failure whose French message goes to deployment.error. */
class DeployFailure extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "DeployFailure";
  }
}

/**
 * Takes the oldest queued deployment (FOR UPDATE SKIP LOCKED) and marks it
 * building for this worker. Resolves with its id, null when nothing is queued.
 */
export async function claimNextDeployment(workerId: string): Promise<string | null> {
  const now = new Date();
  const rows = await db().$queryRaw<Array<{ id: string }>>`
    UPDATE deployments
    SET status = 'building', "lockedBy" = ${workerId}, "heartbeatAt" = ${now}, "startedAt" = ${now}, progress = 5
    WHERE id = (
      SELECT id FROM deployments
      WHERE status = 'queued'
      ORDER BY "createdAt" ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

type LoadedService = Service & { database: ManagedDatabase | null; project: { slug: string } };

interface RunState {
  deployment: Deployment;
  service: LoadedService;
  signal: AbortSignal;
  stream: LogStream;
  log: (level: LogLevel, message: string) => void;
  flushLogs: () => Promise<void>;
  /** Throws Stopped when the deployment was cancelled, interrupted or deleted. */
  checkpoint: () => Promise<void>;
  setProgress: (progress: number) => Promise<void>;
  /** Name of the container this run created, to remove on failure. */
  containerName: string | null;
  envFile: string | null;
  image: string;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

function restartPolicyOf(policy: string): DockerRestartPolicy {
  return policy === "always" ? "always" : policy === "on-failure" ? "on-failure" : "no";
}

/** Runs a Docker step; a Docker failure is logged (English) and becomes `message` (French). */
async function step<T>(state: RunState, message: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DockerError && error.kind !== "aborted") {
      state.log("error", error.message);
      throw new DeployFailure(message);
    }
    throw error;
  }
}

// ─── image step ─────────────────────────────────────────────────────────────

async function prepareImage(state: RunState, timeoutMs: number): Promise<void> {
  const { deployment, service } = state;
  if (service.type === "github") {
    // A rollback reuses the image of the version it restores when it is still there.
    if (deployment.trigger === "rollback" && deployment.image && (await inspectImage(deployment.image))) {
      state.image = deployment.image;
      state.log("info", `Reusing image ${state.image}`);
      return;
    }
    const built = await prepareGithubImage({
      deployment,
      service,
      log: state.log,
      signal: state.signal,
      timeoutMs,
    });
    state.image = built.image;
    await db().deployment.updateMany({
      where: { id: deployment.id },
      data: {
        image: built.image,
        ...(built.commit
          ? {
              commitSha: built.commit.sha,
              commitMessage: built.commit.message,
              commitAuthor: built.commit.author,
              commitBranch: built.commit.branch,
            }
          : {}),
      },
    });
    return;
  }

  state.log("info", `Pulling image ${state.image}`);
  try {
    await pullImage(state.image, {
      signal: state.signal,
      timeoutMs,
      onLine: (_stream, line) => state.log("info", line),
    });
  } catch (error) {
    if (!(error instanceof DockerError) || error.kind === "aborted") throw error;
    state.log("error", error.message);
    if (error.kind === "timeout") {
      throw new DeployFailure(
        `Le téléchargement de l’image ${state.image} a dépassé le délai autorisé (${Math.round(timeoutMs / 60_000)} min).`,
      );
    }
    const missing = /not found|manifest unknown|pull access denied|repository does not exist/i.test(error.stderrTail);
    throw new DeployFailure(
      missing
        ? `L’image ${state.image} est introuvable ou son accès est refusé.`
        : `Le téléchargement de l’image ${state.image} a échoué.`,
    );
  }
  state.log("info", `Image ${state.image} is ready`);
}

// ─── deploy step ────────────────────────────────────────────────────────────

function probeTcp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => {
      // Docker's port forwarder accepts, then drops the connection when nothing
      // listens in the container: a connection that survives a moment is real.
      socket.once("close", () => finish(false));
      setTimeout(() => finish(true), 200);
    });
  });
}

async function probeHttp(port: number, path: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path.startsWith("/") ? path : `/${path}`}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => {});
    // A 4xx means the path is not served (404) or refused: not healthy. A
    // redirect is not followed (manual) and counts as an answer of the route.
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

async function probe(state: RunState, containerName: string, hostPort: number): Promise<boolean> {
  const { service } = state;
  if (service.type === "postgres" && service.database) {
    // Over TCP on purpose: during initialisation the image runs a bootstrap server on its socket only.
    const result = await execInContainer(
      containerName,
      [
        "pg_isready", "-h", "127.0.0.1", "-p", String(service.port),
        "-U", service.database.username, "-d", service.database.databaseName,
      ],
      { timeoutMs: 10_000, signal: state.signal },
    );
    return result.code === 0;
  }
  if (service.healthcheckPath.trim() !== "") return probeHttp(hostPort, service.healthcheckPath.trim());
  return probeTcp(hostPort);
}

async function captureContainerLogs(state: RunState, containerName: string): Promise<void> {
  try {
    const lines = await tailLogs(containerName, CRASH_LOG_LINES);
    if (lines.length === 0) return;
    state.log("warn", `Last ${lines.length} lines of the container:`);
    for (const { stream, line } of lines) {
      // Without the docker timestamp prefix.
      state.log(stream === "stderr" ? "error" : "info", line.replace(/^\S+Z /, ""));
    }
  } catch {
    state.log("warn", "The container logs could not be read.");
  }
}

async function waitUntilHealthy(state: RunState, containerName: string, hostPort: number): Promise<void> {
  const { service } = state;
  const target =
    service.type === "postgres"
      ? "pg_isready"
      : service.healthcheckPath.trim() !== ""
        ? `GET http://127.0.0.1:${hostPort}${service.healthcheckPath.trim()}`
        : `TCP 127.0.0.1:${hostPort}`;
  state.log("info", `Waiting for the container to be healthy (${target}, up to ${HEALTH_TIMEOUT_MS / 1000}s)`);

  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    await state.checkpoint();
    const container = await inspectContainer(containerName);
    const dead = !container || container.state === "exited" || container.state === "dead";
    if (dead || container.restartCount > 0) {
      const code = container?.exitCode ?? -1;
      state.log("error", `Container exited during startup (exit code ${code})`);
      await captureContainerLogs(state, containerName);
      throw new DeployFailure(`Le conteneur s’est arrêté pendant son démarrage (code de sortie ${code}).`);
    }
    if (container.running && (await probe(state, containerName, hostPort))) {
      state.log("success", "Health check passed");
      return;
    }
    if (Date.now() >= deadline) {
      state.log("error", `Health check did not pass within ${HEALTH_TIMEOUT_MS / 1000}s`);
      await captureContainerLogs(state, containerName);
      const path = service.healthcheckPath.trim();
      const detail =
        service.type === "postgres"
          ? `PostgreSQL n’est pas prêt sur le port ${service.port}.`
          : path !== ""
            ? `GET ${path} sur le port ${service.port} ne renvoie pas de réponse 2xx ou 3xx (service injoignable, ou chemin inexistant).`
            : `le service n’accepte pas de connexion sur le port ${service.port}.`;
      throw new DeployFailure(
        `Le contrôle de santé n’a pas abouti en ${HEALTH_TIMEOUT_MS / 1000} secondes : ${detail}`,
      );
    }
    await sleep(HEALTH_INTERVAL_MS, state.signal);
  }
}

/** Creates and starts the container; resolves with its id and host port. */
async function startContainer(state: RunState): Promise<{ containerId: string; hostPort: number }> {
  const { deployment, service } = state;
  const network = projectNetworkName(service.projectId);
  await step(state, "La préparation du réseau Docker du projet a échoué.", async () => {
    await ensureNetwork(network, service.projectId);
    state.log("info", `Network ${network} ready`);
  });
  const volume =
    service.volumeName !== null && service.volumeMountPath !== null
      ? { name: service.volumeName, mountPath: service.volumeMountPath }
      : null;
  if (volume) {
    await step(state, "La préparation du volume du service a échoué.", async () => {
      await ensureVolume(volume.name, service.id);
      state.log("info", `Volume ${volume.name} mounted at ${volume.mountPath}`);
    });
  }

  const environment = await buildContainerEnvironment(service, service.database, deployment.id);
  for (const warning of environment.warnings) state.log("warn", warning);
  state.log("info", `Injecting ${Object.keys(environment.variables).length} environment variables`);

  const postgres = service.type === "postgres";
  const startCommand = service.startCommand.trim();
  const name = `mr-${service.project.slug}-${service.slug}-${randomHex(3)}`;
  const tried = new Set<number>();

  for (let attempt = 1; ; attempt += 1) {
    await state.checkpoint();
    const hostPort = await allocateHostPort(tried);
    tried.add(hostPort);
    const spec: ContainerSpec = {
      name,
      image: state.image,
      network,
      aliases: [service.slug, privateDomainOf(service.slug), `${service.slug}.railway.internal`],
      hostPort,
      containerPort: service.port,
      envFile: "",
      memoryMb: service.memoryLimitMb,
      cpus: service.cpuLimit,
      restart: restartPolicyOf(service.restartPolicy),
      labels: { projectId: service.projectId, serviceId: service.id, deploymentId: deployment.id },
      volume,
    };
    if (postgres && service.database) {
      // The image's entrypoint hands these arguments to the postgres server.
      spec.command = ["-c", `max_connections=${service.database.maxConnections}`];
    } else if (startCommand !== "") {
      // The command runs in a shell INSIDE the container, replacing the image entrypoint.
      spec.entrypoint = "/bin/sh";
      spec.command = ["-c", startCommand];
    }

    state.envFile = await writeEnvFile(deployment.id, environment.variables);
    spec.envFile = state.envFile;
    state.containerName = name;
    state.log("info", `Starting container ${name} (127.0.0.1:${hostPort} -> ${service.port})`);
    try {
      const containerId = await runContainer(spec, { signal: state.signal });
      return { containerId, hostPort };
    } catch (error) {
      if (!(error instanceof DockerError) || error.kind === "aborted") throw error;
      // A failed run can leave a created container behind.
      await removeContainer(name).catch(() => false);
      const portTaken = /port is already allocated|address already in use/i.test(error.stderrTail);
      if (portTaken && attempt < PORT_ATTEMPTS) {
        state.log("warn", `Port ${hostPort} was taken meanwhile, trying another one`);
        continue;
      }
      state.log("error", error.message);
      throw new DeployFailure("Le conteneur n’a pas pu être démarré. Consultez les logs du déploiement.");
    } finally {
      await removeEnvFile(state.envFile).catch(() => {});
      state.envFile = null;
    }
  }
}

// ─── switch ─────────────────────────────────────────────────────────────────

function subjectOf(state: RunState): string {
  return state.deployment.commitMessage ?? state.image;
}

/**
 * Makes the new container the live one, in one transaction: service runtime
 * columns, previous deployment "removed", this one "active", activity, events.
 * Throws Stopped when a cancellation won the race.
 */
async function goLive(state: RunState, containerId: string, hostPort: number): Promise<void> {
  const { deployment, service } = state;
  const containerName = state.containerName;
  if (containerName === null) throw new Error("goLive called without a container");
  await state.flushLogs();

  const outcome = await db().$transaction(async (tx): Promise<StopReason | "live"> => {
    const rows = await tx.$queryRaw<Array<{ status: string; cancelRequested: boolean }>>`
      SELECT status::text AS status, "cancelRequested" FROM deployments WHERE id = ${deployment.id} FOR UPDATE`;
    const row = rows[0];
    if (!row) return "vanished";
    if (row.cancelRequested || row.status !== "deploying") return "cancelled";
    const current = await tx.service.findUnique({ where: { id: service.id }, select: { status: true } });
    if (!current) return "vanished";

    const now = new Date();
    const inDeployment = current.status === "building" || current.status === "deploying";
    await tx.service.update({
      where: { id: service.id },
      data: {
        containerId,
        containerName,
        hostPort,
        startedAt: now,
        restartCount: 0,
        activeDeploymentId: deployment.id,
        ...(inDeployment ? { status: "online" as const } : {}),
      },
    });
    await tx.deployment.updateMany({
      where: { serviceId: service.id, id: { not: deployment.id }, status: { in: ["active", "crashed"] } },
      data: { status: "removed" },
    });
    const startedAt = deployment.startedAt ?? deployment.createdAt;
    await tx.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "active",
        image: state.image,
        progress: 100,
        error: null,
        finishedAt: now,
        heartbeatAt: now,
        durationMs: Math.max(0, now.getTime() - startedAt.getTime()),
      },
    });
    const links = { projectId: service.projectId, serviceId: service.id, deploymentId: deployment.id };
    await recordActivity(
      {
        type: "deployment.succeeded",
        severity: "success",
        title: "Déploiement réussi",
        description: `${service.name} · ${subjectOf(state)}`,
        ...links,
        notify: true,
      },
      tx,
    );
    await emit(["deployments", "images", ...statusEntities(service.type)], links, tx);
    return "live";
  });
  if (outcome !== "live") throw new Stopped(outcome);
}

/** After the switch: domains to the new port, previous containers gone, old images pruned. Best effort. */
async function afterSwitch(state: RunState): Promise<void> {
  const { service } = state;
  try {
    await publishServiceDomains(service.id);
  } catch (error) {
    console.error(`[deploy] could not publish the domains of ${service.id}:`, error instanceof Error ? error.message : error);
  }

  try {
    const containers = await listContainers({ serviceId: service.id });
    for (const container of containers) {
      if (container.name === state.containerName) continue;
      if (container.state === "running" || container.state === "restarting") {
        await stopContainer(container.name).catch(() => {});
      }
      await removeContainer(container.name);
    }
  } catch (error) {
    console.error(`[deploy] could not remove the previous container of ${service.id}:`, error instanceof Error ? error.message : error);
  }

  if (service.type !== "github") return;
  try {
    const { retention } = (await getPlatformSettings()).deployments;
    const images = (await listImages({ reference: imageRepositoryFor(service.id) })).sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    );
    const current = state.image;
    const kept = new Set(images.slice(0, Math.max(1, retention)).map((image) => `${image.repository}:${image.tag}`));
    for (const image of images) {
      const reference = `${image.repository}:${image.tag}`;
      if (reference === current || kept.has(reference)) continue;
      // An image a container still uses is refused by Docker: skipped.
      await removeImage(reference).catch((error: unknown) => {
        if (!isDockerError(error)) throw error;
      });
    }
  } catch (error) {
    console.error(`[deploy] could not prune the images of ${service.id}:`, error instanceof Error ? error.message : error);
  }
}

// ─── endings without going live ─────────────────────────────────────────────

async function discardContainer(state: RunState): Promise<void> {
  await removeEnvFile(state.envFile).catch(() => {});
  if (state.containerName === null) return;
  try {
    await removeContainer(state.containerName);
  } catch (error) {
    console.error(`[deploy] could not remove container ${state.containerName}:`, error instanceof Error ? error.message : error);
  }
}

async function finish(
  state: RunState,
  status: "failed" | "cancelled",
  error: string,
  activity: boolean,
): Promise<void> {
  const { deployment, service } = state;
  await state.flushLogs();
  const now = new Date();
  const startedAt = deployment.startedAt ?? deployment.createdAt;
  const { count } = await db().deployment.updateMany({
    where: { id: deployment.id, status: { in: ["building", "deploying"] } },
    data: {
      status,
      error,
      finishedAt: now,
      heartbeatAt: now,
      durationMs: Math.max(0, now.getTime() - startedAt.getTime()),
    },
  });
  if (count === 0) return;
  await settleServiceStatus(service.id, deployment.id);
  const links = { projectId: service.projectId, serviceId: service.id, deploymentId: deployment.id };
  if (activity) {
    await recordActivity({
      type: "deployment.failed",
      severity: "error",
      title: "Échec du déploiement",
      description: `${service.name} · ${error}`,
      ...links,
      notify: true,
    });
  }
  await emit(["deployments", ...statusEntities(service.type)], links);
}

// ─── entry point ────────────────────────────────────────────────────────────

/**
 * Runs a deployment claimed with `claimNextDeployment` to its end. Never
 * throws for a deployment failure: the outcome is written to the row. Throws
 * only when the database itself fails while recording the outcome.
 */
export async function runDeployment(deploymentId: string, options: RunDeploymentOptions): Promise<void> {
  const loaded = await db().deployment.findUnique({
    where: { id: deploymentId },
    include: { service: { include: { database: true, project: { select: { slug: true } } } } },
  });
  if (!loaded) return;
  const { service, ...deployment } = loaded;

  // Logs are buffered and written in order, a few times per second.
  let pending: LogInput[] = [];
  let chain: Promise<void> = Promise.resolve();
  let flushTimer: NodeJS.Timeout | null = null;
  const flushLogs = (): Promise<void> => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (pending.length > 0) {
      const lines = pending;
      pending = [];
      chain = chain
        .then(() => appendLogs(deploymentId, lines))
        .then(
          () => undefined,
          (error: unknown) => {
            console.error("[deploy] could not write logs:", error instanceof Error ? error.message : error);
          },
        );
    }
    return chain;
  };

  // The deployment stops for one of three reasons, each aborting the running command.
  const controller = new AbortController();
  let reason: StopReason | null = null;
  const stop = (why: StopReason): void => {
    reason ??= why;
    controller.abort();
  };
  const onShutdown = (): void => stop("interrupted");
  if (options.signal.aborted) onShutdown();
  options.signal.addEventListener("abort", onShutdown, { once: true });

  let beating = false;
  const beat = async (): Promise<void> => {
    if (beating || reason !== null) return;
    beating = true;
    try {
      const rows = await db().$queryRaw<Array<{ cancelRequested: boolean }>>`
        UPDATE deployments SET "heartbeatAt" = ${new Date()} WHERE id = ${deploymentId}
        RETURNING "cancelRequested"`;
      if (rows.length === 0) stop("vanished");
      else if (rows[0].cancelRequested) stop("cancelled");
    } catch {
      // A database hiccup must not kill the build: the next beat tries again.
    } finally {
      beating = false;
    }
  };
  const heartbeat = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);

  const state: RunState = {
    deployment,
    service,
    signal: controller.signal,
    stream: "build",
    log: (level, message) => {
      pending.push({ level, stream: state.stream, message, ts: new Date() });
      if (pending.length >= LOG_FLUSH_LINES) void flushLogs();
      else flushTimer ??= setTimeout(() => void flushLogs(), LOG_FLUSH_MS);
    },
    flushLogs,
    checkpoint: async () => {
      await beat();
      if (reason !== null) throw new Stopped(reason);
    },
    setProgress: async (progress) => {
      await db().deployment.updateMany({
        where: { id: deploymentId, status: { in: ["building", "deploying"] } },
        data: { progress, heartbeatAt: new Date() },
      });
      await emit(["deployments"], { projectId: service.projectId, serviceId: service.id, deploymentId });
    },
    containerName: null,
    envFile: null,
    image: deployment.image ?? imageReferenceFor(service, deploymentId),
  };

  try {
    await db().service.updateMany({
      where: { id: service.id, status: "deploying" },
      data: { status: "building" },
    });
    await emit(["deployments", ...statusEntities(service.type)], {
      projectId: service.projectId,
      serviceId: service.id,
      deploymentId,
    });
    state.log("info", `Deployment ${deploymentId} of ${service.name} started (trigger: ${deployment.trigger})`);
    await state.checkpoint();

    const settings = await getPlatformSettings();
    await state.setProgress(10);
    await prepareImage(state, Math.max(1, settings.deployments.buildTimeoutMin) * 60_000);
    await state.checkpoint();

    state.stream = "deploy";
    const moved = await db().deployment.updateMany({
      where: { id: deploymentId, status: "building" },
      data: { status: "deploying", progress: 60, heartbeatAt: new Date() },
    });
    if (moved.count === 0) throw new Stopped("vanished");
    await db().service.updateMany({ where: { id: service.id, status: "building" }, data: { status: "deploying" } });
    await emit(["deployments", ...statusEntities(service.type)], {
      projectId: service.projectId,
      serviceId: service.id,
      deploymentId,
    });

    const { containerId, hostPort } = await startContainer(state);
    await state.setProgress(80);
    await waitUntilHealthy(state, state.containerName ?? "", hostPort);
    await state.checkpoint();

    state.log("info", "Switching traffic to the new container");
    state.log("success", "Deployment successful");
    await goLive(state, containerId, hostPort);
    await afterSwitch(state);
  } catch (error) {
    // An aborted command surfaces as a DockerError: the reason says what really happened.
    const stopped: StopReason | null = error instanceof Stopped ? error.reason : reason;
    if (stopped === "vanished") {
      // The service or the deployment was deleted: leave nothing behind.
      await discardContainer(state);
      if (service.type === "github") await removeImage(state.image).catch(() => {});
    } else if (stopped === "cancelled") {
      state.log("warn", "Deployment cancelled");
      await discardContainer(state);
      const latest = await db().service.findUnique({
        where: { id: service.id },
        select: { latestDeploymentId: true },
      });
      await finish(state, "cancelled", cancellationError(deploymentId, latest?.latestDeploymentId ?? null), false);
    } else if (stopped === "interrupted") {
      state.log("error", "Deployment interrupted: the platform is shutting down");
      await discardContainer(state);
      await finish(state, "failed", INTERRUPTED_ERROR, true);
    } else {
      let message = INTERNAL_ERROR;
      if (error instanceof DeployFailure) message = error.userMessage;
      else if (error instanceof ApiError) message = error.message;
      else {
        console.error(`[deploy] deployment ${deploymentId} failed unexpectedly:`, error);
        state.log("error", error instanceof DockerError ? error.message : "Unexpected platform error");
      }
      state.log("error", "Deployment failed");
      await discardContainer(state);
      await finish(state, "failed", message, true);
    }
  } finally {
    clearInterval(heartbeat);
    options.signal.removeEventListener("abort", onShutdown);
    await flushLogs();
  }
}
