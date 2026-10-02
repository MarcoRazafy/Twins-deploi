"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { api, type EntityName } from "@/lib/api";

import { invalidateEntities } from "./keys";

/** Events arriving within this window share one round of invalidations. */
const COALESCE_MS = 120;

/**
 * Keeps every open view fresh: each `api.events` notification invalidates the
 * queries of the entities it names. Bursts (the simulator is chatty while a
 * deployment runs) are gathered for 120 ms, then each prefix is invalidated once.
 */
export function useRealtimeSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const touched = new Set<EntityName>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const entities = [...touched];
      touched.clear();
      void invalidateEntities(queryClient, entities);
    };

    const unsubscribe = api.events.subscribe((event) => {
      for (const entity of event.entities) touched.add(entity);
      if (timer === null) timer = setTimeout(flush, COALESCE_MS);
    });

    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [queryClient]);
}

/** Mounts the realtime bridge; renders nothing. */
export function RealtimeSync(): null {
  useRealtimeSync();
  return null;
}
