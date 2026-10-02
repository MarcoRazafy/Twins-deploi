/**
 * backup.create / backup.restore: pg_dump and pg_restore run INSIDE the
 * database container (docker exec), over its local socket, so no password
 * travels anywhere. The dump is streamed to / from a file of the platform.
 */

import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { recordActivity } from "../../activity";
import { backupDirectoryFor, backupFileExists } from "../../databases/backups";
import { db } from "../../db";
import { execStream, isDockerError } from "../../docker";
import { emit } from "../../events";
import { statusEntities } from "../../services/status";
import type { JobPayloads } from "../queue";

const DUMP_TIMEOUT_MS = 30 * 60_000;

function reasonOf(error: unknown): string {
  if (isDockerError(error)) return `${error.kind} (${error.stderrTail.slice(-300)})`;
  return error instanceof Error ? error.message : "unknown error";
}

async function loadBackup(payload: { databaseId: string; backupId: string }) {
  if (typeof payload.backupId !== "string" || typeof payload.databaseId !== "string") return null;
  return db().databaseBackup.findFirst({
    where: { id: payload.backupId, databaseId: payload.databaseId },
    include: { database: { include: { service: true } } },
  });
}

export async function handleBackupCreate(payload: JobPayloads["backup.create"]): Promise<void> {
  const backup = await loadBackup(payload);
  if (!backup || backup.status !== "in_progress") return;
  const { database } = backup;
  const { service } = database;
  const scope = { projectId: database.projectId, serviceId: database.serviceId };
  const directory = backupDirectoryFor(database.id);
  const file = path.join(directory, `${backup.id}.dump`);

  const fail = async (reason: string): Promise<void> => {
    console.error(`[jobs] backup ${backup.id} of ${database.id} failed: ${reason}`);
    await rm(file, { force: true }).catch(() => {});
    await db().databaseBackup.updateMany({
      where: { id: backup.id },
      data: { status: "failed", completedAt: new Date() },
    });
    await emit(["backups"], scope);
  };

  if (service.status !== "online" || service.containerName === null) {
    await fail("the database is not running");
    return;
  }
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await execStream(
      service.containerName,
      ["pg_dump", "-U", database.username, "-d", database.databaseName, "-Fc"],
      { stdoutFile: file, timeoutMs: DUMP_TIMEOUT_MS },
    );
  } catch (error) {
    await fail(reasonOf(error));
    return;
  }

  const { size } = await stat(file);
  const { count } = await db().databaseBackup.updateMany({
    where: { id: backup.id },
    data: {
      status: "completed",
      filePath: file,
      sizeMb: Math.max(0.01, Math.round((size / 1_048_576) * 100) / 100),
      completedAt: new Date(),
    },
  });
  if (count === 0) {
    // Deleted while the dump ran.
    await rm(file, { force: true }).catch(() => {});
    return;
  }
  await recordActivity({
    type: "backup.completed",
    severity: "success",
    title: "Sauvegarde terminée",
    description: `${database.name} · ${backup.label}`,
    ...scope,
    notify: backup.type === "manual",
  });
  await emit(["backups", "databases"], scope);
}

export async function handleBackupRestore(payload: JobPayloads["backup.restore"]): Promise<void> {
  const backup = await loadBackup(payload);
  if (!backup || backup.status !== "completed") return;
  const { database } = backup;
  const { service } = database;
  const scope = { projectId: database.projectId, serviceId: database.serviceId };
  const entities = statusEntities("postgres");

  const report = (ok: boolean): Promise<unknown> =>
    recordActivity({
      type: "backup.restored",
      severity: ok ? "success" : "error",
      title: ok ? "Sauvegarde restaurée" : "Échec de la restauration",
      description: `${database.name} · ${backup.label}`,
      ...scope,
      notify: true,
    });

  if (service.containerName === null || !(await backupFileExists(database.id, backup.filePath))) {
    console.error(`[jobs] restore of ${backup.id} skipped: no container or no dump file`);
    await report(false);
    await emit(["backups"], scope);
    return;
  }
  // The database is unusable while it is rewritten: "restarting" also keeps the monitor away.
  const claimed = await db().service.updateMany({
    where: { id: service.id, status: "online" },
    data: { status: "restarting" },
  });
  if (claimed.count === 0) {
    console.error(`[jobs] restore of ${backup.id} skipped: the database is not online`);
    await report(false);
    await emit(["backups"], scope);
    return;
  }
  await emit(entities, scope);

  let ok = true;
  try {
    await execStream(
      service.containerName,
      [
        "pg_restore", "-U", database.username, "-d", database.databaseName,
        "--clean", "--if-exists", "--no-owner",
      ],
      { stdinFile: path.resolve(backup.filePath ?? ""), timeoutMs: DUMP_TIMEOUT_MS },
    );
  } catch (error) {
    ok = false;
    console.error(`[jobs] restore of ${backup.id} into ${database.id} failed: ${reasonOf(error)}`);
  } finally {
    await db().service.updateMany({
      where: { id: service.id, status: "restarting" },
      data: { status: "online" },
    });
  }
  await report(ok);
  await emit(["backups", ...entities], scope);
}
