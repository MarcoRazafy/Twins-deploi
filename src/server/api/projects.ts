import { Prisma, type Project as ProjectRow } from "@/generated/prisma/client";
import type { Api } from "@/lib/api/contract";
import {
  PROJECT_COLORS,
  REGIONS,
  type DeploymentStatus,
  type ProjectColor,
  type ProjectSummary,
  type Region,
} from "@/lib/types";

import { recordActivity } from "../activity";
import { requireUser, type Context } from "../context";
import { db } from "../db";
import { conflict, isUniqueViolation, notFound, validation } from "../errors";
import { emit } from "../events";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";
import { toProject, toProjectSummary, type ProjectAggregates } from "../mappers/project";
import { getPlatformSettings } from "../platform-settings";
import { asRecord, asString, toSlug, uniqueSlug, validProjectName } from "../rules";
import { CLEANUP_INCLUDE, enqueueServiceCleanup } from "../services/cleanup";
import { projectNetworkName } from "../services/names";
import { CASCADE_ENTITIES } from "../services/status";

/** The network goes after the cleanup.service jobs of the same deletion (jobs run by runAt). */
const NETWORK_CLEANUP_DELAY_MS = 5_000;

interface LastDeploymentRow {
  id: string;
  projectId: string;
  serviceId: string;
  status: DeploymentStatus;
  createdAt: Date;
}

/** Summaries of many projects with a fixed number of queries, whatever their count. */
async function summarize(rows: ProjectRow[]): Promise<ProjectSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [services, domains, variables, deployments, lastDeployments] = await Promise.all([
    db().service.findMany({
      where: { projectId: { in: ids } },
      select: { id: true, projectId: true, name: true, type: true, status: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db().domain.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _count: { _all: true } }),
    db().envVariable.groupBy({
      by: ["projectId"],
      where: { projectId: { in: ids } },
      _count: { _all: true },
    }),
    db().deployment.groupBy({
      by: ["projectId"],
      where: { projectId: { in: ids } },
      _count: { _all: true },
    }),
    db().$queryRaw<LastDeploymentRow[]>`
      SELECT DISTINCT ON ("projectId") id, "projectId", "serviceId", status::text AS status, "createdAt"
      FROM deployments
      WHERE "projectId" IN (${Prisma.join(ids)})
      ORDER BY "projectId", "createdAt" DESC, id DESC`,
  ]);

  const servicesByProject = new Map<string, ProjectAggregates["services"]>();
  for (const { projectId, ...preview } of services) {
    const list = servicesByProject.get(projectId) ?? [];
    list.push(preview);
    servicesByProject.set(projectId, list);
  }
  const counts = (groups: Array<{ projectId: string; _count: { _all: number } }>) =>
    new Map(groups.map((group) => [group.projectId, group._count._all]));
  const domainCounts = counts(domains);
  const variableCounts = counts(variables);
  const deploymentCounts = counts(deployments);
  const lastByProject = new Map(lastDeployments.map((item) => [item.projectId, item]));

  return rows.map((row) =>
    toProjectSummary(row, {
      services: servicesByProject.get(row.id) ?? [],
      domains: domainCounts.get(row.id) ?? 0,
      variables: variableCounts.get(row.id) ?? 0,
      deployments: deploymentCounts.get(row.id) ?? 0,
      lastDeployment: lastByProject.get(row.id) ?? null,
    }),
  );
}

function readColor(value: unknown): ProjectColor | undefined {
  if (value === undefined) return undefined;
  const color = PROJECT_COLORS.find((candidate) => candidate === value);
  if (color === undefined) throw validation("Cette couleur n’est pas disponible.", "color");
  return color;
}

function readRegion(value: unknown): Region | undefined {
  if (value === undefined) return undefined;
  const region = REGIONS.find((candidate) => candidate === value);
  if (region === undefined) throw validation("Cette région n’est pas disponible.", "region");
  return region;
}

function readDescription(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw validation("La description doit être du texte.", "description");
  }
  const trimmed = value.trim();
  if (trimmed.length > 280) {
    throw validation("La description ne peut pas dépasser 280 caractères.", "description");
  }
  return trimmed;
}

const NAME_TAKEN = "Un projet porte déjà ce nom.";

