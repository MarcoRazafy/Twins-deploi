"use client";

import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type CreateProjectInput, type UpdateProjectInput } from "@/lib/api";
import type { ID } from "@/lib/types";

import {
  CASCADE_ENTITIES,
  invalidateEntities,
  purgeEntities,
  queryKeys,
  type MaybeId,
} from "./keys";

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: () => api.projects.list(),
  });
}

export function useProject(projectId: MaybeId) {
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId),
    queryFn: projectId ? () => api.projects.get(projectId) : skipToken,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.projects.create(input),
    onSuccess: () => invalidateEntities(queryClient, ["projects", "activity"]),
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: ID; patch: UpdateProjectInput }) =>
      api.projects.update(id, patch),
    onSuccess: () => invalidateEntities(queryClient, ["projects", "activity"]),
  });
}

/**
 * Cascades to every collection. Nothing is awaited so the caller can navigate
 * away at once (a refetch of the removed project's detail would only fail).
 */
export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ID) => api.projects.delete(id),
    onSuccess: () => purgeEntities(queryClient, CASCADE_ENTITIES),
  });
}
