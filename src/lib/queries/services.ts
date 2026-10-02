"use client";

import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { api, type UpdateServiceInput } from "@/lib/api";
import type { ContainerAction, ID, Position, Service } from "@/lib/types";

import {
  CASCADE_ENTITIES,
  invalidateEntities,
  purgeEntities,
  queryKeys,
  SERVICE_STATE_ENTITIES,
  type MaybeId,
  type QueryHookOptions,
  type ServiceFilter,
} from "./keys";

/** Lifecycle action of a service (same vocabulary as a container action). */
export type ServiceAction = ContainerAction;

export function useServices(filter?: ServiceFilter, options?: QueryHookOptions) {
  return useQuery({
    queryKey: queryKeys.services.list(filter),
    queryFn: () => api.services.list(filter),
    enabled: options?.enabled,
    placeholderData: keepPreviousData,
  });
}

export function useService(serviceId: MaybeId) {
  return useQuery({
    queryKey: queryKeys.services.detail(serviceId),
    queryFn: serviceId ? () => api.services.get(serviceId) : skipToken,
  });
}

export function useConnections(projectId: MaybeId) {
  return useQuery({
    queryKey: queryKeys.connections.list(projectId),
    queryFn: projectId ? () => api.services.listConnections(projectId) : skipToken,
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: ID; patch: UpdateServiceInput }) =>
      api.services.update(id, patch),
    // A rename rewrites variable references; a database service mirrors name and volume.
    onSuccess: () =>
      invalidateEntities(queryClient, [
        "services",
        "projects",
        "containers",
        "databases",
        "variables",
        "metrics",
        "activity",
      ]),
  });
}

interface PositionsSnapshot {
  lists: Array<[QueryKey, Service[] | undefined]>;
  details: Array<[QueryKey, Service | undefined]>;
}

/**
 * Optimistic: every cached services list and detail moves at once, the cache
 * is restored on error, and nothing is refetched on success.
 */
export function useUpdateServicePositions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (positions: Record<ID, Position>) => api.services.updatePositions(positions),
    onMutate: async (positions): Promise<PositionsSnapshot> => {
      await queryClient.cancelQueries({ queryKey: queryKeys.services.all });
      const snapshot: PositionsSnapshot = {
        lists: queryClient.getQueriesData<Service[]>({ queryKey: queryKeys.services.lists() }),
        details: queryClient.getQueriesData<Service>({ queryKey: queryKeys.services.details() }),
      };
      const moved = (service: Service): Service =>
        service.id in positions ? { ...service, position: positions[service.id] } : service;
      queryClient.setQueriesData<Service[]>(
        { queryKey: queryKeys.services.lists() },
        (services) => services?.map(moved),
      );
      queryClient.setQueriesData<Service>(
        { queryKey: queryKeys.services.details() },
        (service) => (service ? moved(service) : undefined),
      );
      return snapshot;
    },
    onError: (_error, _positions, snapshot) => {
      if (!snapshot) return;
      for (const [key, data] of [...snapshot.lists, ...snapshot.details]) {
        queryClient.setQueryData(key, data);
      }
    },
  });
}

/**
 * Cascades to every collection. Nothing is awaited so the caller can navigate
 * away at once (a refetch of the removed service's detail would only fail).
 */
export function useDeleteService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ID) => api.services.delete(id),
    onSuccess: () => purgeEntities(queryClient, CASCADE_ENTITIES),
  });
}

export function useServiceAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: ID; action: ServiceAction }) => api.services[action](id),
    onSuccess: () => invalidateEntities(queryClient, SERVICE_STATE_ENTITIES),
  });
}

/** Connecting to a PostgreSQL service also adds a `DATABASE_URL` variable to the consumer. */
export function useConnectServices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { fromServiceId: ID; toServiceId: ID }) => api.services.connect(input),
    onSuccess: () =>
      invalidateEntities(queryClient, ["connections", "variables", "projects", "activity"]),
  });
}

export function useDisconnectServices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: ID) => api.services.disconnect(connectionId),
    onSuccess: () => invalidateEntities(queryClient, ["connections"]),
  });
}
