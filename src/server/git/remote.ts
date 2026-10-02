/**
 * Remote URL and environment of every git command the platform runs.
 *
 * The GitHub token never goes in a command line, a URL or .git/config: git
 * reads it from GIT_CONFIG_* environment variables as an HTTP header that only
 * applies to the remote host. Git never prompts and no credential helper runs.
 */

import { assertRepo } from "../services/validate";

const DEFAULT_BASE_URL = "https://github.com";

/**
 * Where repositories are fetched from. MINI_RAILWAY_GIT_BASE_URL replaces
 * https://github.com for tests: a `file:///some/dir` holding bare repositories
 * as `<owner>/<repo>.git` acts as a fake GitHub. Never set it in production.
 */
export function gitBaseUrl(): string {
  const override = process.env.MINI_RAILWAY_GIT_BASE_URL?.trim();
  return (override && override !== "" ? override : DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** Built only from a validated "owner/name": nothing else of the user reaches the URL. */
export function remoteUrl(repo: string): string {
  assertRepo(repo, "repo");
  return `${gitBaseUrl()}/${repo}.git`;
}

export interface GitCredentials {
  username: string;
  token: string;
}

export interface GitEnvironment {
  env: Record<string, string>;
  /** Values exec.ts masks in streamed lines and errors. */
  sensitive: string[];
}

export function buildGitEnvironment(credentials: GitCredentials | null): GitEnvironment {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/true",
    // The configuration of the machine or of the account running the platform must not change what git does.
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  if (credentials === null) return { env, sensitive: [] };

  const basic = Buffer.from(`${credentials.username}:${credentials.token}`, "utf8").toString("base64");
  env.GIT_CONFIG_COUNT = "1";
  // Scoped to the remote host: a redirect to another host does not receive the header.
  env.GIT_CONFIG_KEY_0 = `http.${gitBaseUrl()}/.extraheader`;
  env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
  return { env, sensitive: [credentials.token, basic] };
}

/** Options placed before the git subcommand: nothing from the repository or the host is executed. */
export const GIT_BASE_ARGS: readonly string[] = [
  "-c", "credential.helper=",
  "-c", "core.hooksPath=/dev/null",
  "-c", "advice.detachedHead=false",
  "-c", "gc.autoDetach=false",
];
