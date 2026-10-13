/**
 * The command console shown on a project database. It runs APPLICATION
 * commands (`npm run db:migrate`, `npx prisma migrate deploy`): one command
 * line at a time, by `sh -c`, inside the container of an application service
 * of the same project (`docker exec`) — where the code, its tools and its
 * variables (DATABASE_URL…) are. The PostgreSQL container has none of them.
 *
 * - Nothing is interpreted on the host: the line is a single argument of
 *   `docker exec` (see exec.ts), the shell that reads it is the container's.
 *   User and directory are those of the image, like the application itself.
 * - Every command is a new process: no state (directory, variables) survives
 *   from one line to the next, and there is no terminal (nothing interactive).
 * - A command is STARTED, then followed: a migration or an `npx` that downloads
 *   its package takes minutes, far more than a request should stay open. The
 *   runs live in the memory of the web process (lost when it restarts, the
 *   command itself goes on in its container), one at a time per database.
 * - The output is read line by line (empty lines are dropped) and capped; its
 *   end is kept.
 * - Time limit: the platform stops WAITING after COMMAND_TIMEOUT_SECONDS, it
 *   never kills anything in the container. Killing a command tree from outside
 *   orphans its children onto PID 1, which is the application (or, in a
 *   database container, the postmaster, which then restarts in recovery).
 */

import type { CommandRun } from "@/lib/types";

import { randomToken } from "../crypto";
import { dockerRaw, unavailableFromStderr } from "../docker";
import { conflict, notFound, validation } from "../errors";

export const MAX_COMMAND_LENGTH = 4_000;
export const COMMAND_TIMEOUT_SECONDS = 15 * 60;
/** Per stream, in characters. */
export const MAX_COMMAND_OUTPUT = 64 * 1024;
/** A finished run can still be read for this long. */
const KEEP_FINISHED_MS = 15 * 60 * 1_000;

/** The engine refusing the exec, as opposed to anything the command printed. */
const ENGINE_REFUSAL = /^Error response from daemon:.*(no such container|is not running|is restarting|is paused)/i;
/** The image has no shell to read the line (distroless, scratch). */
const NO_SHELL = /exec: "sh": executable file not found|no such file or directory.*\bsh\b/i;

interface RunState {
  id: string;
  databaseId: string;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

// On globalThis: the route bundles of the web process must share one registry.
const REGISTRY = Symbol.for("mini-railway.console-runs");
function runs(): Map<string, RunState> {
  const holder = globalThis as { [REGISTRY]?: Map<string, RunState> };
  return (holder[REGISTRY] ??= new Map());
}

function forgetOldRuns(now: number): void {
  for (const [id, run] of runs()) {
    if (run.finishedAt !== null && now - run.finishedAt > KEEP_FINISHED_MS) runs().delete(id);
  }
}

function present(run: RunState, now: number): CommandRun {
  return {
    id: run.id,
    running: run.finishedAt === null,
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    truncated: run.truncated,
    timedOut: run.timedOut,
    durationMs: Math.round((run.finishedAt ?? now) - run.startedAt),
  };
}

/** Checks a command line of the console and returns it trimmed. */
export function checkCommandLine(command: string): string {
  const line = command.trim();
  if (line === "") throw validation("Saisissez une commande.", "command");
  if (line.length > MAX_COMMAND_LENGTH) {
    throw validation(`La commande ne peut pas dépasser ${MAX_COMMAND_LENGTH} caractères.`, "command");
  }
  if (line.includes("\0")) throw validation("La commande contient un caractère interdit.", "command");
  return line;
}

export interface ConsoleCommand {
  databaseId: string;
  containerName: string;
  /** Name of the service the container belongs to, for messages. */
  serviceName: string;
  /** A line returned by checkCommandLine. */
  line: string;
}

/** Starts a command in the running container of a service and returns at once. */
export function startConsoleCommand(command: ConsoleCommand): CommandRun {
  const now = Date.now();
  forgetOldRuns(now);
  for (const other of runs().values()) {
    if (other.databaseId === command.databaseId && other.finishedAt === null) {
      throw conflict("Une commande est déjà en cours dans cette console. Attendez sa fin.");
    }
  }

  const run: RunState = {
    id: `cmd_${randomToken(12)}`,
    databaseId: command.databaseId,
    startedAt: now,
    finishedAt: null,
    exitCode: null,
    stdout: "",
    stderr: "",
    truncated: false,
    timedOut: false,
  };
  runs().set(run.id, run);

  const append = (stream: "stdout" | "stderr", text: string): void => {
    const next = `${run[stream]}${text}\n`;
    if (next.length > MAX_COMMAND_OUTPUT) run.truncated = true;
    run[stream] = next.length > MAX_COMMAND_OUTPUT ? next.slice(next.length - MAX_COMMAND_OUTPUT) : next;
  };

  dockerRaw(["exec", command.containerName, "sh", "-c", command.line], {
    action: "exec",
    timeoutMs: COMMAND_TIMEOUT_SECONDS * 1_000,
    maxOutputBytes: MAX_COMMAND_OUTPUT,
    onLine: append,
  })
    .then((result) => {
      run.timedOut = result.timedOut;
      run.exitCode = result.timedOut ? -1 : result.code;
      if (result.code !== 0 && !result.timedOut) {
        const stderr = result.stderr.trim();
        const failure = unavailableFromStderr(stderr);
        // Docker's own refusals are English and about the engine: say what it means here.
        if (failure) {
          run.stderr = `${failure.message}\n`;
        } else if (ENGINE_REFUSAL.test(stderr)) {
          run.stderr = `Le service « ${command.serviceName} » n’est pas en ligne pour le moment.\n`;
        } else if (NO_SHELL.test(stderr)) {
          run.stderr = `L’image du service « ${command.serviceName} » ne contient pas de shell : la console ne peut rien y exécuter.\n`;
        }
      }
    })
    .catch((error: unknown) => {
      run.exitCode = -1;
      run.stderr = `${error instanceof Error ? error.message : "La commande n’a pas pu être lancée."}\n`;
    })
    .finally(() => {
      run.finishedAt = Date.now();
    });

  return present(run, now);
}

/** State and output so far of a run of `databaseId`. */
export function readConsoleCommand(databaseId: string, runId: string): CommandRun {
  const run = runs().get(runId);
  if (!run || run.databaseId !== databaseId) throw notFound("Commande");
  return present(run, Date.now());
}
