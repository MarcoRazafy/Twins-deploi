import type { MetricRange } from "@/lib/types";

/** Time buckets of a chart: fixed count, aligned on the epoch so that every caller sees the same ones. */
export interface BucketPlan {
  range: MetricRange;
  bucketMs: number;
  count: number;
  /** Epoch ms where the first bucket starts. */
  start: number;
  /** Epoch ms where the last bucket ends (exclusive); the last bucket contains `now`. */
  end: number;
}

const SPECS: Record<MetricRange, { bucketMs: number; count: number }> = {
  "1h": { bucketMs: 60_000, count: 60 },
  "6h": { bucketMs: 5 * 60_000, count: 72 },
  "24h": { bucketMs: 15 * 60_000, count: 96 },
  "7d": { bucketMs: 2 * 60 * 60_000, count: 84 },
};

export function planBuckets(range: MetricRange, now: number = Date.now()): BucketPlan {
  const { bucketMs, count } = SPECS[range];
  const last = Math.floor(now / bucketMs) * bucketMs;
  return { range, bucketMs, count, start: last - (count - 1) * bucketMs, end: last + bucketMs };
}
