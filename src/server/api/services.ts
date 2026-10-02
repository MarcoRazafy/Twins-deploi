import type { Prisma, Service as ServiceRow } from "@/generated/prisma/client";
import type { Api, EntityName } from "@/lib/api/contract";

import { recordActivity } from "../activity";
import { requireUser, type Context } from "../context";
import { db, type DbClient } from "../db";
import { cancelInFlightDeployments } from "../deployments/enqueue";
import { CANCELLED_ERROR } from "../deployments/status";
import { conflict, isUniqueViolation, notFound, validation } from "../errors";
import { emit } from "../events";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";
import { toService, toServiceConfig, toServiceConnection } from "../mappers/service";
import { asRecord, asString, validServiceName } from "../rules";
import { CLEANUP_INCLUDE, enqueueServiceCleanup } from "../services/cleanup";
import { lockProject } from "../services/create";
import { volumeNameFor } from "../services/names";
import { CASCADE_ENTITIES, statusEntities } from "../services/status";
import { mergeConfig, mergeSource, validVolume } from "../services/validate";
import { createVariable, renameServiceReferences } from "../variables/store";

const NAME_TAKEN = "Un service porte déjà ce nom dans ce projet.";
const NOT_DEPLOYED = "Ce service n’a encore aucune version déployée. Lancez un déploiement.";
const DEPLOYING = "Un déploiement est en cours pour ce service. Attendez sa fin ou annulez-le.";
const ALREADY_CONNECTED = "Ces deux services sont déjà connectés.";
/** Canvas moves are batched by the client; this only bounds a hostile payload. */
const MAX_POSITIONS = 500;

type ServiceAction = "start" | "stop" | "restart";

/** A release exists once something was deployed: an active deployment or a container. */
async function hasRelease(client: DbClient, service: ServiceRow): Promise<boolean> {
  if (service.activeDeploymentId !== null || service.containerName !== null) return true;
  const released = await client.deployment.count({
    where: { serviceId: service.id, status: { in: ["active", "crashed", "removed"] } },
  });
  return released > 0;
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}

