/**
 * Helpers of the pipeline suite: a signed-in API, deployments run in-process
 * (claimNextDeployment + runDeployment, as the worker does), and read-only
 * Docker probes through the CLI so the assertions do not depend on the code
 * under test.
 *
 * Isolation from the production worker running on the same machine: every
 * project is named "pipetest-…" (container names mr-pipetest-…), the Docker
 * objects are only ever looked up and removed through the labels carrying the
 * ids of the projects / services created by the test file (DockerJanitor),
 * never by name pattern or globally.
 */

import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import net from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";

import type { Api, DeployImageInput } from "@/lib/api/contract";
import type { Deployment as DeploymentRow, Service as ServiceRow } from "@/generated/prisma/client";
import type { Project, Service } from "@/lib/types";
import { createServerApi } from "@/server/api";
import { anonymousContext, systemContext } from "@/server/context";
import { db } from "@/server/db";
import { claimNextDeployment, runDeployment } from "@/server/deploy/pipeline";
import { LABEL_DEPLOYMENT, LABEL_MANAGED, LABEL_PROJECT, LABEL_SERVICE } from "@/server/docker";
import { JobRetry, runJob } from "@/server/jobs/handlers";
import { claimNextJob, completeJob, failJob, type JobType } from "@/server/jobs/queue";

import { resetDatabase } from "../helpers/db";

export const WORKER_ID = "pipetest-worker";

/** Small public images; both listen on 80. */
export const WHOAMI = { image: "traefik/whoami", tag: "latest", port: 80 } as const;
export const NGINX = { image: "nginx", tag: "alpine", port: 80 } as const;
export const MISSING_IMAGE = { image: "twinsdeploi-test/does-not-exist", tag: "1" } as const;

const GENERATED_ID = /^[a-z]{2,4}_[a-z0-9]{6,40}$/;

// ─── API ────────────────────────────────────────────────────────────────────

/** Empties the test database and resolves with the API of a fresh owner. */
export async function ownerApi(): Promise<Api> {
  await resetDatabase();
  const session = await createServerApi(anonymousContext()).auth.setup({
    name: "Pipeline Owner",
    email: "pipeline@example.test",
    password: "Motdepasse-solide-42",
  });
  if (!session.user) throw new Error("auth.setup returned no user");
  return createServerApi(systemContext(session.user));
}

