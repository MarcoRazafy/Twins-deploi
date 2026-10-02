/**
 * Image step of a GitHub service: clone or fetch the repository, pick its
 * Dockerfile or generate one, then `docker build`. Everything is logged in the
 * build stream like a build tool would.
 *
 * Rollbacks: the pipeline reuses the image of the restored version when it is
 * still present and does not call this module at all. When that image was
 * pruned, the commit of the restored version is rebuilt here under the tag of
 * the new deployment.
 */

import { lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Deployment, Service } from "@/generated/prisma/client";
import type { DeploymentCommit, LogLevel } from "@/lib/types";

import { generateDockerfile } from "../../builder/dockerfile";
import { detectProject } from "../../builder/detect";
import { db } from "../../db";
import { imageReferenceFor } from "../../deployments/enqueue";
import { docker, DockerError, LABEL_DEPLOYMENT, LABEL_MANAGED, LABEL_SERVICE } from "../../docker/cli";
import { env } from "../../env";
import { unavailable, validation } from "../../errors";
import { emit } from "../../events";
import { syncRepository } from "../../git/repository";
import { normalizeRootDirectory } from "../../services/validate";
import { resolveEnvironment, variableValue } from "../../variables/store";

export interface ImageBuildContext {
  deployment: Deployment;
  service: Service;
  /** Appends a line to the build log (English, tool-like; never a secret). */
  log: (level: LogLevel, message: string) => void;
  /** Aborted on cancellation, worker shutdown or when the deployment row vanished: kill running commands. */
  signal: AbortSignal;
  /** Budget of the whole build (settings.deployments.buildTimeoutMin). */
  timeoutMs: number;
}

