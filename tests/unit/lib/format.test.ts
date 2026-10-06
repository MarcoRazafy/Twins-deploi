import { describe, expect, it } from "vitest";

import {
  EMPTY_VALUE,
  formatDuration,
  formatGigabytes,
  formatKilobytes,
  formatMegabytes,
  formatPercent,
  initials,
  pluralize,
  shortSha,
  slugify,
} from "@/lib/format";

const N = "\u00a0"; // espace insécable

describe("slugify", () => {
  it("retire accents, casse et ponctuation", () => {
    expect(slugify("Mon Projet Été")).toBe("mon-projet-ete");
    expect(slugify("  --Hello,   World!--  ")).toBe("hello-world");
    expect(slugify("API_v2.0")).toBe("api-v2-0");
  });
  it("vide quand rien d'utilisable", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!! ???")).toBe("");
    expect(slugify("漢字")).toBe("");
  });
});

describe("formatDuration", () => {
  it.each([
    [350, `350${N}ms`],
    [42_000, `42${N}s`],
    [125_000, `2${N}min${N}05${N}s`],
    [4_320_000, `1${N}h${N}12${N}min`],
    [3 * 86_400_000 + 4 * 3_600_000, `3${N}j${N}4${N}h`],
  ])("%d ms", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
  it("valeurs invalides", () => {
    expect(formatDuration(-1)).toBe(EMPTY_VALUE);
    expect(formatDuration(NaN)).toBe(EMPTY_VALUE);
  });
});

describe("tailles", () => {
  it("formatMegabytes / formatGigabytes / formatKilobytes", () => {
    expect(formatMegabytes(512)).toBe(`512${N}Mo`);
    expect(formatMegabytes(1536)).toBe(`1,5${N}Go`);
    expect(formatMegabytes(2 * 1024 * 1024)).toBe(`2${N}To`);
    expect(formatMegabytes(Infinity)).toBe(EMPTY_VALUE);
    expect(formatGigabytes(5)).toBe(`5${N}Go`);
    expect(formatGigabytes(0.5)).toBe(`512${N}Mo`);
    expect(formatKilobytes(512)).toBe(`512${N}Ko`);
    expect(formatKilobytes(NaN)).toBe(EMPTY_VALUE);
  });
  it("formatPercent", () => {
    expect(formatPercent(42.5, 1)).toBe(`42,5${N}%`);
    expect(formatPercent(NaN)).toBe(EMPTY_VALUE);
  });
});

describe("petits formateurs", () => {
  it("pluralize", () => {
    expect(pluralize(0, "ajout")).toBe(`0${N}ajout`);
    expect(pluralize(1, "ajout")).toBe(`1${N}ajout`);
    expect(pluralize(2, "ajout")).toBe(`2${N}ajouts`);
    expect(pluralize(2, "cheval", "chevaux")).toBe(`2${N}chevaux`);
  });
  it("initials", () => {
    expect(initials("Marco Razafy")).toBe("MR");
    expect(initials("cancham-app")).toBe("CA");
    expect(initials("Postgres")).toBe("PO");
    expect(initials("   ")).toBe("?");
  });
  it("shortSha", () => {
    expect(shortSha("0123456789abcdef")).toHaveLength(7);
  });
});
