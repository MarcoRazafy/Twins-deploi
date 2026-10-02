/**
 * Publishing of domains: making a hostname reach the container of its service
 * through the privileged helpers (src/server/proxy.ts).
 *
 * Domain states in this version (there is no TLS yet, `ssl.status` stays "none"):
 * - public custom domain: pending_dns → verifying (DNS check queued) → published
 *   once the records resolve (see verify.ts) or error;
 * - local (.test / .localhost) and generated domains: published as soon as the
 *   service has a running container; "verifying" while it has none.
 * Published = "active". The pipeline calls `publishServiceDomains` after every
 * successful deployment (the host port may have changed) and the worker calls
 * `unpublishServiceDomains` when a service stops serving.
 */

import type { Domain as DomainRow, Prisma } from "@/generated/prisma/client";

import { db, type DbClient } from "../db";
import { emit } from "../events";
import { getPlatformSettings } from "../platform-settings";
import { isLocalHostname, publishHost, unpublishHost } from "../proxy";

/** True for a domain the proxy may serve: generated, local, or a public one whose DNS was verified. */
export function isPublishable(domain: Pick<DomainRow, "kind" | "hostname" | "verifiedAt">): boolean {
  return domain.kind === "generated" || isLocalHostname(domain.hostname) || domain.verifiedAt !== null;
}

/**
 * service.primaryDomain = hostname of the first active domain, custom before
 * generated, oldest first; null when none. Resolves with true when it changed.
 */
export async function syncPrimaryDomain(client: DbClient, serviceId: string): Promise<boolean> {
  const service = await client.service.findUnique({
    where: { id: serviceId },
    select: { primaryDomain: true },
  });
  if (!service) return false;
  const active = await client.domain.findMany({
    where: { serviceId, status: "active" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { hostname: true, kind: true },
  });
  const next = (active.find((domain) => domain.kind === "custom") ?? active[0])?.hostname ?? null;
  if (service.primaryDomain === next) return false;
  await client.service.update({ where: { id: serviceId }, data: { primaryDomain: next } });
  return true;
}

/**
 * Writes the new state of a domain, keeps the primary domain of its service in
 * sync and emits. Resolves with the row, or null when the domain was deleted meanwhile.
 */
export function updateDomainState(
  domainId: string,
  data: Prisma.DomainUpdateManyMutationInput,
): Promise<DomainRow | null> {
  return db().$transaction(async (tx) => {
    const { count } = await tx.domain.updateMany({ where: { id: domainId }, data });
    if (count === 0) return null;
    const row = await tx.domain.findUnique({ where: { id: domainId } });
    if (!row) return null;
    await syncPrimaryDomain(tx, row.serviceId);
    await emit(["domains", "services", "projects"], { projectId: row.projectId, serviceId: row.serviceId }, tx);
    return row;
  });
}

/**
 * Publishes one domain.
 * - service without a running container (no host port): the domain waits in "verifying";
 * - otherwise the proxy entry is applied: "active" on success, "error" with the
 *   helper's message on failure (also when the helpers are not installed).
 * A public domain whose DNS is not verified yet is never published.
 * Never throws for helper failures; resolves with the new row (null when the domain is gone).
 */
export async function publishDomain(domainId: string): Promise<DomainRow | null> {
  const domain = await db().domain.findUnique({
    where: { id: domainId },
    include: { service: { select: { hostPort: true, port: true } } },
  });
  if (!domain) return null;
  if (!isPublishable(domain)) return domain;

  const { hostPort, port } = domain.service;
  const now = new Date();

  if (hostPort === null) {
    // Already waiting: nothing to write, nothing to announce.
    if (domain.status === "verifying" && domain.error === null) return domain;
    return updateDomainState(domainId, { status: "verifying", error: null });
  }

  if (domain.targetPort !== port) {
    // The container publishes its configured port only: any other target cannot be reached.
    return updateDomainState(domainId, {
      status: "error",
      error: `Le port cible du domaine (${domain.targetPort}) ne correspond pas au port du service (${port}), seul ce dernier est publié. Corrigez l’un des deux.`,
      lastCheckedAt: now,
    });
  }

  const settings = await getPlatformSettings();
  const result = await publishHost({
    hostname: domain.hostname,
    port: hostPort,
    maxBodyMb: settings.nginx.clientMaxBodySizeMb,
    readTimeoutSec: settings.nginx.proxyReadTimeoutSec,
    gzip: settings.nginx.gzip,
  });
  if (!result.ok) {
    return updateDomainState(domainId, { status: "error", error: result.message, lastCheckedAt: now });
  }
  return updateDomainState(domainId, {
    status: "active",
    error: null,
    verifiedAt: domain.verifiedAt ?? now,
    lastCheckedAt: now,
    sslStatus: "none",
    sslIssuer: null,
    sslExpiresAt: null,
  });
}

/** Re-publishes every publishable domain of a service (after a deployment). Resolves with the new rows. */
export async function publishServiceDomains(serviceId: string): Promise<DomainRow[]> {
  const domains = await db().domain.findMany({
    where: { serviceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const published: DomainRow[] = [];
  for (const domain of domains) {
    if (!isPublishable(domain)) continue;
    const row = await publishDomain(domain.id);
    if (row) published.push(row);
  }
  return published;
}

/**
 * Removes the proxy entries of a service's domains (best effort, never throws).
 * The rows stay: active ones go back to "verifying" until the next deployment
 * publishes them again.
 */
export async function unpublishServiceDomains(serviceId: string): Promise<void> {
  const domains = await db().domain.findMany({ where: { serviceId }, select: { hostname: true } });
  for (const { hostname } of domains) {
    const result = await unpublishHost(hostname);
    if (!result.ok && result.reason !== "not_configured") {
      console.error(`[domains] could not unpublish ${hostname}: ${result.message}`);
    }
  }
  await db().$transaction(async (tx) => {
    const { count } = await tx.domain.updateMany({
      where: { serviceId, status: "active" },
      data: { status: "verifying" },
    });
    if (count === 0) return;
    await syncPrimaryDomain(tx, serviceId);
    const service = await tx.service.findUnique({ where: { id: serviceId }, select: { projectId: true } });
    await emit(["domains", "services", "projects"], { projectId: service?.projectId, serviceId }, tx);
  });
}