export function createServicesApi(ctx: Context): Api["services"] {
  const actor = (): string => requireUser(ctx).name;

  /**
   * start / stop / restart: the API only records the intent (status + job); the
   * worker acts on the container and moves the status on.
   */
  async function runAction(rawId: unknown, action: ServiceAction) {
    const author = actor();
    return db().$transaction(async (tx) => {
      const current = await tx.service.findUnique({ where: { id: asString(rawId) } });
      if (!current) throw notFound("Service");
      const links = { projectId: current.projectId, serviceId: current.id };
      const entities = statusEntities(current.type);

      if (action === "stop") {
        if (current.status === "stopped") return toService(current);
        // Stopping a service also abandons the deployment it was waiting for.
        const aborted = await cancelInFlightDeployments(tx, current.id, CANCELLED_ERROR);
        const row = await tx.service.update({ where: { id: current.id }, data: { status: "stopped" } });
        await enqueueJob(tx, "service.action", { serviceId: current.id, action }, new Date());
        await recordActivity(
          {
            type: "service.stopped",
            severity: "warning",
            title: "Service arrêté",
            description: current.name,
            ...links,
            actor: author,
          },
          tx,
        );
        await emit(aborted > 0 ? [...entities, "deployments"] : entities, links, tx);
        return toService(row);
      }

      if (current.status === "building" || current.status === "deploying") {
        throw conflict(DEPLOYING);
      }
      const nothingToDo =
        action === "start"
          ? current.status === "online" || current.status === "restarting"
          : current.status === "restarting";
      if (nothingToDo) return toService(current);
      if (!(await hasRelease(tx, current))) throw validation(NOT_DEPLOYED);

      const row = await tx.service.update({ where: { id: current.id }, data: { status: "restarting" } });
      await enqueueJob(tx, "service.action", { serviceId: current.id, action }, new Date());
      await recordActivity(
        {
          type: action === "start" ? "service.started" : "service.restarted",
          title: action === "start" ? "Démarrage du service" : "Redémarrage du service",
          description: current.name,
          ...links,
          actor: author,
        },
        tx,
      );
      await emit(entities, links, tx);
      return toService(row);
    });
  }

  return {
    async list(rawFilter) {
      const projectId = asRecord(rawFilter).projectId;
      const rows = await db().service.findMany({
        where: typeof projectId === "string" && projectId !== "" ? { projectId } : {},
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return rows.map(toService);
    },

    async get(id) {
      const row = await db().service.findUnique({ where: { id: asString(id) } });
      if (!row) throw notFound("Service");
      return toService(row);
    },

    async update(id, rawPatch) {
      const author = actor();
      const serviceId = asString(id);
      const patch = asRecord(rawPatch);

      try {
        return await db().$transaction(async (tx) => {
          const current = await tx.service.findUnique({
            where: { id: serviceId },
            include: { database: { select: { id: true } } },
          });
          if (!current) throw notFound("Service");

          // The whole patch is validated before anything is written.
          const data: Prisma.ServiceUncheckedUpdateInput = {};
          let name = current.name;
          if (patch.name !== undefined) {
            name = validServiceName(patch.name);
            await lockProject(tx, current.projectId);
            const taken = await tx.service.findFirst({
              where: {
                projectId: current.projectId,
                id: { not: current.id },
                name: { equals: name, mode: "insensitive" },
              },
              select: { id: true },
            });
            if (taken) throw conflict(NAME_TAKEN, "name");
            // The slug (Docker alias, container name) deliberately stays: running
            // containers and the URLs baked into other services keep working.
            data.name = name;
          }

          const config =
            patch.config !== undefined ? mergeConfig(toServiceConfig(current), patch.config) : null;
          if (config) Object.assign(data, config);

          if (patch.source !== undefined) Object.assign(data, mergeSource(current, patch.source));

          let volume: { mountPath: string; sizeGb: number } | null = null;
          if (patch.volume === null) {
            if (current.type === "postgres") {
              throw validation("Le volume d’une base de données ne peut pas être détaché.", "volume");
            }
            data.volumeName = null;
            data.volumeMountPath = null;
            data.volumeSizeGb = null;
          } else if (patch.volume !== undefined) {
            volume = validVolume(patch.volume, current.type === "postgres");
            data.volumeName = current.volumeName ?? volumeNameFor(current.id);
            data.volumeMountPath = volume.mountPath;
            data.volumeSizeGb = volume.sizeGb;
          }

          const row = await tx.service.update({ where: { id: current.id }, data });

          const renamed = name !== current.name;
          const entities = new Set<EntityName>(["services"]);
          if (renamed) {
            entities.add("projects");
            const rewritten = await renameServiceReferences(tx, current.projectId, current.name, name);
            if (rewritten > 0) entities.add("variables");
          }
          if (current.database) {
            const sync: Prisma.ManagedDatabaseUpdateInput = {};
            if (renamed) sync.name = name;
            if (config) sync.port = config.port;
            if (volume) sync.storageLimitMb = volume.sizeGb * 1024;
            if (Object.keys(sync).length > 0) {
              await tx.managedDatabase.update({ where: { id: current.database.id }, data: sync });
              entities.add("databases");
            }
          }

          await recordActivity(
            {
              type: "settings.updated",
              title: renamed ? "Service renommé" : "Réglages du service modifiés",
              description: renamed ? `${current.name} → ${name}` : name,
              projectId: current.projectId,
              serviceId: current.id,
              actor: author,
            },
            tx,
          );
          await emit([...entities], { projectId: current.projectId, serviceId: current.id }, tx);
          return toService(row);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict(NAME_TAKEN, "name");
        throw error;
      }
    },

    async updatePositions(rawPositions) {
      const entries = Object.entries(asRecord(rawPositions))
        .slice(0, MAX_POSITIONS)
        .flatMap(([id, value]) => {
          const position = asRecord(value);
          const { x, y } = position;
          return isCoordinate(x) && isCoordinate(y) ? [{ id, x: Math.round(x), y: Math.round(y) }] : [];
        });
      if (entries.length === 0) return;
      // Emits nothing: the canvas already shows these positions.
      await db().$transaction(async (tx) => {
        for (const entry of entries) {
          await tx.service.updateMany({
            where: { id: entry.id },
            data: { positionX: entry.x, positionY: entry.y },
          });
        }
      });
    },

    async delete(id) {
      const author = actor();
      await db().$transaction(async (tx) => {
        const service = await tx.service.findUnique({
          where: { id: asString(id) },
          include: CLEANUP_INCLUDE,
        });
        if (!service) throw notFound("Service");

        // What the worker needs is captured before the rows disappear.
        await enqueueServiceCleanup(tx, service);
        // The audit trail survives, without links to things that no longer exist.
        await tx.activityEvent.updateMany({
          where: { serviceId: service.id },
          data: { serviceId: null, deploymentId: null },
        });
        // Deployments, logs, variables, domains, connections, database… go with it (ON DELETE CASCADE).
        await tx.service.delete({ where: { id: service.id } });
        await tx.project.update({ where: { id: service.projectId }, data: { updatedAt: new Date() } });

        await recordActivity(
          {
            type: "service.deleted",
            severity: "warning",
            title: "Service supprimé",
            description: service.name,
            projectId: service.projectId,
            actor: author,
          },
          tx,
        );
        await emit(CASCADE_ENTITIES, { projectId: service.projectId, serviceId: service.id }, tx);
      });
    },

    start: (id) => runAction(id, "start"),
    stop: (id) => runAction(id, "stop"),
    restart: (id) => runAction(id, "restart"),

    async listConnections(projectId) {
      const id = asString(projectId);
      const project = await db().project.findUnique({ where: { id }, select: { id: true } });
      if (!project) throw notFound("Projet");
      const rows = await db().serviceConnection.findMany({
        where: { projectId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return rows.map(toServiceConnection);
    },

    async connect(rawInput) {
      const input = asRecord(rawInput);
      const fromId = asString(input.fromServiceId);
      const toId = asString(input.toServiceId);

      try {
        return await db().$transaction(async (tx) => {
          const from = await tx.service.findUnique({ where: { id: fromId } });
          const to = await tx.service.findUnique({ where: { id: toId } });
          if (!from || !to) throw notFound("Service");
          if (from.id === to.id) {
            throw validation("Un service ne peut pas être connecté à lui-même.");
          }
          if (from.projectId !== to.projectId) {
            throw validation("Les deux services doivent appartenir au même projet.");
          }
          const duplicate = await tx.serviceConnection.findFirst({
            where: { fromServiceId: from.id, toServiceId: to.id },
            select: { id: true },
          });
          if (duplicate) throw conflict(ALREADY_CONNECTED);

          const row = await tx.serviceConnection.create({
            data: {
              id: newId("con"),
              projectId: from.projectId,
              fromServiceId: from.id,
              toServiceId: to.id,
            },
          });

          const entities: EntityName[] = ["connections"];
          if (to.type === "postgres") {
            const defined = await tx.envVariable.findFirst({
              where: { projectId: from.projectId, serviceId: from.id, key: "DATABASE_URL" },
              select: { id: true },
            });
            if (!defined) {
              await createVariable(tx, {
                projectId: from.projectId,
                serviceId: from.id,
                key: "DATABASE_URL",
                value: `\${{${to.name}.DATABASE_URL}}`,
                isSecret: true,
              });
              entities.push("variables", "projects");
            }
          }
          await emit(entities, { projectId: from.projectId, serviceId: from.id }, tx);
          return toServiceConnection(row);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict(ALREADY_CONNECTED);
        throw error;
      }
    },

    async disconnect(connectionId) {
      await db().$transaction(async (tx) => {
        const connection = await tx.serviceConnection.findUnique({
          where: { id: asString(connectionId) },
        });
        if (!connection) throw notFound("Connexion");
        await tx.serviceConnection.delete({ where: { id: connection.id } });
        await emit(["connections"], { projectId: connection.projectId }, tx);
      });
    },
  };
}
