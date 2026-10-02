import type { Service as ServiceRow } from "@/generated/prisma/client";
import type { Api } from "@/lib/api/contract";
import type { Container, DockerHubImage, DockerImage } from "@/lib/types";

import { recordActivity } from "../activity";
import { requireUser, type Context } from "../context";
import { sha256Hex } from "../crypto";
import { db } from "../db";
import { enqueueDeployment, imageReferenceFor } from "../deployments/enqueue";
import {
  containersUsing,
  createRuntimeLineMapper,
  imageReference,
  isDockerAvailable,
  isDockerError,
  listContainerImages,
  listContainers,
  listImages,
  pruneImages,
  removeImage,
  requireDocker,
  tailLogs,
  type LocalImage,
} from "../docker";
import { HUB_CATALOGUE } from "../docker/hub-catalogue";
import { findContainerService } from "../docker/lookup";
import { conflict, notFound, unavailable, validation } from "../errors";
import { emit } from "../events";
import {
  publicContainerId,
  toContainer,
  type ContainerSample,
  type LiveContainer,
} from "../mappers/container";
import { toService } from "../mappers/service";
import { asRecord, asString, assertVariableKey, isValidPort } from "../rules";
import { createService } from "../services/create";
import { assertImage, assertTag, splitImage } from "../services/validate";
import { createVariable } from "../variables/store";
import { createServicesApi } from "./services";

const RUNTIME_LOG_LINES = 200;
/** A sample older than this no longer describes the container. */
const SAMPLE_MAX_AGE_MS = 60_000;
const HUB_SEARCH_URL = "https://hub.docker.com/v2/search/repositories/";
const HUB_TIMEOUT_MS = 5_000;
const HUB_RESULTS = 25;
const MAX_QUERY_LENGTH = 100;
const MAX_VARIABLES = 200;
const IMAGE_IN_USE = "Cette image est utilisée par un conteneur et ne peut pas être supprimée.";
const HUB_UNAVAILABLE = "Docker Hub ne répond pas pour le moment. Réessayez dans un instant.";

function toLiveState(state: string): LiveContainer["state"] {
  if (state === "running" || state === "restarting" || state === "paused" || state === "created") return state;
  return "exited";
}

/** What Docker says about the managed containers, by name; null when it cannot be asked. */
async function readLiveContainers(): Promise<Map<string, LiveContainer> | null> {
  if (!(await isDockerAvailable()).available) return null;
  try {
    const live = new Map<string, LiveContainer>();
    for (const container of await listContainers()) {
      live.set(container.name, {
        state: toLiveState(container.state),
        health: container.health,
        exitCode: container.exitCode,
        image: container.image,
        createdAt: container.createdAt,
      });
    }
    return live;
  } catch {
    return null;
  }
}

