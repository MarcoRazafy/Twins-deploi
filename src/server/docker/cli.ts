/**
 * Lowest layer of the Docker wrapper: runs the `docker` CLI through exec.ts
 * (argument arrays, no shell) and turns every failure into a typed error.
 *
 * - Docker not usable at all (not installed, daemon down, socket not readable
 *   by this user) -> ApiError("unavailable") with a French message.
 * - Anything else -> DockerError with the end of stderr (never user-facing).
 */

import { ApiError } from "@/lib/api/contract";

import { unavailable } from "../errors";
import { ExecError, run, type RunOptions, type RunResult } from "../exec";

export const DOCKER = "docker";

/** Go template that prints one JSON object per line. */
export const JSON_FORMAT = "{{json .}}";

export const LABEL_MANAGED = "mini-railway.managed";
export const LABEL_PROJECT = "mini-railway.project";
export const LABEL_SERVICE = "mini-railway.service";
export const LABEL_DEPLOYMENT = "mini-railway.deployment";

export const PERMISSION_DENIED_MESSAGE =
  "Docker n’est pas accessible pour l’utilisateur de la plateforme (accès refusé au socket Docker). Exécutez scripts/server/setup.sh sur le serveur, puis relancez la plateforme.";
export const DAEMON_DOWN_MESSAGE =
  "Docker ne répond pas sur ce serveur. Vérifiez que le service Docker est démarré.";
export const NOT_INSTALLED_MESSAGE =
  "Docker n’est pas installé sur ce serveur. Exécutez scripts/server/setup.sh.";

export type DockerFailure = "not_found" | "in_use" | "timeout" | "aborted" | "failed";

/** A docker command that ran but did not succeed. `message` is English and for logs only. */
export class DockerError extends Error {
  readonly kind: DockerFailure;
  /** Subcommand, e.g. "pull" or "network create". */
  readonly action: string;
  readonly code: number;
  /** End of stderr, secrets masked by exec.ts. */
  readonly stderrTail: string;

  constructor(kind: DockerFailure, action: string, code: number, stderrTail: string) {
    const summary =
      kind === "timeout"
        ? `docker ${action} timed out`
        : kind === "aborted"
          ? `docker ${action} was aborted`
          : `docker ${action} exited with code ${code}`;
    super(stderrTail ? `${summary}: ${stderrTail}` : summary);
    this.name = "DockerError";
    this.kind = kind;
    this.action = action;
    this.code = code;
    this.stderrTail = stderrTail;
  }
}

export function isDockerError(error: unknown, kind?: DockerFailure): error is DockerError {
  return error instanceof DockerError && (kind === undefined || error.kind === kind);
}

const STDERR_TAIL_CHARS = 600;

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > STDERR_TAIL_CHARS ? `…${trimmed.slice(-STDERR_TAIL_CHARS)}` : trimmed;
}

const PERMISSION_DENIED = /permission denied/i;
const SOCKET_HINT = /docker\.sock|docker api|docker daemon socket/i;
const DAEMON_DOWN = /cannot connect to the docker daemon|is the docker daemon running|error during connect/i;
const NOT_FOUND = /no such (container|image|network|volume|object)|not found|does not exist/i;
const IN_USE = /in use|is being used|is using its referenced image|has active endpoints|conflict/i;

/** The French error when stderr tells that Docker itself cannot be reached; null otherwise. */
export function unavailableFromStderr(stderr: string): ApiError | null {
  if (PERMISSION_DENIED.test(stderr) && SOCKET_HINT.test(stderr)) return unavailable(PERMISSION_DENIED_MESSAGE);
  if (DAEMON_DOWN.test(stderr)) return unavailable(DAEMON_DOWN_MESSAGE);
  return null;
}

export function classifyFailure(action: string, result: RunResult): ApiError | DockerError {
  const fromStderr = unavailableFromStderr(result.stderr);
  if (fromStderr) return fromStderr;
  const kind: DockerFailure = result.aborted
    ? "aborted"
    : result.timedOut
      ? "timeout"
      : NOT_FOUND.test(result.stderr)
        ? "not_found"
        : IN_USE.test(result.stderr)
          ? "in_use"
          : "failed";
  return new DockerError(kind, action, result.code, tail(result.stderr));
}

export interface DockerOptions extends RunOptions {
  /** Label of the command in errors; defaults to the first argument. */
  action?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** Runs `docker <args>` and resolves with its outcome whatever the exit code. */
export async function dockerRaw(args: readonly string[], options: DockerOptions = {}): Promise<RunResult> {
  try {
    return await run(DOCKER, args, { timeoutMs: DEFAULT_TIMEOUT_MS, ...options });
  } catch (error) {
    if (error instanceof ExecError && error.reason === "spawn") throw unavailable(NOT_INSTALLED_MESSAGE);
    throw error;
  }
}

/** Runs `docker <args>`; rejects with a DockerError or ApiError("unavailable") unless it exits with 0. */
export async function docker(args: readonly string[], options: DockerOptions = {}): Promise<RunResult> {
  const result = await dockerRaw(args, options);
  if (result.code === 0 && !result.timedOut && !result.aborted) return result;
  throw classifyFailure(options.action ?? args[0] ?? "", result);
}

/** Parses the output of a `--format "{{json .}}"` command: one record per line. */
export function parseJsonLines(stdout: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  for (const line of stdout.split("\n")) {
    const text = line.trim();
    if (text === "") continue;
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        records.push(value as Record<string, unknown>);
      }
    } catch {
      // Not JSON (a warning printed by the CLI): ignored.
    }
  }
  return records;
}

export function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

export function child(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type DockerStatus =
  | { available: true }
  | {
      available: false;
      /** English, for the worker log. */
      reason: string;
      /** French, for API errors. */
      message: string;
    };

const STATUS_TTL_MS = 5_000;
let cachedStatus: { at: number; status: DockerStatus } | null = null;

/** Whether the Docker engine answers, cached for a few seconds. Never throws. */
export async function isDockerAvailable(): Promise<DockerStatus> {
  if (cachedStatus && Date.now() - cachedStatus.at < STATUS_TTL_MS) return cachedStatus.status;
  let status: DockerStatus;
  try {
    const result = await dockerRaw(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 5_000 });
    if (result.code === 0 && !result.timedOut) {
      status = { available: true };
    } else {
      const failure = unavailableFromStderr(result.stderr);
      status = {
        available: false,
        reason: result.timedOut
          ? "docker version timed out"
          : failure?.message === PERMISSION_DENIED_MESSAGE
            ? "permission denied on the Docker socket (run scripts/server/setup.sh)"
            : `docker version failed: ${tail(result.stderr).replace(/\s+/g, " ") || `exit code ${result.code}`}`,
        message: failure?.message ?? DAEMON_DOWN_MESSAGE,
      };
    }
  } catch (error) {
    status = {
      available: false,
      reason: "the docker executable was not found",
      message: error instanceof ApiError ? error.message : NOT_INSTALLED_MESSAGE,
    };
  }
  cachedStatus = { at: Date.now(), status };
  return status;
}

/** Rejects with ApiError("unavailable") when Docker cannot be used. */
export async function requireDocker(): Promise<void> {
  const status = await isDockerAvailable();
  if (!status.available) throw unavailable(status.message);
}
