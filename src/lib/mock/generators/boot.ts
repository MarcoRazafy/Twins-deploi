/**
 * What a container prints while it starts. Shared by the deploy section of
 * deployment logs and by the runtime logs of a freshly started container.
 *
 * Messages may contain placeholders resolved against the line timestamp:
 * `{pgts}` (PostgreSQL log prefix) and `{redists}` (Redis log prefix).
 */

import type { LogLevel } from "@/lib/types";

import { pgLogTime } from "../text";
import type { Family } from "./family";

export type Entry = string | readonly [LogLevel, string];

export interface BootInfo {
  family: Family;
  /** Framework reported by GitHub, when known ("NestJS", "FastAPI"…). */
  framework: string | null;
  /** kebab-case service name. */
  slug: string;
  port: number;
  /** Image tag or PostgreSQL major version. */
  version: string;
  /** Empty = default command of the stack. */
  startCommand: string;
  /** PostgreSQL only: the data directory is empty and must be initialised. */
  firstBoot: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** "01 Oct 2026 20:19:57.412", the timestamp of Redis server logs. */
export function redisLogTime(ms: number): string {
  const date = new Date(ms);
  return (
    `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.` +
    `${pad(date.getUTCMilliseconds(), 3)}`
  );
}

export function fillTimePlaceholders(message: string, ms: number): string {
  if (!message.includes("{")) return message;
  return message
    .replace(/\{pgts\}/g, pgLogTime(ms))
    .replace(/\{redists\}/g, redisLogTime(ms));
}

export const POSTGRES_MINOR: Record<string, string> = {
  "17": "17.2",
  "16": "16.6",
  "15": "15.10",
};

export function postgresFullVersion(major: string): string {
  return POSTGRES_MINOR[major] ?? `${major}.1`;
}

const POSTGRES_INITDB: Entry[] = [
  'The files belonging to this database system will be owned by user "postgres".',
  "This user must also own the server process.",
  'The database cluster will be initialized with locale "en_US.utf8".',
  'The default database encoding has accordingly been set to "UTF8".',
  "Data page checksums are disabled.",
  "fixing permissions on existing directory /var/lib/postgresql/data ... ok",
  "creating subdirectories ... ok",
  "selecting dynamic shared memory implementation ... posix",
  "selecting default max_connections ... 100",
  "selecting default shared_buffers ... 128MB",
  "creating configuration files ... ok",
  "running bootstrap script ... ok",
  "performing post-bootstrap initialization ... ok",
  "syncing data to disk ... ok",
  "waiting for server to start.... done",
  "server started",
  "CREATE DATABASE",
  "PostgreSQL init process complete; ready for start up.",
];

function postgresBoot(info: BootInfo): Entry[] {
  const version = postgresFullVersion(info.version);
  const start: Entry[] = [
    `{pgts} [1] LOG:  starting PostgreSQL ${version} (Debian ${version}-1.pgdg120+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14) 12.2.0, 64-bit`,
    `{pgts} [1] LOG:  listening on IPv4 address "0.0.0.0", port ${info.port}`,
    `{pgts} [1] LOG:  listening on IPv6 address "::", port ${info.port}`,
    `{pgts} [1] LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.${info.port}"`,
    "{pgts} [29] LOG:  database system was shut down at {pgts}",
    ["success", "{pgts} [1] LOG:  database system is ready to accept connections"],
  ];
  if (info.firstBoot) return [...POSTGRES_INITDB, ...start];
  return [
    "PostgreSQL Database directory appears to contain a database; Skipping initialization",
    ...start,
  ];
}

function githubBoot(info: BootInfo): Entry[] {
  const { slug, port } = info;
  if (info.startCommand) {
    return [`> ${info.startCommand}`, ["success", `Listening on 0.0.0.0:${port}`]];
  }
  switch (info.family) {
    case "next":
      return [
        `> ${slug}@0.1.0 start`,
        "> next start",
        "   ▲ Next.js 15.4.6",
        `   - Local:        http://localhost:${port}`,
        `   - Network:      http://0.0.0.0:${port}`,
        ["success", " ✓ Ready in 412ms"],
      ];
    case "static":
      return [
        `> ${slug}@1.0.0 preview`,
        `> astro preview --host 0.0.0.0 --port ${port}`,
        " astro  v5.2.3 ready in 14 ms",
        ["success", `┃ Network  http://0.0.0.0:${port}/`],
      ];
    case "php":
      return [
        "   INFO  Running migrations.",
        "   INFO  Nothing to migrate.",
        "[NOTICE] fpm is running, pid 1",
        ["success", "[NOTICE] ready to handle connections"],
      ];
    case "python":
      if (info.framework === "FastAPI") {
        return [
          "INFO:     Started server process [1]",
          "INFO:     Waiting for application startup.",
          "INFO:     Application startup complete.",
          ["success", `INFO:     Uvicorn running on http://0.0.0.0:${port} (Press CTRL+C to quit)`],
        ];
      }
      return [
        "[1] [INFO] Starting gunicorn 23.0.0",
        `[1] [INFO] Listening at: http://0.0.0.0:${port} (1)`,
        "[1] [INFO] Using worker: sync",
        ["success", "[7] [INFO] Booting worker with pid: 7"],
      ];
    case "go":
      return [
        `{"level":"info","message":"configuration loaded","env":"production"}`,
        ["success", `{"level":"info","message":"http server listening","addr":":${port}"}`],
      ];
    default:
      if (info.framework === "NestJS") {
        return [
          `> ${slug}@1.4.0 start:prod /app`,
          "> node dist/main",
          "[Nest] 1  - LOG [NestFactory] Starting Nest application...",
          "[Nest] 1  - LOG [InstanceLoader] AppModule dependencies initialized +18ms",
          "[Nest] 1  - LOG [InstanceLoader] PrismaModule dependencies initialized +41ms",
          "[Nest] 1  - LOG [RoutesResolver] HealthController {/health}: +3ms",
          ["success", "[Nest] 1  - LOG [NestApplication] Nest application successfully started +2ms"],
        ];
      }
      return [
        `> ${slug}@1.0.0 start`,
        "> node dist/index.js",
        ["success", `Server listening on port ${port}`],
      ];
  }
}

function dockerBoot(info: BootInfo): Entry[] {
  const { port, version } = info;
  switch (info.family) {
    case "redis":
      return [
        "1:C {redists} * oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo",
        `1:C {redists} * Redis version=${version.replace(/[^0-9.]/g, "") || "7"}.4.1, bits=64, commit=00000000, modified=0, pid=1, just started`,
        "1:M {redists} * monotonic clock: POSIX clock_gettime",
        "1:M {redists} * Running mode=standalone, port=" + port + ".",
        "1:M {redists} * Server initialized",
        ["success", "1:M {redists} * Ready to accept connections tcp"],
      ];
    case "metabase":
      return [
        `Metabase ${version} (0b4dfc4 release-x.50.x)`,
        "Starting Metabase in STANDALONE mode",
        `Launching Embedded Jetty Webserver with config: {:port ${port}, :host "0.0.0.0"}`,
        "Setting up and migrating Metabase DB. Please sit tight, this may take a minute...",
        "Database Migrations Current ... ✅",
        ["success", "Metabase Initialization COMPLETE in 38.2 s"],
      ];
    case "n8n":
      return [
        "Initializing n8n process",
        `n8n ready on 0.0.0.0, port ${port}`,
        `Version: ${version === "latest" ? "1.64.0" : version}`,
        "Editor is now accessible via:",
        ["success", `http://0.0.0.0:${port}`],
      ];
    case "worker":
      return [
        `> worker@${version} start`,
        "> node dist/main.js",
        "INFO  worker booting (pid 1, node v20.17.0)",
        "INFO  redis connected redis.railway.internal:6379",
        "INFO  postgres pool ready (max=10)",
        ["success", 'INFO  queue "orders" consumer started (concurrency=4)'],
      ];
    case "web":
      return [
        "/docker-entrypoint.sh: Configuration complete; ready for start up",
        "[notice] 1#1: using the \"epoll\" event method",
        "[notice] 1#1: start worker processes",
        ["success", "[notice] 1#1: start worker process 29"],
      ];
    default:
      return [
        "Container entrypoint started (PID 1)",
        ["success", `Listening on 0.0.0.0:${port}`],
      ];
  }
}

export function bootLines(info: BootInfo, sourceType: "github" | "docker" | "postgres"): Entry[] {
  if (sourceType === "postgres" || info.family === "postgres") return postgresBoot(info);
  return sourceType === "github" ? githubBoot(info) : dockerBoot(info);
}
