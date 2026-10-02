/**
 * The git CLI, for the deployment pipeline (local clone of a service) and the
 * sync loop (tip of a branch). Every command goes through run(): no shell, and
 * the arguments are validated values (repository, branch, sha, generated ids).
 */

import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { ApiError } from "@/lib/api/contract";
import type { DeploymentCommit } from "@/lib/types";

import { forbidden, unavailable, validation } from "../errors";
import { ExecError, run, type RunResult } from "../exec";
import { getGitCredentials } from "../github/auth";
import { repoDirectoryFor } from "../services/names";
import { assertBranch } from "../services/validate";
import { buildGitEnvironment, GIT_BASE_ARGS, remoteUrl, type GitEnvironment } from "./remote";

export const TRANSFER_TIMEOUT_MS = 5 * 60_000;
export const LS_REMOTE_TIMEOUT_MS = 20_000;
const LOCAL_TIMEOUT_MS = 60_000;

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const STDERR_TAIL_CHARS = 600;
/** Left behind by a git process killed in the middle of a write. */
const LOCK_FILES = ["index.lock", "shallow.lock", "HEAD.lock", "config.lock"];

export type GitFailure = "exit" | "timeout" | "aborted";

/** A git command that did not succeed. `message` is English, masked, and for logs only. */
export class GitError extends Error {
  constructor(
    readonly kind: GitFailure,
    readonly action: string,
    readonly stderrTail: string,
  ) {
    super(
      kind === "timeout"
        ? `git ${action} timed out`
        : kind === "aborted"
          ? `git ${action} was aborted`
          : `git ${action} failed${stderrTail ? `: ${stderrTail}` : ""}`,
    );
    this.name = "GitError";
  }
}

interface GitOptions {
  auth: GitEnvironment;
  timeoutMs: number;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}

function mask(text: string, sensitive: readonly string[]): string {
  return sensitive.reduce((current, secret) => current.split(secret).join("***"), text);
}

async function git(args: readonly string[], options: GitOptions): Promise<RunResult> {
  const action = args[0] ?? "";
  let result: RunResult;
  try {
    result = await run("git", [...GIT_BASE_ARGS, ...args], {
      env: options.auth.env,
      sensitive: options.auth.sensitive,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onLine: options.onLine ? (_stream, line) => options.onLine?.(line) : undefined,
    });
  } catch (error) {
    if (error instanceof ExecError) throw unavailable("git n’est pas installé sur ce serveur.");
    throw error;
  }
  if (result.code === 0 && !result.timedOut && !result.aborted) return result;
  const tail = mask(result.stderr, options.auth.sensitive).trim().slice(-STDERR_TAIL_CHARS);
  throw new GitError(result.aborted ? "aborted" : result.timedOut ? "timeout" : "exit", action, tail);
}

const BRANCH_MISSING = /remote branch .* not found|couldn't find remote ref|no such ref/i;
const COMMIT_MISSING = /not our ref|unadvertised object|bad object|no such remote ref|reference is not a tree|upload-pack: not our/i;
const ACCESS_DENIED =
  /authentication failed|could not read username|could not read password|terminal prompts disabled|repository not found|returned error: 40[134]|access denied|does not appear to be a git repository|does not exist/i;

