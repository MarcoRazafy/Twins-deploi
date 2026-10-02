/**
 * Variable storage and resolution. Values are AES-256-GCM encrypted at rest
 * (secret or not) and decrypted only to answer an authorised user or to build
 * the environment of a deployment.
 */

import type { EnvVariable as EnvVariableRow, ManagedDatabase } from "@/generated/prisma/client";

import { decryptSecret, encryptSecret } from "../crypto";
import { db, type DbClient } from "../db";
import { notFound } from "../errors";
import { newId } from "../ids";

/** Keys that usually hold credentials are sealed unless stated otherwise. */
export function looksSecret(key: string): boolean {
  return /SECRET|TOKEN|PASSWORD|KEY|URL/i.test(key);
}

export interface NewVariable {
  projectId: string;
  /** null = shared variable of the project. */
  serviceId: string | null;
  key: string;
  value: string;
  /** Inferred from the key when omitted. */
  isSecret?: boolean;
  createdAt?: Date;
}

export function createVariable(client: DbClient, input: NewVariable): Promise<EnvVariableRow> {
  return client.envVariable.create({
    data: {
      id: newId("var"),
      projectId: input.projectId,
      serviceId: input.serviceId,
      key: input.key,
      valueEncrypted: encryptSecret(input.value),
      isSecret: input.isSecret ?? looksSecret(input.key),
      createdAt: input.createdAt ?? new Date(),
    },
  });
}

export function variableValue(row: Pick<EnvVariableRow, "valueEncrypted">): string {
  return decryptSecret(row.valueEncrypted);
}

// ─── References ──────────────────────────────────────────────────────────────

/**
 * `${{Service Name.KEY}}` and `${{shared.KEY}}`. The key never contains a dot,
 * so the last dot separates it from a service name that has dots itself.
 */
