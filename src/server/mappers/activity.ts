import type { ActivityEvent as ActivityRow } from "@/generated/prisma/client";
import type { ActivityEvent, ActivitySeverity, ActivityType } from "@/lib/types";

export function toActivityEvent(row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    // Only written through recordActivity, whose input is typed.
    type: row.type as ActivityType,
    severity: row.severity as ActivitySeverity,
    title: row.title,
    description: row.description,
    projectId: row.projectId,
    serviceId: row.serviceId,
    deploymentId: row.deploymentId,
    actor: row.actor,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
}
