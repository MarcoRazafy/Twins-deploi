/**
 * Networks, volumes and images.
 */

import {
  docker,
  dockerRaw,
  classifyFailure,
  isDockerError,
  JSON_FORMAT,
  LABEL_MANAGED,
  LABEL_PROJECT,
  LABEL_SERVICE,
  parseJsonLines,
  text,
  type DockerOptions,
} from "./cli";

// ─── sizes and dates as the CLI prints them ─────────────────────────────────

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

/** "48.2MB", "1.5GiB", "0B" -> bytes (0 when unreadable). */
export function parseSize(value: string): number {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)\s*$/.exec(value);
  if (!match) return 0;
  const unit = UNITS[match[2].toLowerCase()];
  return unit === undefined ? 0 : Number(match[1]) * unit;
}

/** "2025-08-13 16:34:01 +0000 UTC" (docker ps / images) or RFC 3339 -> Date, null when unreadable. */
export function parseDockerDate(value: string): Date | null {
  const cli = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(?:\.\d+)? ([+-]\d\d)(\d\d)/.exec(value);
  const date = new Date(cli ? `${cli[1]}T${cli[2]}${cli[3]}:${cli[4]}` : value);
  return Number.isNaN(date.getTime()) || date.getTime() <= 0 ? null : date;
}

// ─── networks ───────────────────────────────────────────────────────────────

/** Creates the bridge network of a project unless it exists. */
export async function ensureNetwork(name: string, projectId: string): Promise<void> {
  const existing = await dockerRaw(["network", "inspect", "--format", "{{.Name}}", name]);
  if (existing.code === 0) return;
  const failure = classifyFailure("network inspect", existing);
  if (!isDockerError(failure, "not_found")) throw failure;
  try {
    await docker(
      [
        "network", "create", "--driver", "bridge",
        "--label", `${LABEL_MANAGED}=true`,
        "--label", `${LABEL_PROJECT}=${projectId}`,
        name,
      ],
      { action: "network create" },
    );
  } catch (error) {
    // Created meanwhile by a concurrent call: fine.
    if (error instanceof Error && /already exists/i.test(error.message)) return;
    throw error;
  }
}

/** Resolves with false when the network did not exist. Rejects with kind "in_use" while containers are attached. */
export async function removeNetwork(name: string): Promise<boolean> {
  try {
    await docker(["network", "rm", name], { action: "network rm" });
    return true;
  } catch (error) {
    if (isDockerError(error, "not_found")) return false;
    throw error;
  }
}

// ─── volumes ────────────────────────────────────────────────────────────────

/** Creates the named volume of a service unless it exists (docker volume create is idempotent). */
export async function ensureVolume(name: string, serviceId: string): Promise<void> {
  await docker(
    ["volume", "create", "--label", `${LABEL_MANAGED}=true`, "--label", `${LABEL_SERVICE}=${serviceId}`, name],
    { action: "volume create" },
  );
}

/** Resolves with false when the volume did not exist. Rejects with kind "in_use" while a container mounts it. */
export async function removeVolume(name: string): Promise<boolean> {
  try {
    await docker(["volume", "rm", name], { action: "volume rm" });
    return true;
  } catch (error) {
    if (isDockerError(error, "not_found")) return false;
    throw error;
  }
}

// ─── images ─────────────────────────────────────────────────────────────────

export interface LocalImage {
  /** Full image id ("sha256:…"). */
  id: string;
  /** "<none>" for a dangling image. */
  repository: string;
  tag: string;
  sizeBytes: number;
  createdAt: Date | null;
}

/** What `docker image rm` needs to remove exactly this entry. */
export function imageReference(image: Pick<LocalImage, "id" | "repository" | "tag">): string {
  return image.repository === "<none>" || image.tag === "<none>" ? image.id : `${image.repository}:${image.tag}`;
}

export function pullImage(
  reference: string,
  options: Pick<DockerOptions, "onLine" | "signal" | "timeoutMs"> = {},
): Promise<void> {
  return docker(["pull", reference], { timeoutMs: 30 * 60_000, ...options }).then(() => undefined);
}

/** Null when the image is not present locally. */
export async function inspectImage(reference: string): Promise<{ id: string; sizeBytes: number } | null> {
  try {
    const result = await docker(["image", "inspect", "--format", JSON_FORMAT, reference], {
      action: "image inspect",
    });
    const record = parseJsonLines(result.stdout)[0];
    if (!record) return null;
    const size = record.Size;
    return { id: text(record, "Id"), sizeBytes: typeof size === "number" ? size : 0 };
  } catch (error) {
    if (isDockerError(error, "not_found")) return null;
    throw error;
  }
}

export interface ImageFilter {
  /** Repository pattern, e.g. "mini-railway/*" or "mini-railway/svc_x". */
  reference?: string;
  dangling?: boolean;
}

export async function listImages(filter: ImageFilter = {}): Promise<LocalImage[]> {
  const args = ["image", "ls", "--no-trunc", "--format", JSON_FORMAT];
  if (filter.dangling) args.push("--filter", "dangling=true");
  if (filter.reference) args.push("--filter", `reference=${filter.reference}`);
  const result = await docker(args, { action: "image ls" });
  return parseJsonLines(result.stdout).map((record) => ({
    id: text(record, "ID"),
    repository: text(record, "Repository") || "<none>",
    tag: text(record, "Tag") || "<none>",
    sizeBytes: parseSize(text(record, "Size")),
    createdAt: parseDockerDate(text(record, "CreatedAt")),
  }));
}

/** Rejects with kind "in_use" when a container uses the image, "not_found" when it is gone. */
export async function removeImage(reference: string): Promise<void> {
  await docker(["image", "rm", reference], { action: "image rm" });
}

/** Image references (as given to `docker run`) of every container of the host, running or not. */
export async function listContainerImages(): Promise<string[]> {
  const result = await docker(["ps", "-a", "--no-trunc", "--format", JSON_FORMAT], { action: "ps" });
  return parseJsonLines(result.stdout).map((record) => text(record, "Image"));
}

/** How many of `containerImages` run this image. */
export function containersUsing(image: LocalImage, containerImages: readonly string[]): number {
  const names = new Set([`${image.repository}:${image.tag}`, image.id, image.id.replace(/^sha256:/, "")]);
  if (image.tag === "latest") names.add(image.repository);
  const shortId = image.id.replace(/^sha256:/, "").slice(0, 12);
  return containerImages.filter((used) => names.has(used) || (shortId !== "" && used === shortId)).length;
}

export const PLATFORM_IMAGES = "mini-railway/*";

/**
 * Removes dangling images and the images built by the platform that no
 * container uses. Images pulled by users (nginx, postgres…) are never touched.
 */
export async function pruneImages(): Promise<{ removed: number; reclaimedMb: number }> {
  const used = await listContainerImages();
  const candidates = new Map<string, LocalImage>();
  for (const image of await listImages({ dangling: true })) candidates.set(imageReference(image), image);
  for (const image of await listImages({ reference: PLATFORM_IMAGES })) {
    candidates.set(imageReference(image), image);
  }

  let removed = 0;
  let bytes = 0;
  for (const [reference, image] of candidates) {
    if (containersUsing(image, used) > 0) continue;
    try {
      await removeImage(reference);
      removed += 1;
      bytes += image.sizeBytes;
    } catch (error) {
      // Still referenced (a container started meanwhile, a child image) or already gone: skipped.
      if (!isDockerError(error)) throw error;
    }
  }
  return { removed, reclaimedMb: Math.round((bytes / 1e6) * 10) / 10 };
}
