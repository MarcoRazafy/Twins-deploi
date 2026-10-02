/**
 * Process execution for the whole server (docker, git, the sudo helpers).
 *
 * There is NO shell: the command and every argument go to execve as they are
 * (`spawn` with an argument array), so a value can never be read as syntax.
 * Arguments must still come from validated values, and secrets never go in
 * argv: use the environment (`env`) or `stdin`.
 *
 * Nothing here logs. `sensitive` lists secret values that must not show up in
 * anything this module hands back (streamed lines, error messages).
 */

import { spawn, type ChildProcess } from "node:child_process";

export type OutputStream = "stdout" | "stderr";

export interface RunOptions {
  /** Merged over the minimal environment below, never over the platform's own. */
  env?: Readonly<Record<string, string>>;
  cwd?: string;
  /** SIGTERM after this delay, SIGKILL 5 s later. No limit when omitted. */
  timeoutMs?: number;
  /** Written to the child's stdin, which is then closed. */
  stdin?: string;
  /** Called for every non-empty output line, in arrival order per stream. */
  onLine?: (stream: OutputStream, line: string) => void;
  /** Secret values replaced by "***" in streamed lines and error messages (4 characters at least). */
  sensitive?: readonly string[];
  /** Cap of the captured output per stream; the end is kept. Default 4 MiB. */
  maxOutputBytes?: number;
  /** Aborting kills the process; the result has `aborted: true`. */
  signal?: AbortSignal;
}

export interface RunResult {
  /** Exit code; -1 when the process was killed (timeout, abort) or ended by a signal. */
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

export type ExecFailure = "spawn" | "exit" | "timeout" | "aborted";

/** Failure of `runChecked` (or of `run` when the process could not even start). */
export class ExecError extends Error {
  readonly reason: ExecFailure;
  /** Executable name only, never its arguments. */
  readonly command: string;
  readonly code: number | null;
  /** Last lines of stderr, masked, for diagnostics (not user-facing). */
  readonly stderrTail: string;

  constructor(input: {
    reason: ExecFailure;
    command: string;
    subcommand?: string;
    code: number | null;
    stderrTail: string;
    detail?: string;
  }) {
    const label = [input.command, input.subcommand].filter((part) => part).join(" ");
    const summary =
      input.reason === "spawn"
        ? `${label} could not be started${input.detail ? ` (${input.detail})` : ""}`
        : input.reason === "timeout"
          ? `${label} timed out`
          : input.reason === "aborted"
            ? `${label} was aborted`
            : `${label} exited with code ${input.code ?? -1}`;
    super(input.stderrTail ? `${summary}: ${input.stderrTail}` : summary);
    this.name = "ExecError";
    this.reason = input.reason;
    this.command = input.command;
    this.code = input.code;
    this.stderrTail = input.stderrTail;
  }
}

const DEFAULT_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
/** Nothing else of the platform's environment (database URL, secret key…) reaches a child. */
const FORWARDED_ENV = [
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "DOCKER_HOST",
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "XDG_RUNTIME_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;
const KILL_GRACE_MS = 5_000;
const DEFAULT_MAX_OUTPUT = 4 * 1024 * 1024;
/** A "line" that never ends is flushed after this many characters. */
const MAX_LINE_LENGTH = 32 * 1024;
const MIN_SENSITIVE_LENGTH = 4;
const STDERR_TAIL_CHARS = 600;

function baseEnvironment(): Record<string, string> {
  const result: Record<string, string> = { PATH: process.env.PATH ?? DEFAULT_PATH, LANG: "C.UTF-8" };
  for (const name of FORWARDED_ENV) {
    const value = process.env[name];
    if (value !== undefined && value !== "") result[name] = value;
  }
  return result;
}

function masker(sensitive: readonly string[] | undefined): (text: string) => string {
  const secrets = (sensitive ?? []).filter((value) => value.length >= MIN_SENSITIVE_LENGTH);
  if (secrets.length === 0) return (text) => text;
  return (text) => secrets.reduce((current, secret) => current.split(secret).join("***"), text);
}

function createLineSplitter(emit: (line: string) => void) {
  let pending = "";
  const emitLine = (line: string): void => {
    if (line !== "") emit(line);
  };
  return {
    push(chunk: string): void {
      pending += chunk;
      // A trailing "\r" waits for a possible "\n" in the next chunk.
      const parts = pending.split(/\r\n|\n|\r(?!$)/);
      pending = parts.pop() ?? "";
      for (const line of parts) emitLine(line);
      if (pending.length > MAX_LINE_LENGTH) {
        emitLine(pending);
        pending = "";
      }
    },
    flush(): void {
      emitLine(pending.replace(/\r$/, ""));
      pending = "";
    },
  };
}

function tailOf(text: string, mask: (text: string) => string): string {
  const trimmed = mask(text).trim();
  return trimmed.length > STDERR_TAIL_CHARS ? `…${trimmed.slice(-STDERR_TAIL_CHARS)}` : trimmed;
}

function executableName(command: string): string {
  const slash = command.lastIndexOf("/");
  return slash === -1 ? command : command.slice(slash + 1);
}

/** First argument when it is a plain word (a subcommand such as "build"), never a value. */
function subcommandOf(args: readonly string[]): string | undefined {
  const first = args[0];
  return first !== undefined && /^[a-z][a-z-]{0,30}$/.test(first) ? first : undefined;
}

function spawnFailure(command: string, args: readonly string[], error: unknown): ExecError {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  return new ExecError({
    reason: "spawn",
    command: executableName(command),
    subcommand: subcommandOf(args),
    code: null,
    stderrTail: "",
    detail: code,
  });
}

/**
 * Runs a command and resolves with its outcome, whatever the exit code. Rejects
 * with an ExecError (reason "spawn") only when the process could not start
 * (missing executable, permission denied).
 */
export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const mask = masker(options.sensitive);
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  return new Promise<RunResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve({ code: -1, stdout: "", stderr: "", timedOut: false, aborted: true });
      return;
    }

