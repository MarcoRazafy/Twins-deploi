/**
 * Live tail of container logs. Each subscription owns one self-rescheduling
 * timer aligned on the slot grid of its container (see generators/runtime-logs),
 * so pushed lines are exactly the ones a later history read will return.
 */

import type { Unsubscribe } from "@/lib/api/contract";
import type { ID, LogLine } from "@/lib/types";

import { getDb } from "../db";
import { runtimeContext } from "../domain/runtime-logs";
import { lastEmittedSlot, slotEmitTime, slotLines } from "../generators/runtime-logs";
import { afterExact, cancelTimer, getSpeed, isBrowser, timerKey } from "../timers";

interface Subscription {
  key: string;
  containerId: ID;
  onLines: (lines: LogLine[]) => void;
  /** Last slot already delivered (or skipped). */
  cursor: number;
  /** Speed the cursor was computed for: the slot grid depends on it. */
  speed: number;
}

const subscriptions = new Map<string, Subscription>();
let nextId = 1;

function deliver(subscription: Subscription): void {
  const db = getDb();
  const container = db.containers.find((item) => item.id === subscription.containerId);
  if (!container || container.state !== "running" || !container.startedAt) return;
  const emittedAt = slotEmitTime(subscription.containerId, subscription.cursor, subscription.speed);
  // Slots older than the current process belong to the previous one.
  if (emittedAt < Date.parse(container.startedAt)) return;
  const context = runtimeContext(db, container);
  if (!context) return;

  try {
    subscription.onLines(slotLines(context, subscription.cursor, subscription.speed));
  } catch {
    // A faulty consumer must not stop the stream of the others.
  }
}

/** A tab that slept for a while only catches up on its most recent slots. */
const MAX_BACKLOG_SLOTS = 40;

function arm(subscription: Subscription): void {
  const speed = getSpeed();
  const latest = lastEmittedSlot(subscription.containerId, Date.now(), speed);
  if (speed !== subscription.speed) {
    subscription.speed = speed;
    subscription.cursor = latest;
  } else if (latest - subscription.cursor > MAX_BACKLOG_SLOTS) {
    subscription.cursor = latest - MAX_BACKLOG_SLOTS;
  }
  const next = subscription.cursor + 1;
  const delay = slotEmitTime(subscription.containerId, next, speed) - Date.now();

  afterExact(subscription.key, delay, () => {
    if (!subscriptions.has(subscription.key)) return;
    subscription.cursor = next;
    deliver(subscription);
    arm(subscription);
  });
}

export function subscribeContainerLogs(
  containerId: ID,
  onLines: (lines: LogLine[]) => void,
): Unsubscribe {
  if (!isBrowser) return () => {};
  const speed = getSpeed();
  const subscription: Subscription = {
    key: timerKey.runtimeLogs(nextId),
    containerId,
    onLines,
    cursor: lastEmittedSlot(containerId, Date.now(), speed),
    speed,
  };
  nextId += 1;
  subscriptions.set(subscription.key, subscription);
  arm(subscription);

  return () => {
    subscriptions.delete(subscription.key);
    cancelTimer(subscription.key);
  };
}

/** After every timer was cleared (reset), gives live subscribers their timer back. */
export function rearmRuntimeLogs(): void {
  for (const subscription of subscriptions.values()) {
    subscription.cursor = lastEmittedSlot(subscription.containerId, Date.now(), subscription.speed);
    arm(subscription);
  }
}

export function runtimeLogSubscriptionCount(): number {
  return subscriptions.size;
}
