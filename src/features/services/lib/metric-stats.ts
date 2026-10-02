import type { MetricPoint } from "@/lib/types";

export interface SeriesStats {
  current: number;
  average: number;
  peak: number;
}

/** Last, mean and maximum value of a series; null when it has no point. */
export function statsOf(points: MetricPoint[] | undefined): SeriesStats | null {
  if (!points || points.length === 0) return null;
  let sum = 0;
  let peak = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    sum += point.v;
    if (point.v > peak) peak = point.v;
  }
  return { current: points[points.length - 1].v, average: sum / points.length, peak };
}
