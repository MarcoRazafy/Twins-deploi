import type { PlatformSettings } from "@/lib/types";

import { env } from "../env";

/** Settings of a fresh installation (no "platform" row yet). */
export function defaultPlatformSettings(): PlatformSettings {
  const baseDomain = env.baseDomain;
  return {
    workspaceName: "Mini Railway",
    baseDomain,
    defaultRegion: "mg-analamanga",
    deployments: {
      autoDeploy: true,
      buildTimeoutMin: 20,
      retention: 20,
      defaultBuilder: "nixpacks",
    },
    docker: {
      socketPath: "/var/run/docker.sock",
      registryUrl: "https://registry-1.docker.io",
      defaultCpuLimit: 1,
      defaultMemoryLimitMb: 512,
      autoPrune: false,
    },
    nginx: {
      clientMaxBodySizeMb: 50,
      proxyReadTimeoutSec: 60,
      gzip: true,
      http2: true,
      forceHttps: false,
    },
    dns: {
      provider: "manual",
      serverIp: "127.0.0.1",
      cnameTarget: `ingress.${baseDomain}`,
    },
    notifications: {
      deploySucceeded: true,
      deployFailed: true,
      serviceCrashed: true,
      domainIssues: true,
      weeklyDigest: false,
      email: false,
      inApp: true,
    },
  };
}

/**
 * Deep merge of untrusted JSON onto a typed document: only the keys of `base`
 * are read, and a value is taken only when it has the type of the one it
 * replaces. Unknown keys and wrongly typed values are ignored.
 */
export function overlay<T extends object>(base: T, patch: unknown): T {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return base;
  const source = patch as Record<string, unknown>;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, current] of Object.entries(base)) {
    if (!Object.hasOwn(source, key)) continue;
    const next = source[key];
    if (typeof current === "object" && current !== null) {
      result[key] = overlay(current, next);
    } else if (typeof next === typeof current && next !== null) {
      result[key] = next;
    }
  }
  return result as T;
}

/** Stored JSON document → PlatformSettings (missing keys take their default). */
export function toPlatformSettings(stored: unknown): PlatformSettings {
  return overlay(defaultPlatformSettings(), stored);
}
