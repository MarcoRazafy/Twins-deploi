/**
 * Translates Claude Code's `--output-format stream-json` lines into the few
 * events the page shows. Pure: no process, no I/O, so it is unit-tested.
 *
 * Only the main conversation is kept: what a sub-agent streams
 * (`parent_tool_use_id` set) stays inside its tool call.
 */

import type { ClaudeEvent } from "@/lib/claude-events";

const MAX_TOOL_INPUT_CHARS = 4_000;
const MAX_TOOL_OUTPUT_CHARS = 8_000;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n… (${value.length - max} caractères masqués)` : value;
}

/** What a human wants to read of a tool call: the command, the path, else the raw input. */
export function describeToolInput(name: string, input: unknown): string {
  if (!isObject(input)) return "";
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = text(input[key]);
      if (value !== null && value !== "") return value;
    }
    return null;
  };
  let summary: string | null = null;
  if (name === "Bash") summary = pick("command");
  else if (name === "Read" || name === "Write" || name === "Edit" || name === "NotebookEdit") {
    summary = pick("file_path", "notebook_path");
  } else if (name === "Glob" || name === "Grep") {
    const pattern = pick("pattern");
    const where = pick("path");
    summary = pattern === null ? null : where === null ? pattern : `${pattern}  (${where})`;
  } else if (name === "WebFetch") summary = pick("url");
  else if (name === "WebSearch") summary = pick("query");
  else if (name === "Task" || name === "Agent") summary = pick("description", "prompt");
  return clip(summary ?? JSON.stringify(input, null, 2), MAX_TOOL_INPUT_CHARS);
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isObject(part) && part.type === "text" ? (text(part.text) ?? "") : ""))
    .filter((part) => part !== "")
    .join("\n");
}

export interface ClaudeStreamTranslator {
  /** Events for one output line; an unreadable or irrelevant line gives none. */
  push(line: string): ClaudeEvent[];
  /** True once the `result` line was seen: the turn ended on its own. */
  readonly finished: boolean;
}

export function createClaudeStreamTranslator(): ClaudeStreamTranslator {
  let finished = false;
  // Two text blocks in a row (no tool call between them) are separate paragraphs.
  let lastWasText = false;
  let wroteText = false;

  function fromStreamEvent(event: unknown): ClaudeEvent[] {
    if (!isObject(event)) return [];
    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (isObject(block) && block.type === "text" && lastWasText) return [{ type: "text", text: "\n\n" }];
      return [];
    }
    if (event.type === "content_block_delta" && isObject(event.delta) && event.delta.type === "text_delta") {
      const delta = text(event.delta.text);
      if (delta === null || delta === "") return [];
      lastWasText = true;
      wroteText = true;
      return [{ type: "text", text: delta }];
    }
    return [];
  }

  function fromAssistant(message: unknown): ClaudeEvent[] {
    if (!isObject(message) || !Array.isArray(message.content)) return [];
    const events: ClaudeEvent[] = [];
    for (const block of message.content) {
      // Text already arrived piece by piece through the stream events.
      if (!isObject(block) || block.type !== "tool_use") continue;
      const id = text(block.id);
      const name = text(block.name);
      if (id === null || name === null) continue;
      lastWasText = false;
      events.push({ type: "tool", id, name, input: describeToolInput(name, block.input) });
    }
    return events;
  }

  function fromUser(message: unknown): ClaudeEvent[] {
    if (!isObject(message) || !Array.isArray(message.content)) return [];
    const events: ClaudeEvent[] = [];
    for (const block of message.content) {
      if (!isObject(block) || block.type !== "tool_result") continue;
      const id = text(block.tool_use_id);
      if (id === null) continue;
      events.push({
        type: "tool_result",
        id,
        output: clip(toolResultText(block.content), MAX_TOOL_OUTPUT_CHARS),
        isError: block.is_error === true,
      });
    }
    return events;
  }

  function fromResult(line: Json): ClaudeEvent[] {
    finished = true;
    const ok = line.is_error !== true && line.subtype === "success";
    const events: ClaudeEvent[] = [];
    const result = text(line.result);
    if (!ok) {
      events.push({
        type: "error",
        message:
          line.subtype === "error_max_turns"
            ? "Claude Code s’est arrêté : nombre maximal d’étapes atteint."
            : result !== null && result !== ""
              ? result
              : "Claude Code a rencontré une erreur pendant l’exécution.",
      });
    } else if (!wroteText && result !== null && result !== "") {
      // No partial messages were streamed: the final text is the answer.
      events.push({ type: "text", text: result });
    }
    events.push({
      type: "done",
      ok,
      durationMs: typeof line.duration_ms === "number" ? line.duration_ms : null,
      costUsd: typeof line.total_cost_usd === "number" ? line.total_cost_usd : null,
    });
    return events;
  }

  return {
    get finished() {
      return finished;
    },
    push(raw) {
      let line: unknown;
      try {
        line = JSON.parse(raw);
      } catch {
        return [];
      }
      if (!isObject(line)) return [];
      if (line.type === "result") return fromResult(line);
      if (line.type === "system" && line.subtype === "init") {
        const sessionId = text(line.session_id);
        if (sessionId === null) return [];
        return [{ type: "session", sessionId, model: text(line.model), cwd: text(line.cwd) }];
      }
      if (line.parent_tool_use_id !== null && line.parent_tool_use_id !== undefined) return [];
      if (line.type === "stream_event") return fromStreamEvent(line.event);
      if (line.type === "assistant") return fromAssistant(line.message);
      if (line.type === "user") return fromUser(line.message);
      return [];
    },
  };
}