/** One Container per service that has been deployed at least once. */
async function loadContainers(where: { projectId?: string; id?: string }): Promise<Container[]> {
  const services = await db().service.findMany({ where: { ...where, containerName: { not: null } } });
  if (services.length === 0) return [];

  const serviceIds = services.map((service) => service.id);
  const deployments = await db().deployment.findMany({
    where: { id: { in: services.flatMap((service) => service.activeDeploymentId ?? []) } },
    select: { id: true, image: true, finishedAt: true, createdAt: true },
  });
  const deploymentById = new Map(deployments.map((deployment) => [deployment.id, deployment]));

  const samples = new Map<string, ContainerSample>();
  const recent = await db().metricSample.findMany({
    where: { serviceId: { in: serviceIds }, ts: { gte: new Date(Date.now() - SAMPLE_MAX_AGE_MS) } },
    orderBy: { ts: "desc" },
  });
  for (const sample of recent) if (!samples.has(sample.serviceId)) samples.set(sample.serviceId, sample);

  const live = await readLiveContainers();
  const containers = services.map((service) => {
    const deployment = deploymentById.get(service.activeDeploymentId ?? "");
    return toContainer(service, {
      live: live === null ? null : (live.get(service.containerName ?? "") ?? { state: "missing", health: "none", exitCode: null, image: "", createdAt: null }),
      sample: samples.get(service.id) ?? null,
      image: deployment?.image ?? imageReferenceFor(service, service.activeDeploymentId ?? ""),
      createdAt: deployment?.finishedAt ?? deployment?.createdAt ?? service.createdAt,
    });
  });
  return containers.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

async function requireContainerService(containerId: unknown): Promise<ServiceRow> {
  const service = await findContainerService(containerId);
  if (!service) throw notFound("Conteneur");
  return service;
}

/** Stable public id of a local image entry (one per repository:tag). */
function publicImageId(image: LocalImage): string {
  return `img_${sha256Hex(`${image.id}|${image.repository}:${image.tag}`).slice(0, 16)}`;
}

function toDockerImage(image: LocalImage, containerImages: readonly string[]): DockerImage {
  return {
    id: publicImageId(image),
    repository: image.repository,
    tag: image.tag,
    sizeMb: Math.round((image.sizeBytes / 1e6) * 10) / 10,
    createdAt: (image.createdAt ?? new Date(0)).toISOString(),
    containers: containersUsing(image, containerImages),
  };
}

// ─── Docker Hub ─────────────────────────────────────────────────────────────

function formatPulls(count: number): string {
  if (count >= 1e9) return "1B+";
  for (const [unit, size] of [["M", 1e6], ["K", 1e3]] as const) {
    if (count >= size) {
      const value = count / size;
      const step = value >= 100 ? 100 : value >= 10 ? 10 : 1;
      return `${Math.floor(value / step) * step}${unit}+`;
    }
  }
  return String(Math.max(0, Math.floor(count)));
}

const CATEGORY_HINTS: Array<[RegExp, DockerHubImage["category"], number]> = [
  [/postgres|postgis|timescale/, "database", 5432],
  [/mysql|mariadb|percona/, "database", 3306],
  [/mongo/, "database", 27017],
  [/redis|valkey|keydb|dragonfly/, "cache", 6379],
  [/memcached/, "cache", 11211],
  [/prometheus/, "monitoring", 9090],
  [/grafana/, "monitoring", 3000],
  [/kuma|monitor|metrics|analytics/, "monitoring", 3000],
  [/nginx|httpd|apache|caddy|traefik|wordpress|ghost/, "web", 80],
  [/node|python|golang|openjdk|ruby|php|deno|bun/, "runtime", 3000],
];

function fromHubResult(raw: unknown): DockerHubImage | null {
  const record = asRecord(raw);
  const repository = asString(record.repo_name).replace(/^library\//, "");
  if (repository === "" || !/^[a-z0-9]+([._/-][a-z0-9]+)*$/.test(repository)) return null;
  const known = HUB_CATALOGUE.find((image) => image.name === repository);
  const hint = CATEGORY_HINTS.find(([pattern]) => pattern.test(repository));
  const pulls = typeof record.pull_count === "number" ? record.pull_count : 0;
  const stars = typeof record.star_count === "number" ? record.star_count : 0;
  return {
    name: repository,
    description: asString(record.short_description).slice(0, 300),
    official: record.is_official === true,
    pulls: formatPulls(pulls),
    stars,
    category: known?.category ?? hint?.[1] ?? "tool",
    tags: known?.tags ?? ["latest"],
    defaultTag: known?.defaultTag ?? "latest",
    defaultPort: known?.defaultPort ?? hint?.[2] ?? 80,
  };
}

async function searchDockerHub(query: string): Promise<DockerHubImage[]> {
  const url = `${HUB_SEARCH_URL}?query=${encodeURIComponent(query)}&page_size=${HUB_RESULTS}`;
  let payload: unknown;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Docker Hub answered ${response.status}`);
    payload = await response.json();
  } catch {
    throw unavailable(HUB_UNAVAILABLE);
  }
  const results = asRecord(payload).results;
  if (!Array.isArray(results)) return [];
  const images: DockerHubImage[] = [];
  for (const result of results) {
    const image = fromHubResult(result);
    if (image && !images.some((existing) => existing.name === image.name)) images.push(image);
  }
  return images;
}

// ─── namespace ──────────────────────────────────────────────────────────────

export function createDockerApi(ctx: Context): Api["docker"] {
  return {
    async listContainers(rawFilter) {
      const projectId = asRecord(rawFilter).projectId;
      return loadContainers(typeof projectId === "string" && projectId !== "" ? { projectId } : {});
    },

    async containerAction(containerId, action) {
      const service = await requireContainerService(containerId);
      // Exactly the code path of services.start / stop / restart.
      const services = createServicesApi(ctx);
      if (action === "start") await services.start(service.id);
      else if (action === "stop") await services.stop(service.id);
      else if (action === "restart") await services.restart(service.id);
      else throw validation("Cette action n’est pas disponible.", "action");
      const [container] = await loadContainers({ id: service.id });
      if (!container) throw notFound("Conteneur");
      return container;
    },

    async getContainerLogs(containerId) {
      const service = await requireContainerService(containerId);
      if (service.containerName === null) return [];
      await requireDocker();
      const toLine = createRuntimeLineMapper(publicContainerId(service));
      const lines = (await tailLogs(service.containerName, RUNTIME_LOG_LINES)).map(toLine);
      // stdout and stderr arrive on two pipes: the docker timestamps give the real order.
      return lines.sort((a, b) => a.ts.localeCompare(b.ts));
    },

    // Served by GET /api/logs/containers/<id> (SSE); never reachable through RPC.
    subscribeContainerLogs: () => () => {},

    async listImages() {
      await requireDocker();
      const [images, used] = await Promise.all([listImages(), listContainerImages()]);
      return images
        .map((image) => toDockerImage(image, used))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.repository.localeCompare(b.repository));
    },

    async removeImage(id) {
      requireUser(ctx);
      const imageId = asString(id);
      await requireDocker();
      const image = (await listImages()).find((candidate) => publicImageId(candidate) === imageId);
      if (!image) throw notFound("Image");
      if (containersUsing(image, await listContainerImages()) > 0) throw conflict(IMAGE_IN_USE);
      try {
        await removeImage(imageReference(image));
      } catch (error) {
        if (isDockerError(error, "in_use")) throw conflict(IMAGE_IN_USE);
        if (isDockerError(error, "not_found")) throw notFound("Image");
        if (isDockerError(error)) {
          console.error(`[docker] image rm failed: ${error.stderrTail}`);
          throw unavailable("Docker n’a pas pu supprimer cette image. Réessayez dans un instant.");
        }
        throw error;
      }
      await emit(["images", "metrics"]);
    },

    async pruneImages() {
      requireUser(ctx);
      await requireDocker();
      const result = await pruneImages();
      if (result.removed > 0) await emit(["images", "metrics"]);
      return result;
    },

    async searchHub(rawQuery) {
      const needle = asString(rawQuery).trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
      if (needle === "") return HUB_CATALOGUE;
      return searchDockerHub(needle);
    },

    async deployImage(rawInput) {
      const author = requireUser(ctx).name;
      const input = asRecord(rawInput);
      const projectId = asString(input.projectId);
      const project = await db().project.findUnique({ where: { id: projectId }, select: { id: true } });
      if (!project) throw notFound("Projet");

      // "redis:7-alpine" typed in the image field carries its own tag.
      const [image, inlineTag] = splitImage(asString(input.image).trim());
      assertImage(image);
      const tag = asString(input.tag).trim() || inlineTag || "latest";
      assertTag(tag);

      const catalogued = HUB_CATALOGUE.find((item) => item.name === image);
      const port = input.port ?? catalogued?.defaultPort ?? 80;
      if (!isValidPort(port)) throw validation("Le port doit être compris entre 1 et 65535.", "port");

      const variables = new Map<string, string>();
      const entries = Array.isArray(input.variables) ? input.variables.slice(0, MAX_VARIABLES) : [];
      for (const raw of entries) {
        const entry = asRecord(raw);
        const key = asString(entry.key).trim();
        assertVariableKey(key);
        variables.set(key, asString(entry.value));
      }

      const requestedName = asString(input.name).trim();
      const place = asRecord(input.position);
      const position =
        typeof place.x === "number" && typeof place.y === "number" ? { x: place.x, y: place.y } : undefined;

      const row = await db().$transaction(async (tx) => {
        const service = await createService(tx, {
          projectId,
          name: requestedName !== "" ? requestedName : (image.split("/").pop() ?? "service"),
          explicitName: requestedName !== "",
          source: { type: "docker", image, tag },
          config: { port },
          position,
        });
        for (const [key, value] of variables) {
          await createVariable(tx, { projectId, serviceId: service.id, key, value });
        }
        await recordActivity(
          {
            type: "service.created",
            title: "Service créé",
            description: `${service.name} · image ${image}:${tag}`,
            projectId,
            serviceId: service.id,
            actor: author,
          },
          tx,
        );
        await enqueueDeployment(tx, { service, trigger: "initial", creator: author, commit: null });
        await emit(["services", "variables", "projects"], { projectId, serviceId: service.id }, tx);
        // enqueueDeployment moved latestDeploymentId on the row: answer with the fresh one.
        return tx.service.findUniqueOrThrow({ where: { id: service.id } });
      });
      return toService(row);
    },
  };
}
