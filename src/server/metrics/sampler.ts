/**
 * Metric sampling: one `docker stats --no-stream` for the whole host, one
 * metric_samples row per managed container. Network counters are cumulative
 * since the container started, in KB, as the schema says.
 */

import { db } from "../db";
import { readStats } from "../docker";
import { emit } from "../events";

export const SAMPLE_RETENTION_MS = 7 * 24 * 3_600_000;

/** Resolves with the number of samples written. */
export async function sampleMetrics(now: Date = new Date()): Promise<number> {
  const services = await db().service.findMany({
    where: { containerName: { not: null }, status: { in: ["online", "restarting", "building", "deploying"] } },
    select: { id: true, containerName: true },
  });
  if (services.length === 0) return 0;

  const stats = new Map((await readStats()).map((entry) => [entry.name, entry]));
  const rows = services.flatMap((service) => {
    const entry = stats.get(service.containerName ?? "");
    return entry
      ? [
          {
            serviceId: service.id,
            ts: now,
            cpuPercent: entry.cpuPercent,
            memoryMb: entry.memoryMb,
            netRxKb: entry.netRxKb,
            netTxKb: entry.netTxKb,
          },
        ]
      : [];
  });
  if (rows.length === 0) return 0;
  await db().metricSample.createMany({ data: rows });
  await emit(["metrics", "containers"]);
  return rows.length;
}

/** Hourly: samples older than 7 days and expired sessions. */
export async function purgeExpiredData(now: Date = new Date()): Promise<{ samples: number; sessions: number }> {
  const samples = await db().metricSample.deleteMany({
    where: { ts: { lt: new Date(now.getTime() - SAMPLE_RETENTION_MS) } },
  });
  const sessions = await db().session.deleteMany({ where: { expiresAt: { lt: now } } });
  return { samples: samples.count, sessions: sessions.count };
}
