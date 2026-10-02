"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a CSS media query currently matches, kept in sync as it changes.
 *
 *   const wide = useMediaQuery("(min-width: 1024px)");
 *
 * `serverFallback` is the value used on the server and during hydration.
 * Prefer Tailwind breakpoints for pure styling: this hook is for behaviour
 * that differs by viewport or input (e.g. rendering a sheet instead of a
 * side panel).
 */
export function useMediaQuery(query: string, serverFallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverFallback,
  );
}
