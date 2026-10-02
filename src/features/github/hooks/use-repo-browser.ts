"use client";

import { useMemo, useState } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useGithubRepos, type GithubReposParams } from "@/lib/queries";

import { useGithubServices } from "./use-github-services";

export type RepoStatusFilter = "all" | "deployed" | "undeployed";

/**
 * Search, owner and deployment filters over the repositories of the connected
 * account. Search and owner are sent to the API (debounced); the deployment
 * filter is derived from the services already created from each repository.
 */
export function useRepoBrowser({ enabled = true }: { enabled?: boolean } = {}) {
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState<string | null>(null);
  const [status, setStatus] = useState<RepoStatusFilter>("all");

  const debouncedSearch = useDebouncedValue(search, 250).trim();
  const params: GithubReposParams = {};
  if (debouncedSearch) params.query = debouncedSearch;
  if (owner) params.owner = owner;

  const repos = useGithubRepos(params, { enabled });
  const { byRepo } = useGithubServices();

  const repoList = repos.data;
  const visible = useMemo(() => {
    const list = repoList ?? [];
    if (status === "all") return list;
    return list.filter((repo) => byRepo.has(repo.fullName) === (status === "deployed"));
  }, [repoList, byRepo, status]);

  return {
    search,
    setSearch,
    owner,
    setOwner,
    status,
    setStatus,
    repos,
    visible,
    byRepo,
    hasFilters: search.trim() !== "" || owner !== null || status !== "all",
    /** What is on screen still answers the previous filters. */
    isUpdating: search.trim() !== debouncedSearch || repos.isPlaceholderData,
    reset: () => {
      setSearch("");
      setOwner(null);
      setStatus("all");
    },
  };
}
