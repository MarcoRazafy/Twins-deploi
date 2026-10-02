import type { Prisma } from "@/generated/prisma/client";
import type { Api } from "@/lib/api/contract";

import { recordActivity } from "../activity";
import { requireUser, type Context } from "../context";
import { encryptSecret } from "../crypto";
import { db, type DbClient } from "../db";
import { conflict, isUniqueViolation, notFound, validation } from "../errors";
import { emit } from "../events";
import { toEnvVariable } from "../mappers/variable";
import { asRecord, asString, assertVariableKey } from "../rules";
import { createVariable, variableValue } from "../variables/store";

const SHARED_SCOPE = "Variables partagées";
const MAX_VALUE_LENGTH = 65_536;
const MAX_ENTRIES = 1000;

/** `serviceId` must be given: a string, or null for a shared variable (never "missing"). */
function readScope(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  throw validation("Le service est requis (ou null pour une variable partagée).", "serviceId");
}

function readValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw validation("La valeur de la variable doit être du texte.", "value");
  }
  if (value.length > MAX_VALUE_LENGTH) {
    throw validation("La valeur de la variable est trop longue (65 536 caractères maximum).", "value");
  }
  return value;
}

function readKey(value: unknown): string {
  const key = asString(value).trim();
  assertVariableKey(key);
  if (key.length > 255) {
    throw validation("Le nom de la variable est trop long (255 caractères maximum).", "key");
  }
  return key;
}

/** Like a .env file: the last occurrence of a key wins, at the position of that occurrence. */
function readEntries(value: unknown): Map<string, string> {
  if (!Array.isArray(value)) {
    throw validation("Les variables doivent être fournies sous forme de liste.", "entries");
  }
  if (value.length > MAX_ENTRIES) {
    throw validation("Trop de variables à la fois (1 000 maximum).", "entries");
  }
  const entries = new Map<string, string>();
  for (const item of value) {
    const entry = asRecord(item);
    const key = readKey(entry.key);
    entries.delete(key);
    entries.set(key, readValue(entry.value));
  }
  return entries;
}

/** Checks the (project, service) scope exists and returns its display name. */
async function resolveScope(
  client: DbClient,
  projectId: string,
  serviceId: string | null,
): Promise<string> {
  const project = await client.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw notFound("Projet");
  if (serviceId === null) return SHARED_SCOPE;
  const service = await client.service.findUnique({
    where: { id: serviceId },
    select: { projectId: true, name: true },
  });
  if (!service) throw notFound("Service");
  if (service.projectId !== projectId) {
    throw validation("Ce service n’appartient pas à ce projet.", "serviceId");
  }
  return service.name;
}

function links(projectId: string, serviceId: string | null) {
  return serviceId === null ? { projectId } : { projectId, serviceId };
}

const KEY_TAKEN = (key: string): string => `La variable ${key} existe déjà.`;

