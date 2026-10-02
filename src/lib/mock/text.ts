/** Small string and time helpers shared by the mock modules. */

import type { ISODate } from "@/lib/types";

export function iso(ms: number = Date.now()): ISODate {
  return new Date(ms).toISOString();
}

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** kebab-case, ASCII only ("Boutique Vanille" → "boutique-vanille"). */
export function slugify(input: string, fallback = "service"): string {
  const slug = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** Returns `base`, or `base-2`, `base-3`… when already taken (case-insensitive). */
export function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`.toLowerCase())) suffix += 1;
  return `${base}-${suffix}`;
}

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** "1m 52s", "48s" — the way build tools print durations. */
export function formatBuildDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** "2026-10-01 20:19:57.412 UTC", the prefix of PostgreSQL server logs. */
export function pgLogTime(ms: number): string {
  const date = new Date(ms);
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.` +
    `${pad(date.getUTCMilliseconds(), 3)} UTC`
  );
}

/** "2026-10-01 20:19:57+00", how psql prints a timestamptz. */
export function pgTimestamp(ms: number): string {
  const date = new Date(ms);
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+00`
  );
}

/** "2026-10-01" */
export function pgDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Newest first; ties keep their current order (collections are prepended to). */
export function newestFirst<T extends { createdAt: ISODate }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
