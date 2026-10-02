import type { Prisma } from "@/generated/prisma/client";
import type { Api, EntityName } from "@/lib/api/contract";
import { POSTGRES_VERSIONS } from "@/lib/constants";
import type { Database } from "@/lib/types";

import { recordActivity } from "../activity";
import { requireUser, type Context } from "../context";
import { decryptSecret, encryptSecret, randomToken } from "../crypto";
import { backupFileExists, removeBackupFile } from "../databases/backups";
import { connectToDatabase, readLiveStats, withDatabase } from "../databases/connect";
import { createDatabase } from "../databases/create";
import { runReadOnlyQuery, scanStatement } from "../databases/query";
import { describeTables, readTable } from "../databases/tables";
import { rotateConnectionVariables } from "../databases/variables";
import { db } from "../db";
import { conflict, notFound, unavailable, validation } from "../errors";
import { emit } from "../events";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";
import {
  DATABASE_INCLUDE,
  toDatabase,
  toDatabaseBackup,
  type DatabaseRecord,
} from "../mappers/database";
import { asRecord, asString, inRange } from "../rules";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_OFFSET = 1_000_000_000;
const MAX_LABEL_LENGTH = 80;
const NOT_ONLINE = "La base de données n’est pas en ligne pour le moment.";

async function load(id: string): Promise<DatabaseRecord> {
  const row = await db().managedDatabase.findUnique({ where: { id }, include: DATABASE_INCLUDE });
  if (!row) throw notFound("Base de données");
  return row;
}

async function present(row: DatabaseRecord): Promise<Database> {
  return toDatabase(row, await readLiveStats(row));
}

function scopeOf(row: DatabaseRecord): { projectId: string; serviceId: string } {
  return { projectId: row.projectId, serviceId: row.serviceId };
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;
}

