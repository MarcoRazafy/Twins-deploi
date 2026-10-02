"use client";

import { useSyncExternalStore } from "react";

function subscribeNever() {
  return () => {};
}

/**
 * False on the server and while React hydrates the server HTML; true once
 * hydrated, and from the first render for anything mounted later (client-side
 * navigation, data arriving).
 *
 * The kit uses it to skip entrance animations during hydration: content that
 * came with the HTML must be visible before JavaScript runs, while content
 * mounted on the client still animates in.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}
