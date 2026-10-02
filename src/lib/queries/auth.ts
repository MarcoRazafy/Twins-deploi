"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type LoginInput, type SetupInput } from "@/lib/api";
import type { AuthSession } from "@/lib/types";

/**
 * The session is not an entity collection: it has its own key family, so a
 * realtime event (`invalidateEntities`) never refetches it.
 */
export const authKeys = {
  all: ["auth"] as const,
  session: () => ["auth", "session"] as const,
};

const SESSION_STALE_TIME_MS = 60_000;

const SIGNED_OUT: AuthSession = { status: "unauthenticated", user: null };

/**
 * Who is signed in, or what to do next (sign in, or create the owner account
 * on a fresh install). Never retried: a failure goes straight to a retry screen.
 */
export function useSession() {
  return useQuery({
    queryKey: authKeys.session(),
    queryFn: () => api.auth.getSession(),
    staleTime: SESSION_STALE_TIME_MS,
    retry: false,
    // Off app-wide; here it is how an expired session is noticed when the user returns to the tab.
    refetchOnWindowFocus: true,
  });
}

/** The returned session goes straight into the cache: no second round trip to learn it. */
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.auth.login(input),
    onSuccess: (session) => {
      queryClient.setQueryData(authKeys.session(), session);
    },
  });
}

/** First run only: creates the owner account, which is signed in right away. */
export function useSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetupInput) => api.auth.setup(input),
    onSuccess: (session) => {
      queryClient.setQueryData(authKeys.session(), session);
    },
  });
}

/**
 * Empties the whole cache so nothing of this account survives, then records
 * the signed-out state so the login screen does not need a request to know it.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(authKeys.session(), SIGNED_OUT);
    },
  });
}
