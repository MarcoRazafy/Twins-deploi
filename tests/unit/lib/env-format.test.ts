import { describe, expect, it } from "vitest";

import {
  databaseUrlReference,
  describeReference,
  diffEnv,
  findReferences,
  looksSensitive,
  parseEnv,
  serializeEnv,
  suggestKey,
  summarizeDiff,
  validateKey,
} from "@/features/variables/lib/env";

describe("clés", () => {
  it("validateKey", () => {
    expect(validateKey("API_KEY")).toBeNull();
    expect(validateKey("")).toMatch(/requis/);
    expect(validateKey("1A")).not.toBeNull();
    expect(validateKey("a-b")).not.toBeNull();
  });
  it("suggestKey", () => {
    expect(suggestKey("api-key")).toBe("API_KEY");
    expect(suggestKey("  clé secrète ")).toBe("CLE_SECRETE");
    expect(suggestKey("1abc")).toBe("_1ABC");
    expect(suggestKey("---")).toBe("");
  });
  it("looksSensitive", () => {
    for (const k of ["SECRET", "API_TOKEN", "DB_PASSWORD", "API_KEY", "DATABASE_URL"]) expect(looksSensitive(k)).toBe(true);
    for (const k of ["PORT", "MONKEY", "NODE_ENV"]) expect(looksSensitive(k)).toBe(false);
  });
});

describe("références", () => {
  it("findReferences", () => {
    const refs = findReferences("a=${{ Postgres.DATABASE_URL }} b=${{shared.TOKEN}} c=${{Web}}");
    expect(refs.map((r) => [r.service, r.key, r.shared])).toEqual([
      ["Postgres", "DATABASE_URL", false],
      ["shared", "TOKEN", true],
      ["Web", null, false],
    ]);
    expect(refs[0].raw).toBe("${{ Postgres.DATABASE_URL }}");
    expect(findReferences("pas de référence ${x}")).toEqual([]);
  });
  it("describeReference / databaseUrlReference", () => {
    expect(describeReference({ raw: "", service: "shared", key: "T", shared: true })).toBe("Variable partagée T");
    expect(describeReference({ raw: "", service: "Web", key: "K", shared: false })).toBe("K du service Web");
    expect(describeReference({ raw: "", service: "Web", key: null, shared: false })).toBe("Service Web");
    expect(databaseUrlReference("Db")).toBe("${{Db.DATABASE_URL}}");
  });
});

describe("parseEnv", () => {
  it("lit commentaires, export, guillemets et commentaires en fin de ligne", () => {
    const parsed = parseEnv(
      ["# commentaire", "", "A=1", "export B = deux # note", 'C="x # y\\nz"', "D='lit\\n'", "E="].join("\n"),
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((e) => [e.key, e.value])).toEqual([
      ["A", "1"],
      ["B", "deux"],
      ["C", "x # y\nz"],
      ["D", "lit\\n"],
      ["E", ""],
    ]);
    expect(parsed.entries[0].line).toBe(3);
  });
  it("gère les valeurs multi-lignes et CRLF", () => {
    const parsed = parseEnv('K="a\r\nb"\r\nZ=1');
    expect(parsed.entries).toEqual([
      { key: "K", value: "a\nb", line: 1 },
      { key: "Z", value: "1", line: 3 },
    ]);
  });
  it("signale les problèmes et les doublons", () => {
    const parsed = parseEnv(["rien", "1BAD=x", "=x", 'B="x" y', "A=1", "A=2", 'Q="ouvert'].join("\n"));
    expect(parsed.issues.map((i) => i.line)).toEqual([1, 2, 3, 4, 7]);
    expect(parsed.duplicates).toEqual(["A"]);
  });
  it("aller-retour avec serializeEnv", () => {
    const vars = [
      { key: "A", value: "simple" },
      { key: "B", value: 'a "b" \\ c # d\n\te' },
      { key: "C", value: "" },
    ];
    const text = serializeEnv(vars);
    expect(parseEnv(text).entries.map(({ key, value }) => ({ key, value }))).toEqual(vars);
  });
});

describe("diffEnv / summarizeDiff", () => {
  it("compte ajouts, modifications, suppressions", () => {
    const parsed = parseEnv("A=1\nB=changé\nC=nouveau\nA=1").entries;
    const diff = diffEnv([{ key: "A", value: "1" }, { key: "B", value: "x" }, { key: "Z", value: "z" }], parsed);
    expect(diff).toMatchObject({ added: ["C"], changed: ["B"], removed: ["Z"], unchanged: 1 });
    expect(diff.entries.map((e) => e.key)).toEqual(["B", "C", "A"]);
    expect(summarizeDiff(diff)).toContain("1\u00a0ajout");
    expect(summarizeDiff({ added: [], changed: [], removed: [] })).toBe("");
  });
});
