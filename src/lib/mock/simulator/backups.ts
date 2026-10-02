/** Backups take a few seconds: in_progress → completed. */

import type { DatabaseBackup, ID } from "@/lib/types";

import { getDb, save } from "../db";
import { addActivity, SYSTEM_ACTOR } from "../domain/activity";
import { emit } from "../emitter";
import type { MockDb } from "../schema";
import { iso } from "../text";
import { after, timerKey } from "../timers";

const BACKUP_MS = 4000;

/** A custom-format dump is roughly a third of the on-disk size. */
const COMPRESSION_RATIO = 0.31;

function complete(backupId: ID): void {
  const db = getDb();
  const backup = db.backups.find((item) => item.id === backupId);
  if (!backup || backup.status !== "in_progress") return;
  const database = db.databases.find((item) => item.id === backup.databaseId);
  if (!database) return;

  backup.status = "completed";
  backup.completedAt = iso();
  backup.sizeMb = Math.max(1, Math.round(database.storageUsedMb * COMPRESSION_RATIO));

  const links = { projectId: database.projectId, serviceId: database.serviceId };
  addActivity(db, {
    type: "backup.completed",
    severity: "success",
    title: "Sauvegarde terminée",
    description: `${database.name} · ${backup.label} (${backup.sizeMb} Mo)`,
    ...links,
    actor: backup.type === "automatic" ? SYSTEM_ACTOR : undefined,
    notify: true,
  });

  save();
  emit(["backups", "activity"], links);
}

export function beginBackup(backup: DatabaseBackup): void {
  after(timerKey.backup(backup.id), BACKUP_MS, () => complete(backup.id));
}

export function resumeBackups(db: MockDb): void {
  for (const backup of db.backups) {
    if (backup.status === "in_progress") beginBackup(backup);
  }
}
