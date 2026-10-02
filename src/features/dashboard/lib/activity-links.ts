import { routes } from "@/lib/routes";
import type { ActivityEvent } from "@/lib/types";

/**
 * Where a click on an activity event should lead: the deployment when there
 * is one, otherwise the page that manages what the event is about. Null when
 * the subject no longer exists (a deleted project).
 */
export function getActivityHref(event: ActivityEvent): string | null {
  const projectId = event.projectId ?? undefined;
  const serviceId = event.serviceId ?? undefined;

  if (event.deploymentId) return routes.deployment(event.deploymentId);
  if (event.type === "project.deleted") return null;
  if (event.type.startsWith("domain.")) {
    return routes.domains({ project: projectId, service: serviceId });
  }
  if (event.type === "variable.updated") {
    return routes.variables({ project: projectId, service: serviceId });
  }
  if (event.type === "database.created" || event.type.startsWith("backup.")) {
    return routes.databases({ project: projectId });
  }
  if (event.type.startsWith("github.")) return routes.github();
  if (event.type === "settings.updated") return routes.settings();
  // A deleted service has no panel to open: land on its project instead.
  if (projectId && serviceId && event.type !== "service.deleted") {
    return routes.workspace(projectId, { service: serviceId });
  }
  if (projectId) return routes.workspace(projectId);
  return null;
}
