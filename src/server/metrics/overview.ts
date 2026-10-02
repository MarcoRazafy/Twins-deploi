import { statfs } from "node:fs/promises";
import os from "node:os";

import type { PlatformOverview } from "@/lib/types";

import { db } from "../db";
import { toHostUsage, type HostBucketRow } from "../mappers/metrics";
import { planBuckets } from "./plan";

const DAY_MS = 86_400_000;
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
/** A deployment that went live counts as a success, even if it crashed later. */
const SUCCEEDED = ["active", "removed", "crashed"] as const;
const IN_FLIGHT = ["queued", "building", "deploying"] as const;
const DAYS_SHOWN = 14;

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isSucceeded(status: string): boolean {
  return SUCCEEDED.some((candidate) => candidate === status);
}

/** Used and total bytes of the root filesystem; zeros when it cannot be read. */
async function readDisk(): Promise<{ used: number; total: number }> {
  try {
    const stats = await statfs("/");
    return { used: (stats.blocks - stats.bfree) * stats.bsize, total: stats.blocks * stats.bsize };
  } catch {
    return { used: 0, total: 0 };
  }
}

/** `now` is a parameter for tests. */
export async function getOverview(now: number = Date.now()): Promise<PlatformOverview> {
  const since24h = new Date(now - DAY_MS);
  const since7d = new Date(now - 7 * DAY_MS);
  // "At 00:00 local" of the server: the days of the chart.
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const firstDay = new Date(today);
  firstDay.setDate(today.getDate() - (DAYS_SHOWN - 1));

  const plan = planBuckets("24h", now);
  const stride = `${plan.bucketMs / 1000} seconds`;
  const from = new Date(plan.start);
  const to = new Date(plan.end);

  const [projects, services, databases, domains, last24h, week, averageDuration, inProgress, recent, usageRows, disk] =
    await Promise.all([
      db().project.count(),
      db().service.groupBy({ by: ["status"], _count: { _all: true } }),
      db().managedDatabase.count(),
      db().domain.groupBy({ by: ["status"], _count: { _all: true } }),
      db().deployment.count({ where: { createdAt: { gte: since24h } } }),
      db().deployment.groupBy({
        by: ["status"],
        where: { createdAt: { gte: since7d } },
        _count: { _all: true },
      }),
      db().deployment.aggregate({
        where: { createdAt: { gte: since7d }, status: { in: [...SUCCEEDED] }, durationMs: { not: null } },
        _avg: { durationMs: true },
      }),
      db().deployment.count({ where: { status: { in: [...IN_FLIGHT] } } }),
      db().deployment.findMany({
        where: { createdAt: { gte: firstDay } },
        select: { createdAt: true, status: true },
      }),
      // Host curves: per service and bucket first, then summed over the services.
      db().$queryRaw<HostBucketRow[]>`
        WITH per_service AS (
          SELECT date_bin(${stride}::interval, "ts", TIMESTAMP '1970-01-01') AS bucket,
                 "serviceId", AVG("cpuPercent") AS cpu, AVG("memoryMb") AS memory
          FROM metric_samples
          WHERE "ts" >= ${from} AND "ts" < ${to}
          GROUP BY 1, 2
        )
        SELECT (EXTRACT(EPOCH FROM bucket) * 1000)::float8 AS t,
               SUM(cpu)::float8 AS cpu, SUM(memory)::float8 AS memory
        FROM per_service
        GROUP BY bucket
        ORDER BY bucket`,
      readDisk(),
    ]);

  const servicesWith = (...statuses: string[]): number =>
    services
      .filter((group) => statuses.includes(group.status))
      .reduce((total, group) => total + group._count._all, 0);
  const totalDomains = domains.reduce((total, group) => total + group._count._all, 0);
  const activeDomains = domains.find((group) => group.status === "active")?._count._all ?? 0;

  const succeeded = week.filter((group) => isSucceeded(group.status)).reduce((total, group) => total + group._count._all, 0);
  const failed = week.find((group) => group.status === "failed")?._count._all ?? 0;

  const deploymentsPerDay = Array.from({ length: DAYS_SHOWN }, (_, index) => {
    const start = new Date(today);
    start.setDate(today.getDate() - (DAYS_SHOWN - 1 - index));
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    const ofDay = recent.filter((item) => item.createdAt >= start && item.createdAt < end);
    return {
      date: start.toISOString(),
      succeeded: ofDay.filter((item) => isSucceeded(item.status)).length,
      failed: ofDay.filter((item) => item.status === "failed").length,
    };
  });

  const cpuCount = Math.max(1, os.cpus().length);
  const memoryTotal = os.totalmem();
  return {
    projects,
    services: {
      total: services.reduce((total, group) => total + group._count._all, 0),
      online: servicesWith("online"),
      inProgress: servicesWith("building", "deploying", "restarting"),
      crashed: servicesWith("crashed"),
      stopped: servicesWith("stopped"),
    },
    databases,
    domains: { total: totalDomains, active: activeDomains, pending: totalDomains - activeDomains },
    deployments: {
      last24h,
      successRate: succeeded + failed === 0 ? 100 : round((succeeded / (succeeded + failed)) * 100, 1),
      avgDurationMs: Math.round(averageDuration._avg.durationMs ?? 0),
      inProgress,
    },
    deploymentsPerDay,
    resources: {
      cpuPercent: round(Math.min(100, (os.loadavg()[0] / cpuCount) * 100), 1),
      memoryUsedMb: Math.round((memoryTotal - os.freemem()) / MIB),
      memoryTotalMb: Math.round(memoryTotal / MIB),
      diskUsedGb: round(disk.used / GIB, 1),
      diskTotalGb: round(disk.total / GIB, 1),
    },
    usage: toHostUsage(plan, usageRows, cpuCount),
  };
}
