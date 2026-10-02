"use client";

import { useSyncExternalStore } from "react";

export type ProjectsViewMode = "grid" | "list";

const STORAGE_KEY = "mini-railway:projects:view";
const DEFAULT_MODE: ProjectsViewMode = "grid";

const listeners = new Set<() => void>();

/** Mirror of the stored choice: the toggle keeps working when storage is unavailable. */
let current: ProjectsViewMode | null = null;

function readStored(): ProjectsViewMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "list" ? "list" : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // The choice was changed from another tab.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    current = readStored();
    notify();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): ProjectsViewMode {
  current ??= readStored();
  return current;
}

// The server and the hydration pass render the default, then React switches to
// the stored value without a mismatch.
function getServerSnapshot(): ProjectsViewMode {
  return DEFAULT_MODE;
}

function setMode(mode: ProjectsViewMode) {
  current = mode;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage unavailable (private window…): the choice then lasts until reload.
  }
  notify();
}

/** Grid or list display of the projects, remembered across visits. */
export function useProjectsViewMode(): [ProjectsViewMode, (mode: ProjectsViewMode) => void] {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [mode, setMode];
}
