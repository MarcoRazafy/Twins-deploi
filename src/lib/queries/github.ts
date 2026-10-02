"use client";

import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api, type ImportRepoInput } from "@/lib/api";

import {
  invalidateEntities,
  queryKeys,
  SERVICE_CREATED_ENTITIES,
  type GithubReposParams,
  type QueryHookOptions,
} from "./keys";

export function useGithubConnection() {
  return useQuery({
    queryKey: queryKeys.github.connection(),
    queryFn: () => api.github.getConnection(),
  });
}

/** Rejects with `forbidden` while GitHub is not connected: pass `enabled` accordingly. */
export function useGithubRepos(params?: GithubReposParams, options?: QueryHookOptions) {
  return useQuery({
    queryKey: queryKeys.github.repos(params),
    queryFn: () => api.github.listRepos(params),
    enabled: options?.enabled,
    placeholderData: keepPreviousData,
  });
}

export function useGithubBranches(repo: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.github.branches(repo),
    queryFn: repo ? () => api.github.listBranches(repo) : skipToken,
  });
}

export function useConnectGithub() {
  const queryClient = useQueryClient();
  return useMutation({
    // The real backend needs a personal access token; the simulator ignores it.
    mutationFn: (input: { token?: string } | void) => api.github.connect(input ?? undefined),
    onSuccess: () => invalidateEntities(queryClient, ["github", "activity"]),
  });
}

/**
 * Repositories and branches can no longer be listed afterwards: they are only
 * marked stale, because refetching them would reject with `forbidden`.
 */
export function useDisconnectGithub() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.github.disconnect(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.github.connection() });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["github", "repos"], refetchType: "none" }),
        queryClient.invalidateQueries({ queryKey: ["github", "branches"], refetchType: "none" }),
        invalidateEntities(queryClient, ["activity"]),
      ]);
    },
  });
}

export function useImportRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportRepoInput) => api.github.importRepo(input),
    onSuccess: () => invalidateEntities(queryClient, SERVICE_CREATED_ENTITIES),
  });
}
