import type { Database } from "@/lib/types";

import { hashString, noise } from "../generators/prng";
import type { DatabaseRecord, MockDb } from "../schema";
import { iso } from "../text";
import { proxyDomain } from "./domains";
import { addVariable } from "./variables";

export const PG_DATA_PATH = "/var/lib/postgresql/data";

/** Recomputes the connection URLs from the credentials and network settings. */
export function refreshUrls(database: DatabaseRecord, baseDomain: string): void {
  const credentials = `${database.username}:${database.password}`;
  database.internalUrl = `postgresql://${credentials}@${database.host}:${database.port}/${database.database}`;
  if (database.publicNetworking && database.proxyPort !== null) {
    const slug = database.host.split(".")[0];
    database.publicUrl = `postgresql://${credentials}@${slug}.${proxyDomain(baseDomain)}:${database.proxyPort}/${database.database}`;
  } else {
    database.publicUrl = null;
  }
}

export interface ConnectionVariable {
  key: string;
  value: string;
  isSecret: boolean;
}

/** Variables every PostgreSQL service exposes, referenced as `${{Name.KEY}}`. */
export function connectionVariables(database: DatabaseRecord): ConnectionVariable[] {
  return [
    { key: "DATABASE_URL", value: database.internalUrl, isSecret: true },
    { key: "PGHOST", value: database.host, isSecret: false },
    { key: "PGPORT", value: String(database.port), isSecret: false },
    { key: "PGUSER", value: database.username, isSecret: false },
    { key: "PGPASSWORD", value: database.password, isSecret: true },
    { key: "PGDATABASE", value: database.database, isSecret: false },
  ];
}

/** Public shape: private fields removed, live values refreshed. */
export function toDatabase(db: MockDb, record: DatabaseRecord, now: number): Database {
  const database: Database & Partial<Pick<DatabaseRecord, "dataset" | "proxyPort">> = {
    ...record,
  };
  delete database.dataset;
  delete database.proxyPort;
  const service = db.services.find((item) => item.id === record.serviceId);
  const status = service?.status ?? record.status;
  // Open connections wander around their baseline; the value holds for 10 s
  // so that two reads of the same screen agree.
  const wobble = Math.round((noise(hashString(record.id), Math.floor(now / 10_000)) - 0.5) * 4);
  return {
    ...database,
    name: service?.name ?? record.name,
    status,
    connections:
      status === "online"
        ? Math.min(record.maxConnections, Math.max(1, record.connections + wobble))
        : 0,
  };
}

/** Creates or refreshes the connection variables held by the database service. */
export function syncConnectionVariables(db: MockDb, database: DatabaseRecord): void {
  const now = iso();
  // Reversed so that, newest first, the list reads DATABASE_URL, PGHOST, …
  for (const entry of [...connectionVariables(database)].reverse()) {
    const existing = db.variables.find(
      (variable) => variable.serviceId === database.serviceId && variable.key === entry.key,
    );
    if (!existing) {
      addVariable(db, { projectId: database.projectId, serviceId: database.serviceId, ...entry });
    } else if (existing.value !== entry.value) {
      existing.value = entry.value;
      existing.updatedAt = now;
    }
  }
}
