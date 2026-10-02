"use client";

import { skipToken, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { MetricRange } from "@/lib/types";

import { queryKeys, type MaybeId } from "./keys";

const SERVICE_METRICS_POLL_MS = 15_000;
const OVERVIEW_POLL_MS = 30_000;

/** Refetches every 15 seconds; a new range keeps the current chart until its data arrives. */
export function useServiceMetrics(serviceId: MaybeId, range: MetricRange) {
  return useQuery({
    queryKey: queryKeys.metrics.service(serviceId, range),
    queryFn: serviceId ? () => api.metrics.getServiceMetrics(serviceId, range) : skipToken,
    refetchInterval: SERVICE_METRICS_POLL_MS,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === (serviceId ?? null) ? previous : undefined,
  });
}

/** Refetches every 30 seconds. */
export function usePlatformOverview() {
  return useQuery({
    queryKey: queryKeys.metrics.overview(),
    queryFn: () => api.metrics.getOverview(),
    refetchInterval: OVERVIEW_POLL_MS,
  });
}
