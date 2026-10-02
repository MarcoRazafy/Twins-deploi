/**
 * The in-memory database: created lazily on the first API call, restored from
 * localStorage when a compatible snapshot exists, seeded otherwise.
 */

import { STORAGE_KEYS } from "@/lib/constants";

import { DB_VERSION, type MockDb } from "./schema";
import { createSeed } from "./seed";
import { isPlainObject } from "./text";
import { isBrowser } from "./timers";

const SAVE_DELAY_MS = 250;

/** Collections a stored snapshot must contain to be trusted. */
const REQUIRED_LISTS = [
  "projects",
  "services",
  "connections",
  "deployments",
  "variables",
  "domains",
  "containers",
  "images",
  "databases",
  "backups",
  "activity",
  "members",
  "tokens",
] as const;

let current: MockDb | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let flushOnHide = false;
let onReady: ((db: MockDb) => void) | null = null;

/** Called once per (re)initialisation, e.g. to resume the simulations. */
export function setReadyHandler(handler: (db: MockDb) => void): void {
  onReady = handler;
}

function isSnapshot(value: unknown): value is { version: number; data: MockDb } {
  if (!isPlainObject(value) || value.version !== DB_VERSION) return false;
  const data = value.data;
  if (!isPlainObject(data)) return false;
  return (
    REQUIRED_LISTS.every((key) => Array.isArray(data[key])) &&
    isPlainObject(data.settings) &&
    isPlainObject(data.profile) &&
    isPlainObject(data.github) &&
    isPlainObject(data.pendingRestarts)
  );
}

function readSnapshot(): MockDb | null {
  if (!isBrowser) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.db);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSnapshot(parsed) ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Writes the snapshot now, cancelling any pending debounced save. */
export function flush(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!isBrowser || !current) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEYS.db,
      JSON.stringify({ version: DB_VERSION, data: current }),
    );
  } catch {
    // Storage full or disabled: the session keeps working from memory.
  }
}

/**
 * Schedules a save. Calls made while one is pending are folded into it, so a
 * burst of simulator ticks cannot postpone the write forever.
 */
export function save(): void {
  if (!isBrowser || saveTimer !== null) return;
  saveTimer = setTimeout(flush, SAVE_DELAY_MS);
}

function bindPageHide(): void {
  if (!isBrowser || flushOnHide) return;
  flushOnHide = true;
  window.addEventListener("pagehide", flush);
}

export function getDb(): MockDb {
  if (current) return current;
  current = readSnapshot() ?? createSeed(Date.now());
  bindPageHide();
  onReady?.(current);
  return current;
}

/** Drops the stored snapshot and starts over from a fresh seed. */
export function resetDb(): MockDb {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (isBrowser) {
    try {
      window.localStorage.removeItem(STORAGE_KEYS.db);
    } catch {
      // Nothing to clear when storage is unavailable.
    }
  }
  current = createSeed(Date.now());
  save();
  onReady?.(current);
  return current;
}
