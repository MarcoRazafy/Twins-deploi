/**
 * Deployment lifecycle: queued → building → deploying → active, driven by the
 * wall clock. `deployment.progress` is the only state the simulation needs, so
 * a reload resumes exactly where the page was left.
 */

import type { EntityName, Unsubscribe } from "@/lib/api/contract";
import type { Deployment, ID, LogLine, Service } from "@/lib/types";

import { getDb, save } from "../db";
import { addActivity } from "../domain/activity";
import {
  CANCELLED_ERROR,
  deploymentLogLines,
  failureReason,
  planFor,
  SUPERSEDED_ERROR,
  type Plan,
} from "../domain/deployment-logs";
import { ensureImage, pruneUnusedImages } from "../domain/images";
import {
  containerOf,
  markContainerExited,
  markContainerRunning,
  setServiceStatus,
  statusEntities,
} from "../domain/services";
import { hasFailBuild } from "../domain/variables";
import { emit } from "../emitter";
import { FAIL_POINT } from "../generators/build-logs";
import { randomBetween } from "../ids";
import { isInFlight, type MockDb } from "../schema";
import { iso } from "../text";
import { after, cancelTimer, getSpeed, isBrowser, timerKey } from "../timers";

type LogListener = (lines: LogLine[]) => void;

const logListeners = new Map<ID, Set<LogListener>>();

export function subscribeDeploymentLogs(deploymentId: ID, listener: LogListener): Unsubscribe {
  const listeners = logListeners.get(deploymentId) ?? new Set<LogListener>();
  listeners.add(listener);
  logListeners.set(deploymentId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) logListeners.delete(deploymentId);
  };
}

function pushLines(deploymentId: ID, lines: LogLine[]): void {
  const listeners = logListeners.get(deploymentId);
  if (!listeners || lines.length === 0) return;
  for (const listener of [...listeners]) {
    try {
      listener(structuredClone(lines));
    } catch {
      // A faulty log consumer must not stall the simulation.
    }
  }
}

function eventIds(deployment: Deployment) {
  return {
    projectId: deployment.projectId,
    serviceId: deployment.serviceId,
    deploymentId: deployment.id,
  };
}

function summary(service: Service, deployment: Deployment): string {
  return `${service.name} · ${deployment.commit?.message ?? deployment.image ?? "image"}`;
}

function closeDeployment(deployment: Deployment, now: number): void {
  deployment.finishedAt = iso(now);
  deployment.durationMs = deployment.startedAt
    ? Math.max(0, now - Date.parse(deployment.startedAt))
    : 0;
}

/**
 * A deployment that ended without going live leaves the service as it was:
 * still serving the previous release, still stopped, or crashed when there is
 * nothing to fall back to.
 */
export function restoreServiceAfterAbort(db: MockDb, service: Service): void {
  const container = containerOf(db, service.id);
  if (!service.activeDeploymentId) {
    if (container && container.state !== "exited") markContainerExited(db, service, 1);
    setServiceStatus(db, service, "crashed");
    return;
  }
  if (container?.state === "exited") {
    setServiceStatus(db, service, container.exitCode === 0 ? "stopped" : "crashed");
    return;
  }
  if (container && container.state !== "running") {
    container.state = "running";
    container.exitCode = null;
  }
  setServiceStatus(db, service, "online");
}

/** Keeps at most `retention` past deployments per service. */
function enforceRetention(db: MockDb, serviceId: ID): void {
  const retention = Math.max(1, db.settings.deployments.retention);
  const past = db.deployments
    .filter((item) => item.serviceId === serviceId && item.status !== "active" && !isInFlight(item))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (past.length <= retention) return;

  const dropped = new Set(past.slice(retention).map((item) => item.id));
  db.deployments = db.deployments.filter((item) => !dropped.has(item.id));
  for (const event of db.activity) {
    if (event.deploymentId !== null && dropped.has(event.deploymentId)) event.deploymentId = null;
  }
}

function succeed(db: MockDb, deployment: Deployment, service: Service, now: number): void {
  for (const other of db.deployments) {
    if (other.serviceId === service.id && other.id !== deployment.id && other.status === "active") {
      other.status = "removed";
    }
  }
  deployment.status = "active";
  deployment.progress = 100;
  closeDeployment(deployment, now);

  service.activeDeploymentId = deployment.id;
  delete db.pendingRestarts[service.id];
  markContainerRunning(db, service, deployment.image);
  const container = containerOf(db, service.id);
  if (container) container.restartCount = 0;
  if (deployment.image) ensureImage(db, deployment.image, iso(now));
  setServiceStatus(db, service, "online");

  enforceRetention(db, service.id);
  if (db.settings.docker.autoPrune) pruneUnusedImages(db);

  addActivity(db, {
    type: "deployment.succeeded",
    severity: "success",
    title: "Déploiement réussi",
    description: summary(service, deployment),
    ...eventIds(deployment),
    actor: deployment.creator,
    notify: true,
  });
}

