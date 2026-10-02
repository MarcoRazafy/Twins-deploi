import type { Api, EntityName } from "@/lib/api/contract";
import { POSTGRES_VERSIONS } from "@/lib/constants";
import type { DatabaseBackup } from "@/lib/types";

import { addActivity } from "../domain/activity";
import { connectServices } from "../domain/connections";
import {
  PG_DATA_PATH,
  refreshUrls,
  syncConnectionVariables,
  toDatabase,
} from "../domain/databases";
import { startDeployment } from "../domain/deployments";
import {
  addContainer,
  addService,
  defaultConfig,
  resolveServiceName,
  statusEntities,
} from "../domain/services";
import { emit } from "../emitter";
import { conflict, invalid, notFound, unavailable } from "../errors";
import { runSql } from "../generators/sql";
import { describeTables, findTable, readRows } from "../generators/tables";
import { newId, newPassword, randomBetween, randomInt } from "../ids";
import { requireBackup, requireDatabase, requireProject, requireService } from "../lookup";
import type { DatabaseRecord, MockDb } from "../schema";
import { beginBackup } from "../simulator/backups";
import { beginRestart } from "../simulator/services";
import { iso, newestFirst, slugify } from "../text";
import { cancelTimer, timerKey } from "../timers";
import { read, write } from "./respond";

function links(database: DatabaseRecord) {
  return { projectId: database.projectId, serviceId: database.serviceId };
}

function liveStatus(db: MockDb, database: DatabaseRecord) {
  return db.services.find((item) => item.id === database.serviceId)?.status ?? database.status;
}

function assertOnline(db: MockDb, database: DatabaseRecord): void {
  if (liveStatus(db, database) !== "online") {
    throw unavailable("La base de données n’est pas en ligne pour le moment.");
  }
}

const supportedVersions: readonly string[] = POSTGRES_VERSIONS;

