import type { Prisma } from "@/generated/prisma/client";
import type { Api } from "@/lib/api/contract";
import type { ServiceType } from "@/lib/types";

import { recordActivity } from "../activity";
import { requireUser, type Context } from "../context";
import { db, type DbClient } from "../db";
import { publishDomain, isPublishable, syncPrimaryDomain } from "../domains/publish";
import { dnsRecordsFor } from "../domains/records";
import { env } from "../env";
import { conflict, isUniqueViolation, notFound, validation } from "../errors";
import { emit } from "../events";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";
import { randomHex } from "../crypto";
import { toDomain } from "../mappers/domain";
import { getPlatformSettings } from "../platform-settings";
import { isLocalHostname, unpublishHost } from "../proxy";
import { asRecord, asString, inRange, isFqdn, normalizeHostname } from "../rules";

const HOSTNAME_TAKEN = "Ce domaine est déjà utilisé par un service.";
/** DNS labels hold 63 characters: "<service>-<project>-<4 hex>" must fit in one. */
const SLUG_PART_LENGTH = 28;

function assertExposable(type: ServiceType): void {
  if (type === "postgres") {
    throw validation(
      "Les bases de données ne sont pas exposées en HTTP : utilisez leur URL de connexion.",
      "serviceId",
    );
  }
}

function validPort(value: unknown): number {
  if (!inRange(value, 1, 65_535)) {
    throw validation("Le port cible doit être compris entre 1 et 65535.", "targetPort");
  }
  return value;
}

function slugPart(slug: string): string {
  return slug.slice(0, SLUG_PART_LENGTH).replace(/-+$/, "");
}

/** "<service>-<project>-<4 hex>.<base domain>", not used by any domain yet. */
async function freeGeneratedHostname(
  client: DbClient,
  serviceSlug: string,
  projectSlug: string,
  baseDomain: string,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const hostname = `${slugPart(serviceSlug)}-${slugPart(projectSlug)}-${randomHex(2)}.${baseDomain}`;
    if (!isFqdn(hostname)) {
      throw validation("Le domaine de base de la plateforme n’est pas valide : corrigez-le dans les réglages.");
    }
    const taken = await client.domain.findUnique({ where: { hostname }, select: { id: true } });
    if (!taken) return hostname;
  }
  throw conflict("Impossible de générer un nom de domaine libre. Réessayez.");
}

