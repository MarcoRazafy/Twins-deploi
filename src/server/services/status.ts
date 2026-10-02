import type { EntityName } from "@/lib/api/contract";
import type { ServiceType } from "@/lib/types";

/**
 * Collections whose queries depend on the status of a service (a PostgreSQL
 * service mirrors it on its database).
 */
export function statusEntities(type: ServiceType): EntityName[] {
  const entities: EntityName[] = ["services", "containers", "projects", "metrics"];
  if (type === "postgres") entities.push("databases");
  return entities;
}

/**
 * Collections touched when a service or a whole project is deleted ("activity"
 * is left out: recordActivity emits it).
 */
export const CASCADE_ENTITIES: EntityName[] = [
  "services",
  "connections",
  "deployments",
  "variables",
  "domains",
  "containers",
  "images",
  "databases",
  "backups",
  "metrics",
  "projects",
];
