"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";

export interface SetQueryOptions {
  /**
   * "replace" (default) rewrites the current history entry: right for filters
   * and tabs. "push" adds an entry so the back button undoes the change.
   */
  history?: "replace" | "push";
}

export type QueryPatch = Record<string, string | null>;

/**
 * Shareable UI state (filters, active tab, selection) stored in the query
 * string.
 *
 * Reads go through `useSearchParams`, so the calling component must sit under
 * a `<Suspense>` boundary (pages already provide one). Writes use the native
 * History API, which Next.js keeps in sync with `useSearchParams`: the URL
 * changes without a navigation, a server round-trip or a scroll jump.
 */
export function useQueryParams() {
  const searchParams = useSearchParams();

  const get = useCallback(
    (key: string): string | null => searchParams.get(key),
    [searchParams],
  );

  const set = useCallback((patch: QueryPatch, options?: SetQueryOptions) => {
    // Start from the live URL rather than the hook snapshot: two writes in the
    // same tick must not overwrite each other.
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }

    const query = params.toString();
    const { pathname, search, hash } = window.location;
    const nextSearch = query ? `?${query}` : "";
    if (nextSearch === search) return;

    const url = `${pathname}${nextSearch}${hash}`;
    if (options?.history === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);

  return useMemo(() => ({ get, set }), [get, set]);
}

/**
 * One query parameter as a `[value, setValue]` pair. Setting `null` (or an
 * empty string) removes it; the other parameters are preserved.
 *
 *   const [tab, setTab] = useQueryParam("tab");
 */
export function useQueryParam(
  key: string,
): [string | null, (value: string | null, options?: SetQueryOptions) => void] {
  const { get, set } = useQueryParams();
  const value = get(key);

  const setValue = useCallback(
    (next: string | null, options?: SetQueryOptions) => set({ [key]: next }, options),
    [key, set],
  );

  return [value, setValue];
}