export function createProjectsApi(ctx: Context): Api["projects"] {
  const actor = (): string => requireUser(ctx).name;

  return {
    async list() {
      const rows = await db().project.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return summarize(rows);
    },

    async get(id) {
      const row = await db().project.findUnique({ where: { id: asString(id) } });
      if (!row) throw notFound("Projet");
      const [summary] = await summarize([row]);
      return summary;
    },

    async create(rawInput) {
      const author = actor();
      const input = asRecord(rawInput);
      const name = validProjectName(input.name);
      const color = readColor(input.color);
      const region = readRegion(input.region);
      const description = readDescription(input.description) ?? "";
      const nameKey = name.toLowerCase();
      const baseSlug = toSlug(name, "projet");

      // A concurrent creation can take the name or the slug between our checks and the insert.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await db().$transaction(async (tx) => {
            if (await tx.project.findUnique({ where: { nameKey }, select: { id: true } })) {
              throw conflict(NAME_TAKEN, "name");
            }
            const slugs = await tx.project.findMany({
              where: { slug: { startsWith: baseSlug } },
              select: { slug: true },
            });
            const existing = await tx.project.count();
            const settings = await getPlatformSettings(tx);
            const row = await tx.project.create({
              data: {
                id: newId("prj"),
                name,
                nameKey,
                slug: uniqueSlug(baseSlug, slugs.map((item) => item.slug)),
                description,
                // Rotates through the palette so new projects are easy to tell apart.
                color: color ?? PROJECT_COLORS[existing % PROJECT_COLORS.length],
                region: region ?? settings.defaultRegion,
              },
            });
            await recordActivity(
              {
                type: "project.created",
                title: "Projet créé",
                description: row.name,
                projectId: row.id,
                actor: author,
              },
              tx,
            );
            await emit(["projects"], { projectId: row.id }, tx);
            return toProject(row);
          });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
      }
      throw conflict(NAME_TAKEN, "name");
    },

    async update(id, rawPatch) {
      const author = actor();
      const projectId = asString(id);
      const patch = asRecord(rawPatch);
      const name = patch.name !== undefined ? validProjectName(patch.name) : undefined;
      const color = readColor(patch.color);
      const region = readRegion(patch.region);
      const description = readDescription(patch.description);

      try {
        return await db().$transaction(async (tx) => {
          const current = await tx.project.findUnique({ where: { id: projectId } });
          if (!current) throw notFound("Projet");

          const data: Prisma.ProjectUpdateInput = {};
          if (name !== undefined) {
            const nameKey = name.toLowerCase();
            const taken = await tx.project.findFirst({
              where: { nameKey, NOT: { id: projectId } },
              select: { id: true },
            });
            if (taken) throw conflict(NAME_TAKEN, "name");
            if (name !== current.name) {
              const baseSlug = toSlug(name, "projet");
              const slugs = await tx.project.findMany({
                where: { slug: { startsWith: baseSlug }, NOT: { id: projectId } },
                select: { slug: true },
              });
              data.name = name;
              data.nameKey = nameKey;
              data.slug = uniqueSlug(baseSlug, slugs.map((item) => item.slug));
            }
          }
          if (description !== undefined) data.description = description;
          if (color !== undefined) data.color = color;
          if (region !== undefined) data.region = region;

          const row = await tx.project.update({ where: { id: projectId }, data });
          await recordActivity(
            {
              type: "project.updated",
              title: "Projet modifié",
              description: row.name,
              projectId,
              actor: author,
            },
            tx,
          );
          await emit(["projects"], { projectId }, tx);
          return toProject(row);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict(NAME_TAKEN, "name");
        throw error;
      }
    },

    async delete(id) {
      const author = actor();
      await db().$transaction(async (tx) => {
        const project = await tx.project.findUnique({
          where: { id: asString(id) },
          include: { services: { include: CLEANUP_INCLUDE } },
        });
        if (!project) throw notFound("Projet");

        // What the worker needs is captured before the rows disappear.
        const now = Date.now();
        for (const service of project.services) {
          await enqueueServiceCleanup(tx, service, new Date(now));
        }
        await enqueueJob(
          tx,
          "cleanup.project",
          { projectId: project.id, network: projectNetworkName(project.id) },
          new Date(now + NETWORK_CLEANUP_DELAY_MS),
        );

        // The audit trail survives, without links to things that no longer exist.
        await tx.activityEvent.updateMany({
          where: { projectId: project.id },
          data: { projectId: null, serviceId: null, deploymentId: null },
        });
        // Services, deployments, logs, variables, domains, databases… go with it (ON DELETE CASCADE).
        await tx.project.delete({ where: { id: project.id } });

        await recordActivity(
          {
            type: "project.deleted",
            severity: "warning",
            title: "Projet supprimé",
            description: project.name,
            actor: author,
          },
          tx,
        );
        await emit(CASCADE_ENTITIES, { projectId: project.id }, tx);
      });
    },
  };
}
