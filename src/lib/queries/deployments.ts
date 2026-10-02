"use client";

import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api, type Api, type DeploymentFilter } from "@/lib/api";
import type { ID } from "@/lib/types";

import {
  DEPLOYMENT_ENTITIES,
  invalidateEntities,
  queryKeys,
  type MaybeId,
  type QueryHookOptions,
} from "./keys";

/** Triggers a caller may request (the others are set by the backend). */
export type RequestedDeploymentTrigger = NonNullable<
  NonNullable<Parameters<Api["deployments"]["trigger"]>[1]>["trigger"]
>;

export function useDeployments(filter?: DeploymentFilter, options?: QueryHookOptions) {
  return useQuery({
    queryKey: queryKeys.deployments.list(filter),
    queryFn: () => api.deployments.list(filter),
    enabled: options?.enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDeployment(deploymentId: MaybeId) {
  return useQuery({
    queryKey: queryKeys.deployments.detail(deploymentId),
    queryFn: deploymentId ? () => api.deployments.get(deploymentId) : skipToken,
  });
}

/** An in-flight deployment of the same service is cancelled by the backend first. */
export function useTriggerDeployment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ serviceId, trigger }: { serviceId: ID; trigger?: RequestedDeploymentTrigger }) =>
      api.deployments.trigger(serviceId, trigger ? { trigger } : undefined),
    onSuccess: () => invalidateEntities(queryClient, DEPLOYMENT_ENTITIES),
  });
}

export function useRollbackDeployment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deploymentId: ID) => api.deployments.rollback(deploymentId),
    onSuccess: () => invalidateEntities(queryClient, DEPLOYMENT_ENTITIES),
  });
}

export function useCancelDeployment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deploymentId: ID) => api.deployments.cancel(deploymentId),
    onSuccess: () => invalidateEntities(queryClient, DEPLOYMENT_ENTITIES),
  });
}