export function createDatabasesApi(ctx: Context): Api["databases"] {
  const actor = (): string => requireUser(ctx).name;

  return {
    async list(rawFilter) {
      const projectId = asString(asRecord(rawFilter).projectId);
      const rows = await db().managedDatabase.findMany({
        where: projectId !== "" ? { projectId } : {},
        include: DATABASE_INCLUDE,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return Promise.all(rows.map(present));
    },

    async get(id) {
      return present(await load(asString(id)));
    },

    async getByService(serviceId) {
      const row = await db().managedDatabase.findUnique({
        where: { serviceId: asString(serviceId) },
        include: DATABASE_INCLUDE,
      });
      if (!row) throw notFound("Base de données");
      return present(row);
    },

    async create(rawInput) {
      const author = actor();
      const input = asRecord(rawInput);
      const version = input.version === undefined ? "17" : asString(input.version);
      if (!POSTGRES_VERSIONS.some((supported) => supported === version)) {
        throw validation("Cette version de PostgreSQL n’est pas disponible.", "version");
      }
      const storageGb = input.storageGb === undefined ? 5 : input.storageGb;
      if (!inRange(storageGb, 1, 100)) {
        throw validation("Le stockage doit être compris entre 1 et 100 Go.", "storageGb");
      }
      if (input.publicNetworking !== undefined && typeof input.publicNetworking !== "boolean") {
        throw validation("L’accès public doit être activé ou désactivé.", "publicNetworking");
      }
      const name = asString(input.name).trim();
      const place = asRecord(input.position);

      const created = await db().$transaction((tx) =>
        createDatabase(tx, {
          projectId: asString(input.projectId),
          name: name !== "" ? name : null,
          version,
          storageGb,
          publicNetworking: input.publicNetworking === true,
          consumerId: asString(input.connectToServiceId) || null,
          position:
            typeof place.x === "number" && typeof place.y === "number" ? { x: place.x, y: place.y } : undefined,
          creator: author,
        }),
      );
      return present(await load(created.id));
    },

    async update(id, rawPatch) {
      const author = actor();
      const row = await load(asString(id));
      const patch = asRecord(rawPatch);
      const data: Prisma.ManagedDatabaseUpdateInput = {};
      const entities: EntityName[] = ["databases"];

      // Recorded only: max_connections is a server parameter that the pipeline passes at the next deployment.
      if (patch.maxConnections !== undefined) {
        if (!inRange(patch.maxConnections, 10, 500)) {
          throw validation("Le nombre maximal de connexions doit être compris entre 10 et 500.", "maxConnections");
        }
        data.maxConnections = patch.maxConnections;
      }
      let volumeSizeGb: number | null = null;
      if (patch.storageLimitMb !== undefined) {
        if (!inRange(patch.storageLimitMb, 1024, 102_400, false)) {
          throw validation("Le stockage doit être compris entre 1 et 100 Go.", "storageLimitMb");
        }
        const limit = Math.round(patch.storageLimitMb);
        if (limit < (await readLiveStats(row)).storageUsedMb) {
          throw validation("Le stockage ne peut pas être inférieur à l’espace déjà utilisé.", "storageLimitMb");
        }
        data.storageLimitMb = limit;
        volumeSizeGb = Math.ceil(limit / 1024);
      }
      // Recorded only, see toDatabase: there is no public TCP proxy yet.
      if (patch.publicNetworking !== undefined) {
        if (typeof patch.publicNetworking !== "boolean") {
          throw validation("L’accès public doit être activé ou désactivé.", "publicNetworking");
        }
        data.publicNetworking = patch.publicNetworking;
      }

      await db().$transaction(async (tx) => {
        await tx.managedDatabase.update({ where: { id: row.id }, data });
        if (volumeSizeGb !== null) {
          await tx.service.updateMany({
            where: { id: row.serviceId, volumeName: { not: null } },
            data: { volumeSizeGb },
          });
          entities.push("services");
        }
        await recordActivity(
          {
            type: "settings.updated",
            title: "Réglages de la base modifiés",
            description: row.service.name,
            ...scopeOf(row),
            actor: author,
          },
          tx,
        );
        await emit(entities, scopeOf(row), tx);
      });
      return present(await load(row.id));
    },

    async rotatePassword(id) {
      const author = actor();
      const row = await load(asString(id));
      const previous = decryptSecret(row.passwordEncrypted);
      const next = randomToken(24);

      // The role changes inside a transaction of the project database that is
      // committed only once the platform has stored the new password: a failure
      // on either side leaves both sides on the old one.
      const client = await connectToDatabase(row, { readOnly: false });
      try {
        try {
          await client.query("BEGIN");
          await client.query(
            `ALTER ROLE ${client.escapeIdentifier(row.username)} WITH PASSWORD ${client.escapeLiteral(next)}`,
          );
        } catch {
          throw unavailable("Le mot de passe n’a pas pu être modifié sur la base de données.");
        }
        try {
          await db().$transaction(async (tx) => {
            await tx.managedDatabase.update({ where: { id: row.id }, data: { passwordEncrypted: encryptSecret(next) } });
            await rotateConnectionVariables(tx, row, previous, next);
            await recordActivity(
              {
                type: "variable.updated",
                severity: "warning",
                title: "Mot de passe régénéré",
                description: `${row.service.name} · PGPASSWORD et DATABASE_URL mis à jour`,
                ...scopeOf(row),
                actor: author,
              },
              tx,
            );
            await emit(["databases", "variables"], scopeOf(row), tx);
          });
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
        await client.query("COMMIT");
      } finally {
        await client.end().catch(() => undefined);
      }
      return present(await load(row.id));
    },

    async listTables(id) {
      const row = await load(asString(id));
      return withDatabase(row, async (client) =>
        (await describeTables(client)).map((table) => ({
          schema: table.schema,
          name: table.name,
          rowCount: table.rowCount,
          sizeKb: table.sizeKb,
          columns: table.columns,
        })),
      );
    },

    async getTableData(id, table, rawParams) {
      const row = await load(asString(id));
      const params = asRecord(rawParams);
      const limit = clampInteger(params.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
      const offset = clampInteger(params.offset, 0, 0, MAX_OFFSET);
      return withDatabase(row, async (client) =>
        readTable(client, await describeTables(client), asString(table), limit, offset),
      );
    },

    async runQuery(id, sql) {
      const row = await load(asString(id));
      // Rejected before any connection is opened.
      const scanned = scanStatement(asString(sql));
      return withDatabase(row, (client) => runReadOnlyQuery(client, scanned));
    },

    async listBackups(id) {
      const row = await load(asString(id));
      const backups = await db().databaseBackup.findMany({
        where: { databaseId: row.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return backups.map(toDatabaseBackup);
    },

    async createBackup(id, rawLabel) {
      const row = await load(asString(id));
      // The dump is taken inside the running container (docker exec pg_dump).
      if (row.service.status !== "online") throw unavailable(NOT_ONLINE);
      const label = asString(rawLabel).trim() || "Sauvegarde manuelle";
      if (label.length > MAX_LABEL_LENGTH) {
        throw validation(`Le libellé ne peut pas dépasser ${MAX_LABEL_LENGTH} caractères.`, "label");
      }

      const backup = await db().$transaction(async (tx) => {
        const created = await tx.databaseBackup.create({
          data: {
            id: newId("bkp"),
            databaseId: row.id,
            label,
            type: "manual",
            status: "in_progress",
            sizeMb: 0,
            createdAt: new Date(),
          },
        });
        await enqueueJob(tx, "backup.create", { databaseId: row.id, backupId: created.id });
        await emit(["backups"], scopeOf(row), tx);
        return created;
      });
      return toDatabaseBackup(backup);
    },

    async restoreBackup(id, rawBackupId) {
      const row = await load(asString(id));
      const backup = await db().databaseBackup.findFirst({
        where: { id: asString(rawBackupId), databaseId: row.id },
      });
      if (!backup) throw notFound("Sauvegarde");
      if (backup.status !== "completed") {
        throw validation("Cette sauvegarde n’est pas terminée et ne peut pas être restaurée.");
      }
      const { status } = row.service;
      if (status === "building" || status === "deploying") {
        throw conflict("Un déploiement est en cours pour cette base. Attendez sa fin.");
      }
      if (status === "restarting") {
        throw conflict("La base redémarre déjà. Réessayez dans un instant.");
      }
      if (status !== "online") throw unavailable(NOT_ONLINE);
      if (!(await backupFileExists(row.id, backup.filePath))) {
        throw validation("Le fichier de cette sauvegarde est introuvable sur le serveur.");
      }

      await db().$transaction(async (tx) => {
        await enqueueJob(tx, "backup.restore", { databaseId: row.id, backupId: backup.id });
        await emit(["backups"], scopeOf(row), tx);
      });
    },

    async deleteBackup(id, rawBackupId) {
      const row = await load(asString(id));
      const backup = await db().databaseBackup.findFirst({
        where: { id: asString(rawBackupId), databaseId: row.id },
      });
      if (!backup) throw notFound("Sauvegarde");
      if (backup.status === "in_progress") {
        throw conflict("Cette sauvegarde est en cours. Attendez sa fin avant de la supprimer.");
      }

      // Best effort: an undeletable file must not keep a backup the user wants gone.
      try {
        if (!(await removeBackupFile(row.id, backup.filePath))) {
          console.error(`[databases] refused to delete a dump outside the backup directory of ${row.id}`);
        }
      } catch (error) {
        console.error(
          "[databases] could not delete a dump file:",
          error instanceof Error ? error.message : "unknown error",
        );
      }
      await db().$transaction(async (tx) => {
        await tx.databaseBackup.deleteMany({ where: { id: backup.id } });
        await emit(["backups"], scopeOf(row), tx);
      });
    },
  };
}
