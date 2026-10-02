import type { DockerHubImage } from "@/lib/types";

// Same rules as the API so the form rejects what the backend would reject.
const IMAGE_PATTERN = /^[a-z0-9]+([._:-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/;
const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const SERVICE_NAME_MIN = 2;
export const SERVICE_NAME_MAX = 40;
export const DEFAULT_CUSTOM_PORT = 80;

/** What the first step of the deploy flow hands to the second one. */
export interface ImageSelection {
  image: string;
  tag: string;
  port: number;
  /** Catalogue entry, null for a custom reference. */
  hub: DockerHubImage | null;
}

/** "ghcr.io/acme/api:1.4" becomes `{ image: "ghcr.io/acme/api", tag: "1.4" }`. */
export function parseImageReference(value: string): { image: string; tag: string | null } {
  const reference = value.trim();
  const colon = reference.lastIndexOf(":");
  // A colon followed by a slash belongs to a registry port ("localhost:5000/app").
  if (colon === -1 || reference.indexOf("/", colon) !== -1) return { image: reference, tag: null };
  return { image: reference.slice(0, colon), tag: reference.slice(colon + 1) };
}

export function validateImage(image: string): string | null {
  if (IMAGE_PATTERN.test(image)) return null;
  return "Saisissez une image valide, par exemple « nginx » ou « ghcr.io/acme/api:1.4 ».";
}

export function validateTag(tag: string): string | null {
  if (TAG_PATTERN.test(tag)) return null;
  return "Ce tag d’image n’est pas valide.";
}

export function validatePort(value: string): string | null {
  const port = Number(value);
  if (value.trim() !== "" && Number.isInteger(port) && port >= 1 && port <= 65_535) return null;
  return "Le port doit être compris entre 1 et 65535.";
}

export function validateServiceName(name: string): string | null {
  const length = name.trim().length;
  if (length >= SERVICE_NAME_MIN && length <= SERVICE_NAME_MAX) return null;
  return `Entre ${SERVICE_NAME_MIN} et ${SERVICE_NAME_MAX} caractères.`;
}

/** Default service name: last path segment of the image. */
export function defaultServiceName(image: string): string {
  return image.split("/").pop() ?? image;
}

export interface EnvRow {
  id: number;
  key: string;
  value: string;
}

let rowCounter = 0;

/** Called from handlers only (never during render). */
export function createEnvRow(): EnvRow {
  rowCounter += 1;
  return { id: rowCounter, key: "", value: "" };
}

export function validateEnvKey(key: string): string | null {
  if (ENV_KEY_PATTERN.test(key)) return null;
  return "Lettres, chiffres et _ uniquement, sans commencer par un chiffre.";
}

/** Rows that are completely empty are ignored; the others need a valid, unique key. */
export function validateEnvRows(rows: readonly EnvRow[]): {
  errors: Record<number, string>;
  variables: Array<{ key: string; value: string }>;
} {
  const errors: Record<number, string> = {};
  const variables: Array<{ key: string; value: string }> = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const key = row.key.trim();
    if (key === "" && row.value === "") continue;
    const keyError = key === "" ? "La clé est obligatoire." : validateEnvKey(key);
    if (keyError) {
      errors[row.id] = keyError;
    } else if (seen.has(key)) {
      errors[row.id] = "Cette clé est déjà utilisée.";
    } else {
      seen.add(key);
      variables.push({ key, value: row.value });
    }
  }
  return { errors, variables };
}
