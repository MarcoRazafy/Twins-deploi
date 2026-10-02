"use client";

import { useSyncExternalStore } from "react";

function subscribeNever() {
  return () => {};
}

let mountTime = 0;

function getMountTime(): number {
  if (mountTime === 0) mountTime = Date.now();
  return mountTime;
}

/**
 * Time at which the showcase first rendered in the browser; 0 on the server
 * and during hydration. Sample dates are derived from it so "il y a 3 min"
 * examples are true relative to the visit without a hydration mismatch.
 */
export function useMountTime(): number {
  return useSyncExternalStore(subscribeNever, getMountTime, () => 0);
}

/** Resolved value of a CSS custom property of the document ("" on the server). */
export function useCssVariable(name: string): string {
  return useSyncExternalStore(
    subscribeNever,
    () => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    () => "",
  );
}
