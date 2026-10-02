"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  api,
  type BulkUpsertVariablesInput,
  type CreateVariableInput,
  type UpdateVariableInput,
  type VariableFilter,
} from "@/lib/api";
import type { ID } from "@/lib/types";

import { invalidateEntities, queryKeys, type QueryHookOptions } from "./keys";

export function useVariables(filter?: VariableFilter, options?: QueryHookOptions) {
  return useQuery({
    queryKey: queryKeys.variables.list(filter),
    queryFn: () => api.variables.list(filter),
    enabled: options?.enabled,
    placeholderData: keepPreviousData,
  });
}

/** Variable counts live in the project summaries, hence "projects". */
export function useCreateVariable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVariableInput) => api.variables.create(input),
    onSuccess: () => invalidateEntities(queryClient, ["variables", "projects", "activity"]),
  });
}

export function useUpdateVariable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: ID; patch: UpdateVariableInput }) =>
      api.variables.update(id, patch),
    onSuccess: () => invalidateEntities(queryClient, ["variables", "activity"]),
  });
}

export function useDeleteVariable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ID) => api.variables.delete(id),
    onSuccess: () => invalidateEntities(queryClient, ["variables", "projects", "activity"]),
  });
}

export function useBulkUpsertVariables() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkUpsertVariablesInput) => api.variables.bulkUpsert(input),
    onSuccess: () => invalidateEntities(queryClient, ["variables", "projects", "activity"]),
  });
}
