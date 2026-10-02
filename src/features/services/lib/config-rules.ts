import type { ServiceConfig } from "@/lib/types";

/** Ranges enforced by the API (see the contract of `services.update`). */
export const CONFIG_LIMITS = {
  port: { min: 1, max: 65_535 },
  replicas: { min: 1, max: 5 },
  cpu: { min: 0.25, max: 8, step: 0.25 },
  memoryMb: { min: 128, max: 16_384 },
  volumeGb: { min: 1, max: 100 },
} as const;

const MEMORY_STOPS_MB = [128, 256, 512, 1024, 2048, 4096, 8192, 16_384] as const;

/** Slider stops for the memory limit; a saved value off the grid gets its own stop. */
export function memoryStops(current: number): number[] {
  return [...new Set<number>([...MEMORY_STOPS_MB, current])].sort((a, b) => a - b);
}

export type ParsedNumber = { ok: true; value: number } | { ok: false; error: string };

/** Parses a text field holding an integer (or a decimal when `integer` is false). */
export function parseNumber(
  text: string,
  { min, max, integer = true }: { min: number; max: number; integer?: boolean },
  message: string,
): ParsedNumber {
  const normalized = text.trim().replace(",", ".");
  if (normalized === "") return { ok: false, error: message };
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < min || value > max) return { ok: false, error: message };
  if (integer && !Number.isInteger(value)) return { ok: false, error: message };
  return { ok: true, value };
}

export function parsePort(text: string): ParsedNumber {
  return parseNumber(
    text,
    CONFIG_LIMITS.port,
    "Le port doit être un nombre entier entre 1 et 65 535.",
  );
}

export function validateHealthcheckPath(path: string): string | null {
  const trimmed = path.trim();
  if (trimmed !== "" && !trimmed.startsWith("/")) {
    return "Le chemin doit commencer par « / ».";
  }
  return null;
}

export function validateMountPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.length < 2) {
    return "Indiquez un chemin absolu, par exemple « /data ».";
  }
  return null;
}

export function pickConfig<Key extends keyof ServiceConfig>(
  config: ServiceConfig,
  keys: readonly Key[],
): Pick<ServiceConfig, Key> {
  const picked = {} as Pick<ServiceConfig, Key>;
  for (const key of keys) picked[key] = config[key];
  return picked;
}
