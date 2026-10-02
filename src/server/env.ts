/**
 * Server environment (shared by the web process and the worker).
 *
 * Lookup order, never overriding a variable that is already set: process
 * environment, `.env.local`, `.env`, `/etc/mini-railway/mini-railway.env`.
 * Accessors are lazy: importing this module never throws, a missing variable
 * only fails when it is actually read.
 */

import { existsSync } from "node:fs";
import path from "node:path";

const ENV_FILES = [
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), ".env"),
  "/etc/mini-railway/mini-railway.env",
];

let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue;
    try {
      // process.loadEnvFile keeps the variables that already exist.
      process.loadEnvFile(file);
    } catch {
      // Unreadable for this user: the variables must then come from the environment.
    }
  }
}

function optional(name: string): string | null {
  load();
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? null : value.trim();
}

function required(name: string): string {
  const value = optional(name);
  if (value === null) {
    throw new Error(
      `Missing environment variable ${name} (set it in .env.local or /etc/mini-railway/mini-railway.env).`,
    );
  }
  return value;
}

export const env = {
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  /** 32 bytes as 64 hexadecimal characters: key of the secrets at rest. */
  get secretKey(): string {
    const value = required("MINI_RAILWAY_SECRET_KEY");
    if (!/^[0-9a-fA-F]{64}$/.test(value)) {
      throw new Error("MINI_RAILWAY_SECRET_KEY must be 64 hexadecimal characters (32 bytes).");
    }
    return value.toLowerCase();
  },
  get dataDir(): string {
    return required("MINI_RAILWAY_DATA_DIR");
  },
  get baseDomain(): string {
    return (optional("MINI_RAILWAY_BASE_DOMAIN") ?? "mini-railway.test").toLowerCase();
  },
  /** Null in development before scripts/server/setup.sh has been run. */
  get proxyHelper(): string | null {
    return optional("MINI_RAILWAY_PROXY_HELPER");
  },
  get hostsHelper(): string | null {
    return optional("MINI_RAILWAY_HOSTS_HELPER");
  },
  get isProduction(): boolean {
    load();
    return process.env.NODE_ENV === "production";
  },
};
