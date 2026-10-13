/**
 * One interactive shell of the server console, behind a pseudo-terminal.
 *
 * Node has no pseudo-terminal of its own and the usual native module needs a
 * compiler on the server: the terminal is held by a small Python process
 * (scripts/terminal/pty-bridge.py), which also kills everything the shell
 * started when the session ends.
 *
 * This is the one place of the platform that starts a shell on the host, on
 * purpose (docs/BACKEND.md, section 11). It runs as the platform account.
 */

import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { userInfo } from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";

/** The bridge gives up to 4 s to the processes of the session, then kills them. */
const BRIDGE_KILL_AFTER_MS = 8_000;
/** Typed input is dropped beyond this backlog (a shell that stopped reading). */
const MAX_PENDING_INPUT_BYTES = 4 * 1024 * 1024;

export interface ShellOptions {
  /** Directory the shell starts in. */
  cwd: string;
  cols: number;
  rows: number;
  /** Alphanumeric id of the session, exported to its processes as MINI_RAILWAY_CONSOLE. */
  marker: string;
  onData: (chunk: Buffer) => void;
  /** Called once, when the shell and everything it started are gone. */
  onExit: (code: number | null) => void;
  onLog?: (line: string) => void;
  bridgePath?: string;
}

export interface Shell {
  write(data: Buffer): void;
  resize(cols: number, rows: number): void;
  /** Stops/resumes reading the terminal (the browser cannot keep up). */
  pause(): void;
  resume(): void;
  /** Ends the session; `onExit` follows. */
  close(): void;
}

export function defaultBridgePath(): string {
  return path.join(process.cwd(), "scripts", "terminal", "pty-bridge.py");
}

/**
 * Environment of the shell: built from scratch, so that nothing of the
 * platform's own environment (DATABASE_URL, the encryption key) leaks into it.
 */
export function shellEnvironment(
  base: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const account = userInfo();
  return {
    HOME: account.homedir,
    USER: account.username,
    LOGNAME: account.username,
    SHELL: account.shell ?? "/bin/sh",
    PATH: [
      path.join(account.homedir, ".local", "bin"),
      path.dirname(process.execPath),
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].join(":"),
    LANG: base.LANG ?? "C.UTF-8",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };
}

export function openShell(options: ShellOptions): Shell {
  const child = spawn(
    "python3",
    [
      options.bridgePath ?? defaultBridgePath(),
      "--cwd",
      options.cwd,
      "--cols",
      String(options.cols),
      "--rows",
      String(options.rows),
      "--marker",
      options.marker,
    ],
    // The cast only satisfies the typing of NODE_ENV: the shell gets exactly this environment.
    { cwd: "/", env: shellEnvironment() as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe", "pipe"] },
  );
  const [stdin, stdout, stderr, control] = child.stdio as unknown as [Writable, Readable, Readable, Writable];
  let exited = false;
  let killTimer: NodeJS.Timeout | null = null;

  stdout.on("data", (chunk: Buffer) => options.onData(chunk));
  stderr.on("data", (chunk: Buffer) => options.onLog?.(chunk.toString("utf8").trim()));
  // A pipe closed by the bridge is not an error worth crashing for.
  stdin.on("error", () => {});
  control.on("error", () => {});

  const finish = (code: number | null): void => {
    if (exited) return;
    exited = true;
    if (killTimer) clearTimeout(killTimer);
    options.onExit(code);
  };
  child.on("error", (error) => {
    options.onLog?.(`cannot start the terminal: ${error.message}`);
    finish(null);
  });
  child.on("close", (code) => finish(code));

  return {
    write(data) {
      if (exited || stdin.destroyed || stdin.writableEnded) return;
      if (stdin.writableLength > MAX_PENDING_INPUT_BYTES) return;
      stdin.write(data);
    },
    resize(cols, rows) {
      if (exited || control.destroyed) return;
      control.write(`${cols} ${rows}\n`);
    },
    pause() {
      stdout.pause();
    },
    resume() {
      stdout.resume();
    },
    close() {
      if (exited || killTimer) return;
      // Closing stdin is the signal; SIGTERM covers a bridge blocked on a write.
      stdin.end();
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), BRIDGE_KILL_AFTER_MS);
    },
  };
}
