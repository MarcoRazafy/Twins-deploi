/**
 * Wire format of POST /api/claude (SSE, one event per `data:` line): what the
 * server keeps of Claude Code's own stream, shared by the route and the page.
 */

export type ClaudeEvent =
  /** First event of a turn: the id to send back to continue the conversation. */
  | { type: "session"; sessionId: string; model: string | null; cwd: string | null }
  /** A piece of the answer, to append to the text being written. */
  | { type: "text"; text: string }
  /** Claude Code calls a tool. `input` is display text (the command, the file…). */
  | { type: "tool"; id: string; name: string; input: string }
  | { type: "tool_result"; id: string; output: string; isError: boolean }
  /** Last event of a turn that reached its end (successfully or not). */
  | { type: "done"; ok: boolean; durationMs: number | null; costUsd: number | null }
  /** The turn could not run or broke; `message` is French and displayable. */
  | { type: "error"; message: string };

/** Mirrors the limits enforced by POST /api/claude. */
export const CLAUDE_MAX_PROMPT_CHARS = 50_000;
export const CLAUDE_DEFAULT_CWD = "/root";

export interface ClaudeStatus {
  /** False when the root helper is not installed (setup.sh --claude-code). */
  available: boolean;
  defaultCwd: string;
}
