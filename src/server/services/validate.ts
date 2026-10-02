/**
 * Validation of the user-editable settings of a service (source, volume,
 * commands, configuration). Shared with the namespaces that create services
 * (github, docker, databases). Field names are dotted paths into the input
 * ("source.repo", "volume.sizeGb", "config.port").
 *
 * Several of these values end up in command lines (git, docker) or in
 * generated files: they are restricted to safe character sets here.
 */

import type { ServiceConfig } from "@/lib/types";

import { validation } from "../errors";
import { asRecord, asString, assertConfigRanges, inRange } from "../rules";

export const PG_DATA_PATH = "/var/lib/postgresql/data";

const IMAGE_PATTERN = /^[a-z0-9]+([._:-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/;
const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const REPO_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const BRANCH_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,254}$/;
const DIRECTORY_SEGMENT = /^[A-Za-z0-9_.@+-][A-Za-z0-9_.@+ -]*$/;
const MOUNT_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const MAX_COMMAND_LENGTH = 1000;

/** Tabs are fine in a command, every other control character is not. */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) return true;
  }
  return false;
}

/** "redis:7-alpine" → ["redis", "7-alpine"]; "ghcr.io:443/acme/api" has no tag. */
export function splitImage(image: string): [string, string | undefined] {
  const colon = image.lastIndexOf(":");
  if (colon === -1 || image.indexOf("/", colon) !== -1) return [image, undefined];
  return [image.slice(0, colon), image.slice(colon + 1)];
}

export function assertImage(image: string, field = "image"): void {
  if (image.length > 255 || !IMAGE_PATTERN.test(image)) {
    throw validation("Saisissez une image valide, par exemple « nginx » ou « ghcr.io/acme/api ».", field);
  }
}

export function assertTag(tag: string, field = "tag"): void {
  if (!TAG_PATTERN.test(tag)) throw validation("Ce tag d’image n’est pas valide.", field);
}

/** "owner/name" as GitHub spells it. */
export function assertRepo(repo: string, field = "source.repo"): void {
  if (!REPO_PATTERN.test(repo)) {
    throw validation("Saisissez un dépôt au format « propriétaire/nom ».", field);
  }
}

export function assertBranch(branch: string, field = "source.branch"): void {
  const valid =
    BRANCH_PATTERN.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    !branch.includes("@{") &&
    !/[./]$/.test(branch) &&
    !branch.endsWith(".lock");
  if (!valid) throw validation("Ce nom de branche n’est pas valide.", field);
}

/** Absolute, normalised ("" becomes "/"), without `..` segments. */
export function normalizeRootDirectory(value: string, field = "source.rootDirectory"): string {
  const trimmed = value.trim();
  if (trimmed === "") return "/";
  if (!trimmed.startsWith("/")) {
    throw validation("Le répertoire racine doit commencer par « / ».", field);
  }
  const segments = trimmed.split("/").filter((segment) => segment !== "");
  const valid =
    trimmed.length <= 200 &&
    segments.every(
      (segment) => segment !== "." && segment !== ".." && DIRECTORY_SEGMENT.test(segment),
    );
  if (!valid) throw validation("Ce répertoire racine n’est pas valide.", field);
  return `/${segments.join("/")}`;
}

/** Columns that define the source of a service (a subset of the Service row). */
export interface SourceColumns {
  type: "github" | "docker" | "postgres";
  repo: string | null;
  branch: string | null;
  rootDirectory: string;
  autoDeploy: boolean;
  image: string | null;
  tag: string | null;
}

/**
 * Merges an untrusted source patch into the current source. The type never
 * changes; fields that do not apply to the type are ignored. Returns only the
 * columns to write.
 */
export function mergeSource(
  current: SourceColumns,
  rawPatch: unknown,
): Partial<Pick<SourceColumns, "repo" | "branch" | "rootDirectory" | "autoDeploy" | "image" | "tag">> {
  const patch = asRecord(rawPatch);

  if (current.type === "postgres") {
    throw validation("La source d’une base PostgreSQL ne peut pas être modifiée.", "source");
  }

  if (current.type === "docker") {
    let image = current.image ?? "";
    let tag = current.tag ?? "latest";
    if (patch.tag !== undefined) tag = asString(patch.tag).trim();
    if (patch.image !== undefined) {
      // "redis:7-alpine" typed in the image field carries its own tag.
      const [name, inlineTag] = splitImage(asString(patch.image).trim());
      image = name;
      if (inlineTag && patch.tag === undefined) tag = inlineTag;
    }
    assertImage(image, "source.image");
    assertTag(tag, "source.tag");
    return { image, tag };
  }

  const next: Partial<Pick<SourceColumns, "repo" | "branch" | "rootDirectory" | "autoDeploy">> = {};
  if (patch.repo !== undefined) {
    const repo = asString(patch.repo).trim();
    assertRepo(repo);
    next.repo = repo;
  }
  if (patch.branch !== undefined) {
    const branch = asString(patch.branch).trim();
    assertBranch(branch);
    next.branch = branch;
  }
  if (patch.rootDirectory !== undefined) {
    next.rootDirectory = normalizeRootDirectory(asString(patch.rootDirectory));
  }
  if (patch.autoDeploy !== undefined) {
    if (typeof patch.autoDeploy !== "boolean") {
      throw validation("Le déploiement automatique doit être activé ou désactivé.", "source.autoDeploy");
    }
    next.autoDeploy = patch.autoDeploy;
  }
  return next;
}

