"use client";

import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api, type CreateDatabaseInput, type UpdateDatabaseInput } from "@/lib/api";
import type { CommandRun, ID } from "@/lib/types";

import {
  invalidateEntities,
  queryKeys,
  SERVICE_STATE_ENTITIES,
  type DatabaseFilter,
  type MaybeId,
  type TableDataParams,
} from "./keys";

export function useDatabases(filter?: DatabaseFilter) {
  return useQuery({
    queryKey: queryKeys.databases.list(filter),
    queryFn: () => api.databases.list(filter),
    placeholderData: keepPreviousData,
  });
}

export function useDatabase(databaseId: MaybeId) {
  return useQuery({
    queryKey: queryKeys.databases.detail(databaseId),
    queryFn: databaseId ? () => api.databases.get(databaseId) : skipToken,
  });
}

/** Rejects with `not_found` for a service that is not a database. */
export function useDatabaseByService(serviceId: MaybeId) {
  return useQuery({
    queryKey: queryKeys.databases.byService(serviceId),
    queryFn: serviceId ? () => api.databases.getByService(serviceId) : skipToken,
  });
}

/** `enabled: false` while the database is not reachable yet (first deployment in progress). */
export function useDatabaseTables(databaseId: MaybeId, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.databases.tables(databaseId),
    queryFn: databaseId ? () => api.databases.listTables(databaseId) : skipToken,
    enabled: options?.enabled ?? true,
  });
}

/** Paging keeps the current rows on screen; another table never borrows them. */
export function useDatabaseTableData(
  databaseId: MaybeId,
  table: string | null | undefined,
  params?: TableDataParams,
) {
  return useQuery({
    queryKey: queryKeys.databases.tableData(databaseId, table, params),
    queryFn:
      databaseId && table
        ? () => api.databases.getTableData(databaseId, table, params)
        : skipToken,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === (databaseId ?? null) &&
      previousQuery.queryKey[3] === (table ?? null)
        ? previous
        : undefined,
  });
}

export function useDatabaseBackups(databaseId: MaybeId) {
  return useQuery({
    queryKey: queryKeys.backups.list(databaseId),
    queryFn: databaseId ? () => api.databases.listBackups(databaseId) : skipToken,
  });
}

/** Creates the PostgreSQL service, its first deployment and, optionally, a connection. */
export function useCreateDatabase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDatabaseInput) => api.databases.create(input),
    onSuccess: () =>
      invalidateEntities(queryClient, [
        "databases",
        "services",
        "containers",
        "variables",
        "connections",
        "deployments",
        "projects",
        "metrics",
        "activity",
      ]),
  });
}

/** The storage limit is the volume size of the backing service. */
export function useUpdateDatabase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: ID; patch: UpdateDatabaseInput }) =>
      api.databases.update(id, patch),
    onSuccess: () =>
      invalidateEntities(queryClient, ["databases", "services", "metrics", "activity"]),
  });
}

/** Connection variables of the consumers are rewritten with the new password. */
export function useRotateDatabasePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ID) => api.databases.rotatePassword(id),
    onSuccess: () => invalidateEntities(queryClient, ["databases", "variables", "activity"]),
  });
}

/** Read-only console: only a statement other than SELECT can change the stored data. */
export function useRunDatabaseQuery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sql }: { id: ID; sql: string }) => api.databases.runQuery(id, sql),
    onSuccess: (result) =>
      result.command.toUpperCase() === "SELECT"
        ? undefined
        : invalidateEntities(queryClient, ["databases"]),
  });
}

/** Starts a console command; follow it with `useDatabaseCommand`. */
export function useStartDatabaseCommand() {
  return useMutation({
    mutationFn: ({ id, command, serviceId }: { id: ID; command: string; serviceId?: ID }) =>
      api.databases.startCommand(id, command, serviceId),
  });
}

const COMMAND_POLL_MS = 1_000;

/**
 * A console command, polled while it runs. Kept out of the "databases" keys:
 * invalidating the database must not re-ask for a run the server has forgotten.
 */
export function useDatabaseCommand(databaseId: ID, initial: CommandRun | null) {
  return useQuery({
    queryKey: ["database-commands", databaseId, initial?.id ?? null] as const,
    queryFn: initial ? () => api.databases.getCommand(databaseId, initial.id) : skipToken,
    initialData: initial ?? undefined,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchInterval: (query) => (query.state.data?.running && !query.state.error ? COMMAND_POLL_MS : false),
  });
}

/** Resolves as `in_progress`; the completion arrives through the realtime bridge. */
export function useCreateBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ databaseId, label }: { databaseId: ID; label?: string }) =>
      api.databases.createBackup(databaseId, label),
    onSuccess: () => invalidateEntities(queryClient, ["backups"]),
  });
}

/** Restoring restarts the database service. */
export function useRestoreBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ databaseId, backupId }: { databaseId: ID; backupId: ID }) =>
      api.databases.restoreBackup(databaseId, backupId),
    onSuccess: () => invalidateEntities(queryClient, ["backups", ...SERVICE_STATE_ENTITIES]),
  });
}

export function useDeleteBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ databaseId, backupId }: { databaseId: ID; backupId: ID }) =>
      api.databases.deleteBackup(databaseId, backupId),
    onSuccess: () => invalidateEntities(queryClient, ["backups"]),
  });
}