function fail(db: MockDb, deployment: Deployment, service: Service, now: number): void {
  const error = failureReason(db, deployment, "build");
  deployment.status = "failed";
  deployment.progress = FAIL_POINT;
  deployment.error = error;
  closeDeployment(deployment, now);
  restoreServiceAfterAbort(db, service);

  addActivity(db, {
    type: "deployment.failed",
    severity: "error",
    title: "Échec du déploiement",
    description: `${service.name} · ${error}`,
    ...eventIds(deployment),
    actor: deployment.creator,
    notify: true,
  });
}

interface Phase {
  from: number;
  to: number;
  durationMs: number;
}

function phaseOf(deployment: Deployment, plan: Plan): Phase {
  if (deployment.status === "queued") return { from: 0, to: 5, durationMs: plan.queuedMs };
  if (deployment.status === "building") return { from: 5, to: 75, durationMs: plan.buildMs };
  return { from: 75, to: 99, durationMs: plan.deployMs };
}

/**
 * Moves the deployment forward by `elapsedMs` of simulated time.
 * Returns the entity collections to announce (empty when only progress moved).
 */
function advance(
  db: MockDb,
  deployment: Deployment,
  service: Service,
  position: { value: number },
  elapsedMs: number,
  now: number,
): EntityName[] {
  const plan = planFor(deployment, service.source.type);
  const changed = new Set<EntityName>();
  let remaining = elapsedMs;

  while (remaining > 0 && isInFlight(deployment)) {
    const phase = phaseOf(deployment, plan);
    const failing =
      deployment.status === "building" && position.value < FAIL_POINT && hasFailBuild(db, service);
    const target = failing ? FAIL_POINT : phase.to;
    const rate = (phase.to - phase.from) / phase.durationMs;
    const needed = Math.max(0, (target - position.value) / rate);

    if (remaining < needed) {
      position.value += remaining * rate;
      break;
    }
    remaining -= needed;
    position.value = target;

    if (failing) {
      fail(db, deployment, service, now);
      for (const entity of statusEntities(service)) changed.add(entity);
      changed.add("deployments").add("activity");
    } else if (deployment.status === "queued") {
      deployment.status = "building";
      deployment.startedAt = iso(now);
      changed.add("deployments").add("services");
    } else if (deployment.status === "building") {
      deployment.status = "deploying";
      setServiceStatus(db, service, "deploying");
      for (const entity of statusEntities(service)) changed.add(entity);
      changed.add("deployments");
    } else {
      succeed(db, deployment, service, now);
      for (const entity of statusEntities(service)) changed.add(entity);
      changed.add("deployments").add("images").add("activity");
    }
  }

  if (isInFlight(deployment)) {
    deployment.progress = Math.max(deployment.progress, Math.floor(position.value));
  }
  return [...changed];
}

/** Starts (or resumes) the clock of an in-flight deployment. Browser only. */
export function runDeployment(deploymentId: ID): void {
  if (!isBrowser) return;
  const position: { value: number | null } = { value: null };
  let lastTick = Date.now();
  let lastProgressEvent = Date.now();

  const tick = () => {
    const db = getDb();
    const deployment = db.deployments.find((item) => item.id === deploymentId);
    if (!deployment || !isInFlight(deployment)) return;
    const service = db.services.find((item) => item.id === deployment.serviceId);
    if (!service) return;

    const now = Date.now();
    const elapsed = (now - lastTick) * getSpeed();
    lastTick = now;
    const cursor = { value: position.value ?? deployment.progress };
    const printed = deploymentLogLines(db, deployment).length;
    const progressBefore = deployment.progress;

    const changed = advance(db, deployment, service, cursor, elapsed, now);
    position.value = cursor.value;
    save();

    pushLines(deploymentId, deploymentLogLines(db, deployment).slice(printed));
    if (changed.length > 0) {
      lastProgressEvent = now;
      emit(changed, eventIds(deployment));
    } else if (
      deployment.progress !== progressBefore &&
      now - lastProgressEvent >= 1000 / getSpeed()
    ) {
      lastProgressEvent = now;
      emit(["deployments"], eventIds(deployment));
    }

    if (isInFlight(deployment)) schedule();
  };
  const schedule = () => after(timerKey.deployment(deploymentId), randomBetween(150, 450), tick);

  schedule();
}

/**
 * Stops an in-flight deployment. The caller decides what happens to the
 * service (restored when the user cancels, taken over when superseded).
 */
export function abortDeployment(
  db: MockDb,
  deployment: Deployment,
  reason: "user" | "superseded",
): void {
  cancelTimer(timerKey.deployment(deployment.id));
  const printed = deploymentLogLines(db, deployment).length;
  deployment.status = "cancelled";
  deployment.error = reason === "user" ? CANCELLED_ERROR : SUPERSEDED_ERROR;
  closeDeployment(deployment, Date.now());
  pushLines(deployment.id, deploymentLogLines(db, deployment).slice(printed));
}

export function resumeDeployments(db: MockDb): void {
  for (const deployment of db.deployments) {
    if (isInFlight(deployment)) runDeployment(deployment.id);
  }
}
