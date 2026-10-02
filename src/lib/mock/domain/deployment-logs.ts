/**
 * Turns the deterministic script of a deployment into the log lines visible
 * at its current progress. Nothing is stored: the same deployment always
 * yields the same lines, with the same ids.
 */

import type { Deployment, LogLine, ServiceSource } from "@/lib/types";

import { fillTimePlaceholders } from "../generators/boot";
import {
  buildScript,
  cancelLine,
  type DeploymentScript,
  type ScriptLine,
} from "../generators/build-logs";
import { familyOf } from "../generators/family";
import { randFloat, seededRng } from "../generators/prng";
import type { MockDb } from "../schema";
import { formatBuildDuration, iso, slugify } from "../text";
import { getSpeed } from "../timers";
import { containerName, containerOf, stackHint } from "./services";
import { effectiveVariables } from "./variables";

export const CANCELLED_ERROR = "Annulé par l’utilisateur";
export const SUPERSEDED_ERROR = "Remplacé par un déploiement plus récent";

export interface Plan {
  queuedMs: number;
  buildMs: number;
  deployMs: number;
}

/** Simulated durations of each phase, stable for a given deployment. */
export function planFor(deployment: Pick<Deployment, "id">, sourceType: ServiceSource["type"]): Plan {
  const rng = seededRng("plan", deployment.id);
  const buildMs =
    sourceType === "github"
      ? randFloat(rng, 8_000, 13_000)
      : sourceType === "docker"
        ? randFloat(rng, 3_000, 5_000)
        : randFloat(rng, 2_000, 4_000);
  return { queuedMs: 1_200, buildMs: Math.round(buildMs), deployMs: Math.round(randFloat(rng, 3_000, 4_000)) };
}

const MAX_CACHED_SCRIPTS = 60;
const scripts = new Map<string, DeploymentScript>();

export function clearScriptCache(): void {
  scripts.clear();
}

function scriptFor(db: MockDb, deployment: Deployment): DeploymentScript | null {
  const cached = scripts.get(deployment.id);
  if (cached) return cached;

  const service = db.services.find((item) => item.id === deployment.serviceId);
  if (!service) return null;
  const project = db.projects.find((item) => item.id === service.projectId);
  const stack = stackHint(db, service);
  const fallbackImage =
    service.source.type === "docker"
      ? `${service.source.image}:${service.source.tag}`
      : service.source.type === "postgres"
        ? `postgres:${service.source.version}`
        : slugify(service.name);

  const script = buildScript({
    deploymentId: deployment.id,
    trigger: deployment.trigger,
    commit: deployment.commit,
    image: deployment.image ?? fallbackImage,
    serviceName: service.name,
    serviceSlug: slugify(service.name),
    containerName:
      containerOf(db, service.id)?.name ??
      (project ? containerName(project, service) : slugify(service.name)),
    region: project?.region ?? db.settings.defaultRegion,
    source: service.source,
    config: service.config,
    volume: service.volume,
    stack,
    family: familyOf(service, stack),
    variableCount: effectiveVariables(db, service).length,
    hostnames: db.domains
      .filter((domain) => domain.serviceId === service.id && domain.status === "active")
      .map((domain) => domain.hostname),
  });

  if (scripts.size >= MAX_CACHED_SCRIPTS) {
    const oldest = scripts.keys().next().value;
    if (oldest !== undefined) scripts.delete(oldest);
  }
  scripts.set(deployment.id, script);
  return script;
}

/** French reason of a failure at the given stage, consistent with the logs. */
export function failureReason(
  db: MockDb,
  deployment: Deployment,
  stage: "build" | "health",
): string {
  const script = scriptFor(db, deployment);
  if (!script) return "Le déploiement a échoué";
  return stage === "build" ? script.buildFailure.error : script.healthFailure.error;
}

function visibleScript(db: MockDb, deployment: Deployment): ScriptLine[] {
  const script = scriptFor(db, deployment);
  if (!script) return [];
  const reached = script.lines.filter((line) => line.p <= deployment.progress);

  switch (deployment.status) {
    case "queued":
    case "building":
    case "deploying":
      return reached;
    case "failed": {
      const failure = deployment.progress >= 75 ? script.healthFailure : script.buildFailure;
      return [...reached, ...failure.lines.map((line) => ({ ...line, p: deployment.progress }))];
    }
    case "cancelled":
      return [...reached, cancelLine(deployment.progress, deployment.error === SUPERSEDED_ERROR)];
    default:
      return script.lines;
  }
}

/** Milliseconds between the start of the build and progress `p`, at speed 1. */
function nominalOffset(plan: Plan, p: number): number {
  if (p <= 75) return ((Math.max(p, 5) - 5) / 70) * plan.buildMs;
  return plan.buildMs + ((Math.min(p, 99) - 75) / 24) * plan.deployMs;
}

function timeline(deployment: Deployment, plan: Plan): (p: number) => number {
  const created = Date.parse(deployment.createdAt);
  const finished = deployment.finishedAt ? Date.parse(deployment.finishedAt) : null;
  const speed = getSpeed();

  if (!deployment.startedAt) {
    // Still queued, or cancelled before a builder picked it up.
    const end = finished ?? created + plan.queuedMs / speed;
    return (p) => created + (Math.min(p, 5) / 5) * (end - created);
  }

  const started = Date.parse(deployment.startedAt);
  const succeeded = finished !== null && deployment.status !== "failed" && deployment.status !== "cancelled";
  const total = nominalOffset(plan, succeeded ? 99 : Math.max(deployment.progress, 6));
  return (p) => {
    if (p < 5) return created + (p / 5) * (started - created);
    if (finished === null) return started + nominalOffset(plan, p) / speed;
    return started + Math.min(1, nominalOffset(plan, p) / total) * (finished - started);
  };
}

/** Every line the deployment has printed so far, oldest first. */
export function deploymentLogLines(db: MockDb, deployment: Deployment): LogLine[] {
  const lines = visibleScript(db, deployment);
  if (lines.length === 0) return [];

  const service = db.services.find((item) => item.id === deployment.serviceId);
  const plan = planFor(deployment, service?.source.type ?? "docker");
  const timeAt = timeline(deployment, plan);
  const started = deployment.startedAt ? Date.parse(deployment.startedAt) : Date.parse(deployment.createdAt);
  const finished = deployment.finishedAt ? Date.parse(deployment.finishedAt) : timeAt(99);

  return lines.map((line, index) => {
    const ts = Math.round(timeAt(line.p));
    const message = fillTimePlaceholders(line.message, ts)
      .replace("{buildTime}", formatBuildDuration(ts - started))
      .replace("{totalTime}", formatBuildDuration(finished - started));
    return {
      id: `${deployment.id}:${index}`,
      ts: iso(ts),
      level: line.level,
      stream: line.stream,
      message,
    };
  });
}
