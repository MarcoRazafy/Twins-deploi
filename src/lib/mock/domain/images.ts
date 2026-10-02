/** Local image store: one record per repository:tag ever pulled or built. */

import type { ISODate } from "@/lib/types";

import { splitImage } from "../generators/build-logs";
import { hashString, hexString, seededRng } from "../generators/prng";
import type { ImageRecord, MockDb } from "../schema";

/** Stable id, so the same reference always maps to the same image. */
export function imageId(repository: string, tag: string): string {
  return `img_${hexString(seededRng("image", repository, tag), 12)}`;
}

const KNOWN_SIZES: Array<[RegExp, number]> = [
  [/postgres/, 438],
  [/redis/, 41],
  [/metabase/, 548],
  [/n8n/, 492],
  [/worker/, 186],
  [/nginx/, 48],
  [/caddy/, 52],
  [/node/, 135],
  [/python/, 128],
  [/mysql/, 586],
  [/mongo/, 812],
  [/grafana/, 452],
  [/wordpress/, 702],
  [/ghost/, 574],
  [/minio/, 162],
  [/rabbitmq/, 262],
  [/adminer/, 118],
  [/uptime-kuma/, 438],
  [/plausible/, 196],
];

export function imageSizeMb(repository: string, tag: string): number {
  const variation = hashString(`${repository}:${tag}`) % 37;
  const known = KNOWN_SIZES.find(([pattern]) => pattern.test(repository));
  if (known) return known[1] + (tag.includes("alpine") || known[1] < 60 ? 0 : variation);
  // Application images built by the platform, or unknown third-party images.
  return 240 + ((hashString(repository) + variation * 7) % 260);
}

export function parseReference(reference: string): { repository: string; tag: string } {
  const [repository, tag] = splitImage(reference);
  return { repository, tag: tag ?? "latest" };
}

/** Adds the image to the store when missing. Returns true when it was added. */
export function ensureImage(db: MockDb, reference: string, createdAt: ISODate): boolean {
  const { repository, tag } = parseReference(reference);
  const id = imageId(repository, tag);
  if (db.images.some((image) => image.id === id)) return false;
  const record: ImageRecord = {
    id,
    repository,
    tag,
    sizeMb: imageSizeMb(repository, tag),
    createdAt,
  };
  db.images.unshift(record);
  return true;
}

export function containersUsing(db: MockDb, image: ImageRecord): number {
  const reference = `${image.repository}:${image.tag}`;
  return db.containers.filter((container) => container.image === reference).length;
}

/** Host of the platform registry, without protocol ("registry.mini-railway.app"). */
export function registryHost(registryUrl: string): string {
  return registryUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "") || "registry.local";
}

/** Removes every image no container uses. */
export function pruneUnusedImages(db: MockDb): { removed: number; reclaimedMb: number } {
  const unused = db.images.filter((image) => containersUsing(db, image) === 0);
  if (unused.length === 0) return { removed: 0, reclaimedMb: 0 };
  const ids = new Set(unused.map((image) => image.id));
  db.images = db.images.filter((image) => !ids.has(image.id));
  return {
    removed: unused.length,
    reclaimedMb: unused.reduce((total, image) => total + image.sizeMb, 0),
  };
}
