/**
 * Containers: run, inspect, lifecycle, logs, stats, exec.
 */

import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";

import { unavailable } from "../errors";
import type { OutputStream, RunResult } from "../exec";
import {
  child,
  classifyFailure,
  docker,
  DOCKER,
  dockerRaw,
  isDockerError,
  JSON_FORMAT,
  LABEL_DEPLOYMENT,
  LABEL_MANAGED,
  LABEL_PROJECT,
  LABEL_SERVICE,
  NOT_INSTALLED_MESSAGE,
  parseJsonLines,
  text,
  unavailableFromStderr,
  type DockerOptions,
} from "./cli";
import { parseDockerDate, parseSize } from "./resources";

// ─── run ────────────────────────────────────────────────────────────────────

export type DockerRestartPolicy = "always" | "on-failure" | "no";

export interface ContainerSpec {
  name: string;
  image: string;
  network: string;
  /** Names of the container on the project network. */
  aliases: readonly string[];
  /** Published on 127.0.0.1 only. */
  hostPort: number;
  containerPort: number;
  /** 0600 file holding the environment; the caller deletes it right after the run. */
  envFile: string;
  memoryMb: number;
  cpus: number;
  restart: DockerRestartPolicy;
  labels: { projectId: string; serviceId: string; deploymentId: string };
  volume?: { name: string; mountPath: string } | null;
  /** Replaces the image entrypoint (start command override). */
  entrypoint?: string;
  /** Arguments after the image. */
  command?: readonly string[];
}

/**
 * The exact `docker run` argument list of a managed container (docs/BACKEND.md
 * section 8). Never privileged, never the host network, never a host path or
 * the Docker socket: the only mount is a named volume.
 */
export function runArguments(spec: ContainerSpec): string[] {
  const args = ["run", "-d", "--name", spec.name, "--network", spec.network];
  for (const alias of spec.aliases) args.push("--network-alias", alias);
  args.push(
    "-p", `127.0.0.1:${spec.hostPort}:${spec.containerPort}`,
    "--env-file", spec.envFile,
    "--memory", `${Math.round(spec.memoryMb)}m`,
    "--cpus", String(spec.cpus),
    "--pids-limit", "512",
    "--security-opt", "no-new-privileges",
    "--cap-drop", "NET_RAW",
    "--restart", spec.restart,
    "--label", `${LABEL_MANAGED}=true`,
    "--label", `${LABEL_PROJECT}=${spec.labels.projectId}`,
    "--label", `${LABEL_SERVICE}=${spec.labels.serviceId}`,
    "--label", `${LABEL_DEPLOYMENT}=${spec.labels.deploymentId}`,
  );
  if (spec.volume) args.push("--mount", `type=volume,src=${spec.volume.name},dst=${spec.volume.mountPath}`);
  if (spec.entrypoint) args.push("--entrypoint", spec.entrypoint);
  args.push(spec.image);
  if (spec.command) args.push(...spec.command);
  return args;
}

/** Starts the container and resolves with its full id. */
export async function runContainer(
  spec: ContainerSpec,
  options: Pick<DockerOptions, "signal"> = {},
): Promise<string> {
  const result = await docker(runArguments(spec), { ...options, timeoutMs: 120_000 });
  const lines = result.stdout.trim().split("\n");
  return lines[lines.length - 1].trim();
}

// ─── ps / inspect ───────────────────────────────────────────────────────────

export type DockerState = "created" | "running" | "restarting" | "paused" | "exited" | "dead" | "removing";

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: DockerState;
  /** Human status, e.g. "Up 2 hours (healthy)" or "Exited (1) 3 seconds ago". */
  status: string;
  exitCode: number | null;
  health: "healthy" | "unhealthy" | "starting" | "none";
  createdAt: Date | null;
  serviceId: string | null;
  deploymentId: string | null;
}

const STATES: readonly DockerState[] = ["created", "running", "restarting", "paused", "exited", "dead", "removing"];

function toState(value: string): DockerState {
  return STATES.find((state) => state === value.toLowerCase()) ?? "exited";
}

