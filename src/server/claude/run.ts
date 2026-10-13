/**
 * Starts one Claude Code turn through the root helper
 * (scripts/server/bin/mini-railway-claude, `sudo -n`) and reports it as
 * ClaudeEvents. The ONLY place that calls this helper.
 *
 * This is not `exec.run`: the helper's stdin stays open for the whole turn.
 * Closing it is the cancel signal (an unprivileged process cannot signal a
 * root one), so a stopped request, a closed tab or a restart of the web
 * process all end the Claude Code process tree.
 */

import { spawn } from "node:child_process";
import path from "node:path";

import { CLAUDE_DEFAULT_CWD, type ClaudeEvent } from "@/lib/claude-events";

import { env } from "../env";
import { createClaudeStreamTranslator } from "./stream";

export const CLAUDE_NOT_CONFIGURED =
  "Claude Code n’est pas activé sur ce serveur : exécutez sudo bash scripts/server/setup.sh --claude-code, puis redémarrez la plateforme.";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STDERR_TAIL_CHARS = 600;
const SUDO_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export function claudeHelperPath(): string | null {
  const value = env.claudeHelper;
  return value !== null && path.isAbsolute(value) ? value : null;
}

export function isClaudeSessionId(value: string): boolean {
  return SESSION_ID.test(value);
}

/** An absolute, normalised path; the helper checks that it is a real directory. */
export function normalizeCwd(value: string | null): string | null {
  if (value === null || value.trim() === "") return CLAUDE_DEFAULT_CWD;
  const trimmed = value.trim();
  if (!path.isAbsolute(trimmed) || trimmed.includes("\0") || trimmed.length > 1024) return null;
  return path.normalize(trimmed);
}

export interface ClaudeTurn {
  prompt: string;
  /** Continues that Claude Code session; null starts a new one. */
  sessionId: string | null;
  cwd: string;
}

export interface RunningTurn {
  /** Ends the turn now. Safe to call more than once and after the end. */
  cancel(): void;
  /** Resolves when the helper has exited and every event was delivered. */
  done: Promise<void>;
}

function failureMessage(code: number, stderr: string): string {
  const detail = stderr.trim().replace(/\s*\n\s*/g, " · ");
  const tail = detail.length > STDERR_TAIL_CHARS ? `…${detail.slice(-STDERR_TAIL_CHARS)}` : detail;
  if (code === 3) return "Claude Code n’est pas installé pour le compte root de ce serveur.";
  if (code === 2) return `La demande a été refusée${tail ? ` : ${tail}` : "."}`;
  if (/a password is required|not allowed|interactive authentication/i.test(detail)) return CLAUDE_NOT_CONFIGURED;
  return `Claude Code s’est arrêté de façon inattendue (code ${code})${tail ? ` : ${tail}` : "."}`;
}

export function startClaudeTurn(turn: ClaudeTurn, onEvent: (event: ClaudeEvent) => void): RunningTurn {
  const helper = claudeHelperPath();
  if (helper === null) {
    onEvent({ type: "error", message: CLAUDE_NOT_CONFIGURED });
    return { cancel: () => {}, done: Promise.resolve() };
  }

  const args = ["-n", helper, "run", "--cwd", turn.cwd];
  if (turn.sessionId !== null) args.push("--resume", turn.sessionId);

  const translator = createClaudeStreamTranslator();
  let cancelled = false;
  let stderr = "";
  let pending = "";

  const child = spawn("sudo", args, {
    // Nothing of the platform's environment (database URL, secret key…) reaches the helper.
    env: { PATH: SUDO_PATH, LANG: "C.UTF-8" } as unknown as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    child.stdin.end();
  };

  const done = new Promise<void>((resolve) => {
    const emitLine = (line: string): void => {
      if (line.trim() === "") return;
      for (const event of translator.push(line)) onEvent(event);
    };

    child.stdin.on("error", () => {
      // The helper exited before reading its input: its exit code tells what happened.
    });
    child.stdin.write(`${JSON.stringify({ prompt: turn.prompt })}\n`);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) emitLine(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4 * STDERR_TAIL_CHARS);
    });

    child.on("error", () => {
      if (child.pid !== undefined) return;
      onEvent({ type: "error", message: "Impossible de lancer Claude Code : sudo est introuvable ou inutilisable." });
      resolve();
    });
    child.on("close", (code) => {
      emitLine(pending);
      pending = "";
      // The turn is over: release the helper's cancel channel.
      child.stdin.end();
      if (!translator.finished && !cancelled) {
        onEvent({ type: "error", message: failureMessage(code ?? -1, stderr) });
      }
      resolve();
    });
  });

  return { cancel, done };
}
