/**
 * Connection variables of a database service (DATABASE_URL, PGHOST…), the ones
 * the variables tab shows and `${{Name.KEY}}` references resolve to.
 */

import type { ManagedDatabase } from "@/generated/prisma/client";

import { decryptSecret, encryptSecret } from "../crypto";
import type { DbClient } from "../db";
import { databaseUrl } from "../mappers/database";
import { createVariable, resolveEnvironment, variableValue } from "../variables/store";

export const CONNECTION_KEYS = [
  "DATABASE_URL",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
] as const;
type ConnectionKey = (typeof CONNECTION_KEYS)[number];

type Connectable = Pick<ManagedDatabase, "username" | "host" | "port" | "databaseName">;

export function connectionValues(database: Connectable, password: string): Record<ConnectionKey, string> {
  return {
    DATABASE_URL: databaseUrl(database, password),
    PGHOST: database.host,
    PGPORT: String(database.port),
    PGUSER: database.username,
    PGPASSWORD: password,
    PGDATABASE: database.databaseName,
  };
}

/**
 * Creates, on the database service, the connection variables that its
 * environment does not already provide (resolveEnvironment is the authority:
 * a variable the user defined, or one the store exposes by itself, is left alone).
 */
export async function createConnectionVariables(client: DbClient, database: ManagedDatabase): Promise<void> {
  const provided = (await resolveEnvironment(database.serviceId, client)).variables;
  const values = connectionValues(database, decryptSecret(database.passwordEncrypted));
  const base = Date.now();
  // Listed newest first: created in reverse, DATABASE_URL ends up on top.
  for (const [index, key] of [...CONNECTION_KEYS].reverse().entries()) {
    if (Object.hasOwn(provided, key)) continue;
    await createVariable(client, {
      projectId: database.projectId,
      serviceId: database.serviceId,
      key,
      value: values[key],
      createdAt: new Date(base + index),
    });
  }
}

/**
 * After a password rotation: DATABASE_URL and PGPASSWORD of the database
 * service follow when they still carry the previous password. A variable the
 * user replaced by something else is left alone. Resolves with how many were rewritten.
 */
export async function rotateConnectionVariables(
  client: DbClient,
  database: Pick<ManagedDatabase, "serviceId">,
  previousPassword: string,
  nextPassword: string,
): Promise<number> {
  const previousEncoded = encodeURIComponent(previousPassword);
  const nextEncoded = encodeURIComponent(nextPassword);
  let rewritten = 0;
  for (const key of ["DATABASE_URL", "PGPASSWORD"] as const) {
    const row = await client.envVariable.findFirst({ where: { serviceId: database.serviceId, key } });
    if (!row) continue;
    const value = variableValue(row);
    const next =
      key === "PGPASSWORD"
        ? value === previousPassword
          ? nextPassword
          : value
        : value.split(previousEncoded).join(nextEncoded);
    if (next === value) continue;
    await client.envVariable.update({ where: { id: row.id }, data: { valueEncrypted: encryptSecret(next) } });
    rewritten += 1;
  }
  return rewritten;
}
