import type { Api } from "@/lib/api/contract";
import type { ID, Service } from "@/lib/types";
import { builtinVariables, pickPublicDomain } from "@/lib/variables/builtin";

import { addActivity } from "../domain/activity";
import {
  addVariable,
  assertKeyAvailable,
  assertValidKey,
  scopeVariables,
} from "../domain/variables";
import { emit } from "../emitter";
import { invalid } from "../errors";
import { requireProject, requireService, requireVariable } from "../lookup";
import type { MockDb } from "../schema";
import { iso, newestFirst, slugify } from "../text";
import { read, write } from "./respond";

const SHARED_SCOPE = "Variables partagées";

const isLocal = (hostname: string): boolean => hostname.endsWith(".test") || hostname.endsWith(".localhost");

/** Resolves and checks the (project, service) scope of a variable. */
function resolveScope(db: MockDb, projectId: ID, serviceId: ID | null): Service | null {
  requireProject(db, projectId);
  if (serviceId === null) return null;
  const service = requireService(db, serviceId);
  if (service.projectId !== projectId) {
    throw invalid("Ce service n’appartient pas à ce projet.", "serviceId");
  }
  return service;
}

function scopeName(db: MockDb, serviceId: ID | null): string {
  if (serviceId === null) return SHARED_SCOPE;
  return db.services.find((service) => service.id === serviceId)?.name ?? "Service";
}

function links(projectId: ID, serviceId: ID | null) {
  return serviceId === null ? { projectId } : { projectId, serviceId };
}

export const variablesApi: Api["variables"] = {
  list: (filter = {}) =>
    read((db) =>
      newestFirst(
        db.variables.filter((variable) => {
          if (filter.projectId !== undefined && variable.projectId !== filter.projectId) {
            return false;
          }
          // null narrows to shared variables (of every project when no
          // projectId is given), a string to that service's own variables.
          if (filter.serviceId === null) return variable.serviceId === null;
          if (filter.serviceId !== undefined) return variable.serviceId === filter.serviceId;
          return true;
        }),
      ),
    ),

  builtins: (serviceId) =>
    read((db) => {
      const service = requireService(db, serviceId);
      const project = requireProject(db, service.projectId);
      const domains = db.domains
        .filter((domain) => domain.serviceId === service.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return builtinVariables({
        project,
        service: {
          id: service.id,
          name: service.name,
          slug: slugify(service.name),
          port: service.config.port,
          volume: service.volume ? { name: service.volume.name, mountPath: service.volume.mountPath } : null,
        },
        publicDomain: pickPublicDomain(service.primaryDomain, domains, isLocal),
        deploymentId: null,
      });
    }),

  create: (input) =>
    write((db) => {
      resolveScope(db, input.projectId, input.serviceId);
      const key = (input.key ?? "").trim();
      assertValidKey(key);
      assertKeyAvailable(db, input.projectId, input.serviceId, key);

      const variable = addVariable(db, {
        projectId: input.projectId,
        serviceId: input.serviceId,
        key,
        value: input.value ?? "",
        isSecret: input.isSecret,
      });
      addActivity(db, {
        type: "variable.updated",
        title: "Variable ajoutée",
        description: `${key} · ${scopeName(db, input.serviceId)}`,
        ...links(input.projectId, input.serviceId),
      });
      emit(["variables", "projects", "activity"], links(input.projectId, input.serviceId));
      return variable;
    }),

  update: (id, patch) =>
    write((db) => {
      const variable = requireVariable(db, id);
      if (patch.key !== undefined) {
        const key = patch.key.trim();
        assertValidKey(key);
        assertKeyAvailable(db, variable.projectId, variable.serviceId, key, id);
        variable.key = key;
      }
      if (patch.value !== undefined) variable.value = patch.value;
      if (patch.isSecret !== undefined) variable.isSecret = patch.isSecret;
      variable.updatedAt = iso();

      addActivity(db, {
        type: "variable.updated",
        title: "Variable modifiée",
        description: `${variable.key} · ${scopeName(db, variable.serviceId)}`,
        ...links(variable.projectId, variable.serviceId),
      });
      emit(["variables", "activity"], links(variable.projectId, variable.serviceId));
      return variable;
    }),

  delete: (id) =>
    write((db) => {
      const variable = requireVariable(db, id);
      db.variables = db.variables.filter((item) => item.id !== id);
      addActivity(db, {
        type: "variable.updated",
        severity: "warning",
        title: "Variable supprimée",
        description: `${variable.key} · ${scopeName(db, variable.serviceId)}`,
        ...links(variable.projectId, variable.serviceId),
      });
      emit(["variables", "projects", "activity"], links(variable.projectId, variable.serviceId));
    }),

  bulkUpsert: (input) =>
    write((db) => {
      resolveScope(db, input.projectId, input.serviceId);

      // Like a .env file: the last occurrence of a key wins.
      const entries = new Map<string, string>();
      for (const entry of input.entries) {
        const key = (entry.key ?? "").trim();
        assertValidKey(key);
        entries.delete(key);
        entries.set(key, entry.value ?? "");
      }

      const existing = scopeVariables(db, input.projectId, input.serviceId);
      const now = iso();
      let changes = 0;

      // Inserted last to first so the scope reads in the order of `entries`.
      for (const [key, value] of [...entries].reverse()) {
        const current = existing.find((variable) => variable.key === key);
        if (!current) {
          addVariable(db, {
            projectId: input.projectId,
            serviceId: input.serviceId,
            key,
            value,
            createdAt: now,
          });
          changes += 1;
        } else if (current.value !== value) {
          current.value = value;
          current.updatedAt = now;
          changes += 1;
        }
      }

      if (input.replace) {
        const removed = new Set(
          existing.filter((variable) => !entries.has(variable.key)).map((variable) => variable.id),
        );
        db.variables = db.variables.filter((variable) => !removed.has(variable.id));
        changes += removed.size;
      }

      if (changes > 0) {
        addActivity(db, {
          type: "variable.updated",
          title: "Variables mises à jour",
          description: `${changes} modification${changes > 1 ? "s" : ""} · ${scopeName(db, input.serviceId)}`,
          ...links(input.projectId, input.serviceId),
        });
        emit(["variables", "projects", "activity"], links(input.projectId, input.serviceId));
      }
      return newestFirst(scopeVariables(db, input.projectId, input.serviceId));
    }),
};