/** Mount point and size of a volume. PostgreSQL volumes are pinned to the data directory. */
export function validVolume(
  raw: unknown,
  postgres: boolean,
): { mountPath: string; sizeGb: number } {
  const input = asRecord(raw);
  const mountPath = asString(input.mountPath).trim();
  const segments = mountPath.split("/").slice(1);
  const validPath =
    mountPath.startsWith("/") &&
    mountPath.length <= 200 &&
    segments.length > 0 &&
    segments.every((segment) => MOUNT_SEGMENT.test(segment) && segment !== "." && segment !== "..");
  if (!validPath) {
    throw validation("Le point de montage doit être un chemin absolu, par exemple « /data ».", "volume.mountPath");
  }
  if (postgres && mountPath !== PG_DATA_PATH) {
    throw validation("Le point de montage d’une base PostgreSQL ne peut pas être modifié.", "volume.mountPath");
  }
  // The column is an integer number of gigabytes.
  const sizeGb = input.sizeGb;
  if (!inRange(sizeGb, 1, 100)) {
    throw validation("La taille du volume doit être comprise entre 1 et 100 Go.", "volume.sizeGb");
  }
  return { mountPath, sizeGb };
}

/** Build and start commands end up in generated files: single line, bounded. */
function validCommand(value: unknown, field: string): string {
  if (typeof value !== "string") throw validation("La commande doit être du texte.", field);
  const command = value.trim();
  if (command.length > MAX_COMMAND_LENGTH) {
    throw validation("La commande ne peut pas dépasser 1 000 caractères.", field);
  }
  if (hasControlCharacter(command)) {
    throw validation("La commande ne peut pas contenir de saut de ligne.", field);
  }
  return command;
}

function validHealthcheckPath(value: unknown): string {
  if (typeof value !== "string") {
    throw validation("Le chemin du healthcheck doit être du texte.", "config.healthcheckPath");
  }
  const path = value.trim();
  if (path !== "" && (!path.startsWith("/") || /\s/.test(path) || path.length > 255)) {
    throw validation("Le chemin du healthcheck doit commencer par « / ».", "config.healthcheckPath");
  }
  return path;
}

function pickNumber(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  // NaN fails the range check with the right field message.
  return typeof value === "number" ? value : Number.NaN;
}

function pickChoice<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  field: string,
  message: string,
): T {
  if (value === undefined) return fallback;
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw validation(message, field);
  return match;
}

/** Applies an untrusted partial configuration over the current one, validated as a whole. */
export function mergeConfig(current: ServiceConfig, rawPatch: unknown): ServiceConfig {
  const patch = asRecord(rawPatch);
  const numbers = {
    port: pickNumber(patch.port, current.port),
    replicas: pickNumber(patch.replicas, current.replicas),
    cpuLimit: pickNumber(patch.cpuLimit, current.cpuLimit),
    memoryLimitMb: pickNumber(patch.memoryLimitMb, current.memoryLimitMb),
  };
  assertConfigRanges(numbers);
  return {
    ...numbers,
    builder: pickChoice(
      patch.builder,
      ["nixpacks", "dockerfile"],
      current.builder,
      "config.builder",
      "Ce mode de build n’est pas disponible.",
    ),
    restartPolicy: pickChoice(
      patch.restartPolicy,
      ["always", "on-failure", "never"],
      current.restartPolicy,
      "config.restartPolicy",
      "Cette politique de redémarrage n’est pas disponible.",
    ),
    buildCommand:
      patch.buildCommand === undefined
        ? current.buildCommand
        : validCommand(patch.buildCommand, "config.buildCommand"),
    startCommand:
      patch.startCommand === undefined
        ? current.startCommand
        : validCommand(patch.startCommand, "config.startCommand"),
    healthcheckPath:
      patch.healthcheckPath === undefined
        ? current.healthcheckPath
        : validHealthcheckPath(patch.healthcheckPath),
  };
}
