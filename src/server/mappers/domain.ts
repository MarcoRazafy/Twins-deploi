import type { Domain as DomainRow } from "@/generated/prisma/client";
import type { DnsRecord, Domain, DomainStatus, SslStatus } from "@/lib/types";

import { asRecord } from "../rules";

const STATUSES: readonly DomainStatus[] = [
  "pending_dns",
  "verifying",
  "issuing_certificate",
  "active",
  "error",
];
const SSL_STATUSES: readonly SslStatus[] = ["none", "pending", "issued", "error"];
const RECORD_TYPES: readonly DnsRecord["type"][] = ["CNAME", "A", "TXT"];

/** The JSON column holds what this server wrote; anything else is dropped. */
export function toDnsRecords(value: unknown): DnsRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): DnsRecord[] => {
    const record = asRecord(item);
    const type = RECORD_TYPES.find((candidate) => candidate === record.type);
    if (
      type === undefined ||
      typeof record.name !== "string" ||
      typeof record.value !== "string" ||
      typeof record.ttl !== "number"
    ) {
      return [];
    }
    return [{ type, name: record.name, value: record.value, ttl: record.ttl, verified: record.verified === true }];
  });
}

export function toDomain(row: DomainRow): Domain {
  return {
    id: row.id,
    projectId: row.projectId,
    serviceId: row.serviceId,
    hostname: row.hostname,
    kind: row.kind === "generated" ? "generated" : "custom",
    // Validated on write; the fallbacks only protect against hand-edited rows.
    status: STATUSES.find((status) => status === row.status) ?? "error",
    targetPort: row.targetPort,
    dnsRecords: toDnsRecords(row.dnsRecords),
    ssl: {
      status: SSL_STATUSES.find((status) => status === row.sslStatus) ?? "none",
      issuer: row.sslIssuer,
      expiresAt: row.sslExpiresAt?.toISOString() ?? null,
    },
    forceHttps: row.forceHttps,
    createdAt: row.createdAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    error: row.error,
  };
}
