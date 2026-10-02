import type { Api } from "@/lib/api/contract";

import { addActivity } from "../domain/activity";
import { toContainer } from "../domain/containers";
import { startDeployment } from "../domain/deployments";
import { containersUsing, pruneUnusedImages } from "../domain/images";
import { containerLogLines } from "../domain/runtime-logs";
import {
  addContainer,
  addService,
  defaultConfig,
  resolveServiceName,
} from "../domain/services";
import { addVariable, assertValidKey } from "../domain/variables";
import { emit } from "../emitter";
import { conflict, invalid } from "../errors";
import { splitImage } from "../generators/build-logs";
import { requireContainer, requireImage, requireProject, requireService } from "../lookup";
import { DOCKER_HUB_CATALOGUE } from "../seed/docker-hub";
import { subscribeContainerLogs } from "../simulator/runtime-logs";
import { newestFirst } from "../text";
import { read, write } from "./respond";
import { assertImage, assertTag, restartService, startService, stopService } from "./services";

export const dockerApi: Api["docker"] = {
  listContainers: (filter) =>
    read((db) => {
      const now = Date.now();
      return newestFirst(
        filter?.projectId
          ? db.containers.filter((container) => container.projectId === filter.projectId)
          : db.containers,
      ).map((container) => toContainer(db, container, now));
    }),

  containerAction: (containerId, action) =>
    write((db) => {
      const container = requireContainer(db, containerId);
      const service = requireService(db, container.serviceId);
      if (action === "start") startService(db, service);
      else if (action === "stop") stopService(db, service);
      else if (action === "restart") restartService(db, service);
      else throw invalid("Cette action n’est pas disponible.", "action");
      return toContainer(db, container, Date.now());
    }),

  getContainerLogs: (containerId) =>
    read((db) => containerLogLines(db, requireContainer(db, containerId), Date.now())),

  subscribeContainerLogs: (containerId, onLines) => subscribeContainerLogs(containerId, onLines),

  listImages: () =>
    read((db) =>
      newestFirst(db.images).map((image) => ({ ...image, containers: containersUsing(db, image) })),
    ),

  removeImage: (id) =>
    write((db) => {
      const image = requireImage(db, id);
      if (containersUsing(db, image) > 0) {
        throw conflict("Cette image est utilisée par un conteneur et ne peut pas être supprimée.");
      }
      db.images = db.images.filter((item) => item.id !== id);
      emit(["images", "metrics"]);
    }),

  pruneImages: () =>
    write((db) => {
      const result = pruneUnusedImages(db);
      if (result.removed > 0) emit(["images", "metrics"]);
      return result;
    }),

  searchHub: (query) =>
    read(() => {
      const needle = (query ?? "").trim().toLowerCase();
      if (needle === "") return DOCKER_HUB_CATALOGUE;
      return DOCKER_HUB_CATALOGUE.filter(
        (image) =>
          image.name.toLowerCase().includes(needle) ||
          image.description.toLowerCase().includes(needle),
      );
    }),

  deployImage: (input) =>
    write((db) => {
      const project = requireProject(db, input.projectId);

      // "redis:7-alpine" typed in the image field carries its own tag.
      const [image, inlineTag] = splitImage((input.image ?? "").trim());
      assertImage(image);
      const tag = input.tag?.trim() || inlineTag || "latest";
      assertTag(tag);

      const catalogued = DOCKER_HUB_CATALOGUE.find((item) => item.name === image);
      const port = input.port ?? catalogued?.defaultPort ?? 80;
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw invalid("Le port doit être compris entre 1 et 65535.", "port");
      }

      const variables = new Map<string, string>();
      for (const entry of input.variables ?? []) {
        const key = (entry.key ?? "").trim();
        assertValidKey(key);
        variables.set(key, entry.value ?? "");
      }

      const name = resolveServiceName(
        db,
        project.id,
        input.name,
        image.split("/").pop() ?? "service",
      );
      const service = addService(db, {
        project,
        name,
        source: { type: "docker", image, tag },
        config: defaultConfig(db.settings, { port }),
        volume: null,
        position: input.position,
      });
      addContainer(db, project, service, `${image}:${tag}`);
      for (const [key, value] of [...variables].reverse()) {
        addVariable(db, { projectId: project.id, serviceId: service.id, key, value });
      }

      addActivity(db, {
        type: "service.created",
        title: "Service créé",
        description: `${name} · image ${image}:${tag}`,
        projectId: project.id,
        serviceId: service.id,
      });
      const deployment = startDeployment(db, service, { trigger: "initial", commit: null });

      emit(
        ["services", "containers", "variables", "deployments", "projects", "metrics", "activity"],
        { projectId: project.id, serviceId: service.id, deploymentId: deployment.id },
      );
      return service;
    }),
};
