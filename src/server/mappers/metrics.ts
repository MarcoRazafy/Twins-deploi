import type { MetricPoint, ServiceMetrics } from "@/lib/types";

import type { BucketPlan } from "../metrics/plan";

/** One aggregated bucket of a service, as the SQL returns it (null: nothing usable in the bucket). */
export interface ServiceBucketRow {
  /** Epoch ms of the bucket start. */
  t: number;
  /** Percent of one CPU (docker stats). */
  cpu: number | null;
  memory: number | null;
  /** KB/s. */
  rx: number | null;
  tx: number | null;
}

/** One bucket summed over every service. */
export interface HostBucketRow {
  t: number;
  cpu: number | null;
  memory: number | null;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** A complete series: one point per bucket of the plan, 0 where nothing was sampled. */
function seriesOf<T extends { t: number }>(
  plan: BucketPlan,
  rows: readonly T[],
  pick: (row: T) => number | null,
  convert: (value: number) => number,
): MetricPoint[] {
  const values = new Map<number, number>();
  for (const row of rows) {
    const raw = pick(row);
    if (raw !== null && Number.isFinite(raw)) values.set(Math.round(row.t), convert(raw));
  }
  return Array.from({ length: plan.count }, (_, index) => {
    const t = plan.start + index * plan.bucketMs;
    return { t, v: values.get(t) ?? 0 };
  });
}

export function toServiceMetrics(
  serviceId: string,
  plan: BucketPlan,
  rows: readonly ServiceBucketRow[],
  limits: { cpu: number; memoryMb: number },
): ServiceMetrics {
  // docker reports a percentage of one CPU: against a 0.5 vCPU limit, 50 is "100 % of the limit".
  const cpuLimit = limits.cpu > 0 ? limits.cpu : 1;
  return {
    serviceId,
    range: plan.range,
    cpu: seriesOf(plan, rows, (row) => row.cpu, (value) => round(Math.min(100, Math.max(0, value / cpuLimit)), 2)),
    memory: seriesOf(plan, rows, (row) => row.memory, (value) => round(Math.max(0, value), 2)),
    networkIn: seriesOf(plan, rows, (row) => row.rx, (value) => round(Math.max(0, value), 2)),
    networkOut: seriesOf(plan, rows, (row) => row.tx, (value) => round(Math.max(0, value), 2)),
    // Not measured yet: they need a request counter in the proxy or the app.
    requests: [],
    responseTime: [],
    limits,
  };
}

/** Host-level curves: summed CPU over the number of cores, summed memory. */
export function toHostUsage(
  plan: BucketPlan,
  rows: readonly HostBucketRow[],
  cpuCount: number,
): { cpu: MetricPoint[]; memory: MetricPoint[] } {
  const cores = Math.max(1, cpuCount);
  return {
    cpu: seriesOf(plan, rows, (row) => row.cpu, (value) => round(Math.min(100, Math.max(0, value / cores)), 1)),
    memory: seriesOf(plan, rows, (row) => row.memory, (value) => round(Math.max(0, value), 1)),
  };
}
