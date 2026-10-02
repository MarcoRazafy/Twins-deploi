import type { StatusTone } from "@/lib/status";
import type { PlatformOverview } from "@/lib/types";

export interface HealthSummary {
  tone: StatusTone;
  /** One short line under the value of a KPI. */
  hint: string;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count > 1 ? plural : singular}`;
}

/** Tone by health: a crash is danger, a stopped service a warning, a rollout is information. */
export function summarizeServices(services: PlatformOverview["services"]): HealthSummary {
  const { total, crashed, stopped, inProgress } = services;
  if (total === 0) return { tone: "neutral", hint: "Aucun service" };

  const parts: string[] = [];
  if (crashed > 0) parts.push(`${crashed} en erreur`);
  if (stopped > 0) parts.push(countLabel(stopped, "arrêté", "arrêtés"));
  if (inProgress > 0) parts.push(`${inProgress} en cours`);
  if (parts.length === 0) return { tone: "success", hint: "Tous opérationnels" };

  const tone: StatusTone = crashed > 0 ? "danger" : stopped > 0 ? "warning" : "info";
  return { tone, hint: parts.join(" · ") };
}

export function summarizeDomains(domains: PlatformOverview["domains"]): HealthSummary {
  if (domains.total === 0) return { tone: "neutral", hint: "Aucun domaine" };
  if (domains.pending > 0) return { tone: "warning", hint: `${domains.pending} en attente` };
  return { tone: "success", hint: "Tous vérifiés" };
}

/** 7-day success rate (0–100) of the deployments. */
export function successRateTone(rate: number): StatusTone {
  if (rate >= 90) return "success";
  if (rate >= 70) return "warning";
  return "danger";
}

/** Tone of a utilisation meter (0–100): calm below 70 %, warning from 70 %, danger from 90 %. */
export function usageTone(percent: number): StatusTone {
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warning";
  return "success";
}