const REFERENCE_PATTERN = /\$\{\{\s*([^{}]+?)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const MAX_REFERENCE_DEPTH = 8;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Follows a service rename inside the references of `text`. */
export function renameReferences(text: string, previous: string, next: string): string {
  const pattern = new RegExp(
    `\\$\\{\\{\\s*${escapeRegExp(previous.trim())}\\s*\\.(?=\\s*[A-Za-z_][A-Za-z0-9_]*\\s*\\}\\})`,
    "gi",
  );
  // A function replacer: `$` sequences of the new name must stay literal.
  return text.replace(pattern, () => `\${{${next}.`);
}

/**
 * Other services reference a renamed one as `${{Name.KEY}}`: rewrites every
 * variable of the project that does. Resolves with how many were rewritten.
 */
export async function renameServiceReferences(
  client: DbClient,
  projectId: string,
  previousName: string,
  nextName: string,
): Promise<number> {
  const rows = await client.envVariable.findMany({ where: { projectId } });
  let changed = 0;
  for (const row of rows) {
    const value = decryptSecret(row.valueEncrypted);
    const renamed = renameReferences(value, previousName, nextName);
    if (renamed === value) continue;
    await client.envVariable.update({
      where: { id: row.id },
      data: { valueEncrypted: encryptSecret(renamed) },
    });
    changed += 1;
  }
  return changed;
}

/** What `${{Db.KEY}}` resolves to for a PostgreSQL service without an explicit variable of that key. */
function connectionVariables(database: ManagedDatabase): Map<string, string> {
  const user = database.username;
  const password = decryptSecret(database.passwordEncrypted);
  const url =
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${database.host}:${database.port}/${encodeURIComponent(database.databaseName)}`;
  return new Map([
    ["DATABASE_URL", url],
    ["PGHOST", database.host],
    ["PGPORT", String(database.port)],
    ["PGUSER", user],
    ["PGPASSWORD", password],
    ["PGDATABASE", database.databaseName],
  ]);
}

export interface ResolvedEnvironment {
  /** KEY -> final value, ready to be written to the container's env file (PORT is added by the pipeline). */
  variables: Record<string, string>;
  /** French messages for the deployment log; they name references, never values. */
  warnings: string[];
}

/**
 * The environment of a service: shared variables of the project, overridden by
 * the service's own, with references resolved. A reference may target the
 * shared scope (`${{shared.KEY}}`) or any service of the project by name
 * (case-insensitive); a PostgreSQL service also exposes DATABASE_URL, PGHOST,
 * PGPORT, PGUSER, PGPASSWORD and PGDATABASE from its database record unless it
 * defines them itself. Unknown, circular or too deeply nested references become
 * an empty string and add a warning.
 */
export async function resolveEnvironment(
  serviceId: string,
  client: DbClient = db(),
): Promise<ResolvedEnvironment> {
  const service = await client.service.findUnique({
    where: { id: serviceId },
    select: { id: true, projectId: true },
  });
  if (!service) throw notFound("Service");
  const projectId = service.projectId;
  const services = await client.service.findMany({
    where: { projectId },
    select: { id: true, name: true },
  });
  const rows = await client.envVariable.findMany({ where: { projectId } });
  const databases = await client.managedDatabase.findMany({ where: { projectId } });

  const byScope = new Map<string | null, Map<string, EnvVariableRow>>();
  for (const row of rows) {
    const scope = byScope.get(row.serviceId) ?? new Map<string, EnvVariableRow>();
    scope.set(row.key, row);
    byScope.set(row.serviceId, scope);
  }
  const serviceByName = new Map(services.map((item) => [item.name.trim().toLowerCase(), item.id]));
  const databaseByService = new Map(databases.map((item) => [item.serviceId, item]));

  const plain = new Map<string, string>();
  const rawValue = (row: EnvVariableRow): string => {
    let value = plain.get(row.id);
    if (value === undefined) {
      value = decryptSecret(row.valueEncrypted);
      plain.set(row.id, value);
    }
    return value;
  };

  const warnings = new Set<string>();
  const identityOf = (scopeId: string | null, key: string): string => `${scopeId ?? "shared"}:${key}`;

  const lookup = (scope: string, key: string): { identity: string; text: string } | null => {
    if (scope.trim().toLowerCase() === "shared") {
      const row = byScope.get(null)?.get(key);
      return row ? { identity: identityOf(null, key), text: rawValue(row) } : null;
    }
    const targetId = serviceByName.get(scope.trim().toLowerCase());
    if (targetId === undefined) return null;
    const row = byScope.get(targetId)?.get(key);
    if (row) return { identity: identityOf(targetId, key), text: rawValue(row) };
    const database = databaseByService.get(targetId);
    const text = database ? connectionVariables(database).get(key) : undefined;
    return text === undefined ? null : { identity: identityOf(targetId, key), text };
  };

  const expand = (text: string, stack: readonly string[]): string =>
    text.replace(REFERENCE_PATTERN, (_match: string, scope: string, key: string) => {
      const reference = `\${{${scope}.${key}}}`;
      const target = lookup(scope, key);
      if (!target) {
        warnings.add(`Référence inconnue : ${reference} (remplacée par une valeur vide).`);
        return "";
      }
      if (stack.includes(target.identity) || stack.length >= MAX_REFERENCE_DEPTH) {
        warnings.add(`Référence circulaire ou trop imbriquée : ${reference} (remplacée par une valeur vide).`);
        return "";
      }
      return expand(target.text, [...stack, target.identity]);
    });

  const merged = new Map<string, EnvVariableRow>();
  for (const [key, row] of byScope.get(null) ?? []) merged.set(key, row);
  for (const [key, row] of byScope.get(serviceId) ?? []) merged.set(key, row);

  const variables = Object.fromEntries(
    [...merged].map(([key, row]) => [
      key,
      expand(rawValue(row), [identityOf(row.serviceId, key)]),
    ]),
  );
  return { variables, warnings: [...warnings] };
}
