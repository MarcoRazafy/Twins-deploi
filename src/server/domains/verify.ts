/**
 * DNS verification of public domains (job `domain.verify`, run by the worker).
 * A domain is accepted when its hostname resolves to the server IP (A record) or
 * through a CNAME to the platform's target, as configured in settings.dns.
 */

import { Resolver } from "node:dns/promises";

import type { Prisma } from "@/generated/prisma/client";
import type { PlatformSettings } from "@/lib/types";

import { recordActivity } from "../activity";
import { db } from "../db";
import type { JobPayloads } from "../jobs/queue";
import { toDnsRecords } from "../mappers/domain";
import { getPlatformSettings } from "../platform-settings";
import { isLocalHostname } from "../proxy";
import { publishDomain, updateDomainState } from "./publish";
import { subdomainOf } from "./records";

const LOOKUP_TIMEOUT_MS = 3_000;
/** c-ares codes meaning "the name or the record does not exist" (as opposed to "could not ask"). */
const MISSING_CODES = new Set(["ENOTFOUND", "ENODATA"]);

export type DnsCheck = { ok: true } | { ok: false; message: string };

function sameHost(a: string, b: string): boolean {
  return a.replace(/\.$/, "").toLowerCase() === b.replace(/\.$/, "").toLowerCase();
}

function errorCode(reason: unknown): string {
  return typeof reason === "object" && reason !== null && "code" in reason && typeof reason.code === "string"
    ? reason.code
    : "";
}

function expectedRecord(hostname: string, dns: PlatformSettings["dns"]): string {
  const name = subdomainOf(hostname);
  return name === "@"
    ? `créez un enregistrement A « @ » pointant vers ${dns.serverIp}`
    : `créez un enregistrement CNAME « ${name} » pointant vers ${dns.cnameTarget} (ou un enregistrement A vers ${dns.serverIp})`;
}

/** The two lookups a check needs (a parameter so that tests can answer without a network). */
export type DnsResolver = Pick<Resolver, "resolve4" | "resolveCname">;

/** Resolves `hostname` and compares it with the records the platform asked for. */
export async function checkDomainDns(
  hostname: string,
  dns: PlatformSettings["dns"],
  resolver: DnsResolver = new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 2 }),
): Promise<DnsCheck> {
  const [addresses, aliases] = await Promise.allSettled([
    resolver.resolve4(hostname),
    resolver.resolveCname(hostname),
  ]);
  const foundAddresses = addresses.status === "fulfilled" ? addresses.value : [];
  const foundAliases = aliases.status === "fulfilled" ? aliases.value : [];

  if (
    foundAddresses.includes(dns.serverIp) ||
    foundAliases.some((alias) => sameHost(alias, dns.cnameTarget))
  ) {
    return { ok: true };
  }

  const found = [...foundAliases, ...foundAddresses];
  if (found.length > 0) {
    return {
      ok: false,
      message: `Le domaine ${hostname} pointe vers ${found.join(", ")} : ${expectedRecord(hostname, dns)}.`,
    };
  }

  const unreachable = [addresses, aliases].some(
    (outcome) => outcome.status === "rejected" && !MISSING_CODES.has(errorCode(outcome.reason)),
  );
  if (unreachable) {
    return {
      ok: false,
      message: "Impossible d’interroger les serveurs DNS pour le moment. Relancez la vérification dans quelques minutes.",
    };
  }
  return {
    ok: false,
    message: `Enregistrement DNS introuvable pour ${hostname} : ${expectedRecord(hostname, dns)}. La propagation peut prendre quelques minutes.`,
  };
}

/** Handler of the `domain.verify` job. Throws only on unexpected (database) errors. */
export async function handleDomainVerify(payload: JobPayloads["domain.verify"]): Promise<void> {
  if (typeof payload.domainId !== "string") return;
  const domain = await db().domain.findUnique({
    where: { id: payload.domainId },
    include: { service: { select: { name: true } } },
  });
  if (!domain) return;

  // Local and generated names need no DNS: verifying them just publishes them again.
  if (domain.kind === "generated" || isLocalHostname(domain.hostname)) {
    await publishDomain(domain.id, { retryCertificate: true });
    return;
  }

  const settings = await getPlatformSettings();
  const check = await checkDomainDns(domain.hostname, settings.dns);
  const now = new Date();

  if (!check.ok) {
    await updateDomainState(domain.id, { status: "error", error: check.message, lastCheckedAt: now });
    return;
  }

  const records = toDnsRecords(domain.dnsRecords).map((record) => ({ ...record, verified: true }));
  await updateDomainState(domain.id, {
    verifiedAt: domain.verifiedAt ?? now,
    lastCheckedAt: now,
    error: null,
    dnsRecords: records as unknown as Prisma.InputJsonArray,
  });
  if (domain.verifiedAt === null) {
    await recordActivity({
      type: "domain.verified",
      severity: "success",
      title: "Domaine vérifié",
      description: `${domain.hostname} · ${domain.service.name}`,
      projectId: domain.projectId,
      serviceId: domain.serviceId,
      notify: true,
    });
  }
  await publishDomain(domain.id, { retryCertificate: true });
}
