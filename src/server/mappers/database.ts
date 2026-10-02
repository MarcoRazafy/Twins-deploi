import type { DatabaseBackup as BackupRow, Prisma } from "@/generated/prisma/client";
import type { BackupStatus, Database, DatabaseBackup } from "@/lib/types";

import { decryptSecret } from "../crypto";

/** What the public Database needs from the backing service. */
export const DATABASE_INCLUDE = {
  service: { select: { name: true, status: true, hostPort: true } },
} as const satisfies Prisma.ManagedDatabaseInclude;

export type DatabaseRecord = Prisma.ManagedDatabaseGetPayload<{ include: typeof DATABASE_INCLUDE }>;

/** Read from the running server; all zeros (and no extension list) while it is not reachable. */
export interface LiveDatabaseStats {
  storageUsedMb: number;
  connections: number;
  extensions: string[] | null;
}

/** postgresql://user:pass@host:port/db on the project's private network. */
export function databaseUrl(
  row: Pick<DatabaseRecord, "username" | "host" | "port" | "databaseName">,
  password: string,
): string {
  return (
    `postgresql://${encodeURIComponent(row.username)}:${encodeURIComponent(password)}` +
    `@${row.host}:${row.port}/${encodeURIComponent(row.databaseName)}`
  );
}

/** Decrypts the password: only call it to answer an authorised user. */
export function toDatabase(row: DatabaseRecord, live: LiveDatabaseStats): Database {
  const password = decryptSecret(row.passwordEncrypted);
  return {
    id: row.id,
    serviceId: row.serviceId,
    projectId: row.projectId,
    name: row.service.name,
    engine: "postgres",
    version: row.version,
    status: row.service.status,
    host: row.host,
    port: row.port,
    database: row.databaseName,
    username: row.username,
    password,
    internalUrl: databaseUrl(row, password),
    publicNetworking: row.publicNetworking,
    // Public networking is recorded but not implemented yet: exposing PostgreSQL
    // needs a TCP proxy (NGINX stream) and its own privileged helper, neither of
    // which exists. The flag is kept so the setting survives until then.
    publicUrl: null,
    storageUsedMb: live.storageUsedMb,
    storageLimitMb: row.storageLimitMb,
    connections: live.connections,
    maxConnections: row.maxConnections,
    extensions: live.extensions ?? row.extensions,
    createdAt: row.createdAt.toISOString(),
  };
}

const BACKUP_STATUSES: readonly BackupStatus[] = ["in_progress", "completed", "failed"];

/** The dump path (`filePath`) stays on the server. */
export function toDatabaseBackup(row: BackupRow): DatabaseBackup {
  return {
    id: row.id,
    databaseId: row.databaseId,
    label: row.label,
    type: row.type === "automatic" ? "automatic" : "manual",
    status: BACKUP_STATUSES.find((status) => status === row.status) ?? "failed",
    sizeMb: row.sizeMb,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
