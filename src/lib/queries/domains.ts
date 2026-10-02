"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type CreateDomainInput, type UpdateDomainInput } from "@/lib/api";
import type { ID } from "@/lib/types";

import { invalidateEntities, queryKeys, type DomainFilter, type QueryHookOptions } from "./keys";

/** Domain counts live in the project summaries and the primary domain on the service. */
const DOMAIN_LINKED_ENTITIES = ["domains", "projects", "services", "activity"] as const;

export function useDomains(filter?: DomainFilter, options?: QueryHookOptions) {
  return useQuery({
    queryKey: queryKeys.domains.list(filter),
    queryFn: () => api.domains.list(filter),
    enabled: options?.enabled,
    placeholderData: keepPreviousData,
  });
}

export function useCreateDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDomainInput) => api.domains.create(input),
    onSuccess: () => invalidateEntities(queryClient, DOMAIN_LINKED_ENTITIES),
  });
}

export function useGenerateDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (serviceId: ID) => api.domains.generate(serviceId),
    onSuccess: () => invalidateEntities(queryClient, DOMAIN_LINKED_ENTITIES),
  });
}

export function useUpdateDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: ID; patch: UpdateDomainInput }) =>
      api.domains.update(id, patch),
    onSuccess: () => invalidateEntities(queryClient, ["domains"]),
  });
}

/** Resolves as `verifying`; the later steps arrive through the realtime bridge. */
export function useVerifyDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ID) => api.domains.verify(id),
    onSuccess: () => invalidateEntities(queryClient, ["domains", "services", "activity"]),
  });
}

export function useDeleteDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ID) => api.domains.delete(id),
    onSuccess: () => invalidateEntities(queryClient, DOMAIN_LINKED_ENTITIES),
  });
}
