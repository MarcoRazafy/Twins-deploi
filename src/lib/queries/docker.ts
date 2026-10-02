"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type DeployImageInput } from "@/lib/api";
import type { ContainerAction, ID } from "@/lib/types";

import {
  invalidateEntities,
  queryKeys,
  SERVICE_CREATED_ENTITIES,
  SERVICE_STATE_ENTITIES,
  type ContainerFilter,
  type PollingQueryOptions,
} from "./keys";

const CONTAINER_POLL_MS = 5_000;

/** Polls every 5 seconds by default so CPU, memory and network figures stay live. */
export function useContainers(filter?: ContainerFilter, options?: PollingQueryOptions) {
  return useQuery({
    queryKey: queryKeys.containers.list(filter),
    queryFn: () => api.docker.listContainers(filter),
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval ?? CONTAINER_POLL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useDockerImages() {
  return useQuery({
    queryKey: queryKeys.images.list(),
    queryFn: () => api.docker.listImages(),
  });
}

/** An empty query lists the popular images. */
export function useDockerHubSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.images.hub(query),
    queryFn: () => api.docker.searchHub(query),
    placeholderData: keepPreviousData,
  });
}

export function useContainerAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ containerId, action }: { containerId: ID; action: ContainerAction }) =>
      api.docker.containerAction(containerId, action),
    onSuccess: () => invalidateEntities(queryClient, SERVICE_STATE_ENTITIES),
  });
}

/** Rejects with `conflict` while a container still uses the image. */
export function useRemoveDockerImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ID) => api.docker.removeImage(id),
    onSuccess: () => invalidateEntities(queryClient, ["images", "metrics"]),
  });
}

export function usePruneDockerImages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.docker.pruneImages(),
    onSuccess: () => invalidateEntities(queryClient, ["images", "metrics"]),
  });
}

export function useDeployImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeployImageInput) => api.docker.deployImage(input),
    onSuccess: () => invalidateEntities(queryClient, [...SERVICE_CREATED_ENTITIES, "images"]),
  });
}