/** The French error shown to the user for a failed transfer; an aborted command is passed through. */
function explain(error: unknown, repo: string, branch: string): unknown {
  if (!(error instanceof GitError) || error.kind === "aborted") return error;
  if (error.kind === "timeout") {
    return unavailable(`La récupération du dépôt ${repo} a dépassé le délai autorisé.`);
  }
  if (BRANCH_MISSING.test(error.stderrTail)) {
    return validation(`La branche « ${branch} » n’existe pas dans le dépôt ${repo}.`, "branch");
  }
  if (ACCESS_DENIED.test(error.stderrTail)) {
    return forbidden(
      `Le dépôt ${repo} est privé ou introuvable. Connectez GitHub avec un jeton d’accès qui peut le lire.`,
    );
  }
  return unavailable(`La récupération du dépôt ${repo} a échoué. Consultez les logs du déploiement.`);
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Arguments that pin a command to one clone: git never walks up to another repository. */
function inClone(directory: string): string[] {
  return [`--git-dir=${path.join(directory, ".git")}`, `--work-tree=${directory}`];
}

async function isUsableClone(directory: string, url: string, auth: GitEnvironment): Promise<boolean> {
  const gitDirectory = path.join(directory, ".git");
  if (!(await exists(path.join(gitDirectory, "HEAD")))) return false;
  for (const lock of LOCK_FILES) {
    if (await exists(path.join(gitDirectory, lock))) return false;
  }
  try {
    const origin = await run("git", [...GIT_BASE_ARGS, ...inClone(directory), "config", "--get", "remote.origin.url"], {
      env: auth.env,
      timeoutMs: LOCAL_TIMEOUT_MS,
    });
    // A service pointed at another repository gets a new clone.
    return origin.code === 0 && origin.stdout.trim() === url;
  } catch {
    return false;
  }
}

export interface SyncRepositoryInput {
  serviceId: string;
  /** "owner/name" */
  repo: string;
  branch: string;
  /** Full sha to check out; the tip of `branch` when omitted. */
  commit?: string;
  signal?: AbortSignal;
  /** Output of git (English, token masked), for the build log. */
  onLine?: (line: string) => void;
}

export interface SyncedRepository {
  directory: string;
  commit: DeploymentCommit;
}

/**
 * Brings the local clone of a service to the requested commit (or the tip of
 * the branch) with a pristine working tree. Rejects with a French ApiError, or
 * with a GitError of kind "aborted" when `signal` fired.
 */
export async function syncRepository(input: SyncRepositoryInput): Promise<SyncedRepository> {
  const { repo, branch, signal, onLine } = input;
  assertBranch(branch, "branch");
  if (input.commit !== undefined && !SHA_PATTERN.test(input.commit)) {
    throw validation("L’identifiant du commit à déployer n’est pas valide.", "commit");
  }
  const url = remoteUrl(repo);
  const directory = repoDirectoryFor(input.serviceId);
  const auth = buildGitEnvironment(await getGitCredentials());
  const transfer: GitOptions = { auth, timeoutMs: TRANSFER_TIMEOUT_MS, signal, onLine };
  const local: GitOptions = { auth, timeoutMs: LOCAL_TIMEOUT_MS, signal };
  const scoped = inClone(directory);
  const trackingRef = `refs/remotes/origin/${branch}`;

  const clone = async (): Promise<void> => {
    await rm(directory, { recursive: true, force: true });
    await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
    onLine?.(`Cloning ${repo} (branch ${branch}, shallow)`);
    await git(["clone", "--depth", "1", "--single-branch", "--no-tags", "--branch", branch, "--", url, directory], transfer);
  };
  const fetch = async (): Promise<void> => {
    onLine?.(`Fetching ${repo} (branch ${branch})`);
    await git([...scoped, "fetch", "--depth", "1", "--no-tags", "--force", "origin", `+refs/heads/${branch}:${trackingRef}`], transfer);
  };
  const checkout = async (): Promise<string> => {
    let target = trackingRef;
    if (input.commit !== undefined) {
      target = input.commit;
      const known = await run("git", [...GIT_BASE_ARGS, ...scoped, "cat-file", "-e", `${target}^{commit}`], {
        env: auth.env,
        timeoutMs: LOCAL_TIMEOUT_MS,
        signal,
      });
      if (known.code !== 0) {
        // Not in the shallow history: GitHub serves any reachable commit by its sha.
        onLine?.(`Fetching commit ${target.slice(0, 7)}`);
        await git([...scoped, "fetch", "--depth", "1", "--no-tags", "origin", target], transfer);
      }
    }
    const resolved = (await git([...scoped, "rev-parse", "--verify", `${target}^{commit}`], local)).stdout.trim();
    await git([...scoped, "checkout", "--force", "--detach", resolved], local);
    await git([...scoped, "reset", "--hard", resolved], local);
    // Twice -f: also removes nested repositories; -x: ignored files of a previous build too.
    await git([...scoped, "clean", "-ffdx"], local);
    return resolved;
  };

  let sha: string;
  try {
    const reusable = await isUsableClone(directory, url, auth);
    if (reusable) {
      try {
        await fetch();
        sha = await checkout();
      } catch (error) {
        if (!(error instanceof GitError) || error.kind !== "exit") throw error;
        if (input.commit !== undefined && COMMIT_MISSING.test(error.stderrTail)) throw error;
        // Whatever went wrong locally (interrupted run, damaged objects), a new clone settles it.
        onLine?.("The local clone is not usable, cloning again");
        await clone();
        sha = await checkout();
      }
    } else {
      await clone();
      sha = await checkout();
    }
  } catch (error) {
    if (error instanceof GitError && error.kind === "exit") {
      onLine?.(error.message);
      if (input.commit !== undefined && COMMIT_MISSING.test(error.stderrTail)) {
        throw validation(`Le commit ${input.commit.slice(0, 7)} est introuvable dans le dépôt ${repo}.`, "commit");
      }
    }
    throw explain(error, repo, branch);
  }

  const described = await git([...scoped, "log", "-1", "--format=%H%x1f%s%x1f%an", sha], local).catch((error: unknown) => {
    throw explain(error, repo, branch);
  });
  const [, message = "", author = ""] = described.stdout.trim().split("\x1f");
  return { directory, commit: { sha, message, author, branch } };
}

/**
 * Sha of the tip of `branch` on the remote, null when the branch does not
 * exist. Uses the stored GitHub token when there is one, and works without for
 * public repositories. Rejects with a French ApiError: "forbidden" when the
 * repository is private or missing, "unavailable" otherwise.
 */
export async function resolveBranchTip(
  repo: string,
  branch: string,
  options: { signal?: AbortSignal } = {},
): Promise<string | null> {
  assertBranch(branch, "branch");
  const url = remoteUrl(repo);
  const auth = buildGitEnvironment(await getGitCredentials());
  const ref = `refs/heads/${branch}`;
  let result: RunResult;
  try {
    result = await git(["ls-remote", "--heads", "--", url, ref], {
      auth,
      timeoutMs: LS_REMOTE_TIMEOUT_MS,
      signal: options.signal,
    });
  } catch (error) {
    const explained = explain(error, repo, branch);
    if (explained instanceof ApiError && explained.code === "unavailable" && error instanceof GitError) {
      throw unavailable(
        error.kind === "timeout"
          ? `GitHub n’a pas répondu à temps pour le dépôt ${repo}.`
          : `Le dépôt ${repo} n’a pas pu être consulté.`,
      );
    }
    throw explained;
  }
  for (const line of result.stdout.split("\n")) {
    const [sha, name] = line.trim().split(/\s+/);
    if (sha !== undefined && name === ref && SHA_PATTERN.test(sha)) return sha;
  }
  return null;
}
