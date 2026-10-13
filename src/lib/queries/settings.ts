"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type Api, type DeepPartial, type EntityName } from "@/lib/api";
import type { ID, MemberRole, PlatformSettings } from "@/lib/types";

import { invalidateEntities, queryKeys } from "./keys";

export type UpdateProfileInput = Parameters<Api["settings"]["updateProfile"]>[0];
export type CreateApiTokenInput = Parameters<Api["settings"]["createToken"]>[0];
export type InviteMemberInput = Parameters<Api["settings"]["inviteMember"]>[0];
export type SetServerConsoleInput = Parameters<Api["settings"]["setServerConsole"]>[0];

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings.platform(),
    queryFn: () => api.settings.get(),
  });
}

export function useProfile() {
  return useQuery({
    queryKey: queryKeys.settings.profile(),
    queryFn: () => api.settings.getProfile(),
  });
}

export function useApiTokens() {
  return useQuery({
    queryKey: queryKeys.settings.tokens(),
    queryFn: () => api.settings.listTokens(),
  });
}

export function useTeamMembers() {
  return useQuery({
    queryKey: queryKeys.settings.members(),
    queryFn: () => api.settings.listMembers(),
  });
}

/** A new base domain also rewrites the public URLs derived from it. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: DeepPartial<PlatformSettings>) => api.settings.update(patch),
    onSuccess: (_settings, patch) => {
      const entities: EntityName[] = ["settings", "activity"];
      if (patch.baseDomain !== undefined) entities.push("databases", "domains", "services");
      else if (patch.dns !== undefined) entities.push("domains");
      return invalidateEntities(queryClient, entities);
    },
  });
}

/** The profile is also a row of the team list, hence the whole "settings" prefix. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateProfileInput) => api.settings.updateProfile(patch),
    onSuccess: () => invalidateEntities(queryClient, ["settings"]),
  });
}

/** The secret is only present in the mutation result: it cannot be fetched again. */
export function useCreateApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiTokenInput) => api.settings.createToken(input),
    onSuccess: () => invalidateEntities(queryClient, ["settings", "activity"]),
  });
}

export function useRevokeApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ID) => api.settings.revokeToken(id),
    onSuccess: () => invalidateEntities(queryClient, ["settings", "activity"]),
  });
}

export function useInviteMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteMemberInput) => api.settings.inviteMember(input),
    onSuccess: () => invalidateEntities(queryClient, ["settings", "activity"]),
  });
}

export function useUpdateMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: ID; role: MemberRole }) =>
      api.settings.updateMember(id, { role }),
    onSuccess: () => invalidateEntities(queryClient, ["settings", "activity"]),
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ID) => api.settings.removeMember(id),
    onSuccess: () => invalidateEntities(queryClient, ["settings", "activity"]),
  });
}

/** Owner only: pass `enabled: false` for anyone else, the server would refuse. */
export function useServerConsole(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.settings.serverConsole(),
    queryFn: () => api.settings.getServerConsole(),
    enabled: options.enabled ?? true,
  });
}

export function useSetServerConsole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetServerConsoleInput) => api.settings.setServerConsole(input),
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.settings.serverConsole(), status);
      return invalidateEntities(queryClient, ["settings", "activity"]);
    },
  });
}

/** Wipes every cached log stream (their ids restart from the seed), then refetches everything. */
export function useResetDemoData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.settings.resetDemoData(),
    onSuccess: async () => {
      await queryClient.resetQueries({ queryKey: queryKeys.logs.all });
      await queryClient.invalidateQueries();
    },
  });
}
