import type { Api, CreateProjectInput, UpdateProjectInput } from "@/lib/api/contract";
import {
  PROJECT_COLORS,
  REGIONS,
  type Project,
  type ProjectStats,
  type ProjectSummary,
} from "@/lib/types";

import { addActivity } from "../domain/activity";
import { CASCADE_ENTITIES, removeServices } from "../domain/services";
import { emit } from "../emitter";
import { conflict, invalid } from "../errors";
import { newId } from "../ids";
import { requireProject } from "../lookup";
import type { MockDb } from "../schema";
import { iso, newestFirst, sameName, slugify, uniqueName } from "../text";
import { read, write } from "./respond";

function summarise(db: MockDb, project: Project): ProjectSummary {
  const services = db.services.filter((service) => service.projectId === project.id);
  const deployments = db.deployments.filter((item) => item.projectId === project.id);
  const count = (...statuses: string[]) =>
    services.filter((service) => statuses.includes(service.status)).length;

  const stats: ProjectStats = {
    services: services.length,
    databases: services.filter((service) => service.source.type === "postgres").length,
    online: count("online"),
    inProgress: count("building", "deploying", "restarting"),
    crashed: count("crashed"),
    stopped: count("stopped"),
    domains: db.domains.filter((domain) => domain.projectId === project.id).length,
    variables: db.variables.filter((variable) => variable.projectId === project.id).length,
    deployments: deployments.length,
  };

  const last = newestFirst(deployments)[0];
  return {
    ...project,
    stats,
    // Oldest first: the order in which the project was assembled.
    services: newestFirst(services)
      .reverse()
      .map(({ id, name, source, status }) => ({ id, name, type: source.type, status })),
    lastDeployment: last
      ? { id: last.id, serviceId: last.serviceId, status: last.status, createdAt: last.createdAt }
      : null,
  };
}

function validName(db: MockDb, name: string, exceptId?: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 40) {
    throw invalid("Le nom du projet doit contenir entre 2 et 40 caractères.", "name");
  }
  if (db.projects.some((project) => project.id !== exceptId && sameName(project.name, trimmed))) {
    throw conflict("Un projet porte déjà ce nom.", "name");
  }
  return trimmed;
}

function uniqueSlug(db: MockDb, name: string, exceptId?: string): string {
  const taken = db.projects.filter((project) => project.id !== exceptId).map((item) => item.slug);
  return uniqueName(slugify(name, "projet"), taken);
}

function validDescription(description: string): string {
  const trimmed = description.trim();
  if (trimmed.length > 280) {
    throw invalid("La description ne peut pas dépasser 280 caractères.", "description");
  }
  return trimmed;
}

function assertChoices(input: CreateProjectInput | UpdateProjectInput): void {
  if (input.color !== undefined && !PROJECT_COLORS.includes(input.color)) {
    throw invalid("Cette couleur n’est pas disponible.", "color");
  }
  if (input.region !== undefined && !REGIONS.includes(input.region)) {
    throw invalid("Cette région n’est pas disponible.", "region");
  }
}

export const projectsApi: Api["projects"] = {
  list: () => read((db) => newestFirst(db.projects).map((project) => summarise(db, project))),

  get: (id) => read((db) => summarise(db, requireProject(db, id))),

  create: (input) =>
    write((db) => {
      const name = validName(db, input.name ?? "");
      assertChoices(input);
      const now = iso();
      const project: Project = {
        id: newId("prj"),
        name,
        slug: uniqueSlug(db, name),
        description: validDescription(input.description ?? ""),
        // Rotates through the palette so new projects are easy to tell apart.
        color: input.color ?? PROJECT_COLORS[db.projects.length % PROJECT_COLORS.length],
        environment: "production",
        region: input.region ?? db.settings.defaultRegion,
        createdAt: now,
        updatedAt: now,
      };
      db.projects.unshift(project);
      addActivity(db, {
        type: "project.created",
        title: "Projet créé",
        description: project.name,
        projectId: project.id,
      });
      emit(["projects", "activity"], { projectId: project.id });
      return project;
    }),

  update: (id, patch) =>
    write((db) => {
      const project = requireProject(db, id);
      assertChoices(patch);
      if (patch.name !== undefined) {
        const name = validName(db, patch.name, id);
        if (name !== project.name) {
          project.name = name;
          project.slug = uniqueSlug(db, name, id);
        }
      }
      if (patch.description !== undefined) project.description = validDescription(patch.description);
      if (patch.color !== undefined) project.color = patch.color;
      if (patch.region !== undefined) project.region = patch.region;
      project.updatedAt = iso();

      addActivity(db, {
        type: "project.updated",
        title: "Projet modifié",
        description: project.name,
        projectId: project.id,
      });
      emit(["projects", "activity"], { projectId: project.id });
      return project;
    }),

  delete: (id) =>
    write((db) => {
      const project = requireProject(db, id);
      const serviceIds = new Set(
        db.services.filter((service) => service.projectId === id).map((service) => service.id),
      );
      removeServices(db, serviceIds);
      db.variables = db.variables.filter((variable) => variable.projectId !== id);
      db.projects = db.projects.filter((item) => item.id !== id);
      for (const event of db.activity) {
        if (event.projectId === id) event.projectId = null;
      }

      addActivity(db, {
        type: "project.deleted",
        severity: "warning",
        title: "Projet supprimé",
        description: project.name,
      });
      emit(CASCADE_ENTITIES, { projectId: id });
    }),
};
