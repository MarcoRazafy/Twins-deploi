/**
 * Environment of a container, handed to Docker through `--env-file` so that no
 * value ever appears in a command line. The file lives a few milliseconds:
 * 0600 under <data dir>/tmp, deleted right after `docker run`.
 */

import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ManagedDatabase, Service } from "@/generated/prisma/client";

import { decryptSecret } from "../crypto";
import { env } from "../env";
import { validation } from "../errors";
import { VARIABLE_KEY_PATTERN } from "../rules";
import { loadBuiltinVariables } from "../variables/builtin";
import { resolveEnvironment } from "../variables/store";

export interface ContainerEnvironment {
  variables: Record<string, string>;
  /** French messages for the deployment log; they never contain a value. */
  warnings: string[];
}

/**
 * Connection-target variables a PostgreSQL service exposes to its consumers.
 * Inside the database container itself they would redirect the image's own
 * initialisation scripts (psql over TCP while the bootstrap server only
 * listens on its socket), so they are left out of its environment.
 */
const POSTGRES_CLIENT_ONLY = ["PGHOST", "PGPORT"];

/**
 * Shared variables, then the service's own, references resolved, then the
 * platform variables (PORT, TWINS_*: they win over a user variable of the same
 * name) and, for PostgreSQL, the credentials the image initialises the
 * database with.
 */
export async function buildContainerEnvironment(
  service: Service,
  database: ManagedDatabase | null,
  deploymentId: string,
): Promise<ContainerEnvironment> {
  const resolved = await resolveEnvironment(service.id);
  const variables: Record<string, string> = {};
  const warnings = [...resolved.warnings];
  for (const [key, value] of Object.entries(resolved.variables)) {
    if (!VARIABLE_KEY_PATTERN.test(key)) {
      warnings.push(`La variable ${key} porte un nom invalide et a été ignorée.`);
      continue;
    }
    variables[key] = value;
  }
  for (const builtin of await loadBuiltinVariables(service.id, deploymentId)) {
    if (builtin.key in variables && variables[builtin.key] !== builtin.value) {
      warnings.push(`La variable ${builtin.key} est fournie par la plateforme : la valeur définie dans le service est ignorée.`);
    }
    variables[builtin.key] = builtin.value;
  }

  if (service.type === "postgres" && database) {
    for (const key of POSTGRES_CLIENT_ONLY) delete variables[key];
    variables.POSTGRES_USER = database.username;
    variables.POSTGRES_PASSWORD = decryptSecret(database.passwordEncrypted);
    variables.POSTGRES_DB = database.databaseName;
  }
  return { variables, warnings };
}

/**
 * Docker's env-file format is one `KEY=value` per line, the value taken
 * verbatim: there is no way to write a line break. Such a value is refused
 * rather than silently altered.
 */
export function serializeEnvFile(variables: Readonly<Record<string, string>>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(variables)) {
    if (/[\r\n\0]/.test(value)) {
      throw validation(
        `La variable ${key} contient un saut de ligne, ce que Docker ne peut pas transmettre au conteneur. Supprimez le saut de ligne ou encodez la valeur (en base64, par exemple), puis redéployez.`,
        key,
      );
    }
    lines.push(`${key}=${value}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function envFileDirectory(): string {
  return path.join(env.dataDir, "tmp");
}

/** Writes the file (0600) and resolves with its path. `deploymentId` is a generated id. */
export async function writeEnvFile(
  deploymentId: string,
  variables: Readonly<Record<string, string>>,
): Promise<string> {
  const content = serializeEnvFile(variables);
  const directory = envFileDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${deploymentId}.env`);
  await writeFile(file, content, { mode: 0o600 });
  // The mode of writeFile only applies to a new file.
  await chmod(file, 0o600);
  return file;
}

export async function removeEnvFile(file: string | null): Promise<void> {
  if (file === null) return;
  await rm(file, { force: true });
}
