/**
 * Where database dumps live: <data dir>/backups/databases/<databaseId>/. The
 * worker writes them (pg_dump through docker exec); the API only ever removes
 * or checks files that lie under that directory.
 */

import { rm, stat } from "node:fs/promises";
import path from "node:path";

import { env } from "../env";

export function backupDirectoryFor(databaseId: string): string {
  return path.join(env.dataDir, "backups", "databases", databaseId);
}

function lies(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** True when `filePath` is a regular file inside the backup directory of the database. */
export async function backupFileExists(databaseId: string, filePath: string | null): Promise<boolean> {
  if (filePath === null) return false;
  const target = path.resolve(filePath);
  if (!lies(backupDirectoryFor(databaseId), target)) return false;
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

/**
 * Removes a dump, but only when it lies under the backup directory of the
 * database: a corrupted row can never make this delete something else.
 * Resolves with false when the path was refused.
 */
export async function removeBackupFile(databaseId: string, filePath: string | null): Promise<boolean> {
  if (filePath === null) return true;
  const target = path.resolve(filePath);
  if (!lies(backupDirectoryFor(databaseId), target)) return false;
  await rm(target, { force: true });
  return true;
}
