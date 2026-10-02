import type { Api, EntityName, UpdateServiceInput } from "@/lib/api/contract";
import type { Service, ServiceConfig, ServiceSource, ServiceVolume } from "@/lib/types";

import { addActivity } from "../domain/activity";
import { connectServices } from "../domain/connections";
import { PG_DATA_PATH, refreshUrls, syncConnectionVariables } from "../domain/databases";
import {
  assertServiceName,
  CASCADE_ENTITIES,
  containerOf,
  markContainerExited,
  removeServices,
  setServiceStatus,
  statusEntities,
} from "../domain/services";
import { emit } from "../emitter";
import { conflict, invalid } from "../errors";
import { splitImage } from "../generators/build-logs";
import { requireConnection, requireProject, requireService } from "../lookup";
import { isInFlight, type MockDb } from "../schema";
import { abortDeployment } from "../simulator/deployments";
import { beginRestart } from "../simulator/services";
import { iso, newestFirst, slugify } from "../text";
import { cancelTimer, timerKey } from "../timers";
import { read, write, writeNow } from "./respond";

const IMAGE_PATTERN = /^[a-z0-9]+([._:-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/;
const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

export function assertImage(image: string, field = "image"): void {
  if (!IMAGE_PATTERN.test(image)) {
    throw invalid("Saisissez une image valide, par exemple « nginx » ou « ghcr.io/acme/api ».", field);
  }
}

export function assertTag(tag: string, field = "tag"): void {
  if (!TAG_PATTERN.test(tag)) {
    throw invalid("Ce tag d’image n’est pas valide.", field);
  }
}

function inRange(value: number, min: number, max: number, integer: boolean): boolean {
  return Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}

/** Field names of nested inputs are dotted paths ("config.port"). */
export function validateConfig(config: ServiceConfig): ServiceConfig {
  if (!inRange(config.port, 1, 65_535, true)) {
    throw invalid("Le port doit être compris entre 1 et 65535.", "config.port");
  }
  if (!inRange(config.replicas, 1, 5, true)) {
    throw invalid("Le nombre de réplicas doit être compris entre 1 et 5.", "config.replicas");
  }
  if (!inRange(config.cpuLimit, 0.25, 8, false)) {
    throw invalid("La limite de CPU doit être comprise entre 0,25 et 8 vCPU.", "config.cpuLimit");
  }
  if (!inRange(config.memoryLimitMb, 128, 16_384, true)) {
    throw invalid(
      "La limite de mémoire doit être comprise entre 128 et 16 384 Mo.",
      "config.memoryLimitMb",
    );
  }
  if (config.builder !== "nixpacks" && config.builder !== "dockerfile") {
    throw invalid("Ce mode de build n’est pas disponible.", "config.builder");
  }
  if (!["always", "on-failure", "never"].includes(config.restartPolicy)) {
    throw invalid("Cette politique de redémarrage n’est pas disponible.", "config.restartPolicy");
  }
  const healthcheckPath = config.healthcheckPath.trim();
  if (healthcheckPath !== "" && !healthcheckPath.startsWith("/")) {
    throw invalid("Le chemin du healthcheck doit commencer par « / ».", "config.healthcheckPath");
  }
  return {
    ...config,
    healthcheckPath,
    buildCommand: config.buildCommand.trim(),
    startCommand: config.startCommand.trim(),
  };
}

function mergeSource(
  db: MockDb,
  service: Service,
  patch: NonNullable<UpdateServiceInput["source"]>,
): ServiceSource {
  const current = service.source;
  if (current.type === "postgres") {
    throw invalid("La source d’une base PostgreSQL ne peut pas être modifiée.", "source");
  }

  if (current.type === "docker") {
    const next = { ...current };
    if ("tag" in patch && patch.tag !== undefined) next.tag = patch.tag.trim();
    if ("image" in patch && patch.image !== undefined) {
      // "redis:7-alpine" typed in the image field carries its own tag.
      const [image, inlineTag] = splitImage(patch.image.trim());
      next.image = image;
      if (inlineTag && patch.tag === undefined) next.tag = inlineTag;
    }
    assertImage(next.image, "source.image");
    assertTag(next.tag, "source.tag");
    return next;
  }

  const next = { ...current };
  if ("repo" in patch && patch.repo !== undefined) next.repo = patch.repo.trim();
  if ("branch" in patch && patch.branch !== undefined) next.branch = patch.branch.trim();
  if ("rootDirectory" in patch && patch.rootDirectory !== undefined) {
    next.rootDirectory = patch.rootDirectory.trim() || "/";
  }
  if ("autoDeploy" in patch && patch.autoDeploy !== undefined) next.autoDeploy = patch.autoDeploy;

  if (!next.rootDirectory.startsWith("/")) {
    throw invalid("Le répertoire racine doit commencer par « / ».", "source.rootDirectory");
  }
  if (next.repo !== current.repo || next.branch !== current.branch) {
    const branches = db.github.branches[next.repo];
    if (!branches) throw invalid("Ce dépôt est introuvable sur GitHub.", "source.repo");
    if (!branches.some((branch) => branch.name === next.branch)) {
      throw invalid("Cette branche n’existe pas dans le dépôt.", "source.branch");
    }
  }
  return next;
}

function resolveVolume(
  service: Service,
  volume: NonNullable<UpdateServiceInput["volume"]> | null,
): ServiceVolume | null {
  const postgres = service.source.type === "postgres";
  if (volume === null) {
    if (postgres) {
      throw invalid("Le volume d’une base de données ne peut pas être détaché.", "volume");
    }
    return null;
  }

  const mountPath = volume.mountPath.trim();
  if (!mountPath.startsWith("/") || mountPath.length < 2) {
    throw invalid("Le point de montage doit être un chemin absolu, par exemple « /data ».", "volume.mountPath");
  }
  if (postgres && mountPath !== PG_DATA_PATH) {
    throw invalid(
      "Le point de montage d’une base PostgreSQL ne peut pas être modifié.",
      "volume.mountPath",
    );
  }
  if (!inRange(volume.sizeGb, 1, 100, false)) {
    throw invalid("La taille du volume doit être comprise entre 1 et 100 Go.", "volume.sizeGb");
  }
  const usedGb = service.volume?.usedGb ?? 0;
  if (volume.sizeGb < usedGb) {
    throw invalid(
      `La taille ne peut pas être inférieure à l’espace déjà utilisé (${usedGb.toLocaleString("fr-FR")} Go).`,
      "volume.sizeGb",
    );
  }
  return {
    name: service.volume?.name ?? `${slugify(service.name)}-volume`,
    mountPath,
    sizeGb: volume.sizeGb,
    usedGb,
  };
}

/** Other services reference this one as `${{Name.KEY}}`: follow the rename. */
function renameReferences(db: MockDb, service: Service, previous: string, next: string): boolean {
  const from = `\${{${previous}.`;
  const to = `\${{${next}.`;
  let changed = false;
  for (const variable of db.variables) {
    if (variable.projectId === service.projectId && variable.value.includes(from)) {
      variable.value = variable.value.split(from).join(to);
      variable.updatedAt = iso();
      changed = true;
    }
  }
  return changed;
}

function hasRelease(db: MockDb, service: Service): boolean {
  return (
    service.activeDeploymentId !== null ||
    db.deployments.some((item) => item.serviceId === service.id && item.status === "crashed")
  );
}

function assertNotDeploying(service: Service): void {
  if (service.status === "building" || service.status === "deploying") {
    throw conflict("Un déploiement est en cours pour ce service. Attendez sa fin ou annulez-le.");
  }
}

function assertRelease(db: MockDb, service: Service): void {
  if (!hasRelease(db, service)) {
    throw conflict("Ce service n’a encore aucune version déployée. Lancez un déploiement.");
  }
}

/** Shared with docker.containerAction. */
export function startService(db: MockDb, service: Service): void {
  assertNotDeploying(service);
  if (service.status === "online" || service.status === "restarting") return;
  assertRelease(db, service);
  beginRestart(db, service, { kind: "start" });
  emit(statusEntities(service), { projectId: service.projectId, serviceId: service.id });
}

export function stopService(db: MockDb, service: Service): void {
  if (service.status === "stopped") return;
  const entities = new Set<EntityName>([...statusEntities(service), "activity"]);
  const links = { projectId: service.projectId, serviceId: service.id };

  // Stopping a service also abandons the deployment it was waiting for.
  for (const deployment of db.deployments) {
    if (deployment.serviceId === service.id && isInFlight(deployment)) {
      abortDeployment(db, deployment, "user");
      entities.add("deployments");
    }
  }
  cancelTimer(timerKey.service(service.id));
  delete db.pendingRestarts[service.id];

  // A container that already exited keeps its exit code and its last logs.
  if (containerOf(db, service.id)?.state !== "exited") markContainerExited(db, service, 0);
  setServiceStatus(db, service, "stopped");
  addActivity(db, {
    type: "service.stopped",
    severity: "warning",
    title: "Service arrêté",
    description: service.name,
    ...links,
  });
  emit([...entities], links);
}

export function restartService(db: MockDb, service: Service): void {
  assertNotDeploying(service);
  if (service.status === "restarting") return;
  assertRelease(db, service);
  beginRestart(db, service, { kind: "restart" });
  emit(statusEntities(service), { projectId: service.projectId, serviceId: service.id });
}

export const servicesApi: Api["services"] = {
  list: (filter) =>
    read((db) =>
      newestFirst(
        filter?.projectId
          ? db.services.filter((service) => service.projectId === filter.projectId)
          : db.services,
      ),
    ),

  get: (id) => read((db) => requireService(db, id)),

  update: (id, patch) =>
    write((db) => {
      const service = requireService(db, id);
      const entities = new Set<EntityName>(["services", "activity"]);

      // Validate the whole patch before touching anything.
      const name =
        patch.name !== undefined
          ? assertServiceName(db, service.projectId, patch.name, id)
          : service.name;
      const config = patch.config
        ? validateConfig({ ...service.config, ...patch.config })
        : service.config;
      const source = patch.source ? mergeSource(db, service, patch.source) : service.source;
      const volume =
        patch.volume !== undefined ? resolveVolume(service, patch.volume) : service.volume;

      const previousName = service.name;
      const renamed = name !== previousName;
      service.name = name;
      service.config = config;
      service.source = source;
      service.volume = volume;
      service.updatedAt = iso();

      if (renamed) {
        entities.add("projects");
        if (renameReferences(db, service, previousName, name)) entities.add("variables");
      }
      const database = db.databases.find((item) => item.serviceId === id);
      if (database) {
        database.name = name;
        database.port = config.port;
        if (volume) database.storageLimitMb = Math.round(volume.sizeGb * 1024);
        refreshUrls(database, db.settings.baseDomain);
        syncConnectionVariables(db, database);
        entities.add("databases").add("variables");
      }

      addActivity(db, {
        type: "settings.updated",
        title: renamed ? "Service renommé" : "Réglages du service modifiés",
        description: renamed ? `${previousName} → ${name}` : name,
        projectId: service.projectId,
        serviceId: id,
      });
      emit([...entities], { projectId: service.projectId, serviceId: id });
      return service;
    }),

  updatePositions: (positions) =>
    writeNow((db) => {
      const projects = new Set<string>();
      for (const [id, position] of Object.entries(positions)) {
        const service = db.services.find((item) => item.id === id);
        if (!service || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) continue;
        service.position = { x: position.x, y: position.y };
        projects.add(service.projectId);
      }
      if (projects.size === 0) return;
      const [projectId] = projects;
      emit(["services"], projects.size === 1 ? { projectId } : {});
    }),

  delete: (id) =>
    write((db) => {
      const service = requireService(db, id);
      removeServices(db, new Set([id]));
      const project = db.projects.find((item) => item.id === service.projectId);
      if (project) project.updatedAt = iso();
      addActivity(db, {
        type: "service.deleted",
        severity: "warning",
        title: "Service supprimé",
        description: service.name,
        projectId: service.projectId,
      });
      emit(CASCADE_ENTITIES, { projectId: service.projectId, serviceId: id });
    }),

  start: (id) =>
    write((db) => {
      const service = requireService(db, id);
      startService(db, service);
      return service;
    }),

  stop: (id) =>
    write((db) => {
      const service = requireService(db, id);
      stopService(db, service);
      return service;
    }),

  restart: (id) =>
    write((db) => {
      const service = requireService(db, id);
      restartService(db, service);
      return service;
    }),

  listConnections: (projectId) =>
    read((db) => {
      requireProject(db, projectId);
      return newestFirst(db.connections.filter((item) => item.projectId === projectId));
    }),

  connect: ({ fromServiceId, toServiceId }) =>
    write((db) => {
      const from = requireService(db, fromServiceId);
      const to = requireService(db, toServiceId);
      const { connection, entities } = connectServices(db, from, to);
      emit(entities, { projectId: from.projectId, serviceId: from.id });
      return connection;
    }),

  disconnect: (connectionId) =>
    write((db) => {
      const connection = requireConnection(db, connectionId);
      db.connections = db.connections.filter((item) => item.id !== connectionId);
      emit(["connections"], { projectId: connection.projectId });
    }),
};
