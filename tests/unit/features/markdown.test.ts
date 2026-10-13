import { describe, expect, it } from "vitest";

import { parseBlocks } from "@/features/assistant/components/markdown";

describe("parseBlocks", () => {
  it("reads a table with its alignments", () => {
    const blocks = parseBlocks(
      ["Voici l’état :", "", "| Service | État |", "|---|:-:|", "| `a \\| b` | actif |", "| nginx |", "", "Fin."].join("\n"),
    );
    expect(blocks).toEqual([
      { kind: "paragraph", text: "Voici l’état :" },
      {
        kind: "table",
        header: ["Service", "État"],
        align: ["left", "center"],
        rows: [["`a | b`", "actif"], ["nginx"]],
      },
      { kind: "paragraph", text: "Fin." },
    ]);
  });

  it("keeps a line with a pipe as text when no table rule follows", () => {
    expect(parseBlocks("a | b\n---")).toEqual([{ kind: "paragraph", text: "a | b" }, { kind: "rule" }]);
  });

  it("reads headings, rules and lists", () => {
    expect(parseBlocks("## Titre\n\n- un\n- deux\n\n***")).toEqual([
      { kind: "heading", level: 2, text: "Titre" },
      {
        kind: "list",
        ordered: false,
        items: [
          { text: "un", children: [] },
          { text: "deux", children: [] },
        ],
      },
      { kind: "rule" },
    ]);
  });
});
