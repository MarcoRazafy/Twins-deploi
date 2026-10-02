import { APP_NAME } from "@/lib/constants";
import type { ActivityEvent, ActivitySeverity, ActivityType, ID } from "@/lib/types";

import { newId } from "../ids";
import type { MockDb } from "../schema";
import { iso } from "../text";

const MAX_EVENTS = 300;

/** Author of events the platform produces on its own (certificates, automatic backups…). */
export const SYSTEM_ACTOR = APP_NAME;

export interface ActivityInput {
  type: ActivityType;
  severity?: ActivitySeverity;
  title: string;
  description: string;
  projectId?: ID | null;
  serviceId?: ID | null;
  deploymentId?: ID | null;
  /** Defaults to the signed-in user. */
  actor?: string;
  /**
   * True for asynchronous outcomes the user did not watch happen (a build
   * finishing, a certificate being issued): the event starts unread.
   * Direct actions are logged as already read.
   */
  notify?: boolean;
}

/** In-app notification preferences decide whether an outcome starts unread. */
function notificationEnabled(db: MockDb, type: ActivityType): boolean {
  const preferences = db.settings.notifications;
  if (!preferences.inApp) return false;
  if (type === "deployment.succeeded") return preferences.deploySucceeded;
  if (type === "deployment.failed") return preferences.deployFailed;
  if (type === "service.crashed") return preferences.serviceCrashed;
  return true;
}

export function addActivity(db: MockDb, input: ActivityInput): ActivityEvent {
  const event: ActivityEvent = {
    id: newId("act"),
    type: input.type,
    severity: input.severity ?? "info",
    title: input.title,
    description: input.description,
    projectId: input.projectId ?? null,
    serviceId: input.serviceId ?? null,
    deploymentId: input.deploymentId ?? null,
    actor: input.actor ?? db.profile.name,
    read: !(input.notify === true && notificationEnabled(db, input.type)),
    createdAt: iso(),
  };
  db.activity.unshift(event);
  if (db.activity.length > MAX_EVENTS) db.activity.length = MAX_EVENTS;
  return event;
}
