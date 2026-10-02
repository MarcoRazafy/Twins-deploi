"use client";

import { useMemo } from "react";

import { useServices } from "@/lib/queries";

import { groupServicesByRepo, isGithubService } from "../lib/github-services";

/**
 * Every GitHub service across projects, plus the same list grouped by
 * repository. Callers share one network request (same query key).
 */
export function useGithubServices() {
  const query = useServices();
  const data = query.data;

  const services = useMemo(() => (data ?? []).filter(isGithubService), [data]);
  const byRepo = useMemo(() => groupServicesByRepo(services), [services]);

  return {
    services,
    byRepo,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
