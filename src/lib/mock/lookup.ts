/** `find or reject with not_found` for every collection. */

import type {
  DatabaseBackup,
  Deployment,
  Domain,
  EnvVariable,
  ID,
  Project,
  Service,
  ServiceConnection,
} from "@/lib/types";

import { notFound } from "./errors";
import type { ContainerRecord, DatabaseRecord, ImageRecord, MockDb } from "./schema";

function required<T extends { id: ID }>(items: readonly T[], id: ID, label: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw notFound(label);
  return item;
}

export const requireProject = (db: MockDb, id: ID): Project =>
  required(db.projects, id, "Projet");

export const requireService = (db: MockDb, id: ID): Service =>
  required(db.services, id, "Service");

export const requireConnection = (db: MockDb, id: ID): ServiceConnection =>
  required(db.connections, id, "Connexion");

export const requireDeployment = (db: MockDb, id: ID): Deployment =>
  required(db.deployments, id, "Déploiement");

export const requireVariable = (db: MockDb, id: ID): EnvVariable =>
  required(db.variables, id, "Variable");

export const requireDomain = (db: MockDb, id: ID): Domain =>
  required(db.domains, id, "Domaine");

export const requireContainer = (db: MockDb, id: ID): ContainerRecord =>
  required(db.containers, id, "Conteneur");

export const requireImage = (db: MockDb, id: ID): ImageRecord =>
  required(db.images, id, "Image");

export const requireDatabase = (db: MockDb, id: ID): DatabaseRecord =>
  required(db.databases, id, "Base de données");

export const requireBackup = (db: MockDb, databaseId: ID, backupId: ID): DatabaseBackup => {
  const backup = db.backups.find(
    (item) => item.id === backupId && item.databaseId === databaseId,
  );
  if (!backup) throw notFound("Sauvegarde");
  return backup;
};
