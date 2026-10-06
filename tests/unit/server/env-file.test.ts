import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/contract";
import { serializeEnvFile } from "@/server/deploy/env-file";

describe("serializeEnvFile", () => {
  it("écrit KEY=value par ligne, terminé par un saut de ligne", () => {
    expect(serializeEnvFile({ A: "1", B: "deux" })).toBe("A=1\nB=deux\n");
  });
  it("renvoie une chaîne vide pour une map vide", () => {
    expect(serializeEnvFile({})).toBe("");
  });
  it("garde les valeurs telles quelles (espaces, guillemets, =, #, vide)", () => {
    expect(serializeEnvFile({ A: ' "x" = # y ', B: "" })).toBe('A= "x" = # y \nB=\n');
  });
  it.each(["a\nb", "a\rb", "a\r\nb", "a\0b"])("refuse une valeur avec saut de ligne ou NUL (%j)", (value) => {
    try {
      serializeEnvFile({ OK: "1", SECRET: value });
      throw new Error("devait échouer");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: "validation", field: "SECRET" });
      expect((error as ApiError).message).toContain("SECRET");
      expect((error as ApiError).message).not.toContain(value === "a\0b" ? "\0" : "a\nb");
    }
  });
});