    let child: ChildProcess;
    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        // Next augments ProcessEnv with a required NODE_ENV, which a child's environment need not carry.
        env: { ...baseEnvironment(), ...options.env } as unknown as NodeJS.ProcessEnv,
        stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        // Own process group: a timeout or an abort kills the whole tree (git → git-remote-https…).
        detached: true,
        windowsHide: true,
      });
    } catch (error) {
      reject(spawnFailure(command, args, error));
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    let killTimer: NodeJS.Timeout | null = null;

    const keep = (current: string, chunk: string): string => {
      const next = current + chunk;
      return next.length > maxOutput ? next.slice(next.length - maxOutput) : next;
    };
    const stream = (name: OutputStream) =>
      options.onLine
        ? createLineSplitter((line) => {
            try {
              options.onLine?.(name, mask(line));
            } catch {
              // A faulty callback must not break the stream handling.
            }
          })
        : null;
    const outLines = stream("stdout");
    const errLines = stream("stderr");

    const kill = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // Already gone.
        }
      }
    };
    const terminate = (): void => {
      kill("SIGTERM");
      killTimer ??= setTimeout(() => kill("SIGKILL"), KILL_GRACE_MS);
    };
    const onAbort = (): void => {
      aborted = true;
      terminate();
    };
    const cleanup = (): void => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, options.timeoutMs);
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = keep(stdout, chunk);
      outLines?.push(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = keep(stderr, chunk);
      errLines?.push(chunk);
    });

    if (options.stdin !== undefined && child.stdin) {
      child.stdin.on("error", () => {
        // The child closed its stdin early (EPIPE): its exit code tells what happened.
      });
      child.stdin.end(options.stdin);
    }

    child.on("error", (error) => {
      // After a successful spawn this can only be a failed kill: ignored.
      if (settled || child.pid !== undefined) return;
      settled = true;
      cleanup();
      reject(spawnFailure(command, args, error));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      outLines?.flush();
      errLines?.flush();
      resolve({ code: code ?? -1, stdout, stderr, timedOut, aborted });
    });
  });
}

/** Like `run`, but rejects with an ExecError unless the process exited with code 0. */
export async function runChecked(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const result = await run(command, args, options);
  if (result.code === 0 && !result.timedOut && !result.aborted) return result;
  throw new ExecError({
    reason: result.timedOut ? "timeout" : result.aborted ? "aborted" : "exit",
    command: executableName(command),
    subcommand: subcommandOf(args),
    code: result.code,
    stderrTail: tailOf(result.stderr, masker(options.sensitive)),
  });
}