// ─── Docker CLI (read-only probes + cleanup by label) ───────────────────────

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function dockerCli(args: readonly string[], timeoutMs = 60_000): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile("docker", [...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function dockerOk(args: readonly string[]): Promise<string> {
  const result = await dockerCli(args);
  if (result.code !== 0) throw new Error(`docker ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function lines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}

export interface InspectedContainer {
  Id: string;
  Name: string;
  State: { Status: string; Running: boolean; ExitCode: number };
  Config: { Env: string[] | null; Labels: Record<string, string> | null; Image: string };
  HostConfig: {
    Privileged: boolean;
    Memory: number;
    NanoCpus: number;
    PidsLimit: number | null;
    SecurityOpt: string[] | null;
    CapDrop: string[] | null;
    CapAdd: string[] | null;
    RestartPolicy: { Name: string };
    NetworkMode: string;
    PortBindings: Record<string, Array<{ HostIp: string; HostPort: string }> | null> | null;
    Binds: string[] | null;
  };
  Mounts: Array<{ Type: string; Name?: string; Source: string; Destination: string }>;
  NetworkSettings: {
    Networks: Record<string, { Aliases: string[] | null; DNSNames?: string[] | null }>;
  };
}

/** `docker container inspect`, null when the container does not exist. */
export async function inspect(name: string): Promise<InspectedContainer | null> {
  const result = await dockerCli(["container", "inspect", name]);
  if (result.code !== 0) return null;
  const parsed = JSON.parse(result.stdout) as InspectedContainer[];
  return parsed[0] ?? null;
}

/** Environment of a container as Docker recorded it. */
export function envOf(container: InspectedContainer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of container.Config.Env ?? []) {
    const separator = entry.indexOf("=");
    if (separator > 0) out[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return out;
}

export interface LabelledContainer {
  name: string;
  state: string;
}

type LabelKind = "project" | "service" | "deployment";

const LABEL_KEYS: Record<LabelKind, string> = {
  project: LABEL_PROJECT,
  service: LABEL_SERVICE,
  deployment: LABEL_DEPLOYMENT,
};

function labelFilter(kind: LabelKind, id: string): string {
  if (!GENERATED_ID.test(id)) throw new Error(`refusing to filter Docker objects on a non-generated id: ${id}`);
  return `label=${LABEL_KEYS[kind]}=${id}`;
}

/** Containers (running or not) carrying the label of this project / service / deployment. */
export async function containersLabelled(kind: LabelKind, id: string): Promise<LabelledContainer[]> {
  const stdout = await dockerOk(["ps", "-a", "--filter", labelFilter(kind, id), "--format", "{{.Names}}\t{{.State}}"]);
  return lines(stdout).map((line) => {
    const [name, state = ""] = line.split("\t");
    return { name, state };
  });
}

export async function networksLabelled(projectId: string): Promise<string[]> {
  return lines(await dockerOk(["network", "ls", "--filter", labelFilter("project", projectId), "--format", "{{.Name}}"]));
}

export async function volumesLabelled(serviceId: string): Promise<string[]> {
  return lines(await dockerOk(["volume", "ls", "--filter", labelFilter("service", serviceId), "--format", "{{.Name}}"]));
}

export async function networkExists(name: string): Promise<boolean> {
  return (await dockerCli(["network", "inspect", name])).code === 0;
}

/**
 * Runs a one-off container on the project network (labelled with the project
 * so the janitor removes it if anything goes wrong) and resolves with its output.
 */
export async function runOnProjectNetwork(projectId: string, command: readonly string[]): Promise<CliResult> {
  return dockerCli(
    [
      "run", "--rm",
      "--network", `mr-${projectId}`,
      "--label", `${LABEL_PROJECT}=${projectId}`,
      "--memory", "64m",
      "--pull", "never",
      `${NGINX.image}:${NGINX.tag}`,
      ...command,
    ],
    60_000,
  );
}

/**
 * Remembers the projects and services a test file created and removes every
 * container, volume and network carrying their labels. Never looks at
 * anything else.
 */
export class DockerJanitor {
  private readonly projects = new Set<string>();
  private readonly services = new Set<string>();

  trackProject(id: string): void {
    this.projects.add(id);
  }

  trackService(id: string): void {
    this.services.add(id);
  }

  async sweep(): Promise<void> {
    const problems: string[] = [];
    const attempt = async (args: readonly string[]): Promise<void> => {
      const result = await dockerCli(args);
      if (result.code !== 0 && !/no such/i.test(result.stderr)) problems.push(`docker ${args.join(" ")}: ${result.stderr.trim()}`);
    };
    const containers = new Set<string>();
    for (const id of this.projects) for (const c of await containersLabelled("project", id)) containers.add(c.name);
    for (const id of this.services) for (const c of await containersLabelled("service", id)) containers.add(c.name);
    for (const name of containers) await attempt(["rm", "-f", name]);
    for (const id of this.services) for (const volume of await volumesLabelled(id)) await attempt(["volume", "rm", "-f", volume]);
    for (const id of this.projects) for (const network of await networksLabelled(id)) await attempt(["network", "rm", network]);
    if (problems.length > 0) throw new Error(`cleanup incomplete:\n${problems.join("\n")}`);
  }
}

/** Removes the temporary data directory setup-env.ts created for this file. */
export async function removeDataDir(): Promise<void> {
  const dir = process.env.MINI_RAILWAY_DATA_DIR;
  if (!dir) return;
  const resolved = path.resolve(dir);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("twinsdeploi-test-")) return;
  await rm(resolved, { recursive: true, force: true });
}

// ─── fixtures ───────────────────────────────────────────────────────────────

export async function createProject(api: Api, janitor: DockerJanitor, name: string): Promise<Project> {
  if (!name.startsWith("pipetest")) throw new Error("pipeline test projects must be named pipetest-…");
  const project = await api.projects.create({ name });
  janitor.trackProject(project.id);
  return project;
}

/** docker.deployImage: creates the service and queues its first deployment. */
export async function createImageService(
  api: Api,
  janitor: DockerJanitor,
  input: DeployImageInput,
): Promise<{ service: Service; deploymentId: string }> {
  const service = await api.docker.deployImage(input);
  janitor.trackService(service.id);
  if (service.latestDeploymentId === null) throw new Error("deployImage queued no deployment");
  return { service, deploymentId: service.latestDeploymentId };
}

// ─── running deployments ────────────────────────────────────────────────────

/**
 * Claims the next queued deployment as the worker does (it must be
 * `expectedId`) and starts its run without waiting for it: `done` settles
 * when the run ends. (Wrapped in an object: an async function returning the
 * promise itself would wait for it.)
 */
export async function startDeployment(
  expectedId: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<{ done: Promise<void> }> {
  const claimed = await claimNextDeployment(WORKER_ID);
  if (claimed !== expectedId) throw new Error(`claimed ${String(claimed)} instead of ${expectedId}`);
  return { done: runDeployment(claimed, { signal, workerId: WORKER_ID }) };
}

/**
 * Runs `body` while `expectedId` runs in the background (shutdown = the
 * worker's signal). Whatever `body` does, the run is then aborted and awaited,
 * so a failed assertion never leaves a deployment running into the next test.
 */
export async function whileDeploying(
  expectedId: string,
  body: (run: { shutdown: AbortController; done: Promise<void> }) => Promise<void>,
): Promise<void> {
  const shutdown = new AbortController();
  const { done } = await startDeployment(expectedId, shutdown.signal);
  try {
    await body({ shutdown, done });
  } finally {
    shutdown.abort();
    await done;
  }
}

/** Claims and runs `expectedId` to its end; resolves with the final row. */
export async function deployNow(expectedId: string, signal?: AbortSignal): Promise<DeploymentRow> {
  await (await startDeployment(expectedId, signal)).done;
  return deploymentRow(expectedId);
}

export function deploymentRow(id: string): Promise<DeploymentRow> {
  return db().deployment.findUniqueOrThrow({ where: { id } });
}

export function serviceRow(id: string): Promise<ServiceRow> {
  return db().service.findUniqueOrThrow({ where: { id } });
}

/** Polls `check` every 200 ms until it resolves truthy; rejects after `timeoutMs`. */
export async function waitFor<T>(what: string, check: () => Promise<T | null | undefined | false>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Resolves once a container of this deployment exists and runs; with its name. */
export function waitForRunningContainer(deploymentId: string, timeoutMs = 90_000): Promise<string> {
  return waitFor(
    `a running container of ${deploymentId}`,
    async () => (await containersLabelled("deployment", deploymentId)).find((c) => c.state === "running")?.name,
    timeoutMs,
  );
}

// ─── jobs ───────────────────────────────────────────────────────────────────

export interface JobOutcome {
  id: string;
  type: JobType;
  /** Null when the job completed; the handler's error otherwise (JobRetry = rescheduled). */
  error: unknown;
}

/** Runs every due job the way the worker's job loop does; resolves with what ran. */
export async function runDueJobs(): Promise<JobOutcome[]> {
  const ran: JobOutcome[] = [];
  for (;;) {
    const job = await claimNextJob(WORKER_ID);
    if (!job) return ran;
    try {
      await runJob(job);
      await completeJob(job.id);
      ran.push({ id: job.id, type: job.type, error: null });
    } catch (error) {
      if (error instanceof JobRetry) await failJob(job.id, error.message, { retryAfterMs: error.retryAfterMs });
      else await failJob(job.id, error instanceof Error ? error.message : String(error));
      ran.push({ id: job.id, type: job.type, error });
    }
  }
}

// ─── network probes ─────────────────────────────────────────────────────────

export async function httpGet(port: number, pathname = "/", host = "127.0.0.1"): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://${host}:${port}${pathname}`, { signal: AbortSignal.timeout(5_000) });
  return { status: response.status, body: await response.text() };
}

/** True when a TCP connection to host:port is accepted and stays open a moment. */
export function tcpAccepts(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2_000, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => {
      socket.once("close", () => finish(false));
      setTimeout(() => finish(true), 200);
    });
  });
}

/** A non-loopback IPv4 address of this machine, null when there is none. */
export function externalIPv4(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

export { LABEL_DEPLOYMENT, LABEL_MANAGED, LABEL_PROJECT, LABEL_SERVICE };