export interface ImageBuildResult {
  /** Reference of the image to run, normally imageReferenceFor(service, deployment.id). */
  image: string;
  /** The commit that was built; written to the deployment row by the pipeline. */
  commit: DeploymentCommit | null;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const BUILD_ARG_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Would break the build tools themselves when overridden. */
const RESERVED_BUILD_ARGS = new Set(["PATH", "HOME", "USER", "SHELL", "PWD", "HOSTNAME"]);
const MIN_BUILD_MS = 10_000;

/** Directory of the files generated for one build, outside the clone: <data dir>/builds/<deploymentId>. */
export function buildDirectoryFor(deploymentId: string): string {
  return path.join(env.dataDir, "builds", deploymentId);
}

/**
 * The directory handed to docker build: <clone>/<rootDirectory>, which must
 * still be inside the clone once symbolic links are resolved (a repository
 * could link a directory to anywhere on the host).
 */
async function resolveContextDirectory(clone: string, rootDirectory: string): Promise<string> {
  const normalized = normalizeRootDirectory(rootDirectory, "source.rootDirectory");
  const missing = validation(
    `Le répertoire racine « ${normalized} » n’existe pas dans le dépôt.`,
    "source.rootDirectory",
  );
  let root: string;
  let target: string;
  try {
    root = await realpath(clone);
    target = await realpath(path.join(clone, normalized));
  } catch {
    throw missing;
  }
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw missing;
  if (target === path.join(root, ".git") || target.startsWith(`${path.join(root, ".git")}${path.sep}`)) throw missing;
  if (!(await lstat(target)).isDirectory()) throw missing;
  return target;
}

/**
 * Build arguments: the NON-secret variables only. A build argument stays
 * readable in the image history (`docker history`), so secrets are injected at
 * runtime only (env file of the container). A non-secret variable that
 * references another one is left out as well: the reference may resolve to a
 * secret.
 */
async function nonSecretBuildArguments(service: Service): Promise<Record<string, string>> {
  const resolved = await resolveEnvironment(service.id);
  const rows = await db().envVariable.findMany({
    where: { projectId: service.projectId, OR: [{ serviceId: service.id }, { serviceId: null }] },
  });
  // The service's own variable wins over the shared one of the same key.
  const effective = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const current = effective.get(row.key);
    if (!current || (current.serviceId === null && row.serviceId !== null)) effective.set(row.key, row);
  }
  const result: Record<string, string> = {};
  for (const [key, row] of effective) {
    if (row.isSecret || !BUILD_ARG_NAME.test(key) || RESERVED_BUILD_ARGS.has(key)) continue;
    if (variableValue(row).includes("${{")) continue;
    const value = resolved.variables[key];
    if (value === undefined || /[\r\n\0]/.test(value)) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Builds the image of a GitHub service. Rejects with an ApiError (French
 * message) to fail the deployment with that message; a rejection caused by
 * `signal` is turned into a cancellation or an interruption by the pipeline.
 */
export async function prepareGithubImage(context: ImageBuildContext): Promise<ImageBuildResult> {
  const { deployment, service, log, signal } = context;
  const startedAt = Date.now();
  const { repo, branch } = service;
  if (repo === null || branch === null) {
    throw validation("Ce service n’a pas de dépôt GitHub configuré.", "source.repo");
  }
  const pinned = deployment.commitSha !== null && SHA_PATTERN.test(deployment.commitSha) ? deployment.commitSha : undefined;

  log("info", pinned ? `Source: ${repo} at commit ${pinned.slice(0, 7)}` : `Source: ${repo}, tip of branch ${branch}`);
  const synced = await syncRepository({
    serviceId: service.id,
    repo,
    branch,
    commit: pinned,
    signal,
    onLine: (line) => log("info", line),
  });
  const { commit } = synced;
  log("info", `Checked out ${commit.sha.slice(0, 7)} "${commit.message}"${commit.author ? ` by ${commit.author}` : ""}`);

  // The message and author are only known once the commit is fetched: saved now, so
  // that they show during the build and stay on a deployment whose build fails.
  await db().deployment.updateMany({
    where: { id: deployment.id },
    data: {
      commitSha: commit.sha,
      commitMessage: commit.message,
      commitAuthor: commit.author,
      commitBranch: commit.branch,
    },
  });
  await emit(["deployments"], {
    projectId: service.projectId,
    serviceId: service.id,
    deploymentId: deployment.id,
  });

  // Recorded before the build: a commit that fails to build must not be queued again by the sync loop.
  // A rollback keeps the value, otherwise the loop would redeploy the branch tip right after it.
  if (deployment.trigger !== "rollback") {
    await db().service.updateMany({ where: { id: service.id }, data: { lastCommitSha: commit.sha } });
  }

  const contextDirectory = await resolveContextDirectory(synced.directory, service.rootDirectory);
  const rootDirectory = normalizeRootDirectory(service.rootDirectory);
  if (rootDirectory !== "/") log("info", `Build directory: ${rootDirectory}`);

  const plan = await detectProject(contextDirectory, rootDirectory);
  for (const reason of plan.reasons) log("info", reason);

  const buildArguments = await nonSecretBuildArguments(service);
  const argumentNames = Object.keys(buildArguments).sort();
  const image = imageReferenceFor(service, deployment.id);
  const buildDirectory = buildDirectoryFor(deployment.id);
  let dockerfile = path.join(contextDirectory, "Dockerfile");

  try {
    if (plan.kind === "dockerfile") {
      log("info", "Builder: Dockerfile of the repository");
    } else {
      if (service.builder === "dockerfile") {
        log("error", "The service is configured to build with a Dockerfile, but the repository has none");
        throw validation(
          `Le service est configuré pour construire avec un Dockerfile, mais le répertoire « ${rootDirectory} » du dépôt n’en contient pas. Ajoutez un Dockerfile ou choisissez la détection automatique.`,
          "config.builder",
        );
      }
      const generated = generateDockerfile(plan, {
        port: service.port,
        buildCommand: service.buildCommand,
        startCommand: service.startCommand,
        buildArgs: argumentNames,
      });
      await mkdir(buildDirectory, { recursive: true, mode: 0o700 });
      dockerfile = path.join(buildDirectory, "Dockerfile");
      await writeFile(dockerfile, generated.dockerfile, { mode: 0o600 });
      // BuildKit prefers "<Dockerfile name>.dockerignore" next to the Dockerfile: nothing is written in the clone.
      if (!plan.hasDockerignore) {
        await writeFile(`${dockerfile}.dockerignore`, generated.dockerignore, { mode: 0o600 });
      }
      log("info", `Builder: generated Dockerfile (${generated.description})`);
      for (const line of generated.dockerfile.split("\n")) {
        if (line.trim() !== "") log("info", `  | ${line}`);
      }
    }
    log(
      "info",
      argumentNames.length > 0
        ? `Build arguments: ${argumentNames.join(", ")} (secret variables are only available at runtime)`
        : "Build arguments: none (secret variables are only available at runtime)",
    );

    const args = [
      "build",
      "--progress=plain",
      "-f", dockerfile,
      "-t", image,
      "--label", `${LABEL_MANAGED}=true`,
      "--label", `${LABEL_SERVICE}=${service.id}`,
      "--label", `${LABEL_DEPLOYMENT}=${deployment.id}`,
      ...argumentNames.flatMap((name) => ["--build-arg", `${name}=${buildArguments[name]}`]),
      contextDirectory,
    ];
    log("info", `Running docker build -t ${image}`);
    const remainingMs = Math.max(MIN_BUILD_MS, context.timeoutMs - (Date.now() - startedAt));
    try {
      await docker(args, {
        action: "build",
        timeoutMs: remainingMs,
        signal,
        // Only the end of the output is kept in memory: every line already went to the log.
        maxOutputBytes: 256 * 1024,
        onLine: (_stream, line) => log("info", line),
      });
    } catch (error) {
      if (!(error instanceof DockerError) || error.kind === "aborted") throw error;
      if (error.kind === "timeout") {
        log("error", `docker build exceeded the build timeout (${Math.round(context.timeoutMs / 60_000)} min)`);
        throw unavailable(
          `La construction de l’image a dépassé le délai autorisé (${Math.round(context.timeoutMs / 60_000)} min).`,
        );
      }
      log("error", `docker build failed (exit code ${error.code})`);
      throw validation("La construction de l’image a échoué. Consultez les logs de build du déploiement.");
    }
    log("success", `Image ${image} built from commit ${commit.sha.slice(0, 7)}`);
    return { image, commit };
  } finally {
    await rm(buildDirectory, { recursive: true, force: true }).catch(() => {});
  }
}
