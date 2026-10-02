import type { ProgressTone } from "@/components/shared/progress-bar";
import type { Container, ContainerPort, ContainerState, DockerHubImage } from "@/lib/types";

/** Colour of a usage bar: calm until 70 %, warning until 90 %, then danger. */
export function usageTone(percent: number): ProgressTone {
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warning";
  return "success";
}

export function memoryPercent(container: Container): number {
  if (container.memoryLimitMb <= 0) return 0;
  return Math.min(100, (container.memoryUsageMb / container.memoryLimitMb) * 100);
}

export function formatPort(port: ContainerPort): string {
  return `${port.host} → ${port.container}/${port.protocol}`;
}

export interface ContainerTotals {
  running: number;
  total: number;
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
}

export function summarizeContainers(containers: readonly Container[]): ContainerTotals {
  const totals: ContainerTotals = {
    running: 0,
    total: containers.length,
    cpuPercent: 0,
    memoryUsageMb: 0,
    memoryLimitMb: 0,
  };
  for (const container of containers) {
    if (container.state === "running") totals.running += 1;
    totals.cpuPercent += container.cpuPercent;
    totals.memoryUsageMb += container.memoryUsageMb;
    totals.memoryLimitMb += container.memoryLimitMb;
  }
  return totals;
}

export function isActive(state: ContainerState): boolean {
  return state === "running" || state === "restarting" || state === "paused";
}

export const canStart = (state: ContainerState) => state === "exited" || state === "created";
export const canStop = (state: ContainerState) => state === "running" || state === "paused";
export const canRestart = (state: ContainerState) =>
  state === "running" || state === "paused" || state === "exited";

export type HubCategoryFilter = "all" | DockerHubImage["category"];

export const HUB_CATEGORIES: ReadonlyArray<{ value: HubCategoryFilter; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "database", label: "Bases de données" },
  { value: "cache", label: "Cache" },
  { value: "web", label: "Web" },
  { value: "tool", label: "Outils" },
  { value: "runtime", label: "Runtimes" },
  { value: "monitoring", label: "Monitoring" },
];
