/**
 * Validation rules shared by every namespace. Same rules and French messages
 * as the simulator. RPC arguments are untrusted JSON: use the `as*` readers
 * before trusting a static type.
 */

import { slugify } from "@/lib/format";
import type { ServiceConfig } from "@/lib/types";

import { validation } from "./errors";

// ─── Untrusted input readers ─────────────────────────────────────────────────

/** The value when it is a string, "" otherwise. */
export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The value when it is a plain object, {} otherwise. */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function inRange(value: unknown, min: number, max: number, integer = true): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    (!integer || Number.isInteger(value))
  );
}

/** Case-insensitive name equality, as used for uniqueness checks. */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ─── Names and slugs ─────────────────────────────────────────────────────────

/** Returns the trimmed name (uniqueness is checked by the caller). */
export function validProjectName(name: unknown): string {
  const trimmed = asString(name).trim();
  if (trimmed.length < 2 || trimmed.length > 40) {
    throw validation("Le nom du projet doit contenir entre 2 et 40 caractères.", "name");
  }
  return trimmed;
}

export function validServiceName(name: unknown): string {
  const trimmed = asString(name).trim();
  if (trimmed.length < 2 || trimmed.length > 40) {
    throw validation("Le nom du service doit contenir entre 2 et 40 caractères.", "name");
  }
  return trimmed;
}

export function validPersonName(name: unknown): string {
  const trimmed = asString(name).trim();
  if (trimmed.length < 2 || trimmed.length > 60) {
    throw validation("Le nom doit contenir entre 2 et 60 caractères.", "name");
  }
  return trimmed;
}

/** kebab-case slug, safe for Docker names and hostnames; `fallback` when nothing is left. */
export function toSlug(text: string, fallback: string): string {
  return slugify(text).slice(0, 40).replace(/-+$/, "") || fallback;
}

/** First of `base`, `base-2`, `base-3`… that is not in `taken`. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

// ─── Variables ───────────────────────────────────────────────────────────────

export const VARIABLE_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertVariableKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !key) {
    throw validation("Le nom de la variable est requis.", "key");
  }
  if (!VARIABLE_KEY_PATTERN.test(key)) {
    throw validation(
      `« ${key} » n’est pas un nom de variable valide : utilisez des lettres, des chiffres et « _ », sans commencer par un chiffre.`,
      "key",
    );
  }
}

// ─── Hosts, e-mails, addresses ───────────────────────────────────────────────

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Expects a lower-cased hostname without trailing dot (see normalizeHostname). */
export function isFqdn(hostname: string): boolean {
  if (hostname.length > 253) return false;
  const labels = hostname.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => HOST_LABEL.test(label))) return false;
  return /^[a-z]{2,}$/.test(labels[labels.length - 1]);
}

export function normalizeHostname(hostname: unknown): string {
  return asString(hostname).trim().toLowerCase().replace(/\.$/, "");
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(value: unknown): string {
  return asString(value).trim().toLowerCase();
}

/** Returns the normalised (trimmed, lower-cased) address. */
export function validEmail(value: unknown): string {
  const email = normalizeEmail(value);
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw validation("Saisissez une adresse e-mail valide.", "email");
  }
  return email;
}

export const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

// ─── Passwords ───────────────────────────────────────────────────────────────

export const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 200;

export function validPassword(value: unknown): string {
  const password = asString(value);
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw validation("Le mot de passe doit contenir au moins 10 caractères.", "password");
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw validation("Le mot de passe ne peut pas dépasser 200 caractères.", "password");
  }
  return password;
}

// ─── Service configuration ───────────────────────────────────────────────────

export const CONFIG_LIMITS = {
  port: { min: 1, max: 65_535 },
  replicas: { min: 1, max: 5 },
  cpuLimit: { min: 0.25, max: 8 },
  memoryLimitMb: { min: 128, max: 16_384 },
} as const;

export function isValidPort(value: unknown): value is number {
  return inRange(value, CONFIG_LIMITS.port.min, CONFIG_LIMITS.port.max);
}

/** Checks the numeric ranges; field names are dotted paths ("config.port"). */
export function assertConfigRanges(
  config: Pick<ServiceConfig, "port" | "replicas" | "cpuLimit" | "memoryLimitMb">,
): void {
  if (!isValidPort(config.port)) {
    throw validation("Le port doit être compris entre 1 et 65535.", "config.port");
  }
  if (!inRange(config.replicas, CONFIG_LIMITS.replicas.min, CONFIG_LIMITS.replicas.max)) {
    throw validation("Le nombre de réplicas doit être compris entre 1 et 5.", "config.replicas");
  }
  if (!inRange(config.cpuLimit, CONFIG_LIMITS.cpuLimit.min, CONFIG_LIMITS.cpuLimit.max, false)) {
    throw validation("La limite de CPU doit être comprise entre 0,25 et 8 vCPU.", "config.cpuLimit");
  }
  if (
    !inRange(config.memoryLimitMb, CONFIG_LIMITS.memoryLimitMb.min, CONFIG_LIMITS.memoryLimitMb.max)
  ) {
    throw validation(
      "La limite de mémoire doit être comprise entre 128 et 16 384 Mo.",
      "config.memoryLimitMb",
    );
  }
}