function parseLabels(value: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const separator = pair.indexOf("=");
    if (separator > 0) labels[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return labels;
}

function healthOf(status: string): ContainerSummary["health"] {
  if (/\(healthy\)/.test(status)) return "healthy";
  if (/\(unhealthy\)/.test(status)) return "unhealthy";
  if (/\(health: starting\)/.test(status)) return "starting";
  return "none";
}

export interface ContainerFilter {
  serviceId?: string;
  deploymentId?: string;
}

/** Containers created by the platform (label mini-railway.managed=true), running or not. */
export async function listContainers(filter: ContainerFilter = {}): Promise<ContainerSummary[]> {
  const args = ["ps", "-a", "--no-trunc", "--filter", `label=${LABEL_MANAGED}=true`];
  if (filter.serviceId) args.push("--filter", `label=${LABEL_SERVICE}=${filter.serviceId}`);
  if (filter.deploymentId) args.push("--filter", `label=${LABEL_DEPLOYMENT}=${filter.deploymentId}`);
  args.push("--format", JSON_FORMAT);
  const result = await docker(args, { action: "ps" });
  return parseJsonLines(result.stdout).map((record) => {
    const status = text(record, "Status");
    const labels = parseLabels(text(record, "Labels"));
    const exit = /^Exited \((-?\d+)\)/.exec(status);
    return {
      id: text(record, "ID"),
      name: text(record, "Names").split(",")[0],
      image: text(record, "Image"),
      state: toState(text(record, "State")),
      status,
      exitCode: exit ? Number(exit[1]) : null,
      health: healthOf(status),
      createdAt: parseDockerDate(text(record, "CreatedAt")),
      serviceId: labels[LABEL_SERVICE] ?? null,
      deploymentId: labels[LABEL_DEPLOYMENT] ?? null,
    };
  });
}

export interface ContainerDetails {
  id: string;
  name: string;
  state: DockerState;
  running: boolean;
  exitCode: number;
  startedAt: Date | null;
  /** Automatic restarts done by the restart policy. */
  restartCount: number;
}

/** Details of the containers that exist among `names` (missing ones are simply absent). */
export async function inspectContainers(names: readonly string[]): Promise<ContainerDetails[]> {
  if (names.length === 0) return [];
  const result = await dockerRaw(["container", "inspect", "--format", JSON_FORMAT, ...names]);
  if (result.code !== 0) {
    const failure = unavailableFromStderr(result.stderr);
    if (failure) throw failure;
    // Exit code 1 with "No such container" for some of them: the others are still printed.
    if (result.timedOut) throw classifyFailure("container inspect", result);
  }
  return parseJsonLines(result.stdout).map((record) => {
    const state = child(record, "State");
    const exitCode = state.ExitCode;
    const restartCount = record.RestartCount;
    return {
      id: text(record, "Id"),
      name: text(record, "Name").replace(/^\//, ""),
      state: toState(text(state, "Status")),
      running: state.Running === true,
      exitCode: typeof exitCode === "number" ? exitCode : 0,
      startedAt: parseDockerDate(text(state, "StartedAt")),
      restartCount: typeof restartCount === "number" ? restartCount : 0,
    };
  });
}

/** Null when the container does not exist. */
export async function inspectContainer(name: string): Promise<ContainerDetails | null> {
  return (await inspectContainers([name]))[0] ?? null;
}

// ─── lifecycle ──────────────────────────────────────────────────────────────

const STOP_GRACE_SECONDS = 10;

export async function startContainer(name: string): Promise<void> {
  await docker(["start", name]);
}

export async function stopContainer(name: string): Promise<void> {
  await docker(["stop", "-t", String(STOP_GRACE_SECONDS), name]);
}

/** Changes the restart policy of a running container (`docker update`). */
export async function setRestartPolicy(name: string, policy: DockerRestartPolicy): Promise<void> {
  await docker(["update", "--restart", policy, name]);
}

export async function restartContainer(name: string): Promise<void> {
  await docker(["restart", "-t", String(STOP_GRACE_SECONDS), name]);
}

/** Force-removes a container (named volumes are kept). Resolves with false when it did not exist. */
export async function removeContainer(name: string): Promise<boolean> {
  try {
    await docker(["rm", "-f", name]);
    return true;
  } catch (error) {
    if (isDockerError(error, "not_found")) return false;
    throw error;
  }
}

// ─── logs ───────────────────────────────────────────────────────────────────

export interface RawLogLine {
  stream: OutputStream;
  /** "<RFC 3339 timestamp> <message>" (docker logs --timestamps). */
  line: string;
}

/** Last `count` log lines, oldest first; empty when the container does not exist. */
export async function tailLogs(name: string, count: number): Promise<RawLogLine[]> {
  const lines: RawLogLine[] = [];
  try {
    await docker(["logs", "--tail", String(count), "--timestamps", name], {
      timeoutMs: 20_000,
      onLine: (stream, line) => lines.push({ stream, line }),
    });
  } catch (error) {
    if (isDockerError(error, "not_found")) return [];
    throw error;
  }
  return lines;
}

export interface LogFollower {
  stop(): void;
  /** Settles when `docker logs -f` ends (container stopped, removed, or stop()). Never rejects. */
  done: Promise<void>;
}

/** Follows the logs of a container from now on (`docker logs -f --tail 0 --timestamps`). */
export function followLogs(name: string, onLine: (line: RawLogLine) => void): LogFollower {
  const controller = new AbortController();
  const done = dockerRaw(["logs", "-f", "--tail", "0", "--timestamps", name], {
    // A follow has no time limit: it lives as long as its reader.
    timeoutMs: undefined,
    signal: controller.signal,
    maxOutputBytes: 64 * 1024,
    onLine: (stream, line) => onLine({ stream, line }),
  }).then(
    () => undefined,
    () => undefined,
  );
  return { stop: () => controller.abort(), done };
}

// ─── stats ──────────────────────────────────────────────────────────────────

export interface ContainerStats {
  name: string;
  /** Percent of one CPU. */
  cpuPercent: number;
  memoryMb: number;
  /** Cumulative since the container started. */
  netRxKb: number;
  netTxKb: number;
}

function firstOfPair(value: string, index: 0 | 1): string {
  return (value.split("/")[index] ?? "").trim();
}

/** One sample of every running container of the host (`docker stats --no-stream`). */
export async function readStats(): Promise<ContainerStats[]> {
  const result = await docker(["stats", "--no-stream", "--no-trunc", "--format", JSON_FORMAT], {
    timeoutMs: 30_000,
  });
  return parseJsonLines(result.stdout).map((record) => {
    const cpu = Number(text(record, "CPUPerc").replace("%", ""));
    const network = text(record, "NetIO");
    return {
      name: text(record, "Name"),
      cpuPercent: Number.isFinite(cpu) ? cpu : 0,
      memoryMb: parseSize(firstOfPair(text(record, "MemUsage"), 0)) / 1024 ** 2,
      netRxKb: parseSize(firstOfPair(network, 0)) / 1000,
      netTxKb: parseSize(firstOfPair(network, 1)) / 1000,
    };
  });
}

// ─── exec ───────────────────────────────────────────────────────────────────

/** Runs a command in a container and resolves with its outcome whatever the exit code. */
export function execInContainer(
  name: string,
  command: readonly string[],
  options: Pick<DockerOptions, "signal" | "timeoutMs" | "onLine"> = {},
): Promise<RunResult> {
  return dockerRaw(["exec", name, ...command], { timeoutMs: 30_000, ...options });
}

export interface ExecStreamOptions {
  /** The command's stdout goes to this file (created 0600, truncated). */
  stdoutFile?: string;
  /** The command's stdin comes from this file. */
  stdinFile?: string;
  timeoutMs?: number;
}

const FORWARDED_ENV = ["HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "XDG_RUNTIME_DIR"] as const;
const STDERR_LIMIT = 16 * 1024;

/**
 * `docker exec [-i] <name> <command…>` with stdin and/or stdout wired straight
 * to files. exec.ts decodes output as text, which would corrupt a binary dump:
 * here the child gets the file descriptors themselves. Still no shell.
 * Rejects with a DockerError unless the command exits with 0.
 */
export function execStream(name: string, command: readonly string[], options: ExecStreamOptions): Promise<void> {
  const args = ["exec", ...(options.stdinFile ? ["-i"] : []), name, ...command];
  return new Promise<void>((resolve, reject) => {
    let stdinFd: number | null = null;
    let stdoutFd: number | null = null;
    const closeFiles = (): void => {
      for (const fd of [stdinFd, stdoutFd]) {
        if (fd === null) continue;
        try {
          closeSync(fd);
        } catch {
          // Already closed.
        }
      }
      stdinFd = null;
      stdoutFd = null;
    };

    try {
      if (options.stdinFile) stdinFd = openSync(options.stdinFile, "r");
      if (options.stdoutFile) stdoutFd = openSync(options.stdoutFile, "w", 0o600);
    } catch (error) {
      closeFiles();
      reject(error instanceof Error ? error : new Error("could not open the file"));
      return;
    }

    const environment: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      LANG: "C.UTF-8",
    };
    for (const key of FORWARDED_ENV) {
      const value = process.env[key];
      if (value) environment[key] = value;
    }

    const processHandle = spawn(DOCKER, args, {
      // Next augments ProcessEnv with a required NODE_ENV, which a child's environment need not carry.
      env: environment as unknown as NodeJS.ProcessEnv,
      stdio: [stdinFd ?? "ignore", stdoutFd ?? "ignore", "pipe"],
    });
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      processHandle.kill("SIGKILL");
    }, options.timeoutMs ?? 30 * 60_000);

    processHandle.stderr?.setEncoding("utf8");
    processHandle.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_LIMIT);
    });
    processHandle.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeFiles();
      reject(unavailable(NOT_INSTALLED_MESSAGE));
    });
    processHandle.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeFiles();
      if (code === 0 && !timedOut) {
        resolve();
        return;
      }
      const failure = classifyFailure("exec", {
        code: code ?? -1,
        stdout: "",
        stderr,
        timedOut,
        aborted: false,
      });
      reject(failure);
    });
  });
}
