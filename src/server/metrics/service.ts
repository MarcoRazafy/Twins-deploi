import { METRIC_RANGES, type ServiceMetrics } from "@/lib/types";

import { db } from "../db";
import { notFound, validation } from "../errors";
import { toServiceMetrics, type ServiceBucketRow } from "../mappers/metrics";
import { planBuckets } from "./plan";

/**
 * Samples of a service aggregated into the buckets of `range` with a single
 * query (date_bin, PostgreSQL 14+). The series are always complete.
 * - cpu: average, as a percentage of the service's CPU limit;
 * - memory: average MB;
 * - network: KB/s, the average of the per-sample rates derived from the
 *   cumulative counters; a counter that goes down (container restarted) counts as 0.
 * `now` is a parameter for tests.
 */
export async function getServiceMetrics(
  serviceId: string,
  rawRange: unknown,
  now: number = Date.now(),
): Promise<ServiceMetrics> {
  const range = METRIC_RANGES.find((candidate) => candidate === rawRange);
  if (range === undefined) throw validation("Cette période n’est pas disponible.", "range");
  const service = await db().service.findUnique({
    where: { id: serviceId },
    select: { cpuLimit: true, memoryLimitMb: true },
  });
  if (!service) throw notFound("Service");

  const plan = planBuckets(range, now);
  const stride = `${plan.bucketMs / 1000} seconds`;
  // One bucket before the window: the first sample of the window needs its predecessor for a rate.
  const lookback = new Date(plan.start - plan.bucketMs);
  const from = new Date(plan.start);
  const to = new Date(plan.end);

  const rows = await db().$queryRaw<ServiceBucketRow[]>`
    WITH samples AS (
      SELECT "ts", "cpuPercent", "memoryMb",
             "netRxKb" - LAG("netRxKb") OVER w AS rx_delta,
             "netTxKb" - LAG("netTxKb") OVER w AS tx_delta,
             EXTRACT(EPOCH FROM ("ts" - LAG("ts") OVER w))::float8 AS dt
      FROM metric_samples
      WHERE "serviceId" = ${serviceId} AND "ts" >= ${lookback} AND "ts" < ${to}
      WINDOW w AS (ORDER BY "ts", "id")
    )
    SELECT (EXTRACT(EPOCH FROM date_bin(${stride}::interval, "ts", TIMESTAMP '1970-01-01')) * 1000)::float8 AS t,
           AVG("cpuPercent")::float8 AS cpu,
           AVG("memoryMb")::float8 AS memory,
           AVG(GREATEST(rx_delta, 0) / NULLIF(dt, 0))::float8 AS rx,
           AVG(GREATEST(tx_delta, 0) / NULLIF(dt, 0))::float8 AS tx
    FROM samples
    WHERE "ts" >= ${from}
    GROUP BY 1
    ORDER BY 1`;

  return toServiceMetrics(serviceId, plan, rows, {
    cpu: service.cpuLimit,
    memoryMb: service.memoryLimitMb,
  });
}
