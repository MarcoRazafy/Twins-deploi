/**
 * Inserts a service row. Shared by every namespace that creates services
 * (github.importRepo, docker.deployImage, databases.create): call it inside the
 * transaction that also enqueues the first deployment.
 */

import type { Service } from "@/generated/prisma/client";
import { CANVAS } from "@/lib/constants";
import type { PlatformSettings, Position, ServiceConfig } from "@/lib/types";

import type { DbClient } from "../db";
import { conflict, notFound } from "../errors";
import { newId } from "../ids";
import { getPlatformSettings } from "../platform-settings";
import { assertConfigRanges, toSlug, uniqueSlug, validServiceName } from "../rules";
import { volumeNameFor } from "./names";
import {
  assertBranch,
  assertImage,
  assertRepo,
  assertTag,
  normalizeRootDirectory,
  validVolume,
} from "./validate";

export type ServiceSourceInput =
  | { type: "github"; repo: string; branch: string; rootDirectory?: string; autoDeploy?: boolean }
  | { type: "docker"; image: string; tag: string }
  | { type: "postgres"; version: string };

export interface CreateServiceInput {
  projectId: string;
  /**
   * Display name. A user-chosen name (`explicitName`) must be free in the
   * project (conflict otherwise); a derived one is suffixed "-2", "-3"… until
   * it is. The slug is always made unique.
   */
  name: string;
  explicitName?: boolean;
  source: ServiceSourceInput;
  /** Over the platform defaults (settings.docker / settings.deployments). */
  config?: Partial<ServiceConfig>;
  volume?: { mountPath: string; sizeGb: number } | null;
  /** Canvas position of the card; a free spot is computed when omitted. */
  position?: Position;
}

/**
 * Serialises the writes that must see a consistent set of services in a
 * project (names, slugs). The lock lasts until the surrounding transaction ends.
 */
export async function lockProject(client: DbClient, projectId: string): Promise<void> {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
  if (rows.length === 0) throw notFound("Projet");
}

export function defaultServiceConfig(
  settings: PlatformSettings,
  overrides: Partial<ServiceConfig> = {},
): ServiceConfig {
  return {
    port: overrides.port ?? 3000,
    builder: overrides.builder ?? settings.deployments.defaultBuilder,
    buildCommand: overrides.buildCommand ?? "",
    startCommand: overrides.startCommand ?? "",
    healthcheckPath: overrides.healthcheckPath ?? "",
    restartPolicy: overrides.restartPolicy ?? "on-failure",
    replicas: overrides.replicas ?? 1,
    cpuLimit: overrides.cpuLimit ?? settings.docker.defaultCpuLimit,
    memoryLimitMb: overrides.memoryLimitMb ?? settings.docker.defaultMemoryLimitMb,
  };
}

// ─── Canvas placement ────────────────────────────────────────────────────────

const ORIGIN = 96;
const MIN_GAP = 48;
const COLUMNS = 4;

function snapUp(value: number): number {
  return Math.ceil(value / CANVAS.grid) * CANVAS.grid;
}

/**
 * First free cell of a 4-column layout aligned on the dot grid. Every card is
 * treated as if it carried a volume footer, so a volume attached later never
 * makes two cards touch (gap of at least 48 units).
 */
export function findFreePosition(existing: readonly Position[]): Position {
  const width = CANVAS.cardWidth;
  const height = CANVAS.cardHeight + CANVAS.volumeHeight;
  const stepX = snapUp(width + MIN_GAP + 40);
  const stepY = snapUp(height + MIN_GAP + 12);

  const collides = (x: number, y: number): boolean =>
    existing.some(
      (position) =>
        x < position.x + width + MIN_GAP &&
        position.x < x + width + MIN_GAP &&
        y < position.y + height + MIN_GAP &&
        position.y < y + height + MIN_GAP,
    );

  for (let row = 0; row < 250; row += 1) {
    for (let col = 0; col < COLUMNS; col += 1) {
      const x = ORIGIN + col * stepX;
      const y = ORIGIN + row * stepY;
      if (!collides(x, y)) return { x, y };
    }
  }
  return { x: ORIGIN, y: ORIGIN + 250 * stepY };
}

// ─── Names ───────────────────────────────────────────────────────────────────

/** First of `base`, `base-2`, `base-3`… not taken (case-insensitive). */
function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`.toLowerCase())) suffix += 1;
  return `${base}-${suffix}`;
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}

/** Source columns by service type (the columns of the other types stay null / default). */
function sourceColumns(source: ServiceSourceInput) {
  if (source.type === "github") {
    assertRepo(source.repo);
    assertBranch(source.branch);
    return {
      repo: source.repo,
      branch: source.branch,
      rootDirectory: normalizeRootDirectory(source.rootDirectory ?? "/"),
      autoDeploy: source.autoDeploy ?? true,
    };
  }
  if (source.type === "docker") {
    assertImage(source.image);
    assertTag(source.tag);
    return { image: source.image, tag: source.tag };
  }
  return { pgVersion: source.version };
}

/** Inserts the service (status "building": the caller enqueues its first deployment). */
export async function createService(client: DbClient, input: CreateServiceInput): Promise<Service> {
  await lockProject(client, input.projectId);
  const siblings = await client.service.findMany({
    where: { projectId: input.projectId },
    select: { name: true, slug: true, positionX: true, positionY: true },
  });
  const settings = await getPlatformSettings(client);
  const names = siblings.map((sibling) => sibling.name);

  let name: string;
  if (input.explicitName) {
    name = validServiceName(input.name);
    if (names.some((taken) => taken.toLowerCase() === name.toLowerCase())) {
      throw conflict("Un service porte déjà ce nom dans ce projet.", "name");
    }
  } else {
    const base = input.name.trim().slice(0, 36);
    name = uniqueName(base.length >= 2 ? base : "service", names);
  }
  const slug = uniqueSlug(
    toSlug(name, "service"),
    siblings.map((sibling) => sibling.slug),
  );

  const config = defaultServiceConfig(settings, input.config);
  assertConfigRanges(config);

  const id = newId("svc");
  const volume = input.volume ? validVolume(input.volume, input.source.type === "postgres") : null;
  const free = findFreePosition(
    siblings.map((sibling) => ({ x: sibling.positionX, y: sibling.positionY })),
  );
  const position =
    input.position && isCoordinate(input.position.x) && isCoordinate(input.position.y)
      ? input.position
      : free;

  const now = new Date();
  const row = await client.service.create({
    data: {
      id,
      projectId: input.projectId,
      name,
      slug,
      type: input.source.type,
      status: "building",
      ...sourceColumns(input.source),
      positionX: Math.round(position.x),
      positionY: Math.round(position.y),
      volumeName: volume ? volumeNameFor(id) : null,
      volumeMountPath: volume?.mountPath ?? null,
      volumeSizeGb: volume?.sizeGb ?? null,
      ...config,
      createdAt: now,
    },
  });
  await client.project.update({ where: { id: input.projectId }, data: { updatedAt: now } });
  return row;
}
