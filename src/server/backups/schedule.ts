/**
 * Automatic backups of the project databases: one per online database per
 * day, the 7 most recent automatic ones are kept. The dump itself is the
 * ordinary `backup.create` job.
 */

import { removeBackupFile } from "../databases/backups";
import { db } from "../db";
import { emit } from "../events";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";

export const AUTOMATIC_BACKUP_INTERVAL_MS = 24 * 3_600_000;
export const AUTOMATIC_BACKUPS_KEPT = 7;
const AUTOMATIC_LABEL = "Sauvegarde automatique";

/** Resolves with how many backups were queued. Safe to call often: the database tells what is due. */
export async function scheduleAutomaticBackups(now: Date = new Date()): Promise<number> {
  const databases = await db().managedDatabase.findMany({
    include: {
      service: { select: { status: true, containerName: true } },
      backups: { where: { type: "automatic" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
    },
  });

  let queued = 0;
  for (const database of databases) {
    const scope = { projectId: database.projectId, serviceId: database.serviceId };
    const latest = database.backups[0];
    const due = !latest || now.getTime() - latest.createdAt.getTime() >= AUTOMATIC_BACKUP_INTERVAL_MS;
    if (due && database.service.status === "online" && database.service.containerName !== null) {
      await db().$transaction(async (tx) => {
        const backup = await tx.databaseBackup.create({
          data: {
            id: newId("bkp"),
            databaseId: database.id,
            label: AUTOMATIC_LABEL,
            type: "automatic",
            status: "in_progress",
            sizeMb: 0,
            createdAt: now,
          },
        });
        await enqueueJob(tx, "backup.create", { databaseId: database.id, backupId: backup.id }, now);
        await emit(["backups"], scope, tx);
      });
      queued += 1;
    }

    const finished = database.backups.filter((backup) => backup.status !== "in_progress");
    const surplus = finished.slice(AUTOMATIC_BACKUPS_KEPT);
    for (const backup of surplus) {
      try {
        await removeBackupFile(database.id, backup.filePath);
      } catch (error) {
        console.error("[backups] could not delete an old dump:", error instanceof Error ? error.message : error);
      }
      await db().databaseBackup.deleteMany({ where: { id: backup.id } });
    }
    if (surplus.length > 0) await emit(["backups"], scope);
  }
  return queued;
}
