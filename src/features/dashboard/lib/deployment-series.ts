import type { PlatformOverview } from "@/lib/types";

export interface DeploymentDay {
  /** ISO date of the day (00:00 local). */
  date: string;
  /** X-axis label, unique within 14 consecutive days: "lun. 21". */
  label: string;
  /** Tooltip heading: "lundi 21 septembre". */
  longLabel: string;
  succeeded: number;
  failed: number;
  total: number;
}

export interface DeploymentSeriesSummary {
  succeeded: number;
  failed: number;
  total: number;
  /** 0–100, null when nothing was deployed. */
  successRate: number | null;
  /** The busiest day, null when nothing was deployed. */
  peak: DeploymentDay | null;
}

const shortFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric" });
const longFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function buildDeploymentDays(
  days: PlatformOverview["deploymentsPerDay"],
): DeploymentDay[] {
  return days.map((day) => {
    const date = new Date(day.date);
    return {
      date: day.date,
      label: shortFormatter.format(date),
      longLabel: longFormatter.format(date),
      succeeded: day.succeeded,
      failed: day.failed,
      total: day.succeeded + day.failed,
    };
  });
}

export function summarizeDeploymentDays(days: readonly DeploymentDay[]): DeploymentSeriesSummary {
  let succeeded = 0;
  let failed = 0;
  let peak: DeploymentDay | null = null;

  for (const day of days) {
    succeeded += day.succeeded;
    failed += day.failed;
    if (day.total > 0 && (peak === null || day.total > peak.total)) peak = day;
  }

  const total = succeeded + failed;
  return {
    succeeded,
    failed,
    total,
    successRate: total > 0 ? (succeeded / total) * 100 : null,
    peak,
  };
}
