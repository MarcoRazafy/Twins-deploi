import { pluralize } from "@/lib/format";
import type { StatusTone } from "@/lib/status";
import type { ProjectStats } from "@/lib/types";

export interface ProjectHealth {
  tone: StatusTone;
  label: string;
  /** In-progress states pulse, like every in-flight status of the app. */
  pulse: boolean;
}

/**
 * One sentence about the whole project, by priority: an error always wins,
 * then work in progress, then services that were stopped on purpose.
 */
export function getProjectHealth(stats: ProjectStats): ProjectHealth {
  if (stats.services === 0) {
    return { tone: "neutral", label: "Aucun service", pulse: false };
  }
  if (stats.crashed > 0) {
    return {
      tone: "danger",
      label: pluralize(stats.crashed, "service en erreur", "services en erreur"),
      pulse: false,
    };
  }
  if (stats.inProgress > 0) {
    return {
      tone: "info",
      label:
        stats.inProgress > 1
          ? `${stats.inProgress} déploiements en cours`
          : "Déploiement en cours",
      pulse: true,
    };
  }
  if (stats.stopped === stats.services) {
    return {
      tone: "neutral",
      label: stats.services > 1 ? "Tous les services sont arrêtés" : "Service arrêté",
      pulse: false,
    };
  }
  if (stats.stopped > 0) {
    return {
      tone: "neutral",
      label: pluralize(stats.stopped, "service arrêté", "services arrêtés"),
      pulse: false,
    };
  }
  return { tone: "success", label: "Tout est en ligne", pulse: false };
}
