import { describe, expect, it } from "vitest";

import type { ClaudeEvent } from "@/lib/claude-events";
import { createClaudeStreamTranslator, describeToolInput } from "@/server/claude/stream";

const SESSION = "4138df08-d704-454b-ba4c-76dfd06409dc";

function line(value: unknown): string {
  return JSON.stringify(value);
}

function textDelta(text: string, parent: string | null = null): string {
  return line({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    parent_tool_use_id: parent,
  });
}

const TEXT_START = line({
  type: "stream_event",
  event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  parent_tool_use_id: null,
});

function translate(lines: string[]): ClaudeEvent[] {
  const translator = createClaudeStreamTranslator();
  return lines.flatMap((entry) => translator.push(entry));
}

describe("createClaudeStreamTranslator", () => {
  it("traduit un tour complet : session, outil, résultat, texte, fin", () => {
    const events = translate([
      line({ type: "system", subtype: "init", session_id: SESSION, model: "claude-opus-5-5", cwd: "/root" }),
      line({ type: "system", subtype: "status", status: "requesting" }),
      line({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "id -un" } }] },
        parent_tool_use_id: null,
      }),
      line({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "root", is_error: false }] },
        parent_tool_use_id: null,
      }),
      TEXT_START,
      textDelta("Vous êtes "),
      textDelta("root."),
      // The full message repeats the streamed text: it must not be emitted twice.
      line({ type: "assistant", message: { content: [{ type: "text", text: "Vous êtes root." }] }, parent_tool_use_id: null }),
      line({ type: "result", subtype: "success", is_error: false, result: "Vous êtes root.", duration_ms: 2943, total_cost_usd: 0.1 }),
    ]);
    expect(events).toEqual([
      { type: "session", sessionId: SESSION, model: "claude-opus-5-5", cwd: "/root" },
      { type: "tool", id: "toolu_1", name: "Bash", input: "id -un" },
      { type: "tool_result", id: "toolu_1", output: "root", isError: false },
      { type: "text", text: "Vous êtes " },
      { type: "text", text: "root." },
      { type: "done", ok: true, durationMs: 2943, costUsd: 0.1 },
    ]);
  });

  it("sépare deux blocs de texte consécutifs, pas un texte qui suit un outil", () => {
    const events = translate([
      TEXT_START,
      textDelta("Un."),
      TEXT_START,
      textDelta("Deux."),
      line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Read", input: {} }] } }),
      TEXT_START,
      textDelta("Trois."),
    ]);
    expect(events.filter((event) => event.type === "text").map((event) => event.text)).toEqual([
      "Un.",
      "\n\n",
      "Deux.",
      "Trois.",
    ]);
  });

  it("ignore ce que diffuse un sous-agent et les lignes illisibles", () => {
    const events = translate([
      textDelta("interne", "toolu_parent"),
      line({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "ls" } }] },
        parent_tool_use_id: "toolu_parent",
      }),
      "pas du json",
      "[1,2]",
      line({ type: "rate_limit_event" }),
    ]);
    expect(events).toEqual([]);
  });

  it("lit un résultat d'outil en blocs et signale l'erreur", () => {
    const events = translate([
      line({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t3",
              is_error: true,
              content: [{ type: "text", text: "ligne 1" }, { type: "image" }, { type: "text", text: "ligne 2" }],
            },
          ],
        },
      }),
    ]);
    expect(events).toEqual([{ type: "tool_result", id: "t3", output: "ligne 1\nligne 2", isError: true }]);
  });

  it("tronque une sortie d'outil trop longue", () => {
    const [event] = translate([
      line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t4", content: "x".repeat(9_000) }] } }),
    ]);
    expect(event.type).toBe("tool_result");
    if (event.type !== "tool_result") return;
    expect(event.output.startsWith("x".repeat(8_000))).toBe(true);
    expect(event.output).toContain("1000 caractères masqués");
  });

  it("un résultat en erreur donne un message puis la fin, et marque le tour terminé", () => {
    const translator = createClaudeStreamTranslator();
    expect(translator.finished).toBe(false);
    const events = translator.push(
      line({ type: "result", subtype: "error_during_execution", is_error: true, result: "Credit balance is too low" }),
    );
    expect(events).toEqual([
      { type: "error", message: "Credit balance is too low" },
      { type: "done", ok: false, durationMs: null, costUsd: null },
    ]);
    expect(translator.finished).toBe(true);
  });

  it("sans texte diffusé, le texte final du résultat sert de réponse", () => {
    const events = translate([line({ type: "result", subtype: "success", is_error: false, result: "OK" })]);
    expect(events).toEqual([
      { type: "text", text: "OK" },
      { type: "done", ok: true, durationMs: null, costUsd: null },
    ]);
  });
});

describe("describeToolInput", () => {
  it("résume les outils courants par ce qui se lit", () => {
    expect(describeToolInput("Bash", { command: "docker ps", description: "Liste" })).toBe("docker ps");
    expect(describeToolInput("Edit", { file_path: "/etc/hosts", old_string: "a", new_string: "b" })).toBe("/etc/hosts");
    expect(describeToolInput("Grep", { pattern: "TODO", path: "/srv" })).toBe("TODO  (/srv)");
    expect(describeToolInput("Grep", { pattern: "TODO" })).toBe("TODO");
  });
  it("retombe sur l'entrée brute pour un outil inconnu, et sur rien sans objet", () => {
    expect(describeToolInput("Mystery", { a: 1 })).toBe('{\n  "a": 1\n}');
    expect(describeToolInput("Bash", null)).toBe("");
    expect(describeToolInput("Bash", {})).toBe("{}");
  });
});