export function createVariablesApi(ctx: Context): Api["variables"] {
  const actor = (): string => requireUser(ctx).name;

  return {
    async list(rawFilter) {
      const filter = asRecord(rawFilter);
      const where: Prisma.EnvVariableWhereInput = {};
      if (typeof filter.projectId === "string") where.projectId = filter.projectId;
      // null narrows to shared variables (of every project when no projectId is
      // given), a string to that service's own variables.
      if (filter.serviceId === null) where.serviceId = null;
      else if (typeof filter.serviceId === "string") where.serviceId = filter.serviceId;
      const rows = await db().envVariable.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return rows.map(toEnvVariable);
    },

    async create(rawInput) {
      const author = actor();
      const input = asRecord(rawInput);
      const projectId = asString(input.projectId);
      const serviceId = readScope(input.serviceId);
      const key = readKey(input.key);
      const value = readValue(input.value);
      const isSecret = typeof input.isSecret === "boolean" ? input.isSecret : undefined;

      try {
        return await db().$transaction(async (tx) => {
          const scopeName = await resolveScope(tx, projectId, serviceId);
          const taken = await tx.envVariable.findFirst({
            where: { projectId, serviceId, key },
            select: { id: true },
          });
          if (taken) throw conflict(KEY_TAKEN(key), "key");

          const row = await createVariable(tx, { projectId, serviceId, key, value, isSecret });
          await recordActivity(
            {
              type: "variable.updated",
              title: "Variable ajoutée",
              description: `${key} · ${scopeName}`,
              ...links(projectId, serviceId),
              actor: author,
            },
            tx,
          );
          await emit(["variables", "projects"], links(projectId, serviceId), tx);
          return toEnvVariable(row);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict(KEY_TAKEN(key), "key");
        throw error;
      }
    },

    async update(id, rawPatch) {
      const author = actor();
      const variableId = asString(id);
      const patch = asRecord(rawPatch);
      const key = patch.key !== undefined ? readKey(patch.key) : undefined;
      const value = patch.value !== undefined ? readValue(patch.value) : undefined;

      try {
        return await db().$transaction(async (tx) => {
          const current = await tx.envVariable.findUnique({
            where: { id: variableId },
            include: { service: { select: { name: true } } },
          });
          if (!current) throw notFound("Variable");

          const data: Prisma.EnvVariableUpdateInput = {};
          if (key !== undefined) {
            const taken = await tx.envVariable.findFirst({
              where: {
                projectId: current.projectId,
                serviceId: current.serviceId,
                key,
                NOT: { id: variableId },
              },
              select: { id: true },
            });
            if (taken) throw conflict(KEY_TAKEN(key), "key");
            data.key = key;
          }
          if (value !== undefined) data.valueEncrypted = encryptSecret(value);
          if (typeof patch.isSecret === "boolean") data.isSecret = patch.isSecret;

          const row = await tx.envVariable.update({ where: { id: variableId }, data });
          await recordActivity(
            {
              type: "variable.updated",
              title: "Variable modifiée",
              description: `${row.key} · ${current.service?.name ?? SHARED_SCOPE}`,
              ...links(row.projectId, row.serviceId),
              actor: author,
            },
            tx,
          );
          await emit(["variables"], links(row.projectId, row.serviceId), tx);
          return toEnvVariable(row);
        });
      } catch (error) {
        if (isUniqueViolation(error) && key !== undefined) throw conflict(KEY_TAKEN(key), "key");
        throw error;
      }
    },

    async delete(id) {
      const author = actor();
      await db().$transaction(async (tx) => {
        const current = await tx.envVariable.findUnique({
          where: { id: asString(id) },
          include: { service: { select: { name: true } } },
        });
        if (!current) throw notFound("Variable");
        await tx.envVariable.delete({ where: { id: current.id } });
        await recordActivity(
          {
            type: "variable.updated",
            severity: "warning",
            title: "Variable supprimée",
            description: `${current.key} · ${current.service?.name ?? SHARED_SCOPE}`,
            ...links(current.projectId, current.serviceId),
            actor: author,
          },
          tx,
        );
        await emit(["variables", "projects"], links(current.projectId, current.serviceId), tx);
      });
    },

    async bulkUpsert(rawInput) {
      const author = actor();
      const input = asRecord(rawInput);
      const projectId = asString(input.projectId);
      const serviceId = readScope(input.serviceId);
      const entries = readEntries(input.entries);
      const replace = input.replace === true;

      return db().$transaction(async (tx) => {
        const scopeName = await resolveScope(tx, projectId, serviceId);
        const existing = await tx.envVariable.findMany({ where: { projectId, serviceId } });
        const byKey = new Map(existing.map((row) => [row.key, row]));
        const base = Date.now();
        let changes = 0;

        let index = 0;
        for (const [key, value] of entries) {
          const current = byKey.get(key);
          if (!current) {
            // Listed newest first: the first entry gets the latest timestamp, so
            // the scope reads in the order of `entries`.
            await createVariable(tx, {
              projectId,
              serviceId,
              key,
              value,
              createdAt: new Date(base + (entries.size - 1 - index)),
            });
            changes += 1;
          } else if (variableValue(current) !== value) {
            await tx.envVariable.update({
              where: { id: current.id },
              data: { valueEncrypted: encryptSecret(value) },
            });
            changes += 1;
          }
          index += 1;
        }

        if (replace) {
          const removed = existing.filter((row) => !entries.has(row.key));
          if (removed.length > 0) {
            await tx.envVariable.deleteMany({ where: { id: { in: removed.map((row) => row.id) } } });
          }
          changes += removed.length;
        }

        if (changes > 0) {
          await recordActivity(
            {
              type: "variable.updated",
              title: "Variables mises à jour",
              description: `${changes} modification${changes > 1 ? "s" : ""} · ${scopeName}`,
              ...links(projectId, serviceId),
              actor: author,
            },
            tx,
          );
          await emit(["variables", "projects"], links(projectId, serviceId), tx);
        }

        const rows = await tx.envVariable.findMany({
          where: { projectId, serviceId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        return rows.map(toEnvVariable);
      });
    },
  };
}
