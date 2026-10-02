/**
 * Creation of a project database: the PostgreSQL service, its ManagedDatabase
 * row, its connection variables and its first deployment, in the caller's
 * transaction. The worker's pipeline starts the container.
 */

import type { ManagedDatabase } from "@/generated/prisma/client";
import type { EntityName } from "@/lib/api/contract";
import type { Position } from "@/lib/types";

import { recordActivity } from "../activity";
import { encryptSecret, randomToken } from "../crypto";
import type { DbClient } from "../db";
import { enqueueDeployment } from "../deployments/enqueue";
import { notFound, validation } from "../errors";
import { emit } from "../events";
import { newId } from "../ids";
import { createService, lockProject } from "../services/create";
import { PG_DATA_PATH } from "../services/validate";
import { createVariable } from "../variables/store";
import { createConnectionVariables } from "./variables";

export interface CreateDatabaseParams {
  projectId: string;
  /** Null: "Postgres", suffixed when taken. A given name must be free. */
  name: string | null;
  version: string;
  storageGb: number;
  publicNetworking: boolean;
  /** Service that will consume the database (canvas connection + DATABASE_URL reference). */
  consumerId: string | null;
  position?: Position;
  /** Display name of whoever creates it. */
  creator: string;
}

export async function createDatabase(client: DbClient, params: CreateDatabaseParams): Promise<ManagedDatabase> {
  await lockProject(client, params.projectId);
  const consumer = params.consumerId
    ? await client.service.findUnique({
        where: { id: params.consumerId },
        select: { id: true, projectId: true },
      })
    : null;
  if (params.consumerId && !consumer) throw notFound("Service");
  if (consumer && consumer.projectId !== params.projectId) {
    throw validation("Le service à connecter doit appartenir au même projet.", "connectToServiceId");
  }

  const service = await createService(client, {
    projectId: params.projectId,
    name: params.name ?? "Postgres",
    explicitName: params.name !== null,
    source: { type: "postgres", version: params.version },
    config: { port: 5432, restartPolicy: "always" },
    volume: { mountPath: PG_DATA_PATH, sizeGb: params.storageGb },
    position: params.position,
  });

  const database = await client.managedDatabase.create({
    data: {
      id: newId("db"),
      serviceId: service.id,
      projectId: params.projectId,
      name: service.name,
      engine: "postgres",
      version: params.version,
      // The alias the pipeline gives the container on the project's network.
      host: `${service.slug}.railway.internal`,
      port: 5432,
      databaseName: "railway",
      username: "postgres",
      passwordEncrypted: encryptSecret(randomToken(24)),
      publicNetworking: params.publicNetworking,
      storageLimitMb: params.storageGb * 1024,
      maxConnections: 100,
      // Present in every database; the real list is read once the server runs.
      extensions: ["plpgsql"],
      createdAt: service.createdAt,
    },
  });
  await createConnectionVariables(client, database);

  const entities: EntityName[] = ["databases", "variables"];
  if (consumer) {
    // Same effect as services.connect: the edge, and DATABASE_URL on the consumer unless it defines one.
    await client.serviceConnection.create({
      data: {
        id: newId("con"),
        projectId: params.projectId,
        fromServiceId: consumer.id,
        toServiceId: service.id,
      },
    });
    entities.push("connections", "projects");
    const defined = await client.envVariable.findFirst({
      where: { projectId: params.projectId, serviceId: consumer.id, key: "DATABASE_URL" },
      select: { id: true },
    });
    if (!defined) {
      await createVariable(client, {
        projectId: params.projectId,
        serviceId: consumer.id,
        key: "DATABASE_URL",
        value: `\${{${service.name}.DATABASE_URL}}`,
        isSecret: true,
      });
    }
  }

  await recordActivity(
    {
      type: "database.created",
      title: "Base de données créée",
      description: `${service.name} · PostgreSQL ${params.version}`,
      projectId: params.projectId,
      serviceId: service.id,
      actor: params.creator,
    },
    client,
  );
  await enqueueDeployment(client, { service, trigger: "initial", creator: params.creator });
  await emit(entities, { projectId: params.projectId, serviceId: service.id }, client);
  return database;
}
