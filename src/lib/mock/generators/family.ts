/**
 * Coarse "kind of workload" of a service. Drives the look of its runtime
 * logs and the magnitude of its metrics.
 */

import type { Service } from "@/lib/types";

export type Family =
  | "next"
  | "node"
  | "php"
  | "python"
  | "go"
  | "static"
  | "postgres"
  | "redis"
  | "metabase"
  | "n8n"
  | "worker"
  | "web"
  | "generic";

/** Keyed by framework, or by language for repositories without a framework. */
const STACK_FAMILY: Record<string, Family> = {
  "Next.js": "next",
  NestJS: "node",
  Express: "node",
  TypeScript: "node",
  JavaScript: "node",
  Laravel: "php",
  PHP: "php",
  Django: "python",
  FastAPI: "python",
  Python: "python",
  Astro: "static",
  Gin: "go",
  Go: "go",
};

/**
 * @param stack Framework of the GitHub repository, or its language when no
 *   framework was detected. Ignored for Docker and PostgreSQL services.
 */
export function familyOf(service: Service, stack: string | null): Family {
  const source = service.source;
  if (source.type === "postgres") return "postgres";
  if (source.type === "github") {
    return (stack && STACK_FAMILY[stack]) || "node";
  }

  const image = source.image.toLowerCase();
  const name = service.name.toLowerCase();
  if (image.includes("postgres")) return "postgres";
  if (image.includes("redis") || image.includes("valkey")) return "redis";
  if (image.includes("metabase")) return "metabase";
  if (image.includes("n8n")) return "n8n";
  if (image.includes("worker") || name.includes("worker")) return "worker";
  if (/nginx|caddy|httpd|wordpress|ghost/.test(image)) return "web";
  return "generic";
}
