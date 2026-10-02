"use client";

import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { api, type Unsubscribe } from "@/lib/api";
import { isDeploymentInFlight } from "@/lib/status";
import type { ID, LogLine } from "@/lib/types";

import { useDeployment } from "./deployments";
import { useContainers } from "./docker";
import { queryKeys, type LogStreamKind, type MaybeId } from "./keys";

/** Lines kept per stream: the oldest are dropped first. */
export const MAX_LOG_LINES = 5000;

export interface LogStreamResult {
  /** Oldest first. Line objects stay the same between renders: lines are appended, never rebuilt. */
  lines: LogLine[];
  /** Nothing to show yet and the history is still on its way. */
  isLoading: boolean;
  isStreaming: boolean;
  error: Error | null;
}

interface LogSource {
  kind: LogStreamKind;
  subscribe: (id: ID, onLines: (lines: LogLine[]) => void) => Unsubscribe;
  load: (id: ID) => Promise<LogLine[]>;
}

const DEPLOYMENT_LOGS: LogSource = {
  kind: "deployment",
  subscribe: (id, onLines) => api.deployments.subscribeLogs(id, onLines),
  load: (id) => api.deployments.getLogs(id),
};

const CONTAINER_LOGS: LogSource = {
  kind: "container",
  subscribe: (id, onLines) => api.docker.subscribeContainerLogs(id, onLines),
  load: (id) => api.docker.getContainerLogs(id),
};

const NO_LINES: LogLine[] = [];

function byTime(a: LogLine, b: LogLine): number {
  return Date.parse(a.ts) - Date.parse(b.ts);
}

/** Checks the order of `lines` from index `from` (the first index that may be out of place). */
function isChronological(lines: readonly LogLine[], from: number): boolean {
  for (let index = from; index < lines.length; index += 1) {
    if (byTime(lines[index], lines[index - 1]) < 0) return false;
  }
  return true;
}

/**
 * Adds the lines `current` does not hold yet (by id), keeps the whole list in
 * chronological order and caps it. Existing line objects are reused, and the
 * same array comes back when nothing was new.
 */
function mergeLines(current: LogLine[] | undefined, incoming: readonly LogLine[]): LogLine[] {
  const base = current ?? NO_LINES;
  const known = new Set<string>();
  for (const line of base) known.add(line.id);

  const fresh: LogLine[] = [];
  for (const line of incoming) {
    if (known.has(line.id)) continue;
    known.add(line.id);
    fresh.push(line);
  }
  if (fresh.length === 0) return base;

  const merged = base.length === 0 ? fresh : base.concat(fresh);
  if (!isChronological(merged, Math.max(base.length, 1))) merged.sort(byTime);
  return merged.length > MAX_LOG_LINES ? merged.slice(merged.length - MAX_LOG_LINES) : merged;
}

function useLogStream(source: LogSource, id: MaybeId, streaming: boolean): LogStreamResult {
  const queryClient = useQueryClient();

  // Declared before the history query on purpose: effects run in order, so the
  // subscription is live before the history request starts and no line can
  // fall between the two.
  useEffect(() => {
    if (!id) return;
    const key = queryKeys.logs.stream(source.kind, id);
    return source.subscribe(id, (incoming) => {
      queryClient.setQueryData<LogLine[]>(key, (current) => mergeLines(current, incoming));
    });
  }, [queryClient, source, id]);

  const history = useQuery({
    queryKey: queryKeys.logs.stream(source.kind, id),
    queryFn: id
      ? async () => {
          const loaded = await source.load(id);
          const cached = queryClient.getQueryData<LogLine[]>(
            queryKeys.logs.stream(source.kind, id),
          );
          return mergeLines(cached, loaded);
        }
      : skipToken,
    staleTime: Infinity,
    // Nothing listens while unmounted: reading the history again closes that gap.
    refetchOnMount: "always",
    // Arrays of thousands of lines are merged by `mergeLines`, not diffed.
    structuralSharing: false,
  });

  const { refetch } = history;
  const previous = useRef({ id, streaming });
  useEffect(() => {
    const last = previous.current;
    previous.current = { id, streaming };
    if (id && last.id === id && last.streaming && !streaming) void refetch();
  }, [id, streaming, refetch]);

  const lines = history.data ?? NO_LINES;
  return {
    lines,
    isLoading: history.isFetching && lines.length === 0,
    isStreaming: Boolean(id) && streaming,
    error: history.error,
  };
}

/**
 * History plus live tail of a deployment. Streaming lasts while the deployment
 * is queued, building or deploying; the history is read again when it ends.
 */
export function useDeploymentLogs(deploymentId: MaybeId): LogStreamResult {
  const deployment = useDeployment(deploymentId);
  const streaming = deployment.data ? isDeploymentInFlight(deployment.data.status) : false;
  return useLogStream(DEPLOYMENT_LOGS, deploymentId, streaming);
}

/** History plus live tail of a container. Streaming lasts while the container is running. */
export function useContainerLogs(containerId: MaybeId): LogStreamResult {
  const containers = useContainers(undefined, {
    enabled: Boolean(containerId),
    refetchInterval: false,
  });
  const container = containers.data?.find((item) => item.id === containerId);
  return useLogStream(CONTAINER_LOGS, containerId, container?.state === "running");
}
