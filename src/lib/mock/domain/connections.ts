import type { EntityName } from "@/lib/api/contract";
import type { Service, ServiceConnection } from "@/lib/types";

import { conflict, invalid } from "../errors";
import { newId } from "../ids";
import type { MockDb } from "../schema";
import { iso } from "../text";
import { addVariable, scopeVariables } from "./variables";

/**
 * Adds the edge `from → to` (from consumes to). Connecting to a PostgreSQL
 * service also gives `from` a DATABASE_URL reference, unless it has one.
 */
export function connectServices(
  db: MockDb,
  from: Service,
  to: Service,
): { connection: ServiceConnection; entities: EntityName[] } {
  if (from.id === to.id) {
    throw invalid("Un service ne peut pas être connecté à lui-même.");
  }
  if (from.projectId !== to.projectId) {
    throw invalid("Les deux services doivent appartenir au même projet.");
  }
  const duplicate = db.connections.some(
    (item) => item.fromServiceId === from.id && item.toServiceId === to.id,
  );
  if (duplicate) throw conflict("Ces deux services sont déjà connectés.");

  const connection: ServiceConnection = {
    id: newId("con"),
    projectId: from.projectId,
    fromServiceId: from.id,
    toServiceId: to.id,
    createdAt: iso(),
  };
  db.connections.unshift(connection);

  const entities: EntityName[] = ["connections"];
  const hasDatabaseUrl = scopeVariables(db, from.projectId, from.id).some(
    (variable) => variable.key === "DATABASE_URL",
  );
  if (to.source.type === "postgres" && !hasDatabaseUrl) {
    addVariable(db, {
      projectId: from.projectId,
      serviceId: from.id,
      key: "DATABASE_URL",
      value: `\${{${to.name}.DATABASE_URL}}`,
      isSecret: true,
    });
    entities.push("variables", "projects");
  }
  return { connection, entities };
}
