import { EMPTY_VALUE, formatDate, formatDuration } from "@/lib/format";
import type { Deployment, DeploymentStatus, LogLine } from "@/lib/types";

/** What a deployment is about: the commit message, else the image reference. */
export function deploymentTitle(deployment: Deployment): string {
  return deployment.commit?.message ?? deployment.image ?? "Déploiement";
}

/** "dpl_8f3a91c2d4e5" → "8f3a91c2": short enough for a file name. */
export function shortDeploymentId(id: string): string {
  const separator = id.indexOf("_");
  return (separator >= 0 ? id.slice(separator + 1) : id).slice(0, 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// Status filter (?status=)
// ─────────────────────────────────────────────────────────────────────────────

export const STATUS_FILTER_KEYS = ["all", "in_flight", "succeeded", "failed", "cancelled"] as const;
export type StatusFilterKey = (typeof STATUS_FILTER_KEYS)[number];

export const STATUS_FILTERS: Record<
  StatusFilterKey,
  { label: string; statuses: DeploymentStatus[] | undefined }
> = {
  all: { label: "Tous", statuses: undefined },
  in_flight: { label: "En cours", statuses: ["queued", "building", "deploying"] },
  // A superseded deployment succeeded once: it only lost its place to a newer one.
  succeeded: { label: "Réussis", statuses: ["active", "removed"] },
  failed: { label: "Échoués", statuses: ["failed", "crashed"] },
  cancelled: { label: "Annulés", statuses: ["cancelled"] },
};

export function isStatusFilterKey(value: string): value is StatusFilterKey {
  return (STATUS_FILTER_KEYS as readonly string[]).includes(value);
}

// Other pages deep-link with whatever reads naturally (a raw status, "failed"…).
const STATUS_FILTER_ALIASES = new Map<string, StatusFilterKey>([
  ["in-flight", "in_flight"],
  ["inflight", "in_flight"],
  ["in_progress", "in_flight"],
  ["running", "in_flight"],
  ["queued", "in_flight"],
  ["building", "in_flight"],
  ["deploying", "in_flight"],
  ["success", "succeeded"],
  ["active", "succeeded"],
  ["removed", "succeeded"],
  ["failure", "failed"],
  ["error", "failed"],
  ["crashed", "failed"],
  ["canceled", "cancelled"],
]);

export function parseStatusFilter(value: string | null): StatusFilterKey {
  if (!value) return "all";
  const key = value.toLowerCase();
  if (isStatusFilterKey(key)) return key;
  return STATUS_FILTER_ALIASES.get(key) ?? "all";
}

// ─────────────────────────────────────────────────────────────────────────────
// Search and grouping
// ─────────────────────────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Commit message, sha, image or service name contains `query` (accents ignored). */
export function matchesDeploymentSearch(
  deployment: Deployment,
  serviceName: string,
  query: string,
): boolean {
  const needle = normalizeText(query.trim());
  if (!needle) return true;
  const fields = [
    deployment.commit?.message,
    deployment.commit?.sha,
    deployment.image,
    serviceName,
  ];
  return fields.some((field) => field !== null && field !== undefined && normalizeText(field).includes(needle));
}

export interface DeploymentGroup {
  key: string;
  label: string;
  items: Deployment[];
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Buckets deployments by local calendar day, in the order they first appear.
 * `now` comes from `useNow`; while it is 0 (not ticking yet) every label is
 * an absolute date, which is always correct.
 */
export function groupDeploymentsByDay(
  items: readonly Deployment[],
  now: number,
): DeploymentGroup[] {
  const today = now > 0 ? startOfDay(now) : null;
  const yesterday = today === null ? null : startOfDay(today - 1);
  const groups = new Map<number, DeploymentGroup>();

  for (const item of items) {
    const day = startOfDay(Date.parse(item.createdAt));
    let group = groups.get(day);
    if (!group) {
      const label =
        day === today ? "Aujourd’hui" : day === yesterday ? "Hier" : formatDate(day);
      group = { key: String(day), label, items: [] };
      groups.set(day, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Timing
// ─────────────────────────────────────────────────────────────────────────────

/** A queued deployment has not started yet: its wait counts from creation. */
export function deploymentStartTime(deployment: Deployment): number {
  return Date.parse(deployment.startedAt ?? deployment.createdAt);
}

/** Final build + deploy time of a finished deployment, null when unknown. */
export function finishedDurationMs(deployment: Deployment): number | null {
  if (deployment.durationMs !== null) return deployment.durationMs > 0 ? deployment.durationMs : null;
  if (deployment.startedAt && deployment.finishedAt) {
    const elapsed = Date.parse(deployment.finishedAt) - Date.parse(deployment.startedAt);
    return elapsed > 0 ? elapsed : null;
  }
  return null;
}

export function formatElapsed(ms: number | null): string {
  return ms === null ? EMPTY_VALUE : formatDuration(ms);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline
// ─────────────────────────────────────────────────────────────────────────────

export const PIPELINE_STEPS = [
  { key: "queued", label: "File d’attente" },
  { key: "building", label: "Build" },
  { key: "deploying", label: "Déploiement" },
  { key: "active", label: "Actif" },
] as const;

export const LAST_PIPELINE_STEP = PIPELINE_STEPS.length - 1;

export type StepState = "done" | "current" | "pending" | "failed" | "cancelled";

/**
 * Which step an aborted (failed or cancelled) deployment stopped at, read from
 * the streams its logs went through: the record itself does not keep it.
 */
export function abortedStepIndex(lines: readonly LogLine[]): number {
  let step = 0;
  for (const line of lines) {
    if (line.stream === "deploy" || line.stream === "runtime") return 2;
    if (line.stream === "build") step = 1;
  }
  return step;
}

export function getPipelineStates(status: DeploymentStatus, abortedAt: number): StepState[] {
  switch (status) {
    case "queued":
      return ["current", "pending", "pending", "pending"];
    case "building":
      return ["done", "current", "pending", "pending"];
    case "deploying":
      return ["done", "done", "current", "pending"];
    case "active":
    case "removed":
      return ["done", "done", "done", "done"];
    // It went live, then the process exited.
    case "crashed":
      return ["done", "done", "done", "failed"];
    case "failed":
    case "cancelled": {
      const stopped: StepState = status === "failed" ? "failed" : "cancelled";
      return PIPELINE_STEPS.map((_, index) =>
        index < abortedAt ? "done" : index === abortedAt ? stopped : "pending",
      );
    }
  }
}

export function stepCaption(index: number, state: StepState, status: DeploymentStatus): string {
  switch (state) {
    case "done":
      if (index !== LAST_PIPELINE_STEP) return "Terminé";
      return status === "removed" ? "Remplacé" : "En ligne";
    case "current":
      return "En cours";
    case "pending":
      return "En attente";
    case "failed":
      return index === LAST_PIPELINE_STEP ? "En erreur" : "Échec";
    case "cancelled":
      return "Annulé";
  }
}
