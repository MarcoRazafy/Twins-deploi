import { describe, expect, it } from "vitest";

import {
  CONSOLE_CLOSE,
  CONSOLE_CLOSE_MESSAGES,
  CONSOLE_LIMITS,
  consoleCloseReason,
  consoleSize,
  parseConsoleClientMessage,
} from "@/lib/server-console";

describe("consoleSize", () => {
  it("keeps a sane size and accepts the digits of a query string", () => {
    expect(consoleSize(120, 40)).toEqual({ cols: 120, rows: 40 });
    expect(consoleSize("132", "43")).toEqual({ cols: 132, rows: 43 });
  });

  it("clamps to the bounds and falls back on anything that is not an integer", () => {
    expect(consoleSize(1, 100_000)).toEqual({ cols: CONSOLE_LIMITS.cols.min, rows: CONSOLE_LIMITS.rows.max });
    expect(consoleSize(null, undefined)).toEqual({ cols: 80, rows: 24 });
    expect(consoleSize("80; rm -rf /", "-5")).toEqual({ cols: 80, rows: 24 });
    expect(consoleSize(80.5, Number.NaN)).toEqual({ cols: 80, rows: 24 });
  });
});

describe("parseConsoleClientMessage", () => {
  it("reads a resize and clamps it", () => {
    expect(parseConsoleClientMessage('{"type":"resize","cols":100,"rows":30}')).toEqual({
      type: "resize",
      cols: 100,
      rows: 30,
    });
    expect(parseConsoleClientMessage('{"type":"resize","cols":9999,"rows":1}')).toEqual({
      type: "resize",
      cols: CONSOLE_LIMITS.cols.max,
      rows: CONSOLE_LIMITS.rows.min,
    });
  });

  it("ignores everything else", () => {
    expect(parseConsoleClientMessage("not json")).toBeNull();
    expect(parseConsoleClientMessage("null")).toBeNull();
    expect(parseConsoleClientMessage('{"type":"exec","command":"id"}')).toBeNull();
    expect(parseConsoleClientMessage('{"type":"resize","cols":"100","rows":30}')).toBeNull();
    expect(parseConsoleClientMessage(`{"type":"resize","cols":1,"rows":1,"pad":"${"x".repeat(300)}"}`)).toBeNull();
  });
});

describe("close codes", () => {
  it("map back to their reason, anything unknown being a lost connection", () => {
    expect(consoleCloseReason(CONSOLE_CLOSE.idle)).toBe("idle");
    expect(consoleCloseReason(CONSOLE_CLOSE.tooManySessions)).toBe("tooManySessions");
    expect(consoleCloseReason(1006)).toBe("disconnected");
  });

  it("all have a message, and stay in the application range", () => {
    for (const [reason, code] of Object.entries(CONSOLE_CLOSE)) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThan(5000);
      expect(CONSOLE_CLOSE_MESSAGES[reason as keyof typeof CONSOLE_CLOSE]).toBeTruthy();
    }
  });
});
