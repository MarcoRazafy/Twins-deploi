/** Start / restart / restore: a service sits in `restarting`, then comes back online. */

import type { ID, Service } from "@/lib/types";

import { getDb, save } from "../db";
import { addActivity } from "../domain/activity";
import {
  containerOf,
  markContainerRestarting,
  markContainerRunning,
  setServiceStatus,
  statusEntities,
} from "../domain/services";
import { emit } from "../emitter";
import type { MockDb, PendingRestart } from "../schema";
import { after, timerKey } from "../timers";

const RESTART_MS: Record<PendingRestart["kind"], number> = {
  start: 1800,
  restart: 2000,
  restore: 3000,
};

function complete(serviceId: ID): void {
  const db = getDb();
  const service = db.services.find((item) => item.id === serviceId);
  if (!service || service.status !== "restarting") return;

  const pending: PendingRestart = db.pendingRestarts[serviceId] ?? { kind: "restart" };
  delete db.pendingRestarts[serviceId];
  const entities = statusEntities(service);

  // Starting a crashed service brings its last release back.
  if (!service.activeDeploymentId) {
    const crashed = db.deployments
      .filter((item) => item.serviceId === serviceId && item.status === "crashed")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    if (crashed) {
      crashed.status = "active";
      crashed.error = null;
      service.activeDeploymentId = crashed.id;
      entities.push("deployments");
    }
  }

  markContainerRunning(db, service);
  const container = containerOf(db, serviceId);
  if (container && pending.kind === "restart") container.restartCount += 1;
  setServiceStatus(db, service, "online");

  const links = { projectId: service.projectId, serviceId };
  if (pending.kind === "restore") {
    const backup = db.backups.find((item) => item.id === pending.backupId);
    addActivity(db, {
      type: "backup.restored",
      severity: "success",
      title: "Sauvegarde restaurée",
      description: backup ? `${service.name} · ${backup.label}` : service.name,
      ...links,
      notify: true,
    });
    entities.push("backups");
  } else {
    addActivity(db, {
      type: pending.kind === "start" ? "service.started" : "service.restarted",
      severity: "success",
      title: pending.kind === "start" ? "Service démarré" : "Service redémarré",
      description: service.name,
      ...links,
    });
  }

  save();
  emit([...entities, "activity"], links);
}

function scheduleCompletion(serviceId: ID, kind: PendingRestart["kind"]): void {
  after(timerKey.service(serviceId), RESTART_MS[kind], () => complete(serviceId));
}

/** Puts the service in `restarting`; it comes back online on its own. */
export function beginRestart(db: MockDb, service: Service, pending: PendingRestart): void {
  db.pendingRestarts[service.id] = pending;
  markContainerRestarting(db, service);
  setServiceStatus(db, service, "restarting");
  scheduleCompletion(service.id, pending.kind);
}

export function resumeRestarts(db: MockDb): void {
  for (const service of db.services) {
    if (service.status === "restarting") {
      scheduleCompletion(service.id, db.pendingRestarts[service.id]?.kind ?? "restart");
    }
  }
}
