"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { api, type ActivityFilter } from "@/lib/api";
import type { ActivityEvent, ID } from "@/lib/types";

import { invalidateEntities, queryKeys } from "./keys";

const countEvents = (events: ActivityEvent[]) => events.length;

export function useActivity(filter?: ActivityFilter) {
  return useQuery({
    queryKey: queryKeys.activity.list(filter),
    queryFn: () => api.activity.list(filter),
    placeholderData: keepPreviousData,
  });
}

/** Number of unread events (the notification badge); 0 until the first response. */
export function useUnreadActivityCount(): number {
  const { data } = useQuery({
    queryKey: queryKeys.activity.list({ unreadOnly: true }),
    queryFn: () => api.activity.list({ unreadOnly: true }),
    select: countEvents,
  });
  return data ?? 0;
}

function isUnreadOnlyKey(key: QueryKey): boolean {
  const filter = key[2];
  return (
    typeof filter === "object" &&
    filter !== null &&
    "unreadOnly" in filter &&
    filter.unreadOnly === true
  );
}

interface ActivitySnapshot {
  lists: Array<[QueryKey, ActivityEvent[] | undefined]>;
}

/**
 * Optimistic: the events turn read in every cached list (and leave the
 * unread-only ones) before the call returns; the cache is restored on error.
 */
export function useMarkActivityRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: ID[] | "all") => api.activity.markRead(ids),
    onMutate: async (ids): Promise<ActivitySnapshot> => {
      await queryClient.cancelQueries({ queryKey: queryKeys.activity.all });
      const lists = queryClient.getQueriesData<ActivityEvent[]>({
        queryKey: queryKeys.activity.lists(),
      });
      const targeted = ids === "all" ? null : new Set(ids);
      const isTargeted = (event: ActivityEvent) => targeted === null || targeted.has(event.id);
      for (const [key, events] of lists) {
        if (!events) continue;
        queryClient.setQueryData<ActivityEvent[]>(
          key,
          isUnreadOnlyKey(key)
            ? events.filter((event) => !isTargeted(event))
            : events.map((event) =>
                isTargeted(event) && !event.read ? { ...event, read: true } : event,
              ),
        );
      }
      return { lists };
    },
    onError: (_error, _ids, snapshot) => {
      if (!snapshot) return;
      for (const [key, events] of snapshot.lists) queryClient.setQueryData(key, events);
    },
    onSettled: () => invalidateEntities(queryClient, ["activity"]),
  });
}
