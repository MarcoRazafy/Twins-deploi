import type { ApiToken as ApiTokenRow } from "@/generated/prisma/client";
import type { ApiToken } from "@/lib/types";

/** The hash never leaves the server. */
export function toApiToken(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}