export function createDomainsApi(ctx: Context): Api["domains"] {
  const actor = (): string => requireUser(ctx).name;

  return {
    async list(rawFilter) {
      const filter = asRecord(rawFilter);
      const projectId = asString(filter.projectId);
      const serviceId = asString(filter.serviceId);
      const rows = await db().domain.findMany({
        where: {
          ...(projectId !== "" ? { projectId } : {}),
          ...(serviceId !== "" ? { serviceId } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return rows.map(toDomain);
    },

    async create(rawInput) {
      const author = actor();
      const input = asRecord(rawInput);
      const hostname = normalizeHostname(input.hostname);
      if (!isFqdn(hostname)) {
        throw validation("Saisissez un nom de domaine valide, par exemple app.exemple.mg.", "hostname");
      }

      try {
        const created = await db().$transaction(async (tx) => {
          const service = await tx.service.findUnique({ where: { id: asString(input.serviceId) } });
          if (!service) throw notFound("Service");
          assertExposable(service.type);

          const settings = await getPlatformSettings(tx);
          const bases = new Set([env.baseDomain, settings.baseDomain.toLowerCase()]);
          if (bases.has(hostname)) {
            throw conflict("Ce nom de domaine est réservé à la plateforme.", "hostname");
          }
          for (const base of bases) {
            if (hostname.endsWith(`.${base}`)) {
              throw validation(
                `Les sous-domaines de ${base} sont réservés aux domaines générés.`,
                "hostname",
              );
            }
          }
          const taken = await tx.domain.findUnique({ where: { hostname }, select: { id: true } });
          if (taken) throw conflict(HOSTNAME_TAKEN, "hostname");
          const targetPort = input.targetPort === undefined ? service.port : validPort(input.targetPort);

          const local = isLocalHostname(hostname);
          const row = await tx.domain.create({
            data: {
              id: newId("dom"),
              projectId: service.projectId,
              serviceId: service.id,
              hostname,
              kind: "custom",
              // A local name needs no DNS: it only waits for its container.
              status: local ? "verifying" : "pending_dns",
              targetPort,
              dnsRecords: (local ? [] : dnsRecordsFor(hostname, settings.dns)) as unknown as Prisma.InputJsonArray,
              forceHttps: settings.nginx.forceHttps,
            },
          });
          await recordActivity(
            {
              type: "domain.added",
              title: "Domaine ajouté",
              description: `${hostname} · ${service.name}`,
              projectId: service.projectId,
              serviceId: service.id,
              actor: author,
            },
            tx,
          );
          await emit(["domains", "projects"], { projectId: service.projectId, serviceId: service.id }, tx);
          return row;
        });
        // Helpers are slow and external: never inside the transaction.
        const published = isLocalHostname(hostname) ? await publishDomain(created.id) : created;
        return toDomain(published ?? created);
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict(HOSTNAME_TAKEN, "hostname");
        throw error;
      }
    },

    async generate(rawServiceId) {
      const author = actor();
      const created = await db().$transaction(async (tx) => {
        const service = await tx.service.findUnique({
          where: { id: asString(rawServiceId) },
          include: { project: { select: { slug: true } } },
        });
        if (!service) throw notFound("Service");
        assertExposable(service.type);

        const settings = await getPlatformSettings(tx);
        const hostname = await freeGeneratedHostname(tx, service.slug, service.project.slug, settings.baseDomain);
        const row = await tx.domain.create({
          data: {
            id: newId("dom"),
            projectId: service.projectId,
            serviceId: service.id,
            hostname,
            kind: "generated",
            status: "verifying",
            targetPort: service.port,
            dnsRecords: [],
            forceHttps: settings.nginx.forceHttps,
          },
        });
        await recordActivity(
          {
            type: "domain.added",
            title: "Domaine généré",
            description: `${hostname} · ${service.name}`,
            projectId: service.projectId,
            serviceId: service.id,
            actor: author,
          },
          tx,
        );
        await emit(["domains", "projects"], { projectId: service.projectId, serviceId: service.id }, tx);
        return row;
      });
      const published = await publishDomain(created.id);
      return toDomain(published ?? created);
    },

    async update(rawId, rawPatch) {
      const id = asString(rawId);
      const patch = asRecord(rawPatch);
      const data: Prisma.DomainUpdateInput = {};
      if (patch.targetPort !== undefined) data.targetPort = validPort(patch.targetPort);
      if (patch.forceHttps !== undefined) {
        if (typeof patch.forceHttps !== "boolean") {
          throw validation("Le forçage du HTTPS doit être activé ou désactivé.", "forceHttps");
        }
        data.forceHttps = patch.forceHttps;
      }

      const row = await db().$transaction(async (tx) => {
        const current = await tx.domain.findUnique({ where: { id }, select: { id: true } });
        if (!current) throw notFound("Domaine");
        const updated = await tx.domain.update({ where: { id }, data });
        await emit(["domains"], { projectId: updated.projectId, serviceId: updated.serviceId }, tx);
        return updated;
      });
      const republished = isPublishable(row) ? await publishDomain(id) : row;
      return toDomain(republished ?? row);
    },

    async verify(rawId) {
      const id = asString(rawId);
      const domain = await db().domain.findUnique({ where: { id } });
      if (!domain) throw notFound("Domaine");

      // Nothing to look up in DNS: verifying means publishing again.
      if (domain.kind === "generated" || isLocalHostname(domain.hostname)) {
        const published = await publishDomain(id);
        if (!published) throw notFound("Domaine");
        return toDomain(published);
      }

      const row = await db().$transaction(async (tx) => {
        const queued = await tx.job.findFirst({
          where: {
            type: "domain.verify",
            status: { in: ["pending", "running"] },
            payload: { path: ["domainId"], equals: id },
          },
          select: { id: true },
        });
        // A check already waiting for the worker is not queued twice.
        if (queued && domain.status === "verifying") return domain;

        const updated = await tx.domain.update({ where: { id }, data: { status: "verifying", error: null } });
        if (!queued) await enqueueJob(tx, "domain.verify", { domainId: id });
        await syncPrimaryDomain(tx, updated.serviceId);
        await emit(["domains", "services", "projects"], { projectId: updated.projectId, serviceId: updated.serviceId }, tx);
        return updated;
      });
      return toDomain(row);
    },

    async delete(rawId) {
      const author = actor();
      const domain = await db().domain.findUnique({
        where: { id: asString(rawId) },
        include: { service: { select: { name: true } } },
      });
      if (!domain) throw notFound("Domaine");

      // Best effort: a helper failure must not keep a domain the user wants gone.
      const unpublished = await unpublishHost(domain.hostname);
      if (!unpublished.ok && unpublished.reason !== "not_configured") {
        console.error(`[domains] could not unpublish ${domain.hostname}: ${unpublished.message}`);
      }

      await db().$transaction(async (tx) => {
        await tx.domain.deleteMany({ where: { id: domain.id } });
        await syncPrimaryDomain(tx, domain.serviceId);
        await recordActivity(
          {
            type: "domain.removed",
            severity: "warning",
            title: "Domaine supprimé",
            description: domain.hostname,
            projectId: domain.projectId,
            serviceId: domain.serviceId,
            actor: author,
          },
          tx,
        );
        await emit(["domains", "services", "projects"], { projectId: domain.projectId, serviceId: domain.serviceId }, tx);
      });
    },
  };
}
