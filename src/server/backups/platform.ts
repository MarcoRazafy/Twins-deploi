/**
 * Daily dump of the platform's own database with the host's pg_dump, into
 * <data dir>/backups/platform/ (14 kept). The password goes through the
 * environment (PGPASSWORD), never the command line.
 */

import { chmod, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { env } from "../env";
import { runChecked } from "../exec";

export const PLATFORM_BACKUPS_KEPT = 14;
const INTERVAL_MS = 24 * 3_600_000;
const FILE_PATTERN = /^platform-\d{8}-\d{6}\.dump$/;

export function platformBackupDirectory(): string {
  return path.join(env.dataDir, "backups", "platform");
}

function stamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
}

/** Resolves with the path of the new dump, null when the latest one is less than a day old. */
export async function backupPlatformDatabase(now: Date = new Date()): Promise<string | null> {
  const directory = platformBackupDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // The names sort chronologically.
  const existing = (await readdir(directory)).filter((name) => FILE_PATTERN.test(name)).sort();
  const newest = existing[existing.length - 1];
  if (newest !== undefined) {
    const { mtimeMs } = await stat(path.join(directory, newest));
    if (now.getTime() - mtimeMs < INTERVAL_MS) return null;
  }

  const url = new URL(env.databaseUrl);
  const password = decodeURIComponent(url.password);
  const file = path.join(directory, `platform-${stamp(now)}.dump`);
  const args = ["-Fc", "--no-password", "-h", url.hostname, "-p", url.port || "5432"];
  if (url.username !== "") args.push("-U", decodeURIComponent(url.username));
  args.push("-d", decodeURIComponent(url.pathname.replace(/^\//, "")), "-f", file);
  try {
    await runChecked("pg_dump", args, {
      env: password === "" ? {} : { PGPASSWORD: password },
      sensitive: [password],
      timeoutMs: 30 * 60_000,
    });
  } catch (error) {
    await rm(file, { force: true }).catch(() => {});
    throw error;
  }
  await chmod(file, 0o600);

  const all = [...existing, path.basename(file)];
  for (const name of all.slice(0, Math.max(0, all.length - PLATFORM_BACKUPS_KEPT))) {
    await rm(path.join(directory, name), { force: true });
  }
  return file;
}