export const databasesApi: Api["databases"] = {
  list: (filter) =>
    read((db) => {
      const now = Date.now();
      return newestFirst(
        filter?.projectId
          ? db.databases.filter((database) => database.projectId === filter.projectId)
          : db.databases,
      ).map((database) => toDatabase(db, database, now));
    }),

  get: (id) => read((db) => toDatabase(db, requireDatabase(db, id), Date.now())),

  getByService: (serviceId) =>
    read((db) => {
      const database = db.databases.find((item) => item.serviceId === serviceId);
      if (!database) throw notFound("Base de données");
      return toDatabase(db, database, Date.now());
    }),

  create: (input) =>
    write((db) => {
      const project = requireProject(db, input.projectId);
      const version = input.version ?? "17";
      if (!supportedVersions.includes(version)) {
        throw invalid("Cette version de PostgreSQL n’est pas disponible.", "version");
      }
      const storageGb = input.storageGb ?? 5;
      if (!Number.isFinite(storageGb) || storageGb < 1 || storageGb > 100) {
        throw invalid("Le stockage doit être compris entre 1 et 100 Go.", "storageGb");
      }
      const consumer = input.connectToServiceId
        ? requireService(db, input.connectToServiceId)
        : null;
      if (consumer && consumer.projectId !== project.id) {
        throw invalid("Le service à connecter doit appartenir au même projet.", "connectToServiceId");
      }

      const name = resolveServiceName(db, project.id, input.name, "Postgres");
      const slug = slugify(name, "postgres");
      const publicNetworking = input.publicNetworking ?? false;

      const service = addService(db, {
        project,
        name,
        source: { type: "postgres", version },
        config: defaultConfig(db.settings, { port: 5432, restartPolicy: "always" }),
        volume: { name: `${slug}-volume`, mountPath: PG_DATA_PATH, sizeGb: storageGb, usedGb: 0.04 },
        position: input.position,
      });
      addContainer(db, project, service, `postgres:${version}`);

      const database: DatabaseRecord = {
        id: newId("db"),
        serviceId: service.id,
        projectId: project.id,
        name,
        engine: "postgres",
        version,
        status: service.status,
        host: `${slug}.railway.internal`,
        port: 5432,
        database: "railway",
        username: "postgres",
        password: newPassword(),
        internalUrl: "",
        publicNetworking,
        publicUrl: null,
        // A freshly initialised cluster already weighs a few dozen megabytes.
        storageUsedMb: 39,
        storageLimitMb: Math.round(storageGb * 1024),
        connections: 2,
        maxConnections: 100,
        extensions: ["plpgsql"],
        createdAt: service.createdAt,
        dataset: null,
        proxyPort: publicNetworking ? randomInt(10_000, 59_999) : null,
      };
      refreshUrls(database, db.settings.baseDomain);
      db.databases.unshift(database);
      syncConnectionVariables(db, database);
      if (consumer) connectServices(db, consumer, service);

      addActivity(db, {
        type: "database.created",
        title: "Base de données créée",
        description: `${name} · PostgreSQL ${version}`,
        ...links(database),
      });
      const deployment = startDeployment(db, service, { trigger: "initial", commit: null });

      emit(
        [
          "databases",
          "services",
          "containers",
          "variables",
          "connections",
          "deployments",
          "projects",
          "metrics",
          "activity",
        ],
        { ...links(database), deploymentId: deployment.id },
      );
      return toDatabase(db, database, Date.now());
    }),

  update: (id, patch) =>
    write((db) => {
      const database = requireDatabase(db, id);
      if (patch.maxConnections !== undefined) {
        if (!Number.isInteger(patch.maxConnections) || patch.maxConnections < 10 || patch.maxConnections > 500) {
          throw invalid("Le nombre maximal de connexions doit être compris entre 10 et 500.", "maxConnections");
        }
      }
      if (patch.storageLimitMb !== undefined) {
        const limit = patch.storageLimitMb;
        if (!Number.isFinite(limit) || limit < 1024 || limit > 102_400) {
          throw invalid("Le stockage doit être compris entre 1 et 100 Go.", "storageLimitMb");
        }
        if (limit < database.storageUsedMb) {
          throw invalid(
            "Le stockage ne peut pas être inférieur à l’espace déjà utilisé.",
            "storageLimitMb",
          );
        }
      }

      const entities: EntityName[] = ["databases", "activity"];
      if (patch.maxConnections !== undefined) database.maxConnections = patch.maxConnections;
      if (patch.storageLimitMb !== undefined) {
        database.storageLimitMb = Math.round(patch.storageLimitMb);
        const service = db.services.find((item) => item.id === database.serviceId);
        if (service?.volume) {
          service.volume = { ...service.volume, sizeGb: database.storageLimitMb / 1024 };
          service.updatedAt = iso();
          entities.push("services");
        }
      }
      if (patch.publicNetworking !== undefined) {
        database.publicNetworking = patch.publicNetworking;
        if (patch.publicNetworking && database.proxyPort === null) {
          database.proxyPort = randomInt(10_000, 59_999);
        }
        refreshUrls(database, db.settings.baseDomain);
      }

      addActivity(db, {
        type: "settings.updated",
        title: "Réglages de la base modifiés",
        description: database.name,
        ...links(database),
      });
      emit(entities, links(database));
      return toDatabase(db, database, Date.now());
    }),

  rotatePassword: (id) =>
    write((db) => {
      const database = requireDatabase(db, id);
      database.password = newPassword();
      refreshUrls(database, db.settings.baseDomain);
      syncConnectionVariables(db, database);

      addActivity(db, {
        type: "variable.updated",
        severity: "warning",
        title: "Mot de passe régénéré",
        description: `${database.name} · PGPASSWORD et DATABASE_URL mis à jour`,
        ...links(database),
      });
      emit(["databases", "variables", "activity"], links(database));
      return toDatabase(db, database, Date.now());
    }),

  listTables: (id) => read((db) => describeTables(requireDatabase(db, id).dataset)),

  getTableData: (id, table, params = {}) =>
    read((db) => {
      const database = requireDatabase(db, id);
      const spec = findTable(database.dataset, table);
      if (!spec || !database.dataset) throw notFound("Table");
      const limit = Math.min(500, Math.max(1, Math.floor(params.limit ?? 50)));
      const offset = Math.max(0, Math.floor(params.offset ?? 0));
      return {
        columns: spec.columns,
        rows: readRows(database.dataset, spec, offset, limit, Date.parse(db.seededAt)),
        total: spec.rowCount,
      };
    }),

  runQuery: (id, sql) =>
    read((db) => {
      const database = requireDatabase(db, id);
      assertOnline(db, database);
      const result = runSql(sql ?? "", {
        dataset: database.dataset,
        version: database.version,
        database: database.database,
        anchor: Date.parse(db.seededAt),
        now: Date.now(),
      });
      return {
        ...result,
        rowCount: result.rows.length,
        durationMs: Math.round((randomBetween(0.4, 4) + result.rows.length * 0.012) * 100) / 100,
      };
    }),

  listBackups: (id) =>
    read((db) => {
      requireDatabase(db, id);
      return newestFirst(db.backups.filter((backup) => backup.databaseId === id));
    }),

  createBackup: (id, label) =>
    write((db) => {
      const database = requireDatabase(db, id);
      assertOnline(db, database);
      const name = (label ?? "").trim() || "Sauvegarde manuelle";
      if (name.length > 80) {
        throw invalid("Le libellé ne peut pas dépasser 80 caractères.", "label");
      }

      const backup: DatabaseBackup = {
        id: newId("bkp"),
        databaseId: id,
        label: name,
        type: "manual",
        status: "in_progress",
        sizeMb: 0,
        createdAt: iso(),
        completedAt: null,
      };
      db.backups.unshift(backup);
      beginBackup(backup);
      emit(["backups"], links(database));
      return backup;
    }),

  restoreBackup: (id, backupId) =>
    write((db) => {
      const database = requireDatabase(db, id);
      const backup = requireBackup(db, id, backupId);
      if (backup.status !== "completed") {
        throw conflict("Cette sauvegarde n’est pas terminée et ne peut pas être restaurée.");
      }
      const service = requireService(db, database.serviceId);
      if (service.status === "building" || service.status === "deploying") {
        throw conflict("Un déploiement est en cours pour cette base. Attendez sa fin.");
      }
      if (service.status === "restarting") {
        throw conflict("La base redémarre déjà. Réessayez dans un instant.");
      }
      beginRestart(db, service, { kind: "restore", backupId });
      emit(statusEntities(service), links(database));
    }),

  deleteBackup: (id, backupId) =>
    write((db) => {
      const database = requireDatabase(db, id);
      const backup = requireBackup(db, id, backupId);
      if (backup.status === "in_progress") {
        throw conflict("Cette sauvegarde est en cours. Attendez sa fin avant de la supprimer.");
      }
      cancelTimer(timerKey.backup(backupId));
      db.backups = db.backups.filter((item) => item.id !== backupId);
      emit(["backups"], links(database));
    }),
};
