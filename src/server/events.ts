/**
 * Realtime bus between processes: every write calls `emitEvent`, which goes
 * through pg_notify; each process keeps ONE LISTEN connection and fans the
 * events out to its subscribers (the SSE route in the web process).
 */

import type { ApiEvent, EntityName } from "@/lib/api/contract";
import { ENTITIES } from "@/lib/api/contract";

import { db, listen, type DbClient, type ListenHandle } from "./db";

export const EVENTS_CHANNEL = "mini_railway_events";

type Listener = (event: ApiEvent) => void;

// Kept on globalThis so a dev hot reload reuses the connection and the subscribers.
const globalStore = globalThis as typeof globalThis & {
  __miniRailwayEvents?: { listeners: Set<Listener>; handle: ListenHandle | null };
};
const state = (globalStore.__miniRailwayEvents ??= { listeners: new Set(), handle: null });

/**
 * Passing the transaction client delivers the notification when (and only
 * if) the transaction commits.
 */
export async function emitEvent(event: ApiEvent, client: DbClient = db()): Promise<void> {
  const payload = JSON.stringify(event);
  await client.$queryRaw`SELECT pg_notify(${EVENTS_CHANNEL}, ${payload})::text`;
}

/** Shorthand: emit(["projects", "activity"], { projectId }). */
export function emit(
  entities: EntityName[],
  scope: Omit<ApiEvent, "entities"> = {},
  client: DbClient = db(),
): Promise<void> {
  return emitEvent({ ...scope, entities }, client);
}

function parseEvent(payload: string): ApiEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || !("entities" in value)) return null;
  const { entities } = value;
  if (!Array.isArray(entities)) return null;
  const known = entities.filter((name): name is EntityName =>
    (ENTITIES as readonly unknown[]).includes(name),
  );
  const event: ApiEvent = { entities: known };
  const scope = value as Record<string, unknown>;
  if (typeof scope.projectId === "string") event.projectId = scope.projectId;
  if (typeof scope.serviceId === "string") event.serviceId = scope.serviceId;
  if (typeof scope.deploymentId === "string") event.deploymentId = scope.deploymentId;
  return event;
}

function dispatch(payload: string): void {
  const event = parseEvent(payload);
  if (!event) return;
  for (const listener of [...state.listeners]) {
    try {
      listener(event);
    } catch (error) {
      console.error("[events] listener failed:", error);
    }
  }
}

function ensureListening(): ListenHandle {
  state.handle ??= listen(EVENTS_CHANNEL, dispatch);
  return state.handle;
}

/** Returns the unsubscribe function. The LISTEN connection is created on first use. */
export function subscribeEvents(listener: Listener): () => void {
  ensureListening();
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

/** Resolves once the LISTEN connection is established (events emitted before are missed). */
export function eventsReady(): Promise<void> {
  return ensureListening().ready();
}
