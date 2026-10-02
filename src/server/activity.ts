/**
 * Activity journal (doubles as the in-app notifications).
 */

import type { ActivityEvent, ActivitySeverity, ActivityType, ID } from "@/lib/types";

import { db, type DbClient } from "./db";
import { emitEvent } from "./events";
import { newId } from "./ids";
import { toActivityEvent } from "./mappers/activity";
import { getPlatformSettings } from "./platform-settings";

const MAX_EVENTS = 300;

/** Author of events the platform produces on its own (certificates, automatic backups…). */
export const SYSTEM_ACTOR = "TwinsDeploi";

export interface ActivityInput {
  type: ActivityType;
  severity?: ActivitySeverity;
  title: string;
  description: string;
  projectId?: ID | null;
  serviceId?: ID | null;
  deploymentId?: ID | null;
  /** Display name of the author: pass `ctx.user.name`. Defaults to the platform. */
  actor?: string;
  /**
   * True for asynchronous outcomes the user did not watch happen (a build
   * finishing, a certificate being issued): the event starts unread.
   * Direct actions are logged as already read.
   */
  notify?: boolean;
}

/** In-app notification preferences decide whether an outcome starts unread. */
async function notificationEnabled(client: DbClient, type: ActivityType): Promise<boolean> {
  const preferences = (await getPlatformSettings(client)).notifications;
  if (!preferences.inApp) return false;
  if (type === "deployment.succeeded") return preferences.deploySucceeded;
  if (type === "deployment.failed") return preferences.deployFailed;
  if (type === "service.crashed") return preferences.serviceCrashed;
  return true;
}

/**
 * Appends an event, keeps the 300 most recent ones and emits "activity" (callers
 * only emit their own entities).
 * Pass the transaction client to make it part of the surrounding write.
 */
export async function recordActivity(
  input: ActivityInput,
  client: DbClient = db(),
): Promise<ActivityEvent> {
  const unread = input.notify === true && (await notificationEnabled(client, input.type));
  const row = await client.activityEvent.create({
    data: {
      id: newId("act"),
      type: input.type,
      severity: input.severity ?? "info",
      title: input.title,
      description: input.description,
      projectId: input.projectId ?? null,
      serviceId: input.serviceId ?? null,
      deploymentId: input.deploymentId ?? null,
      actor: input.actor ?? SYSTEM_ACTOR,
      read: !unread,
    },
  });

  const overflow = await client.activityEvent.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: MAX_EVENTS,
    select: { id: true },
  });
  if (overflow.length > 0) {
    await client.activityEvent.deleteMany({ where: { id: { in: overflow.map((item) => item.id) } } });
  }

  await emitEvent(
    { entities: ["activity"], ...(input.projectId ? { projectId: input.projectId } : {}) },
    client,
  );
  return toActivityEvent(row);
}
